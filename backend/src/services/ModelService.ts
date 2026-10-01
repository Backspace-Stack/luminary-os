// ============================================================
// ModelService — Manages models through registered IModelProviders.
//
// Routes and the frontend never call providers directly.
// All model operations go through this service.
// ============================================================

import { modelRegistry } from '../core/registry/ModelRegistry';
import type { ModelInfo, ProviderHealth, PullProgress } from '../core/types/IModelProvider';
import { OllamaProvider, type RunningModel } from '../models/providers/OllamaProvider';
import { ggufRuntime } from '../models/gguf/GgufRuntime';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('ModelService');

export interface ModelSummary extends ModelInfo {
  providerName: string;
}

export class ModelService {

  /** List all models across all registered providers. */
  async listAllModels(): Promise<ModelSummary[]> {
    const providers = modelRegistry.getAll();
    const results: ModelSummary[] = [];

    for (const provider of providers) {
      try {
        const models = await provider.listModels();
        models.forEach((m) => results.push({ ...m, providerName: provider.name }));
      } catch (err) {
        logger.warn(`Failed to list models from provider "${provider.id}"`, { error: String(err) });
      }
    }

    return results;
  }

  /** List models from a specific provider. */
  async listModels(providerId?: string): Promise<ModelSummary[]> {
    const provider = providerId
      ? modelRegistry.findById(providerId)
      : modelRegistry.getDefault();

    if (!provider) throw new Error(`Provider "${providerId}" not found`);

    const models = await provider.listModels();
    return models.map((m) => ({ ...m, providerName: provider.name }));
  }

  /**
   * Resolve which provider owns a model (matched by id, then name).
   * Lets routes operate on any model without the caller knowing the
   * provider — GGUF paths and Ollama tags both work.
   */
  async findOwner(modelId: string): Promise<{ provider: ReturnType<typeof modelRegistry.getDefault>; model: ModelSummary } | null> {
    const all = await this.listAllModels();
    const model = all.find((m) => m.id === modelId) ?? all.find((m) => m.name === modelId);
    if (!model) return null;
    const provider = modelRegistry.findById(model.providerId);
    return provider ? { provider, model } : null;
  }

  private async resolveProvider(modelId: string, providerId?: string) {
    if (providerId) {
      const provider = modelRegistry.findById(providerId);
      if (!provider) throw new Error(`Provider "${providerId}" not found`);
      return provider;
    }
    const owner = await this.findOwner(modelId);
    if (owner) return owner.provider;
    return modelRegistry.getDefault();
  }

  /** Load a model into memory via its owning provider. */
  async loadModel(modelId: string, providerId?: string): Promise<void> {
    const provider = await this.resolveProvider(modelId, providerId);
    logger.info(`Loading model: ${modelId} via ${provider.id}`);
    await provider.loadModel(modelId);
    eventBus.emit(EVENTS.MODEL_LOADED, { modelId, providerId: provider.id }, 'ModelService');
  }

  /** Unload a model from memory via its owning provider. */
  async unloadModel(modelId: string, providerId?: string): Promise<void> {
    const provider = await this.resolveProvider(modelId, providerId);
    logger.info(`Unloading model: ${modelId} via ${provider.id}`);
    await provider.unloadModel(modelId);
    eventBus.emit(EVENTS.MODEL_UNLOADED, { modelId, providerId: provider.id }, 'ModelService');
  }

  /** Health check across all providers. */
  async healthCheckAll(): Promise<Record<string, ProviderHealth>> {
    const providers = modelRegistry.getAll();
    const results: Record<string, ProviderHealth> = {};

    await Promise.all(
      providers.map(async (p) => {
        try {
          results[p.id] = await p.healthCheck();
        } catch (err) {
          results[p.id] = {
            status: 'error',
            message: String(err),
            checkedAt: new Date().toISOString(),
          };
        }
      })
    );

    return results;
  }

  /** Return list of registered provider IDs and names. */
  listProviders(): Array<{ id: string; name: string }> {
    return modelRegistry.getAll().map((p) => ({ id: p.id, name: p.name }));
  }

  /** Resolve a provider that supports pull/delete (Ollama). */
  private requireManagedProvider(providerId?: string) {
    const provider = providerId
      ? modelRegistry.findById(providerId)
      : modelRegistry.getDefault();
    if (!provider) throw new Error(`Provider "${providerId}" not found`);
    return provider;
  }

  /** Download a model, streaming progress callbacks from the provider. */
  async pullModel(
    name: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal,
    providerId?: string,
  ): Promise<void> {
    const provider = this.requireManagedProvider(providerId);
    if (!provider.pullModel) {
      throw new Error(`Provider "${provider.id}" does not support pulling models`);
    }
    await provider.pullModel(name, onProgress, signal);
    eventBus.emit(EVENTS.MODEL_LOADED, { modelId: name, providerId: provider.id, action: 'pulled' }, 'ModelService');
  }

  /** Permanently delete a model from the provider. */
  async deleteModel(name: string, providerId?: string): Promise<void> {
    const provider = this.requireManagedProvider(providerId);
    if (!provider.deleteModel) {
      throw new Error(`Provider "${provider.id}" does not support deleting models`);
    }
    await provider.deleteModel(name);
    eventBus.emit(EVENTS.MODEL_UNLOADED, { modelId: name, providerId: provider.id, action: 'deleted' }, 'ModelService');
  }

  /** Models currently loaded in memory (Ollama /api/ps + GGUF runtime). */
  async listRunning(): Promise<RunningModel[]> {
    const results: RunningModel[] = [];
    const provider = modelRegistry.getDefault();
    if (provider instanceof OllamaProvider) {
      try {
        results.push(...await provider.listRunning());
      } catch { /* Ollama down — GGUF runtime list below is still real */ }
    }
    for (const m of ggufRuntime.listLoaded()) {
      results.push({
        name: m.name,
        sizeBytes: m.sizeBytes,
        sizeVramBytes: 0, // llama.cpp splits RAM/VRAM internally; weights size is what we know for real
      });
    }
    return results;
  }
}

export const modelService = new ModelService();
