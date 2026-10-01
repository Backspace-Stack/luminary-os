// ============================================================
// motion.ts — Shared animation vocabulary.
//
// One place for spring curves and entrance variants so every
// page moves with the same voice: quick, soft, never bouncy
// enough to feel playful — Luminary is calm software.
// All animations are transform/opacity only (GPU-composited).
// ============================================================

import type { Transition, Variants } from 'framer-motion';

/** Primary spring — snappy but settled, for hovers and presses. */
export const springSnappy: Transition = {
  type: 'spring', stiffness: 480, damping: 34, mass: 0.7,
};

/** Gentle spring — for panels and layout-level movement. */
export const springGentle: Transition = {
  type: 'spring', stiffness: 260, damping: 30, mass: 0.9,
};

/** Page-level transition: quiet fade + drift, no layout shift. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.995 },
  enter:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -6, scale: 0.998, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } },
};

/** Card / list-item entrance (use with staggerChildren on parent). */
export const riseIn: Variants = {
  initial: { opacity: 0, y: 14 },
  enter:   { opacity: 1, y: 0, transition: springGentle },
};

/** Parent container that staggers its children in. */
export const staggerParent: Variants = {
  initial: {},
  enter:   { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

/** Chat message entrance — subtle slide from the sender's side. */
export const messageIn = (fromRight: boolean): Variants => ({
  initial: { opacity: 0, y: 10, x: fromRight ? 8 : -8 },
  enter:   { opacity: 1, y: 0, x: 0, transition: springGentle },
});
