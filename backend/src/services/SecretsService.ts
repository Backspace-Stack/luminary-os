// ============================================================
// SecretsService — One place to store and resolve API keys.
//
// Generic by design: an "integration" is just an id, a human label,
// what it unlocks, and an optional environment-variable fallback.
// Tavily is the first; a Discord key (or any other) is a one-line
// addition to INTEGRATIONS below and reuses the entire store, service,
// route, and UI unchanged.
//
// A saved key takes effect immediately in the same process — plugins
// call resolve() live per request, so there is nothing to restart.
//
// SECURITY: this service never logs a key value, and never returns one
// to the outside. status() reports only whether a key is configured,
// never the key itself. The value flows in one direction only: out to
// the third-party API that needs it.
// ============================================================

import type { SecretStore } from '../secrets/SqliteSecretStore';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('SecretsService');

interface IntegrationDef {
  /** Stable key used in the store, the route, and by plugins. */
  id: string;
  /** Human-facing name, e.g. "Tavily". */
  label: string;
  /** What providing this key enables, e.g. "Deep Research". */
  unlocks: string;
  /** Optional env-var fallback so an existing .env setup keeps working. */
  envVar?: string;
}

/** The known integrations. Add a line here to support a new one. */
const INTEGRATIONS: IntegrationDef[] = [
  { id: 'tavily', label: 'Tavily', unlocks: 'Deep Research', envVar: 'TAVILY_API_KEY' },
  { id: 'anthropic_api_key', label: 'Anthropic', unlocks: 'Claude cloud models', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai_api_key', label: 'OpenAI', unlocks: 'OpenAI cloud models', envVar: 'OPENAI_API_KEY' },
  { id: 'gemini_api_key', label: 'Google Gemini', unlocks: 'Gemini cloud models', envVar: 'GEMINI_API_KEY' },
  { id: 'deepseek_api_key', label: 'DeepSeek', unlocks: 'DeepSeek cloud models', envVar: 'DEEPSEEK_API_KEY' },
  { id: 'nvidia_api_key', label: 'NVIDIA NIM', unlocks: 'NVIDIA cloud models', envVar: 'NVIDIA_API_KEY' },
  { id: 'discord_bot_token', label: 'Discord Bot Token', unlocks: 'Discord bridge (remote chat)', envVar: 'DISCORD_BOT_TOKEN' },
  { id: 'discord_allowed_user_id', label: 'Discord Allowed User ID', unlocks: 'Discord bridge allowlist', envVar: 'DISCORD_ALLOWED_USER_ID' },
];

/** Safe-to-serialise status — NEVER contains the key value. */
export interface IntegrationStatus {
  id: string;
  label: string;
  unlocks: string;
  /** True when a usable key exists (saved OR from the env fallback). */
  configured: boolean;
  /** Where the active key comes from — or null when none is set. */
  source: 'saved' | 'env' | null;
}

export class SecretsError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'SecretsError';
  }
}

export class SecretsService {
  private store: SecretStore | null = null;

  /** Kernel installs the persistent store at boot. */
  setStore(store: SecretStore): void {
    this.store = store;
    logger.info('Secret store attached'); // no values, ever
  }

  private def(id: string): IntegrationDef | undefined {
    return INTEGRATIONS.find((i) => i.id === id);
  }

  private savedValue(id: string): string | null {
    const v = this.store?.get(id) ?? null;
    return v && v.trim() ? v : null;
  }

  private envValue(def: IntegrationDef): string | null {
    if (!def.envVar) return null;
    const v = process.env[def.envVar];
    return v && v.trim() ? v : null;
  }

  /**
   * The real key a plugin should use: the saved value first, then the
   * env fallback, else null. Read live, so a just-saved key is used
   * immediately. NEVER logged.
   */
  resolve(id: string): string | null {
    const def = this.def(id);
    if (!def) return null;
    return this.savedValue(id) ?? this.envValue(def);
  }

  private statusOf(def: IntegrationDef): IntegrationStatus {
    const saved = this.savedValue(def.id);
    const env = this.envValue(def);
    return {
      id: def.id,
      label: def.label,
      unlocks: def.unlocks,
      configured: Boolean(saved || env),
      source: saved ? 'saved' : env ? 'env' : null,
    };
  }

  /** Status of every known integration — booleans only, no values. */
  status(): IntegrationStatus[] {
    return INTEGRATIONS.map((def) => this.statusOf(def));
  }

  /** Save a key (empty/whitespace clears it). Returns the new status. */
  set(id: string, value: string): IntegrationStatus {
    const def = this.def(id);
    if (!def) throw new SecretsError(`Unknown integration "${id}".`, 404);
    if (!this.store) throw new SecretsError('Secret storage is not ready yet.', 503);

    const trimmed = value.trim();
    if (trimmed) {
      this.store.set(id, trimmed);
      logger.info(`Saved key for "${id}"`); // note: id only, never the value
    } else {
      this.store.delete(id);
      logger.info(`Cleared key for "${id}"`);
    }
    return this.statusOf(def);
  }

  /** Remove a saved key. Returns the new status. */
  remove(id: string): IntegrationStatus {
    const def = this.def(id);
    if (!def) throw new SecretsError(`Unknown integration "${id}".`, 404);
    if (!this.store) throw new SecretsError('Secret storage is not ready yet.', 503);
    this.store.delete(id);
    logger.info(`Removed key for "${id}"`);
    return this.statusOf(def);
  }
}

export const secretsService = new SecretsService();
