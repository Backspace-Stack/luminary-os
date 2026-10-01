import { useState, useEffect, useCallback } from 'react';
import { memoryApi, type MemoryFilter } from '@/services/api';
import type { MemoryEntry } from '@/types';

export function useMemory(filter: MemoryFilter = {}) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await memoryApi.list(filter);
      setMemories(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.type, filter.agentId, filter.importance]);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (id: string) => {
    await memoryApi.remove(id).catch(() => null);
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  const create = async (entry: Omit<MemoryEntry, 'id'>) => {
    const created = await memoryApi.create(entry);
    setMemories(prev => [created, ...prev]);
    return created;
  };

  const update = async (id: string, patch: Partial<MemoryEntry>) => {
    const updated = await memoryApi.update(id, patch);
    setMemories(prev => prev.map(m => (m.id === id ? updated : m)));
    return updated;
  };

  return { memories, loading, error, remove, create, update, refresh };
}
