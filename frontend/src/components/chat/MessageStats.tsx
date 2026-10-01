// ============================================================
// MessageStats — the per-reply metadata line plus an expandable
// performance panel (input/output tokens, context window, context
// remaining). Every number shown is a REAL value reported by the
// model provider for that specific generation; anything the
// provider did not report renders as "unknown" — never a guess.
// Shared by the Dashboard chat and Professional mode.
// ============================================================

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '@/types';

const fmt = (v: number | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : 'unknown';

/** Context remaining = window − used. Both must be real; else unknown. */
function remaining(msg: ChatMessage): string {
  if (typeof msg.contextWindow !== 'number' || typeof msg.contextUsed !== 'number') return 'unknown';
  const left = Math.max(0, msg.contextWindow - msg.contextUsed);
  const pct = msg.contextWindow > 0 ? Math.round((left / msg.contextWindow) * 100) : 0;
  return `${left.toLocaleString()} (${pct}%)`;
}

interface MessageStatsProps {
  msg: ChatMessage;
  /** Hide perf numbers (duration/tok/s + panel) per the Settings toggle. */
  showPerf: boolean;
  /** Message is still streaming — perf data does not exist yet. */
  streaming: boolean;
  /** Professional mode styling (flat, quieter). */
  pro?: boolean;
}

export default function MessageStats({ msg, showPerf, streaming, pro }: MessageStatsProps) {
  const [open, setOpen] = useState(false);
  if (!msg.agentName && !msg.model) return null;

  const muted = pro ? 'rgba(255,255,255,0.38)' : 'var(--lum-text-muted)';

  const cells: Array<[string, string]> = [
    ['Input tokens', fmt(msg.inputTokens)],
    ['Output tokens', fmt(msg.outputTokens)],
    ['Context window', fmt(msg.contextWindow)],
    ['Context left', remaining(msg)],
  ];

  return (
    <div className="mb-1.5">
      <div className="text-[10px] flex items-center gap-2" style={{ color: muted }}>
        {msg.agentName && <span>{msg.agentName}</span>}
        {msg.model && <span className="font-mono">· {msg.model}</span>}
        {showPerf && msg.durationMs != null && !streaming && <span>· {(msg.durationMs / 1000).toFixed(1)}s</span>}
        {showPerf && msg.tokensPerSecond != null && <span>· {msg.tokensPerSecond} tok/s</span>}
        {msg.stopped && <span style={{ color: 'var(--lum-warning)' }}>· stopped</span>}
        {showPerf && !streaming && (
          <button
            onClick={() => setOpen((o) => !o)}
            title="Performance details"
            className="flex items-center"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'inherit', padding: '1px 2px',
            }}
          >
            <motion.span animate={{ rotate: open ? 180 : 0 }} className="flex">
              <ChevronDown size={11} />
            </motion.span>
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && showPerf && !streaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div
              className="grid gap-x-5 gap-y-1 px-3 py-2 mt-1.5"
              style={{
                gridTemplateColumns: 'repeat(2, minmax(0, max-content))',
                borderRadius: 10,
                background: pro ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${pro ? 'rgba(255,255,255,0.07)' : 'var(--lum-glass-border)'}`,
              }}
            >
              {cells.map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2 text-[10.5px]">
                  <span style={{ color: muted }}>{label}</span>
                  <span className="font-mono tabular" style={{ color: pro ? 'rgba(255,255,255,0.72)' : 'var(--lum-text-secondary)' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
