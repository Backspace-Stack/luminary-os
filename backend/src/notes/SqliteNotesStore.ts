// ============================================================
// SqliteNotesStore — User notes on the shared SQLite DB.
//
// Reuses the same database handle the memory layer opened (one new
// `notes` table, created idempotently here), so notes live in the very
// same luminary.db file as memories, secrets and paused turns — one
// file to back up, one file to move.
//
// Notes are the user's own scratch space: plain text in, plain text
// out. Nothing here rewrites, summarises or embeds content.
// ============================================================

import { randomUUID } from 'crypto';
import type { SqliteDatabase } from '../memory/providers/SqliteMemoryProvider';

export interface Note {
  id: string;
  title: string;
  content: string;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 */
  updatedAt: string;
}

/** Minimal structural interface a notes store must satisfy. */
export interface NotesStore {
  list(): Note[];
  get(id: string): Note | null;
  create(title: string, content: string): Note;
  update(id: string, patch: { title?: string; content?: string }): Note | null;
  delete(id: string): boolean;
}

export class SqliteNotesStore implements NotesStore {
  constructor(private readonly db: SqliteDatabase) {
    // One new table on the existing DB. Idempotent, so booting against
    // an older DB simply adds it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id        TEXT PRIMARY KEY,
        title     TEXT NOT NULL,
        content   TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  /** Every note, most recently updated first. */
  list(): Note[] {
    return this.db
      .prepare('SELECT * FROM notes ORDER BY updatedAt DESC')
      .all()
      .map((r) => this.rowToNote(r));
  }

  get(id: string): Note | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    return row ? this.rowToNote(row) : null;
  }

  create(title: string, content: string): Note {
    const now = new Date().toISOString();
    const note: Note = { id: randomUUID(), title, content, createdAt: now, updatedAt: now };
    this.db
      .prepare('INSERT INTO notes (id, title, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(note.id, note.title, note.content, note.createdAt, note.updatedAt);
    return note;
  }

  /**
   * Patch title and/or content. Returns the saved note, or null when no
   * note with that id exists — the caller decides what a miss means.
   */
  update(id: string, patch: { title?: string; content?: string }): Note | null {
    // One atomic statement with COALESCE, NOT read-then-write. The old
    // read-modify-write raced: the editor autosaves every 700ms while
    // "Ask Lumen" splices research into the same note server-side, and
    // whichever read first overwrote the other's field wholesale.
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        UPDATE notes
           SET title     = COALESCE(?, title),
               content   = COALESCE(?, content),
               updatedAt = ?
         WHERE id = ?
      `)
      .run(patch.title ?? null, patch.content ?? null, now, id);
    if (result.changes === 0) return null; // unknown id — caller decides
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes > 0;
  }

  private rowToNote(row: Record<string, unknown>): Note {
    return {
      id: String(row.id),
      title: String(row.title),
      content: String(row.content),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }
}
