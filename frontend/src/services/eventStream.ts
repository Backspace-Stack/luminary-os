export type EventStreamState = 'connecting' | 'connected' | 'reconnecting' | 'unauthorized';
interface Options {
  headers?: () => HeadersInit;
  retryMs?: number;
  onState?: (state: EventStreamState) => void;
}
/** Fetch-based SSE supports bearer headers without putting credentials in URLs. */
export function subscribeEventStream(url: string, onMessage: (data: string) => void, options: Options = {}): () => void {
  let stopped = false;
  let controller: AbortController;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const initialDelay = Math.max(10, options.retryMs ?? 1000);
  let delay = initialDelay;
  const setState = (state: EventStreamState) => {
    if (stopped) return;
    try { options.onState?.(state); } catch { /* UI observers cannot reject the transport task. */ }
  };

  const connect = async () => {
    controller = new AbortController();
    setState('connecting');
    try {
      const response = await fetch(url, {
        headers: { ...Object.fromEntries(new Headers(options.headers?.()).entries()), Accept: 'text/event-stream' },
        cache: 'no-store', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        setState('unauthorized');
        return; // A changed token can start a new subscription; do not hammer the gate.
      }
      if (!response.ok || !response.body || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
        await response.body?.cancel();
        throw new Error('Model event stream unavailable');
      }
      setState('connected');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', data: string[] = [], dataSize = 0;
      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, '');
            buffer = buffer.slice(newline + 1);
            if (!line) {
              if (data.length && !stopped) { onMessage(data.join('\n')); delay = initialDelay; }
              data = []; dataSize = 0;
            } else if (line.startsWith('data:')) {
              const payload = line.slice(5).replace(/^ /, '');
              dataSize += line.length + 1; // Count framing too, including empty data lines.
              if (dataSize > 256 * 1024) throw new Error('Event frame exceeds limit');
              data.push(payload);
            }
          }
          if (buffer.length > 256 * 1024) throw new Error('Event line exceeds limit');
        }
        // Only blank-line-terminated events are complete; discard a truncated frame.
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {
      // Network/stream errors reconnect; cancellation stays silent.
    }
    if (!stopped) {
      setState('reconnecting');
      timer = setTimeout(() => { void connect(); }, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
