// ============================================================
// Identity file locations — the ONE place that knows where Lumen's
// identity (LUMEN.md) and curated memories (MEMORIES.md) live.
//
// They live in the project root's "Memory" folder, so the files the user
// edits by hand ARE the files the app loads and /remember writes to —
// one real copy, no syncing, no duplicates to drift apart.
//
// This location is durable: it sits outside backend/dist, which a rebuild
// wipes. That mattered — identity used to resolve relative to the
// compiled output, so a rebuild could silently destroy every fact written
// with /remember.
//
// Resolution is deliberately identical whether running from src (ts-node)
// or dist (compiled): both resolve ../../../../Memory relative to this
// module, which lands on <project root>/Memory either way. The original
// scheme resolved to a DIFFERENT folder in dev vs prod — that mismatch is
// exactly why hand-edits never reached the running app.
//
// Dependency-free on purpose: BaseAgent, FilePlugin and TerminalPlugin
// all import it, so no import cycle is possible and the protected-path
// checks can never drift from the paths actually loaded.
// ============================================================

import fs from 'fs';
import path from 'path';

/** Written only if no LUMEN.md exists anywhere (never clobbers). */
export const STARTER_IDENTITY =
  '# Lumen\n\n' +
  'You are **Lumen**, the local intelligence of Luminary OS. You run entirely on ' +
  "the user's machine and are private by construction. Be calm, precise, and honest: " +
  'never invent facts, tool results, or memories — if something is unknown or a tool ' +
  'failed, say so. Actions that change files pause for the user to approve.\n\n' +
  '*Edit this file to shape Lumen. It is read-only to every agent and tool.*\n';

/** Written only if no MEMORIES.md exists anywhere (never clobbers). */
export const STARTER_MEMORIES =
  'Facts to always keep in mind (curated — loaded in full every session).\n' +
  'Add one with the /remember command, or edit this file directly. Keep it short.\n';

/**
 * The user-facing "Memory" folder at the project root. Resolves to the
 * same absolute path from src (ts-node) and dist (compiled): this module
 * sits at <root>/backend/{src,dist}/core/identity, so four levels up is
 * always <root>.
 */
export function identityDir(): string {
  return path.resolve(__dirname, '../../../../Memory');
}

/** Absolute path to LUMEN.md (env-overridable). */
export function identityFilePath(): string {
  return process.env.LUMEN_IDENTITY_PATH
    ? path.resolve(process.env.LUMEN_IDENTITY_PATH)
    : path.join(identityDir(), 'LUMEN.md');
}

/** Absolute path to MEMORIES.md (env-overridable). */
export function memoriesFilePath(): string {
  return process.env.LUMEN_MEMORIES_PATH
    ? path.resolve(process.env.LUMEN_MEMORIES_PATH)
    : path.join(identityDir(), 'MEMORIES.md');
}

/**
 * Every pre-move location, checked on first boot so nothing written
 * before a move is ever lost:
 *   • backend/data/identity — the previous durable home.
 *   • backend/dist/identity — what the RUNTIME once read, and where
 *                             /remember used to write.
 *   • backend/src/identity  — the committed copy users hand-edited (and,
 *                             under ts-node, what dev runs once read).
 * Real installs can hold unique content in ANY of these, so migration
 * considers all of them rather than assuming one.
 */
function legacyCandidates(fileName: string): { label: string; file: string }[] {
  return [
    { label: 'backend/data/identity', file: path.resolve(__dirname, '../../../data/identity', fileName) },
    { label: 'backend/dist/identity', file: path.resolve(__dirname, '../../identity', fileName) },
    { label: 'backend/src/identity', file: path.resolve(__dirname, '../../../src/identity', fileName) },
  ];
}

/** One migration's outcome, for honest boot logging. */
export interface MigrationReport {
  file: string;
  action: 'already-present' | 'migrated' | 'created-fresh';
  /** Legacy locations whose content was carried over. */
  sources: string[];
  /** Backups written for content that was NOT chosen (never discarded silently). */
  backups: string[];
  bytes: number;
}

const readIfContent = (p: string): string | null => {
  try {
    if (!fs.existsSync(p)) return null;
    const s = fs.readFileSync(p, 'utf8');
    return s.trim().length > 0 ? s : null;
  } catch { return null; }
};

/**
 * Union the bullet lines of several MEMORIES.md versions. A curated
 * memory file is a flat list, so a line-level union is lossless by
 * construction — every fact from every old copy survives, de-duplicated,
 * in first-seen order, under a single header.
 */
function mergeMemories(versions: string[]): string {
  const header: string[] = [];
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const v of versions) {
    for (const raw of v.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const key = line.trim().toLowerCase();
      if (line.trim().startsWith('-')) {
        if (!seen.has(key)) { seen.add(key); bullets.push(line); }
      } else if (!seen.has(key)) {
        seen.add(key);
        header.push(line); // narrative/header lines keep their first appearance
      }
    }
  }
  return [...header, ...bullets].join('\n') + '\n';
}

/**
 * Ensure one identity file exists at its durable location, migrating any
 * pre-move content exactly once. Never overwrites an existing durable
 * file. Content that exists but isn't chosen is written beside the target
 * as a .bak rather than dropped, so a migration can always be audited.
 */
function ensureFile(target: string, fileName: string, starter: string, isList: boolean): MigrationReport {
  const report: MigrationReport = { file: target, action: 'created-fresh', sources: [], backups: [], bytes: 0 };
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const existing = readIfContent(target);
  if (existing !== null) {
    return { ...report, action: 'already-present', bytes: Buffer.byteLength(existing, 'utf8') };
  }

  // Gather every pre-move copy that actually holds content.
  const found = legacyCandidates(fileName)
    .map((c) => ({ ...c, content: readIfContent(c.file) }))
    .filter((c): c is { label: string; file: string; content: string } => c.content !== null);

  if (found.length === 0) {
    fs.writeFileSync(target, starter, { encoding: 'utf8', flag: 'wx' });
    return { ...report, action: 'created-fresh', bytes: Buffer.byteLength(starter, 'utf8') };
  }

  let content: string;
  if (isList && found.length > 1) {
    // MEMORIES.md: keep EVERY fact from EVERY old copy.
    content = mergeMemories(found.map((f) => f.content));
    report.sources = found.map((f) => f.label);
  } else {
    // LUMEN.md (prose — merging would corrupt it): prefer real user content
    // over the auto-generated starter, then the longer version.
    const ranked = [...found].sort((a, b) => {
      const aStarter = a.content.trim() === starter.trim() ? 1 : 0;
      const bStarter = b.content.trim() === starter.trim() ? 1 : 0;
      if (aStarter !== bStarter) return aStarter - bStarter;      // non-starter wins
      return b.content.length - a.content.length;                  // then the richer one
    });
    content = ranked[0].content;
    report.sources = [ranked[0].label];
    // Anything not chosen but genuinely different is preserved, not lost.
    for (const other of ranked.slice(1)) {
      if (other.content.trim() === content.trim()) continue;
      const bak = path.join(path.dirname(target), `${fileName}.${other.label.replace(/[\\/]/g, '-')}.bak`);
      try { fs.writeFileSync(bak, other.content, 'utf8'); report.backups.push(bak); } catch { /* best-effort */ }
    }
  }

  fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  return { ...report, action: 'migrated', bytes: Buffer.byteLength(content, 'utf8') };
}

/** Ensure LUMEN.md exists at its durable home, migrating if needed. */
export function ensureIdentityFile(): MigrationReport {
  return ensureFile(identityFilePath(), 'LUMEN.md', STARTER_IDENTITY, false);
}

/** Ensure MEMORIES.md exists at its durable home, migrating if needed. */
export function ensureMemoriesFile(): MigrationReport {
  return ensureFile(memoriesFilePath(), 'MEMORIES.md', STARTER_MEMORIES, true);
}
