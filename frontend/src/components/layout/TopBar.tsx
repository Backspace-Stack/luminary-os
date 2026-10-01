import { useEffect, useState } from 'react';
import { Cpu, Bell, Moon, Sun } from 'lucide-react';
import { StatusDot, pointerLight } from '@/components/ui';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTheme } from '@/theme/useTheme';
import type { NavPage, SystemStatus } from '@/types';

const PAGE_META: Record<NavPage, { label: string; desc: string }> = {
  dashboard: { label: 'Dashboard',  desc: 'System overview and live status' },
  chat:      { label: 'Chat',       desc: 'Agent conversations' },
  models:    { label: 'Models',     desc: 'Installed local models' },
  agents:    { label: 'Agents',     desc: 'Specialist agent roster' },
  memory:    { label: 'Memory',     desc: 'Long-term memory store' },
  devices:   { label: 'Devices',    desc: 'Connected device network' },
  theme:     { label: 'Theme Center', desc: 'Glass, light and motion' },
  settings:  { label: 'Settings',   desc: 'System configuration' },
};

interface TopBarProps { page: NavPage; system: SystemStatus; }

export default function TopBar({ page, system }: TopBarProps) {
  const { label, desc } = PAGE_META[page];
  const roomy = useMediaQuery('(min-width: 1180px)');
  const medium = useMediaQuery('(min-width: 760px)');
  const [theme, setTheme] = useTheme();
  const focused = theme.mode === 'focus';

  // Model name comes from the backend SystemSnapshot — never hardcoded
  const activeModel = system.agents?.activeModelName ?? '—';
  const uptime      = system.uptime ?? '—';

  // Quiet OS clock on the right edge
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header
      className="flex items-center justify-between flex-shrink-0 px-6 gap-4 lum-glass-strong lum-luminous"
      onPointerMove={pointerLight}
      style={{
        height: 60,
        borderRadius: 0,
        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
        borderBottom: '1px solid var(--lum-glass-border)',
      }}
    >
      <div className="min-w-0">
        <div className="font-semibold text-[15px] tracking-tight truncate" style={{ color: 'var(--lum-aurora)' }}>{label}</div>
        {medium && <div className="text-[11px] truncate" style={{ color: 'var(--lum-text-muted)' }}>{desc}</div>}
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        {/* Active model pill — resolved at runtime from backend */}
        {medium && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] lum-glass-subtle" style={{ maxWidth: 260 }}>
            <Cpu size={12} color="var(--lum-accent)" style={{ flexShrink: 0 }} />
            <span className="font-mono text-[12px] truncate" style={{ color: 'var(--lum-text-secondary)' }}>{activeModel}</span>
          </div>
        )}

        {/* System uptime */}
        {roomy && (
          <div className="flex items-center gap-2">
            <StatusDot status="active" />
            <span className="text-[11px] tracking-wide whitespace-nowrap" style={{ color: 'var(--lum-text-muted)' }}>UP {uptime}</span>
          </div>
        )}

        {/* Provider badge */}
        {roomy && (
          <div className="text-[10px] font-mono px-2 py-1 rounded-md"
               style={{ background: 'var(--lum-violet-soft)', color: 'var(--lum-accent)', border: '1px solid rgb(var(--lum-accent-rgb) / 0.2)' }}>
            {system.providers?.defaultId ?? 'ollama'}
          </div>
        )}

        {/* Focus Mode — pure black, zero glass */}
        <button
          onClick={() => setTheme({ mode: focused ? 'glass' : 'focus' })}
          title="Focus Mode — pure black, zero glass"
          className="relative flex items-center justify-center p-1.5 rounded-[10px]"
          style={{
            background: focused ? 'var(--lum-violet-soft)' : 'transparent',
            border: focused ? '1px solid rgb(var(--lum-accent-rgb) / 0.3)' : '1px solid transparent',
            color: focused ? 'var(--lum-accent)' : 'var(--lum-text-muted)',
            cursor: 'pointer', transition: 'color 0.2s, background 0.2s',
          }}
          onMouseEnter={e => { if (!focused) e.currentTarget.style.color = 'var(--lum-text-secondary)'; }}
          onMouseLeave={e => { if (!focused) e.currentTarget.style.color = 'var(--lum-text-muted)'; }}
        >
          {focused ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Notifications */}
        <button
          className="relative p-1.5 rounded-[10px]"
          style={{ background: 'transparent', border: 'none', color: 'var(--lum-text-muted)', cursor: 'pointer', transition: 'color 0.2s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--lum-text-secondary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--lum-text-muted)')}
        >
          <Bell size={16} />
          <span className="absolute top-0 right-0 rounded-full"
                style={{ width: 6, height: 6, background: 'var(--lum-accent)', boxShadow: '0 0 6px rgb(var(--lum-accent-rgb) / 0.8)' }} />
        </button>

        {/* Clock — every OS has one */}
        <div className="text-[12.5px] font-medium tabular whitespace-nowrap" style={{ color: 'var(--lum-text-secondary)' }}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </header>
  );
}
