// ============================================================
// Wallpaper — Luminary's living environment.
//
// A depth-stacked scene driven by the theme engine:
//
//   z0   backdrop    — artwork (parallax) or procedural gradient,
//                      plus animated scene layers for the Japanese
//                      wallpapers that ride the same parallax
//   z0   fog/bloom   — drifting volumetric layers
//   z0   BACK canvas — the far ~3/4 of the particles. Glass panes
//                      backdrop-blur this layer, so snow visibly
//                      frosts as it passes BEHIND a window.
//   z1   the UI      — glass panes (App renders here)
//   z30  FRONT canvas— the nearest particles drift OVER the glass,
//                      and snow/petals SETTLE on panel top edges
//                      (window sills), melting away over seconds.
//   z0   scrim       — readability gradient under the UI
//
// The pointer parallax also publishes --lum-px/--lum-py on <html>
// so the content layer (Layout) can float at its own depth.
//
// Performance: one rAF loop drives everything via refs and direct
// DOM writes (zero React re-renders). Sprites are pre-rendered;
// panel rects for settling are cached and refreshed at 1.2s (and
// on scroll). The loop pauses when the tab is hidden and respects
// both OS reduced-motion and the theme motion level.
// ============================================================

import { useEffect, useRef } from 'react';
import { useTheme } from '@/theme/useTheme';
import { wallpaperById, hexToRgb, type WallpaperId } from '@/theme/engine';

interface Particle {
  x: number; y: number;
  r: number;          // radius / size scale
  depth: number;      // 0 back … 1 front
  vy: number;         // fall (+) or rise (−) speed
  phase: number;      // wobble phase offset
  drift: number;      // horizontal wobble amplitude
  spin: number;       // rotation speed (petals)
  front: boolean;     // drawn on the over-UI canvas
  settledAt: number;  // >0 → resting on a panel sill since t (s)
}

// ── Deterministic SVG tiles for the animated scenes ──────────
// Seeded PRNG so the sky is identical every boot — no hydration
// flicker, no allocation in the render loop.
function seededRandom(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function starTile(seed: number, count: number, size: number): string {
  const rnd = seededRandom(seed);
  let shapes = '';
  for (let i = 0; i < count; i++) {
    const cx = (rnd() * size).toFixed(1);
    const cy = (rnd() * size).toFixed(1);
    const r = (0.4 + rnd() * 1.1).toFixed(2);
    const o = (0.3 + rnd() * 0.7).toFixed(2);
    shapes += `<circle cx='${cx}' cy='${cy}' r='${r}' fill='%23EAF0FF' opacity='${o}'/>`;
  }
  return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${shapes}</svg>")`;
}

/** Abstract city skyline with lit windows, as a bottom-anchored tile. */
function skylineTile(seed: number, dark: string, litEvery: number): string {
  const rnd = seededRandom(seed);
  const W = 560, H = 240;
  let rects = '';
  let x = 0;
  while (x < W) {
    const w = 22 + Math.round(rnd() * 46);
    const h = 40 + Math.round(rnd() * 150);
    rects += `<rect x='${x}' y='${H - h}' width='${w}' height='${h}' fill='${dark}'/>`;
    // Lit windows — sparse warm/cool dots on some buildings
    if (rnd() < 0.8) {
      const cols = Math.max(1, Math.floor(w / 11));
      const rows = Math.max(2, Math.floor(h / 16));
      for (let c = 0; c < cols; c++) {
        for (let rw = 0; rw < rows; rw++) {
          if (rnd() * litEvery < 1) {
            const wx = x + 4 + c * 11;
            const wy = H - h + 6 + rw * 16;
            const warm = rnd() < 0.55;
            rects += `<rect x='${wx}' y='${wy}' width='3.4' height='4.6' fill='${warm ? '%23FFD9A0' : '%2396E8F2'}' opacity='${(0.35 + rnd() * 0.6).toFixed(2)}'/>`;
          }
        }
      }
    }
    x += w + 2 + Math.round(rnd() * 8);
  }
  return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'>${rects}</svg>")`;
}

// Tiles are module-level constants — built once, reused forever.
const STARS_FAR  = starTile(1337, 46, 260);
const STARS_NEAR = starTile(7331, 22, 320);
const SKYLINE_FAR  = skylineTile(4242, '%23151233', 9);
const SKYLINE_NEAR = skylineTile(2424, '%230C0A20', 6);

// ── Animated scene layers (pure CSS, inside the parallax div) ──
function SceneLayers({ scene }: { scene: WallpaperId }) {
  if (scene === 'sakura') {
    return (
      <>
        {/* Low sun, breathing */}
        <div className="absolute lum-breathe" style={{
          left: '62%', top: '30%', width: '30vmin', height: '30vmin',
          background: 'radial-gradient(circle, rgba(255,214,224,0.85) 0%, rgba(255,183,197,0.35) 34%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(6px)', mixBlendMode: 'screen',
        }} />
        {/* Drifting haze bands — the sky moves */}
        <div className="absolute" style={{
          inset: '-10% -30%',
          background: 'radial-gradient(42% 16% at 30% 38%, rgba(255,205,220,0.34), transparent 70%), radial-gradient(36% 12% at 70% 52%, rgba(238,170,205,0.26), transparent 70%)',
          animation: 'lumSakuraDriftA 64s linear infinite alternate',
          mixBlendMode: 'screen', willChange: 'transform',
        }} />
        <div className="absolute" style={{
          inset: '-10% -30%',
          background: 'radial-gradient(46% 13% at 62% 30%, rgba(255,222,232,0.22), transparent 70%), radial-gradient(30% 10% at 22% 60%, rgba(224,150,190,0.20), transparent 70%)',
          animation: 'lumSakuraDriftB 88s linear infinite alternate',
          mixBlendMode: 'screen', willChange: 'transform',
        }} />
        {/* Mountain silhouettes at dusk */}
        <div className="absolute" style={{
          left: '-5%', right: '-5%', bottom: '-2%', height: '38%',
          background: 'radial-gradient(60% 100% at 28% 100%, rgba(38,20,48,0.95) 38%, transparent 62%), radial-gradient(70% 90% at 78% 100%, rgba(46,24,54,0.9) 34%, transparent 60%)',
        }} />
        <style>{`
          @keyframes lumSakuraDriftA { 0% { transform: translate3d(-4%, 0, 0); } 100% { transform: translate3d(4%, -1.5%, 0); } }
          @keyframes lumSakuraDriftB { 0% { transform: translate3d(3%, 1%, 0); }  100% { transform: translate3d(-3%, -0.5%, 0); } }
        `}</style>
      </>
    );
  }

  if (scene === 'neon') {
    return (
      <>
        {/* Neon haze — city glow pulsing pink/cyan */}
        <div className="absolute" style={{
          left: 0, right: 0, bottom: '18%', height: '34%',
          background: 'radial-gradient(46% 90% at 30% 100%, rgba(255,84,163,0.34), transparent 70%)',
          animation: 'lumNeonPulseA 7s ease-in-out infinite',
          mixBlendMode: 'screen', filter: 'blur(10px)', willChange: 'opacity',
        }} />
        <div className="absolute" style={{
          left: 0, right: 0, bottom: '16%', height: '30%',
          background: 'radial-gradient(42% 90% at 74% 100%, rgba(64,208,224,0.30), transparent 70%)',
          animation: 'lumNeonPulseB 9s ease-in-out infinite',
          mixBlendMode: 'screen', filter: 'blur(10px)', willChange: 'opacity',
        }} />
        {/* Far skyline — hazy, slowly sliding */}
        <div className="absolute" style={{
          left: '-20%', right: '-20%', bottom: '6%', height: '30%',
          backgroundImage: SKYLINE_FAR, backgroundRepeat: 'repeat-x', backgroundPosition: 'bottom',
          opacity: 0.8, filter: 'blur(1.2px)',
          animation: 'lumSkylineDrift 180s linear infinite alternate', willChange: 'transform',
        }} />
        {/* Near skyline with flickering windows */}
        <div className="absolute" style={{
          left: '-10%', right: '-10%', bottom: 0, height: '30%',
          backgroundImage: SKYLINE_NEAR, backgroundRepeat: 'repeat-x', backgroundPosition: 'bottom',
        }} />
        <div className="absolute" style={{
          left: '-10%', right: '-10%', bottom: 0, height: '30%',
          backgroundImage: SKYLINE_NEAR, backgroundRepeat: 'repeat-x', backgroundPosition: 'bottom',
          animation: 'lumWindowFlicker 4.6s steps(2) infinite',
          mixBlendMode: 'screen', opacity: 0.5, willChange: 'opacity',
        }} />
        {/* Wet street reflection sheen */}
        <div className="absolute" style={{
          left: 0, right: 0, bottom: 0, height: '10%',
          background: 'linear-gradient(180deg, rgba(255,84,163,0.10), rgba(64,208,224,0.06) 60%, transparent)',
          animation: 'lumNeonPulseA 7s ease-in-out infinite',
          mixBlendMode: 'screen', filter: 'blur(6px)',
        }} />
        <style>{`
          @keyframes lumNeonPulseA { 0%, 100% { opacity: 0.55; } 42% { opacity: 1; } 58% { opacity: 0.75; } }
          @keyframes lumNeonPulseB { 0%, 100% { opacity: 0.9; } 34% { opacity: 0.5; } 70% { opacity: 1; } }
          @keyframes lumSkylineDrift { 0% { transform: translate3d(-1.5%, 0, 0); } 100% { transform: translate3d(1.5%, 0, 0); } }
          @keyframes lumWindowFlicker { 0%, 100% { opacity: 0.28; } 50% { opacity: 0.6; } }
        `}</style>
      </>
    );
  }

  if (scene === 'yozora') {
    return (
      <>
        {/* Two star fields twinkling out of phase, drifting apart */}
        <div className="absolute" style={{
          inset: '-6%',
          backgroundImage: STARS_FAR, backgroundSize: '260px 260px',
          animation: 'lumTwinkleA 5.5s ease-in-out infinite, lumStarDriftA 240s linear infinite alternate',
          willChange: 'opacity, transform',
        }} />
        <div className="absolute" style={{
          inset: '-6%',
          backgroundImage: STARS_NEAR, backgroundSize: '320px 320px',
          animation: 'lumTwinkleB 8s ease-in-out infinite, lumStarDriftB 300s linear infinite alternate',
          willChange: 'opacity, transform',
        }} />
        {/* Moon with halo */}
        <div className="absolute lum-breathe" style={{
          left: '71%', top: '14%', width: '13vmin', height: '13vmin', borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 34%, #F6F3E7 0%, #E8E2CC 46%, #C9C3AE 62%, transparent 66%)',
          boxShadow: '0 0 8vmin 2.5vmin rgba(236,232,205,0.28)',
        }} />
        {/* Aurora ribbon flowing across the sky */}
        <div className="absolute" style={{
          left: '-16%', top: '4%', width: '90%', height: '34%',
          background: 'linear-gradient(100deg, transparent 6%, rgba(110,222,180,0.20) 28%, rgba(126,156,255,0.22) 52%, rgba(180,124,238,0.16) 72%, transparent 94%)',
          filter: 'blur(26px)', transform: 'rotate(-8deg)',
          animation: 'lumAuroraFlow 26s ease-in-out infinite alternate',
          mixBlendMode: 'screen', willChange: 'transform, opacity',
        }} />
        {/* Dark treeline horizon */}
        <div className="absolute" style={{
          left: '-4%', right: '-4%', bottom: '-2%', height: '22%',
          background: 'radial-gradient(52% 100% at 24% 100%, rgba(5,9,16,0.98) 44%, transparent 66%), radial-gradient(60% 92% at 74% 100%, rgba(6,10,18,0.95) 40%, transparent 64%)',
        }} />
        <style>{`
          @keyframes lumTwinkleA { 0%, 100% { opacity: 0.85; } 50% { opacity: 0.45; } }
          @keyframes lumTwinkleB { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.95; } }
          @keyframes lumStarDriftA { 0% { transform: translate3d(0, 0, 0); } 100% { transform: translate3d(-1.2%, 0.6%, 0); } }
          @keyframes lumStarDriftB { 0% { transform: translate3d(0, 0, 0); } 100% { transform: translate3d(1.2%, -0.4%, 0); } }
          @keyframes lumAuroraFlow {
            0%   { transform: rotate(-8deg) translate3d(-3%, 0, 0) scaleY(1); opacity: 0.75; }
            100% { transform: rotate(-6deg) translate3d(5%, 2%, 0) scaleY(1.15); opacity: 1; }
          }
        `}</style>
      </>
    );
  }

  return null;
}

export default function Wallpaper() {
  const [theme] = useTheme();
  const backCanvasRef = useRef<HTMLCanvasElement>(null);
  const frontCanvasRef = useRef<HTMLCanvasElement>(null);
  const artRef = useRef<HTMLDivElement>(null);

  const wp = wallpaperById(theme.wallpaper);
  const { weather, density, motion, accent } = theme;

  useEffect(() => {
    const back = backCanvasRef.current;
    const front = frontCanvasRef.current;
    const art = artRef.current;
    if (!back || !front || !art) return;
    const bctx = back.getContext('2d');
    const fctx = front.getContext('2d');
    if (!bctx || !fctx) return;

    const docStyle = document.documentElement.style;
    const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Focus Mode is a deliberate blackout — no wallpaper, no weather,
    // no parallax; treat it exactly like the motion-off/still path.
    const still = motion === 'off' || osReduced || theme.mode === 'focus';
    const calm = motion === 'reduced';                    // particles, no parallax
    const speedScale = calm ? 0.6 : 1;

    // ── Sprites: soft discs / petals rendered once ────────────
    const makeSprite = (stops: Array<[number, string]>) => {
      const c = document.createElement('canvas');
      const S = 32;
      c.width = S; c.height = S;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      stops.forEach(([o, col]) => grad.addColorStop(o, col));
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      return c;
    };

    const snowSprite = makeSprite([
      [0, 'rgba(244,247,252,0.95)'], [0.55, 'rgba(230,238,250,0.5)'], [1, 'rgba(230,238,250,0)'],
    ]);
    const [ar, ag, ab] = hexToRgb(accent);
    const emberSprite = makeSprite([
      [0, `rgba(${Math.min(255, ar + 60)},${Math.min(255, ag + 30)},${ab},0.95)`],
      [0.4, `rgba(${ar},${ag},${ab},0.5)`],
      [1, `rgba(${ar},${ag},${ab},0)`],
    ]);

    // Petal: an elliptical blossom sprite (squashed radial gradient)
    const petalSprite = (() => {
      const c = document.createElement('canvas');
      const S = 32;
      c.width = S; c.height = S;
      const g = c.getContext('2d')!;
      g.translate(S / 2, S / 2);
      g.scale(1, 0.62);                        // ellipse — petal silhouette
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
      grad.addColorStop(0, 'rgba(255,224,233,0.95)');
      grad.addColorStop(0.55, 'rgba(248,183,205,0.85)');
      grad.addColorStop(0.9, 'rgba(238,148,182,0.25)');
      grad.addColorStop(1, 'rgba(238,148,182,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, S / 2, 0, Math.PI * 2);
      g.fill();
      return c;
    })();

    let parts: Particle[] = [];
    let width = 0, height = 0;

    // ── Panel sills — where front snow/petals come to rest ────
    // Viewport rects of glass panes, refreshed lazily. Full-height
    // chrome (sidebar/topbar, top < 40px) is excluded: only panes
    // with a visible top edge act as sills.
    let sills: Array<{ left: number; right: number; top: number }> = [];
    const collectSills = () => {
      const els = document.querySelectorAll('.lum-glass, .lum-glass-strong');
      const next: typeof sills = [];
      for (let i = 0; i < els.length && next.length < 24; i++) {
        const r = (els[i] as HTMLElement).getBoundingClientRect();
        if (r.top < 40 || r.width < 60 || r.top > height) continue;
        next.push({ left: r.left + 3, right: r.right - 3, top: r.top });
      }
      sills = next;
    };
    collectSills();
    const sillTimer = window.setInterval(collectSills, 1200);
    let scrollTick = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - scrollTick > 250) { scrollTick = now; collectSills(); }
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    const canSettle = weather === 'snow' || weather === 'petals';
    const SETTLE_FADE = 5;                    // seconds on the sill

    const seed = () => {
      if (weather === 'none' || still) { parts = []; return; }
      const base = weather === 'rain' ? 7000 : weather === 'petals' ? 16000 : 10500;
      const cap = weather === 'rain' ? 340 : weather === 'petals' ? 150 : 230;
      const count = Math.min(cap, Math.round(((width * height) / base) * density));
      parts = Array.from({ length: count }, () => {
        const depth = Math.pow(Math.random(), 1.4);
        // The nearest quarter of the field drifts OVER the glass —
        // rain stays behind the UI (fast streaks over text = noise).
        const front = weather !== 'rain' && depth > 0.72;
        if (weather === 'rain') {
          return {
            x: Math.random() * (width + 100) - 50,
            y: Math.random() * height,
            r: 0.7 + depth * 1.1,
            depth,
            vy: (340 + depth * 420 + Math.random() * 80) * speedScale, // px/s — rain is fast
            phase: 0, drift: 0, spin: 0, front: false, settledAt: 0,
          };
        }
        if (weather === 'embers') {
          return {
            x: Math.random() * width,
            y: Math.random() * height,
            r: 0.8 + depth * 2.6 + Math.random() * 0.7,
            depth,
            vy: -(6 + depth * 22 + Math.random() * 6) * speedScale,   // rises
            phase: Math.random() * Math.PI * 2,
            drift: 10 + depth * 26, spin: 0, front, settledAt: 0,
          };
        }
        if (weather === 'petals') {
          return {
            x: Math.random() * width,
            y: Math.random() * height,
            r: 1.6 + depth * 3.2 + Math.random() * 0.9,
            depth,
            vy: (16 + depth * 30 + Math.random() * 8) * speedScale,   // lazy fall
            phase: Math.random() * Math.PI * 2,
            drift: 26 + depth * 44,                                   // wide flutter
            spin: (0.6 + Math.random() * 1.6) * (Math.random() < 0.5 ? -1 : 1),
            front, settledAt: 0,
          };
        }
        return {                                                      // snow
          x: Math.random() * width,
          y: Math.random() * height,
          r: 1.0 + depth * 3.4 + Math.random() * 0.8,
          depth,
          vy: (11 + depth * 34 + Math.random() * 7) * speedScale,
          phase: Math.random() * Math.PI * 2,
          drift: 7 + depth * 20, spin: 0, front, settledAt: 0,
        };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      for (const [canvas, ctx] of [[back, bctx], [front, fctx]] as const) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      seed();
      collectSills();
    };
    resize();
    window.addEventListener('resize', resize);

    // ── Pointer parallax (lerped) ────────────────────────────
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    const onPointer = (e: MouseEvent) => {
      target.x = (e.clientX / width - 0.5) * 2;   // -1 … 1
      target.y = (e.clientY / height - 0.5) * 2;
    };
    const parallaxOn = !still && !calm;
    if (parallaxOn) window.addEventListener('mousemove', onPointer, { passive: true });

    // Content-layer depth: Layout floats <main> on these vars
    docStyle.setProperty('--lum-px', '0');
    docStyle.setProperty('--lum-py', '0');

    if (still) {
      bctx.clearRect(0, 0, width, height);
      fctx.clearRect(0, 0, width, height);
      art.style.transform = 'scale(1.06)';
      return () => {
        window.removeEventListener('resize', resize);
        window.clearInterval(sillTimer);
        window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      };
    }

    // ── Main loop ────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();
    let running = true;

    const respawn = (p: Particle) => {
      p.settledAt = 0;
      p.y = -10;
      p.x = Math.random() * width;
    };

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      // Parallax: backdrop drifts opposite the pointer; the UI layer
      // (via CSS vars) leans WITH the pointer at a shallower rate —
      // three planes moving at three speeds = depth.
      if (parallaxOn) {
        current.x += (target.x - current.x) * 0.045;
        current.y += (target.y - current.y) * 0.045;
        art.style.transform =
          `translate3d(${(-current.x * 14).toFixed(2)}px, ${(-current.y * 9).toFixed(2)}px, 0) scale(1.06)`;
        docStyle.setProperty('--lum-px', current.x.toFixed(4));
        docStyle.setProperty('--lum-py', current.y.toFixed(4));
      }

      bctx.clearRect(0, 0, width, height);
      fctx.clearRect(0, 0, width, height);

      if (weather === 'rain') {
        // Rain: slanted luminous streaks, longer when closer
        const slant = 0.16 + Math.sin(t * 0.1) * 0.05;
        bctx.lineCap = 'round';
        for (const p of parts) {
          p.y += p.vy * dt;
          p.x += p.vy * slant * dt;
          if (p.y > height + 20) { p.y = -20; p.x = Math.random() * (width + 100) - 50; }
          const len = 9 + p.depth * 17;
          bctx.globalAlpha = 0.10 + p.depth * 0.22;
          bctx.strokeStyle = '#AFC6E8';
          bctx.lineWidth = p.r;
          bctx.beginPath();
          bctx.moveTo(p.x, p.y);
          bctx.lineTo(p.x - len * slant, p.y - len);
          bctx.stroke();
        }
        bctx.globalAlpha = 1;
      } else if (weather === 'embers') {
        // Embers / fireflies: rising sparks with a slow flicker
        for (const p of parts) {
          const ctx = p.front ? fctx : bctx;
          p.y += p.vy * dt;
          p.x += Math.sin(t * 0.7 + p.phase) * p.drift * 0.16 * dt * 10;
          if (p.y < -8) { p.y = height + 8; p.x = Math.random() * width; }
          if (p.x > width + 8) p.x = -8;
          else if (p.x < -8) p.x = width + 8;
          const px = p.x + current.x * p.depth * (p.front ? 30 : 16);
          const size = p.r * 3;
          const flicker = 0.75 + Math.sin(t * 2.2 + p.phase * 3) * 0.25;
          ctx.globalAlpha = (0.25 + p.depth * 0.5) * flicker * (p.front ? 0.85 : 1);
          ctx.drawImage(emberSprite, px - size / 2, p.y - size / 2, size, size);
          ctx.globalAlpha = 1;
        }
      } else if (weather === 'petals' || weather === 'snow') {
        const isPetals = weather === 'petals';
        const wind = isPetals ? 0 : Math.sin(t * 0.22) * 9 + Math.sin(t * 0.071) * 5;
        for (const p of parts) {
          const ctx = p.front ? fctx : bctx;
          const sprite = isPetals ? petalSprite : snowSprite;

          // Resting on a sill: fade out in place, then respawn
          if (p.settledAt > 0) {
            const age = t - p.settledAt;
            if (age > SETTLE_FADE) { respawn(p); continue; }
            const fade = 1 - age / SETTLE_FADE;
            const size = p.r * (isPetals ? 3.4 : 3) * (0.8 + 0.2 * fade);
            ctx.globalAlpha = (0.5 + p.depth * 0.45) * fade;
            ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2 + 1, size, size);
            ctx.globalAlpha = 1;
            continue;
          }

          if (isPetals) {
            const flutter = Math.sin(t * 1.1 + p.phase);
            p.y += (p.vy + flutter * 6) * dt;
            p.x += (Math.sin(t * 0.6 + p.phase) * p.drift * 0.35 + 12 * p.depth) * dt;
          } else {
            p.y += p.vy * dt;
            p.x += (wind * (0.35 + p.depth * 0.85) + Math.sin(t * 0.9 + p.phase) * p.drift * 0.14) * dt;
          }
          if (p.y > height + 10) { p.y = -10; p.x = Math.random() * width; }
          if (p.x > width + 12) p.x = -12;
          else if (p.x < -12) p.x = width + 12;

          // Front flakes land on panel sills — snow on the window
          if (p.front && canSettle && p.vy > 0) {
            for (const s of sills) {
              if (p.x >= s.left && p.x <= s.right && p.y >= s.top - 2 && p.y <= s.top + 5) {
                p.settledAt = t;
                p.y = s.top;
                break;
              }
            }
          }

          const px = p.x + current.x * p.depth * (p.front ? 34 : 20);
          const size = p.r * (isPetals ? 3.4 : 3);
          if (isPetals) {
            const flutter = Math.sin(t * 1.1 + p.phase);
            ctx.save();
            ctx.translate(px, p.y);
            ctx.rotate(t * p.spin + p.phase + flutter * 0.5);
            ctx.globalAlpha = 0.5 + p.depth * 0.45;
            ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
            ctx.restore();
          } else {
            ctx.globalAlpha = 0.42 + p.depth * 0.5;
            ctx.drawImage(sprite, px - size / 2, p.y - size / 2, size, size);
          }
          ctx.globalAlpha = 1;
        }
      }

      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
    };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    raf = requestAnimationFrame(tick);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(sillTimer);
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      docStyle.setProperty('--lum-px', '0');
      docStyle.setProperty('--lum-py', '0');
    };
  }, [weather, density, motion, accent, wp.id, theme.mode]);

  // Focus Mode steps the whole living environment back — no artwork,
  // no fog, no weather — so Layout's plain --lum-bg (now black) is
  // all that's left behind the glass. Faded via opacity (not an
  // unmount) so the transition into/out of Focus Mode is a smooth
  // cross-fade rather than a hard cut; the rAF loop above already
  // freezes/clears as part of the `still` branch once mode is focus,
  // so nothing animates underneath while it's invisible.
  const focused = theme.mode === 'focus';

  return (
    <div style={{ opacity: focused ? 0 : 1, transition: 'opacity 0.4s ease', pointerEvents: focused ? 'none' : undefined }}>
      <div aria-hidden className="fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        {/* z0 — backdrop with parallax headroom: artwork or gradient,
               plus animated scene layers that ride the parallax */}
        <div
          ref={artRef}
          className="absolute inset-0 overflow-hidden"
          style={{
            ...(wp.image
              ? {
                  backgroundImage: `url(${wp.image})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center 42%',
                }
              : { background: wp.css }),
            transform: 'scale(1.06)',
            willChange: 'transform',
          }}
        >
          {wp.animated && <SceneLayers scene={wp.id} />}
        </div>

        {/* volumetric fog, two drifting layers */}
        <div
          className="absolute"
          style={{
            inset: '-20%',
            background: 'radial-gradient(55% 42% at 30% 68%, rgba(168,178,214,0.14), transparent 70%)',
            animation: 'lumFogA 46s ease-in-out infinite alternate',
            mixBlendMode: 'screen',
            willChange: 'transform',
          }}
        />
        <div
          className="absolute"
          style={{
            inset: '-20%',
            background: 'radial-gradient(48% 36% at 72% 40%, rgba(150,166,210,0.1), transparent 70%)',
            animation: 'lumFogB 58s ease-in-out infinite alternate',
            mixBlendMode: 'screen',
            willChange: 'transform',
          }}
        />

        {/* breathing bloom where the light falls */}
        <div
          className="absolute lum-breathe"
          style={{
            inset: 0,
            background: wp.image
              ? 'radial-gradient(42% 34% at 62% 16%, rgba(214,224,255,0.16), transparent 72%)'
              : 'radial-gradient(42% 34% at 62% 16%, rgb(var(--lum-accent-rgb) / 0.10), transparent 72%)',
            mixBlendMode: 'screen',
          }}
        />

        {/* z0 — BACK particles: glass panes frost these through
               their backdrop blur — weather visibly behind windows */}
        <canvas ref={backCanvasRef} className="absolute inset-0" style={{ willChange: 'transform' }} />

        {/* scrim — lighter than before: the sidebar must stay glass */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(6,8,15,0.34) 0%, rgba(6,8,15,0.14) 32%, rgba(6,8,15,0.2) 68%, rgba(6,8,15,0.5) 100%),' +
              'radial-gradient(115% 85% at 52% 42%, transparent 40%, rgba(5,7,13,0.42) 100%)',
          }}
        />
      </div>

      {/* z30 — FRONT particles drift over the glass and settle on
             panel sills; clicks pass straight through */}
      <canvas
        ref={frontCanvasRef}
        aria-hidden
        className="fixed inset-0"
        style={{ zIndex: 30, pointerEvents: 'none', willChange: 'transform' }}
      />

      <style>{`
        @keyframes lumFogA {
          0%   { transform: translate3d(-2.5%, 0.5%, 0) scale(1); }
          100% { transform: translate3d(2.5%, -1%, 0) scale(1.06); }
        }
        @keyframes lumFogB {
          0%   { transform: translate3d(2%, -0.5%, 0) scale(1.04); }
          100% { transform: translate3d(-2%, 1%, 0) scale(1); }
        }
      `}</style>
    </div>
  );
}
