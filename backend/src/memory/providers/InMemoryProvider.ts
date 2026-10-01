// ============================================================
// InMemoryProvider — Development IMemoryProvider backed by a Map.
//
// Data is lost on process restart. Swap with a VectorDBProvider
// (ChromaDB, Qdrant) for production without changing any
// agent or service code — they only depend on IMemoryProvider.
// ============================================================

import type {
  IMemoryProvider,
  MemoryEntry,
  MemoryQuery,
  MemoryWriteResult,
} from '../../core/types/IMemoryProvider';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('InMemoryProvider');

export class InMemoryProvider implements IMemoryProvider {
  readonly id = 'in-memory';
  readonly name = 'In-Memory Provider';

  private store = new Map<string, MemoryEntry>();
  private counter = 0;

  constructor() {
    // Starts empty — entries are created at runtime, never seeded
    logger.info('Initialized (empty store)');
  }

  async write(entry: Omit<MemoryEntry, 'id'>): Promise<MemoryWriteResult> {
    const id = `mem-${++this.counter}-${Date.now()}`;
    const full: MemoryEntry = { ...entry, id };
    this.store.set(id, full);
    logger.debug('Memory written', { id, type: entry.type });
    return { id, success: true };
  }

  async read(id: string): Promise<MemoryEntry | null> {
    return this.store.get(id) ?? null;
  }

  async query(params: MemoryQuery): Promise<MemoryEntry[]> {
    let results = Array.from(this.store.values());

    if (params.type)       results = results.filter((e) => e.type === params.type);
    if (params.agentId)    results = results.filter((e) => e.agentId === params.agentId);
    if (params.importance) results = results.filter((e) => e.importance === params.importance);
    if (params.tags?.length) {
      results = results.filter((e) =>
        params.tags!.some((t) => e.tags.includes(t))
      );
    }
    if (params.semantic) {
      // This provider has no embedding model, so it cannot judge semantic
      // relevance. Honestly return nothing rather than fall back to a
      // substring match masquerading as semantic search — see
      // SqliteMemoryProvider for the real, embedding-backed implementation.
      return [];
    }

    return results.slice(0, params.limit ?? 100);
  }

  async update(id: string, patch: Partial<MemoryEntry>): Promise<boolean> {
    const existing = this.store.get(id);
    if (!existing) return false;
    this.store.set(id, { ...existing, ...patch, id });
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  async healthCheck(): Promise<{ status: 'ok' | 'error'; message?: string }> {
    return { status: 'ok', message: `${this.store.size} entries in memory` };
  }
}
