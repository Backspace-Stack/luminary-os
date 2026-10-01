// ============================================================
// useModels — Live model management across local providers.
//
// Two real sources feed this hook:
//   • Ollama ("ollama")     — installed models, can run
//   • GGUF folder ("local") — discovered .gguf files; listed even
//     when Ollama is down, marked runnable:false until a GGUF
//     runtime exists
//
// Errors are surfaced honestly per provider — a dead provider
// never hides the other one's models, and nothing is mocked.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { modelsApi } from '@/services/api';
import type { LLMModel, RunningModel, ProviderHealth, PullProgress } from '@/types';
import type { EventStreamState } from '@/services/eventStream';

export interface PullState extends PullProgress {
  name: string;
}

export function useModels() {
  const [models, setModels]           = useState<LLMModel[]>([]);
  const [running, setRunning]         = useState<RunningModel[]>([]);
  const [health, setHealth]           = useState<ProviderHealth | null>(null);       // ollama
  const [localHealth, setLocalHealth] = useState<ProviderHealth | null>(null);       // GGUF folder
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [pulling, setPulling]         = useState<PullState | null>(null);
  const [eventStatus, setEventStatus] = useState<EventStreamState>('connecting');
  const pullAbort                     = useRef<AbortController | null>(null);
  const refreshVersion                = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    try {
      // Health first — it also tells the UI why a provider is empty
      const healthMap = await modelsApi.health();
      if (version !== refreshVersion.current) return;
      setHealth(healthMap['ollama'] ?? null);
      setLocalHealth(healthMap['local'] ?? null);

      // The list merges every provider that responds; the backend
      // rescans the GGUF folder on each call, so Refresh = rescan.
      const [modelList, runningList] = await Promise.all([
        modelsApi.list(),
        modelsApi.running().catch(() => [] as RunningModel[]),
      ]);
      if (version !== refreshVersion.current) return;
      setModels(modelList);
      setRunning(runningList);
      setError(null);
    } catch (err) {
      if (version !== refreshVersion.current) return;
      setModels([]);
      setRunning([]);
      setHealth(null);
      setLocalHealth(null);
      setError(err instanceof Error ? err.message : 'Failed to reach the backend');
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live updates: the backend pushes an SSE event whenever the model
  // set changes (GGUF dropped into the models folder, pull, delete,
  // load/unload) — the page updates with no manual Refresh.
  useEffect(() => modelsApi.subscribe(() => { void refresh(); }, setEventStatus), [refresh]);

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    }
  };

  const loadModel   = (id: string) => runAction(() => modelsApi.load(id));
  const unloadModel = (id: string) => runAction(() => modelsApi.unload(id));
  const deleteModel = (id: string) => runAction(() => modelsApi.delete(id));

  /** Pull a model by name, streaming progress into `pulling`. */
  const pullModel = async (name: string) => {
    const controller = new AbortController();
    pullAbort.current = controller;
    setPulling({ name, status: 'starting…' });
    try {
      await modelsApi.pull(
        name,
        (progress) => setPulling({ name, ...progress }),
        controller.signal,
      );
      await refresh();
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Pull failed');
      }
    } finally {
      setPulling(null);
      pullAbort.current = null;
    }
  };

  const cancelPull = () => pullAbort.current?.abort();

  return {
    models, running, health, localHealth, loading, error, eventStatus,
    refresh, loadModel, unloadModel, deleteModel,
    pullModel, cancelPull, pulling,
    clearError: () => setError(null),
  };
}
