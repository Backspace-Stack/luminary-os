import { useState, useEffect, useCallback } from 'react';
import { systemApi } from '@/services/api';
import type { SystemStatus } from '@/types';

/** Honest zero-state shown until the first real snapshot arrives. */
export const EMPTY_SYSTEM: SystemStatus = {
  version: '',
  uptime: '—',
  uptimeMs: 0,
  agents:  { total: 0, active: 0, activeAgentName: null, activeModelName: null },
  tasks:   { running: 0, total: 0 },
  plugins: { total: 0, active: 0 },
  devices: { total: 0, online: 0, offline: 0 },
  memory:  { total: 0, providerStatus: 'unknown' },
  providers: { total: 0, defaultId: null },
  resources: { cpuPercent: 0, gpuPercent: null, ramUsedGB: 0, ramTotalGB: 0 },
};

export function useSystemStatus(intervalMs = 8000) {
  const [status, setStatus]   = useState<SystemStatus>(EMPTY_SYSTEM);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await systemApi.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { status, loading, error, refresh };
}
