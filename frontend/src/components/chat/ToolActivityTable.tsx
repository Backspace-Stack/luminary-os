// ============================================================
// ToolActivityTable — the Agent view's live tool-call table.
//
// Every row is a REAL tool invocation observed on the generation
// event stream (tool_call_started / tool_call_result from
// BaseAgent's loop) for the active conversation this session.
// Rows appear the moment the agent proposes a call and resolve
// in place when its result arrives. No placeholder rows, ever —
// an empty session says so honestly.
// ============================================================

import { Wrench, Check, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToolLogRow } from '@/hooks/useChat';

const COLORS = {
  border: 'rgba(255,255,255,0.07)',
  text: 'rgba(255,255,255,0.92)',
  soft: 'rgba(255,255,255,0.6)',
  mute: 'rgba(255,255,255,0.38)',
  headBg: 'rgba(255,255,255,0.03)',
};

function argsPreview(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return '—';
  const s = JSON.stringify(args);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function StatusCell({ row }: { row: ToolLogRow }) {
  if (row.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--lum-accent)' }}>
        <Loader2 size={11} className="lum-spin" /> running
      </span>
    );
  }
  if (row.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--lum-danger)' }}>
        <X size={11} /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--lum-success)' }}>
      <Check size={11} /> ok
    </span>
  );
}

export default function ToolActivityTable({ rows }: { rows: ToolLogRow[] }) {
  return (
    <div
      className="overflow-hidden"
      style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, background: COLORS.headBg }}
    >
      <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: rows.length ? `1px solid ${COLORS.border}` : 'none' }}>
        <Wrench size={12} style={{ color: 'var(--lum-accent)' }} />
        <span className="text-[11.5px] font-semibold" style={{ color: COLORS.text }}>Tool activity</span>
        <span className="text-[10.5px]" style={{ color: COLORS.mute }}>
          {rows.length === 0 ? 'live tool calls appear here as the agent works' : `${rows.length} call${rows.length === 1 ? '' : 's'} this session`}
        </span>
      </div>
      {rows.length > 0 && (
        <div style={{ maxHeight: 170, overflowY: 'auto', overflowX: 'auto' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: COLORS.mute, textAlign: 'left' }}>
                <th className="px-3.5 py-1.5 font-medium" style={{ width: 26 }}>#</th>
                <th className="px-2 py-1.5 font-medium">Tool</th>
                <th className="px-2 py-1.5 font-medium">Action</th>
                <th className="px-2 py-1.5 font-medium">Arguments</th>
                <th className="px-2 py-1.5 font-medium" style={{ width: 82 }}>Status</th>
                <th className="px-2 py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((row, i) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18 }}
                    style={{ borderTop: `1px solid ${COLORS.border}`, color: COLORS.soft, verticalAlign: 'top' }}
                  >
                    <td className="px-3.5 py-1.5 font-mono" style={{ color: COLORS.mute }}>{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{row.plugin}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap" style={{ color: COLORS.text }}>{row.action}</td>
                    <td className="px-2 py-1.5 font-mono" style={{ maxWidth: 260, wordBreak: 'break-all' }}>{argsPreview(row.args)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><StatusCell row={row} /></td>
                    <td className="px-2 py-1.5" style={{ maxWidth: 300, wordBreak: 'break-word' }}>
                      {row.summary ?? (row.status === 'running' ? '…' : '—')}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
