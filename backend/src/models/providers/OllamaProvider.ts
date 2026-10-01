// ============================================================
// OllamaProvider — Real IModelProvider backed by a local
// Ollama instance (https://ollama.com, REST API on :11434).
//
// Everything returned by this provider comes from the live
// Ollama API. When Ollama is unreachable, methods throw or
// report 'disconnected' honestly — there is no mock fallback.
// ============================================================

import type {
  IModelProvider,
  ModelInfo,
  CompletionOptions,
  CompletionResponse,
  EmbeddingOptions,
  EmbeddingResponse,
  ProviderHealth,
  ChatTurn,
  ChatStreamOptions,
  ChatStreamResult,
  PullProgress,
  ToolDefinition,
  ToolCall,
  ToolChatOptions,
  ToolChatResult,
} from '../../core/types/IModelProvider';
import { Agent } from 'undici';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('OllamaProvider');

/**
 * Node's built-in fetch is undici under the hood, and undici's default
 * Agent kills any request that goes 300s without response headers —
 * completely separate from, and blind to, the AbortSignal/timeoutMs
 * this file already threads through every call. A non-streaming
 * (stream:false) Ollama request sends NO bytes until generation is
 * fully done, so on CPU-only hardware a single slow completion trips
 * this hidden 300s ceiling regardless of how high AGENT_TOOL_TIMEOUT_MS
 * is set — exactly what happened to a Deep Research turn that was
 * still working at 312s. Disabled here so our own explicit
 * AbortSignal.timeout(timeoutMs) below is the ONE source of truth for
 * how long a request may run.
 */
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/**
 * Per-call ceiling for a tool-calling /api/chat request, mirrored from
 * BaseAgent's tool-loop wall clock (AGENT_TOOL_TIMEOUT_MS). Read lazily,
 * not cached at module load: server.ts imports Kernel — which reaches
 * this module via the concrete agent classes — before it calls
 * dotenv.config(), so a value frozen at import time would always see an
 * unset env var. Without this, a hardcoded cap smaller than the loop's
 * configured budget would silently abort a single slow CPU-inference
 * call well before the loop's own deadline — exactly the mismatch that
 * left Deep Research aborting even after AGENT_TOOL_TIMEOUT_MS was
 * raised. Matches BaseAgent.toolWallClockMs()'s fallback so both stay in
 * sync by default.
 */
function toolCallTimeoutMs(): number {
  return Math.max(1_000, Number(process.env.AGENT_TOOL_TIMEOUT_MS) || 60_000);
}

// ── Ollama API response shapes ────────────────────────────────
interface OllamaTagModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
  /** e.g. ["completion","tools","thinking"] — thinking is NOT universal. */
  capabilities?: string[];
}

interface OllamaPsModel {
  name: string;
  model: string;
  size: number;
  size_vram?: number;
  expires_at?: string;
  /** Effective runtime num_ctx of this loaded instance (Ollama ≥0.6.6). */
  context_length?: number;
}

// Ollama returns tool calls as a structured field on the assistant
// message (arguments already parsed to an object, not a JSON string).
interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

interface OllamaChatMessage {
  role: string;
  content?: string;
  /**
   * Reasoning-model chain-of-thought, streamed as its own incremental
   * field (separate from content) when the request set think:true.
   * Only present for models whose capabilities include "thinking".
   */
  thinking?: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatChunk {
  model: string;
  message?: OllamaChatMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface RunningModel {
  name: string;
  sizeBytes: number;
  sizeVramBytes: number;
  expiresAt?: string;
}

export class OllamaError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
    this.name = 'OllamaError';
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Best-effort model categorisation from its name/family — presentation only. */
function classifyModel(name: string, families: string[]): ModelInfo['type'] {
  const n = name.toLowerCase();
  const fams = families.map((f) => f.toLowerCase());
  if (n.includes('embed') || fams.includes('bert') || fams.includes('nomic-bert')) return 'embedding';
  if (fams.includes('clip') || fams.includes('mllama') || n.includes('llava') || n.includes('vision') || n.includes('moondream')) return 'vision';
  if (n.includes('coder') || n.includes('codellama') || n.includes('code-') || n.startsWith('code') || n.includes('starcoder')) return 'coding';
  return 'general';
}

export class OllamaProvider implements IModelProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama Local Provider';

  private baseUrl: string;
  /** context length cache keyed by model digest (survives list refreshes) */
  private contextCache = new Map<string, number>();
  /**
   * Thinking-capability cache keyed by model name — Ollama REJECTS the
   * whole request with an error if think:true is sent to a model that
   * doesn't support it (confirmed live: qwen2.5:1.5b → "does not
   * support thinking"), so this must be checked before ever setting
   * that flag, not assumed from one known-good model.
   */
  private thinkingCapableCache = new Map<string, boolean>();

  // 127.0.0.1 rather than localhost: Ollama binds IPv4 by default,
  // and localhost can resolve to ::1 first on some Windows setups.
  constructor(baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ── HTTP helpers ────────────────────────────────────────────

  private async request(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
    const { timeoutMs = 10_000, ...rest } = init ?? {};
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = rest.signal
      ? AbortSignal.any([rest.signal, timeoutSignal])
      : timeoutSignal;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...rest,
        signal,
        dispatcher,
      } as RequestInit & { dispatcher: Agent });
    } catch (err) {
      if (rest.signal?.aborted) throw err; // caller-initiated abort — propagate as-is
      // Our own timeoutMs elapsed — Ollama may well be up and simply slow
      // (large model, CPU-only inference). Say so honestly instead of
      // reporting it as unreachable, which sends the user chasing the
      // wrong problem.
      if (timeoutSignal.aborted) {
        throw new OllamaError(
          `Ollama request to ${this.baseUrl}${path} timed out after ${timeoutMs}ms. ` +
          'Ollama may still be running but taking longer than this limit — common on CPU-only ' +
          'hardware with a large model. Increase AGENT_TOOL_TIMEOUT_MS in backend/.env if this keeps happening.',
        );
      }
      throw new OllamaError(
        `Cannot reach Ollama at ${this.baseUrl} — is it running? (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch { /* non-JSON error body */ }
      throw new OllamaError(`Ollama request failed: ${detail}`, res.status);
    }
    return res;
  }

  private async requestJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const res = await this.request(path, init);
    return (await res.json()) as T;
  }

  /**
   * Consume an NDJSON streaming response line-by-line.
   * Ollama streams one JSON object per line for chat/pull.
   */
  private async readNdjson(res: Response, onLine: (obj: Record<string, unknown>) => void): Promise<void> {
    if (!res.body) throw new OllamaError('Ollama returned an empty stream body');
    const dispatch = (line: string): void => {
      const obj: unknown = JSON.parse(line);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new OllamaError('Invalid Ollama stream record');
      const record = obj as Record<string, unknown>;
      if (record.error !== undefined) throw new OllamaError('Ollama stream failed: ' + String(record.error));
      onLine(record);
    };
    const decoder = new TextDecoder();
    let buffer = '';
    // res.body is a web ReadableStream (async-iterable on Node 18+)
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        dispatch(line);
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) dispatch(rest);
  }

  // ── IModelProvider ──────────────────────────────────────────

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const json = await this.requestJson<{ version?: string }>('/api/version', { timeoutMs: 3_000 });
      return {
        status: 'connected',
        latencyMs: Date.now() - start,
        message: `Ollama ${json.version ?? '(unknown version)'} at ${this.baseUrl}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: 'disconnected',
        message: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /** Models currently loaded in memory (GET /api/ps). */
  async listRunning(): Promise<RunningModel[]> {
    const json = await this.requestJson<{ models?: OllamaPsModel[] }>('/api/ps');
    return (json.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      sizeVramBytes: m.size_vram ?? 0,
      expiresAt: m.expires_at,
    }));
  }

  async listModels(): Promise<ModelInfo[]> {
    const [tags, running] = await Promise.all([
      this.requestJson<{ models?: OllamaTagModel[] }>('/api/tags'),
      this.listRunning().catch(() => [] as RunningModel[]),
    ]);
    const models = tags.models ?? [];
    const runningNames = new Set(running.map((r) => r.name));

    return Promise.all(models.map(async (m) => {
      const families = m.details?.families ?? (m.details?.family ? [m.details.family] : []);
      return {
        id: m.name,
        name: m.name,
        family: m.details?.family ?? 'unknown',
        sizeLabel: formatBytes(m.size),
        sizeBytes: m.size,
        type: classifyModel(m.name, families ?? []),
        status: runningNames.has(m.name) ? 'loaded' as const : 'unloaded' as const,
        quantization: m.details?.quantization_level ?? '—',
        contextLength: await this.getContextLength(m.name, m.digest),
        parameterSize: m.details?.parameter_size,
        modifiedAt: m.modified_at,
        providerId: this.id,
      };
    }));
  }

  /** Resolve a model's context window via /api/show (cached by digest). */
  private async getContextLength(name: string, digest: string): Promise<number> {
    const cached = this.contextCache.get(digest);
    if (cached !== undefined) return cached;
    try {
      const info = await this.requestJson<{ model_info?: Record<string, unknown> }>('/api/show', {
        method: 'POST',
        body: JSON.stringify({ model: name }),
      });
      const modelInfo = info.model_info ?? {};
      const key = Object.keys(modelInfo).find((k) => k.endsWith('.context_length'));
      const ctx = key && typeof modelInfo[key] === 'number' ? (modelInfo[key] as number) : 0;
      this.contextCache.set(digest, ctx);
      return ctx;
    } catch {
      return 0;
    }
  }

  /**
   * Whether a model supports think:true, cached per model name. Unknown
   * or unreachable ⇒ false — never risk sending think:true speculatively,
   * since Ollama rejects the ENTIRE request for a model that doesn't
   * support it rather than just ignoring the flag.
   */
  private async supportsThinking(modelName: string): Promise<boolean> {
    const cached = this.thinkingCapableCache.get(modelName);
    if (cached !== undefined) return cached;
    try {
      const tags = await this.requestJson<{ models?: OllamaTagModel[] }>('/api/tags', { timeoutMs: 10_000 });
      for (const m of tags.models ?? []) {
        this.thinkingCapableCache.set(m.model, m.capabilities?.includes('thinking') ?? false);
      }
      return this.thinkingCapableCache.get(modelName) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Effective context window of the loaded instance of a model, straight
   * from /api/ps (`context_length`). This is the REAL runtime window the
   * last generation actually ran with — it already reflects any num_ctx
   * override — as opposed to the architecture maximum /api/show reports.
   * Undefined when the model is not loaded, the field is absent (older
   * Ollama), or the call fails: the caller shows "unknown", never a guess.
   */
  async getLoadedContextWindow(modelId: string): Promise<number | undefined> {
    try {
      const running = await this.requestJson<{ models?: OllamaPsModel[] }>('/api/ps', { timeoutMs: 5_000 });
      const match = (running.models ?? []).find((m) => m.name === modelId || m.model === modelId);
      return typeof match?.context_length === 'number' && match.context_length > 0
        ? match.context_length
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Load a model into memory: empty generate request with keep_alive. */
  async loadModel(modelId: string): Promise<void> {
    logger.info(`Loading model into memory: ${modelId}`);
    await this.requestJson('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: modelId, keep_alive: '30m', stream: false }),
      timeoutMs: 120_000, // large models take a while to page in
    });
  }

  /** Unload a model from memory: keep_alive 0 evicts it immediately. */
  async unloadModel(modelId: string): Promise<void> {
    logger.info(`Unloading model from memory: ${modelId}`);
    await this.requestJson('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: modelId, keep_alive: 0, stream: false }),
      timeoutMs: 60_000,
    });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    const start = Date.now();
    const messages: ChatTurn[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const json = await this.requestJson<OllamaChatChunk & { message?: { content: string } }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: options.model,
        messages,
        stream: false,
        options: {
          ...(options.temperature !== undefined && { temperature: options.temperature }),
          ...(options.maxTokens !== undefined && { num_predict: options.maxTokens }),
          ...(options.topP !== undefined && { top_p: options.topP }),
          ...(options.stopSequences && { stop: options.stopSequences }),
        },
      }),
      timeoutMs: 300_000,
    });

    return {
      content: json.message?.content ?? '',
      model: json.model ?? options.model,
      providerId: this.id,
      promptTokens: json.prompt_eval_count,
      completionTokens: json.eval_count,
      durationMs: Date.now() - start,
      finishReason: json.done_reason === 'length' ? 'length' : 'stop',
    };
  }

  async chatStream(
    messages: ChatTurn[],
    options: ChatStreamOptions,
    onToken: (token: string) => void,
  ): Promise<ChatStreamResult> {
    const start = Date.now();
    let content = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let evalDurationNs: number | undefined;
    let aborted = false;
    let completed = false;

    try {
      const res = await this.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: options.model,
          messages,
          stream: true,
          options: {
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.contextLength !== undefined && { num_ctx: options.contextLength }),
          },
        }),
        signal: options.signal,
        timeoutMs: 600_000,
      });

      await this.readNdjson(res, (obj) => {
        const chunk = obj as unknown as OllamaChatChunk;
        const token = chunk.message?.content ?? '';
        if (token) {
          content += token;
          onToken(token);
        }
        if (chunk.done === true) {
          completed = true;
          promptTokens = chunk.prompt_eval_count;
          completionTokens = chunk.eval_count;
          evalDurationNs = chunk.eval_duration;
        }
      });
    } catch (err) {
      if (options.signal?.aborted) {
        aborted = true; // user stopped generation — return what we have
      } else {
        throw err;
      }
    }

    if (!aborted && !options.signal?.aborted && !completed) throw new OllamaError('Ollama stream ended before completion');
    if (options.signal?.aborted) aborted = true;

    // Ollama occasionally reports near-zero eval durations (cache hits);
    // drop the stat rather than display a nonsense number.
    let tokensPerSecond = completionTokens && evalDurationNs
      ? Math.round((completionTokens / (evalDurationNs / 1e9)) * 10) / 10
      : undefined;
    if (tokensPerSecond !== undefined && (tokensPerSecond > 5000 || completionTokens! < 2)) {
      tokensPerSecond = undefined;
    }

    return {
      content,
      model: options.model,
      providerId: this.id,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - start,
      tokensPerSecond,
      aborted,
    };
  }

  // ── Tool calling ────────────────────────────────────────────

  /** Ollama's /api/chat supports the OpenAI-style `tools` array. */
  supportsTools(): boolean {
    return true;
  }

  /**
   * Serialise our neutral ChatTurn[] into Ollama's message wire format,
   * preserving assistant tool_calls and tool-result turns so the model
   * sees the full loop history.
   */
  private toOllamaMessages(messages: ChatTurn[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments ?? {} },
          })),
        };
      }
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content,
          ...(m.toolName ? { tool_name: m.toolName } : {}),
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  /**
   * One non-streaming tool-calling turn. Passes the tool definitions to
   * Ollama and parses any tool_calls off the response message. Real API
   * results only — when Ollama is unreachable or the model rejects
   * tools, the underlying request throws honestly (no mock fallback).
   */
  /**
   * Streamed so a reasoning model's chain-of-thought (onThinking) and any
   * pre-tool-call commentary reach the caller AS they're generated — on
   * CPU-only hardware a tool-calling turn can spend most of its wall
   * clock in silent "thinking" before ever proposing a tool call, which
   * previously looked identical to a hang. tool_calls themselves stay
   * atomic: Ollama only assembles the complete array on the final
   * done:true chunk, never incrementally, so they're read once at the
   * end exactly as the old non-streaming call did — nothing about that
   * contract changed, only content/thinking are now live.
   */
  async chatWithTools(
    messages: ChatTurn[],
    tools: ToolDefinition[],
    options: ToolChatOptions,
    onThinking?: (delta: string) => void,
  ): Promise<ToolChatResult> {
    const start = Date.now();
    const think = await this.supportsThinking(options.model);
    let content = '';
    let toolCalls: ToolCall[] = [];
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let doneReason: string | undefined;
    let completed = false;

    try {
      const res = await this.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: options.model,
          messages: this.toOllamaMessages(messages),
          tools,
          stream: true,
          ...(think && { think: true }),
          options: {
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.contextLength !== undefined && { num_ctx: options.contextLength }),
          },
        }),
        signal: options.signal,
        timeoutMs: toolCallTimeoutMs(),
      });

      await this.readNdjson(res, (obj) => {
        const chunk = obj as unknown as OllamaChatChunk;
        const thinkingDelta = chunk.message?.thinking ?? '';
        if (thinkingDelta) onThinking?.(thinkingDelta);
        const token = chunk.message?.content ?? '';
        if (token) content += token;

        // Tool calls arrive as their own complete chunk, NOT necessarily
        // on the done:true trailer — confirmed live: that final chunk is
        // often just stats (durations/token counts) with an EMPTY
        // message and no tool_calls at all. Capturing this only inside
        // `if (chunk.done)` silently threw away every real tool call the
        // model made — it never reached BaseAgent's loop, which then
        // saw an empty toolCalls array and treated the turn as a
        // (contentless) final answer instead of invoking anything.
        const rawCalls = chunk.message?.tool_calls;
        if (rawCalls && rawCalls.length > 0) {
          toolCalls = rawCalls
            .map((c, i) => {
              const name = c.function?.name;
              if (!name) return null;
              let args = c.function?.arguments ?? {};
              if (typeof args === 'string') {
                // Some builds return arguments as a JSON string — parse defensively.
                try { args = JSON.parse(args) as Record<string, unknown>; }
                catch { args = { _raw: args }; }
              }
              return { id: `call_${i}`, name, arguments: args as Record<string, unknown> } as ToolCall;
            })
            .filter((c): c is ToolCall => c !== null);
        }

        if (chunk.done === true) {
          completed = true;
          promptTokens = chunk.prompt_eval_count;
          completionTokens = chunk.eval_count;
          doneReason = chunk.done_reason;
        }
      });

      if (options.signal?.aborted) throw new OllamaError('Ollama generation aborted');
      if (!completed) throw new OllamaError('Ollama tool stream ended before completion');
      return {
        content,
        toolCalls,
        model: options.model,
        providerId: this.id,
        promptTokens,
        completionTokens,
        durationMs: Date.now() - start,
        aborted: false,
        finishReason: doneReason === 'length' ? 'length' : 'stop',
      };
    } catch (err) {
      // Caller-initiated abort (wall-clock limit / Stop): report honestly
      // as an aborted turn rather than throwing a fake error.
      if (options.signal?.aborted) {
        return {
          content,
          toolCalls: [],
          model: options.model,
          providerId: this.id,
          durationMs: Date.now() - start,
          aborted: true,
          finishReason: 'error',
        };
      }
      throw err;
    }
  }

  async pullModel(
    name: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    logger.info(`Pulling model: ${name}`);
    const res = await this.request('/api/pull', {
      method: 'POST',
      body: JSON.stringify({ model: name, stream: true }),
      signal,
      timeoutMs: 3_600_000, // pulls can take a long time on slow connections
    });

    await this.readNdjson(res, (obj) => {
      if (typeof obj.error === 'string') throw new OllamaError(obj.error);
      onProgress({
        status: typeof obj.status === 'string' ? obj.status : '',
        digest: typeof obj.digest === 'string' ? obj.digest : undefined,
        total: typeof obj.total === 'number' ? obj.total : undefined,
        completed: typeof obj.completed === 'number' ? obj.completed : undefined,
      });
    });
    logger.info(`Pull complete: ${name}`);
  }

  async deleteModel(name: string): Promise<void> {
    logger.info(`Deleting model: ${name}`);
    await this.request('/api/delete', {
      method: 'DELETE',
      body: JSON.stringify({ model: name }),
      timeoutMs: 60_000,
    });
  }

  async embed(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    const json = await this.requestJson<{ embeddings?: number[][] }>('/api/embed', {
      method: 'POST',
      body: JSON.stringify({ model: options.model, input: options.input }),
      timeoutMs: 120_000,
    });
    return {
      embeddings: json.embeddings ?? [],
      model: options.model,
      providerId: this.id,
    };
  }
}
