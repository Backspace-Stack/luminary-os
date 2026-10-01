// ============================================================
// Settings — every control here is real. Toggles change live
// behavior (chat, privacy, locking); generation options ride
// along with every request; network shows live provider truth.
// Visual identity lives in the Theme Center — linked, not
// duplicated.
// ============================================================

import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles, FolderOpen, Check, AlertTriangle, Search,
  SlidersHorizontal, Layers, Wifi, Shield, Info, Palette,
  Lock, Trash2, ArrowRight, KeyRound,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Button, Toggle, Segmented, StatusDot, pointerLight } from '@/components/ui';
import { springGentle } from '@/lib/motion';
import { settingsApi, modelsApi, chatApi, integrationsApi, type IntegrationStatus } from '@/services/api';
import { usePrefs } from '@/lib/prefs';
import { useTheme } from '@/theme/useTheme';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { NavPage, ProviderHealth } from '@/types';

const TABS = ['general', 'appearance', 'models', 'network', 'integrations', 'security', 'about'] as const;
type Tab = typeof TABS[number];

const TAB_ICONS: Record<Tab, React.ElementType> = {
  general: SlidersHorizontal, appearance: Palette, models: Layers,
  network: Wifi, integrations: KeyRound, security: Shield, about: Info,
};

const ACCENT_QUICK = ['#8B7CFF', '#7CC0EE', '#6FD3C3', '#7FD99A', '#F09B6C', '#EF8FBE'];

/** Numeric input where empty string = "use the model default". */
function NumberInput({ value, onCommit, placeholder, min, max, step, width = 130 }: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder: string;
  min: number; max: number; step?: number;
  width?: number;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const commit = () => {
    const t = draft.trim();
    if (t === '') { onCommit(null); return; }
    const n = Number(t);
    if (!Number.isFinite(n)) { setDraft(value == null ? '' : String(value)); return; }
    onCommit(Math.min(max, Math.max(min, n)));
  };

  return (
    <input
      value={draft}
      inputMode="decimal"
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder={placeholder}
      className="lum-glass-subtle font-mono"
      style={{ padding: '7px 12px', color: 'var(--lum-text)', fontSize: 12, outline: 'none', width }}
    />
  );
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between py-4 gap-6 flex-wrap"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}
    >
      <div style={{ maxWidth: 420, minWidth: 200, flex: 1 }}>
        <div className="text-[13px] font-medium mb-0.5" style={{ color: 'var(--lum-text)' }}>{label}</div>
        {desc && <div className="text-[11px] leading-relaxed" style={{ color: 'var(--lum-text-muted)' }}>{desc}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

interface SettingsProps {
  onLock: () => void;
  setPage: (p: NavPage) => void;
}

export default function Settings({ onLock, setPage }: SettingsProps) {
  const [tab, setTab] = useState<Tab>('general');
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = usePrefs();
  const [theme, setTheme] = useTheme();
  const narrow = useMediaQuery('(max-width: 860px)');

  // ── GGUF models folder (persisted on the backend) ─────────
  const [ggufInput,  setGgufInput]  = useState('');
  const [ggufSaved,  setGgufSaved]  = useState<string | null>(null);
  const [ggufBusy,   setGgufBusy]   = useState(false);
  const [ggufMsg,    setGgufMsg]    = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);

  // ── Live provider health (network tab) ────────────────────
  const [health, setHealth] = useState<Record<string, ProviderHealth> | null>(null);

  // ── PIN setup state ────────────────────────────────────────
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [settingPin, setSettingPin] = useState(false);

  // ── Danger zone ────────────────────────────────────────────
  const [wipeArmed, setWipeArmed] = useState(false);
  const [wipeMsg, setWipeMsg] = useState<string | null>(null);

  // ── Integrations (API keys) ────────────────────────────────
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [intBusy, setIntBusy] = useState<string | null>(null);
  const [intMsg, setIntMsg] = useState<Record<string, { kind: 'ok' | 'error'; text: string } | undefined>>({});

  useEffect(() => {
    integrationsApi.list().then(setIntegrations).catch(() => setIntegrations([]));
  }, []);

  const saveKey = async (id: string) => {
    const value = (keyDrafts[id] ?? '').trim();
    if (!value) return;
    setIntBusy(id);
    setIntMsg((m) => ({ ...m, [id]: undefined }));
    try {
      const updated = await integrationsApi.save(id, value);
      setIntegrations((list) => (list ?? []).map((i) => (i.id === id ? updated : i)));
      setKeyDrafts((d) => ({ ...d, [id]: '' })); // never keep the key in the UI
      setIntMsg((m) => ({ ...m, [id]: { kind: 'ok', text: `${updated.unlocks}: unlocked` } }));
    } catch (err) {
      setIntMsg((m) => ({ ...m, [id]: { kind: 'error', text: err instanceof Error ? err.message : 'Failed to save key' } }));
    } finally {
      setIntBusy(null);
    }
  };

  const removeKey = async (id: string) => {
    setIntBusy(id);
    setIntMsg((m) => ({ ...m, [id]: undefined }));
    try {
      const updated = await integrationsApi.remove(id);
      setIntegrations((list) => (list ?? []).map((i) => (i.id === id ? updated : i)));
      setKeyDrafts((d) => ({ ...d, [id]: '' }));
      setIntMsg((m) => ({ ...m, [id]: { kind: 'ok', text: `${updated.label} key removed — ${updated.unlocks} needs a key again.` } }));
    } catch (err) {
      setIntMsg((m) => ({ ...m, [id]: { kind: 'error', text: err instanceof Error ? err.message : 'Failed to remove key' } }));
    } finally {
      setIntBusy(null);
    }
  };

  useEffect(() => {
    settingsApi.get()
      .then((s) => {
        setGgufSaved(s.ggufFolder);
        setGgufInput(s.ggufFolder ?? '');
      })
      .catch((err) => setGgufMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load settings' }));
    modelsApi.health()
      .then((h) => {
        setHealth(h);
        setLocalStatus(h['local']?.message ?? null);
      })
      .catch(() => { setLocalStatus(null); setHealth(null); });
  }, []);

  const saveGgufFolder = async (path: string | null) => {
    setGgufBusy(true);
    setGgufMsg(null);
    try {
      const s = await settingsApi.setGgufFolder(path);
      setGgufSaved(s.ggufFolder);
      setGgufInput(s.ggufFolder ?? '');
      setGgufMsg({
        kind: 'ok',
        text: s.ggufFolder
          ? 'Folder saved. Discovered .gguf files now appear on the Models page.'
          : 'Folder cleared — GGUF discovery is off.',
      });
    } catch (err) {
      setGgufMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save folder' });
    } finally {
      setGgufBusy(false);
    }
  };

  const savePin = () => {
    if (!/^\d{4,8}$/.test(pinDraft)) { setPinError('PIN must be 4–8 digits'); return; }
    if (pinDraft !== pinConfirm) { setPinError('PINs do not match'); return; }
    setPrefs({ lockPin: pinDraft });
    setPinDraft(''); setPinConfirm(''); setPinError(null); setSettingPin(false);
  };

  const wipeConversations = async () => {
    if (!wipeArmed) { setWipeArmed(true); return; }
    setWipeArmed(false);
    try {
      const list = await chatApi.listConversations();
      await Promise.all(list.map((c) => chatApi.deleteConversation(c.id)));
      setWipeMsg(`Deleted ${list.length} conversation${list.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setWipeMsg(err instanceof Error ? err.message : 'Failed to clear conversations');
    }
    setTimeout(() => setWipeMsg(null), 4000);
  };

  // ── Search across every tab ────────────────────────────────
  const searchIndex: Array<{ tab: Tab; label: string; desc: string }> = useMemo(() => [
    { tab: 'general',    label: 'Stream Tokens',            desc: 'tokens realtime generation typing' },
    { tab: 'general',    label: 'Send on Enter',            desc: 'enter key newline shortcut send' },
    { tab: 'general',    label: 'Confirm Before Delete',    desc: 'delete conversation confirmation guard' },
    { tab: 'general',    label: 'Show Performance Stats',   desc: 'tokens per second duration metadata' },
    { tab: 'general',    label: 'Temperature',              desc: 'sampling temperature creativity' },
    { tab: 'general',    label: 'Context Length',           desc: 'token context window num_ctx inference' },
    { tab: 'appearance', label: 'Theme Center',             desc: 'glass blur wallpaper accent font snow rain theme customize' },
    { tab: 'appearance', label: 'Focus Mode',               desc: 'black minimal distraction free dark no glass' },
    { tab: 'appearance', label: 'Accent Color',             desc: 'accent color quick pick' },
    { tab: 'appearance', label: 'Motion',                   desc: 'animations reduced motion static' },
    { tab: 'models',     label: 'GGUF Models Folder',       desc: 'gguf folder scan local models drop' },
    { tab: 'models',     label: 'GGUF Runtime',             desc: 'node-llama-cpp runtime inference gpu' },
    { tab: 'network',    label: 'Provider Health',          desc: 'ollama endpoint latency status connection' },
    { tab: 'network',    label: 'API Base',                 desc: 'backend server port address' },
    { tab: 'integrations', label: 'API Keys',               desc: 'integration api key tavily deep research web search discord unlock paste secret' },
    { tab: 'security',   label: 'Require Authentication',   desc: 'pin lock screen protect login' },
    { tab: 'security',   label: 'Privacy Frost',            desc: 'blur window unfocused privacy hide' },
    { tab: 'security',   label: 'Clear All Conversations',  desc: 'delete wipe chat history' },
  ], []);

  const results = query.trim()
    ? searchIndex.filter(r => `${r.label} ${r.desc}`.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  /** True when this row should glow (arrived here via search). */
  const [highlight, setHighlight] = useState<string | null>(null);
  const jumpTo = (t: Tab, label: string) => {
    setTab(t);
    setQuery('');
    setHighlight(label);
    setTimeout(() => setHighlight(null), 2200);
  };

  const glow = (label: string): React.CSSProperties =>
    highlight === label
      ? { background: 'var(--lum-violet-soft)', borderRadius: 12, padding: '0 12px', margin: '0 -12px', transition: 'background 1.2s ease' }
      : { transition: 'background 1.2s ease' };

  const tabButton = (t: Tab) => {
    const TabIcon = TAB_ICONS[t];
    const active = tab === t;
    return (
      <motion.button
        key={t}
        onClick={() => { setTab(t); setQuery(''); }}
        whileHover={active ? undefined : { x: narrow ? 0 : 2 }}
        whileTap={{ scale: 0.97 }}
        className="relative flex items-center gap-2.5 rounded-[10px] text-[13px] capitalize text-left flex-shrink-0"
        style={{
          padding: narrow ? '8px 13px' : '9px 14px',
          width: narrow ? undefined : '100%',
          background: 'transparent',
          color: active ? 'var(--lum-aurora)' : 'var(--lum-text-secondary)',
          border: 'none', cursor: 'pointer',
          fontWeight: active ? 600 : 450,
          transition: 'color 0.2s',
          whiteSpace: 'nowrap',
        }}
      >
        {active && (
          <motion.span layoutId="settings-pill" transition={springGentle}
            className="absolute inset-0 rounded-[10px]"
            style={{ background: 'var(--lum-violet-soft)', border: '1px solid rgb(var(--lum-accent-rgb) / 0.25)' }} />
        )}
        <TabIcon size={14} className="relative flex-shrink-0" style={{ zIndex: 1 }} />
        <span className="relative" style={{ zIndex: 1 }}>{t}</span>
      </motion.button>
    );
  };

  return (
    <div className={`flex flex-1 overflow-hidden ${narrow ? 'flex-col' : ''}`}>
      {/* Tab rail — vertical on wide screens, horizontal chips on narrow */}
      {narrow ? (
        <div className="flex-shrink-0 flex gap-1 px-3 py-2 overflow-x-auto"
             style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,11,18,0.3)' }}>
          {TABS.map(tabButton)}
        </div>
      ) : (
        <div className="flex-shrink-0 py-4 px-2.5 flex flex-col gap-1"
             style={{ width: 184, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,11,18,0.3)' }}>
          {TABS.map(tabButton)}
        </div>
      )}

      {/* Content — constrained line length for calm reading */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 'clamp(16px, 2.4vw, 32px)' }}>
        <div style={{ maxWidth: 860 }}>
        <div className="flex items-start justify-between mb-6 gap-6 flex-wrap">
          <div>
            <h2 className="text-[19px] font-bold capitalize mb-1 tracking-tight" style={{ color: 'var(--lum-aurora)' }}>{tab}</h2>
            <p className="text-[12px]" style={{ color: 'var(--lum-text-muted)' }}>Configure {tab} settings for Luminary OS</p>
          </div>
          {/* Search across all settings */}
          <div className="relative">
            <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] lum-glass-subtle" style={{ width: 260, maxWidth: '70vw' }}>
              <Search size={13} color="var(--lum-text-muted)" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings…"
                style={{ background: 'transparent', border: 'none', color: 'var(--lum-text)', fontSize: 12.5, outline: 'none', flex: 1 }} />
            </div>
            <AnimatePresence>
              {results.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={springGentle}
                  className="absolute right-0 mt-2 w-[300px] lum-glass-strong overflow-hidden z-20"
                  style={{ borderRadius: 12 }}>
                  {results.map(r => (
                    <button key={`${r.tab}-${r.label}`} onClick={() => jumpTo(r.tab, r.label)}
                      className="flex flex-col w-full text-left px-4 py-2.5"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--lum-text)' }}>{r.label}</span>
                      <span className="text-[10.5px] capitalize" style={{ color: 'var(--lum-text-muted)' }}>{r.tab}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={tab === 'about' ? undefined : 'lum-glass lum-reflect lum-luminous'}
            onPointerMove={tab === 'about' ? undefined : pointerLight}
            style={tab === 'about' ? undefined : { padding: '6px 24px 10px' }}>

            {tab === 'general' && (
              <>
                <div style={glow('Stream Tokens')}>
                  <SettingRow label="Stream Tokens" desc="Show tokens as they generate. Off reveals each reply only when it is complete.">
                    <Toggle label="Stream tokens" value={prefs.streamTokens} onChange={(v) => setPrefs({ streamTokens: v })} />
                  </SettingRow>
                </div>
                <div style={glow('Send on Enter')}>
                  <SettingRow label="Send on Enter" desc="Enter sends the message and Shift+Enter adds a line. Off swaps them: Ctrl+Enter sends.">
                    <Toggle label="Send on Enter" value={prefs.sendOnEnter} onChange={(v) => setPrefs({ sendOnEnter: v })} />
                  </SettingRow>
                </div>
                <div style={glow('Confirm Before Delete')}>
                  <SettingRow label="Confirm Before Delete" desc="Ask before permanently deleting a conversation.">
                    <Toggle label="Confirm deletion" value={prefs.confirmDelete} onChange={(v) => setPrefs({ confirmDelete: v })} />
                  </SettingRow>
                </div>
                <div style={glow('Show Performance Stats')}>
                  <SettingRow label="Show Performance Stats" desc="Display generation time and tokens/second under assistant replies.">
                    <Toggle label="Show performance" value={prefs.showPerf} onChange={(v) => setPrefs({ showPerf: v })} />
                  </SettingRow>
                </div>
                <div style={glow('Temperature')}>
                  <SettingRow label="Temperature" desc="Sampling temperature (0–2) sent with every generation. Empty uses the model's default.">
                    <NumberInput value={prefs.temperature} min={0} max={2} step={0.1}
                      placeholder="model default"
                      onCommit={(v) => setPrefs({ temperature: v })} />
                  </SettingRow>
                </div>
                <div style={glow('Context Length')}>
                  <SettingRow label="Context Length" desc="Context window (num_ctx) for Ollama models. Empty uses the model's default.">
                    <NumberInput value={prefs.contextLength} min={512} max={131072} step={512}
                      placeholder="model default"
                      onCommit={(v) => setPrefs({ contextLength: v })} />
                  </SettingRow>
                </div>
              </>
            )}

            {tab === 'appearance' && (
              <>
                <div style={glow('Theme Center')}>
                  <SettingRow label="Theme Center" desc="Glass, blur, wallpapers, weather, fonts, corner radius, saved themes — the full identity studio.">
                    <Button variant="accent" size="sm" onClick={() => setPage('theme')}>
                      <Palette size={12} /> Open Theme Center <ArrowRight size={12} />
                    </Button>
                  </SettingRow>
                </div>
                <div style={glow('Focus Mode')}>
                  <SettingRow label="Focus Mode" desc="Pure black, no glass, no wallpaper — the whole interface steps back so the work is all that glows.">
                    <Toggle label="Focus mode" value={theme.mode === 'focus'} onChange={(v) => setTheme({ mode: v ? 'focus' : 'glass' })} />
                  </SettingRow>
                </div>
                <div style={glow('Accent Color')}>
                  <SettingRow label="Accent Color" desc="Quick pick — more colors and custom values in the Theme Center.">
                    <div className="flex items-center gap-2">
                      {ACCENT_QUICK.map((hex) => (
                        <button key={hex} onClick={() => setTheme({ accent: hex })}
                          title={hex}
                          style={{
                            width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
                            background: hex,
                            border: theme.accent.toLowerCase() === hex.toLowerCase() ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                            boxShadow: theme.accent.toLowerCase() === hex.toLowerCase() ? `0 0 12px ${hex}AA` : 'none',
                            transition: 'border-color 0.2s, box-shadow 0.25s',
                          }} />
                      ))}
                    </div>
                  </SettingRow>
                </div>
                <div style={glow('Motion')}>
                  <SettingRow label="Motion" desc="Fluid springs, calmer transitions, or a fully static interface.">
                    <Segmented
                      value={theme.motion}
                      onChange={(motion) => setTheme({ motion })}
                      grow={false}
                      options={[
                        { value: 'full', label: 'Fluid' },
                        { value: 'reduced', label: 'Calm' },
                        { value: 'off', label: 'Static' },
                      ]}
                    />
                  </SettingRow>
                </div>
              </>
            )}

            {tab === 'models' && (
              <>
                <div style={glow('GGUF Models Folder')}>
                  <div
                    className="flex items-start justify-between py-4"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.055)', flexWrap: 'wrap', gap: 12 }}
                  >
                    <div style={{ maxWidth: 400 }}>
                      <div className="text-[13px] font-medium mb-0.5" style={{ color: 'var(--lum-text)' }}>Extra GGUF Models Folder</div>
                      <div className="text-[11px] leading-relaxed" style={{ color: 'var(--lum-text-muted)' }}>
                        The <span className="font-mono">models/</span> folder beside run.bat is always
                        scanned automatically (recursively, live) — just drop .gguf files there.
                        Optionally add one extra folder here. Only file paths and metadata are
                        stored — model files are never copied or moved.
                      </div>
                      {ggufSaved && (
                        <div className="text-[11px] font-mono mt-2 flex items-center gap-1.5" style={{ color: 'var(--lum-text-secondary)' }}>
                          <FolderOpen size={11} /> {ggufSaved}
                        </div>
                      )}
                      <AnimatePresence>
                        {ggufMsg && (
                          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="text-[11px] mt-2 flex items-center gap-1.5"
                            style={{ color: ggufMsg.kind === 'ok' ? 'var(--lum-success)' : 'var(--lum-danger)' }}>
                            {ggufMsg.kind === 'ok' ? <Check size={11} /> : <AlertTriangle size={11} />}
                            {ggufMsg.text}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap" style={{ marginLeft: 'auto' }}>
                      <input
                        value={ggufInput}
                        onChange={(e) => setGgufInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveGgufFolder(ggufInput); }}
                        placeholder="C:\\path\\to\\gguf-models"
                        className="lum-glass-subtle font-mono"
                        style={{ padding: '7px 12px', color: 'var(--lum-text)', fontSize: 12, outline: 'none', width: 'min(300px, 60vw)' }}
                      />
                      <Button variant="accent" size="sm" disabled={ggufBusy || !ggufInput.trim()}
                        onClick={() => saveGgufFolder(ggufInput)}>
                        {ggufBusy ? 'Saving…' : 'Save'}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={ggufBusy || !ggufSaved}
                        onClick={() => saveGgufFolder(null)}>
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>
                <div style={glow('GGUF Runtime')}>
                  <SettingRow
                    label="GGUF Runtime"
                    desc={localStatus ?? 'Querying local provider status…'}
                  >
                    <span className="text-[11px] font-medium" style={{
                      color: localStatus?.includes('ready') ? 'var(--lum-success)' : 'var(--lum-warning)'
                    }}>
                      {localStatus == null ? '…' : localStatus.includes('ready') ? 'Available' : 'Unavailable'}
                    </span>
                  </SettingRow>
                </div>
              </>
            )}

            {tab === 'network' && (
              <>
                <div style={glow('Provider Health')}>
                  <div className="py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
                    <div className="text-[13px] font-medium mb-0.5" style={{ color: 'var(--lum-text)' }}>Provider Health</div>
                    <div className="text-[11px] mb-3" style={{ color: 'var(--lum-text-muted)' }}>
                      Live status of every model provider. The Ollama endpoint is set with the
                      <span className="font-mono"> OLLAMA_BASE_URL</span> environment variable before launch.
                    </div>
                    {health == null ? (
                      <div className="text-[11.5px]" style={{ color: 'var(--lum-text-muted)' }}>Backend unreachable — no live health data.</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {Object.entries(health).map(([id, h]) => (
                          <div key={id} className="flex items-center gap-3 px-3.5 py-2.5 lum-glass-subtle flex-wrap">
                            <StatusDot status={h.status === 'connected' ? 'connected' : h.status === 'initialising' ? 'pairing' : 'offline'} />
                            <span className="text-[12px] font-semibold capitalize" style={{ color: 'var(--lum-text)', minWidth: 56 }}>{id}</span>
                            <span className="text-[11px] font-mono flex-1" style={{ color: 'var(--lum-text-secondary)', minWidth: 180 }}>
                              {h.message ?? h.status}
                            </span>
                            {h.latencyMs != null && (
                              <span className="text-[10.5px] font-mono" style={{ color: 'var(--lum-text-muted)' }}>{h.latencyMs}ms</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={glow('API Base')}>
                  <SettingRow label="API Base" desc="All frontend traffic goes through this address (Vite proxies /api to the backend).">
                    <span className="text-[12px] font-mono" style={{ color: 'var(--lum-text-secondary)' }}>
                      {window.location.origin}/api
                    </span>
                  </SettingRow>
                </div>
              </>
            )}

            {tab === 'integrations' && (
              <>
                {integrations == null ? (
                  <div className="py-4 text-[12px]" style={{ color: 'var(--lum-text-muted)' }}>Loading integrations…</div>
                ) : integrations.length === 0 ? (
                  <div className="py-4 text-[12px]" style={{ color: 'var(--lum-text-muted)' }}>No integrations available.</div>
                ) : (
                  integrations.map((it) => {
                    const msg = intMsg[it.id];
                    return (
                      <div key={it.id} style={glow('API Keys')}>
                        <div
                          className="flex items-start justify-between py-4"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.055)', flexWrap: 'wrap', gap: 12 }}
                        >
                          <div style={{ maxWidth: 420 }}>
                            <div className="text-[13px] font-medium mb-0.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--lum-text)' }}>
                              {it.label} API Key
                              {it.configured ? (
                                <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: 'var(--lum-success)' }}>
                                  <Check size={11} /> {it.unlocks}: unlocked
                                </span>
                              ) : (
                                <span className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>{it.unlocks} needs a key</span>
                              )}
                            </div>
                            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--lum-text-muted)' }}>
                              Paste your {it.label} API key to unlock {it.unlocks}. It is stored locally on this
                              machine and takes effect immediately — no restart. The key is never shown again after
                              saving{it.source === 'env' ? ', and is currently provided by an environment variable' : ''}.
                            </div>
                            <AnimatePresence>
                              {msg && (
                                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                  className="text-[11px] mt-2 flex items-center gap-1.5"
                                  style={{ color: msg.kind === 'ok' ? 'var(--lum-success)' : 'var(--lum-danger)' }}>
                                  {msg.kind === 'ok' ? <Check size={11} /> : <AlertTriangle size={11} />}
                                  {msg.text}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap" style={{ marginLeft: 'auto' }}>
                            <input
                              type="password"
                              autoComplete="off"
                              value={keyDrafts[it.id] ?? ''}
                              onChange={(e) => setKeyDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveKey(it.id); }}
                              placeholder={it.configured ? 'Paste a new key to replace' : `Paste ${it.label} API key`}
                              className="lum-glass-subtle font-mono"
                              style={{ padding: '7px 12px', color: 'var(--lum-text)', fontSize: 12, outline: 'none', width: 'min(300px, 60vw)' }}
                            />
                            <Button variant="accent" size="sm" disabled={intBusy === it.id || !(keyDrafts[it.id] ?? '').trim()}
                              onClick={() => saveKey(it.id)}>
                              {intBusy === it.id ? 'Saving…' : 'Save'}
                            </Button>
                            {it.configured && it.source === 'saved' && (
                              <Button variant="ghost" size="sm" disabled={intBusy === it.id} onClick={() => removeKey(it.id)}>
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {tab === 'security' && (
              <>
                <div style={glow('Require Authentication')}>
                  <SettingRow
                    label="Require Authentication"
                    desc={prefs.lockPin
                      ? 'A PIN guards this interface at launch. This protects the screen, not the data on disk.'
                      : 'Set a 4–8 digit PIN. Luminary will show a lock screen at launch.'}
                  >
                    <div className="flex items-center gap-2">
                      {prefs.lockPin && (
                        <Button variant="ghost" size="sm" onClick={onLock}>
                          <Lock size={12} /> Lock now
                        </Button>
                      )}
                      <Toggle
                        label="Enable PIN lock"
                        value={prefs.lockPin != null || settingPin}
                        onChange={(v) => {
                          if (v) { setSettingPin(true); }
                          else { setPrefs({ lockPin: null }); setSettingPin(false); setPinDraft(''); setPinConfirm(''); setPinError(null); }
                        }}
                      />
                    </div>
                  </SettingRow>
                  <AnimatePresence>
                    {settingPin && !prefs.lockPin && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 py-3 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
                          <input type="password" inputMode="numeric" value={pinDraft} placeholder="New PIN"
                            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 8))}
                            className="lum-glass-subtle font-mono"
                            style={{ padding: '7px 12px', color: 'var(--lum-text)', fontSize: 12, outline: 'none', width: 110 }} />
                          <input type="password" inputMode="numeric" value={pinConfirm} placeholder="Confirm"
                            onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                            onKeyDown={(e) => { if (e.key === 'Enter') savePin(); }}
                            className="lum-glass-subtle font-mono"
                            style={{ padding: '7px 12px', color: 'var(--lum-text)', fontSize: 12, outline: 'none', width: 110 }} />
                          <Button variant="accent" size="sm" onClick={savePin} disabled={pinDraft.length < 4}>
                            <Check size={12} /> Set PIN
                          </Button>
                          {pinError && <span className="text-[11px]" style={{ color: 'var(--lum-danger)' }}>{pinError}</span>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div style={glow('Privacy Frost')}>
                  <SettingRow label="Privacy Frost" desc="Blur the entire interface the instant the window loses focus.">
                    <Toggle label="Privacy blur" value={prefs.privacyBlur} onChange={(v) => setPrefs({ privacyBlur: v })} />
                  </SettingRow>
                </div>
                <div style={glow('Clear All Conversations')}>
                  <SettingRow
                    label="Clear All Conversations"
                    desc={wipeMsg ?? 'Permanently delete every chat conversation stored on this machine.'}
                  >
                    <Button variant="danger" size="sm" onClick={wipeConversations}>
                      <Trash2 size={12} /> {wipeArmed ? 'Click again to confirm' : 'Clear all'}
                    </Button>
                  </SettingRow>
                </div>
              </>
            )}

            {tab === 'about' && (
              <div className="max-w-md">
                <Card reflect style={{ padding: 28, textAlign: 'center', marginBottom: 20 }}>
                  <div
                    className="flex items-center justify-center rounded-2xl mx-auto mb-4 lum-float"
                    style={{ width: 56, height: 56, background: 'var(--lum-accent-grad)', boxShadow: '0 0 28px rgb(var(--lum-accent-rgb) / 0.45), inset 0 1px 0 rgba(255,255,255,0.3)' }}
                  >
                    <Sparkles size={24} color="#fff" />
                  </div>
                  <div className="text-[20px] font-bold mb-1 tracking-tight" style={{ color: 'var(--lum-aurora)' }}>Luminary OS</div>
                  <div className="text-[13px] mb-4" style={{ color: 'var(--lum-text-muted)' }}>Version 0.1.0 · developer preview</div>
                  <div className="text-[12px] leading-loose" style={{ color: 'var(--lum-text-secondary)' }}>
                    An operating system interface for orchestrating<br />
                    AI agents, local models, and connected devices.
                  </div>
                </Card>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Runtime',   value: 'Node.js 20.x' },
                    { label: 'Frontend',  value: 'React 18 + Vite' },
                    { label: 'Inference', value: 'Ollama + llama.cpp' },
                    { label: 'License',   value: 'MIT' },
                  ].map(({ label, value }) => (
                    <Card key={label} style={{ padding: 14 }}>
                      <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--lum-text-muted)' }}>{label}</div>
                      <div className="font-mono text-[12px]" style={{ color: 'var(--lum-text-secondary)' }}>{value}</div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
