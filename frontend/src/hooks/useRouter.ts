// ============================================================
// useRouter — Hook for sending messages through the Luminary Router.
//
// Non-streaming dispatch (the Chat page uses useChat's streaming
// flow instead). Errors are surfaced honestly — when the backend
// or Ollama is down, the caller sees the real failure.
// ============================================================

import { useState } from 'react';
import { routerApi, type RouteResponse } from '@/services/api';

interface UseRouterReturn {
  send: (content: string, sessionId?: string, targetAgentId?: string) => Promise<RouteResponse | null>;
  sending: boolean;
  lastRouted: RouteResponse | null;
  error: string | null;
}

export function useRouter(): UseRouterReturn {
  const [sending, setSending]         = useState(false);
  const [lastRouted, setLastRouted]   = useState<RouteResponse | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const send = async (
    content: string,
    sessionId?: string,
    targetAgentId?: string,
  ): Promise<RouteResponse | null> => {
    setSending(true);
    setError(null);
    try {
      const response = await routerApi.send({ content, sessionId, targetAgentId });
      setLastRouted(response);
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Routing failed');
      return null;
    } finally {
      setSending(false);
    }
  };

  return { send, sending, lastRouted, error };
}
