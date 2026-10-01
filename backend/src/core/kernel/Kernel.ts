// ============================================================
// Kernel — The Luminary OS bootstrap orchestrator.
//
// The Kernel is responsible for:
//   1. Instantiating all agents, plugins, and providers
//   2. Registering them in the appropriate registries
//   3. Emitting KERNEL_READY when the system is operational
//   4. Handling graceful shutdown
//
// Nothing else in the system creates concrete instances of
// agents/plugins/providers. That is exclusively the Kernel's job,
// which is the Composition Root of the application.
// ============================================================

import { agentRegistry } from '../registry/AgentRegistry';
import { pluginRegistry } from '../registry/PluginRegistry';
import { modelRegistry } from '../registry/ModelRegistry';
import { eventBus, EVENTS } from '../events/EventBus';
import { Logger } from '../logger/Logger';

// ── Agents ────────────────────────────────────────────────────
import { ConversationAgent } from '../../agents/ConversationAgent';
import { CodingAgent } from '../../agents/CodingAgent';
import { ResearchAgent } from '../../agents/ResearchAgent';
import { HomeAgent } from '../../agents/HomeAgent';

// ── Model Providers ───────────────────────────────────────────
import { OllamaProvider } from '../../models/providers/OllamaProvider';
import { LocalProvider, ggufFolders } from '../../models/providers/LocalProvider';
import { CloudProvider } from '../../models/providers/CloudProvider';
import { ensureModelsDir } from '../../models/gguf/ModelsFolder';
import { ggufRuntime } from '../../models/gguf/GgufRuntime';
import { ggufWatcher } from '../../models/gguf/GgufWatcher';

// ── Plugins ───────────────────────────────────────────────────
import { BrowserPlugin } from '../../plugins/browser/BrowserPlugin';
import { WindowsPlugin } from '../../plugins/windows/WindowsPlugin';
import { FilePlugin } from '../../plugins/file/FilePlugin';
import { TerminalPlugin } from '../../plugins/terminal/TerminalPlugin';
import { TavilyPlugin } from '../../plugins/tavily/TavilyPlugin';
import { MemoryPlugin } from '../../plugins/memory/MemoryPlugin';
import { NotesPlugin } from '../../plugins/notes/NotesPlugin';
import { SystemInfoPlugin } from '../../plugins/systeminfo/SystemInfoPlugin';

// ── Bridges ───────────────────────────────────────────────────
import { discordBridge } from '../../bridges/discord/DiscordBridge';

// ── Persistence (SQLite: memory + pending turns) ──────────────
import path from 'path';
import fs from 'fs';
import { openDatabase, SqliteMemoryProvider, SqlitePendingTurnStore, type Embedder, type SqliteDatabase } from '../../memory/providers/SqliteMemoryProvider';
import { SqliteSecretStore } from '../../secrets/SqliteSecretStore';
import { SqliteNotesStore } from '../../notes/SqliteNotesStore';
import { memoryService } from '../../services/MemoryService';
import { secretsService } from '../../services/SecretsService';
import { notesService } from '../../services/NotesService';
import { setPendingTurnStore, loadLumenIdentity, loadCuratedMemories } from '../../agents/BaseAgent';
import { ensureIdentityFile, ensureMemoriesFile } from '../identity/paths';

const logger = Logger.scope('Kernel');

export class Kernel {
  private static instance: Kernel;
  private booted = false;
  /** In-flight boot, so two concurrent boot() calls share one run. */
  private booting: Promise<void> | null = null;
  private startTime = 0;
  private db: SqliteDatabase | null = null;
  private evictionTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): Kernel {
    if (!Kernel.instance) Kernel.instance = new Kernel();
    return Kernel.instance;
  }

  async boot(): Promise<void> {
    if (this.booted) {
      logger.warn('Kernel.boot() called more than once — ignoring.');
      return;
    }
    // `booted` is only set at the END of the run, so a second concurrent
    // call used to sail past the guard and register every plugin twice.
    if (this.booting) return this.booting;
    this.booting = this.doBoot().finally(() => { this.booting = null; });
    return this.booting;
  }

  private async doBoot(): Promise<void> {
    this.startTime = Date.now();
    logger.info('──────────────────────────────────────');
    logger.info('  Luminary OS Kernel booting…');
    logger.info('──────────────────────────────────────');

    await this.registerModelProviders();
    this.initPersistence();
    await this.registerAgents();
    await this.registerPlugins();

    // Discord bridge (chat-only). start() is self-guarding: without a
    // configured bot token it does nothing, and a login failure logs
    // honestly — it can never take the backend down with it.
    try {
      await discordBridge.start();
    } catch (err) {
      logger.error('Discord bridge failed to start — continuing without it', { error: String(err) });
    }

    this.booted = true;
    const ms = Date.now() - this.startTime;
    logger.info(`Kernel ready in ${ms}ms`, {
      agents: agentRegistry.count(),
      plugins: pluginRegistry.count(),
      providers: modelRegistry.count(),
    });

    eventBus.emit(EVENTS.KERNEL_READY, { bootTimeMs: ms }, 'Kernel');
  }

  /**
   * Bring up persistent storage: open the SQLite DB, swap the in-memory
   * memory provider for the SQLite one (with a real Ollama embedder),
   * move the tool loop's pending-turn store onto the same DB so paused
   * confirmations survive restarts, and load Lumen's identity once.
   */
  private initPersistence(): void {
    logger.info('Initialising persistence…');
    const dbPath = process.env.DB_PATH
      ? path.resolve(process.env.DB_PATH)
      : path.resolve(__dirname, '../../../data/luminary.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = openDatabase(dbPath);
    this.db = db;

    // Embed via the registered Ollama provider. Returns null (never a
    // fake vector) when embeddings are unavailable, so memory degrades
    // honestly rather than fabricating similarity.
    const embedModel = process.env.EMBED_MODEL ?? 'nomic-embed-text';
    const embedder: Embedder = async (text: string) => {
      const provider = modelRegistry.findById('ollama');
      if (!provider?.embed) return null;
      try {
        const res = await provider.embed({ model: embedModel, input: text });
        const vec = res.embeddings?.[0];
        return Array.isArray(vec) && vec.length > 0 ? vec : null;
      } catch (err) {
        logger.warn(`Embedding failed (model "${embedModel}") — memory stores/searches without vectors`, { error: String(err) });
        return null;
      }
    };

    const memoryProvider = new SqliteMemoryProvider(db, embedder);
    const pendingStore = new SqlitePendingTurnStore(db);
    memoryService.setProvider(memoryProvider);
    setPendingTurnStore(pendingStore);
    secretsService.setStore(new SqliteSecretStore(db)); // API keys share the same DB
    notesService.setStore(new SqliteNotesStore(db));    // …and so do the user's notes
    this.startEvictionSweep(memoryProvider, pendingStore);

    // Identity + curated memories live in backend/data/identity (durable —
    // survives rebuilds, unlike the old dist/ location). Seed-or-migrate
    // runs first so the log reports what actually happened to each file,
    // rather than a silent create that could mask a lost migration.
    for (const report of [ensureIdentityFile(), ensureMemoriesFile()]) {
      const name = path.basename(report.file);
      if (report.action === 'migrated') {
        logger.info(`Migrated ${name} to durable storage from [${report.sources.join(', ')}] (${report.bytes} bytes) → ${report.file}`);
        for (const bak of report.backups) logger.info(`  kept unmerged pre-migration copy: ${bak}`);
      } else if (report.action === 'created-fresh') {
        logger.info(`Created ${name} at ${report.file} (${report.bytes} bytes, nothing to migrate)`);
      }
    }
    const identity = loadLumenIdentity();
    const curated = loadCuratedMemories(); // curated memories load once at boot, like identity
    logger.info(`Persistence ready — memory + pending turns on SQLite; identity loaded (${identity.length} chars); curated memories loaded (${curated.length} chars); embed model "${embedModel}"`);
  }

  /**
   * Periodically sweep expired memory rows and expired pending-turn rows
   * from SQLite. Both evictExpired() methods previously existed but were
   * never called — nothing swept them, so expired rows accumulated
   * forever. Started once at boot; cleared on shutdown.
   */
  private startEvictionSweep(memoryProvider: SqliteMemoryProvider, pendingStore: SqlitePendingTurnStore): void {
    const intervalMs = Math.max(10_000, Number(process.env.EVICTION_INTERVAL_MS) || 5 * 60_000);
    this.evictionTimer = setInterval(() => {
      // try/catch is REQUIRED: a throw out of a setInterval callback is an
      // uncaught exception, so one bad sweep would kill a running server.
      try {
        const memoriesSwept = memoryProvider.evictExpired();
        const turnsSwept = pendingStore.evictExpired();
        logger.debug(`Eviction sweep: ${memoriesSwept} expired memor${memoriesSwept === 1 ? 'y' : 'ies'}, ${turnsSwept} expired pending turn(s) removed`);
      } catch (err) {
        logger.warn('Eviction sweep failed — will retry next interval', { error: String(err) });
      }
    }, intervalMs);
    // Never hold the event loop open just for the sweep.
    this.evictionTimer.unref?.();
    logger.info(`Eviction sweep scheduled every ${intervalMs}ms`);
  }

  private async registerModelProviders(): Promise<void> {
    logger.info('Registering model providers…');
    // OllamaProvider is the default (local inference)
    modelRegistry.register(new OllamaProvider(), true);
    modelRegistry.register(new LocalProvider());
    // One adapter class, configured once for each supported cloud API.
    // Credentials are resolved live from SecretsService, so saving a key
    // takes effect immediately without a restart.
    for (const provider of CloudProvider.createAll()) modelRegistry.register(provider);

    // First-class GGUF setup: auto-create the models/ folder beside
    // run.bat, probe the real runtime, and watch folders for live
    // add/remove of .gguf files (no manual refresh needed).
    ensureModelsDir();
    // Probe in the background so boot stays fast (~10s init on some
    // GPUs); the UI learns the outcome via the SSE models stream.
    // .catch is REQUIRED: a rejected probe with only a .then attached is an
    // unhandled rejection, which takes the whole backend down at boot.
    void ggufRuntime
      .probe()
      .then(() => {
        eventBus.emit(EVENTS.MODELS_CHANGED, { source: 'runtime-probe' }, 'Kernel');
      })
      .catch((err) => {
        logger.warn('GGUF runtime probe failed — local GGUF inference stays unavailable', { error: String(err) });
      });
    ggufWatcher.start(ggufFolders());
  }

  private async registerAgents(): Promise<void> {
    logger.info('Registering agents…');
    // Agents receive the modelRegistry so they can resolve providers at runtime
    agentRegistry.register(new ConversationAgent(modelRegistry));
    agentRegistry.register(new CodingAgent(modelRegistry));
    agentRegistry.register(new ResearchAgent(modelRegistry));
    agentRegistry.register(new HomeAgent(modelRegistry));
  }

  private async registerPlugins(): Promise<void> {
    logger.info('Registering plugins…');
    // register() calls plugin.initialize() internally
    await pluginRegistry.register(new BrowserPlugin());
    await pluginRegistry.register(new WindowsPlugin());
    await pluginRegistry.register(new FilePlugin());
    await pluginRegistry.register(new TerminalPlugin());
    await pluginRegistry.register(new TavilyPlugin());
    await pluginRegistry.register(new MemoryPlugin());
    await pluginRegistry.register(new NotesPlugin());
    await pluginRegistry.register(new SystemInfoPlugin());
  }

  async shutdown(): Promise<void> {
    logger.info('Kernel shutting down…');
    if (this.evictionTimer) { clearInterval(this.evictionTimer); this.evictionTimer = null; }
    await discordBridge.stop().catch(() => { /* best-effort at exit */ });
    ggufWatcher.stop();
    await ggufRuntime.unloadAll().catch(() => { /* dispose is best-effort at exit */ });
    await pluginRegistry.shutdownAll();
    // Close the SQLite handle so WAL is checkpointed and no native handle
    // is left open at process exit.
    try { this.db?.close(); } catch { /* already closed / best-effort */ }
    this.db = null;
    eventBus.emit(EVENTS.KERNEL_SHUTDOWN, {}, 'Kernel');
    eventBus.clear();
    logger.info('Kernel shutdown complete.');
  }

  isBooted(): boolean {
    return this.booted;
  }

  getUptimeMs(): number {
    return this.booted ? Date.now() - this.startTime : 0;
  }
}

export const kernel = Kernel.getInstance();
