// ============================================================
// Theme Center — Luminary's identity studio.
//
// Every control here writes straight into the theme engine, so
// the entire interface retunes live while you drag. Presets are
// curated moods; saved themes are the user's own snapshots.
// ============================================================

import { useState } from 'react';
import {
  Palette, Snowflake, CloudRain, Flame, CircleOff, Flower2,
  PanelLeft, Save, RotateCcw, Trash2, Check, Sparkles, Wind, Layers, Moon,
  LayoutDashboard, Briefcase,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Button, Slider, Segmented } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';
import {
  ACCENTS, DEFAULT_THEME, PRESETS, WALLPAPERS, FONTS,
  listSavedThemes, saveCurrentTheme, deleteSavedTheme,
  setTheme as applyState, getCustomWallpaper,
  type FontId, type SavedTheme, type ThemePreset, type WallpaperDef,
} from '@/theme/engine';
import { staggerParent, riseIn } from '@/lib/motion';

/** Section — a titled glass panel. */
function Section({ title, hint, children, span2 }: {
  title: string; hint: string; children: React.ReactNode; span2?: boolean;
}) {
  return (
    // '1 / -1' spans all explicit tracks — safe even when the
    // auto-fit grid collapses to a single column on narrow screens
    <motion.div variants={riseIn} style={span2 ? { gridColumn: '1 / -1' } : undefined}>
      <Card reflect style={{ padding: 22, height: '100%' }}>
        <div className="mb-1 text-[13px] font-semibold tracking-tight" style={{ color: 'var(--lum-aurora)' }}>{title}</div>
        <div className="mb-4 text-[11px] leading-relaxed" style={{ color: 'var(--lum-text-muted)' }}>{hint}</div>
        {children}
      </Card>
    </motion.div>
  );
}

/** Label above a slider row. */
function Knob({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div className="mb-1 text-[11.5px] font-medium" style={{ color: 'var(--lum-text-secondary)' }}>{label}</div>
      {children}
    </div>
  );
}

export default function ThemeCenter() {
  const [theme, setTheme] = useTheme();
  const [saved, setSaved] = useState<SavedTheme[]>(listSavedThemes);
  const [saveName, setSaveName] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const presetActive = (p: ThemePreset) => JSON.stringify(p.state) === JSON.stringify(theme);
  const focused = theme.mode === 'focus';
  // Everything below only matters while the living environment is
  // actually on screen — quietly dim it out during Focus Mode
  // rather than hiding it (the settings are still there when you
  // switch back).
  const glassCtl: React.CSSProperties = focused
    ? { opacity: 0.35, pointerEvents: 'none', transition: 'opacity 0.25s' }
    : { transition: 'opacity 0.25s' };

  // The custom wallpaper only exists once the user has dropped an
  // image somewhere in the app (see Layout.tsx) — it isn't part of
  // the static WALLPAPERS catalog, so it's appended here.
  const customImage = getCustomWallpaper();
  const wallpaperOptions: WallpaperDef[] = customImage
    ? [...WALLPAPERS, { id: 'custom', name: 'Your image', hint: 'Dropped-in wallpaper', image: customImage }]
    : WALLPAPERS;

  const handleSave = () => {
    setSaved(saveCurrentTheme(saveName));
    setSaveName('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 'clamp(16px, 2.4vw, 30px)' }}>
      <motion.div
        variants={staggerParent} initial="initial" animate="enter"
        className="mx-auto"
        style={{ maxWidth: 1180 }}
      >
        {/* Header */}
        <motion.div variants={riseIn} className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="flex items-center justify-center rounded-[10px]"
                   style={{ width: 30, height: 30, background: 'var(--lum-accent-grad)', boxShadow: '0 0 18px rgb(var(--lum-accent-rgb) / 0.5)' }}>
                <Palette size={15} color="#fff" />
              </div>
              <h1 className="text-[20px] font-bold tracking-tight" style={{ color: 'var(--lum-aurora)' }}>Theme Center</h1>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--lum-text-muted)' }}>
              Shape the glass, light and motion of your Luminary. Every change applies instantly.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => applyState(DEFAULT_THEME)}>
            <RotateCcw size={12} /> Reset to default
          </Button>
        </motion.div>

        {/* Moods */}
        <motion.div variants={riseIn} className="mb-5">
          <Card reflect style={{ padding: 22 }}>
            <div className="mb-1 text-[13px] font-semibold tracking-tight" style={{ color: 'var(--lum-aurora)' }}>Moods</div>
            <div className="mb-4 text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>
              Curated starting points — accent, wallpaper and atmosphere in one touch
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))' }}>
              {PRESETS.map((p) => {
                const active = presetActive(p);
                const wp = WALLPAPERS.find((w) => w.id === p.state.wallpaper)!;
                return (
                  <motion.button
                    key={p.id}
                    onClick={() => applyState(p.state)}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.97 }}
                    className="relative overflow-hidden text-left"
                    style={{
                      borderRadius: 'var(--lum-radius-sm)', padding: 0, cursor: 'pointer',
                      border: active ? `1.5px solid ${p.state.accent}` : '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.03)',
                      boxShadow: active ? `0 6px 24px -8px ${p.state.accent}66` : 'none',
                      transition: 'border-color 0.25s ease, box-shadow 0.3s ease',
                    }}
                  >
                    {/* Mini environment preview */}
                    <div style={{
                      height: 58,
                      background: wp.image ? `url(${wp.image}) center 40% / cover` : wp.css,
                      position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: `linear-gradient(180deg, transparent 30%, ${p.state.accent}22 100%)`,
                      }} />
                      <div style={{
                        position: 'absolute', left: 8, bottom: 8,
                        width: 26, height: 14, borderRadius: 4,
                        background: 'rgba(13,17,28,0.55)', backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(255,255,255,0.2)',
                      }} />
                      <div style={{
                        position: 'absolute', right: 8, top: 8,
                        width: 10, height: 10, borderRadius: '50%',
                        background: p.state.accent, boxShadow: `0 0 10px ${p.state.accent}`,
                      }} />
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--lum-text)' }}>{p.name}</span>
                        {active && <Check size={12} style={{ color: p.state.accent }} />}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--lum-text-muted)' }}>{p.hint}</div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </Card>
        </motion.div>

        {/* Two-column grid of control sections */}
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>

          <Section title="Mode" hint={focused ? 'Pure black, no glass — the interface steps back so the work is all that glows.' : 'Glass is the living default; Focus steps everything back to black.'}>
            <Segmented
              value={theme.mode}
              onChange={(mode) => setTheme({ mode })}
              options={[
                { value: 'glass', label: 'Glass', Icon: Layers },
                { value: 'focus', label: 'Focus', Icon: Moon },
              ]}
            />
          </Section>

          <Section title="Interface" hint="Professional strips the dashboard away — a plain, focused chat workspace. Your accent color carries over; wallpaper and weather stay here.">
            <Segmented
              value={theme.ui}
              onChange={(ui) => setTheme({ ui })}
              options={[
                { value: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
                { value: 'professional', label: 'Professional', Icon: Briefcase },
              ]}
            />
          </Section>

          <Section title="Accent" hint="The color of light across the whole interface">
            <div className="flex flex-wrap items-center gap-2.5">
              {ACCENTS.map((hex) => {
                const active = theme.accent.toLowerCase() === hex.toLowerCase();
                return (
                  <motion.button
                    key={hex}
                    onClick={() => setTheme({ accent: hex })}
                    whileHover={{ scale: 1.18, y: -2 }}
                    whileTap={{ scale: 0.9 }}
                    title={hex}
                    style={{
                      width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                      background: `linear-gradient(145deg, ${hex}, ${hex}CC)`,
                      border: active ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                      boxShadow: active ? `0 0 16px ${hex}AA` : `0 2px 8px -2px ${hex}55`,
                      transition: 'border-color 0.2s ease, box-shadow 0.25s ease',
                    }}
                  />
                );
              })}
              {/* Custom color */}
              <label
                className="relative flex items-center justify-center"
                title="Custom color"
                style={{
                  width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                  background: 'conic-gradient(#E8746B, #E8C86B, #7FD99A, #7CC0EE, #B48CF5, #E8746B)',
                  border: ACCENTS.every(a => a.toLowerCase() !== theme.accent.toLowerCase())
                    ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)',
                }}
              >
                <input
                  type="color"
                  value={theme.accent}
                  onChange={(e) => setTheme({ accent: e.target.value })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                />
              </label>
              <span className="text-[11px] font-mono ml-1" style={{ color: 'var(--lum-text-muted)' }}>{theme.accent.toUpperCase()}</span>
            </div>
          </Section>

          <Section title="Atmosphere" hint={focused ? 'Paused while Focus Mode is on' : 'Weather drifting through the wallpaper'}>
            <div style={glassCtl}>
              <Segmented
                value={theme.weather}
                onChange={(weather) => setTheme({ weather })}
                options={[
                  { value: 'none',   label: 'Still',  Icon: CircleOff },
                  { value: 'snow',   label: 'Snow',   Icon: Snowflake },
                  { value: 'rain',   label: 'Rain',   Icon: CloudRain },
                  { value: 'embers', label: 'Embers', Icon: Flame },
                  { value: 'petals', label: 'Petals', Icon: Flower2 },
                ]}
              />
              <div className="mt-4" style={{ opacity: theme.weather === 'none' ? 0.35 : 1, pointerEvents: theme.weather === 'none' ? 'none' : undefined, transition: 'opacity 0.25s' }}>
                <Knob label="Particle density">
                  <Slider
                    value={theme.density} min={0.25} max={1.75} step={0.05}
                    onChange={(density) => setTheme({ density })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </Knob>
              </div>
            </div>
          </Section>

          <Section title="Wallpaper" hint={focused ? 'Paused while Focus Mode is on' : 'The environment behind the glass — drop an image anywhere to use it as your own'} span2>
            <div className="grid gap-3" style={{ ...glassCtl, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {wallpaperOptions.map((w) => {
                const active = theme.wallpaper === w.id;
                return (
                  <motion.button
                    key={w.id}
                    onClick={() => setTheme({ wallpaper: w.id })}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.97 }}
                    className="relative overflow-hidden text-left"
                    style={{
                      borderRadius: 'var(--lum-radius-sm)', cursor: 'pointer', padding: 0,
                      border: active ? '1.5px solid var(--lum-accent)' : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: active ? '0 6px 24px -8px rgb(var(--lum-accent-rgb) / 0.45)' : 'none',
                      transition: 'border-color 0.25s ease, box-shadow 0.3s ease',
                    }}
                  >
                    <div style={{
                      height: 72,
                      background: w.image ? `url(${w.image}) center 40% / cover` : w.css,
                    }} />
                    <div className="flex items-center justify-between px-2.5 py-2"
                         style={{ background: 'rgba(10,13,20,0.6)' }}>
                      <div>
                        <div className="text-[11.5px] font-medium" style={{ color: 'var(--lum-text)' }}>{w.name}</div>
                        <div className="text-[9.5px]" style={{ color: 'var(--lum-text-muted)' }}>{w.hint}</div>
                      </div>
                      {active && <Check size={12} style={{ color: 'var(--lum-accent)' }} />}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </Section>

          <Section title="Liquid Glass" hint={focused ? 'Paused while Focus Mode is on' : 'The physical material of every panel'}>
            <div style={glassCtl}>
              <Knob label="Transparency">
                <Slider
                  value={Math.round((1 - theme.glassAlpha) * 100)} min={10} max={80} step={1}
                  onChange={(v) => setTheme({ glassAlpha: 1 - v / 100 })}
                  format={(v) => `${v}%`}
                />
              </Knob>
              <Knob label="Blur">
                <Slider
                  value={theme.blur} min={0} max={48} step={1}
                  onChange={(blur) => setTheme({ blur })}
                  format={(v) => `${v}px`}
                />
              </Knob>
              <Knob label="Glass strength — borders, highlights & reflections">
                <Slider
                  value={Math.round(theme.glassFx * 100)} min={40} max={200} step={5}
                  onChange={(v) => setTheme({ glassFx: v / 100 })}
                  format={(v) => `${v}%`}
                />
              </Knob>
            </div>
          </Section>

          <Section title="Shape & Motion" hint="Geometry and physics of the interface">
            <Knob label="Corner radius">
              <Slider
                value={theme.radius} min={6} max={26} step={1}
                onChange={(radius) => setTheme({ radius })}
                format={(v) => `${v}px`}
              />
            </Knob>
            <Knob label="Motion">
              <Segmented
                value={theme.motion}
                onChange={(motion) => setTheme({ motion })}
                options={[
                  { value: 'full',    label: 'Fluid',   Icon: Wind },
                  { value: 'reduced', label: 'Calm' },
                  { value: 'off',     label: 'Static' },
                ]}
              />
            </Knob>
            <Knob label="Sidebar style">
              <Segmented
                value={theme.sidebar}
                onChange={(sidebar) => setTheme({ sidebar })}
                options={[
                  { value: 'glass',    label: 'Glass',    Icon: Layers },
                  { value: 'floating', label: 'Floating', Icon: PanelLeft },
                  { value: 'solid',    label: 'Solid' },
                ]}
              />
            </Knob>
          </Section>

          <Section title="Typography" hint="The voice of the interface — applies instantly" span2>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
              {(Object.keys(FONTS) as FontId[]).map((id) => {
                const f = FONTS[id];
                const active = theme.font === id;
                return (
                  <motion.button
                    key={id}
                    onClick={() => setTheme({ font: id })}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.97 }}
                    className="text-left px-3.5 py-3"
                    style={{
                      borderRadius: 'var(--lum-radius-sm)', cursor: 'pointer',
                      border: active ? '1.5px solid var(--lum-accent)' : '1px solid rgba(255,255,255,0.08)',
                      background: active ? 'rgb(var(--lum-accent-rgb) / 0.08)' : 'rgba(255,255,255,0.03)',
                      boxShadow: active ? '0 6px 24px -8px rgb(var(--lum-accent-rgb) / 0.4)' : 'none',
                      transition: 'border-color 0.25s ease, background 0.25s ease, box-shadow 0.3s ease',
                    }}
                  >
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span style={{ fontFamily: f.stack, fontSize: 22, fontWeight: 600, color: 'var(--lum-aurora)', lineHeight: 1 }}>Ag</span>
                      {active && <Check size={12} style={{ color: 'var(--lum-accent)' }} />}
                    </div>
                    <div className="text-[12px] font-medium" style={{ color: 'var(--lum-text)', fontFamily: f.stack }}>{f.label}</div>
                    <div className="text-[9.5px] mt-0.5" style={{ color: 'var(--lum-text-muted)' }}>{f.hint}</div>
                  </motion.button>
                );
              })}
            </div>
          </Section>

          <Section title="Saved Themes" hint="Snapshot the current look and return to it any time" span2>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                placeholder="Name this theme…"
                className="lum-glass-subtle"
                style={{ padding: '8px 12px', color: 'var(--lum-text)', fontSize: 12.5, outline: 'none', width: 220 }}
              />
              <Button variant="accent" size="sm" onClick={handleSave}>
                {justSaved ? <Check size={12} /> : <Save size={12} />} {justSaved ? 'Saved' : 'Save current'}
              </Button>
            </div>
            {saved.length === 0 ? (
              <div className="flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--lum-text-muted)' }}>
                <Sparkles size={12} /> Nothing saved yet — tune the look above, then snapshot it here.
              </div>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                <AnimatePresence initial={false}>
                  {saved.map((t) => (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="flex items-center gap-2.5 px-3 py-2.5 lum-glass-subtle"
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                        background: t.state.accent, boxShadow: `0 0 8px ${t.state.accent}88`,
                      }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium truncate" style={{ color: 'var(--lum-text)' }}>{t.name}</div>
                        <div className="text-[9.5px]" style={{ color: 'var(--lum-text-muted)' }}>
                          {WALLPAPERS.find(w => w.id === t.state.wallpaper)?.name} · {FONTS[t.state.font].label}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => applyState(t.state)} title="Apply">
                        Apply
                      </Button>
                      <button
                        onClick={() => setSaved(deleteSavedTheme(t.id))}
                        title="Delete"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 3, color: 'var(--lum-text-muted)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </Section>
        </div>
      </motion.div>
    </div>
  );
}
