// ============================================================
// ModelPicker — a "which model" selector for the prompt bar, à la
// Claude Code. Lists every REAL installed, runnable model (Ollama
// tags + GGUF files, live via useModels) and assigns the chosen one
// to the CURRENT agent (coding-agent in the Code view, etc.) through
// the same agents API the Models page uses. The choice persists
// server-side and takes effect on the next generation.
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Cpu } from 'lucide-react';
import { useModels } from '@/hooks/useModels';
import { useAgents } from '@/hooks/useAgents';

const C = {
  bg: '#26272C',
  border: 'rgba(255,255,255,0.1)',
  borderSoft: 'rgba(255,255,255,0.07)',
  text: 'rgba(255,255,255,0.92)',
  soft: 'rgba(255,255,255,0.6)',
  mute: 'rgba(255,255,255,0.42)',
  hover: 'rgba(255,255,255,0.06)',
};

export default function ModelPicker({ agentId, minimal = false }: { agentId: string; minimal?: boolean }) {
  const { models, loading } = useModels();
  const { agents, setModel, error, clearError } = useAgents();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = agents.find((a) => a.id === agentId)?.defaultModel ?? null;

  // Only models that can actually answer a chat: runnable, non-embedding.
  const options = models.filter((m) => m.runnable !== false && m.type !== 'embedding');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try { if (await setModel(agentId, id)) setOpen(false); }
    finally { setSaving(false); }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { clearError(); setOpen((o) => !o); }}
        disabled={saving}
        title="Choose the model this agent runs"
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: minimal ? '5px 0' : '5px 10px', borderRadius: 9, cursor: 'pointer',
          background: open ? C.hover : (minimal ? 'transparent' : 'rgba(255,255,255,0.04)'),
          border: minimal ? 'none' : `1px solid ${C.borderSoft}`,
          color: C.text, fontSize: 12, fontFamily: 'inherit',
          transition: 'background 0.15s ease',
          maxWidth: 260,
        }}
      >
        <Cpu size={12} style={{ color: 'var(--lum-accent)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--lum-font-mono, monospace)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current ?? (loading ? 'Loading models…' : 'Select model')}
        </span>
        <ChevronDown size={13} style={{ color: C.mute, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 50,
            minWidth: 280, maxWidth: 360, maxHeight: 320, overflowY: 'auto',
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
            boxShadow: '0 20px 48px -16px rgba(0,0,0,0.8)', padding: 6,
          }}
        >
          <div style={{ fontSize: 10.5, color: C.mute, padding: '4px 10px 6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Model · {options.length} available
          </div>
          {error && <div role="alert" style={{ padding: '6px 10px', fontSize: 12, color: 'var(--lum-danger)' }}>{error}</div>}
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: C.mute }}>
              {loading ? 'Loading…' : 'No runnable models installed.'}
            </div>
          )}
          {options.map((m) => {
            const active = m.id === current;
            return (
              <button
                key={`${m.providerId}:${m.id}`}
                onClick={() => pick(m.id)}
                disabled={saving}
                role="option"
                aria-selected={active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: active ? 'rgb(var(--lum-accent-rgb) / 0.14)' : 'transparent',
                  color: C.text, transition: 'background 0.12s ease',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 14, flexShrink: 0, display: 'flex' }}>
                  {active && <Check size={13} style={{ color: 'var(--lum-accent)' }} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: C.mute }}>
                    {m.providerId}{m.sizeLabel && m.sizeLabel !== '—' ? ` · ${m.sizeLabel}` : ''}{m.status === 'loaded' ? ' · loaded' : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
