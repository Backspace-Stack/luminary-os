// ============================================================
// UsageAnalytics — a real usage dashboard for Professional mode,
// modelled on Claude's "What's up next" home card. Two tabs:
//   • Overview — headline stat tiles + a GitHub-style activity
//     calendar + a playful token comparison.
//   • Models — a per-day stacked bar chart + a ranked model legend.
// Every value comes from GET /api/chat/analytics — computed from the
// user's actual chat history. Nothing here is placeholder data; when
// a figure genuinely can't be determined it shows "—", never a guess.
//
// The Models chart is metric-adaptive (see AnalyticsService): it plots
// tokens once enough messages record them, otherwise message counts —
// the honest "which models did I use most" signal for older history.
// A small caption states which metric is in view.
// ============================================================

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { chatApi } from '@/services/api';
import type { Analytics, AnalyticsRange, AnalyticsDay } from '@/types';

// The reference card is all-blue regardless of the chosen accent, so the
// data viz reads the same everywhere. Ranked brightest→palest for models.
const BLUES = ['#4d8bf0', '#6ba0f4', '#8bb6f7', '#a9ccfa', '#c4ddfc', '#dcebfe'];
// Calendar intensity ramp (empty → busiest).
const HEAT = ['rgba(255,255,255,0.05)', '#1f3a63', '#2f5a99', '#4a82d8', '#6ba3f5'];

const C = {
  page: '#232428',
  card: '#1c1d21',
  tile: 'rgba(255,255,255,0.045)',
  border: 'rgba(255,255,255,0.08)',
  borderSoft: 'rgba(255,255,255,0.06)',
  text: 'rgba(255,255,255,0.94)',
  soft: 'rgba(255,255,255,0.6)',
  mute: 'rgba(255,255,255,0.4)',
  dim: 'rgba(255,255,255,0.28)',
};

// The greeting name is the user's own handle (from their account), the
// same one shown in the reference — chrome, not data.
const GREETING_NAME = 'Backspace';

// ── formatting ────────────────────────────────────────────────
const commas = (n: number) => n.toLocaleString('en-US');
function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
function hour12(h: number | null): string {
  if (h === null) return '—';
  const period = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
}
function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function heatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 6) return 2;
  if (count <= 14) return 3;
  return 4;
}

// ── Small UI atoms ────────────────────────────────────────────
function StatTile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div style={{ background: C.tile, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: '11px 13px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.mute, marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div title={title} style={{ fontSize: 17, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: active ? C.text : C.mute,
        transition: 'background 0.18s ease, color 0.18s ease',
      }}
    >
      {children}
    </button>
  );
}

// ── Calendar heatmap ──────────────────────────────────────────
function Calendar({ days }: { days: AnalyticsDay[] }) {
  if (days.length === 0) return null;
  // Pad the front so the first column starts on Sunday, then chunk into
  // week-columns of 7 (GitHub-style: columns = weeks, rows = weekday).
  const [fy, fm, fd] = days[0].date.split('-').map(Number);
  const firstDow = new Date(fy, fm - 1, fd).getDay();
  const cells: (AnalyticsDay | null)[] = [...Array(firstDow).fill(null), ...days];
  const weeks: (AnalyticsDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Array.from({ length: 7 }).map((_, di) => {
            const cell = week[di];
            if (!cell) return <div key={di} style={{ width: 13, height: 13, borderRadius: 3, background: 'transparent' }} />;
            const lvl = heatLevel(cell.count);
            return (
              <div
                key={di}
                title={`${shortDate(cell.date)} · ${cell.count} message${cell.count === 1 ? '' : 's'}`}
                style={{ width: 13, height: 13, borderRadius: 3, background: HEAT[lvl] }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Models stacked bar chart ──────────────────────────────────
function ModelsChart({ data }: { data: Analytics }) {
  const { daily, models, metric } = data;
  const order = models.map((m) => m.model); // ranked; drives stack order + color
  const colorOf = (model: string) => BLUES[Math.min(order.indexOf(model), BLUES.length - 1)] ?? BLUES[BLUES.length - 1];
  const dayTotal = (d: AnalyticsDay) => Object.values(d.byModel).reduce((s, v) => s + v, 0);
  const maxTotal = Math.max(1, ...daily.map(dayTotal));

  // Three y-axis ticks: 0, mid, max — formatted for the active metric.
  const fmtY = (v: number) => (metric === 'tokens' ? compact(Math.round(v)) : String(Math.round(v)));
  const ticks = [maxTotal, maxTotal / 2, 0];
  const CHART_H = 200;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Y axis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: CHART_H, paddingBottom: 20, textAlign: 'right' }}>
          {ticks.map((t, i) => (
            <span key={i} style={{ fontSize: 10, color: C.dim, lineHeight: 1 }}>{fmtY(t)}</span>
          ))}
        </div>
        {/* Bars */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: daily.length > 16 ? 3 : 8, height: CHART_H, minWidth: 0, overflowX: 'auto' }}>
          {daily.map((d) => {
            const total = dayTotal(d);
            const barH = (total / maxTotal) * (CHART_H - 22);
            const segs = order.filter((m) => (d.byModel[m] ?? 0) > 0);
            return (
              <div key={d.date} style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 14 }}>
                <div
                  title={`${shortDate(d.date)} · ${metric === 'tokens' ? compact(total) + ' tokens' : total + ' messages'}`}
                  style={{ width: '100%', maxWidth: 46, height: Math.max(barH, total > 0 ? 3 : 0), display: 'flex', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}
                >
                  {segs.map((m) => (
                    <div key={m} style={{ height: `${((d.byModel[m] ?? 0) / total) * 100}%`, background: colorOf(m) }} />
                  ))}
                </div>
                <span style={{ fontSize: 9.5, color: C.dim, marginTop: 6, whiteSpace: 'nowrap' }}>{shortDate(d.date)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend — ranked models */}
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {models.map((m) => (
          <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: colorOf(m.model), flexShrink: 0 }} />
            <span title={m.model} style={{ fontSize: 12.5, color: C.text, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{m.model}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.mute, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {m.totalTokens > 0
                ? `${compact(m.inputTokens)} in · ${compact(m.outputTokens)} out`
                : `${commas(m.messages)} message${m.messages === 1 ? '' : 's'}`}
            </span>
            <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>{m.pct}%</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 10.5, color: C.dim }}>
        {metric === 'tokens' ? 'By tokens used.' : 'By messages sent — per-token accounting begins with newer messages.'}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
interface UsageAnalyticsProps {
  /** Scope the report to one agent (e.g. 'coding-agent'). Omit for all usage. */
  agent?: string;
  /** Rendered inside another surface (the Code view) rather than as its own
   *  full-bleed page — drops the page background and outer padding. */
  embedded?: boolean;
}

export default function UsageAnalytics({ agent, embedded }: UsageAnalyticsProps = {}) {
  const [range, setRange] = useState<AnalyticsRange>('all');
  const [tab, setTab] = useState<'overview' | 'models'>('overview');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    chatApi.analytics(range, agent)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : 'Failed to load analytics'); setLoading(false); } });
    return () => { alive = false; };
  }, [range, agent]);

  const t = data?.totals;

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: embedded ? 'transparent' : C.page, padding: embedded ? '4px 0 8px' : 'clamp(20px, 4vw, 48px)' }}>
      <div style={{ maxWidth: 640, margin: embedded ? '0' : '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: embedded ? 16 : 22 }}>
          <Sparkles size={embedded ? 19 : 22} style={{ color: '#e8845c', flexShrink: 0 }} />
          <h1 style={{ fontSize: embedded ? 19 : 22, fontWeight: 700, color: C.text, margin: 0 }}>What's up next, {GREETING_NAME}?</h1>
        </div>

        {/* Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
          {/* Tabs + range */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <Pill active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Pill>
              <Pill active={tab === 'models'} onClick={() => setTab('models')}>Models</Pill>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', '30d', '7d'] as const).map((r) => (
                <Pill key={r} active={range === r} onClick={() => setRange(r)}>{r === 'all' ? 'All' : r}</Pill>
              ))}
            </div>
          </div>

          {loading && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: C.mute, fontSize: 13 }}>Loading your usage…</div>
          )}
          {error && !loading && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--lum-danger)', fontSize: 13 }}>{error}</div>
          )}

          {data && t && !loading && (
            // Rendered directly (no exit-gated AnimatePresence): a tab or
            // range switch must show its content immediately, even if the
            // browser tab is backgrounded and rAF-driven animations are paused.
            <div key={tab + range}>
                {tab === 'overview' ? (
                  <>
                    {/* Stat tiles — 4 across, 2 rows */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                      <StatTile label="Sessions" value={commas(t.sessions)} />
                      <StatTile label="Messages" value={commas(t.messages)} />
                      <StatTile label="Total tokens" value={compact(t.totalTokens)} title={`${commas(t.totalTokens)} tokens`} />
                      <StatTile label="Active days" value={commas(t.activeDays)} />
                      <StatTile label="Current streak" value={`${t.currentStreak}d`} />
                      <StatTile label="Longest streak" value={`${t.longestStreak}d`} />
                      <StatTile label="Peak hour" value={hour12(t.peakHour)} />
                      <StatTile label="Favorite model" value={t.favoriteModel ?? '—'} title={t.favoriteModel ?? undefined} />
                    </div>
                    {/* Calendar */}
                    <Calendar days={data.calendar} />
                    {/* Footer comparison */}
                    {data.comparison && (
                      <div style={{ marginTop: 14, fontSize: 12, color: C.mute }}>
                        You've used ~{data.comparison.times}× more tokens than {data.comparison.label}.
                      </div>
                    )}
                  </>
                ) : (
                  data.models.length === 0
                    ? <div style={{ padding: '32px 0', textAlign: 'center', color: C.mute, fontSize: 13 }}>No model usage in this range yet.</div>
                    : <ModelsChart data={data} />
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
