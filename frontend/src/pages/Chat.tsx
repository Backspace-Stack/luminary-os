import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search, Plus, Send, RefreshCw, Trash2, Bot, Zap,
  Square, RotateCcw, ArrowRightToLine, AlertTriangle, X, PanelLeft,
  PanelLeftClose, MessageCircle, Code2, Telescope, Check, Palette,
  LayoutDashboard, ChevronDown, NotebookPen,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Badge, pointerLight } from '@/components/ui';
import { useChatContext } from '@/store/ChatContext';
import { usePrefs } from '@/lib/prefs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTheme } from '@/theme/useTheme';
import { ACCENTS } from '@/theme/engine';
import { springGentle } from '@/lib/motion';
import Markdown from '@/components/chat/Markdown';
import MessageStats from '@/components/chat/MessageStats';
import ToolActivityTable from '@/components/chat/ToolActivityTable';
import UsageAnalytics from '@/components/chat/UsageAnalytics';
import ModelPicker from '@/components/chat/ModelPicker';
import NotesView from '@/components/notes/NotesView';
import BrandLogo from '@/components/ui/BrandLogo';

/** Chat = ConversationAgent, Agent = CodingAgent, Deep Research = ResearchAgent. */
const MODES = [
  { id: 'conversation-agent', label: 'Chat', icon: MessageCircle },
  { id: 'coding-agent', label: 'Agent', icon: Code2 },
  { id: 'research-agent', label: 'Deep Research', icon: Telescope },
] as const;

const WELCOME_PROMPTS = [
  'What would you like to work on today?',
  'What shall we make progress on today?',
  'What would you like to explore?',
  'Where would you like to begin?',
  'What can I help you move forward today?',
] as const;

// ── Professional mode surfaces ────────────────────────────────
// Deliberately NOT theme-engine variables: Professional is a plain,
// Claude-like workspace where only the ACCENT color is customizable.
// Wallpapers, glass and weather stay exclusive to the dashboard.
const PRO = {
  railBg: '#1B1C20',
  chatBg: '#232428',
  border: 'rgba(255,255,255,0.07)',
  borderSoft: 'rgba(255,255,255,0.05)',
  text: 'rgba(255,255,255,0.92)',
  textSoft: 'rgba(255,255,255,0.6)',
  textMute: 'rgba(255,255,255,0.38)',
  hover: 'rgba(255,255,255,0.045)',
  inputBg: 'rgba(255,255,255,0.05)',
  inputBorder: 'rgba(255,255,255,0.11)',
};

// Professional layout preferences — persisted so the sidebar comes back
// the way it was left. Plain flags, read once at mount.
const RECENTS_KEY = 'luminary.pro.recents.v1';
const RAIL_KEY = 'luminary.pro.rail.v1';
const readFlag = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
};
const writeFlag = (key: string, v: boolean): void => {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private mode */ }
};

/** Human-friendly one-line label for a live tool call, e.g. "Searching: latest node LTS". */
function describeToolActivity(activity: NonNullable<ReturnType<typeof useChatContext>['toolActivity']>): string {
  const query = typeof activity.args?.query === 'string' ? activity.args.query : undefined;
  if (activity.phase === 'started') {
    return query ? `Searching: ${query}` : `Running ${activity.action}…`;
  }
  return activity.success === false
    ? `${activity.action} failed — still working…`
    : `Read results, thinking…`;
}

/** Trailing snippet of a live chain-of-thought stream, single-line-safe. */
function thinkingPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 120) return collapsed || 'Thinking…';
  return `…${collapsed.slice(-120)}`;
}

/** Human-friendly relative timestamp for the conversation list. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Professional mode's tiny theme center — accent color only, plus the
 * one-click way back to the full dashboard. Anchored above the rail
 * footer; a click anywhere else dismisses it.
 */
function ProAppearance({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useTheme();
  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 39 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={springGentle}
        className="absolute"
        style={{
          left: 10, right: 10, bottom: 52, zIndex: 40,
          background: '#26272C',
          border: `1px solid ${PRO.border}`,
          borderRadius: 12,
          boxShadow: '0 18px 44px -18px rgba(0,0,0,0.75)',
          padding: 14,
        }}
      >
        <div className="text-[11px] font-semibold mb-2.5" style={{ color: PRO.text }}>Accent color</div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {ACCENTS.map((hex) => {
            const active = theme.accent.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                onClick={() => setTheme({ accent: hex })}
                title={hex}
                style={{
                  width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
                  background: hex,
                  border: active ? '2px solid #fff' : '2px solid rgba(255,255,255,0.12)',
                  transition: 'border-color 0.2s ease',
                }}
              />
            );
          })}
          <label
            title="Custom color"
            className="relative"
            style={{
              width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
              background: 'conic-gradient(#E8746B, #E8C86B, #7FD99A, #7CC0EE, #B48CF5, #E8746B)',
              border: ACCENTS.every((a) => a.toLowerCase() !== theme.accent.toLowerCase())
                ? '2px solid #fff' : '2px solid rgba(255,255,255,0.12)',
            }}
          >
            <input
              type="color"
              value={theme.accent}
              onChange={(e) => setTheme({ accent: e.target.value })}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
            />
          </label>
        </div>
        <div className="text-[10px] mb-3" style={{ color: PRO.textMute }}>
          Wallpapers, weather and glass live in the dashboard's Theme Center.
        </div>
        <button
          onClick={() => setTheme({ ui: 'dashboard' })}
          className="flex items-center gap-2 w-full justify-center text-[12px] font-medium"
          style={{
            padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
            background: 'rgb(var(--lum-accent-rgb) / 0.14)',
            border: '1px solid rgb(var(--lum-accent-rgb) / 0.3)',
            color: 'var(--lum-accent-bright)',
            transition: 'background 0.2s ease',
          }}
        >
          <LayoutDashboard size={13} /> Back to Dashboard
        </button>
      </motion.div>
    </>
  );
}

export default function Chat() {
  const {
    conversations, activeId, messages, agentId, pending, loading, streaming, streamMeta, toolActivity, toolLog, thinking, error,
    draft: input, setDraft: setInput,
    openConversation, newConversation, deleteConversation,
    send, stop, regenerate, continueGeneration, setMode, approve, cancelPending, clearError,
  } = useChatContext();

  const [search, setSearch] = useState('');
  const [prefs]             = usePrefs();
  const [theme]             = useTheme();
  const narrow              = useMediaQuery('(max-width: 980px)');
  const [railOpen, setRailOpen] = useState(false);   // overlay rail on narrow screens
  const [cancelledNotice, setCancelledNotice] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [welcomePrompt] = useState(() => WELCOME_PROMPTS[Math.floor(Math.random() * WELCOME_PROMPTS.length)]);
  const scrollRef           = useRef<HTMLDivElement>(null);
  const endRef              = useRef<HTMLDivElement>(null);

  // Structural Professional mode — a plain, Claude-like chat workspace.
  // Same component, same state, different chrome.
  const pro = theme.ui === 'professional';

  // ── Professional sidebar state ──────────────────────────────
  // Recents visibility and the pinned/collapsed rail both persist.
  // While collapsed (wide screens), hovering the strip slides the full
  // rail out as a PREVIEW; clicking the expand control pins it open.
  // Notes is a third workspace beside Chat and Code: it takes over the
  // main area while open, and every way back to a conversation (the
  // toggle, New Chat, picking a recent) closes it.
  const [notesOpen, setNotesOpen] = useState(false);

  const [recentsOpen, setRecentsOpen] = useState(() => readFlag(RECENTS_KEY, true));
  const [railPinned, setRailPinnedState] = useState(() => readFlag(RAIL_KEY, true));
  const [railHover, setRailHover] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);

  const toggleRecents = () => setRecentsOpen((o) => { writeFlag(RECENTS_KEY, !o); return !o; });
  const setRailPinned = (v: boolean) => {
    setRailPinnedState(v);
    writeFlag(RAIL_KEY, v);
    if (v) setRailHover(false);
  };
  // A short grace period on mouse-out so crossing the strip↔panel seam
  // (or briefly overshooting) doesn't flicker the preview shut.
  const railEnter = () => { window.clearTimeout(hoverTimer.current); setRailHover(true); };
  const railLeave = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setRailHover(false), 140);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // ── View — derived from the conversation's pinned agent ─────
  // Top sidebar toggle (Claude's Home/Code): Chat ↔ Agent (CodingAgent).
  // The prompt-bar pair (Claude's Chat/Cowork): Chat ↔ Deep Research.
  // One source of truth — the existing agentId mode mechanism.
  const view: 'chat' | 'agent' = agentId === 'coding-agent' ? 'agent' : 'chat';
  const setView = (v: 'chat' | 'agent') => {
    setNotesOpen(false);
    if (v === view) return;
    setMode(v === 'agent' ? 'coding-agent' : 'conversation-agent');
  };

  const handleCancelPending = async () => {
    if (await cancelPending()) {
      setCancelledNotice(true);
      window.setTimeout(() => setCancelledNotice(false), 4000);
    }
  };

  const active = conversations.find(c => c.id === activeId) ?? null;
  const lastMessage = messages[messages.length - 1];
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  // Placeholder bubble between pressing Send and the first token arriving
  const awaitingFirstToken = streaming && lastMessage?.role !== 'assistant';

  // Auto-scroll — but never fight the user: only follow the stream
  // when they are already near the bottom.
  const nearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }, []);
  useEffect(() => {
    if (nearBottom()) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming, nearBottom]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    const text = input;
    setInput('');
    setCancelledNotice(false);
    send(text);
  };

  const handleDelete = () => {
    if (!activeId) return;
    // "Confirm before delete" is a real Settings preference
    if (!prefs.confirmDelete || window.confirm('Delete this conversation permanently?')) {
      deleteConversation(activeId);
    }
  };

  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (prefs.sendOnEnter) {
      if (!e.shiftKey) { e.preventDefault(); handleSend(); }
    } else {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleSend(); }
    }
  };

  const filtered = conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));

  // On narrow viewports the conversation list becomes an overlay
  // summoned from the chat header — nothing overlaps.
  const railHidden = narrow && !railOpen;

  // Prompt-bar mode pair: Professional's chat view mirrors Claude's
  // Chat/Cowork as Chat/Deep Research (Agent lives in the TOP toggle);
  // the dashboard keeps its original three-way selector unchanged.
  const promptModes = pro ? MODES.filter((m) => m.id !== 'coding-agent') : MODES;

  // Column centering shared by messages, pending cards and the composer.
  const columnPad = {
    paddingLeft: 'max(24px, calc(50% - 470px))',
    paddingRight: 'max(24px, calc(50% - 470px))',
  } as const;

  // Chat view's composer sits in a slightly narrower column than the
  // reading column — a light trim, so the prompt bar doesn't run the full
  // message width. Chat view only; nothing else about Chat changes.
  const chatComposerPad = {
    paddingLeft: 'max(24px, calc(50% - 430px))',
    paddingRight: 'max(24px, calc(50% - 430px))',
  } as const;

  // Monospace stack for the Code view's terminal-style log + prompt bar.
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  // The Code view is a full-width, left-aligned workspace (like Claude Code):
  // the analytics graph sits top-left, and the prompt bar / tool table stretch
  // edge-to-edge instead of living in the centered reading column.
  const codeView = pro && view === 'agent';
  // A new Professional Chat starts with the composer in the visual centre,
  // then returns to the familiar bottom position as soon as it becomes a
  // conversation. Code keeps its dedicated analytics home unchanged.
  const chatHome = pro && view === 'chat' && messages.length === 0 && !streaming;
  const widePad = { paddingLeft: 24, paddingRight: 24 } as const;
  // Composer & tool table: full-width in the Code view, centered elsewhere.
  const composerPad = codeView ? widePad : columnPad;
  // Message scroller: the Code view is a left-aligned, full-width terminal
  // action-log (home analytics AND live conversation); Chat keeps its
  // centered reading column.
  const scrollerPad = codeView ? { ...widePad, paddingTop: 4 } : columnPad;

  const renderComposer = (centered = false) => {
    // Bottom composer padding: Code view runs edge-to-edge; Chat view uses
    // its slightly-narrower column; the dashboard keeps the reading column.
    const bottomPad = codeView ? widePad : (pro && view === 'chat' ? chatComposerPad : composerPad);
    const shellStyle = centered ? { maxWidth: 840 } : bottomPad;
    const sendControl = streaming ? (
      <motion.button onClick={stop} title="Stop generation" whileTap={{ scale: 0.92 }}
        style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(232,116,107,0.35)', background: 'rgba(232,116,107,0.14)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Square size={12} color="var(--lum-danger)" fill="var(--lum-danger)" />
      </motion.button>
    ) : (
      <motion.button onClick={handleSend} disabled={!input.trim()} whileTap={input.trim() ? { scale: 0.92 } : undefined}
        whileHover={input.trim() ? { y: -1 } : undefined}
        style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: input.trim() ? 'var(--lum-accent-grad)' : 'rgba(255,255,255,0.06)', boxShadow: input.trim() ? '0 4px 16px -4px rgb(var(--lum-accent-rgb) / 0.6)' : 'none', cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s ease, box-shadow 0.25s ease', flexShrink: 0 }}>
        <Send size={14} color={input.trim() ? '#fff' : (pro ? PRO.textMute : 'var(--lum-text-muted)')} />
      </motion.button>
    );

    // ── Code view: a single-line, terminal-style prompt bar ──
    // Not the tall multi-line box Chat uses. A fixed-height row with a
    // prompt glyph; Enter runs, Shift+Enter inserts a newline WITHOUT the
    // box growing (the field scrolls internally). Mirrors Claude Code's
    // own input line.
    if (pro && codeView) return (
      <div className={centered ? 'w-full' : 'pb-5 pt-1 flex-shrink-0'} style={centered ? { maxWidth: 840 } : widePad}>
        <div className="flex items-center gap-2.5 px-3.5 lum-input-focus"
          style={{ height: 48, borderRadius: 10, background: '#16171B', border: `1px solid ${PRO.inputBorder}`, fontFamily: MONO }}>
          <span style={{ color: 'var(--lum-accent-bright)', fontSize: 14, fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>❯</span>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleInputKey}
            placeholder={streaming ? 'Working…' : 'Give the agent a task…'} rows={1}
            style={{ flex: 1, height: 22, background: 'transparent', border: 'none', color: PRO.text, fontSize: 13.5, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: '22px', overflowY: 'auto' }} />
          <div className="flex items-center gap-2.5 flex-shrink-0"><ModelPicker agentId={agentId} minimal />{sendControl}</div>
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-[10.5px]" style={{ color: PRO.textMute, fontFamily: MONO }}>
            {prefs.sendOnEnter ? 'enter to run · shift+enter for newline' : 'ctrl+enter to run'}
          </span>
          <span className="text-[10.5px] truncate ml-3" style={{ color: PRO.textMute, fontFamily: MONO }}>{lastAssistant?.model ?? ''}</span>
        </div>
      </div>
    );

    if (pro) return (
      <div className={centered ? 'w-full' : 'pb-6 pt-1 flex-shrink-0'} style={shellStyle}>
        <div className="flex flex-col px-5 py-3 lum-input-focus" style={{ minHeight: 104, borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: `1px solid ${PRO.inputBorder}` }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleInputKey}
            placeholder={view === 'agent' ? 'Give the agent a task…' : 'How can I help you today?'} rows={1}
            style={{ flex: 1, minHeight: 28, background: 'transparent', border: 'none', color: PRO.text, fontSize: 16, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.45, maxHeight: 120 }} />
          <div className="flex items-center justify-between gap-4 mt-2">
            {view === 'chat' ? (
              <div className="flex items-center gap-1 rounded-[9px] p-0.5" style={{ background: 'rgba(0,0,0,0.42)' }}>
                {promptModes.map((m) => {
                  const activeMode = agentId === m.id;
                  return <button key={m.id} onClick={() => setMode(m.id)} disabled={streaming} title={`Switch to ${m.label} mode`}
                    className="text-[13px] font-medium" style={{ padding: '4px 10px', borderRadius: 7, border: activeMode ? '1px solid rgba(255,255,255,0.26)' : '1px solid transparent', background: activeMode ? 'rgba(255,255,255,0.17)' : 'transparent', color: activeMode ? PRO.text : PRO.textSoft, cursor: streaming ? 'not-allowed' : 'pointer', opacity: streaming && !activeMode ? 0.5 : 1 }}>
                    {m.label}
                  </button>;
                })}
              </div>
            ) : <span />}
            <div className="flex items-center gap-3"><ModelPicker agentId={agentId} minimal />{sendControl}</div>
          </div>
        </div>
      </div>
    );

    return (
      <div className={centered ? 'w-full' : 'pb-6 pt-1 flex-shrink-0'} style={centered ? { maxWidth: 720 } : composerPad}>
        <div className="flex items-center gap-1.5 mb-2">
          {promptModes.map((m) => { const Icon = m.icon; return <Button key={m.id} variant={agentId === m.id ? 'accent' : 'ghost'} size="sm" disabled={streaming} onClick={() => setMode(m.id)}><Icon size={11} /> {m.label}</Button>; })}
        </div>
        <div className="flex items-end gap-3 px-4 py-3 lum-glass lum-reflect lum-input-focus" style={{ borderRadius: 'var(--lum-radius)' }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleInputKey} placeholder="Send a message…" rows={1} style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--lum-text)', fontSize: 13.5, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, minHeight: 24 }} />
          {sendControl}
        </div>
        <div className="flex items-center justify-between mt-2.5 px-0.5 gap-3"><span className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>{prefs.sendOnEnter ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl+Enter to send'}</span><span className="text-[11px] font-mono" style={{ color: 'var(--lum-text-muted)' }}>{lastAssistant?.model ?? ''}</span></div>
      </div>
    );
  };

  // Conversation search. In Professional it sits directly beneath New
  // Chat — right above the Recents list it actually filters — which is
  // what leaves Notes sitting between the Chat/Code toggle and New Chat
  // with nothing in between. The dashboard rail keeps its original order.
  const searchBlock = (
    <div className="p-3" style={{ borderBottom: `1px solid ${pro ? PRO.borderSoft : 'rgba(255,255,255,0.06)'}` }}>
      <div
        className={pro
          ? 'flex items-center gap-2 px-3 py-2 rounded-[10px]'
          : 'flex items-center gap-2 px-3 py-2 rounded-[10px] lum-glass-subtle'}
        style={pro
          ? { background: 'rgba(255,255,255,0.045)', border: `1px solid ${PRO.borderSoft}` }
          : undefined}>
        <Search size={13} color={pro ? PRO.textMute : 'var(--lum-text-muted)'} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…"
          style={{ background: 'transparent', border: 'none', color: pro ? PRO.text : 'var(--lum-text)', fontSize: 13, outline: 'none', flex: 1 }} />
      </div>
    </div>
  );

  // ── The rail's inner content — shared by every rail container
  //    (static, narrow overlay, hover preview) ─────────────────
  const railContent = (
    <>
      {/* Professional wordmark — the rail is the only chrome left */}
      {pro && (
        <div className="flex items-center gap-2 px-4 flex-shrink-0" style={{ height: 50, borderBottom: `1px solid ${PRO.borderSoft}` }}>
          <BrandLogo size={26} />
          <span className="text-[13px] font-semibold tracking-tight flex-1" style={{ color: PRO.text }}>Luminary</span>
          {!narrow && (
            <button
              onClick={() => setRailPinned(!railPinned)}
              title={railPinned ? 'Collapse sidebar' : 'Keep sidebar open'}
              className="flex items-center justify-center rounded-[7px]"
              style={{
                width: 26, height: 26, border: 'none', cursor: 'pointer',
                background: 'transparent', color: PRO.textMute,
                transition: 'color 0.2s ease, background 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = PRO.text; e.currentTarget.style.background = PRO.hover; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = PRO.textMute; e.currentTarget.style.background = 'transparent'; }}
            >
              {railPinned ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
            </button>
          )}
        </div>
      )}

      {/* Chat/Agent view toggle — Claude's Home/Code, at the very top */}
      {pro && (
        <div className="px-3 pt-3 flex-shrink-0">
          <div
            className="flex p-0.5 gap-0.5"
            style={{ borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${PRO.borderSoft}` }}
          >
            {([
              { v: 'chat' as const, label: 'Chat', Icon: MessageCircle },
              // Labelled "Code" to mirror Claude's Home/Code pair; the
              // underlying view id and CodingAgent routing are unchanged.
              { v: 'agent' as const, label: 'Code', Icon: Code2 },
            ]).map(({ v, label, Icon }) => {
              const on = view === v;
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  disabled={streaming}
                  title={v === 'agent' ? 'Code workspace — CodingAgent with live tool activity' : 'Conversation workspace'}
                  className="flex items-center justify-center gap-1.5 text-[12px] font-medium"
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 8, border: 'none',
                    cursor: streaming ? 'not-allowed' : 'pointer',
                    background: on ? 'rgb(var(--lum-accent-rgb) / 0.16)' : 'transparent',
                    color: on ? PRO.text : PRO.textMute,
                    fontWeight: on ? 600 : 450,
                    transition: 'background 0.2s ease, color 0.2s ease',
                    opacity: streaming && !on ? 0.5 : 1,
                  }}
                >
                  <Icon size={12} /> {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes — directly below the Chat/Code toggle, directly above New Chat */}
      {pro && (
        <div className="px-3 pt-2 flex-shrink-0">
          <button
            onClick={() => { setNotesOpen(true); if (narrow) setRailOpen(false); }}
            title="Your notes — write freely, and ask Lumen about any passage"
            className="flex items-center gap-2 w-full text-[12.5px] font-medium"
            style={{
              padding: '8px 11px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: notesOpen ? 'rgb(var(--lum-accent-rgb) / 0.16)' : 'transparent',
              color: notesOpen ? PRO.text : PRO.textSoft,
              fontWeight: notesOpen ? 600 : 450,
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
            onMouseEnter={(e) => { if (!notesOpen) { e.currentTarget.style.background = PRO.hover; e.currentTarget.style.color = PRO.text; } }}
            onMouseLeave={(e) => { if (!notesOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = PRO.textSoft; } }}
          >
            <NotebookPen size={13} /> Notes
          </button>
        </div>
      )}

      {!pro && searchBlock}
      <div className="p-3" style={{ borderBottom: `1px solid ${pro ? PRO.borderSoft : 'rgba(255,255,255,0.06)'}` }}>
        <Button variant="accent" onClick={() => { setNotesOpen(false); newConversation(); if (narrow) setRailOpen(false); }} style={{ width: '100%', justifyContent: 'center' }}>
          <Plus size={14} /> New Chat
        </Button>
      </div>
      {pro && searchBlock}

      {/* Recents — collapsible in Professional (choice persists) */}
      {pro && (
        <button
          onClick={toggleRecents}
          className="flex items-center gap-1.5 px-4 py-2 flex-shrink-0 text-left w-full"
          title={recentsOpen ? 'Hide recent chats' : 'Show recent chats'}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: PRO.textMute, transition: 'color 0.2s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = PRO.textSoft; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = PRO.textMute; }}
        >
          <span className="text-[10.5px] font-semibold tracking-widest uppercase flex-1">Recents</span>
          <motion.span animate={{ rotate: recentsOpen ? 0 : -90 }} transition={springGentle} className="flex">
            <ChevronDown size={12} />
          </motion.span>
        </button>
      )}
      {(!pro || recentsOpen) && (
        <motion.div
          key="recents"
          initial={pro ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          className="flex-1 overflow-y-auto py-1 min-h-0"
        >
          {loading && (
            <div className="px-4 py-3 space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="lum-skeleton" style={{ height: 13, width: '70%' }} />
                  <div className="lum-skeleton" style={{ height: 10, width: '90%' }} />
                </div>
              ))}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-3 text-[12px]" style={{ color: pro ? PRO.textMute : 'var(--lum-text-muted)' }}>
              {search ? 'No conversations match your search.' : 'No conversations yet — start one!'}
            </div>
          )}
          <AnimatePresence initial={false}>
            {filtered.map(c => (
              <motion.button key={c.id} onClick={() => { setNotesOpen(false); openConversation(c.id); if (narrow) setRailOpen(false); }}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={springGentle}
                className="flex flex-col w-full text-left px-4 py-3 mx-0"
                style={{
                  background: activeId === c.id
                    ? (pro ? 'rgba(255,255,255,0.06)' : 'linear-gradient(160deg, rgb(var(--lum-accent-rgb) / 0.14), rgb(var(--lum-accent-rgb) / 0.06))')
                    : 'transparent',
                  borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                  borderLeft: pro
                    ? '2px solid transparent'
                    : `2px solid ${activeId === c.id ? 'var(--lum-violet)' : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={e => { if (activeId !== c.id) e.currentTarget.style.background = pro ? PRO.hover : 'rgba(255,255,255,0.035)'; }}
                onMouseLeave={e => { if (activeId !== c.id) e.currentTarget.style.background = 'transparent'; }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[13px] font-medium truncate" style={{ color: pro ? PRO.text : 'var(--lum-text)' }}>{c.title}</span>
                  <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: pro ? PRO.textMute : 'var(--lum-text-muted)' }}>{timeAgo(c.updatedAt)}</span>
                </div>
                {c.lastAgentName && <Badge variant="default" className="mb-1.5 self-start">{c.lastAgentName}</Badge>}
                <div className="text-[11px] truncate" style={{ color: pro ? PRO.textMute : 'var(--lum-text-muted)' }}>
                  {c.lastMessage || 'No messages yet'}
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {/* Collapsed recents leave the rail clean — the space stays empty */}
      {pro && !recentsOpen && <div className="flex-1 min-h-0" />}

      {/* Professional rail footer — appearance (accent only) + the way home */}
      {pro && (
        <div className="relative flex-shrink-0 px-2.5 py-2" style={{ borderTop: `1px solid ${PRO.borderSoft}` }}>
          <button
            onClick={() => setAppearanceOpen((o) => !o)}
            className="flex items-center gap-2.5 w-full rounded-[9px] text-[12px]"
            style={{
              padding: '8px 12px', border: 'none', cursor: 'pointer',
              background: appearanceOpen ? PRO.hover : 'transparent',
              color: PRO.textSoft, transition: 'background 0.2s ease, color 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = PRO.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = PRO.textSoft; }}
          >
            <Palette size={14} /> Appearance
          </button>
          <AnimatePresence>
            {appearanceOpen && <ProAppearance onClose={() => setAppearanceOpen(false)} />}
          </AnimatePresence>
        </div>
      )}
    </>
  );

  // Wide-screen Professional rail collapse: strip + hover preview.
  const railCollapsed = pro && !narrow && !railPinned;

  return (
    <div className="relative flex flex-1 overflow-hidden" style={pro ? { background: PRO.chatBg } : undefined}>
      {railCollapsed ? (
        <>
          {/* Thin strip — the collapsed sidebar. Hover slides the full
              rail out as a preview; the expand control click pins it. */}
          <div
            className="flex flex-col items-center flex-shrink-0 py-2.5 gap-1.5"
            onMouseEnter={railEnter}
            onMouseLeave={railLeave}
            style={{ width: 52, background: PRO.railBg, borderRight: `1px solid ${PRO.border}` }}
          >
            <button
              onClick={() => setRailPinned(true)}
              title="Expand sidebar (click to keep open)"
              className="flex items-center justify-center rounded-[8px]"
              style={{
                width: 32, height: 32, border: 'none', cursor: 'pointer',
                background: 'transparent', color: PRO.textSoft,
                transition: 'background 0.2s ease, color 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = PRO.hover; e.currentTarget.style.color = PRO.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = PRO.textSoft; }}
            >
              <PanelLeft size={15} />
            </button>
            <button
              onClick={() => { setNotesOpen(true); }}
              title="Notes"
              className="flex items-center justify-center rounded-[8px]"
              style={{
                width: 32, height: 32, border: 'none', cursor: 'pointer',
                background: notesOpen ? 'rgb(var(--lum-accent-rgb) / 0.14)' : 'transparent',
                color: notesOpen ? 'var(--lum-accent-bright)' : PRO.textSoft,
                transition: 'background 0.2s ease, color 0.2s ease',
              }}
              onMouseEnter={(e) => { if (!notesOpen) { e.currentTarget.style.background = PRO.hover; e.currentTarget.style.color = PRO.text; } }}
              onMouseLeave={(e) => { if (!notesOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = PRO.textSoft; } }}
            >
              <NotebookPen size={15} />
            </button>
            <button
              onClick={() => { setNotesOpen(false); newConversation(); }}
              title="New chat"
              className="flex items-center justify-center rounded-[8px]"
              style={{
                width: 32, height: 32, border: 'none', cursor: 'pointer',
                background: 'rgb(var(--lum-accent-rgb) / 0.14)', color: 'var(--lum-accent-bright)',
                transition: 'background 0.2s ease',
              }}
            >
              <Plus size={15} />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => { setRailPinned(true); setAppearanceOpen(true); }}
              title="Appearance"
              className="flex items-center justify-center rounded-[8px]"
              style={{
                width: 32, height: 32, border: 'none', cursor: 'pointer',
                background: 'transparent', color: PRO.textMute,
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = PRO.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = PRO.textMute; }}
            >
              <Palette size={14} />
            </button>
          </div>
          {/* Hover preview — the full rail sliding out OVER the strip
              and content (Claude's expand-in-place). Anchored at left:0
              so translateX(-100%) tucks it entirely off its own left
              edge; the extra -12px buffer clears any sub-pixel seam so
              nothing peeks past the strip. Mouse-out slides it back. */}
          <div
            className="flex flex-col overflow-hidden"
            onMouseEnter={railEnter}
            onMouseLeave={railLeave}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 30,
              width: 268, background: PRO.railBg,
              borderRight: `1px solid ${PRO.border}`,
              transform: railHover ? 'translateX(0)' : 'translateX(calc(-100% - 12px))',
              transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
              boxShadow: railHover ? '24px 0 60px -30px rgba(0,0,0,0.8)' : 'none',
              pointerEvents: railHover ? 'auto' : 'none',
            }}
          >
            {railContent}
          </div>
        </>
      ) : (
        <div className={pro ? 'flex flex-col flex-shrink-0 overflow-hidden' : 'flex flex-col flex-shrink-0 overflow-hidden lum-glass-strong lum-luminous'}
          onPointerMove={pro ? undefined : pointerLight}
          style={{
            width: pro ? 268 : 282,
            ...(pro
              ? { background: PRO.railBg, borderRight: `1px solid ${PRO.border}` }
              : {
                  borderRadius: 0, borderTop: 'none', borderBottom: 'none', borderLeft: 'none',
                  borderRight: '1px solid var(--lum-glass-border)',
                }),
            ...(narrow && {
              position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 30,
              transform: railHidden ? 'translateX(-100%)' : 'translateX(0)',
              transition: 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
              boxShadow: railHidden ? 'none' : '24px 0 60px -30px rgba(0,0,0,0.8)',
            }),
          }}>
          {railContent}
        </div>
      )}

      {/* Notes workspace — takes over the main area while open.
          Professional only; the dashboard layout is untouched. */}
      {pro && notesOpen ? (
        <NotesView pro={PRO} onClose={() => setNotesOpen(false)} confirmDelete={prefs.confirmDelete} />
      ) : (
      /* Chat area */
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 flex-shrink-0"
          style={pro
            ? { height: 50, borderBottom: `1px solid ${PRO.borderSoft}` }
            : {
                paddingTop: 12, paddingBottom: 12,
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(8,11,18,0.35)', backdropFilter: 'blur(8px)',
              }}>
          <div className="flex items-center gap-3 min-w-0">
            {narrow && (
              <Button variant="ghost" size="sm" onClick={() => setRailOpen(o => !o)} title="Conversations">
                <PanelLeft size={14} />
              </Button>
            )}
            {!pro && (
              <div className="flex items-center justify-center rounded-[10px] flex-shrink-0"
                style={{ width: 34, height: 34, background: 'var(--lum-violet-soft)', border: '1px solid rgb(var(--lum-accent-rgb) / 0.25)', boxShadow: '0 0 16px rgb(var(--lum-accent-rgb) / 0.2)' }}>
                <Bot size={16} color="var(--lum-violet)" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold truncate" style={{ color: pro ? PRO.text : 'var(--lum-aurora)' }}>{active?.title ?? 'New Chat'}</div>
              {!pro && (
                <div className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>
                  {active?.lastAgentName ?? 'Routed automatically to the best agent'}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Live routing hint while generating */}
            <AnimatePresence>
              {streaming && streamMeta && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: 10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={springGentle}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px]"
                  style={pro
                    ? { background: 'rgba(255,255,255,0.05)', border: `1px solid ${PRO.border}` }
                    : { background: 'var(--lum-ice-soft)', border: '1px solid rgba(143,198,232,0.22)' }}>
                  <Zap size={10} color={pro ? 'var(--lum-accent)' : 'var(--lum-ice)'} />
                  <span className="text-[10px] font-mono" style={{ color: pro ? PRO.textSoft : 'var(--lum-ice)' }}>
                    → {streamMeta.agentName} · {streamMeta.model}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <Button variant="ghost" size="sm" onClick={() => activeId && openConversation(activeId)} disabled={!activeId || streaming}>
              <RefreshCw size={13} />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={!activeId || streaming}>
              <Trash2 size={13} />
            </Button>
          </div>
        </div>

        {/* Error banner — honest failure states, never fake replies */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={pro ? 'flex items-center gap-2.5 mx-6 mt-4 px-4 py-3 rounded-[12px] flex-shrink-0' : 'flex items-center gap-2.5 mx-6 mt-4 px-4 py-3 rounded-[12px] flex-shrink-0 lum-glass'}
              style={pro
                ? { background: 'rgba(232,116,107,0.08)', border: '1px solid rgba(232,116,107,0.3)' }
                : { borderColor: 'rgba(232,116,107,0.35)' }}>
              <AlertTriangle size={14} color="var(--lum-danger)" style={{ flexShrink: 0 }} />
              <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lum-danger)', flex: 1 }}>{error}</div>
              <button onClick={clearError} title="Dismiss"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 2 }}>
                <X size={13} color="var(--lum-danger)" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages — centered reading column, except the Code analytics
            home which sits top-left in a full-width workspace. */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-5 space-y-5" style={scrollerPad}>
          {messages.length === 0 && !streaming && (
            chatHome ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springGentle}
                className="flex h-full flex-col items-center justify-center px-6"
              >
                <div className="flex flex-col items-center mb-7">
                  <BrandLogo size={112} />
                  <h1 className="mt-3 text-center text-[25px] font-semibold tracking-tight" style={{ color: PRO.text }}>
                    {welcomePrompt}
                  </h1>
                </div>
                {renderComposer(true)}
              </motion.div>
            ) : pro && view === 'agent' ? (
              // The Code "home" screen: real, code-scoped usage analytics
              // (only CodingAgent activity) — the SS2 widget, in the code area.
              <UsageAnalytics agent="coding-agent" embedded />
            ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
              className="flex flex-col items-center justify-center h-full" style={{ color: pro ? PRO.textMute : 'var(--lum-text-muted)' }}>
              {pro ? (
                <div
                  className="flex items-center justify-center rounded-full mb-4"
                  style={{ width: 44, height: 44, background: 'rgb(var(--lum-accent-rgb) / 0.12)' }}
                >
                  {view === 'agent' ? <Code2 size={19} color="var(--lum-accent)" /> : <MessageCircle size={19} color="var(--lum-accent)" />}
                </div>
              ) : (
                <div className="lum-float flex items-center justify-center rounded-2xl mb-4"
                  style={{ width: 56, height: 56, background: 'var(--lum-violet-soft)', border: '1px solid rgb(var(--lum-accent-rgb) / 0.2)', boxShadow: '0 0 28px rgb(var(--lum-accent-rgb) / 0.25)' }}>
                  <Bot size={24} color="var(--lum-violet)" />
                </div>
              )}
              <div className="text-[14px] mb-1" style={{ color: pro ? PRO.textSoft : 'var(--lum-text-secondary)' }}>
                {pro && view === 'agent' ? 'Start a coding session' : 'Start a conversation'}
              </div>
              <div className="text-[12px]">
                {'Messages use your selected provider — routed to the best agent'}
              </div>
            </motion.div>
            )
          )}
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              const isStreamingMsg = streaming && streamMeta?.messageId === msg.id;
              const isLast = i === messages.length - 1;

              // ── Code view: a left-aligned terminal action-log ──
              // No centered chat bubbles: the user's task is a prompt line
              // (❯ …); the agent's reply flows as plain left-aligned output,
              // the way Claude Code renders its own log.
              if (codeView) {
                return (
                  <motion.div key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springGentle}
                    className="flex flex-col">
                    {isUser ? (
                      <div className="flex items-start gap-2.5">
                        <span style={{ color: 'var(--lum-accent-bright)', fontWeight: 700, fontFamily: MONO, fontSize: 13.5, lineHeight: '22px', flexShrink: 0 }}>❯</span>
                        <div className="text-[13px]" style={{ color: PRO.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: MONO, lineHeight: '22px', minWidth: 0 }}>
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col pl-[26px]">
                        <MessageStats msg={msg} showPerf={prefs.showPerf} streaming={isStreamingMsg} pro={pro} />
                        <div className="text-[13.5px] leading-relaxed" style={{ color: PRO.text }}>
                          <Markdown content={msg.content} />
                          {isStreamingMsg && <span className="lum-stream-caret" />}
                        </div>
                        <div className="text-[10px] mt-1" style={{ color: PRO.textMute, fontFamily: MONO }}>{timeAgo(msg.createdAt)}</div>
                        {isLast && !streaming && lastAssistant?.id === msg.id && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex gap-2 mt-1.5">
                            <Button variant="ghost" size="sm" onClick={regenerate}><RotateCcw size={11} /> Regenerate</Button>
                            <Button variant="ghost" size="sm" onClick={continueGeneration}><ArrowRightToLine size={11} /> Continue</Button>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              }

              return (
                <motion.div key={msg.id}
                  initial={{ opacity: 0, y: 12, x: isUser ? 10 : -10 }}
                  animate={{ opacity: 1, y: 0, x: 0 }}
                  transition={springGentle}
                  className={`flex gap-3 items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatars are dashboard chrome — Professional stays plain */}
                  {!pro && (
                    <div className="flex items-center justify-center rounded-[10px] flex-shrink-0 lum-glass-subtle"
                      style={{ width: 32, height: 32, ...(isUser ? { background: 'var(--lum-violet-soft)' } : {}) }}>
                      {isUser ? '👤' : <Bot size={14} color="var(--lum-violet)" />}
                    </div>
                  )}
                  <div style={{ maxWidth: pro ? (isUser ? 'min(78%, 620px)' : '100%') : 'min(78%, 760px)', minWidth: 0, flex: pro && !isUser ? 1 : undefined }}>
                    {!isUser && (
                      <MessageStats msg={msg} showPerf={prefs.showPerf} streaming={isStreamingMsg} pro={pro} />
                    )}
                    <div
                      className={pro && !isUser ? 'py-0.5 text-[13.5px] leading-relaxed' : 'px-4 py-3 text-[13.5px] leading-relaxed'}
                      style={pro
                        ? (isUser
                            ? {
                                background: 'rgb(var(--lum-accent-rgb) / 0.14)',
                                border: '1px solid rgb(var(--lum-accent-rgb) / 0.1)',
                                color: PRO.text,
                                borderRadius: 16,
                                whiteSpace: 'pre-wrap',
                              }
                            : { color: PRO.text, whiteSpace: 'normal' })
                        : {
                            background: isUser
                              ? 'linear-gradient(160deg, rgb(var(--lum-accent-rgb) / 0.2), rgb(var(--lum-accent-rgb) / 0.1))'
                              : 'var(--lum-glass)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            border: `1px solid ${isUser ? 'rgb(var(--lum-accent-rgb) / 0.3)' : 'var(--lum-glass-border)'}`,
                            boxShadow: '0 8px 24px -14px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                            color: 'var(--lum-text)',
                            borderRadius: isUser ? '14px 14px 5px 14px' : '14px 14px 14px 5px',
                            whiteSpace: isUser ? 'pre-wrap' : 'normal',
                          }}>
                      {isUser ? msg.content : (
                        <>
                          <Markdown content={msg.content} />
                          {isStreamingMsg && <span className="lum-stream-caret" />}
                        </>
                      )}
                    </div>
                    <div className={`text-[10px] mt-1 ${isUser ? 'text-right' : 'text-left'}`} style={{ color: pro ? PRO.textMute : 'var(--lum-text-muted)' }}>
                      {timeAgo(msg.createdAt)}
                    </div>
                    {/* Regenerate / Continue for the finished last assistant reply */}
                    {!isUser && isLast && !streaming && lastAssistant?.id === msg.id && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex gap-2 mt-1.5">
                        <Button variant="ghost" size="sm" onClick={regenerate}>
                          <RotateCcw size={11} /> Regenerate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={continueGeneration}>
                          <ArrowRightToLine size={11} /> Continue
                        </Button>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Thinking indicator — live model activity before the first answer token.
              Priority: tool activity > live chain-of-thought > generic "model is
              thinking" (once meta arrives) > plain "Thinking…" while nothing has
              come back yet. */}
          <AnimatePresence>
            {awaitingFirstToken && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={springGentle}
                className="flex gap-3 items-start">
                {!pro && (
                  <div className="flex items-center justify-center rounded-[10px] flex-shrink-0 lum-glass-subtle" style={{ width: 32, height: 32 }}>
                    <Bot size={14} color="var(--lum-violet)" />
                  </div>
                )}
                <div
                  className={pro ? 'py-1 flex items-start gap-2.5' : 'px-4 py-3.5 rounded-[14px] flex items-start gap-2.5 lum-glass'}
                  style={{ maxWidth: 'min(78%, 760px)' }}>
                  <span className="flex gap-1 items-center flex-shrink-0" style={{ marginTop: 3 }}>
                    <span className="lum-think-dot" /><span className="lum-think-dot" /><span className="lum-think-dot" />
                  </span>
                  <span className="text-[12px] leading-relaxed" style={{ color: pro ? PRO.textSoft : 'var(--lum-text-muted)' }}>
                    {toolActivity
                      ? describeToolActivity(toolActivity)
                      : thinking
                        ? thinkingPreview(thinking)
                        : streamMeta ? `${streamMeta.model} is thinking` : 'Thinking…'}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={endRef} />
        </div>

        {/* Pending confirmations — one card per paused tool call */}
        <AnimatePresence>
          {pending && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex-shrink-0 space-y-2 pb-2"
              style={columnPad}>
              {pending.items.map((item) => (
                <div key={item.id}
                  className={pro ? 'flex flex-col gap-2 px-4 py-3 rounded-[12px]' : 'flex flex-col gap-2 px-4 py-3 rounded-[12px] lum-glass'}
                  style={pro
                    ? { background: 'rgba(232,178,90,0.06)', border: '1px solid rgba(232,178,90,0.3)' }
                    : { borderColor: 'rgba(232,178,90,0.35)' }}>
                  <div className="text-[11px]" style={{ color: 'var(--lum-warning)' }}>
                    {pending.agentName} wants to run <span className="font-mono">{item.plugin}/{item.action}</span>
                  </div>
                  <div className="text-[12px] font-mono px-2.5 py-1.5 rounded-[8px]"
                    style={{ background: 'rgba(0,0,0,0.25)', color: pro ? PRO.textSoft : 'var(--lum-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(item.args)}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="success" size="sm" onClick={() => approve(item.id)} disabled={streaming}>
                      <Check size={11} /> Approve
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleCancelPending} disabled={streaming}>
                      <X size={11} /> Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
          {!pending && cancelledNotice && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-shrink-0 pb-2 text-[12px]"
              style={{ ...columnPad, color: pro ? PRO.textMute : 'var(--lum-text-muted)' }}>
              Cancelled — nothing was done.
            </motion.div>
          )}
        </AnimatePresence>

        {/* Agent view — live tool activity from the REAL event stream */}
        {pro && view === 'agent' && (
          <div className="flex-shrink-0 pb-2" style={composerPad}>
            <ToolActivityTable rows={toolLog} />
          </div>
        )}

        {/* In Professional Chat, a blank conversation starts in the centre.
            Every other state keeps the composer at the bottom. */}
        {!chatHome && renderComposer()}
      </div>
      )}
    </div>
  );
}
