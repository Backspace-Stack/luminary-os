// ============================================================
// Dashboard — Luminary's home. Not an admin panel: a calm
// morning-briefing. A greeting hero with the live clock leads;
// system vitals, tasks and agents follow in adaptive glass.
// All numbers are real (SystemSnapshot + live agent data).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Cpu, Bot, Activity, Wifi, Brain, CheckCircle2, MessageSquare, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, Badge, StatusDot, ProgressBar, AnimatedNumber, Button } from '@/components/ui';
import { staggerParent, riseIn } from '@/lib/motion';
import { useTheme } from '@/theme/useTheme';
import { shade } from '@/theme/engine';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { SystemStatus, Task, Agent, NavPage } from '@/types';

interface DashboardProps {
  system: SystemStatus;
  tasks: Task[];
  agents: Agent[];
  setPage: (p: NavPage) => void;
}

const TASK_BADGE: Record<string, 'cyan'|'success'|'warning'|'default'> = {
  running: 'cyan', completed: 'success', queued: 'warning', failed: 'default',
};
const TASK_COLOR: Record<string, string> = {
  running: 'var(--lum-ice)', completed: 'var(--lum-success)', queued: 'var(--lum-warning)', failed: 'var(--lum-danger)',
};

/** GGUF assignments are file paths — show just the file name. */
const modelLabel = (id: string) => {
  if (!id) return '';
  const base = id.split(/[\\/]/).pop() ?? id;
  return base.replace(/\.gguf$/i, '');
};

const greeting = (h: number) =>
  h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

// ── Sparkline — smooth history graph from real samples ───────
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const W = 200, H = 54;
  if (points.length < 2) {
    return <div style={{ height: H }} className="flex items-end"><div className="lum-skeleton" style={{ width: '100%', height: 20 }} /></div>;
  }
  const max = Math.max(100, ...points);
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map((v) => H - 3 - (v / max) * (H - 8));

  // Catmull-Rom → cubic bezier for a calm, smooth line
  let d = `M ${xs[0]},${ys[0]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const x0 = xs[Math.max(0, i - 1)], y0 = ys[Math.max(0, i - 1)];
    const x1 = xs[i], y1 = ys[i];
    const x2 = xs[i + 1], y2 = ys[i + 1];
    const x3 = xs[Math.min(points.length - 1, i + 2)], y3 = ys[Math.min(points.length - 1, i + 2)];
    d += ` C ${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }

  const gid = `spark-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${W},${H} L 0,${H} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}66)` }} />
    </svg>
  );
}

export default function Dashboard({ system, tasks, agents, setPage }: DashboardProps) {
  const [theme] = useTheme();
  const accent = theme.accent;
  const accent2 = shade(accent, 0.18);
  const AGENT_COLORS = [accent, '#8FC6E8', '#6FCF97', '#E8B36B'];

  const wide = useMediaQuery('(min-width: 1240px)');
  const activeModel = system.agents.activeModelName ? modelLabel(system.agents.activeModelName) : '—';
  const activeAgent = system.agents.activeAgentName ?? '—';

  // Live clock for the hero
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Real metric history, sampled from the live polling feed
  const [history, setHistory] = useState<{ cpu: number[]; gpu: number[]; ram: number[] }>({ cpu: [], gpu: [], ram: [] });
  const lastSample = useRef<number>(0);
  useEffect(() => {
    if (system.uptimeMs === 0) return;               // zero-state before first snapshot
    if (Date.now() - lastSample.current < 2000) return;
    lastSample.current = Date.now();
    setHistory((h) => ({
      cpu: [...h.cpu, system.resources.cpuPercent].slice(-32),
      gpu: system.resources.gpuPercent === null ? [] : [...h.gpu, system.resources.gpuPercent].slice(-32),
      ram: [...h.ram, Math.round((system.resources.ramUsedGB / (system.resources.ramTotalGB || 1)) * 100)].slice(-32),
    }));
  }, [system]);

  const statCards = [
    { label: 'Active Model',      value: activeModel,                Icon: Cpu,      color: accent,    mono: true,  sub: `${system.providers.total} provider(s)`, num: false },
    { label: 'Active Agent',      value: activeAgent.split(' ')[0],  Icon: Bot,      color: accent2,   mono: false, sub: `${system.agents.active} active`, num: false },
    { label: 'Running Tasks',     value: system.tasks.running,       Icon: Activity, color: '#8FC6E8', mono: false, sub: `${system.tasks.total} total`, num: true },
    { label: 'Connected Devices', value: system.devices.online,      Icon: Wifi,     color: '#6FCF97', mono: false, sub: `${system.devices.offline} offline`, num: true },
    { label: 'Memory Entries',    value: system.memory.total,        Icon: Brain,    color: '#E8B36B', mono: false, sub: system.memory.providerStatus, num: true },
  ];

  const resources = [
    { label: 'CPU', value: system.resources.cpuPercent, color: accent, series: history.cpu,
      detail: `${system.resources.cpuPercent}%` },
    { label: 'GPU', value: system.resources.gpuPercent, color: accent2, series: history.gpu,
      detail: system.resources.gpuPercent === null ? 'Utilization unavailable' : `${system.resources.gpuPercent}%` },
    { label: 'RAM', value: Math.round((system.resources.ramUsedGB / (system.resources.ramTotalGB || 1)) * 100), color: '#8FC6E8', series: history.ram,
      detail: `${system.resources.ramUsedGB} / ${system.resources.ramTotalGB} GB` },
  ];

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex-1 overflow-y-auto">
      <motion.div variants={staggerParent} initial="initial" animate="enter"
        className="mx-auto space-y-5"
        style={{ maxWidth: 1560, padding: 'clamp(16px, 2.4vw, 30px)' }}>

        {/* Hero — greeting, clock, one-line system truth */}
        <motion.div variants={riseIn}>
          <Card reflect style={{ padding: 'clamp(20px, 2.6vw, 30px)', overflow: 'hidden' }}>
            {/* Accent aura behind the hero text — breathing */}
            <div aria-hidden className="lum-breathe" style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: `radial-gradient(46% 90% at 12% 10%, rgb(var(--lum-accent-rgb) / 0.14), transparent 70%)`,
            }} />
            <div className="relative flex items-end justify-between gap-6 flex-wrap">
              <div className="min-w-0">
                <div className="text-[12px] font-medium tracking-wide mb-1.5" style={{ color: 'var(--lum-text-muted)' }}>{date}</div>
                <h1 className="font-bold tracking-tight mb-2"
                    style={{ color: 'var(--lum-aurora)', fontSize: 'clamp(22px, 2.6vw, 30px)', lineHeight: 1.15 }}>
                  {greeting(now.getHours())}<span style={{ color: 'var(--lum-accent)' }}>.</span>
                </h1>
                <div className="text-[12.5px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--lum-text-secondary)' }}>
                  <StatusDot status="active" />
                  <span>
                    {system.agents.active} agent{system.agents.active === 1 ? '' : 's'} standing by
                    {activeModel !== '—' && <> · <span className="font-mono">{activeModel}</span> ready</>}
                    {' '}· up {system.uptime}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-5 flex-wrap">
                <Button variant="accent" onClick={() => setPage('chat')}>
                  <MessageSquare size={14} /> Start a conversation <ArrowRight size={13} />
                </Button>
                <div className="text-right">
                  <div className="font-bold tabular leading-none"
                       style={{ color: 'var(--lum-aurora)', fontSize: 'clamp(30px, 3.4vw, 44px)', letterSpacing: '-0.02em' }}>
                    {time}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Vitals — quiet numbers over ghost icons, no admin chrome */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {statCards.map(({ label, value, Icon, color, mono, sub, num }) => (
            <motion.div key={label} variants={riseIn}>
              <Card hover reflect style={{ padding: '18px 18px 16px', height: '100%', overflow: 'hidden' }}>
                {/* Ghost watermark — the icon is atmosphere, not a chip */}
                <Icon aria-hidden size={64} color={color} strokeWidth={1.4} style={{
                  position: 'absolute', right: -12, bottom: -14, opacity: 0.09,
                  pointerEvents: 'none', filter: `drop-shadow(0 0 14px ${color})`,
                }} />
                <div className={`font-bold mb-1 truncate tabular ${mono ? 'font-mono text-[15px] pt-1' : 'text-[26px]'}`}
                     style={{ color: 'var(--lum-aurora)', letterSpacing: '-0.02em', lineHeight: 1.2 }} title={String(value)}>
                  {num ? <AnimatedNumber value={Number(value)} /> : value}
                </div>
                <div className="text-[12px] font-medium truncate" style={{ color: 'var(--lum-text-secondary)' }} title={label}>{label}</div>
                <div className="text-[10.5px] truncate mt-0.5" style={{ color: 'var(--lum-text-muted)' }}>{sub}</div>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Resource usage with live history graphs */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {resources.map(({ label, value, color, series, detail }) => (
            <motion.div key={label} variants={riseIn}>
              <Card reflect style={{ padding: '18px 18px 10px' }}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-[12px] font-medium" style={{ color: 'var(--lum-text-secondary)' }}>{label}</span>
                  <span className="text-[24px] font-bold tabular" style={{ color: 'var(--lum-aurora)', letterSpacing: '-0.02em' }}>
                    {value === null ? <span className="text-[18px]">Unknown</span> : <>
                      <AnimatedNumber value={value} />
                      <span className="text-[12px] font-normal ml-0.5" style={{ color: 'var(--lum-text-muted)' }}>%</span>
                    </>}
                  </span>
                </div>
                <div className="text-[10.5px] mb-2 font-mono" style={{ color: 'var(--lum-text-muted)' }}>{detail}</div>
                {value === null
                  ? <div className="rounded-full h-1.5" style={{ background: 'rgba(255,255,255,0.07)' }} aria-label={`${label} utilization unknown`} />
                  : <ProgressBar value={value} color={color} />}
                <div className="mt-3 -mx-1">
                  {value === null ? <div style={{ height: 54 }} /> : <Sparkline points={series} color={color} />}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Tasks + Agents — side by side when there is room */}
        <div className="grid gap-4" style={{ gridTemplateColumns: wide ? '2fr 1fr' : '1fr' }}>
          <motion.div variants={riseIn}>
            <Card style={{ padding: 0, height: '100%' }}>
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--lum-aurora)' }}>Active Tasks</span>
                <Badge variant="accent">{tasks.length}</Badge>
              </div>
              {tasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 gap-3">
                  <CheckCircle2 size={26} style={{ color: 'var(--lum-text-muted)', opacity: 0.6 }} />
                  <div className="text-[12.5px]" style={{ color: 'var(--lum-text-muted)' }}>
                    No active tasks — the system is at rest
                  </div>
                </div>
              )}
              {tasks.map((task, i) => (
                <div key={task.id} className="flex items-center gap-3 px-5 py-3.5"
                     style={{ borderBottom: i < tasks.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  <StatusDot status={task.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium mb-1 truncate" style={{ color: 'var(--lum-text)' }}>{task.name}</div>
                    <div className="text-[11px] mb-1.5" style={{ color: 'var(--lum-text-muted)' }}>{task.agentName} · {task.startedAt}</div>
                    {task.status === 'running' && <ProgressBar value={task.progress} color={TASK_COLOR[task.status]} />}
                  </div>
                  <Badge variant={TASK_BADGE[task.status] ?? 'default'}>
                    {task.status === 'running' ? `${task.progress}%` : task.status}
                  </Badge>
                </div>
              ))}
            </Card>
          </motion.div>

          <motion.div variants={riseIn}>
            <Card style={{ padding: 0, height: '100%' }}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--lum-aurora)' }}>Agent Status</span>
              </div>
              {agents.map((agent, i) => (
                <div key={agent.id} className="flex items-center gap-3 px-5 py-3.5"
                     style={{ borderBottom: i < agents.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  <div className="flex items-center justify-center rounded-[10px] flex-shrink-0"
                       style={{ width: 30, height: 30, background: `${AGENT_COLORS[i % 4]}1C`, border: `1px solid ${AGENT_COLORS[i % 4]}2E` }}>
                    <Bot size={13} color={AGENT_COLORS[i % 4]} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate" style={{ color: 'var(--lum-text)' }}>{agent.name}</div>
                    <div className="text-[10px] font-mono truncate" style={{ color: 'var(--lum-text-muted)' }}
                         title={agent.defaultModel || undefined}>
                      {agent.defaultModel ? modelLabel(agent.defaultModel) : 'no model assigned'}
                    </div>
                  </div>
                  <StatusDot status={agent.status} />
                </div>
              ))}
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
