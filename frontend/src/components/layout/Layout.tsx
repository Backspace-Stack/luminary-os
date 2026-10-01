import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Upload } from 'lucide-react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Wallpaper from './Wallpaper';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { setCustomWallpaperFromDataUrl } from '@/theme/engine';
import type { NavPage, SystemStatus } from '@/types';

interface LayoutProps {
  page: NavPage;
  setPage: (p: NavPage) => void;
  system: SystemStatus;
  children: React.ReactNode;
}

export default function Layout({ page, setPage, system, children }: LayoutProps) {
  // Auto-collapse on narrow viewports; a manual toggle overrides
  // until the breakpoint changes again.
  const narrow = useMediaQuery('(max-width: 1080px)');
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const collapsed = userCollapsed ?? narrow;

  // Drop an image anywhere in the app to set it as the wallpaper.
  // Depth-counted so dragging over child elements (which fire their
  // own enter/leave pairs) doesn't flicker the veil off early. A
  // .gguf dropped on the Models page is its own dropzone that calls
  // preventDefault() first — since this listener is on document and
  // fires during the bubble phase, it runs after that handler, so
  // checking defaultPrevented here means the two never collide.
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onDragLeave = () => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragOver(false); } };
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragOver(false);
      if (e.defaultPrevented || !e.dataTransfer) return;
      // Always swallow the drop once we know it's a file drag — the
      // browser's default action for an unhandled file drop is to
      // navigate the tab to that file, which would kill the whole
      // running app. This must fire for every file, not just images.
      if (!hasFiles(e)) return;
      e.preventDefault();
      const image = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
      if (!image) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') setCustomWallpaperFromDataUrl(reader.result).catch(() => {});
      };
      reader.readAsDataURL(image);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--lum-bg)' }}>
      {/* The living environment sits behind everything */}
      <Wallpaper />

      <div className="relative flex flex-1 overflow-hidden" style={{ zIndex: 1 }}>
        <Sidebar
          page={page}
          setPage={setPage}
          collapsed={collapsed}
          setCollapsed={(v) => setUserCollapsed(v)}
        />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <TopBar page={page} system={system} />
          {/* The content plane floats at its own depth: wallpaper
              drifts −14px against the pointer, this leans +5px with
              it (vars fed by the Wallpaper rAF loop) — three layers,
              three speeds. */}
          <main
            className="flex flex-1 overflow-hidden"
            style={{
              transform: 'translate3d(calc(var(--lum-px, 0) * 5px), calc(var(--lum-py, 0) * 4px), 0)',
              willChange: 'transform',
            }}
          >
            {children}
          </main>
        </div>
      </div>

      {/* Film grain — keeps large glass surfaces organic */}
      <div className="lum-noise" style={{ zIndex: 40 }} />

      {/* Drop-to-set-wallpaper veil */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 50, pointerEvents: 'none', background: 'rgb(6 8 15 / 0.55)', backdropFilter: 'blur(6px)' }}
          >
            <div
              className="flex flex-col items-center gap-3 lum-glass"
              style={{ padding: '36px 48px', border: '1.5px dashed rgb(var(--lum-accent-rgb) / 0.5)' }}
            >
              <Upload size={26} style={{ color: 'var(--lum-accent)' }} />
              <div className="text-[14px] font-semibold" style={{ color: 'var(--lum-aurora)' }}>
                Drop to set your wallpaper
              </div>
              <div className="text-[11.5px] text-center" style={{ color: 'var(--lum-text-muted)' }}>
                Images become the environment behind the glass<br />.gguf files install as local models
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
