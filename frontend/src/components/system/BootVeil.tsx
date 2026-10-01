// Boot veil — a one-second breath when the OS opens. The
// wordmark condenses out of blur, then the veil dissolves to
// reveal the desktop. Pure CSS; unmounts itself when done.

import { useEffect, useState } from 'react';
import BrandLogo from '@/components/ui/BrandLogo';
import { getTheme } from '@/theme/engine';

export default function BootVeil() {
  const [gone, setGone] = useState(() => getTheme().motion === 'off');

  useEffect(() => {
    if (gone) return;
    const t = setTimeout(() => setGone(true), 1650);
    return () => clearTimeout(t);
  }, [gone]);

  if (gone) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        zIndex: 100,
        background: 'var(--lum-bg)',
        animation: 'lumBootFade 0.6s ease-out 1.05s forwards',
        pointerEvents: 'none',
      }}
    >
      <div
        className="flex flex-col items-center gap-4"
        style={{ animation: 'lumBootMark 1.1s cubic-bezier(0.22, 1, 0.36, 1) forwards' }}
      >
        <div
          className="flex items-center justify-center rounded-2xl"
          style={{
            width: 52, height: 52,
            background: 'var(--lum-glass-strong)',
            boxShadow: '0 0 44px rgb(var(--lum-accent-rgb) / 0.55), inset 0 1px 0 rgba(255,255,255,0.35)',
          }}
        >
          <BrandLogo size={42} decorative />
        </div>
        <div className="text-[19px] font-bold tracking-tight" style={{ color: 'var(--lum-aurora)' }}>
          Luminary <span style={{ color: 'var(--lum-text-muted)', fontWeight: 500 }}>OS</span>
        </div>
      </div>
    </div>
  );
}
