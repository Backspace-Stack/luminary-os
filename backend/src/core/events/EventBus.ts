// ============================================================
// EventBus — Lightweight synchronous pub/sub event bus.
//
// Modules emit events rather than calling each other directly,
// keeping coupling to a minimum. The Kernel subscribes to
// system events for observability and lifecycle management.
// ============================================================

export type EventPayload = Record<string, unknown>;

export interface LuminaryEvent<T extends EventPayload = EventPayload> {
  /** Namespaced event name: "agent:started", "plugin:error" */
  type: string;
  payload: T;
  timestamp: string;
  source?: string;
}

export type EventHandler<T extends EventPayload = EventPayload> = (
  event: LuminaryEvent<T>
) => void | Promise<void>;

// Well-known event type constants
export const EVENTS = {
  // Kernel
  KERNEL_READY: 'kernel:ready',
  KERNEL_SHUTDOWN: 'kernel:shutdown',

  // Agents
  AGENT_REGISTERED: 'agent:registered',
  AGENT_STATUS_CHANGED: 'agent:status_changed',
  AGENT_REQUEST_RECEIVED: 'agent:request_received',
  AGENT_RESPONSE_SENT: 'agent:response_sent',
  AGENT_ERROR: 'agent:error',

  // Router
  ROUTER_DISPATCHED: 'router:dispatched',
  ROUTER_NO_HANDLER: 'router:no_handler',

  // Plugins
  PLUGIN_REGISTERED: 'plugin:registered',
  PLUGIN_INITIALISED: 'plugin:initialised',
  PLUGIN_ERROR: 'plugin:error',

  // Models
  MODEL_LOADED: 'model:loaded',
  MODEL_UNLOADED: 'model:unloaded',
  MODEL_ERROR: 'model:error',
  /** The set of available models changed (folder watch, pull, delete). */
  MODELS_CHANGED: 'model:models_changed',

  // Memory
  MEMORY_WRITTEN: 'memory:written',
  MEMORY_DELETED: 'memory:deleted',

  // Devices
  DEVICE_CONNECTED: 'device:connected',
  DEVICE_DISCONNECTED: 'device:disconnected',
} as const;

export class EventBus {
  private static instance: EventBus;
  private handlers = new Map<string, Set<EventHandler>>();

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) EventBus.instance = new EventBus();
    return EventBus.instance;
  }

  on<T extends EventPayload>(type: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as EventHandler);
    // Return an unsubscribe function
    return () => this.off(type, handler as EventHandler);
  }

  off(type: string, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit<T extends EventPayload>(type: string, payload: T, source?: string): void {
    const event: LuminaryEvent<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
      source,
    };

    // Typed subscribers first, then the wildcard set registered by onAny() —
    // emit() used to look up only `type`, so onAny() silently never fired.
    // (When type IS '*' the same set would otherwise be dispatched twice.)
    const sets = type === '*'
      ? [this.handlers.get('*')]
      : [this.handlers.get(type), this.handlers.get('*')];

    for (const handlers of sets) {
      if (!handlers?.size) continue;
      // Iterate a copy: a handler that (un)subscribes during dispatch must
      // not mutate the set we are walking.
      for (const handler of [...handlers]) {
        try {
          const out = handler(event as LuminaryEvent);
          // A handler may be async. `void` dropped the rejection, which on
          // modern Node is an unhandled rejection and kills the process.
          if (out && typeof (out as Promise<void>).catch === 'function') {
            (out as Promise<void>).catch((err) =>
              console.error(`[EventBus] Async handler failed for "${type}":`, err),
            );
          }
        } catch (err) {
          console.error(`[EventBus] Error in handler for "${type}":`, err);
        }
      }
    }
  }

  /** Subscribe to all events (useful for logging/audit). */
  onAny(handler: EventHandler): () => void {
    return this.on('*', handler);
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = EventBus.getInstance();
