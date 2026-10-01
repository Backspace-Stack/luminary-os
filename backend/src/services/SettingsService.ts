// ============================================================
// SettingsService — Persisted application settings.
//
// Currently holds the local GGUF models folder. Stored in
// backend/data/settings.json so choices survive restarts.
// ============================================================

import fs from 'fs';
import { resolve } from 'path';
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
    const trimmed = rawPath?.trim();
    const path = trimmed ? resolve(trimmed) : null;

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

    const next = { ...this.settings, ggufFolder: path };
    if (!this.store.save(next)) {
      throw new SettingsError('Settings could not be saved. Check the data folder and try again.', 503);
    }
    this.settings = next;
    logger.info(`GGUF models folder ${path ? `set to: ${path}` : 'cleared'}`);
    return this.get();
  }
}

export const settingsService = new SettingsService();
