// ============================================================
// ModelRegistry — Registry for all IModelProvider instances.
//
// Agents request a provider by ID (or use the default).
// This allows seamless swapping of backends (Ollama → cloud)
// without changing any agent code.
// ============================================================

import type { IModelProvider } from '../types/IModelProvider';
import { Logger } from '../logger/Logger';

const logger = Logger.scope('ModelRegistry');

export class ModelRegistry {
  private static instance: ModelRegistry;
  private providers = new Map<string, IModelProvider>();
  private defaultProviderId: string | null = null;

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) ModelRegistry.instance = new ModelRegistry();
    return ModelRegistry.instance;
  }

  register(provider: IModelProvider, isDefault = false): void {
    this.providers.set(provider.id, provider);
    if (isDefault || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
    logger.info(`Model provider registered: ${provider.name}`, {
      id: provider.id,
      isDefault: isDefault || this.providers.size === 1,
    });
  }

  getDefault(): IModelProvider {
    if (!this.defaultProviderId) {
      throw new Error('No model provider registered.');
    }
    return this.providers.get(this.defaultProviderId)!;
  }

  findById(id: string): IModelProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): IModelProvider[] {
    return Array.from(this.providers.values());
  }

  setDefault(id: string): void {
    if (!this.providers.has(id)) throw new Error(`Provider "${id}" not registered.`);
    this.defaultProviderId = id;
    logger.info(`Default model provider set to: ${id}`);
  }

  count(): number {
    return this.providers.size;
  }
}

export const modelRegistry = ModelRegistry.getInstance();
