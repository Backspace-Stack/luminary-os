// ============================================================
// MemoryService — Manages long-term agent memory.
//
// Wraps IMemoryProvider with business rules: importance
// defaults, tag normalisation, and expiry enforcement.
// ============================================================

import type { MemoryEntry, MemoryQuery } from '../core/types/IMemoryProvider';
import type { IMemoryProvider } from '../core/types/IMemoryProvider';
import { InMemoryProvider } from '../memory/providers/InMemoryProvider';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('MemoryService');

export class MemoryService {
  private provider: IMemoryProvider;

  constructor(provider: IMemoryProvider = new InMemoryProvider()) {
    this.provider = provider;
  }

  /** Swap the memory provider at runtime (e.g. switch to VectorDB). */
  setProvider(provider: IMemoryProvider): void {
    logger.info(`Memory provider switched to: ${provider.name}`);
    this.provider = provider;
  }

  async list(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
    return this.provider.query(query);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.provider.read(id);
  }

  async create(entry: Omit<MemoryEntry, 'id'>): Promise<MemoryEntry> {
    const normalised: Omit<MemoryEntry, 'id'> = {
      ...entry,
      importance: entry.importance ?? 'medium',
      tags: entry.tags?.map((t) => t.toLowerCase().trim()) ?? [],
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };

    const { id } = await this.provider.write(normalised);
    logger.debug('Memory entry created', { id, type: entry.type });
    eventBus.emit(EVENTS.MEMORY_WRITTEN, { id, type: entry.type, agentId: entry.agentId }, 'MemoryService');
    return (await this.provider.read(id))!;
  }

  async update(id: string, patch: Partial<Omit<MemoryEntry, 'id'>>): Promise<MemoryEntry | null> {
    const ok = await this.provider.update(id, patch);
    if (!ok) return null;
    return this.provider.read(id);
  }

  async remove(id: string): Promise<boolean> {
    const ok = await this.provider.delete(id);
    if (ok) eventBus.emit(EVENTS.MEMORY_DELETED, { id }, 'MemoryService');
    return ok;
  }

  async stats(): Promise<{ total: number; providerHealth: { status: string; message?: string } }> {
    const [total, health] = await Promise.all([
      this.provider.count(),
      this.provider.healthCheck(),
    ]);
    return { total, providerHealth: health };
  }
}

export const memoryService = new MemoryService();
