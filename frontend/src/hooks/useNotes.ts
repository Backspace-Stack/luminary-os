import { useState, useEffect, useCallback, useRef } from 'react';
import { notesApi } from '@/services/api';
import type { Note } from '@/types';

/** How long the editor waits after the last keystroke before saving. */
const AUTOSAVE_MS = 700;

/** A single note's unsaved fields. */
type NotePatch = { title?: string; content?: string };

/**
 * useNotes — the Notes workspace's state: the list, the open note, and
 * the two writes that matter (autosaved edits, and Ask Lumen).
 *
 * Every value here comes from the backend. Nothing is optimistically
 * invented: a failed save surfaces as an error and the note on screen
 * stays exactly what the user typed, so no edit is silently lost.
 */
export function useNotes(enabled: boolean) {
  const [notes, setNotes]     = useState<Note[]>([]);
  const [activeId, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  /** Non-null while an Ask Lumen research turn is in flight. */
  const [asking, setAsking]   = useState<string | null>(null);

  const saveTimer = useRef<number | undefined>(undefined);
  /**
   * Edits waiting to be written, keyed by note id. A Map rather than a
   * single slot: switching notes mid-window used to fire-and-forget the
   * previous note's save and then overwrite the slot regardless of whether
   * that save actually landed.
   */
  const pending   = useRef<Map<string, NotePatch>>(new Map());
  /** True while a write is on the wire, so two saves never overlap. */
  const inFlight  = useRef(false);
  /** False once unmounted — stops a failed save scheduling a dead retry. */
  const alive     = useRef(true);
  const askAbort  = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await notesApi.list();
      setNotes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only hit the API once the user actually opens Notes — the Chat page
  // shouldn't fetch a list nobody is looking at.
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);

  /** Write every queued edit now. Safe to call when nothing is queued. */
  const flush = useCallback(async () => {
    if (inFlight.current || pending.current.size === 0) return;
    inFlight.current = true;
    // Take the whole queue; anything that fails goes straight back in.
    const jobs = [...pending.current.entries()];
    pending.current.clear();
    let failed = false;
    try {
      for (const [id, patch] of jobs) {
        try {
          const saved = await notesApi.update(id, patch);
          // Keep whatever is on screen — the user may have typed on since
          // this save was queued — but take the server's fresh updatedAt.
          setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt: saved.updatedAt } : n)));
          setError(null);
        } catch (err) {
          // Put the edit BACK, underneath anything typed since. It used to
          // be dropped before the request even went out, so one failed
          // request lost the patch permanently with only a toast to show.
          failed = true;
          pending.current.set(id, { ...patch, ...pending.current.get(id) });
          setError(err instanceof Error ? err.message : 'Failed to save the note');
        }
      }
    } finally {
      inFlight.current = false;
      setSaving(pending.current.size > 0);
      // Still queued: either a save failed, or the user typed while this
      // pass was on the wire. Back off after a failure so a dead backend
      // isn't hammered; otherwise resume at the normal autosave cadence.
      if (alive.current && pending.current.size > 0) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(
          () => void flushRef.current(),
          failed ? AUTOSAVE_MS * 4 : AUTOSAVE_MS,
        );
      }
    }
  }, []);

  // Leaving Notes mid-keystroke must not drop the last edit.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => {
    alive.current = false;
    window.clearTimeout(saveTimer.current);
    void flushRef.current();
    askAbort.current?.abort();
  }, []);

  const active = notes.find((n) => n.id === activeId) ?? null;

  const create = async () => {
    try {
      const note = await notesApi.create({ title: 'Untitled note', content: '' });
      setNotes((prev) => [note, ...prev]);
      setActive(note.id);
      setError(null);
      return note;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the note');
      return null;
    }
  };

  const remove = async (id: string) => {
    // Never resurrect a deleted note with a queued save.
    pending.current.delete(id);
    if (pending.current.size === 0) { window.clearTimeout(saveTimer.current); setSaving(false); }
    try {
      await notesApi.remove(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setActive((cur) => (cur === id ? null : cur));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the note');
    }
  };

  /**
   * Apply an edit locally at once (so typing never stutters) and save it
   * after a short pause. Fields ACCUMULATE while the timer runs — editing
   * the title and then the content within one window saves both, rather
   * than the later patch quietly replacing the earlier one.
   */
  const edit = (id: string, patch: NotePatch) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    window.clearTimeout(saveTimer.current);
    // Each note keeps its own slot, so an edit to a DIFFERENT note stays
    // queued instead of being fire-and-forget flushed (and lost if that
    // request failed) to make room for this one.
    pending.current.set(id, { ...pending.current.get(id), ...patch });
    setSaving(true);
    saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  /**
   * Ask Lumen about a highlighted passage. Any queued edit is written
   * first — and dropped from the queue — so the server reasons about the
   * text on screen and no stale save can later clobber the answer that
   * comes back.
   */
  const ask = async (id: string, selection: string, question?: string): Promise<string | null> => {
    window.clearTimeout(saveTimer.current);
    // Only THIS note's queued edit is superseded by the explicit write
    // below; other notes keep theirs.
    pending.current.delete(id);
    setSaving(pending.current.size > 0);
    askAbort.current?.abort();
    const controller = new AbortController();
    askAbort.current = controller;
    setAsking(selection);
    setError(null);
    try {
      const current = notes.find((n) => n.id === id);
      if (current) {
        await notesApi.update(id, { title: current.title, content: current.content });
        setSaving(false);
      }
      const result = await notesApi.ask(id, selection, question, controller.signal);
      setNotes((prev) => prev.map((n) => (n.id === id ? result.note : n)));
      return result.answer;
    } catch (err) {
      if (controller.signal.aborted) return null; // user cancelled — not an error
      setError(err instanceof Error ? err.message : 'Ask Lumen failed');
      return null;
    } finally {
      if (askAbort.current === controller) { askAbort.current = null; setAsking(null); }
    }
  };

  const cancelAsk = () => askAbort.current?.abort();

  return {
    notes, active, activeId, loading, error, saving, asking,
    setActive, create, remove, edit, ask, cancelAsk, refresh,
    clearError: () => setError(null),
  };
}
