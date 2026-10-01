// ============================================================
// Sandbox — the ONE sandbox-confinement + read/list code path,
// shared by FilePlugin and TerminalPlugin so there is a single
// authoritative implementation of "resolve a caller-supplied
// path to somewhere provably inside the sandbox root".
//
// Every path is resolved against the sandbox and rejected if it
// escapes — lexically (../../…), by being absolute, by hitting a
// protected path (Lumen's identity file), or through a symlink
// (the target itself, or any ancestor that points outward).
//
// This module owns no policy beyond confinement: callers layer
// their own rules (allow-lists, size caps, mutation gates) on top.
// ============================================================

import path from 'path';
import fs from 'fs/promises';
import { StringDecoder } from 'string_decoder';

export type Resolved = { abs: string } | { error: string };

export interface DirEntry {
  name: string;
  type: 'dir' | 'file' | 'symlink' | 'other';
}

export interface ListResult {
  path: string;
  entries: DirEntry[];
}

export interface ReadResult {
  content: string;
  bytes: number;
  truncated: boolean;
}

/**
 * One node of a recursive folder tree. Directories carry `children` (up to
 * the requested depth); a directory whose contents were not read because
 * the depth limit was reached simply omits `children`. Symlinks are marked
 * and never followed. A per-node `error` records a read that failed (e.g.
 * permission denied) without aborting the whole traversal.
 */
export interface TreeNode {
  name: string;
  type: 'dir' | 'file' | 'symlink' | 'other';
  /** Byte size, for files. */
  size?: number;
  /** Child nodes, for directories that were descended into. */
  children?: TreeNode[];
  /** True when a directory had more entries than the per-directory cap. */
  truncated?: boolean;
  /** Set when this node could not be read (surfaced honestly, not hidden). */
  error?: string;
}

export class Sandbox {
  /** All allowed roots (absolute). roots[0] is the primary sandbox. */
  readonly roots: string[];
  /** Primary root — preserves single-root semantics (relative paths, default "."). */
  readonly root: string;

  /**
   * @param root           Absolute sandbox root, OR a list of allowed roots.
   *                        A single string behaves EXACTLY as before (one
   *                        sandbox). A list confines to the union of roots:
   *                        relative paths still resolve against the first
   *                        (primary) root, and any path — relative or
   *                        absolute — is accepted only if it provably sits
   *                        inside one of the roots. The symlink-escape
   *                        protection is identical; only the containment
   *                        check widens from one root to several.
   * @param protectedPaths Absolute paths that are refused regardless of the
   *                        roots (currently Lumen's identity file).
   */
  constructor(
    root: string | string[],
    private readonly protectedPaths: string[] = [],
  ) {
    const list = (Array.isArray(root) ? root : [root]).filter((r) => typeof r === 'string' && r.trim() !== '');
    if (list.length === 0) throw new Error('Sandbox requires at least one root directory.');
    this.roots = list.map((r) => path.resolve(r));
    this.root = this.roots[0];
  }

  /**
   * Resolve a caller-supplied path to an absolute path guaranteed to sit
   * inside an allowed root — rejecting lexical escapes, protected paths,
   * symlinked targets, and any ancestor symlink that escapes. This is the
   * single confinement gate; every file/terminal operation goes through it.
   * Relative paths resolve against the primary root (unchanged); absolute
   * paths are accepted only when they land inside one of the roots.
   */
  async safeResolve(raw: unknown): Promise<Resolved> {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: 'A string "path" argument is required.' };
    if (raw.includes('\0')) return { error: 'NUL bytes are not permitted in paths.' };
    // Drive-relative paths and NTFS streams have different semantics from
    // ordinary files. POSIX must not treat a Windows traversal as a filename.
    if (process.platform === 'win32'
      ? /^[a-z]:[^\\/]/i.test(raw) || raw.slice(/^[a-z]:/i.test(raw) ? 2 : 0).includes(':')
      : raw.includes('\\') || /^[a-z]:/i.test(raw)) {
      return { error: 'Ambiguous platform path or alternate data stream was refused.' };
    }
    // path.resolve(primaryRoot, raw): an absolute raw is returned as-is
    // (root ignored), a relative raw resolves under the primary root — the
    // exact same expression as the original single-root gate.
    const abs = path.resolve(this.root, raw);

    // 0. Protected paths (identity file) — refused first, before any
    //    sandbox reasoning, so this holds even if the sandbox is ever
    //    configured to contain them. Never rely on directory separation.
    if (this.isProtected(abs)) {
      return { error: `Path "${raw}" is a protected Lumen system file (identity or curated memory) and cannot be accessed.` };
    }

    // 1. Lexical containment — inside ANY allowed root.
    if (!this.isInside(abs)) return { error: `Path "${raw}" resolves outside the allowed folders and was refused.` };

    // 2. The target itself must not be a symlink — we never follow them.
    const lst = await fs.lstat(abs).catch(() => null);
    if (lst?.isSymbolicLink()) return { error: `Path "${raw}" is a symlink; symlink traversal is refused.` };

    // 3. The nearest existing ancestor, once symlinks are resolved, must
    //    still be inside an allowed root (catches a parent symlinked outward).
    const nearest = await this.nearestExisting(abs);
    if (nearest) {
      const real = await fs.realpath(nearest).catch(() => null);
      if (real && !this.isInside(real)) return { error: `Path "${raw}" escapes the allowed folders via a symlink.` };
      // 4. Re-check protection against the CANONICAL path. A Windows 8.3
      //    short name ("IDENTI~1.JSON") or a symlink alias names the
      //    protected file without ever matching it lexically in step 0.
      if (real && nearest === abs && this.isProtected(real)) {
        return { error: `Path "${raw}" is a protected Lumen system file (identity or curated memory) and cannot be accessed.` };
      }
    }
    return { abs };
  }

  /** List a directory's entries (confined). Default path is ".". */
  async list(raw: unknown, maxEntries = 1000): Promise<ListResult | { error: string }> {
    const rel = typeof raw === 'string' && raw.trim() ? raw : '.';
    const r = await this.safeResolve(rel);
    if ('error' in r) return { error: r.error };
    const dirents = await fs.readdir(r.abs, { withFileTypes: true }).catch((err) => err as NodeJS.ErrnoException);
    if (!Array.isArray(dirents)) return { error: fsError('list', rel, dirents) };
    const entries: DirEntry[] = dirents.slice(0, maxEntries).map((d) => ({
      name: d.name,
      type: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'symlink' : d.isFile() ? 'file' : 'other',
    }));
    return { path: rel, entries };
  }

  /** Read a UTF-8 text file (confined, size-capped). */
  async read(raw: unknown, maxBytes: number): Promise<ReadResult | { error: string }> {
    const r = await this.safeResolve(raw);
    if ('error' in r) return { error: r.error };
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      const stat = await fs.stat(r.abs);
      if (stat.isDirectory()) return { error: `"${String(raw)}" is a directory, not a file.` };
      const truncated = stat.size > maxBytes;
      // Read AT MOST maxBytes. readFile() used to pull the ENTIRE file into
      // memory and only then apply the cap, so a multi-GB file inside an
      // allowed folder could OOM the backend before the cap ever mattered.
      const cap = Math.max(0, Math.min(stat.size, maxBytes));
      const buf = Buffer.alloc(cap);
      handle = await fs.open(r.abs, 'r');
      let got = 0;
      while (got < cap) {
        const { bytesRead } = await handle.read(buf, got, cap - got, got);
        if (bytesRead === 0) break; // file shrank mid-read
        got += bytesRead;
      }
      // StringDecoder drops a trailing partial UTF-8 sequence rather than
      // emitting U+FFFD where the byte cap happened to split a codepoint.
      const content = new StringDecoder('utf8').write(buf.subarray(0, got));
      return { content: truncated ? content + '\n…[truncated]' : content, bytes: stat.size, truncated };
    } catch (err) {
      return { error: fsError('read', raw, err) };
    } finally {
      await handle?.close().catch(() => { /* best-effort */ });
    }
  }

  /**
   * Recursively read a directory tree from a confined start path, up to
   * `maxDepth` levels of children (maxDepth=1 ⇒ immediate contents only).
   * The start path passes the full safeResolve gate; during recursion
   * symlinks are marked and NEVER followed, and any real directory whose
   * realpath escapes the allowed roots (e.g. a Windows junction) is treated
   * as an escaping link and not descended — so the traversal can never leave
   * the allowed roots. Read-only.
   */
  async readTree(
    raw: unknown,
    maxDepth: number,
    maxEntriesPerDir = 500,
  ): Promise<{ path: string; abs: string; node: TreeNode } | { error: string }> {
    const r = await this.safeResolve(raw);
    if ('error' in r) return { error: r.error };
    const stat = await fs.lstat(r.abs).catch(() => null);
    if (!stat) return { error: fsError('readFolderTree', raw, { code: 'ENOENT' } as NodeJS.ErrnoException) };
    // Bound depth defensively so a huge tree can't run away.
    const depth = Math.max(1, Math.min(Math.floor(maxDepth) || 1, 8));
    const name = path.basename(r.abs) || r.abs;
    const node = await this.buildTree(r.abs, name, stat, depth, maxEntriesPerDir);
    return { path: typeof raw === 'string' ? raw : r.abs, abs: r.abs, node };
  }

  private async buildTree(
    abs: string,
    name: string,
    stat: import('fs').Stats,
    remainingDepth: number,
    maxEntries: number,
  ): Promise<TreeNode> {
    if (stat.isSymbolicLink()) return { name, type: 'symlink' };
    if (stat.isFile()) return { name, type: 'file', size: stat.size };
    if (!stat.isDirectory()) return { name, type: 'other' };

    const node: TreeNode = { name, type: 'dir' };
    if (remainingDepth <= 0) return node; // depth limit — contents omitted, not read

    let dirents: import('fs').Dirent[];
    try {
      dirents = await fs.readdir(abs, { withFileTypes: true });
    } catch (err) {
      node.error = fsError('list', name, err);
      return node;
    }

    if (dirents.length > maxEntries) node.truncated = true;
    const children: TreeNode[] = [];
    for (const d of dirents.slice(0, maxEntries)) {
      const childAbs = path.join(abs, d.name);
      if (d.isSymbolicLink()) { children.push({ name: d.name, type: 'symlink' }); continue; }
      if (d.isDirectory()) {
        // Guard against junctions / reparse points that resolve outside the
        // allowed roots — treat them like escaping links and do not descend.
        const real = await fs.realpath(childAbs).catch(() => null);
        if (real && !this.isInside(real)) { children.push({ name: d.name, type: 'symlink' }); continue; }
        const cstat = await fs.lstat(childAbs).catch(() => null);
        children.push(cstat ? await this.buildTree(childAbs, d.name, cstat, remainingDepth - 1, maxEntries)
                            : { name: d.name, type: 'dir' });
      } else if (d.isFile()) {
        const cstat = await fs.stat(childAbs).catch(() => null);
        children.push({ name: d.name, type: 'file', size: cstat?.size });
      } else {
        children.push({ name: d.name, type: 'other' });
      }
    }
    node.children = children;
    return node;
  }

  // ── Containment primitives ─────────────────────────────────────

  /** True if `abs` sits inside (or equals) any allowed root. */
  isInside(abs: string): boolean {
    return this.roots.some((root) => {
      const rel = path.relative(root, abs);
      return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
    });
  }

  isProtected(abs: string): boolean {
    const target = normaliseForCompare(abs);
    return this.protectedPaths.some((p) => normaliseForCompare(p) === target);
  }

  /** Deepest ancestor of `abs` (inclusive) that exists on disk, or null. */
  private async nearestExisting(abs: string): Promise<string | null> {
    let cur = abs;
    for (let i = 0; i < 64; i++) {
      if (await fs.stat(cur).then(() => true).catch(() => false)) return cur;
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
    return null;
  }
}

/**
 * Canonical form for protected-path comparison. On Windows it also strips an
 * NTFS alternate-data-stream suffix ("…\LUMEN.md::$DATA"), which opens the
 * SAME file but resolves to a different string — a plain exact match let it
 * straight through the protected-path gate.
 */
function normaliseForCompare(p: string): string {
  let s = path.resolve(p);
  if (process.platform === 'win32') {
    const drive = s.slice(0, 2);      // keep the "C:" of a drive-letter path
    const rest = s.slice(2);
    const colon = rest.indexOf(':');  // any further colon starts a stream name
    if (colon !== -1) s = drive + rest.slice(0, colon);
    s = s.toLowerCase();
  }
  return s;
}

/** Shared, human/model-readable rendering of common fs errors. */
export function fsError(op: string, p: unknown, err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'ENOENT') return `${op} failed: "${p}" does not exist.`;
  if (e?.code === 'ENOTEMPTY') return `${op} failed: "${p}" is a non-empty directory.`;
  if (e?.code === 'EISDIR') return `${op} failed: "${p}" is a directory.`;
  if (e?.code === 'ENOTDIR') return `${op} failed: "${p}" is not a directory.`;
  if (e?.code === 'ELOOP') return `${op} failed: "${p}" is a symlink; symlink traversal is refused.`;
  return `${op} failed: ${e?.message ?? String(err)}`;
}
