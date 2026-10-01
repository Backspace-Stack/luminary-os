// ============================================================
// IModelProvider — Core contract for all LLM backends.
//
// The frontend and agents NEVER communicate with a model
// provider directly. All inference goes through this interface.
// Concrete implementations: OllamaProvider, LocalProvider, etc.
// ============================================================

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  sizeLabel: string;
  sizeBytes?: number;
  type: 'general' | 'coding' | 'embedding' | 'vision';
  status: 'loaded' | 'unloaded';
  quantization: string;
  contextLength: number;
  parameterSize?: string;
  modifiedAt?: string;
  speed?: string;
  providerId: string;
  /** Provider-native identifier when the public id is namespaced. */
  remoteId?: string;
  /**
   * Whether this provider can actually run the model right now.
   * False for discovered GGUF files until an in-process runtime
   * (e.g. node-llama-cpp) is installed. Undefined means runnable.
   */
  runnable?: boolean;
  /** Absolute path on disk for file-based models (GGUF). */
  filePath?: string;
}

export interface CompletionOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface CompletionResponse {
  content: string;
  model: string;
  providerId: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  finishReason?: 'stop' | 'length' | 'error';
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Set on assistant turns that requested tool calls (tool-use loop). */
  toolCalls?: ToolCall[];
  /** Set on 'tool' turns: which tool/action produced this result. */
  toolName?: string;
  /** Provider-assigned tool invocation id, when the wire format requires it. */
  toolCallId?: string;
}

// ── Tool calling ──────────────────────────────────────────────
// Optional provider capability (see supportsTools / chatWithTools).
// Shapes mirror the OpenAI/Ollama `tools` + `tool_calls` convention.

/** A single tool the model may call, described with a JSON Schema. */
export interface ToolDefinition {
  type: 'function';
  function: {
    /** Tool name — the plugin capability action, e.g. "exec". */
    name: string;
    description: string;
    /** JSON Schema for the arguments object the model must produce. */
    parameters: Record<string, unknown>;
  };
}

/** A tool invocation the model asked for on an assistant turn. */
export interface ToolCall {
  /** Provider-assigned id when available; synthesised otherwise. */
  id?: string;
  /** Capability action name to invoke, e.g. "exec". */
  name: string;
  /** Parsed argument object (Ollama returns this already-parsed). */
  arguments: Record<string, unknown>;
  /** Opaque provider state needed to replay a tool call in a later turn. */
  providerData?: unknown;
}

export interface ToolChatOptions {
  model: string;
  temperature?: number;
  /** Context window (num_ctx) — honored by providers that support it. */
  contextLength?: number;
  /** Abort the upstream generation (wall-clock limit / user Stop). */
  signal?: AbortSignal;
}

export interface ToolChatResult {
  /** Assistant text for this turn (may be empty when only calling tools). */
  content: string;
  /** Tool calls the model wants executed; empty array = final answer. */
  toolCalls: ToolCall[];
  model: string;
  providerId: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  /** True when generation was aborted before completion. */
  aborted: boolean;
  finishReason?: 'stop' | 'length' | 'error';
}

export interface ChatStreamOptions {
  model: string;
  temperature?: number;
  /** Context window (num_ctx) — honored by providers that support it. */
  contextLength?: number;
  /** Abort the upstream generation (e.g. user pressed Stop). */
  signal?: AbortSignal;
}

export interface ChatStreamResult {
  /** Full accumulated response content. */
  content: string;
  model: string;
  providerId: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  tokensPerSecond?: number;
  /** True when generation was aborted before completion. */
  aborted: boolean;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface EmbeddingOptions {
  model: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  providerId: string;
}

export type ProviderStatus = 'connected' | 'disconnected' | 'error' | 'initialising';

export interface ProviderHealth {
  status: ProviderStatus;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

/**
 * IModelProvider — Every LLM backend must implement this interface.
 *
 * Agents call complete() or embed() to perform inference.
 * They never import or instantiate a concrete provider.
 */
export interface IModelProvider {
  /** Unique provider ID, e.g. "ollama", "local" */
  readonly id: string;
  /** Human-readable name, e.g. "Ollama Local Provider" */
  readonly name: string;

  /** Check whether the backend is reachable and healthy. */
  healthCheck(): Promise<ProviderHealth>;

  /** List all models available from this provider. */
  listModels(): Promise<ModelInfo[]>;

  /** Load a model into memory (provider-specific semantics). */
  loadModel(modelId: string): Promise<void>;

  /** Unload a model from memory. */
  unloadModel(modelId: string): Promise<void>;

  /** Generate a completion for the given prompt. */
  complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse>;

  /** Generate embeddings for retrieval / memory. */
  embed(options: EmbeddingOptions): Promise<EmbeddingResponse>;

  // ── Optional capabilities ─────────────────────────────────
  // Providers that support them implement these; callers must
  // feature-check before use. Ollama supports all of them.

  /**
   * Stream a chat completion token-by-token. onToken is invoked
   * for every content fragment as it arrives from the backend.
   */
  chatStream?(
    messages: ChatTurn[],
    options: ChatStreamOptions,
    onToken: (token: string) => void,
  ): Promise<ChatStreamResult>;

  /** Download a model, reporting progress as it streams. */
  pullModel?(
    name: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Permanently delete a model from the backend. */
  deleteModel?(name: string): Promise<void>;

  /**
   * Whether this provider can perform tool/function calling. Callers
   * MUST feature-check this (and chatWithTools) before handing over a
   * tools array — a provider that returns false / omits chatWithTools
   * never sees tools, so the agent degrades to a plain completion
   * rather than silently dropping the model's ability to act.
   */
  supportsTools?(): boolean;

  /**
   * One tool-calling chat turn. The final result is still a single
   * atomic value — Ollama assembles tool_calls as one complete field on
   * its last chunk, never incrementally, so we do not fake a token
   * stream for THAT part. But a reasoning model's chain-of-thought
   * (and any pre-tool-call commentary) genuinely does arrive as
   * incremental deltas beforehand, so onThinking surfaces those live
   * instead of leaving the caller blind until the whole turn resolves —
   * on slow hardware that silent gap is most of the turn's wall clock.
   * Returns any assistant text plus the tool calls the model wants
   * executed (empty array ⇒ the model produced its final answer).
   */
  chatWithTools?(
    messages: ChatTurn[],
    tools: ToolDefinition[],
    options: ToolChatOptions,
    onThinking?: (delta: string) => void,
  ): Promise<ToolChatResult>;

  /**
   * The context window (in tokens) of the CURRENTLY LOADED instance of a
   * model — the effective runtime num_ctx, not the architecture maximum.
   * Ollama reports this via /api/ps for loaded models. Undefined when the
   * model is not loaded or the provider cannot report it; callers must
   * surface that as "unknown" rather than substituting a guess.
   */
  getLoadedContextWindow?(modelId: string): Promise<number | undefined>;
}
