// ============================================================
// NotesService — CRUD over the user's notes.
//
// Thin business layer on a NotesStore (SQLite, same DB file as
// memories — see notes/SqliteNotesStore). It owns the small rules the
// store shouldn't: title defaulting, trimming, and honest failures when
// storage isn't up yet.
//
// It never invents a note and never silently swallows a miss: a missing
// id raises NotesError(404) so routes and plugins report the truth.
// ============================================================

import type { Note, NotesStore } from '../notes/SqliteNotesStore';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('NotesService');

/** Fallback title when the caller supplies none. */
export const UNTITLED_NOTE = 'Untitled note';
/** Longest title we store — long enough for a sentence, short enough for a list row. */
const MAX_TITLE_LENGTH = 120;

export class NotesError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'NotesError';
  }
}

export class NotesService {
  private store: NotesStore | null = null;

  /** Kernel calls this at boot, once the shared SQLite handle is open. */
  setStore(store: NotesStore): void {
    this.store = store;
    logger.info('Notes store attached (SQLite)');
  }

  /**
   * The store, or an honest 503. Notes are persistent by definition —
   * falling back to an in-memory stand-in would accept writes and then
   * lose them at exit, which is worse than refusing.
   */
  private requireStore(): NotesStore {
    if (!this.store) {
      throw new NotesError('Notes storage is not ready — the database has not been opened yet.', 503);
    }
    return this.store;
  }

  list(): Note[] {
    return this.requireStore().list();
  }

  /** Throws NotesError(404) when the id is unknown. */
  get(id: string): Note {
    const note = this.requireStore().get(id);
    if (!note) throw new NotesError(`Note "${id}" not found`, 404);
    return note;
  }

  create(title?: string, content?: string): Note {
    const note = this.requireStore().create(normaliseTitle(title), content ?? '');
    logger.info(`Note created: ${note.id} ("${note.title}")`);
    return note;
  }

  update(id: string, patch: { title?: string; content?: string }): Note {
    const clean: { title?: string; content?: string } = {};
    if (patch.title !== undefined) clean.title = normaliseTitle(patch.title);
    if (patch.content !== undefined) clean.content = patch.content;
    const note = this.requireStore().update(id, clean);
    if (!note) throw new NotesError(`Note "${id}" not found`, 404);
    return note;
  }

  /**
   * Append a block of text to a note's content, separated by a blank
   * line. Returns the saved note. Throws NotesError(404) if unknown.
   */
  append(id: string, text: string): Note {
    const body = text.trim();
    if (!body) throw new NotesError('Nothing to append — the text was empty.');
    const existing = this.get(id);
    const sep = existing.content.trim().length === 0 ? '' : '\n\n';
    return this.update(id, { content: `${existing.content}${sep}${body}` });
  }

  remove(id: string): void {
    const ok = this.requireStore().delete(id);
    if (!ok) throw new NotesError(`Note "${id}" not found`, 404);
    logger.info(`Note deleted: ${id}`);
  }
}

/** Trim, collapse newlines, cap length, and fall back to a real default. */
function normaliseTitle(raw?: string): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return UNTITLED_NOTE;
  return t.length > MAX_TITLE_LENGTH ? `${t.slice(0, MAX_TITLE_LENGTH - 1)}…` : t;
}

export const notesService = new NotesService();
