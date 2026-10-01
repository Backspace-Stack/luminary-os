// ============================================================
// NoteAskService — "Ask Lumen" about a passage inside a note.
//
// The user highlights a passage in one of their notes and asks about
// it. That question goes to the Research Agent — ALWAYS Deep Research,
// so real web search is on the table — through the SAME BaseAgent
// .execute() loop chat uses. There is no parallel pipeline here: this
// module only composes the prompt, calls execute(), and splices the
// real answer back into the note.
//
// Honesty rules:
//   • The answer written into the note is whatever the agent actually
//     returned. Nothing is synthesised here.
//   • If the loop pauses for confirmation, or comes back empty, the
//     note is left completely untouched and the caller gets a real
//     error — never a placeholder answer.
//   • The passage must still be present in the note; if the user has
//     edited it away, we refuse rather than guess where it went.
// ============================================================

import { randomUUID } from 'crypto';
import { agentRegistry } from '../core/registry/AgentRegistry';
import type { BaseAgent } from '../agents/BaseAgent';
import type { Note } from '../notes/SqliteNotesStore';
import { notesService, NotesError } from './NotesService';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('NoteAskService');

/** Deep Research, every time — the spec for this feature, not a default. */
const RESEARCH_AGENT_ID = 'research-agent';

/** Used when the user clicks "Ask Lumen" without typing a question. */
export const DEFAULT_NOTE_QUESTION =
  'Explain this passage and add any important context I should know about it.';

/** Marker that opens every inserted answer — the user's own writing never starts this way. */
const ANSWER_PREFIX = '> **Lumen:**';

export interface AskNoteResult {
  note: Note;
  /** The agent's real answer, as inserted. */
  answer: string;
  agentName: string;
  model?: string;
  durationMs?: number;
}

export class NoteAskService {
  /**
   * Ask the Research Agent about `selection` within note `noteId`, then
   * insert the answer directly beneath that passage and save.
   */
  async ask(noteId: string, selection: string, question?: string, signal?: AbortSignal): Promise<AskNoteResult> {
    const passage = selection.trim();
    if (!passage) throw new NotesError('"selection" must be a non-empty passage from the note.');

    const note = notesService.get(noteId); // throws NotesError(404) when unknown

    // Locate the passage BEFORE spending a research turn on it, so an
    // already-edited note fails fast instead of after several minutes.
    const insertAt = findInsertionPoint(note.content, passage);
    if (insertAt === null) {
      throw new NotesError(
        'That passage is no longer in the note — it may have been edited since you selected it. Select it again and retry.',
        409,
      );
    }

    const agent = agentRegistry.findById(RESEARCH_AGENT_ID) as BaseAgent | undefined;
    if (!agent) throw new NotesError(`The Research Agent ("${RESEARCH_AGENT_ID}") is not registered.`, 503);

    const asked = (question ?? '').trim() || DEFAULT_NOTE_QUESTION;
    logger.info(`Ask Lumen on note ${noteId} (${passage.length} char passage)`);

    // ── The one shared loop: identity, memory, tools, the confirmation
    //    gate — all of it applies here exactly as it does in chat. The
    //    sessionId is this note, which ChatService doesn't know, so
    //    loadPriorTurns() returns [] and the turn starts clean.
    const response = await agent.execute(
      {
        id: randomUUID(),
        sessionId: `note:${noteId}`,
        content: buildPrompt(note, passage, asked),
        timestamp: new Date().toISOString(),
      },
      { signal },
    );

    if (response.pendingConfirmations?.length) {
      const actions = response.pendingConfirmations.map((p) => `${p.plugin}.${p.action}`).join(', ');
      throw new NotesError(
        `Lumen paused for approval (${actions}) instead of answering, so nothing was written to the note. ` +
        'Ask this one in a chat, where you can approve the step.',
        409,
      );
    }

    const answer = response.content.trim();
    if (!answer) {
      throw new NotesError('Lumen returned an empty answer — the note was left unchanged.', 502);
    }

    const updated = notesService.update(noteId, {
      content: spliceAnswer(note.content, insertAt, answer),
    });
    logger.info(`Inserted a ${answer.length} char answer into note ${noteId}`);

    return {
      note: updated,
      answer,
      agentName: response.agentName,
      model: response.model,
      durationMs: response.durationMs,
    };
  }
}

/**
 * The prompt for one "Ask Lumen" turn. The whole note comes along as
 * context so the answer fits what the user is actually writing about,
 * with the highlighted passage called out as the subject.
 */
function buildPrompt(note: Note, passage: string, question: string): string {
  return [
    'The user is reading a note of their own and has highlighted a passage in it.',
    'Answer their question about that passage.',
    '',
    `## The note — "${note.title}"`,
    note.content,
    '',
    '## Highlighted passage',
    passage,
    '',
    '## Question',
    question,
    '',
    'Answer directly, grounded in the highlighted passage and the note above. Use the `search` tool ' +
    'for anything you cannot know from training alone (current events, recent facts, specifics you are ' +
    'unsure of) and cite the source URLs it returns; if a search fails, say so rather than guessing. ' +
    'Your answer is inserted straight into the user\'s note underneath the passage, so keep it tight — ' +
    'a few sentences or a short list. Do not restate the passage, do not add a heading, and do not use ' +
    'the note tools this turn: just answer.',
  ].join('\n');
}

/**
 * Character offset just past the line the passage ends on, or null if
 * the passage isn't in the content. Inserting at a line boundary (not
 * mid-sentence) keeps the quote block readable when the selection stops
 * partway through a line.
 *
 * Exported (with spliceAnswer) so the placement rules can be exercised
 * directly — they are pure, and proving them needs no model call.
 */
export function findInsertionPoint(content: string, passage: string): number | null {
  let start = content.indexOf(passage);
  let end = start === -1 ? -1 : start + passage.length;

  if (start === -1) {
    // A selection dragged across a soft-wrapped line can pick up
    // different whitespace than the source. Retry on a whitespace-
    // insensitive basis before giving up.
    const located = findLoose(content, passage);
    if (!located) return null;
    ({ start, end } = located);
  }

  const lineEnd = content.indexOf('\n', end);
  return lineEnd === -1 ? content.length : lineEnd;
}

/**
 * Locate `passage` in `content` ignoring differences in whitespace runs,
 * returning real offsets into `content`. Built by walking both strings
 * in step, so the returned indices stay exact.
 */
function findLoose(content: string, passage: string): { start: number; end: number } | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const target = norm(passage);
  if (!target) return null;

  // Map each character of the normalised content back to its index in
  // the original, then run a plain search on the normalised form.
  let flat = '';
  const backIndex: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (/\s/.test(ch)) { pendingSpace = flat.length > 0; continue; }
    if (pendingSpace) { flat += ' '; backIndex.push(i); pendingSpace = false; }
    flat += ch;
    backIndex.push(i);
  }

  const at = flat.indexOf(target);
  if (at === -1) return null;
  return { start: backIndex[at], end: backIndex[at + target.length - 1] + 1 };
}

/**
 * Insert the answer as a blockquote at `insertAt`, visually distinct
 * from the user's own writing so an inserted answer is never mistaken
 * for something they typed.
 */
export function spliceAnswer(content: string, insertAt: number, answer: string): string {
  const quoted = answer
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
  // One blank line after the block — but don't add a second when what
  // follows already opens with one (asking twice about the same passage
  // inserts ahead of the previous answer, which starts with "\n\n").
  const rest = content.slice(insertAt);
  const block = `\n\n${ANSWER_PREFIX}\n${quoted}${rest.startsWith('\n\n') ? '' : '\n'}`;
  return content.slice(0, insertAt) + block + rest;
}

export const noteAskService = new NoteAskService();
