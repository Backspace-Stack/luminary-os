import { useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import Layout from '@/components/layout/Layout';
import Dashboard from '@/pages/Dashboard';
import { lazyPage } from '@/components/system/LazyPage';
import BootVeil from '@/components/system/BootVeil';
import LockScreen from '@/components/system/LockScreen';
import PrivacyBlur from '@/components/system/PrivacyBlur';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useAgents } from '@/hooks/useAgents';
import { useTheme } from '@/theme/useTheme';
import { getPrefs } from '@/lib/prefs';
import { pageVariants } from '@/lib/motion';
import { ChatProvider } from '@/store/ChatContext';
import type { NavPage } from '@/types';

// Keep the first Dashboard render independent of the other page bundles.
const Chat = lazyPage(() => import('@/pages/Chat'));
const Models = lazyPage(() => import('@/pages/Models'));
const Agents = lazyPage(() => import('@/pages/Agents'));
const Memory = lazyPage(() => import('@/pages/Memory'));
const Devices = lazyPage(() => import('@/pages/Devices'));
const ThemeCenter = lazyPage(() => import('@/pages/ThemeCenter'));
const Settings = lazyPage(() => import('@/pages/Settings'));

export default function App() {
  const [page, setPage]         = useState<NavPage>('dashboard');
  const [locked, setLocked]     = useState(() => getPrefs().lockPin != null);
  const [theme]                 = useTheme();
  const { status: system }      = useSystemStatus();
  const { agents }              = useAgents();   // drives Dashboard agent panel + active model

  const pages: Record<NavPage, React.ReactNode> = {
    // Model name comes from live agent data — never hardcoded.
    // Task tracking has no real backend yet — honest empty list.
    dashboard: <Dashboard system={system} tasks={[]} agents={agents} setPage={setPage} />,
    chat:      <Chat />,
    models:    <Models />,
    agents:    <Agents />,
    memory:    <Memory />,
    devices:   <Devices />,
    theme:     <ThemeCenter />,
    settings:  <Settings onLock={() => setLocked(true)} setPage={setPage} />,
  };

  // Theme Center motion levels map onto framer-motion globally:
  //   fluid → respect the OS setting, calm/static → minimal motion
  const reducedMotion = theme.motion === 'full' ? 'user' : 'always';
  const instant = theme.motion === 'off';

  // Structural interface mode (Theme Center → Interface). Professional
  // drops ALL dashboard chrome — nav sidebar, top bar, wallpaper, weather,
  // film grain — leaving a plain, Claude-like chat workspace. The swap is
  // a cross-fade, and because ChatProvider sits above it, a generation in
  // flight (and the composer draft) survives switching either way. `page`
  // state also survives: returning lands exactly where you left off.
  const pro = theme.ui === 'professional';
  const shellTransition = instant
    ? { duration: 0 }
    : { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const };

  return (
    // ChatProvider lives above the page switcher so a generation
    // in flight survives navigating away from and back to Chat —
    // see store/ChatContext.tsx.
    <ChatProvider>
      <MotionConfig reducedMotion={reducedMotion}>
        <AnimatePresence mode="wait" initial={false}>
          {pro ? (
            <motion.div
              key="shell-professional"
              initial={{ opacity: 0, scale: 0.988 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.992 }}
              transition={shellTransition}
              className="flex h-screen overflow-hidden"
              style={{ background: '#232428' }}
            >
              <Chat />
            </motion.div>
          ) : (
            <motion.div
              key="shell-dashboard"
              initial={{ opacity: 0, scale: 0.988 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.992 }}
              transition={shellTransition}
              className="h-screen overflow-hidden"
            >
              <Layout page={page} setPage={setPage} system={system}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={page}
                    variants={pageVariants}
                    initial="initial"
                    animate="enter"
                    exit="exit"
                    transition={instant ? { duration: 0 } : undefined}
                    className="flex flex-1 overflow-hidden"
                    style={{ willChange: 'transform, opacity' }}
                  >
                    {pages[page]}
                  </motion.div>
                </AnimatePresence>
              </Layout>
            </motion.div>
          )}
        </AnimatePresence>

        <PrivacyBlur />
        {locked && <LockScreen onUnlock={() => setLocked(false)} />}
        <BootVeil />
      </MotionConfig>
    </ChatProvider>
  );
}
