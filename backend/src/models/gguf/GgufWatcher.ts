// ============================================================
// GgufWatcher — Live filesystem watching for GGUF folders.
//
// Watches the models folder (and the optional extra folder from
// Settings) recursively. When a .gguf file is added, removed, or
// replaced while Luminary runs, a debounced MODELS_CHANGED event
// fires on the EventBus; the SSE route relays it to the UI so
// the Models page updates with no manual Refresh.
// ============================================================

import fs from 'fs';
import { eventBus, EVENTS } from '../../core/events/EventBus';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('GgufWatcher');

const DEBOUNCE_MS = 700;

export class GgufWatcher {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private watchedDirs: string[] = [];

  /** (Re)start watching the given directories. */
  start(dirs: string[]): void {
    this.stop();
    this.watchedDirs = dirs.filter((d) => {
      try { return fs.statSync(d).isDirectory(); } catch { return false; }
    });

    for (const dir of this.watchedDirs) {
      try {
        // recursive fs.watch is supported on Windows and macOS
        const watcher = fs.watch(dir, { recursive: true }, (_event, fileName) => {
          if (fileName && !fileName.toLowerCase().endsWith('.gguf')) return;
          this.scheduleNotify(fileName ?? '(unknown)');
        });
        watcher.on('error', (err) => {
          logger.warn(`Watcher error on ${dir}`, { error: String(err) });
        });
        this.watchers.push(watcher);
        logger.info(`Watching for GGUF changes: ${dir}`);
      } catch (err) {
        logger.warn(`Cannot watch ${dir}`, { error: String(err) });
      }
    }
  }

  /** Debounced change notification (drag-and-drop fires many events). */
  private scheduleNotify(fileName: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      logger.info(`GGUF folder change detected (${fileName})`);
      eventBus.emit(EVENTS.MODELS_CHANGED, { source: 'gguf-watcher', fileName }, 'GgufWatcher');
    }, DEBOUNCE_MS);
  }

  stop(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.watchers.forEach((w) => { try { w.close(); } catch { /* already closed */ } });
    this.watchers = [];
  }

  dirs(): string[] {
    return [...this.watchedDirs];
  }
}

export const ggufWatcher = new GgufWatcher();
