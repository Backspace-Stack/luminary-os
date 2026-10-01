// ============================================================
// SettingsService — Persisted application settings.
//
// Currently holds the local GGUF models folder. Stored in
// backend/data/settings.json so choices survive restarts.
// ============================================================

import fs from 'fs';
import { JsonStore } from '../core/persistence/JsonStore';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('SettingsService');

export interface AppSettings {
  /** Absolute path to the user's local GGUF models folder, or null. */
  ggufFolder: string | null;
}

export class SettingsError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'SettingsError';
  }
}

const DEFAULTS: AppSettings = { ggufFolder: null };

export class SettingsService {
  private store = new JsonStore<AppSettings>('settings.json', DEFAULTS);
  private settings: AppSettings;

  constructor() {
    this.settings = { ...DEFAULTS, ...this.store.load() };
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  getGgufFolder(): string | null {
    return this.settings.ggufFolder;
  }

  /**
   * Set (or clear, with null/empty) the GGUF models folder.
   * The path must exist and be a directory — we only ever read
   * from it; model files are never copied or moved.
   */
  setGgufFolder(rawPath: string | null): AppSettings {
    const path = rawPath?.trim() || null;

    if (path !== null) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(path);
      } catch {
        throw new SettingsError(`Folder does not exist: ${path}`);
      }
      if (!stat.isDirectory()) {
        throw new SettingsError(`Not a folder: ${path}`);
      }
    }

    this.settings.ggufFolder = path;
    this.store.save(this.settings);
    logger.info(`GGUF models folder ${path ? `set to: ${path}` : 'cleared'}`);
    return this.get();
  }
}

export const settingsService = new SettingsService();
