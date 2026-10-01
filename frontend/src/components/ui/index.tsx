// ============================================================
// Luminary UI kit — liquid glass components.
//
// Every primitive here is GPU-friendly: hover/press animations
// are transform+opacity springs (framer-motion), glass is
// composited backdrop blur, and nothing animates layout.
// ============================================================

import React, { useEffect, useId, useRef, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { springSnappy, springGentle } from '@/lib/motion';
import clsx from 'clsx';

// ── StatusDot ────────────────────────────────────────────────
type DotStatus = 'active' | 'running' | 'connected' | 'streaming' |
                 'idle' | 'offline' | 'loaded' | 'unloaded' | 'completed' |
                 'queued' | 'failed' | 'error' | 'disabled' | 'pairing';

const DOT_COLOR: Record<DotStatus, string> = {
  active: 'var(--lum-accent)', running: '#8FC6E8', connected: '#6FCF97', streaming: '#8FC6E8',
  idle: '#5A6478', offline: '#E8746B', loaded: '#6FCF97', unloaded: '#5A6478',
  completed: '#6FCF97', queued: '#E8B36B', failed: '#E8746B',
  error: '#E8746B', disabled: '#5A6478', pairing: '#E8B36B',
};

const LIVE: DotStatus[] = ['active', 'running', 'connected', 'streaming', 'loaded'];

interface StatusDotProps { status: DotStatus; className?: string; }

export function StatusDot({ status, className }: StatusDotProps) {
  const color = DOT_COLOR[status] ?? '#5A6478';
  const isLive = LIVE.includes(status);
  // 'active' follows the theme accent (a CSS var), so its glow is
  // derived from the accent RGB channels rather than a hex suffix.
  const glow = status === 'active' ? 'rgb(var(--lum-accent-rgb) / 0.4)' : `${color}66`;
  return (
    <span className={clsx('relative inline-flex items-center justify-center', className)}
          style={{ width: 10, height: 10 }}>
      {isLive && (
        <span className="lum-pulse-ring absolute inset-0 rounded-full"
              style={{ background: color, opacity: 0.35 }} />
      )}
      <span className="relative z-10 rounded-full"
            style={{ width: 7, height: 7, background: color, boxShadow: isLive ? `0 0 8px ${glow}` : 'none' }} />
    </span>
  );
}

// ── Badge ────────────────────────────────────────────────────
type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'cyan';

const BADGE_STYLE: Record<BadgeVariant, React.CSSProperties> = {
  default:  { background: 'rgba(255,255,255,0.06)', color: 'var(--lum-text-secondary)', border: '1px solid rgba(255,255,255,0.05)' },
  accent:   { background: 'var(--lum-violet-soft)',  color: 'var(--lum-violet)', border: '1px solid rgb(var(--lum-accent-rgb) / 0.2)' },
  success:  { background: 'rgba(111,207,151,0.1)',  color: 'var(--lum-success)', border: '1px solid rgba(111,207,151,0.18)' },
  warning:  { background: 'rgba(232,179,107,0.1)',  color: 'var(--lum-warning)', border: '1px solid rgba(232,179,107,0.18)' },
  error:    { background: 'rgba(232,116,107,0.1)',  color: 'var(--lum-danger)', border: '1px solid rgba(232,116,107,0.18)' },
  cyan:     { background: 'var(--lum-ice-soft)',    color: 'var(--lum-ice)', border: '1px solid rgba(143,198,232,0.18)' },
};

interface BadgeProps { children: React.ReactNode; variant?: BadgeVariant; className?: string; }

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold tracking-wide uppercase whitespace-nowrap', className)}
          style={BADGE_STYLE[variant]}>
      {children}
    </span>
  );
}

// ── Card — liquid glass pane ─────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  hover?: boolean;
  /** Adds the diagonal light-streak reflection. */
  reflect?: boolean;
}

/** Luminous lighting — a pool of light follows the pointer (CSS
 * vars drive a ::before radial gradient; direct DOM write, no
 * renders). Attach to ANY element carrying .lum-luminous: cards,
 * the sidebar, the top bar, chat rails — the light is universal. */
export function pointerLight(e: React.PointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${(((e.clientX - rect.left) / rect.width) * 100).toFixed(2)}%`);
  el.style.setProperty('--my', `${(((e.clientY - rect.top) / rect.height) * 100).toFixed(2)}%`);
}

export function Card({ children, className, style, onClick, hover, reflect }: CardProps) {
  return (
    <motion.div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined}
      onPointerMove={pointerLight}
      whileHover={hover ? { y: -2, transition: springSnappy } : undefined}
      className={clsx('lum-glass lum-luminous', reflect && 'lum-reflect', onClick && 'cursor-pointer', className)}
      style={style}
    >
      {children}
    </motion.div>
  );
}

// ── Button — spring press + hover elevation ─────────────────
type ButtonVariant = 'default' | 'accent' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  type?: 'button' | 'submit';
  title?: string;
}

const BUTTON_STYLE: Record<ButtonVariant, { rest: React.CSSProperties; hover: React.CSSProperties }> = {
  default: {
    rest:  { background: 'rgba(255,255,255,0.055)', color: 'var(--lum-text)', border: '1px solid rgba(255,255,255,0.08)' },
    hover: { background: 'rgba(255,255,255,0.095)' },
  },
  accent: {
    rest:  { background: 'var(--lum-accent-grad)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 4px 18px -6px rgb(var(--lum-accent-rgb) / 0.55)' },
    hover: { boxShadow: '0 6px 24px -6px rgb(var(--lum-accent-rgb) / 0.75)' },
  },
  ghost: {
    rest:  { background: 'transparent', color: 'var(--lum-text-secondary)', border: '1px solid transparent' },
    hover: { background: 'rgba(255,255,255,0.06)' },
  },
  danger: {
    rest:  { background: 'rgba(232,116,107,0.1)', color: 'var(--lum-danger)', border: '1px solid rgba(232,116,107,0.2)' },
    hover: { background: 'rgba(232,116,107,0.18)' },
  },
  success: {
    rest:  { background: 'rgba(111,207,151,0.1)', color: 'var(--lum-success)', border: '1px solid rgba(111,207,151,0.2)' },
    hover: { background: 'rgba(111,207,151,0.18)' },
  },
};

export function Button({ children, variant = 'default', size = 'md', onClick, disabled, className, style, type = 'button', title }: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const v = BUTTON_STYLE[variant];

  const padding = size === 'sm' ? '5px 11px' : size === 'lg' ? '10px 24px' : '7px 15px';
  const fontSize = size === 'sm' ? 12 : size === 'lg' ? 14.5 : 13;

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.965, y: 0 }}
      transition={springSnappy}
      className={clsx('inline-flex items-center gap-1.5 rounded-[10px] font-medium select-none', className)}
      style={{
        ...v.rest,
        ...(hovered && !disabled ? v.hover : {}),
        padding, fontSize,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.18s ease, box-shadow 0.25s ease, color 0.18s ease',
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// ── ProgressBar — springs toward its value ───────────────────
interface ProgressBarProps { value: number; color?: string; className?: string; }

export function ProgressBar({ value, color = 'var(--lum-violet)', className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  // CSS-var colors can't take hex alpha suffixes — derive the glow
  // from the accent RGB channels when the default color is in use.
  const glow = color.startsWith('var(') ? 'rgb(var(--lum-accent-rgb) / 0.33)' : `${color}55`;
  return (
    <div className={clsx('rounded-full h-1.5 overflow-hidden', className)}
         style={{ background: 'rgba(255,255,255,0.07)' }}>
      <motion.div
        className="h-full rounded-full"
        animate={{ width: `${clamped}%` }}
        transition={{ type: 'spring', stiffness: 90, damping: 22 }}
        style={{ background: `linear-gradient(90deg, ${color}, var(--lum-ice))`, boxShadow: `0 0 10px ${glow}` }}
      />
    </div>
  );
}

// ── Skeleton — shimmer placeholder ───────────────────────────
interface SkeletonProps { width?: number | string; height?: number | string; className?: string; style?: React.CSSProperties; }

export function Skeleton({ width = '100%', height = 14, className, style }: SkeletonProps) {
  return <div className={clsx('lum-skeleton', className)} style={{ width, height, ...style }} />;
}

// ── AnimatedNumber — springs between values ──────────────────
interface AnimatedNumberProps {
  value: number;
  /** Renders the interpolated value, e.g. (v) => `${v.toFixed(1)} GB` */
  format?: (v: number) => string;
  className?: string;
  style?: React.CSSProperties;
}

export function AnimatedNumber({ value, format = (v) => String(Math.round(v)), className, style }: AnimatedNumberProps) {
  const spring = useSpring(value, { stiffness: 80, damping: 24 });
  const display = useTransform(spring, (v) => format(v));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => { spring.set(value); }, [value, spring]);
  useEffect(() => display.on('change', (v) => { if (ref.current) ref.current.textContent = v; }), [display]);

  return <span ref={ref} className={className} style={style}>{format(value)}</span>;
}

// ── Divider ──────────────────────────────────────────────────
export function Divider({ className }: { className?: string }) {
  return <div className={clsx('h-px', className)} style={{ background: 'rgba(255,255,255,0.07)' }} />;
}

// ── Slider — themed range input with live value readout ─────
interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Renders the value label, e.g. (v) => `${v}px` */
  format?: (v: number) => string;
  className?: string;
  style?: React.CSSProperties;
}

export function Slider({ value, min, max, step = 1, onChange, format, className, style }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={clsx('flex items-center gap-3', className)} style={style}>
      <input
        type="range"
        className="lum-range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%`, flex: 1 }}
      />
      {format && (
        <span className="text-[11px] font-mono tabular flex-shrink-0 text-right"
              style={{ color: 'var(--lum-text-secondary)', minWidth: 44 }}>
          {format(value)}
        </span>
      )}
    </div>
  );
}

// ── Segmented — sliding-pill option switch ───────────────────
interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  Icon?: React.ElementType;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (v: T) => void;
  className?: string;
  /** Stretch options to equal widths (default true). */
  grow?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, className, grow = true }: SegmentedProps<T>) {
  const groupId = useId();
  return (
    <div className={clsx('flex p-1 gap-0.5 lum-glass-subtle', className)}
         style={{ borderRadius: 'var(--lum-radius-sm)' }}>
      {options.map(({ value: v, label, Icon }) => {
        const active = v === value;
        return (
          <motion.button
            key={v}
            onClick={() => onChange(v)}
            whileTap={{ scale: 0.96 }}
            className="relative flex items-center justify-center gap-1.5 text-[12px] font-medium select-none"
            style={{
              flex: grow ? 1 : undefined,
              padding: '6px 12px',
              borderRadius: 'calc(var(--lum-radius-sm) - 3px)',
              background: 'transparent', border: 'none',
              color: active ? 'var(--lum-aurora)' : 'var(--lum-text-muted)',
              cursor: 'pointer',
              fontWeight: active ? 600 : 450,
              transition: 'color 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {active && (
              <motion.span
                layoutId={`seg-${groupId}`}
                transition={springGentle}
                className="absolute inset-0"
                style={{
                  borderRadius: 'inherit',
                  background: 'linear-gradient(160deg, rgb(var(--lum-accent-rgb) / 0.30), rgb(var(--lum-accent-rgb) / 0.14))',
                  border: '1px solid rgb(var(--lum-accent-rgb) / 0.35)',
                  boxShadow: '0 2px 10px -4px rgb(var(--lum-accent-rgb) / 0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
                }}
              />
            )}
            {Icon && <Icon size={13} className="relative" style={{ zIndex: 1 }} />}
            <span className="relative" style={{ zIndex: 1 }}>{label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

// ── Toggle — spring switch (shared by Settings & Theme Center) ──
export function Toggle({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      style={{
        width: 42, height: 24, borderRadius: 12,
        background: value ? 'var(--lum-accent-grad)' : 'rgba(255,255,255,0.1)',
        border: '1px solid ' + (value ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'),
        boxShadow: value
          ? '0 2px 12px -2px rgb(var(--lum-accent-rgb) / 0.5), inset 0 1px 0 rgba(255,255,255,0.2)'
          : 'inset 0 1px 3px rgba(0,0,0,0.3)',
        cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative',
        display: 'flex', alignItems: 'center',
        justifyContent: value ? 'flex-end' : 'flex-start',
        padding: 3,
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.25s ease, box-shadow 0.25s ease',
      }}
    >
      <motion.div
        layout
        transition={springSnappy}
        style={{
          width: 17, height: 17, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        }}
      />
    </motion.button>
  );
}
