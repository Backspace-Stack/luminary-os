// Lock screen — shown at launch when a PIN is set in Settings →
// Security. The wallpaper stays alive behind heavy glass; the
// clock breathes; a wrong PIN shakes honestly. The PIN guards
// the interface on this machine — it is not encryption.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import BrandLogo from '@/components/ui/BrandLogo';
import { getPrefs } from '@/lib/prefs';

interface LockScreenProps { onUnlock: () => void; }

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(0);   // increments to retrigger shake
  const [now, setNow] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    inputRef.current?.focus();
    return () => clearInterval(t);
  }, []);

  const submit = (value: string) => {
    if (value === getPrefs().lockPin) {
      onUnlock();
    } else {
      setWrong((w) => w + 1);
      setPin('');
    }
  };

  const onChange = (raw: string) => {
    const v = raw.replace(/\D/g, '').slice(0, 8);
    setPin(v);
    // Auto-submit once the stored PIN length is reached
    const target = getPrefs().lockPin;
    if (target && v.length === target.length) submit(v);
  };

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ zIndex: 80 }}>
      {/* Heavy frost over the living wallpaper */}
      <div className="absolute inset-0" style={{
        background: 'rgb(6 8 15 / 0.4)',
        backdropFilter: 'blur(30px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(30px) saturate(1.3)',
      }} />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center"
      >
        <div className="text-[64px] font-bold tabular tracking-tight leading-none mb-2"
             style={{ color: 'var(--lum-aurora)', textShadow: '0 4px 30px rgba(0,0,0,0.5)' }}>
          {time}
        </div>
        <div className="text-[14px] mb-10" style={{ color: 'var(--lum-text-secondary)' }}>{date}</div>

        <motion.div
          key={wrong}
          animate={wrong > 0 ? { x: [0, -10, 10, -7, 7, -3, 0] } : undefined}
          transition={{ duration: 0.42 }}
          className="flex flex-col items-center gap-4 px-8 py-7 lum-glass lum-reflect"
          style={{ borderRadius: 'var(--lum-radius-lg)', minWidth: 260 }}
        >
          <div className="flex items-center justify-center rounded-xl"
               style={{ width: 40, height: 40, background: 'var(--lum-accent-grad)', boxShadow: '0 0 24px rgb(var(--lum-accent-rgb) / 0.5)' }}>
            <Lock size={17} color="#fff" />
          </div>
          <div className="text-[13px] font-medium" style={{ color: 'var(--lum-text)' }}>Enter PIN to unlock</div>

          {/* PIN dots */}
          <div className="flex gap-2.5" style={{ minHeight: 12 }}>
            {Array.from({ length: Math.max(4, getPrefs().lockPin?.length ?? 4) }).map((_, i) => (
              <span key={i} style={{
                width: 10, height: 10, borderRadius: '50%',
                background: i < pin.length ? 'var(--lum-accent)' : 'rgba(255,255,255,0.12)',
                boxShadow: i < pin.length ? '0 0 8px rgb(var(--lum-accent-rgb) / 0.7)' : 'none',
                transition: 'background 0.15s ease, box-shadow 0.2s ease',
              }} />
            ))}
          </div>

          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(pin); }}
            onBlur={() => inputRef.current?.focus()}
            aria-label="PIN"
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          />

          {wrong > 0 && (
            <div className="text-[11px]" style={{ color: 'var(--lum-danger)' }}>
              Wrong PIN — try again
            </div>
          )}
        </motion.div>

        <div className="flex items-center gap-2 mt-10" style={{ opacity: 0.55 }}>
          <BrandLogo size={16} decorative />
          <span className="text-[11px] tracking-widest uppercase" style={{ color: 'var(--lum-text-muted)' }}>Luminary OS</span>
        </div>
      </motion.div>
    </div>
  );
}
