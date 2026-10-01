import { useState, useEffect, useCallback, useRef } from 'react';
import { notesApi } from '@/services/api';
import type { Note } from '@/types';

/** How long the editor waits after the last keystroke before saving. */
const AUTOSAVE_MS = 700;

/** A single note's unsaved fields. */
type NotePatch = { title?: string; content?: string };

// Keep unsaved text within this browser tab when Notes unmounts. Separate
// drafts retain fields while their pending request is already on the wire.
const sessionPending = new Map<string, NotePatch>();
const sessionDrafts = new Map<string, NotePatch>();
const deletedNoteIds = new Set<string>();
const sessionFlight: { current: Promise<boolean> | null } = { current: null };
let sessionSaveError: string | null = null;
let unloadWarningInstalled = false;

function ensureUnsavedWarning() {
  if (unloadWarningInstalled) return;
  window.addEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (sessionDrafts.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });
  unloadWarningInstalled = true;
}

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
  const pending   = useRef(sessionPending);
  const deletedIds = useRef(deletedNoteIds);
  /** False once unmounted — stops a failed save scheduling a dead retry. */
  const alive     = useRef(true);
  const askAbort  = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Recovery can save faster than this GET resolves. Keep its initial
    // draft snapshot so a stale list response cannot undo the recovered UI.
    const recovering = new Map(sessionDrafts);
    try {
      const data = await notesApi.list();
      setNotes(data.map(note => ({ ...note, ...recovering.get(note.id), ...sessionDrafts.get(note.id) })));
      setSaving(sessionDrafts.size > 0);
      setError(sessionSaveError);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only hit the API once the user actually opens Notes — the Chat page
  // shouldn't fetch a list nobody is looking at.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    if (sessionDrafts.size > 0) {
      for (const [id, patch] of sessionDrafts) {
        pending.current.set(id, { ...patch, ...pending.current.get(id) });
      }
      setSaving(true);
      void flushRef.current();
    }
  }, [enabled, refresh]);

  /** Write every queued edit now. Safe to call when nothing is queued. */
  const flush = useCallback((): Promise<boolean> => {
    if (sessionFlight.current) {
      // A previous Notes instance may still be finishing its request.
      return sessionFlight.current.then(saved => {
        if (alive.current) {
          setSaving(sessionDrafts.size > 0);
          setError(sessionSaveError);
          if (pending.current.size > 0) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => void flushRef.current(), saved ? AUTOSAVE_MS : AUTOSAVE_MS * 4);
          }
        }
        return saved;
      });
    }
    if (pending.current.size === 0) return Promise.resolve(true);
    // Take the whole queue; anything that fails goes straight back in.
    const jobs = [...pending.current.entries()];
    pending.current.clear();
    let failed = false;
    const operation = (async () => {
      try {
        for (const [id, patch] of jobs) {
          if (deletedIds.current.has(id)) continue;
          try {
            const saved = await notesApi.update(id, patch);
            const draft = sessionDrafts.get(id);
            if (draft) {
              const remaining = { ...draft };
              if (patch.title !== undefined && remaining.title === patch.title) delete remaining.title;
              if (patch.content !== undefined && remaining.content === patch.content) delete remaining.content;
              if (Object.keys(remaining).length > 0) sessionDrafts.set(id, remaining);
              else sessionDrafts.delete(id);
            }
            // Preserve text typed while the request was in flight.
            setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt: saved.updatedAt } : n)));
          } catch (err) {
            if (deletedIds.current.has(id)) continue;
            // Retain the failed edit underneath any newer queued fields.
            failed = true;
            pending.current.set(id, { ...patch, ...pending.current.get(id) });
            sessionSaveError = err instanceof Error ? err.message : 'Failed to save the note';
            setError(sessionSaveError);
          }
        }
      } finally {
        sessionFlight.current = null;
        if (!failed && pending.current.size === 0) sessionSaveError = null;
        setSaving(sessionDrafts.size > 0);
        setError(sessionSaveError);
        // Back off on failures; otherwise resume the normal autosave cadence.
        if (alive.current && pending.current.size > 0) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(
            () => void flushRef.current(),
            failed ? AUTOSAVE_MS * 4 : AUTOSAVE_MS,
          );
        } else if (!alive.current && !failed && pending.current.size > 0) {
          // Cleanup may have happened while the previous save was in flight.
          // Drain edits typed during that save even after the editor closes.
          void flushRef.current();
        }
      }
      return !failed;
    })();
    sessionFlight.current = operation;
    return operation;
  }, []);

  // Leaving Notes mid-keystroke must not drop the last edit.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    // StrictMode replays cleanup/setup; restore this flag on every setup.
    alive.current = true;
    // Retain the warning after Notes closes: its failed drafts live in
    // this tab's session queue until a remount can save them.
    ensureUnsavedWarning();
    return () => {
      alive.current = false;
      window.clearTimeout(saveTimer.current);
      void flushRef.current();
      askAbort.current?.abort();
    };
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
    const unsaved = pending.current.get(id);
    pending.current.delete(id);
    if (pending.current.size === 0) { window.clearTimeout(saveTimer.current); setSaving(false); }
    try {
      await notesApi.remove(id);
      deletedIds.current.add(id);
      pending.current.delete(id);
      sessionDrafts.delete(id);
      if (pending.current.size === 0) { window.clearTimeout(saveTimer.current); setSaving(false); }
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setActive((cur) => (cur === id ? null : cur));
      setError(null);
    } catch (err) {
      if (unsaved) {
        pending.current.set(id, { ...unsaved, ...pending.current.get(id) });
        setSaving(true);
        saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
      }
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
    if (askAbort.current || deletedIds.current.has(id)) return;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    window.clearTimeout(saveTimer.current);
    // Each note keeps its own slot, so an edit to a DIFFERENT note stays
    // queued instead of being fire-and-forget flushed (and lost if that
    // request failed) to make room for this one.
    pending.current.set(id, { ...pending.current.get(id), ...patch });
    sessionDrafts.set(id, { ...sessionDrafts.get(id), ...patch });
    setSaving(true);
    saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  /**
   * Ask Lumen about a highlighted passage. Any queued edit is written
   * first — retaining failed writes — so the server reasons about the
   * text on screen and no stale save can later clobber the answer that
   * comes back.
   */
  const ask = async (id: string, selection: string, question?: string): Promise<string | null> => {
    if (askAbort.current) return null;
    window.clearTimeout(saveTimer.current);
    const controller = new AbortController();
    askAbort.current = controller;
    setAsking(selection);
    setError(null);
    try {
      // Wait for an existing write, then flush anything typed since it
      // began. A failed write stays queued and prevents research using
      // stale text; no second full-note PATCH can race the autosave.
      do {
        const saved = await flush();
        if (!saved && pending.current.has(id)) return null;
        if (controller.signal.aborted) return null;
      } while (pending.current.has(id));
      if (controller.signal.aborted) return null;
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
