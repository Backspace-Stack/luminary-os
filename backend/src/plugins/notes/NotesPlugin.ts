// ============================================================
// NotesPlugin — The user's notes, as real tools.
//
// This is what makes "add this to my notes" work mid-conversation: the
// model CALLS a tool, exactly like MemoryPlugin's remember/recall. There
// is no string matching anywhere — if the model never calls createNote
// or appendToNote, nothing is written, and the user sees no note.
//
//   • listNotes()                     — see which notes already exist.
//   • createNote(title, content)      — start a new note.
//   • appendToNote(noteId, content)   — add to an existing one.
//
// All three are non-destructive writes to the user's own scratch space
// (nothing is overwritten or deleted), so requiresConfirmation is false
// and they run inline without pausing the turn.
// ============================================================

import { BasePlugin } from '../BasePlugin';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';
import { notesService, NotesError } from '../../services/NotesService';

/** Preview length for note content echoed back in listNotes results. */
const PREVIEW_CHARS = 140;

export class NotesPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'notes-plugin',
    name: 'Notes Plugin',
    version: '0.1.0',
    description: "Create and add to the user's notes.",
    capabilities: [
      {
        action: 'listNotes',
        description:
          "List the user's existing notes (id, title, when updated, and a short preview). " +
          'Call this first when they ask to add something to "my notes" and you need to find ' +
          'which existing note it belongs in.',
        inputSchema: { type: 'object', properties: {} },
        requiresConfirmation: false,
      },
      {
        action: 'createNote',
        description:
          'Create a new note with a title and content. Use this when the user asks to save ' +
          'something to their notes and no existing note is clearly the right home for it — ' +
          'give it a short title drawn from what the note is actually about.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the note, drawn from its subject.' },
            content: { type: 'string', description: 'The full text to save in the note.' },
          },
          required: ['title', 'content'],
        },
        requiresConfirmation: false,
      },
      {
        action: 'appendToNote',
        description:
          'Append text to the end of an existing note, separated by a blank line. Requires the ' +
          "note's id — get it from listNotes. Use this when the user points at a note they " +
          'already have ("add this to my Rust notes") rather than asking for a new one.',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'The id of the note to append to (from listNotes).' },
            content: { type: 'string', description: 'The text to append.' },
          },
          required: ['noteId', 'content'],
        },
        requiresConfirmation: false,
      },
    ],
  };

  protected async onInitialize(): Promise<void> {
    this.logger.info('NotesPlugin ready (listNotes / createNote / appendToNote)');
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    switch (action.action) {
      case 'listNotes':     return this.listNotes(action);
      case 'createNote':    return this.createNote(action);
      case 'appendToNote':  return this.appendToNote(action);
      default:              return this.notImplemented(action.action);
    }
  }

  private async listNotes(action: PluginAction): Promise<PluginResult> {
    try {
      const notes = notesService.list();
      this.logger.info(`listNotes -> ${notes.length} note(s)`, { requestId: action.requestId });
      return {
        success: true,
        data: {
          notes: notes.map((n) => ({
            id: n.id,
            title: n.title,
            updatedAt: n.updatedAt,
            preview: n.content.length > PREVIEW_CHARS ? `${n.content.slice(0, PREVIEW_CHARS)}…` : n.content,
          })),
          noteCount: notes.length,
        },
      };
    } catch (err) {
      return this.failure('List notes', err);
    }
  }

  private async createNote(action: PluginAction): Promise<PluginResult> {
    const content = asText(action.payload.content);
    if (!content) return { success: false, error: 'createNote requires a non-empty "content" string.' };
    const title = asText(action.payload.title);
    if (!title) return { success: false, error: 'createNote requires a non-empty "title" string.' };

    try {
      const note = notesService.create(title, content);
      this.logger.info(`created note ${note.id} ("${note.title}")`, { requestId: action.requestId });
      return { success: true, data: { id: note.id, title: note.title, created: true } };
    } catch (err) {
      return this.failure('Create note', err);
    }
  }

  private async appendToNote(action: PluginAction): Promise<PluginResult> {
    const noteId = asText(action.payload.noteId);
    if (!noteId) return { success: false, error: 'appendToNote requires a "noteId" string — call listNotes to find one.' };
    const content = asText(action.payload.content);
    if (!content) return { success: false, error: 'appendToNote requires a non-empty "content" string.' };

    try {
      const note = notesService.append(noteId, content);
      this.logger.info(`appended to note ${note.id} ("${note.title}")`, { requestId: action.requestId });
      return { success: true, data: { id: note.id, title: note.title, appended: true, length: note.content.length } };
    } catch (err) {
      return this.failure('Append to note', err);
    }
  }

  /** Uniform, honest failure — a NotesError message reaches the model verbatim. */
  private failure(what: string, err: unknown): PluginResult {
    const message = err instanceof NotesError || err instanceof Error ? err.message : String(err);
    return { success: false, error: `${what} failed: ${message}` };
  }
}

/** Payload values arrive untyped from the model — coerce and trim. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
