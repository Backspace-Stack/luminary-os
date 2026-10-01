// ============================================================
// Theme engine — the single source of truth for Luminary's
// visual identity. Every knob in the Theme Center writes here;
// the engine projects state onto CSS custom properties and
// data-attributes, so the whole interface retunes instantly
// with zero component re-renders outside subscribers.
//
// Persisted in localStorage. Applied before first paint from
// main.tsx so there is never a flash of the default theme.
// ============================================================

export type WeatherId = 'snow' | 'rain' | 'embers' | 'petals' | 'none';
export type MotionLevel = 'full' | 'reduced' | 'off';
export type SidebarStyle = 'glass' | 'floating' | 'solid';
/** 'focus' is a pure-black, zero-glass override — the whole interface
 *  steps back so the work in front of it is all that glows. */
export type ThemeMode = 'glass' | 'focus';

/** Structural interface mode — NOT a color theme.
 *  'dashboard'    — the full Luminary OS: nav sidebar, top bar, pages,
 *                   wallpaper, weather. Everything.
 *  'professional' — a plain, Claude-like chat workspace: conversation
 *                   list + chat only. No dashboard chrome, no wallpaper
 *                   image, no particles; only the accent color applies. */
export type UiMode = 'dashboard' | 'professional';

export type FontId =
  | 'system' | 'claude' | 'inter' | 'grotesk' | 'sora' | 'manrope' | 'mono';

export type WallpaperId =
  | 'aurora' | 'portrait' | 'glacier' | 'ember' | 'abyss' | 'accent'
  | 'sakura' | 'neon' | 'yozora' | 'custom';

export interface ThemeState {
  mode: ThemeMode;
  /** Structural layout mode — dashboard chrome vs. plain chat. */
  ui: UiMode;
  accent: string;           // hex
  wallpaper: WallpaperId;
  weather: WeatherId;
  /** Particle density multiplier, 0.25 … 1.75 */
  density: number;
  /** Panel opacity 0.2 (clear) … 0.9 (near solid) */
  glassAlpha: number;
  /** Backdrop blur in px, 0 … 48 */
  blur: number;
  /** Glass material intensity (borders, highlights, reflections) 0.4 … 2 */
  glassFx: number;
  /** Corner radius in px, 6 … 26 */
  radius: number;
  font: FontId;
  motion: MotionLevel;
  sidebar: SidebarStyle;
}

export const DEFAULT_THEME: ThemeState = {
  mode: 'glass',
  ui: 'dashboard',
  accent: '#8B7CFF',
  wallpaper: 'aurora',
  weather: 'snow',
  density: 1,
  glassAlpha: 0.48,
  blur: 20,
  glassFx: 1,
  radius: 16,
  font: 'system',
  motion: 'full',
  sidebar: 'glass',
};

// ── Fonts ────────────────────────────────────────────────────
// Variable fonts are self-hosted via @fontsource — the browser
// only downloads a family once it is actually used.
export const FONTS: Record<FontId, { label: string; hint: string; stack: string }> = {
  system:  { label: 'Luminary',       hint: 'Native · default',    stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', 'Inter Variable', sans-serif` },
  claude:  { label: 'Claude',         hint: 'Literary serif',      stack: `'Source Serif 4 Variable', 'Iowan Old Style', Georgia, serif` },
  inter:   { label: 'Inter',          hint: 'Neutral grotesque',   stack: `'Inter Variable', 'Segoe UI', sans-serif` },
  grotesk: { label: 'Space Grotesk',  hint: 'Technical display',   stack: `'Space Grotesk Variable', 'Segoe UI', sans-serif` },
  sora:    { label: 'Sora',           hint: 'Geometric future',    stack: `'Sora Variable', 'Segoe UI', sans-serif` },
  manrope: { label: 'Manrope',        hint: 'Soft modern',         stack: `'Manrope Variable', 'Segoe UI', sans-serif` },
  mono:    { label: 'JetBrains Mono', hint: 'Terminal soul',       stack: `'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace` },
};

// ── Wallpapers ───────────────────────────────────────────────
// The artwork ships as an asset; every other scene is procedural
// CSS so wallpapers cost nothing and recolor with the theme.
export interface WallpaperDef {
  id: WallpaperId;
  name: string;
  hint: string;
  /** CSS background for procedural scenes; undefined → image asset. */
  css?: string;
  image?: string;
  /** True → Wallpaper.tsx renders extra animated scene layers. */
  animated?: boolean;
}

export const WALLPAPERS: WallpaperDef[] = [
  // The signature Luminary look — matches the reference UI exactly:
  // an abstract violet/blue aurora glow, no photography or artwork.
  { id: 'aurora',  name: 'Aurora',      hint: "Luminary's home nebula",
    css: `radial-gradient(90% 70% at 78% 12%, rgba(124,102,255,0.34), transparent 62%),
          radial-gradient(70% 60% at 12% 78%, rgba(64,84,214,0.30), transparent 64%),
          radial-gradient(48% 42% at 42% 42%, rgba(158,110,255,0.14), transparent 70%),
          linear-gradient(178deg, #0A0A18 0%, #0C0F22 48%, #070811 100%)` },
  { id: 'portrait', name: 'Portrait',   hint: 'The original Luminary artwork', image: '/wallpaper/luminary.webp' },
  { id: 'glacier', name: 'Glacier',     hint: 'Arctic dawn',
    css: `radial-gradient(85% 65% at 22% 8%, rgba(96,164,222,0.30), transparent 60%),
          radial-gradient(60% 55% at 82% 72%, rgba(70,120,190,0.22), transparent 66%),
          radial-gradient(40% 34% at 60% 30%, rgba(180,220,255,0.10), transparent 72%),
          linear-gradient(180deg, #070D18 0%, #0A1424 52%, #060A12 100%)` },
  { id: 'ember',   name: 'Ember',       hint: 'Dying firelight',
    css: `radial-gradient(80% 62% at 74% 82%, rgba(214,110,64,0.26), transparent 60%),
          radial-gradient(55% 48% at 18% 22%, rgba(150,74,120,0.20), transparent 66%),
          radial-gradient(36% 30% at 58% 60%, rgba(255,160,90,0.10), transparent 74%),
          linear-gradient(184deg, #100A10 0%, #150D12 50%, #0A0709 100%)` },
  { id: 'abyss',   name: 'Abyss',       hint: 'Silent depth',
    css: `radial-gradient(70% 55% at 50% 118%, rgba(56,80,150,0.24), transparent 64%),
          radial-gradient(46% 40% at 84% 8%, rgba(80,100,170,0.12), transparent 70%),
          linear-gradient(180deg, #05060C 0%, #070A14 60%, #04050A 100%)` },
  { id: 'accent',  name: 'Resonance',   hint: 'Follows your accent',
    css: `radial-gradient(85% 66% at 76% 14%, rgb(var(--lum-accent-rgb) / 0.30), transparent 60%),
          radial-gradient(62% 54% at 14% 82%, rgb(var(--lum-accent-rgb) / 0.20), transparent 64%),
          radial-gradient(42% 36% at 44% 44%, rgb(var(--lum-accent-rgb) / 0.08), transparent 72%),
          linear-gradient(180deg, #07080F 0%, #0A0C16 52%, #05060B 100%)` },
  // ── Animated Japanese scenes — extra living layers in Wallpaper.tsx
  { id: 'sakura',  name: 'Sakura',      hint: '桜 · hanami dusk — animated', animated: true,
    css: `radial-gradient(70% 52% at 74% 20%, rgba(255,183,197,0.30), transparent 62%),
          radial-gradient(52% 44% at 18% 64%, rgba(214,140,184,0.22), transparent 66%),
          radial-gradient(90% 34% at 50% 102%, rgba(58,32,66,0.85), transparent 74%),
          linear-gradient(180deg, #241B33 0%, #45284A 44%, #6B3A55 72%, #2A1830 100%)` },
  { id: 'neon',    name: 'Neon Tokyo',  hint: '東京 · midnight rain — animated', animated: true,
    css: `radial-gradient(72% 46% at 28% 78%, rgba(255,84,163,0.20), transparent 60%),
          radial-gradient(64% 42% at 76% 72%, rgba(64,208,224,0.18), transparent 62%),
          radial-gradient(90% 30% at 50% 104%, rgba(16,10,28,0.9), transparent 76%),
          linear-gradient(180deg, #0A0918 0%, #141031 52%, #1E1038 78%, #0A0716 100%)` },
  { id: 'yozora',  name: 'Yozora',      hint: '夜空 · starlit night — animated', animated: true,
    css: `radial-gradient(64% 46% at 72% 24%, rgba(154,176,255,0.16), transparent 64%),
          radial-gradient(48% 38% at 22% 70%, rgba(94,120,200,0.12), transparent 66%),
          radial-gradient(90% 30% at 50% 104%, rgba(8,12,26,0.9), transparent 76%),
          linear-gradient(180deg, #060A1C 0%, #0B1230 54%, #101838 76%, #05070F 100%)` },
];

export const wallpaperById = (id: WallpaperId): WallpaperDef => {
  if (id === 'custom') {
    const image = getCustomWallpaper();
    if (image) return { id: 'custom', name: 'Your image', hint: 'Dropped-in wallpaper', image };
    return WALLPAPERS[0];
  }
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
};

// ── Custom wallpaper — dropped in by the user ────────────────
// Stored as a single compressed data URL in localStorage (not in
// ThemeState/JSON theme presets — an image is too large to carry
// around in every saved theme). Downscaled + re-encoded as JPEG
// before storage so a multi-megabyte photo doesn't blow the quota.
const CUSTOM_WP_KEY = 'luminary.wallpaper.custom.v1';

export function getCustomWallpaper(): string | null {
  try { return localStorage.getItem(CUSTOM_WP_KEY); } catch { return null; }
}

/** Downscale/compress an image data URL, store it, and switch to it. */
export function setCustomWallpaperFromDataUrl(dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      try { localStorage.setItem(CUSTOM_WP_KEY, out); } catch { /* quota exceeded — still apply for this session */ }
      setTheme({ wallpaper: 'custom', mode: 'glass' });
      resolve();
    };
    img.onerror = () => reject(new Error('Could not load the dropped image'));
    img.src = dataUrl;
  });
}

// ── Accent palette — shared by Theme Center and Professional mode ──
export const ACCENTS = [
  '#8B7CFF', '#B48CF5', '#7CC0EE', '#6FD3C3', '#7FD99A',
  '#E8C86B', '#F09B6C', '#EF8FBE', '#E8746B', '#A9B4CC',
];

// ── Presets — Luminary's built-in moods ──────────────────────
export interface ThemePreset { id: string; name: string; hint: string; state: ThemeState; }

const preset = (over: Partial<ThemeState>): ThemeState => ({ ...DEFAULT_THEME, ...over });

export const PRESETS: ThemePreset[] = [
  { id: 'luminary', name: 'Luminary', hint: 'Violet snowfall · the signature', state: preset({}) },
  { id: 'glacier',  name: 'Glacier',  hint: 'Ice blue · arctic calm',
    state: preset({ accent: '#7CC0EE', wallpaper: 'glacier', weather: 'snow', density: 0.8 }) },
  { id: 'ember',    name: 'Ember',    hint: 'Warm amber · rising embers',
    state: preset({ accent: '#F09B6C', wallpaper: 'ember', weather: 'embers', density: 0.9 }) },
  { id: 'monsoon',  name: 'Monsoon',  hint: 'Steel teal · night rain',
    state: preset({ accent: '#6FD3C3', wallpaper: 'abyss', weather: 'rain', density: 1 }) },
  { id: 'nova',     name: 'Nova',     hint: 'Rose quartz · still air',
    state: preset({ accent: '#EF8FBE', wallpaper: 'aurora', weather: 'none', blur: 26, glassAlpha: 0.42 }) },
  { id: 'void',     name: 'Void',     hint: 'Monochrome · pure focus',
    state: preset({ accent: '#A9B4CC', wallpaper: 'abyss', weather: 'none', glassAlpha: 0.62, glassFx: 0.7 }) },
  // ── Japanese moods — living, animated environments
  { id: 'sakura',   name: 'Sakura',   hint: '桜 · petals on a hanami dusk',
    state: preset({ accent: '#F2A0C0', wallpaper: 'sakura', weather: 'petals', density: 1 }) },
  { id: 'neon',     name: 'Neon Tokyo', hint: '東京 · neon rain at midnight',
    state: preset({ accent: '#61DBE8', wallpaper: 'neon', weather: 'rain', density: 1.2, glassFx: 1.2 }) },
  { id: 'yozora',   name: 'Yozora',   hint: '夜空 · fireflies under the stars',
    state: preset({ accent: '#EFD583', wallpaper: 'yozora', weather: 'embers', density: 0.65, glassAlpha: 0.42 }) },
];

// ── Color math ───────────────────────────────────────────────
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a hex color toward white (amt>0) or black (amt<0), amt −1…1. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amt > 0 ? 255 : 0;
  const a = Math.abs(amt);
  const c = (v: number) => Math.round(v + (t - v) * a);
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── Projection: ThemeState → CSS custom properties ───────────
export function applyTheme(t: ThemeState): void {
  const root = document.documentElement;
  const s = root.style;
  const [r, g, b] = hexToRgb(t.accent);
  const rgb = `${r} ${g} ${b}`;
  const fx = t.glassFx;

  s.setProperty('--lum-accent-rgb', rgb);
  s.setProperty('--lum-accent', t.accent);
  s.setProperty('--lum-accent-bright', shade(t.accent, 0.16));
  s.setProperty('--lum-accent-deep', shade(t.accent, -0.14));
  // Legacy aliases — the whole M5 codebase reads these
  s.setProperty('--lum-violet', t.accent);
  s.setProperty('--lum-violet-soft', `rgb(${rgb} / 0.14)`);
  s.setProperty('--lum-violet-border', `rgb(${rgb} / 0.32)`);
  s.setProperty('--lum-accent-grad', `linear-gradient(160deg, ${shade(t.accent, 0.14)} 0%, ${shade(t.accent, -0.1)} 100%)`);

  const F = t.mode === 'focus';

  if (F) {
    // Focus Mode — pure black, zero glass. Every embellishment in
    // .lum-glass/.lum-glass-strong (edge lensing, reflect streak,
    // luminous hover glow, extra border/highlight alpha) is already
    // scaled by --lum-fx, so driving it to 0 flattens all of them
    // to nothing without touching index.css. What's left is a flat
    // near-black panel with no blur and no saturation boost.
    s.setProperty('--lum-bg', '#000000');
    s.setProperty('--lum-glass', '#0A0A0D');
    s.setProperty('--lum-glass-strong', '#050507');
    s.setProperty('--lum-blur', '0px');
    s.setProperty('--lum-blur-strong', '0px');
    s.setProperty('--lum-saturate', '1');
    s.setProperty('--lum-fx', '0');
    s.setProperty('--lum-glass-border', 'rgba(255,255,255,0.08)');
    s.setProperty('--lum-glass-highlight', 'rgba(255,255,255,0.08)');
  } else {
    s.setProperty('--lum-bg', '#06080F');
    s.setProperty('--lum-glass', `rgb(13 17 28 / ${t.glassAlpha})`);
    // Chrome panes are slightly CLEARER than cards, not darker — the
    // wallpaper must read through the sidebar for it to feel like glass.
    s.setProperty('--lum-glass-strong', `rgb(10 14 24 / ${Math.min(0.92, Math.max(0.22, t.glassAlpha - 0.05)).toFixed(2)})`);
    s.setProperty('--lum-blur', `${t.blur}px`);
    s.setProperty('--lum-blur-strong', `${Math.round(t.blur * 1.4)}px`);
    s.setProperty('--lum-saturate', `${(1 + 0.85 * Math.min(1, t.blur / 20)).toFixed(2)}`);
    s.setProperty('--lum-fx', String(fx));
    s.setProperty('--lum-glass-border', `rgba(255,255,255,${(0.10 * fx).toFixed(3)})`);
    s.setProperty('--lum-glass-highlight', `rgba(255,255,255,${(0.09 * fx).toFixed(3)})`);
  }

  s.setProperty('--lum-radius', `${t.radius}px`);
  s.setProperty('--lum-radius-sm', `${Math.max(6, Math.round(t.radius * 0.625))}px`);
  s.setProperty('--lum-radius-lg', `${Math.round(t.radius * 1.25)}px`);

  s.setProperty('--lum-font', FONTS[t.font]?.stack ?? FONTS.system.stack);

  root.dataset.motion = t.motion;
  root.dataset.sidebar = t.sidebar;
  root.dataset.mode = t.mode;
  root.dataset.ui = t.ui;
}

// ── Persistence + subscription (framework-free store) ────────
const THEME_KEY = 'luminary.theme.v1';
const SAVED_KEY = 'luminary.themes.saved.v1';

export interface SavedTheme { id: string; name: string; savedAt: string; state: ThemeState; }

function sanitize(raw: unknown): ThemeState {
  const o = (raw ?? {}) as Partial<ThemeState>;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    mode: o.mode === 'focus' ? 'focus' : 'glass',
    // Key order matters here: presetActive() compares JSON.stringify of
    // sanitized states, so `ui` sits after `mode` exactly as in DEFAULT_THEME.
    ui: o.ui === 'professional' ? 'professional' : 'dashboard',
    accent: typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : DEFAULT_THEME.accent,
    wallpaper: o.wallpaper === 'custom' || WALLPAPERS.some((w) => w.id === o.wallpaper) ? (o.wallpaper as WallpaperId) : DEFAULT_THEME.wallpaper,
    weather: ['snow', 'rain', 'embers', 'petals', 'none'].includes(o.weather as string) ? (o.weather as WeatherId) : DEFAULT_THEME.weather,
    density: num(o.density, DEFAULT_THEME.density, 0.25, 1.75),
    glassAlpha: num(o.glassAlpha, DEFAULT_THEME.glassAlpha, 0.2, 0.9),
    blur: num(o.blur, DEFAULT_THEME.blur, 0, 48),
    glassFx: num(o.glassFx, DEFAULT_THEME.glassFx, 0.4, 2),
    radius: num(o.radius, DEFAULT_THEME.radius, 6, 26),
    font: (o.font as FontId) in FONTS ? (o.font as FontId) : DEFAULT_THEME.font,
    motion: ['full', 'reduced', 'off'].includes(o.motion as string) ? (o.motion as MotionLevel) : DEFAULT_THEME.motion,
    sidebar: ['glass', 'floating', 'solid'].includes(o.sidebar as string) ? (o.sidebar as SidebarStyle) : DEFAULT_THEME.sidebar,
  };
}

let current: ThemeState = DEFAULT_THEME;
const listeners = new Set<() => void>();
let modeTransitionTimer: number | undefined;
/** How long the Glass↔Focus cross-fade runs — must stay ahead of the
 *  CSS transition durations gated by [data-mode-transition] in index.css. */
const MODE_TRANSITION_MS = 500;

export function loadTheme(): ThemeState {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    current = raw ? sanitize(JSON.parse(raw)) : DEFAULT_THEME;
  } catch {
    current = DEFAULT_THEME;
  }
  return current;
}

export const getTheme = (): ThemeState => current;

export function setTheme(patch: Partial<ThemeState>): void {
  // The same cross-fade pulse covers both flips that restyle the whole
  // interface at once: Glass↔Focus and Dashboard↔Professional.
  const modeChanging =
    (patch.mode !== undefined && patch.mode !== current.mode) ||
    (patch.ui !== undefined && patch.ui !== current.ui);
  if (modeChanging) {
    // Flag the Glass↔Focus flip BEFORE applyTheme() touches any CSS
    // vars, so the gated transition rule in index.css is already
    // matching the instant the values actually change — otherwise
    // the flip lands with no transition active to catch it. Cleared
    // ~500ms later so dragging the Blur/Transparency sliders (which
    // write these same vars every frame) stays instant, not laggy.
    const root = document.documentElement;
    root.dataset.modeTransition = 'true';
    window.clearTimeout(modeTransitionTimer);
    modeTransitionTimer = window.setTimeout(() => { delete root.dataset.modeTransition; }, MODE_TRANSITION_MS);
  }
  current = sanitize({ ...current, ...patch });
  try { localStorage.setItem(THEME_KEY, JSON.stringify(current)); } catch { /* private mode */ }
  applyTheme(current);
  listeners.forEach((fn) => fn());
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at boot, before React renders — no theme flash. */
export function bootTheme(): void {
  applyTheme(loadTheme());
}

// ── Saved themes ─────────────────────────────────────────────
export function listSavedThemes(): SavedTheme[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedTheme[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveCurrentTheme(name: string): SavedTheme[] {
  const entry: SavedTheme = {
    id: `t-${Date.now().toString(36)}`,
    name: name.trim() || 'Untitled theme',
    savedAt: new Date().toISOString(),
    state: current,
  };
  const list = [entry, ...listSavedThemes()].slice(0, 24);
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

export function deleteSavedTheme(id: string): SavedTheme[] {
  const list = listSavedThemes().filter((t) => t.id !== id);
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
