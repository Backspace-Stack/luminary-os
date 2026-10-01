import { useState, useEffect, useCallback } from 'react';
import { devicesApi } from '@/services/api';
import type { Device } from '@/types';

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await devicesApi.list();
      setDevices(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = async (id: string) => {
    const updated = await devicesApi.connect(id).catch(() => null);
    if (updated) setDevices(prev => prev.map(d => d.id === id ? updated : d));
  };

  const disconnect = async (id: string) => {
    const updated = await devicesApi.disconnect(id).catch(() => null);
    if (updated) setDevices(prev => prev.map(d => d.id === id ? updated : d));
  };

  return { devices, loading, error, connect, disconnect, refresh };
}
