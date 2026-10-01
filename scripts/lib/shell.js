'use strict';
// =============================================================
// Luminary OS — Safe cross-platform process spawning
// scripts/lib/shell.js
//
// Windows cannot execute npm's .cmd shims directly. For the
// known Node CLIs used by this launcher, resolve the installed
// JavaScript entry point beside the shim and run it with Node.
// Arguments stay separate OS arguments, including paths with
// spaces and shell metacharacters. Ordinary executables also
// run directly. A shell is used only when explicitly requested.
// =============================================================

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

/**
 * Windows env var names are case-insensitive but Node exposes
 * whatever casing the OS process originally had — usually
 * "Path", sometimes "PATH" depending on how the session was
 * created. Find whichever key actually exists.
 */
function pathKey(env) {
  if (!IS_WIN) return 'PATH';
  const found = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return found || 'Path';
}

/**
 * Locate a binary using the OS's own resolver:
 *   Windows → where.exe   (a real .exe, safe to spawn directly)
 *   POSIX   → which
 * Both are genuine executables, never .cmd/.bat, so this
 * function is safe to call with shell:false even before
 * anything else has been fixed. Returns an array of resolved
 * paths, or an empty array if not found. Never throws.
 */
function which(name, opts = {}) {
  const finder = IS_WIN ? 'where.exe' : 'which';
  try {
    const r = spawnSync(finder, [name], {
      cwd: opts.cwd, env: opts.env, encoding: 'utf8', windowsHide: true, shell: false,
    });
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build an env object with <cwd>/node_modules/.bin prepended to
 * PATH — the same trick `npm run <script>` uses internally so
 * locally-installed CLI tools resolve by their bare name
 * (vite, ts-node-dev) without needing npx or an absolute path.
 *
 * Resolution uses the caller's cwd/env and never builds a shell
 * command line, so paths containing spaces remain ordinary paths.
 */
function withLocalBin(cwd, extraEnv = {}) {
  const localBin = path.join(cwd, 'node_modules', '.bin');
  const key = pathKey(process.env);
  const existing = process.env[key] || '';
  return {
    ...process.env,
    ...extraEnv,
    [key]: `${localBin}${path.delimiter}${existing}`,
  };
}

// Fixed entry points for the CLIs used in start/setup/doctor.
// Do not parse arbitrary batch files or interpolate their arguments.
const NODE_CLI = {
  npm: ['node_modules', 'npm', 'bin', 'npm-cli.js'],
  vite: ['..', 'vite', 'bin', 'vite.js'],
  tsx: ['..', 'tsx', 'dist', 'cli.mjs'],
};

function resolveCommand(cmd, args, opts) {
  if (!IS_WIN || opts.shell) return { cmd, args };
  const name = path.basename(cmd).replace(/\.cmd$/i, '').toLowerCase();
  if (!Object.hasOwn(NODE_CLI, name)) return { cmd, args };

  const hasDirectory = path.dirname(cmd) !== '.';
  const resolved = hasDirectory
    ? [path.resolve(opts.cwd || process.cwd(), cmd)]
    : which(cmd, opts);
  for (const shim of resolved) {
    const entry = path.resolve(path.dirname(shim), ...NODE_CLI[name]);
    if (fs.existsSync(entry)) return { cmd: process.execPath, args: [entry, ...args] };
  }
  // Let spawn preserve its normal error/exit contracts when no
  // supported installed entry point can be found.
  return { cmd, args };
}

/** Synchronous process execution for version checks and installation. */
function runSync(cmd, args = [], opts = {}) {
  const command = resolveCommand(cmd, args, opts);
  return spawnSync(command.cmd, command.args, {
    encoding: 'utf8',
    ...opts,
    windowsHide: true,
    shell: opts.shell ?? false,
  });
}

/**
 * Asynchronous execution with the same command resolution.
 * Returns the native ChildProcess, preserving stdio and events.
 */
function runAsync(cmd, args = [], opts = {}) {
  const command = resolveCommand(cmd, args, opts);
  return spawn(command.cmd, command.args, {
    ...opts,
    windowsHide: true,
    shell: opts.shell ?? false,
  });
}

/**
 * Kill an entire process tree, cross-platform.
 *   Windows → taskkill /F /T /PID  (walks the whole tree;
 *             reaches descendants started by the CLI)
 *   POSIX   → signal the negative PID, which hits the whole
 *             process group IF the child was spawned with
 *             detached:true (making it a group leader)
 */
function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false, // taskkill.exe is a real executable — no shell needed
    });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
  }
}

/** Full path to the Windows command interpreter, robustly resolved. */
function comSpec() {
  return process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
}

/**
 * Rich diagnostic info for a command — used to print exact,
 * actionable errors instead of a bare "not found".
 */
function diagnose(name) {
  const paths = which(name);
  let version = null;
  let error = null;

  if (paths.length > 0) {
    const r = runSync(name, ['--version']);
    if (r.error) {
      error = r.error.message;
    } else if (r.status !== 0) {
      error = (r.stderr || '').trim() || `exited with code ${r.status}`;
    } else {
      version = (r.stdout || '').trim();
    }
  }

  return { found: paths.length > 0, paths, version, error };
}

module.exports = {
  IS_WIN,
  which,
  withLocalBin,
  runSync,
  runAsync,
  killTree,
  comSpec,
  diagnose,
  pathKey,
};
