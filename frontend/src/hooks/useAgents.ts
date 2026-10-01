import { useState, useEffect, useCallback } from 'react';
import { agentsApi } from '@/services/api';
import type { Agent } from '@/types';

export function useAgents() {
  const [agents, setAgents]   = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await agentsApi.list();
      setAgents(data);
      setError(null);
    } catch (err) {
      setAgents([]);
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const activate = async (id: string) => {
    const updated = await agentsApi.activate(id);
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
  };

  const pause = async (id: string) => {
    const updated = await agentsApi.pause(id);
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
  };

  /** Assign a real installed model to an agent (persisted on the backend). */
  const setModel = async (id: string, model: string) => {
    try {
      const updated = await agentsApi.setModel(id, model);
      setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign model');
    }
  };

  return { agents, loading, error, activate, pause, setModel, refresh };
}
