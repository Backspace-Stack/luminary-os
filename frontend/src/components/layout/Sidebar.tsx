import { ChevronRight, LayoutDashboard, MessageSquare, Layers, Bot, Brain, Monitor, Settings, Palette } from 'lucide-react';
import { motion } from 'framer-motion';
import { springGentle, springSnappy } from '@/lib/motion';
import { pointerLight, StatusDot } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';
import { useChatContext } from '@/store/ChatContext';
import type { NavPage } from '@/types';
import clsx from 'clsx';
import BrandLogo from '@/components/ui/BrandLogo';
import { APP_VERSION } from '@/lib/brand';

const NAV_ITEMS = [
  { id: 'dashboard' as NavPage, label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'chat'      as NavPage, label: 'Chat',      Icon: MessageSquare },
  { id: 'models'    as NavPage, label: 'Models',    Icon: Layers },
  { id: 'agents'    as NavPage, label: 'Agents',    Icon: Bot },
  { id: 'memory'    as NavPage, label: 'Memory',    Icon: Brain },
  { id: 'devices'   as NavPage, label: 'Devices',   Icon: Monitor },
  { id: 'theme'     as NavPage, label: 'Theme',     Icon: Palette },
  { id: 'settings'  as NavPage, label: 'Settings',  Icon: Settings },
];

interface SidebarProps {
  page: NavPage;
  setPage: (p: NavPage) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

export default function Sidebar({ page, setPage, collapsed, setCollapsed }: SidebarProps) {
  const [theme] = useTheme();
  const floating = theme.sidebar === 'floating';
  const solid = theme.sidebar === 'solid';
  // A generation keeps running (and updating) even while you're on
  // another page — see store/ChatContext.tsx. This is the only cue
  // that it's still going until you switch back.
  const { streaming } = useChatContext();

  return (
    <motion.aside
      className={clsx(
        'flex flex-col flex-shrink-0 overflow-hidden',
        !solid && 'lum-glass-strong',
        !solid && 'lum-reflect',
        !solid && 'lum-luminous',
      )}
      onPointerMove={solid ? undefined : pointerLight}
      animate={{ width: collapsed ? 70 : 242 }}
      transition={springGentle}
      style={{
        // Three personalities, one skeleton:
        //   glass    — full-height translucent chrome (default)
        //   floating — detached rounded pane, macOS-style
        //   solid    — opaque, quiet, maximum contrast
        ...(floating
          ? {
              margin: 12,
              marginRight: 4,
              height: 'calc(100vh - 24px)',
              borderRadius: 'var(--lum-radius-lg)',
              border: '1px solid var(--lum-glass-border)',
              boxShadow: '0 24px 60px -24px rgba(0,0,0,0.9), inset 0 1px 0 var(--lum-glass-highlight)',
            }
          : {
              height: '100vh',
              borderRadius: 0,
              borderTop: 'none', borderBottom: 'none', borderLeft: 'none',
              borderRight: '1px solid var(--lum-glass-border)',
            }),
        ...(solid && {
          background: 'rgb(9 12 19 / 0.97)',
          border: floating ? '1px solid rgba(255,255,255,0.07)' : undefined,
          borderRight: '1px solid rgba(255,255,255,0.07)',
        }),
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 flex-shrink-0"
        style={{
          padding: collapsed ? '18px 19px' : '18px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          minHeight: 64,
        }}
      >
        <BrandLogo size={32} className="flex-shrink-0" />
        {!collapsed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
            <div className="font-bold text-[15px] tracking-tight" style={{ color: 'var(--lum-aurora)' }}>Luminary</div>
            <div className="text-[10px] font-medium tracking-widest uppercase" style={{ color: 'var(--lum-text-muted)' }}>OS v{APP_VERSION}</div>
          </motion.div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 py-3 px-2.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = page === id;
          return (
            <motion.button
              key={id}
              onClick={() => setPage(id)}
              title={collapsed ? label : undefined}
              whileHover={active ? undefined : { x: 2 }}
              whileTap={{ scale: 0.97 }}
              transition={springSnappy}
              className={clsx(
                'relative flex items-center gap-3 w-full rounded-[10px] text-[13px] font-medium text-left',
                'outline-none focus-visible:ring-2 focus-visible:ring-[var(--lum-accent)]'
              )}
              style={{
                padding: collapsed ? '10px 11px' : '9.5px 13px',
                background: 'transparent',
                color: active ? 'var(--lum-aurora)' : 'var(--lum-text-secondary)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: active ? 600 : 450,
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--lum-text)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--lum-text-secondary)'; }}
            >
              {/* Sliding active pill — shared layout animation */}
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  transition={springGentle}
                  className="absolute inset-0 rounded-[10px] lum-aura"
                  style={{
                    background: 'linear-gradient(160deg, rgb(var(--lum-accent-rgb) / 0.22), rgb(var(--lum-accent-rgb) / 0.1))',
                    border: '1px solid rgb(var(--lum-accent-rgb) / 0.28)',
                  }}
                />
              )}
              <Icon size={17} className="relative flex-shrink-0" style={{ zIndex: 1 }} />
              {!collapsed && <span className="relative" style={{ zIndex: 1 }}>{label}</span>}
              {/* Still generating, off-screen — a quiet pulse so it's never a surprise */}
              {id === 'chat' && streaming && !active && (
                <span
                  title="A reply is still generating"
                  className="relative flex-shrink-0"
                  style={{
                    zIndex: 1,
                    ...(collapsed ? { position: 'absolute', top: 8, right: 8 } : { marginLeft: 'auto' }),
                  }}
                >
                  <StatusDot status="active" />
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="flex-shrink-0 px-2.5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <motion.button
          onClick={() => setCollapsed(!collapsed)}
          whileTap={{ scale: 0.96 }}
          className="flex items-center gap-3 w-full rounded-[10px] text-[12px]"
          style={{ padding: '8px 13px', color: 'var(--lum-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'color 0.2s' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--lum-text-secondary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--lum-text-muted)')}
        >
          <motion.span animate={{ rotate: collapsed ? 0 : 180 }} transition={springGentle} className="flex-shrink-0 flex">
            <ChevronRight size={15} />
          </motion.span>
          {!collapsed && <span>Collapse</span>}
        </motion.button>
      </div>
    </motion.aside>
  );
}
