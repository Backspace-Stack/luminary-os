// ============================================================
// FilePlugin — Local filesystem access, confined to allowed roots.
//
// read / write / list / delete / exists / readFolderTree are real
// (fs/promises), confined to the sandbox root PLUS any real folders
// listed in FILE_ALLOWED_DIRS (e.g. Downloads, Desktop, Documents).
// Every path is resolved against those roots and rejected if it
// escapes — lexically OR through a symlink — via the exact same
// Sandbox gate used for the sandbox-only case. Writes are size-capped.
// The sandbox dir is shared with TerminalPlugin (same default), so a
// file written there is visible to `exec` and vice-versa.
//
// write / delete are marked requiresConfirmation so the agent loop
// pauses for user approval before mutating the filesystem — this
// matters even MORE for the real folders, which hold the user's
// actual files rather than throwaway sandbox content. readFolderTree
// is read-only and needs no confirmation.
// ============================================================

import path from 'path';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { BasePlugin } from '../BasePlugin';
import { Sandbox, fsError } from '../shared/Sandbox';
import { identityFilePath, memoriesFilePath } from '../../core/identity/paths';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';

const MAX_WRITE_BYTES = 1024 * 1024; // 1 MB cap on a single write
const MAX_READ_BYTES = 1024 * 1024;  // cap returned content so it can't blow up context

export class FilePlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'file-plugin',
    name: 'File Plugin',
    version: '0.1.0',
    description: 'Sandboxed local filesystem access — read, write, list, delete files.',
    capabilities: [
      {
        action: 'read',
        description: 'Read a UTF-8 text file inside the sandbox.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path relative to the sandbox root.' } },
          required: ['path'],
        },
        requiresConfirmation: false,
      },
      {
        action: 'write',
        description: 'Create or overwrite a UTF-8 text file inside the sandbox (≤ 1 MB).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to the sandbox root.' },
            content: { type: 'string', description: 'Full file contents to write.' },
          },
          required: ['path', 'content'],
        },
        requiresConfirmation: true, // mutation — must be approved
      },
      {
        action: 'list',
        description: 'List the entries of a directory inside the sandbox.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Directory path relative to the sandbox root (default ".").' } },
        },
        requiresConfirmation: false,
      },
      {
        action: 'delete',
        description: 'Delete a file or empty directory inside the sandbox.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path relative to the sandbox root.' } },
          required: ['path'],
        },
        requiresConfirmation: true, // mutation — must be approved
      },
      {
        action: 'exists',
        description: 'Check whether a path exists inside the sandbox.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path relative to the sandbox root.' } },
          required: ['path'],
        },
        requiresConfirmation: false,
      },
      {
        action: 'readFolderTree',
        description:
          'Recursively read a folder as a structured tree (name, type, size, children) up to a given depth. ' +
          'Works inside the sandbox or any allowed real folder (Downloads, Desktop, Documents, …). ' +
          'Use this to understand what a folder contains before acting on it. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Folder to read. May be an allowed absolute path, or relative to the sandbox root.' },
            maxDepth: { type: 'number', description: 'How many levels of children to include (1 = immediate contents; default 2, max 8).' },
          },
          required: ['path'],
        },
        requiresConfirmation: false, // read-only
      },
    ],
    requiresConfig: ['FILE_SANDBOX_DIR', 'FILE_ALLOWED_DIRS'],
  };

  private sandboxDir!: string;
  /** The shared confinement gate (path resolution + read/list), also used
   *  by TerminalPlugin so both tools enforce one identical boundary. */
  private sandbox!: Sandbox;

  protected async onInitialize(): Promise<void> {
    // Default matches TerminalPlugin so the two tools share one sandbox.
    const configured = process.env.FILE_SANDBOX_DIR;
    this.sandboxDir = configured
      ? path.resolve(configured)
      : path.resolve(__dirname, '../../../data/sandbox');
    await fs.mkdir(this.sandboxDir, { recursive: true });

    // Additional real folders Lumen may touch (Downloads, Desktop, …),
    // from FILE_ALLOWED_DIRS. The sandbox is ALWAYS the primary root
    // (index 0), so relative paths and the default "." behave exactly as
    // before; the extra roots only widen what an absolute path may reach.
    const extraDirs = this.parseAllowedDirs(process.env.FILE_ALLOWED_DIRS);

    // The identity file AND the curated-memory file are off-limits to every
    // file operation — refused before any sandbox/allowlist reasoning. Both
    // come from the SAME resolver BaseAgent loads them with (core/identity/
    // paths), so the protected list can never drift from the real locations.
    // MEMORIES.md is written ONLY by the /remember command, never by a plugin.
    const identityPath = identityFilePath();
    const memoriesPath = memoriesFilePath();
    this.sandbox = new Sandbox([this.sandboxDir, ...extraDirs], [identityPath, memoriesPath]);

    this.logger.info(
      `FilePlugin ready — sandbox=${this.sandboxDir}` +
      (extraDirs.length ? `, allowedDirs=[${extraDirs.join(', ')}]` : ', allowedDirs=[] (sandbox only)') +
      `, protected=[${identityPath}, ${memoriesPath}]`,
    );
  }

  /**
   * Parse FILE_ALLOWED_DIRS into a de-duplicated list of absolute roots.
   * Separated by the OS path delimiter (';' on Windows, ':' on POSIX) or a
   * newline. Commas are NOT delimiters: they are legal in filenames on every
   * platform, so splitting on them silently shredded any path containing one
   * ("C:\Users\me\Docs, Old") into two bogus roots. Missing folders are kept:
   * they simply match nothing, and a nonexistent root cannot be escaped into.
   */
  private parseAllowedDirs(raw: string | undefined): string[] {
    if (!raw) return [];
    const seps = process.platform === 'win32' ? /[;\n\r]+/ : /[:\n\r]+/;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(seps)) {
      const t = part.trim();
      if (!t) continue;
      const abs = path.resolve(t);
      const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(abs);
    }
    return out;
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    this.logger.debug(`execute: ${action.action}`, { path: action.payload.path });
    switch (action.action) {
      case 'read':   return this.readFile(action);
      case 'write':  return this.writeFile(action);
      case 'list':   return this.listDir(action);
      case 'delete': return this.deletePath(action);
      case 'exists': return this.existsPath(action);
      case 'readFolderTree': return this.readFolderTree(action);
      default:       return this.notImplemented(action.action);
    }
  }

  // ── Operations ─────────────────────────────────────────────────

  private async readFile(action: PluginAction): Promise<PluginResult> {
    const r = await this.sandbox.read(action.payload.path, MAX_READ_BYTES);
    if ('error' in r) return { success: false, error: r.error };
    this.logger.info(`read (${r.bytes} bytes${r.truncated ? ', truncated' : ''})`, { requestId: action.requestId });
    return { success: true, data: { content: r.content, bytes: r.bytes, truncated: r.truncated } };
  }

  private async writeFile(action: PluginAction): Promise<PluginResult> {
    const content = action.payload.content;
    if (typeof content !== 'string') return { success: false, error: 'write requires a string "content" argument.' };
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) {
      return { success: false, error: `Refused: ${bytes} bytes exceeds the ${MAX_WRITE_BYTES}-byte write cap.` };
    }
    const r = await this.sandbox.safeResolve(action.payload.path);
    if ('error' in r) return { success: false, error: r.error };
    try {
      await fs.mkdir(path.dirname(r.abs), { recursive: true });
      // O_NOFOLLOW rather than flag:'w'. safeResolve's symlink check and this
      // write are two separate syscalls, so a symlink swapped in between them
      // was followed straight out of the sandbox (TOCTOU). O_NOFOLLOW does not
      // exist on Windows, so re-verify the parent's realpath there instead.
      if (process.platform === 'win32') {
        const parentReal = await fs.realpath(path.dirname(r.abs)).catch(() => null);
        if (!parentReal || !this.sandbox.isInside(parentReal)) {
          return { success: false, error: `Refused: "${String(action.payload.path)}" resolves outside the allowed folders.` };
        }
      }
      const flags =
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await fs.open(r.abs, flags);
      try {
        await handle.writeFile(content, { encoding: 'utf8' });
      } finally {
        await handle.close().catch(() => { /* best-effort */ });
      }
      this.logger.info(`wrote ${r.abs} (${bytes} bytes)`, { requestId: action.requestId });
      return { success: true, data: { path: action.payload.path, bytesWritten: bytes } };
    } catch (err) {
      return { success: false, error: fsError('write', action.payload.path, err) };
    }
  }

  private async listDir(action: PluginAction): Promise<PluginResult> {
    const r = await this.sandbox.list(action.payload.path);
    if ('error' in r) return { success: false, error: r.error };
    this.logger.info(`list ${r.path} (${r.entries.length} entries)`, { requestId: action.requestId });
    return { success: true, data: { path: r.path, entries: r.entries } };
  }

  private async deletePath(action: PluginAction): Promise<PluginResult> {
    const r = await this.sandbox.safeResolve(action.payload.path);
    if ('error' in r) return { success: false, error: r.error };
    try {
      const stat = await fs.lstat(r.abs);
      if (stat.isDirectory()) {
        await fs.rmdir(r.abs); // fails honestly if the directory is not empty
      } else {
        await fs.unlink(r.abs);
      }
      this.logger.info(`deleted ${r.abs}`, { requestId: action.requestId });
      return { success: true, data: { path: action.payload.path, deleted: true } };
    } catch (err) {
      return { success: false, error: fsError('delete', action.payload.path, err) };
    }
  }

  private async readFolderTree(action: PluginAction): Promise<PluginResult> {
    const requested = Number(action.payload.maxDepth);
    const maxDepth = Number.isFinite(requested) ? requested : 2; // Sandbox clamps to [1, 8]
    const r = await this.sandbox.readTree(action.payload.path, maxDepth);
    if ('error' in r) return { success: false, error: r.error };
    this.logger.info(`readFolderTree ${r.abs} (depth=${maxDepth})`, { requestId: action.requestId });
    return { success: true, data: { path: r.path, tree: r.node } };
  }

  private async existsPath(action: PluginAction): Promise<PluginResult> {
    const r = await this.sandbox.safeResolve(action.payload.path);
    if ('error' in r) return { success: false, error: r.error };
    const stat = await fs.lstat(r.abs).catch(() => null);
    return {
      success: true,
      data: {
        path: action.payload.path,
        exists: stat !== null,
        type: stat ? (stat.isDirectory() ? 'dir' : stat.isSymbolicLink() ? 'symlink' : 'file') : null,
      },
    };
  }

}
