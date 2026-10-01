// ============================================================
// SqliteMemoryProvider — Persistent IMemoryProvider on SQLite.
//
// One file DB (better-sqlite3) holds long-term memories and the
// agent loop's paused turns. Memories carry a real embedding vector
// (from the Ollama embeddings model); semantic search embeds the
// query and ranks by cosine similarity in JS — no substring matching,
// and no fabricated results when embeddings are unavailable.
//
// better-sqlite3 ships no types; rather than pull a second dependency
// we describe the tiny surface we use. It is a synchronous, in-process
// driver, so all DB calls here are sync.
// ============================================================

import { randomUUID } from 'crypto';
import type {
  IMemoryProvider,
  MemoryEntry,
  MemoryQuery,
  MemoryWriteResult,
} from '../../core/types/IMemoryProvider';
import { Logger } from '../../core/logger/Logger';

// ── Minimal better-sqlite3 typing (no @types dependency) ──────
interface RunResult { changes: number; lastInsertRowid: number | bigint; }
interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
export interface SqliteDatabase {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
}
interface SqliteConstructor { new (path: string, options?: Record<string, unknown>): SqliteDatabase; }
const Database = require('better-sqlite3') as SqliteConstructor;

const logger = Logger.scope('SqliteMemoryProvider');

/** Embeds text to a vector, or null when embeddings are unavailable. */
export type Embedder = (text: string) => Promise<number[] | null>;

/**
 * Open (creating if needed) the Luminary DB and ensure the schema.
 * `conversations` is intentionally omitted — those are already
 * persisted by ChatService to conversations.json.
 */
export function openDatabase(dbPath: string): SqliteDatabase {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      agentId    TEXT NOT NULL,
      agentName  TEXT NOT NULL,
      embedding  TEXT,            -- JSON number[] or NULL when unavailable
      importance TEXT NOT NULL,
      tags       TEXT NOT NULL,   -- JSON string[]
      createdAt  TEXT NOT NULL,
      expiresAt  TEXT
    );
    CREATE TABLE IF NOT EXISTS pending_turns (
      id        TEXT PRIMARY KEY, -- confirmation token
      state     TEXT NOT NULL,    -- JSON frozen turn state
      expiresAt INTEGER NOT NULL  -- epoch ms
    );
  `);
  logger.info(`SQLite ready at ${dbPath}`);
  return db;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Fallback relevance floor when MEMORY_MIN_SIMILARITY isn't set (or isn't
// a valid number). For nomic-embed-text, genuinely related short texts
// (paraphrases, same-topic facts) typically score ~0.55–0.8+ cosine
// similarity; unrelated/off-topic text commonly lands ~0.2–0.45. 0.5 sits
// just above that "unrelated" band — conservative enough to actually
// filter noise without being so strict it rejects real paraphrases. Other
// embedding models may need a different value, hence the env override.
export const FALLBACK_MIN_SIMILARITY = 0.5;

/**
 * Env-tunable relevance floor, read lazily (NOT cached at module load):
 * this file can be imported — and evaluated — before dotenv has loaded
 * .env into process.env (server.ts imports Kernel, which imports this
 * module, before it calls dotenv.config()). Reading inside the function
 * that's actually called at request time guarantees the real, loaded
 * value is used regardless of import order.
 */
export function minSimilarityFloor(): number {
  if (!process.env.MEMORY_MIN_SIMILARITY?.trim()) return FALLBACK_MIN_SIMILARITY;
  const parsed = Number(process.env.MEMORY_MIN_SIMILARITY);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : FALLBACK_MIN_SIMILARITY;
}

export class SqliteMemoryProvider implements IMemoryProvider {
  readonly id = 'sqlite';
  readonly name = 'SQLite Memory Provider';

  constructor(private readonly db: SqliteDatabase, private readonly embed: Embedder) {}

  async write(entry: Omit<MemoryEntry, 'id'>): Promise<MemoryWriteResult> {
    const id = randomUUID();
    // Real embedding or nothing — never a placeholder vector.
    const vector = await this.embed(entry.content);
    if (!vector) logger.warn(`Stored memory ${id} without an embedding (embeddings unavailable) — it won't surface in semantic search until re-embedded.`);
    this.db.prepare(
      `INSERT INTO memories (id, type, content, agentId, agentName, embedding, importance, tags, createdAt, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      entry.type,
      entry.content,
      entry.agentId,
      entry.agentName,
      vector ? JSON.stringify(vector) : null,
      entry.importance,
      JSON.stringify(entry.tags ?? []),
      entry.createdAt,
      entry.expiresAt ?? null,
    );
    return { id, success: true };
  }

  async read(id: string): Promise<MemoryEntry | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    if (!row) return null;
    const entry = this.rowToEntry(row); // null on corrupt JSON — already logged
    if (!entry) return null;
    return this.isExpired(entry) ? null : entry;
  }

  async query(params: MemoryQuery): Promise<MemoryEntry[]> {
    // Scalar filters in SQL; tags + semantic in JS.
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (params.type)       { clauses.push('type = ?');       args.push(params.type); }
    if (params.agentId)    { clauses.push('agentId = ?');    args.push(params.agentId); }
    if (params.importance) { clauses.push('importance = ?'); args.push(params.importance); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const now = Date.now();
    let rows = this.db.prepare(`SELECT * FROM memories ${where}`).all(...args)
      .map((r) => this.rowToEntry(r))
      .filter((e): e is MemoryEntry => e !== null) // drop corrupt rows — already logged
      .filter((e) => !this.isExpired(e, now));

    if (params.tags?.length) {
      rows = rows.filter((e) => params.tags!.some((t) => e.tags.includes(t)));
    }

    // ── Real semantic search ──
    if (params.semantic) {
      const queryVector = await this.embed(params.semantic);
      if (!queryVector) {
        // Can't rank without a query vector — return nothing rather than
        // fall back to a fake match. Honest empty result.
        logger.warn('Semantic query requested but embeddings are unavailable — returning no results.');
        return [];
      }
      // A caller-supplied minScore wins; otherwise fall back to the
      // env-tunable floor. Applied here, in the ONE shared query path
      // both automatic memory injection and explicit recall() go
      // through — below the floor, an entry is dropped, never padded in
      // just to fill out a top-K count.
      const floor = params.minScore ?? minSimilarityFloor();
      const scored = rows
        .filter((e) => Array.isArray(e.embedding) && e.embedding.length === queryVector.length)
        .map((e) => ({ entry: e, score: cosineSimilarity(queryVector, e.embedding!) }))
        .filter((s) => s.score >= floor)
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, params.limit ?? 100).map((s) => s.entry);
    }

    // Non-semantic: most recent first.
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows.slice(0, params.limit ?? 100);
  }

  async update(id: string, patch: Partial<MemoryEntry>): Promise<boolean> {
    const existing = await this.read(id);
    if (!existing) return false;

    let vector: number[] | null = existing.embedding ?? null;
    if (patch.content !== undefined) {
      const reEmbedded = await this.embed(patch.content);
      if (!reEmbedded) {
        // Re-embedding the new content failed (e.g. Ollama unreachable).
        // Refuse the whole update rather than write new content with a
        // null/stale-mismatched embedding — that would silently break
        // (or corrupt) this memory's semantic search. Honest failure: the
        // existing row, embedding included, is left completely untouched.
        logger.warn(`update(${id}) refused: re-embedding failed for the new content — existing embedding left untouched.`);
        return false;
      }
      vector = reEmbedded;
    }

    const merged: MemoryEntry = { ...existing, ...patch, id };
    this.db.prepare(
      `UPDATE memories SET type=?, content=?, agentId=?, agentName=?, embedding=?, importance=?, tags=?, createdAt=?, expiresAt=? WHERE id=?`,
    ).run(
      merged.type, merged.content, merged.agentId, merged.agentName,
      vector ? JSON.stringify(vector) : null,
      merged.importance, JSON.stringify(merged.tags ?? []), merged.createdAt, merged.expiresAt ?? null, id,
    );
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
  }

  async count(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get();
    return Number(row?.n ?? 0);
  }

  async healthCheck(): Promise<{ status: 'ok' | 'error'; message?: string }> {
    try {
      const n = await this.count();
      return { status: 'ok', message: `${n} memories (SQLite)` };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Delete every expired memory row. Returns how many were removed.
   * expiresAt is stored as an ISO-8601 string, which sorts/compares
   * correctly as plain text — no date parsing needed in SQL.
   */
  evictExpired(): number {
    const nowIso = new Date().toISOString();
    return this.db.prepare('DELETE FROM memories WHERE expiresAt IS NOT NULL AND expiresAt <= ?').run(nowIso).changes;
  }

  // ── helpers ─────────────────────────────────────────────────

  /**
   * Parse a raw DB row into a MemoryEntry. Returns null (never throws) if
   * the embedding or tags column holds unparseable JSON — a single
   * corrupt row (partial write, manual DB edit, disk corruption) must
   * never take down a whole query()/read(); callers drop nulls.
   */
  private rowToEntry(row: Record<string, unknown>): MemoryEntry | null {
    let embedding: number[] | undefined;
    let tags: string[];
    try {
      embedding = row.embedding ? (JSON.parse(String(row.embedding)) as number[]) : undefined;
      tags = row.tags ? (JSON.parse(String(row.tags)) as string[]) : [];
      if (!Array.isArray(tags) || !tags.every(t => typeof t === 'string') ||
          (embedding !== undefined && (!Array.isArray(embedding) || !embedding.every(n => typeof n === 'number' && Number.isFinite(n))))) {
        return null;
      }
    } catch (err) {
      logger.warn(`Skipping corrupt memory row id=${String(row.id)}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    return {
      id: String(row.id),
      type: row.type as MemoryEntry['type'],
      content: String(row.content),
      agentId: String(row.agentId),
      agentName: String(row.agentName),
      embedding,
      importance: row.importance as MemoryEntry['importance'],
      tags,
      createdAt: String(row.createdAt),
      expiresAt: row.expiresAt ? String(row.expiresAt) : undefined,
    };
  }

  private isExpired(entry: MemoryEntry, now = Date.now()): boolean {
    return entry.expiresAt !== undefined && new Date(entry.expiresAt).getTime() <= now;
  }
}

/**
 * Persistent store for paused tool-loop turns, on the same DB. Keyed by
 * confirmation token; values are opaque JSON (BaseAgent owns the shape).
 * Structurally satisfies BaseAgent's PendingTurnStore interface.
 */
export class SqlitePendingTurnStore {
  constructor(private readonly db: SqliteDatabase) {}

  put(id: string, json: string, expiresAt: number): void {
    this.db.prepare('INSERT OR REPLACE INTO pending_turns (id, state, expiresAt) VALUES (?, ?, ?)').run(id, json, expiresAt);
  }

  get(id: string): string | null {
    const row = this.db.prepare('SELECT state, expiresAt FROM pending_turns WHERE id = ?').get(id);
    if (!row) return null;
    if (Number(row.expiresAt) <= Date.now()) { this.deleteMany([id]); return null; }
    return String(row.state);
  }

  deleteMany(ids: string[]): void {
    const stmt = this.db.prepare('DELETE FROM pending_turns WHERE id = ?');
    for (const id of ids) stmt.run(id);
  }

  /** Delete every expired pending-turn row. Returns how many were removed. */
  evictExpired(): number {
    return this.db.prepare('DELETE FROM pending_turns WHERE expiresAt <= ?').run(Date.now()).changes;
  }
}
