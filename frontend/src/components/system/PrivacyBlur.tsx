// Privacy frost — when enabled in Settings, the interface blurs
// the moment the window loses focus and clears on return. Real
// behavior, not a placebo: driven by window blur/focus events.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import BrandLogo from '@/components/ui/BrandLogo';
import { usePrefs } from '@/lib/prefs';

export default function PrivacyBlur() {
  const [prefs] = usePrefs();
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    if (!prefs.privacyBlur) { setBlurred(false); return; }
    const onBlur = () => setBlurred(true);
    const onFocus = () => setBlurred(false);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    if (!document.hasFocus()) setBlurred(true);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [prefs.privacyBlur]);

  return (
    <AnimatePresence>
      {blurred && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 flex items-center justify-center"
          style={{
            zIndex: 90,
            background: 'rgb(8 10 17 / 0.35)',
            backdropFilter: 'blur(26px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(26px) saturate(1.2)',
          }}
        >
          <div className="flex items-center gap-2.5" style={{ opacity: 0.75 }}>
            <div className="flex items-center justify-center rounded-[10px]"
                 style={{ width: 30, height: 30, background: 'var(--lum-glass-strong)', boxShadow: '0 0 20px rgb(var(--lum-accent-rgb) / 0.4)' }}>
              <BrandLogo size={26} decorative />
            </div>
            <span className="text-[13px] font-medium" style={{ color: 'var(--lum-text-secondary)' }}>
              Luminary is frosted — click to return
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
