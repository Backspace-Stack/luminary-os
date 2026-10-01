// ============================================================
// BasePlugin — Abstract base for all Luminary OS plugins.
//
// Provides default implementations of lifecycle methods and
// status tracking so concrete plugins only implement execute().
// ============================================================

import type { IPlugin, PluginAction, PluginResult, PluginManifest, PluginStatus } from '../core/types/IPlugin';
import { Logger } from '../core/logger/Logger';

export abstract class BasePlugin implements IPlugin {
  abstract readonly manifest: PluginManifest;

  private _status: PluginStatus = 'inactive';
  protected logger!: Logger; // assigned in initialize()

  async initialize(): Promise<void> {
    this.logger = Logger.scope(this.manifest.id);
    this._status = 'initialising';
    try {
      await this.onInitialize();
      this._status = 'active';
      this.logger.info(`Initialized — capabilities: [${this.manifest.capabilities.map((c) => c.action).join(', ')}]`);
    } catch (err) {
      this._status = 'error';
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
    this._status = 'inactive';
    this.logger?.info('Shutdown complete');
  }

  isAvailable(): boolean {
    return this._status === 'active';
  }

  getStatus(): PluginStatus {
    return this._status;
  }

  abstract execute(action: PluginAction): Promise<PluginResult>;

  /** Override in subclasses to set up connections, verify deps, etc. */
  protected async onInitialize(): Promise<void> {}

  /** Override to clean up resources on shutdown. */
  protected async onShutdown(): Promise<void> {}

  protected notImplemented(action: string): PluginResult {
    return {
      success: false,
      error: `Action "${action}" is not yet implemented in ${this.manifest.id}.`,
    };
  }
}
