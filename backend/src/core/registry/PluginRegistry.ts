// ============================================================
// PluginRegistry — Discovery and management of IPlugin instances.
//
// During Kernel boot, all plugins are registered here.
// Agents query getByCapability() to find the right plugin
// for a given action without knowing which class it is.
// ============================================================

import type { IPlugin } from '../types/IPlugin';
import type { ToolDefinition } from '../types/IModelProvider';
import { eventBus, EVENTS } from '../events/EventBus';
import { Logger } from '../logger/Logger';

const logger = Logger.scope('PluginRegistry');

export class PluginRegistry {
  private static instance: PluginRegistry;
  private plugins = new Map<string, IPlugin>();

  private constructor() {}

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) PluginRegistry.instance = new PluginRegistry();
    return PluginRegistry.instance;
  }

  /** Register a plugin and immediately call initialize(). */
  async register(plugin: IPlugin): Promise<void> {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin "${plugin.manifest.id}" is already registered.`);
    }

    try {
      await plugin.initialize();
      this.plugins.set(plugin.manifest.id, plugin);
      logger.info(`Plugin registered: ${plugin.manifest.name} v${plugin.manifest.version}`, {
        id: plugin.manifest.id,
        capabilities: plugin.manifest.capabilities.map((c) => c.action),
      });
      eventBus.emit(
        EVENTS.PLUGIN_REGISTERED,
        { pluginId: plugin.manifest.id, pluginName: plugin.manifest.name },
        'PluginRegistry'
      );
    } catch (err) {
      logger.error(`Failed to initialize plugin "${plugin.manifest.id}"`, { error: String(err) });
      eventBus.emit(
        EVENTS.PLUGIN_ERROR,
        { pluginId: plugin.manifest.id, error: String(err) },
        'PluginRegistry'
      );
    }
  }

  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  findById(id: string): IPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Find all plugins that expose a given capability action.
   * e.g. getByCapability('screenshot') → [BrowserPlugin]
   */
  findByCapability(action: string): IPlugin[] {
    return this.getAll().filter((p) =>
      p.isAvailable() &&
      p.manifest.capabilities.some((c) => c.action === action)
    );
  }

  count(): number {
    return this.plugins.size;
  }

  /**
   * Emit provider-format tool definitions for the given plugin IDs.
   * Each available capability becomes one ToolDefinition — its action
   * is the tool name and its declared inputSchema (if any) the argument
   * schema. Agents pass these straight to a tool-capable provider so
   * they never hand-assemble tool JSON. Unknown or unavailable plugins
   * are skipped silently (an unavailable tool simply isn't offered).
   */
  toolDefinitions(pluginIds: string[]): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const id of pluginIds) {
      const plugin = this.plugins.get(id);
      if (!plugin || !plugin.isAvailable()) continue;
      for (const cap of plugin.manifest.capabilities) {
        defs.push({
          type: 'function',
          function: {
            name: cap.action,
            description: cap.description,
            parameters: cap.inputSchema ?? { type: 'object', properties: {} },
          },
        });
      }
    }
    return defs;
  }

  /** Graceful shutdown of all plugins. */
  async shutdownAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.shutdown();
        logger.info(`Plugin shutdown: ${plugin.manifest.id}`);
      } catch (err) {
        logger.warn(`Error shutting down plugin "${plugin.manifest.id}"`, { error: String(err) });
      }
    }
  }
}

export const pluginRegistry = PluginRegistry.getInstance();
