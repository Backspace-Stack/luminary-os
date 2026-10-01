// ============================================================
// NotesView — the Notes workspace in Professional mode.
//
// Left: every note the user has, independent of each other (create,
// select, delete). Right: a freeform editor for the open one, which
// expands to fullscreen.
//
// Highlight any passage in the editor and a small "Ask Lumen" button
// appears beside it. Clicking it runs a REAL Deep Research turn on the
// server (web search included) and re-renders the note with the answer
// spliced in beneath the passage as a "> **Lumen:**" quote — visibly
// not the user's own writing. Nothing is inserted unless the research
// turn actually returned an answer.
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  NotebookPen, Plus, Trash2, Maximize2, Minimize2, X, Sparkles, Loader2, FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { springGentle } from '@/lib/motion';
import { useNotes } from '@/hooks/useNotes';

/** The Professional-mode surface palette, passed in from Chat. */
export interface ProPalette {
  railBg: string;
  chatBg: string;
  border: string;
  borderSoft: string;
  text: string;
  textSoft: string;
  textMute: string;
  hover: string;
  inputBg: string;
  inputBorder: string;
}

interface NotesViewProps {
  pro: ProPalette;
  /** Leave Notes and go back to the conversation. */
  onClose: () => void;
  /** Confirm before deleting a note (the real Settings preference). */
  confirmDelete: boolean;
}

/** A live text selection inside the editor, with where to float the button. */
interface Selection {
  text: string;
  /** Viewport coordinates for the floating button. */
  x: number;
  y: number;
}

export default function NotesView({ pro, onClose, confirmDelete }: NotesViewProps) {
  const {
    notes, active, activeId, loading, error, saving, asking,
    setActive, create, remove, edit, ask, cancelAsk, clearError,
  } = useNotes(true);

  const [fullscreen, setFullscreen] = useState(false);
  const [selection, setSelection]   = useState<Selection | null>(null);
  const [flash, setFlash]           = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Escape leaves fullscreen before it leaves Notes.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // A different note (or none) invalidates any pending selection.
  useEffect(() => { setSelection(null); }, [activeId]);

  /** Read the textarea's selection and park the button beside it. */
  const readSelection = useCallback(() => {
    const ta = editorRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const text = value.slice(start, end).trim();
    if (!text || start === end) { setSelection(null); return; }
    const point = caretViewportPoint(ta, end);
    setSelection({ text, x: point.x, y: point.y });
  }, []);

  const handleAsk = async () => {
    if (!activeId || !selection) return;
    const passage = selection.text;
    setSelection(null);
    const answer = await ask(activeId, passage);
    if (answer) {
      setFlash('Lumen answered — the reply is in your note.');
      window.setTimeout(() => setFlash(null), 4000);
    }
  };

  const handleDelete = (id: string, title: string) => {
    if (!confirmDelete || window.confirm(`Delete "${title}" permanently?`)) void remove(id);
  };

  // ── The note list (hidden while fullscreen) ─────────────────
  const listPanel = (
    <div
      className="flex flex-col flex-shrink-0 overflow-hidden"
      style={{ width: 236, borderRight: `1px solid ${pro.borderSoft}` }}
    >
      <div className="flex items-center gap-2 px-3 flex-shrink-0" style={{ height: 46, borderBottom: `1px solid ${pro.borderSoft}` }}>
        <span className="text-[10.5px] font-semibold tracking-widest uppercase flex-1" style={{ color: pro.textMute }}>
          {loading ? 'Notes' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
        </span>
        <button
          onClick={() => void create()}
          title="New note"
          className="flex items-center justify-center rounded-[7px]"
          style={{
            width: 26, height: 26, border: 'none', cursor: 'pointer',
            background: 'rgb(var(--lum-accent-rgb) / 0.14)', color: 'var(--lum-accent-bright)',
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {loading && (
          <div className="px-3 py-3 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="lum-skeleton" style={{ height: 12, width: '70%' }} />
                <div className="lum-skeleton" style={{ height: 9, width: '90%' }} />
              </div>
            ))}
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="px-3 py-4 text-[12px] leading-relaxed" style={{ color: pro.textMute }}>
            No notes yet. Create one — or ask Lumen in Deep Research to “add this to my notes”.
          </div>
        )}
        <AnimatePresence initial={false}>
          {notes.map((n) => {
            const on = n.id === activeId;
            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={springGentle}
                className="group relative"
              >
                <button
                  onClick={() => setActive(n.id)}
                  className="flex flex-col w-full text-left px-3.5 py-2.5"
                  style={{
                    background: on ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: 'none', cursor: 'pointer', transition: 'background 0.2s ease',
                  }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = pro.hover; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span className="text-[12.5px] font-medium truncate w-full" style={{ color: pro.text, paddingRight: 18 }}>
                    {n.title}
                  </span>
                  <span className="text-[10.5px] truncate w-full mt-0.5" style={{ color: pro.textMute }}>
                    {n.content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Empty note'}
                  </span>
                </button>
                <button
                  onClick={() => handleDelete(n.id, n.title)}
                  title="Delete note"
                  className="absolute opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-[6px]"
                  style={{
                    top: 8, right: 6, width: 20, height: 20, border: 'none', cursor: 'pointer',
                    background: 'transparent', color: pro.textMute, transition: 'opacity 0.15s ease, color 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--lum-danger)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = pro.textMute; }}
                >
                  <Trash2 size={12} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );

  // ── The editor ──────────────────────────────────────────────
  const editorPanel = (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 flex-shrink-0" style={{ height: 46, borderBottom: `1px solid ${pro.borderSoft}` }}>
        {active ? (
          <input
            value={active.title}
            readOnly={Boolean(asking)}
            onChange={(e) => edit(active.id, { title: e.target.value })}
            placeholder="Untitled note"
            className="text-[13.5px] font-semibold flex-1 min-w-0"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: pro.text }}
          />
        ) : (
          <span className="text-[13.5px] font-semibold flex-1" style={{ color: pro.textMute }}>No note open</span>
        )}
        <span className="text-[10.5px] flex-shrink-0" style={{ color: pro.textMute }}>
          {saving ? 'Saving…' : active ? 'Saved' : ''}
        </span>
        {active && (
          <button
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Expand to fullscreen'}
            className="flex items-center justify-center rounded-[7px] flex-shrink-0"
            style={{ width: 26, height: 26, border: 'none', cursor: 'pointer', background: 'transparent', color: pro.textMute, transition: 'color 0.2s ease, background 0.2s ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = pro.text; e.currentTarget.style.background = pro.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = pro.textMute; e.currentTarget.style.background = 'transparent'; }}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
      </div>

      {active ? (
        <div className="relative flex-1 min-h-0">
          <textarea
            ref={editorRef}
            value={active.content}
            readOnly={Boolean(asking)}
            onChange={(e) => { edit(active.id, { content: e.target.value }); setSelection(null); }}
            onSelect={readSelection}
            onMouseUp={readSelection}
            onKeyUp={readSelection}
            onScroll={() => setSelection(null)}
            onBlur={() => window.setTimeout(() => setSelection(null), 180)}
            placeholder="Start writing. Highlight any passage to ask Lumen about it."
            spellCheck
            className="w-full h-full"
            style={{
              background: 'transparent', border: 'none', outline: 'none', resize: 'none',
              color: pro.text, fontSize: 14, lineHeight: 1.7, fontFamily: 'inherit',
              padding: fullscreen ? '28px max(28px, calc(50% - 430px))' : '20px 26px',
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center">
          <FileText size={26} color={pro.textMute} />
          <div className="text-[13px]" style={{ color: pro.textSoft }}>Select a note, or create a new one.</div>
          <button
            onClick={() => void create()}
            className="flex items-center gap-1.5 text-[12px] font-medium"
            style={{
              padding: '7px 14px', borderRadius: 9, cursor: 'pointer',
              background: 'rgb(var(--lum-accent-rgb) / 0.14)',
              border: '1px solid rgb(var(--lum-accent-rgb) / 0.3)',
              color: 'var(--lum-accent-bright)',
            }}
          >
            <Plus size={13} /> New note
          </button>
        </div>
      )}
    </div>
  );

  const shell = (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: pro.chatBg }}>
      {/* Workspace header — mirrors the chat header's height and rule */}
      <div className="flex items-center justify-between px-5 flex-shrink-0" style={{ height: 50, borderBottom: `1px solid ${pro.borderSoft}` }}>
        <div className="flex items-center gap-2 min-w-0">
          <NotebookPen size={15} color="var(--lum-accent-bright)" />
          <span className="text-[13.5px] font-semibold truncate" style={{ color: pro.text }}>Notes</span>
        </div>
        <button
          onClick={onClose}
          title="Back to chat"
          className="flex items-center gap-1.5 text-[12px]"
          style={{ padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: pro.textMute, transition: 'color 0.2s ease, background 0.2s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = pro.text; e.currentTarget.style.background = pro.hover; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = pro.textMute; e.currentTarget.style.background = 'transparent'; }}
        >
          <X size={13} /> Close
        </button>
      </div>

      {/* Honest failure — never a silent swallow */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 px-5 py-2.5 flex-shrink-0"
            style={{ background: 'rgba(232,116,107,0.1)', borderBottom: '1px solid rgba(232,116,107,0.22)' }}
          >
            <span className="text-[12px] flex-1" style={{ color: 'var(--lum-danger)' }}>{error}</span>
            <button onClick={clearError} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--lum-danger)', padding: 0 }}>
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 overflow-hidden">
        {!fullscreen && listPanel}
        {editorPanel}
      </div>
    </div>
  );

  return (
    <>
      {fullscreen
        ? <div className="fixed inset-0 flex" style={{ zIndex: 60, background: pro.chatBg }}>{shell}</div>
        : shell}

      {/* Floating "Ask Lumen" — appears beside the highlighted passage */}
      <AnimatePresence>
        {selection && !asking && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={springGentle}
            // Pointer-down would clear the textarea selection before the
            // click lands, so act on mousedown and keep focus put.
            onMouseDown={(e) => { e.preventDefault(); void handleAsk(); }}
            className="fixed flex items-center gap-1.5 text-[12px] font-medium"
            style={{
              left: selection.x, top: selection.y, zIndex: 70,
              padding: '6px 11px', borderRadius: 9, cursor: 'pointer',
              background: '#26272C',
              border: '1px solid rgb(var(--lum-accent-rgb) / 0.45)',
              color: 'var(--lum-accent-bright)',
              boxShadow: '0 10px 28px -10px rgba(0,0,0,0.8)',
            }}
          >
            <Sparkles size={12} /> Ask Lumen
          </motion.button>
        )}
      </AnimatePresence>

      {/* Live research status — a turn can genuinely take minutes */}
      <AnimatePresence>
        {asking && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            transition={springGentle}
            className="fixed flex items-center gap-2.5 text-[12px]"
            style={{
              left: '50%', transform: 'translateX(-50%)', bottom: 26, zIndex: 70,
              padding: '9px 14px', borderRadius: 11,
              background: '#26272C', border: `1px solid ${pro.border}`,
              boxShadow: '0 14px 36px -14px rgba(0,0,0,0.8)', color: pro.textSoft,
            }}
          >
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }} className="flex">
              <Loader2 size={13} color="var(--lum-accent-bright)" />
            </motion.span>
            <span>Researching your selection — real search, so this can take a while.</span>
            <button
              onClick={cancelAsk}
              className="text-[11px] font-medium"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--lum-danger)', padding: 0 }}
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="fixed text-[12px]"
            style={{
              left: '50%', transform: 'translateX(-50%)', bottom: 26, zIndex: 70,
              padding: '9px 14px', borderRadius: 11,
              background: '#26272C', border: '1px solid rgb(var(--lum-accent-rgb) / 0.35)',
              color: 'var(--lum-accent-bright)', boxShadow: '0 14px 36px -14px rgba(0,0,0,0.8)',
            }}
          >
            {flash}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Viewport point just under character `index` of a textarea.
 *
 * A textarea exposes no selection rectangles, so measure a mirror div
 * that copies its computed style: text up to `index`, then a marker
 * span whose offset within the mirror is the caret's offset within the
 * textarea. Built and torn down per call — it only runs on selection.
 */
function caretViewportPoint(ta: HTMLTextAreaElement, index: number): { x: number; y: number } {
  const cs = window.getComputedStyle(ta);
  const mirror = document.createElement('div');
  for (const prop of Array.from(cs)) mirror.style.setProperty(prop, cs.getPropertyValue(prop));

  // Lay the copy out as wrapped, auto-height text off-screen, sized to
  // the textarea's real content box.
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  mirror.style.boxSizing = 'content-box';
  mirror.style.width = `${Math.max(0, ta.clientWidth - padX)}px`;
  mirror.style.height = 'auto';
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.overflow = 'hidden';

  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement('span');
  // Trailing content keeps the marker on the line the caret really sits
  // on; a bare span at a wrap point can be pushed to the next line.
  marker.textContent = ta.value.slice(index) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const offsetTop = marker.offsetTop;
  const offsetLeft = marker.offsetLeft;
  document.body.removeChild(mirror);

  // ONE line's height — marker.offsetHeight would be every remaining
  // line at once, which would park the button far below the selection.
  const parsedLine = parseFloat(cs.lineHeight);
  const lineHeight = Number.isFinite(parsedLine) ? parsedLine : (parseFloat(cs.fontSize) || 14) * 1.4;

  const box = ta.getBoundingClientRect();
  const BUTTON_W = 108;
  const x = box.left + offsetLeft - ta.scrollLeft;
  const y = box.top + offsetTop - ta.scrollTop + lineHeight + 4;

  // Keep the button inside both the textarea and the viewport.
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - BUTTON_W - 8, box.right - BUTTON_W)),
    y: Math.max(8, Math.min(y, window.innerHeight - 44, box.bottom - 8)),
  };
}
