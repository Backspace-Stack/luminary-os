// ============================================================
// api.ts — Typed HTTP client for the Luminary OS backend.
//
// All network calls in the frontend go through this module.
// Components and hooks never use fetch() directly.
//
// Everything talks to the real backend and surfaces honest
// errors — there are no mock fallbacks anywhere.
// ============================================================

import type {
  SystemStatus, LLMModel, Agent, RunningModel, ProviderHealth,
  MemoryEntry, Device, Conversation, ConversationSummary,
  ChatMessage, PullProgress, AppSettings, PendingConfirmation,
  Analytics, AnalyticsRange, Note, AskNoteResult,
} from '@/types';

const BASE = '/api';

// ── Auth ───────────────────────────────────────────────────────
// When the backend runs with API_AUTH_TOKEN set, every /api route except
// /api/health requires "Authorization: Bearer <token>". Nothing in this
// client used to send one, so switching the backend gate on 401'd the
// entire UI. Set VITE_API_AUTH_TOKEN to the same value, or call
// setApiAuthToken() at runtime.
let authToken: string | null = import.meta.env.VITE_API_AUTH_TOKEN?.trim() || null;

/** Point the client at a token at runtime. Pass null to clear it. */
export function setApiAuthToken(token: string | null): void {
  authToken = token?.trim() ? token.trim() : null;
}

/** Standard headers: JSON content type, plus the bearer token when set. */
function authHeaders(extra?: HeadersInit): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(extra as Record<string, string> | undefined),
  };
}

// ── Generic fetch helper ──────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      // options FIRST, then headers: the spread used to come after the
      // header literal, so any caller passing headers silently dropped
      // Content-Type (and now the bearer token).
      ...options,
      headers: authHeaders(options?.headers),
    });
  } catch {
    throw new ApiError('Luminary backend is unreachable — is it running?', 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
  }
  const json = await res.json();
  return json.data as T;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── NDJSON streaming helper ───────────────────────────────────
/**
 * POST to a streaming endpoint and invoke onEvent per NDJSON line.
 * Resolves when the stream ends; rejects on transport failure.
 */
async function streamNdjson(
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('Luminary backend is unreachable — is it running?', 0);
  }
  if (!res.ok || !res.body) {
    // Surface the backend's real message (e.g. a 400 from /chat/generate)
    // rather than a bare status line.
    const body = res.body ? await res.json().catch(() => ({})) : {};
    throw new ApiError((body as { message?: string }).message ?? `HTTP ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // A throw anywhere below (a malformed line, a handler error) used to exit
  // the loop with the reader still locked, leaking the connection.
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) emit(line, onEvent);
      }
    }
    const rest = buffer.trim();
    if (rest) emit(rest, onEvent);
  } finally {
    reader.cancel().catch(() => { /* already closed */ });
  }
}

/** Parse one NDJSON line. A malformed line is skipped, not fatal to the stream. */
function emit(line: string, onEvent: (event: Record<string, unknown>) => void): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    console.warn('[api] skipping malformed NDJSON line:', line.slice(0, 200));
    return;
  }
  onEvent(parsed);
}

// ── System ─────────────────────────────────────────────────────
export const systemApi = {
  getStatus: () => apiFetch<SystemStatus>('/system/status'),
};

// ── Settings ───────────────────────────────────────────────────
export const settingsApi = {
  get: () => apiFetch<AppSettings>('/settings'),

  /** Set (or clear with null) the local GGUF models folder. */
  setGgufFolder: (path: string | null) =>
    apiFetch<AppSettings>('/settings/gguf-folder', {
      method: 'PUT',
      body: JSON.stringify({ path }),
    }),
};

// ── Integrations (API keys) ────────────────────────────────────
export interface IntegrationStatus {
  id: string;
  label: string;
  unlocks: string;
  /** True when a usable key exists (saved or from an env fallback). */
  configured: boolean;
  source: 'saved' | 'env' | null;
}

export const integrationsApi = {
  list: () => apiFetch<IntegrationStatus[]>('/integrations'),

  /** Save (or clear, with an empty string) a key. The key is never returned. */
  save: (id: string, value: string) =>
    apiFetch<IntegrationStatus>(`/integrations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  remove: (id: string) =>
    apiFetch<IntegrationStatus>(`/integrations/${id}`, { method: 'DELETE' }),
};

// ── Chat ───────────────────────────────────────────────────────
export type GenerateMode = 'send' | 'regenerate' | 'continue' | 'resume';

export interface ToolActivity {
  phase: 'started' | 'result';
  plugin: string;
  action: string;
  args?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
}

export interface GenerateEventHandlers {
  onMeta?: (meta: { agentId: string; agentName: string; model: string; messageId: string }) => void;
  onToken?: (token: string) => void;
  onDone?: (message: ChatMessage) => void;
  onError?: (message: string) => void;
  /** A tool-capable agent (Agent / Deep Research mode) paused for approval. */
  onPending?: (info: { agentId: string; agentName: string; model?: string; pendingConfirmations: PendingConfirmation[] }) => void;
  /** Live tool-call progress during a tool loop — the only signal the
   *  client has that a Deep Research-style turn is still working, since
   *  onMeta is deliberately deferred until the first token for these turns. */
  onToolActivity?: (activity: ToolActivity) => void;
  /** Reasoning-model chain-of-thought, streamed live during a tool loop —
   *  on slow hardware this silent "thinking before the first tool call"
   *  phase is most of the turn's wall clock. Never persisted. */
  onThinking?: (delta: string) => void;
}

export const chatApi = {
  listConversations: () =>
    apiFetch<ConversationSummary[]>('/chat/conversations'),

  createConversation: (title?: string) =>
    apiFetch<Conversation>('/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getConversation: (id: string) =>
    apiFetch<Conversation>(`/chat/conversations/${id}`),

  renameConversation: (id: string, title: string) =>
    apiFetch<Conversation>(`/chat/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  /** Switch which agent (mode) this conversation is pinned to. */
  setConversationAgent: (id: string, agentId: string) =>
    apiFetch<Conversation>(`/chat/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ agentId }),
    }),

  deleteConversation: (id: string) =>
    apiFetch<void>(`/chat/conversations/${id}`, { method: 'DELETE' }),

  /** Real usage analytics over the persisted chat history. Pass `agent`
   *  (e.g. 'coding-agent') to scope the report to a single agent's usage. */
  analytics: (range: AnalyticsRange = 'all', agent?: string) =>
    apiFetch<Analytics>(`/chat/analytics?range=${range}${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`),

  stop: (id: string) =>
    apiFetch<{ stopped: boolean }>(`/chat/conversations/${id}/stop`, { method: 'POST' }),

  deny: (id: string, confirmationIds: string[]) =>
    apiFetch<{ denied: boolean }>(`/chat/conversations/${id}/deny`, {method:'POST',body:JSON.stringify({confirmationIds})}),

  /** Stream one generation turn. Resolves when the stream closes. */
  generate: (
    params: {
      conversationId: string;
      mode: GenerateMode;
      content?: string;
      targetAgentId?: string;
      /** Sampling temperature from Settings (undefined = provider default). */
      temperature?: number;
      /** Context window (num_ctx) from Settings for Ollama models. */
      contextLength?: number;
      /** Approval tokens for mode 'resume' — from a prior onPending. */
      confirmedToolCallIds?: string[];
    },
    handlers: GenerateEventHandlers,
    signal?: AbortSignal,
  ) =>
    streamNdjson('/chat/generate', params, (event) => {
      switch (event.type) {
        case 'meta':
          handlers.onMeta?.(event as unknown as Parameters<NonNullable<GenerateEventHandlers['onMeta']>>[0]);
          break;
        case 'token':
          handlers.onToken?.(String(event.token ?? ''));
          break;
        case 'thinking_delta':
          handlers.onThinking?.(String(event.text ?? ''));
          break;
        case 'done':
          handlers.onDone?.(event.message as unknown as ChatMessage);
          break;
        case 'pending':
          handlers.onPending?.(event as unknown as Parameters<NonNullable<GenerateEventHandlers['onPending']>>[0]);
          break;
        case 'tool_call_started':
          handlers.onToolActivity?.({
            phase: 'started',
            plugin: String(event.plugin ?? ''),
            action: String(event.action ?? ''),
            args: event.args as Record<string, unknown> | undefined,
          });
          break;
        case 'tool_call_result':
          handlers.onToolActivity?.({
            phase: 'result',
            plugin: String(event.plugin ?? ''),
            action: String(event.action ?? ''),
            success: Boolean(event.success),
            summary: typeof event.summary === 'string' ? event.summary : undefined,
          });
          break;
        case 'error':
          handlers.onError?.(String(event.message ?? 'Generation failed'));
          break;
      }
    }, signal),
};

// ── Router — non-streaming agent dispatch ──────────────────────
export interface RouteRequest {
  content: string;
  sessionId?: string;
  targetAgentId?: string;
}

export interface RouteResponse {
  requestId: string;
  agentId: string;
  agentName: string;
  content: string;
  model?: string;
  durationMs?: number;
  timestamp: string;
}

export const routerApi = {
  send: (body: RouteRequest) =>
    apiFetch<RouteResponse>('/router/send', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  preview: (content: string) =>
    apiFetch<{ agentId: string; agentName: string } | null>('/router/preview', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
};

// ── Agents ─────────────────────────────────────────────────────
export const agentsApi = {
  list: () => apiFetch<Agent[]>('/agents'),

  get: (id: string) =>
    apiFetch<Agent>(`/agents/${id}`),

  activate: (id: string) =>
    apiFetch<Agent>(`/agents/${id}/activate`, { method: 'POST' }),

  pause: (id: string) =>
    apiFetch<Agent>(`/agents/${id}/pause`, { method: 'POST' }),

  /** Assign a real installed model to an agent (persisted server-side). */
  setModel: (id: string, model: string) =>
    apiFetch<Agent>(`/agents/${id}/model`, {
      method: 'PUT',
      body: JSON.stringify({ model }),
    }),
};

// ── Models ─────────────────────────────────────────────────────
export const modelsApi = {
  list: () => apiFetch<LLMModel[]>('/models'),

  providers: () =>
    apiFetch<Array<{ id: string; name: string }>>('/models/providers'),

  health: () =>
    apiFetch<Record<string, ProviderHealth>>('/models/health'),

  running: () =>
    apiFetch<RunningModel[]>('/models/running'),

  load: (id: string) =>
    apiFetch<void>(`/models/${encodeURIComponent(id)}/load`, { method: 'POST' }),

  unload: (id: string) =>
    apiFetch<void>(`/models/${encodeURIComponent(id)}/unload`, { method: 'POST' }),

  delete: (id: string) =>
    apiFetch<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Drag-and-drop install: stream a .gguf file into the models/
   * folder. The backend watcher registers it live. XHR is used for
   * real upload progress events.
   */
  upload: (
    file: File,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal,
  ) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `${BASE}/models/upload?name=${encodeURIComponent(file.name)}`);
      // The raw-body upload route sits behind the same /api auth gate.
      if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        try {
          reject(new ApiError(JSON.parse(xhr.responseText).message ?? `HTTP ${xhr.status}`, xhr.status));
        } catch {
          reject(new ApiError(`HTTP ${xhr.status}`, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('Upload failed — backend unreachable', 0));
      xhr.onabort = () => reject(new ApiError('Upload cancelled', 0));
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(file);
    }),

  /** Pull a model from the Ollama registry, streaming progress. */
  pull: (
    name: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal,
  ) =>
    new Promise<void>((resolve, reject) => {
      streamNdjson('/models/pull', { name }, (event) => {
        if (event.type === 'progress') onProgress(event as unknown as PullProgress);
        else if (event.type === 'error') reject(new ApiError(String(event.message ?? 'Pull failed'), 502));
      }, signal).then(resolve, reject);
    }),
};

// ── Memory ─────────────────────────────────────────────────────
export interface MemoryFilter {
  type?: string;
  agentId?: string;
  importance?: string;
  limit?: number;
}

export const memoryApi = {
  list: (filter: MemoryFilter = {}) => {
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(filter).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
    );
    return apiFetch<MemoryEntry[]>(`/memory?${params}`);
  },

  get: (id: string) => apiFetch<MemoryEntry>(`/memory/${id}`),

  create: (entry: Omit<MemoryEntry, 'id'>) =>
    apiFetch<MemoryEntry>('/memory', { method: 'POST', body: JSON.stringify(entry) }),

  update: (id: string, patch: Partial<MemoryEntry>) =>
    apiFetch<MemoryEntry>(`/memory/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  remove: (id: string) =>
    apiFetch<void>(`/memory/${id}`, { method: 'DELETE' }),
};

// ── Notes ──────────────────────────────────────────────────────
export const notesApi = {
  list: () => apiFetch<Note[]>('/notes'),

  get: (id: string) => apiFetch<Note>(`/notes/${id}`),

  create: (note: { title?: string; content?: string } = {}) =>
    apiFetch<Note>('/notes', { method: 'POST', body: JSON.stringify(note) }),

  update: (id: string, patch: { title?: string; content?: string }) =>
    apiFetch<Note>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  remove: (id: string) => apiFetch<void>(`/notes/${id}`, { method: 'DELETE' }),

  /**
   * Ask Lumen about a highlighted passage. Runs a real Deep Research
   * turn server-side (web search included), so this can legitimately
   * take minutes — there is no client-side timeout, only `signal`.
   */
  ask: (id: string, selection: string, question?: string, signal?: AbortSignal) =>
    apiFetch<AskNoteResult>(`/notes/${id}/ask`, {
      method: 'POST',
      body: JSON.stringify({ selection, question }),
      signal,
    }),
};

// ── Devices ────────────────────────────────────────────────────
export const devicesApi = {
  list: (filter: { type?: string; status?: string } = {}) => {
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(filter).filter(([, v]) => v != null) as [string, string][])
    );
    return apiFetch<Device[]>(`/devices?${params}`);
  },

  get: (id: string) => apiFetch<Device>(`/devices/${id}`),

  connect: (id: string) =>
    apiFetch<Device>(`/devices/${id}/connect`, { method: 'POST' }),

  disconnect: (id: string) =>
    apiFetch<Device>(`/devices/${id}/disconnect`, { method: 'POST' }),
};
