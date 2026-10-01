// ============================================================
// JsonStore — Tiny file-backed JSON persistence.
//
// Used for state that must survive app restarts (conversations,
// agent→model assignments). Writes are atomic (tmp + rename) so
// a crash mid-write can never corrupt the store.
// ============================================================

import fs from 'fs';
import path from 'path';
import { Logger } from '../logger/Logger';

const logger = Logger.scope('JsonStore');

/** Root directory for persisted app state (backend/data by default). */
export function dataDir(): string {
  return process.env.LUMINARY_DATA_DIR ?? path.resolve(__dirname, '../../../data');
}

export class JsonStore<T> {
  private readonly filePath: string;

  constructor(fileName: string, private readonly fallback: T) {
    this.filePath = path.join(dataDir(), fileName);
  }

  /**
   * A FRESH copy of the fallback every time. Returning `this.fallback`
   * itself handed every caller the same object, so one caller pushing to
   * the returned array permanently mutated the store's default.
   */
  private freshFallback(): T {
    return structuredClone(this.fallback);
  }

  load(): T {
    try {
      if (!fs.existsSync(this.filePath)) return this.freshFallback();
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn(`Failed to read ${this.filePath} — starting fresh`, { error: String(err) });
      return this.freshFallback();
    }
  }

  /**
   * Persist atomically. Returns false when the write failed — callers used
   * to get `void` back and assume success, so a full disk lost data silently.
   */
  save(value: T): boolean {
    // Unique temp name: a fixed `${filePath}.tmp` meant two concurrent saves
    // interleaved their bytes into one file before either renamed it.
    const tmp = `${this.filePath}.${process.pid}.${++JsonStore.tmpSeq}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // fsync before rename: without it the rename can land ahead of the
      // data, which is exactly the corruption the tmp+rename is meant to
      // prevent. Only then is "a crash can never corrupt the store" true.
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this.filePath);
      return true;
    } catch (err) {
      logger.error(`Failed to write ${this.filePath}`, { error: String(err) });
      try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
      return false;
    }
  }

  private static tmpSeq = 0;
}
