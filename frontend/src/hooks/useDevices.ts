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
    try {
      const updated = await devicesApi.connect(id);
      setDevices(prev => prev.map(d => d.id === id ? updated : d));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect device');
    }
  };

  const disconnect = async (id: string) => {
    try {
      const updated = await devicesApi.disconnect(id);
      setDevices(prev => prev.map(d => d.id === id ? updated : d));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect device');
    }
  };

  return { devices, loading, error, connect, disconnect, refresh };
}
