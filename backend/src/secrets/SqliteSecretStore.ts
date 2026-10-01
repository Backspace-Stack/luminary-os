// ============================================================
// SqliteSecretStore — API keys / secrets on the shared SQLite DB.
//
// Reuses the same database handle the memory layer opened (one new
// `secrets` table, created idempotently here). Values are written and
// read but NEVER logged — no method here emits a value to the logger.
// ============================================================

import type { SqliteDatabase } from '../memory/providers/SqliteMemoryProvider';

/** Minimal structural interface a SecretStore must satisfy. */
export interface SecretStore {
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
}

export class SqliteSecretStore implements SecretStore {
  constructor(private readonly db: SqliteDatabase) {
    // One new table on the existing DB. Idempotent, so booting against an
    // older DB just adds it.
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        name      TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  get(name: string): string | null {
    const row = this.db.prepare('SELECT value FROM secrets WHERE name = ?').get(name);
    return row ? String(row.value) : null;
  }

  set(name: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO secrets (name, value, updatedAt) VALUES (?, ?, ?)')
      .run(name, value, new Date().toISOString());
  }

  delete(name: string): void {
    this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
  }
}
