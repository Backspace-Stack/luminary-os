// ============================================================
// TerminalPlugin — Sandboxed command execution.
//
// `exec` is real and confined to a sandbox cwd. Two honest paths:
//   • ls / cat / pwd / echo are implemented DIRECTLY in Node (no
//     process is spawned) through the shared Sandbox — so they work
//     identically on every OS regardless of what happens to be on
//     PATH. On Windows the GNU coreutils are not on the system PATH
//     (they live in Git's usr\bin, kept off PATH), so spawning them
//     failed with ENOENT — hence the native implementations.
//   • git runs as the real program via child_process.execFile (NO
//     shell, so model-supplied strings are never interpreted), with a
//     timeout and bounded, truncated output. "No shell" alone does NOT
//     make git safe — it executes programs from its own config — so it
//     additionally passes an option denylist, a read-only subcommand
//     allow-list, and a hardened env. See the git block below.
// Anything not explicitly allow-listed is refused honestly, and exec
// itself requires user confirmation before anything is spawned.
// spawn / kill / list-procs remain unimplemented.
//
// Future implementation: node-pty for proper PTY support and a
// user-configurable allow-list.
// ============================================================

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { StringDecoder } from 'string_decoder';
import { BasePlugin } from '../BasePlugin';
import { Sandbox } from '../shared/Sandbox';
import { identityFilePath, memoriesFilePath } from '../../core/identity/paths';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';

// Hard-coded allow-list — a *denylist* could never enumerate every
// dangerous binary, so we permit only these and refuse everything else.
//
// node and npm are deliberately EXCLUDED, even though they're "just"
// dev tools: `node -e "..."` (or a script written into the shared
// sandbox and then run) is a full, unsandboxed Node process with the
// same filesystem access as the backend itself. It can read or write
// ANY path the process can reach — including LUMEN.md — via fs.*, with
// no way for this plugin's argv-level checks (metachar/path-escape) to
// see or stop it, since the escape happens inside the script's own
// code, not in the command-line arguments. Do not re-add them without
// a real sandbox (container, restricted user, etc.) underneath.
const ALLOWED_BINARIES = ['ls', 'cat', 'pwd', 'echo', 'git'] as const;

// The four commands emulated in Node — they never spawn a process, so
// they are immune to PATH differences and can never escape the sandbox
// (every path they touch goes through Sandbox.safeResolve). Everything
// else on the allow-list (git) takes the real execFile path below.
const NATIVE_BUILTINS = new Set<string>(['ls', 'cat', 'pwd', 'echo']);

// Shell-significant characters. We use execFile (no shell), so these are
// already inert — this is defence in depth against a future refactor to a
// shell, and it makes injection attempts fail loudly instead of silently
// passing a weird literal argument. Note: '/', '\', '.', '-' are allowed so
// ordinary relative paths and flags still work; path escapes are caught
// separately by the sandbox check.
const SHELL_METACHARS = /[;&|`$<>(){}\n\r]/;

// ── git hardening ───────────────────────────────────────────────
// git is a general-purpose program launcher wearing a VCS costume:
//   git -c alias.x='!cmd' x        → runs cmd through a shell
//   git -c core.pager=cmd log      → runs cmd
//   git -c diff.external=cmd diff  → runs cmd
// None of those contain a shell metacharacter and none look like a path,
// so neither of the checks below sees them. Being on ALLOWED_BINARIES is
// therefore not a boundary for git; these three defences are:
//   1. GIT_FORBIDDEN_OPT — the option families that execute or relocate,
//   2. GIT_ALLOWED_SUBCOMMANDS — read-only porcelain only,
//   3. GIT_HARDENED_ENV — ignore every user/system gitconfig at runtime.
const GIT_FORBIDDEN_OPT =
  /^(-c|--config-env|--exec-path|--git-dir|--work-tree|--namespace|--upload-pack|--receive-pack|--exec|--super-prefix|--output|-C)(=|$)/;

/** Read-only git subcommands Lumen may run. Anything else is refused. */
const GIT_ALLOWED_SUBCOMMANDS = new Set([
  'blame', 'branch', 'describe', 'diff', 'log', 'ls-files', 'ls-tree',
  'rev-parse', 'shortlog', 'show', 'status', 'tag',
]);

/** Child env that neutralises config-, pager- and transport-based execution. */
const GIT_HARDENED_ENV: Record<string, string> = {
  // Aliases, pagers, hooks and credential helpers configured anywhere
  // outside Lumen must not apply to a command the model composed.
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
  GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  // Never block on a credential prompt, never hand output to a pager or editor.
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_EDITOR: 'true',
  GIT_ASKPASS: '',
  GIT_SSH_COMMAND: '',
  // ext:: transport shells out; the allowed subcommands need no network.
  GIT_ALLOW_PROTOCOL: 'none',
};

const EXEC_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4096; // per stream (stdout / stderr) fed back to the model

export class TerminalPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'terminal-plugin',
    name: 'Terminal Plugin',
    version: '0.1.0',
    description: 'Confirmation-gated, restricted command inspection. Process management and PTY are not implemented.',
    capabilities: [
      {
        action: 'exec',
        description:
          'Run an allow-listed command (ls, cat, pwd, echo, git) inside the sandbox ' +
          'directory and return its stdout/stderr/exitCode. ls/cat/pwd/echo are run ' +
          'inside the sandbox itself; git runs as the real program. No shell; arguments ' +
          'are passed literally. Paths are relative to the sandbox and may not escape it.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command to run. Must be one of: ls, cat, pwd, echo, git.',
              enum: [...ALLOWED_BINARIES],
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Arguments passed literally to the program. Paths are relative to the sandbox and ' +
                'may not escape it. No shell metacharacters.',
            },
          },
          required: ['command'],
        },
        // Spawning a real subprocess is at least as consequential as
        // FilePlugin's write/delete, which are both gated. It was the one
        // mutating-capable capability the agent loop never paused on.
        requiresConfirmation: true,
      },
      { action: 'spawn',        description: 'Spawn a long-running process' },
      { action: 'kill',         description: 'Kill a running process by PID' },
      { action: 'list-procs',   description: 'List processes spawned by this plugin' },
    ],
    requiresConfig: ['TERMINAL_SHELL', 'TERMINAL_SANDBOX_DIR'],
  };

  /** Absolute sandbox root; every exec runs with this as cwd. */
  private sandboxDir!: string;
  /** Shared confinement gate — the SAME one FilePlugin uses, so the
   *  native builtins enforce an identical boundary (incl. the protected
   *  identity file) as the file tools. */
  private sandbox!: Sandbox;

  protected async onInitialize(): Promise<void> {
    // Default beside the backend's data dir; overridable for deployments.
    const configured = process.env.TERMINAL_SANDBOX_DIR;
    this.sandboxDir = configured
      ? path.resolve(configured)
      : path.resolve(__dirname, '../../../data/sandbox');
    fs.mkdirSync(this.sandboxDir, { recursive: true });

    // Guard the identity file AND the curated-memory file here too — from
    // the SAME resolver BaseAgent and FilePlugin use, so a native `cat` can
    // never read either and the three can never drift. MEMORIES.md's only
    // writer is the /remember command, never any plugin.
    this.sandbox = new Sandbox(this.sandboxDir, [identityFilePath(), memoriesFilePath()]);

    this.logger.info(
      `TerminalPlugin ready — exec enabled. sandbox=${this.sandboxDir} ` +
      `allowlist=[${ALLOWED_BINARIES.join(', ')}] (native: ${[...NATIVE_BUILTINS].join(', ')})`,
    );
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    this.logger.debug(`execute: ${action.action}`);
    switch (action.action) {
      case 'exec':
        return this.runExec(action);
      // Deliberately still honest failures — not built yet.
      case 'spawn':
        return this.notImplemented(action.action);
      case 'kill':
        return this.notImplemented(action.action);
      case 'list-procs':
        return this.notImplemented(action.action);
      default:
        return this.notImplemented(action.action);
    }
  }

  // ── exec ───────────────────────────────────────────────────────

  private async runExec(action: PluginAction): Promise<PluginResult> {
    const command = typeof action.payload.command === 'string' ? action.payload.command.trim() : '';
    const rawArgs = action.payload.args;
    if (rawArgs !== undefined && (!Array.isArray(rawArgs) || !rawArgs.every(a => typeof a === 'string' && !a.includes('\0')))) {
      return { success: false, error: 'Rejected: args must be an array of strings without NUL bytes.' };
    }
    const args: string[] = rawArgs === undefined ? [] : rawArgs as string[];

    // Log EVERY attempt before any decision, allowed or not (audit trail).
    // NOTE: the model-supplied command is never shell-interpreted; it is
    // only ever logged and passed as argv[0] to execFile.
    this.logger.info(`exec attempt: "${command}" args=${JSON.stringify(args)}`, {
      requestId: action.requestId,
      agentId: action.agentId,
    });

    if (!command) {
      return { success: false, error: 'No command provided.' };
    }

    // 1. Allow-list the binary.
    if (!ALLOWED_BINARIES.includes(command as (typeof ALLOWED_BINARIES)[number])) {
      this.logger.warn(`exec REJECTED — "${command}" not on allow-list`, { requestId: action.requestId });
      return {
        success: false,
        error: `Command "${command}" is not permitted. Allowed: ${ALLOWED_BINARIES.join(', ')}.`,
      };
    }

    // 1b. Native builtins (ls/cat/pwd/echo) never spawn a process and
    //     never touch a shell, so the metachar/argv-escape defences below
    //     (which exist for the spawned path) don't apply — Sandbox.safeResolve
    //     is their authoritative confinement instead. Dispatch them here.
    //     This also means `echo "a > b"` works: with no shell, '>' is just
    //     text, and rejecting it would be wrong.
    if (NATIVE_BUILTINS.has(command)) {
      this.logger.info(`exec ALLOWED (native): "${command}" args=${JSON.stringify(args)}`, { requestId: action.requestId });
      return this.runNative(command, args, action.requestId);
    }

    // 2. Reject shell metacharacters anywhere in the binary or args.
    const metaOffenders = [command, ...args].filter((s) => SHELL_METACHARS.test(s));
    if (metaOffenders.length) {
      this.logger.warn(`exec REJECTED — shell metacharacters: ${JSON.stringify(metaOffenders)}`, {
        requestId: action.requestId,
      });
      return {
        success: false,
        error: `Rejected: shell metacharacters are not allowed (${metaOffenders.join(', ')}).`,
      };
    }

    // 3. Any path-like argument must resolve inside the sandbox.
    const escaping = args.filter((a) => this.escapesSandbox(a));
    if (escaping.length) {
      this.logger.warn(`exec REJECTED — path escapes sandbox: ${JSON.stringify(escaping)}`, {
        requestId: action.requestId,
      });
      return {
        success: false,
        error: `Rejected: argument(s) resolve outside the sandbox: ${escaping.join(', ')}.`,
      };
    }

    // 3b. git-specific gate — see GIT_FORBIDDEN_OPT above. Being on the
    //     allow-list is not sufficient for git; nothing else catches
    //     `-c alias.x=!cmd` because it is neither metachar nor path.
    if (command === 'git') {
      const gitRejection = this.validateGitArgs(args);
      if (gitRejection) {
        this.logger.warn(`exec REJECTED — ${gitRejection}`, { requestId: action.requestId });
        return { success: false, error: gitRejection };
      }
      const metadataRejection = this.validateGitMetadata();
      if (metadataRejection) return { success: false, error: metadataRejection };
    }

    this.logger.info(`exec ALLOWED: "${command}" args=${JSON.stringify(args)}`, {
      requestId: action.requestId,
    });

    // BaseAgent checks the manifest confirmation gate before this boundary.

    return await this.spawnCaptured(command, args, action.requestId);
  }

  // ── Native builtins (no process spawned) ───────────────────────
  // Each returns the SAME shape spawnCaptured does — { stdout, stderr,
  // exitCode } on success; { error, data:{stdout,stderr} } on failure —
  // so the agent loop and the Agent-view table treat native and spawned
  // results identically.

  private async runNative(command: string, args: string[], requestId: string): Promise<PluginResult> {
    const started = Date.now();
    // Flags (leading '-') are accepted but do not alter behaviour, so the
    // model's habitual `ls -l` / `cat -n` don't error; paths are the rest.
    const paths = args.filter((a) => !a.startsWith('-'));
    let result: PluginResult;
    switch (command) {
      case 'pwd':  result = this.nativePwd(); break;
      case 'echo': result = this.nativeEcho(args); break;
      case 'ls':   result = await this.nativeLs(paths, requestId); break;
      case 'cat':  result = await this.nativeCat(paths, requestId); break;
      default:     result = { success: false, error: `"${command}" has no native implementation.` };
    }
    return { ...result, durationMs: Date.now() - started };
  }

  /** pwd — the working directory IS the sandbox root. */
  private nativePwd(): PluginResult {
    return { success: true, data: { stdout: this.sandboxDir, stderr: '', exitCode: 0 } };
  }

  /** echo — join args literally. A leading -n suppresses the (already
   *  absent) trailing newline; we honour it by not appending one. */
  private nativeEcho(args: string[]): PluginResult {
    const noNewline = args[0] === '-n';
    const words = noNewline ? args.slice(1) : args;
    return { success: true, data: { stdout: this.truncate(words.join(' ')), stderr: '', exitCode: 0 } };
  }

  /** ls — a real directory listing of one sandbox dir (default "."),
   *  confined by Sandbox.safeResolve. Directories get a trailing '/'
   *  and symlinks a trailing '@', ls -F style, so the model can tell
   *  them apart in a single column. */
  private async nativeLs(paths: string[], requestId: string): Promise<PluginResult> {
    // Every operand is listed, not just the first — `ls a b` used to list
    // `a` and pretend `b` had never been asked for.
    const targets = paths.length ? paths : ['.'];
    const blocks: string[] = [];
    let total = 0;
    for (const target of targets) {
      const r = await this.sandbox.list(target);
      if ('error' in r) {
        this.logger.warn(`ls failed: ${r.error}`, { requestId });
        return { success: false, error: r.error, data: { stdout: '', stderr: r.error } };
      }
      total += r.entries.length;
      const body = r.entries
        .map((e) => (e.type === 'dir' ? `${e.name}/` : e.type === 'symlink' ? `${e.name}@` : e.name))
        .join('\n');
      // Real ls labels each directory once more than one is listed.
      blocks.push(targets.length > 1 ? `${r.path}:\n${body}` : body);
    }
    this.logger.info(`ls ${targets.join(' ')} (${total} entries)`, { requestId });
    return { success: true, data: { stdout: this.truncate(blocks.join('\n\n')), stderr: '', exitCode: 0 } };
  }

  /** cat — concatenate the contents of one or more sandbox files. The
   *  first unreadable/escaping/protected path fails the whole call
   *  honestly, exactly as real cat exits non-zero. */
  private async nativeCat(paths: string[], requestId: string): Promise<PluginResult> {
    if (paths.length === 0) {
      return { success: false, error: 'cat: no file specified.', data: { stdout: '', stderr: 'cat: no file specified.' } };
    }
    const chunks: string[] = [];
    for (const p of paths) {
      const r = await this.sandbox.read(p, MAX_OUTPUT_BYTES);
      if ('error' in r) {
        this.logger.warn(`cat failed for "${p}": ${r.error}`, { requestId });
        return { success: false, error: r.error, data: { stdout: '', stderr: r.error } };
      }
      chunks.push(r.content);
    }
    this.logger.info(`cat ${paths.length} file(s)`, { requestId });
    return { success: true, data: { stdout: this.truncate(chunks.join('\n')), stderr: '', exitCode: 0 } };
  }

  /**
   * Refuse the git invocations that execute a program or step outside the
   * sandbox cwd. Returns an error string, or null when the call is allowed.
   */
  private validateGitArgs(args: string[]): string | null {
    const bad = args.find((a) => GIT_FORBIDDEN_OPT.test(a));
    if (bad) {
      return `Rejected: git option "${bad}" can execute programs or relocate the repository, and is not permitted.`;
    }
    // The first non-option argument is the subcommand: every global option
    // that takes a separate value is already forbidden above, so nothing
    // else can occupy this slot.
    const sub = args.find((a) => !a.startsWith('-'));
    if (!sub) return 'Rejected: a git subcommand is required.';
    if (!GIT_ALLOWED_SUBCOMMANDS.has(sub)) {
      return `Rejected: git "${sub}" is not permitted. Allowed subcommands: ${[...GIT_ALLOWED_SUBCOMMANDS].join(', ')}.`;
    }
    // Reject global options and abbreviated/unknown options. Git accepts
    // long-option abbreviations, so a denylist alone is not a boundary.
    if (args[0] !== sub) return 'Rejected: Git global options are not permitted.';
    const safeFlag = /^(?:--(?:porcelain(?:=v[12])?|short|branch|stat|name-only|name-status|oneline|all|remotes|list|show-current|no-ext-diff|no-textconv|no-patch|no-decorate|abbrev-ref|verify|show-toplevel|show-prefix|tags|heads|cached|others|exclude-standard)|--(?:max-count|abbrev)=\d+|-[psb]|-n\d+|--|--format=[^\r\n]*)$/;
    if (args.slice(1).some(a => a.startsWith('-') && !safeFlag.test(a))) return 'Rejected: Git option is not permitted.';
    if ((sub === 'branch' || sub === 'tag') && args.slice(1).some(a => !a.startsWith('-'))) {
      return 'Rejected: branch and tag mutations are not permitted; use list options.';
    }
    return null;
  }

  /** Run the vetted command and capture bounded output. Never throws. */
  private validateGitMetadata(): string | null {
    // Worktrees, submodules and alternates may redirect Git to private
    // repositories. This inspector accepts only a self-contained repo.
    const gitDir = path.join(this.sandboxDir, '.git');
    try {
      const info = fs.lstatSync(gitDir);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('indirect gitdir');
      let count = 0;
      const pending = [gitDir];
      while (pending.length) {
        for (const entry of fs.readdirSync(pending.pop()!, { withFileTypes: true })) {
          if (++count > 100_000) throw new Error('metadata limit');
          if (entry.isSymbolicLink() || ['commondir', 'alternates', 'http-alternates'].includes(entry.name)) throw new Error('indirect metadata');
          if (entry.isDirectory()) pending.push(path.join(entry.parentPath, entry.name));
        }
      }
      return null;
    } catch {
      return 'Rejected: Git requires a self-contained .git directory inside the sandbox, without symlinks, worktree pointers or object alternates.';
    }
  }

  /** Run the vetted command and capture bounded output. Never throws. */
  private spawnCaptured(command: string, args: string[], requestId: string): Promise<PluginResult> {
    const started = Date.now();
    // Strip inherited Git overrides, then disable executable local config.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    const gitArgs = [
      '--no-pager', '--no-optional-locks',
      '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', '-c', 'core.pager=cat',
      '-c', `core.worktree=${this.sandboxDir}`, '-c', 'diff.external=',
      '-c', 'submodule.recurse=false', '-c', 'status.submoduleSummary=false',
      ...args,
    ];
    if (['diff', 'show', 'log'].includes(args[0])) gitArgs.splice(gitArgs.length - args.length + 1, 0, '--no-ext-diff', '--no-textconv');
    if (['status', 'diff'].includes(args[0])) gitArgs.splice(gitArgs.length - args.length + 1, 0, '--ignore-submodules=all');
    return new Promise<PluginResult>((resolve) => {
      execFile(
        command,
        command === 'git' ? gitArgs : args,
        {
          cwd: this.sandboxDir,
          timeout: EXEC_TIMEOUT_MS,
          maxBuffer: 1024 * 1024, // 1 MB hard ceiling; we truncate to MAX_OUTPUT_BYTES below
          windowsHide: true,
          shell: false, // ← the guarantee: no shell, no interpolation, ever
          env: command === 'git' ? { ...env, ...GIT_HARDENED_ENV, GIT_DIR: path.join(this.sandboxDir, '.git'), GIT_CEILING_DIRECTORIES: this.sandboxDir } : process.env,
        },
        (err, stdout, stderr) => {
          const durationMs = Date.now() - started;
          const out = this.truncate(stdout ?? '');
          const errText = this.truncate(stderr ?? '');

          if (err) {
            const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: number | string };

            // Timeout → the process was killed by execFile's timer.
            if (e.killed) {
              this.logger.warn(`exec TIMED OUT after ${EXEC_TIMEOUT_MS}ms: "${command}"`, { requestId });
              return resolve({
                success: false,
                error: `Command timed out after ${EXEC_TIMEOUT_MS}ms.`,
                data: { stdout: out, stderr: errText, timedOut: true },
                durationMs,
              });
            }
            // Binary genuinely missing on this host's PATH.
            if (e.code === 'ENOENT') {
              this.logger.warn(`exec FAILED — "${command}" not found on PATH`, { requestId });
              return resolve({
                success: false,
                error: `Command "${command}" was not found on this host's PATH.`,
                data: { stdout: out, stderr: errText },
                durationMs,
              });
            }
            // Non-zero exit is a REAL result — report it honestly, don't hide it.
            const exitCode = typeof e.code === 'number' ? e.code : null;
            this.logger.info(`exec exited non-zero (${exitCode}): "${command}"`, { requestId });
            return resolve({
              success: false,
              error: `Command exited with code ${exitCode ?? 'unknown'}.`,
              data: { stdout: out, stderr: errText, exitCode },
              durationMs,
            });
          }

          this.logger.info(`exec OK: "${command}" (${durationMs}ms)`, { requestId });
          resolve({ success: true, data: { stdout: out, stderr: errText, exitCode: 0 }, durationMs });
        },
      );
    });
  }

  /**
   * Truncate a stream to MAX_OUTPUT_BYTES with an explicit marker. Measured
   * in BYTES: s.length counts UTF-16 units, which under-counts non-ASCII
   * output by up to 3x, so the "byte" cap was never actually a byte cap.
   */
  private truncate(s: string): string {
    const buf = Buffer.from(s, 'utf8');
    if (buf.byteLength <= MAX_OUTPUT_BYTES) return s;
    // StringDecoder drops a trailing partial codepoint at the cut point.
    return new StringDecoder('utf8').write(buf.subarray(0, MAX_OUTPUT_BYTES)) + '\n…[truncated]';
  }

  /**
   * True if a path-like argument would resolve outside the sandbox.
   * Non-path tokens are ignored; only things that look like paths (contain
   * a separator, "..", or are absolute) are resolved and checked against
   * the sandbox root.
   *
   * A leading '-' used to short-circuit to false, so "--git-dir=C:\Users"
   * and "--work-tree=/" skipped this check entirely. Flags are now split on
   * the first '=' and their VALUE is checked like any other operand.
   */
  private escapesSandbox(arg: string): boolean {
    if (arg.startsWith('-')) {
      const eq = arg.indexOf('=');
      if (eq === -1) return false;               // a bare flag carries no path
      return this.escapesSandbox(arg.slice(eq + 1));
    }
    const looksPathy =
      arg.includes('/') || arg.includes('\\') || arg.includes('..') || path.isAbsolute(arg);
    if (!looksPathy) return false;
    const resolved = path.resolve(this.sandboxDir, arg);
    const rel = path.relative(this.sandboxDir, resolved);
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  }
}
