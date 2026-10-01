// ============================================================
// BaseAgent — Abstract base class for all Luminary OS agents.
//
// Provides shared scaffolding so concrete agents only need to
// implement canHandle() and declare a system prompt. Model
// resolution is dynamic: the user-assigned model (persisted in
// AgentModelStore) wins; otherwise the first model installed in
// Ollama is used. No model names are hardcoded.
// ============================================================

import { randomUUID } from 'crypto';
import fs from 'fs';
import type {
  IAgent,
  AgentRequest,
  AgentResponse,
  AgentStatus,
  AgentCapability,
  AgentMetadata,
  PendingConfirmation,
} from '../core/types/IAgent';
import type { ModelRegistry } from '../core/registry/ModelRegistry';
import type { IModelProvider, ChatTurn, ToolCall } from '../core/types/IModelProvider';
import type { IPlugin, PluginResult } from '../core/types/IPlugin';
import type { ModelSummary } from '../services/ModelService';
import { pluginRegistry } from '../core/registry/PluginRegistry';
import {
  identityFilePath, memoriesFilePath, ensureIdentityFile, ensureMemoriesFile, STARTER_IDENTITY,
} from '../core/identity/paths';
import { agentModelStore } from '../services/AgentModelStore';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { Logger } from '../core/logger/Logger';

/** A resolved model + the provider that owns it (from ModelService). */
type ResolvedOwner = { provider: IModelProvider; model: ModelSummary };

/** A tool call parked awaiting user approval. */
interface PendingToolCall {
  /** Server-generated approval token echoed back in confirmedToolCallIds. */
  confirmationId: string;
  call: ToolCall;
  pluginId: string;
  action: string;
}

/**
 * Frozen, JSON-serialisable state of a tool loop paused for confirmation.
 * Holds the full conversation so far (system + user + every assistant/tool
 * turn, including results already executed this turn) so a resume — even
 * after a process restart — continues exactly where it stopped rather than
 * re-running the model from scratch.
 */
interface PersistedTurn {
  agentId: string;
  sessionId: string;
  messages: ChatTurn[];
  pending: PendingToolCall[];
  pluginsUsed: string[];
  promptTokens: number;
  completionTokens: number;
  iterationsUsed: number;
  createdAt: number;
}

/**
 * Storage for paused turns, keyed by each pending call's confirmation
 * token; values are opaque JSON. The default is process-local (lost on
 * restart). Kernel swaps in a SQLite-backed store so a pending
 * confirmation survives a restart. Structural — any object with these
 * three methods qualifies.
 */
export interface PendingTurnStore {
  put(id: string, json: string, expiresAt: number): void;
  get(id: string): string | null;
  deleteMany(ids: string[]): void;
}

class InMemoryPendingTurnStore implements PendingTurnStore {
  private map = new Map<string, { json: string; expiresAt: number }>();
  put(id: string, json: string, expiresAt: number): void { this.map.set(id, { json, expiresAt }); }
  get(id: string): string | null {
    const r = this.map.get(id);
    if (!r) return null;
    if (r.expiresAt <= Date.now()) { this.map.delete(id); return null; }
    return r.json;
  }
  deleteMany(ids: string[]): void { for (const id of ids) this.map.delete(id); }
}

const PENDING_TTL_MS = 15 * 60 * 1000; // stale approvals are dropped after 15 min

// ── Streaming events ──────────────────────────────────────────────
// One loop, two output modes: execute() without options behaves exactly
// as before (single awaited AgentResponse); with opts.onEvent it emits
// these as the SAME loop runs. Tool-call turns arrive from Ollama as one
// assembled message (never chunked), so tool events and tool-turn text
// are emitted whole — only genuine token streams produce many deltas.

export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_started'; plugin: string; action: string; args: Record<string, unknown> }
  | { type: 'tool_call_result'; plugin: string; action: string; success: boolean; summary: string }
  | { type: 'pending_confirmation'; id: string; plugin: string; action: string; args: Record<string, unknown> }
  | { type: 'done'; response: AgentResponse };

export interface AgentExecuteOptions {
  /** Emit structured events as the turn runs. Absent ⇒ non-streaming. */
  onEvent?: (event: AgentStreamEvent) => void;
  /** Abort the in-flight model call / tool loop (user Stop, client gone). */
  signal?: AbortSignal;
  /** Sampling temperature (0–2); omitted → provider default. */
  temperature?: number;
  /** Context window (num_ctx) for providers that support it. */
  contextLength?: number;
  /**
   * Continue/prefill mode (plain path only): the conversation history
   * already ends with the assistant turn to extend, so no user turn is
   * appended. Callers guarantee the trailing-assistant invariant.
   */
  continueTurn?: boolean;
}

/** Compact, honest one-line summary of a tool result for stream events. */
function summariseToolResult(result: PluginResult): string {
  if (!result.success) return String(result.error ?? 'failed');
  try {
    const s = JSON.stringify(result.data ?? {});
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return 'ok';
  }
}

/** A tool call that actually ran to completion this turn, with its summary. */
interface CompletedTool {
  action: string;
  success: boolean;
  summary: string;
}

/**
 * Honest, human-readable note for a turn cut short (timeout, user Stop, or
 * iteration-cap exhaustion). It states plainly what was accomplished before
 * stopping. Because this becomes the aborted assistant message's content, it
 * is what a follow-up turn reads back as context — so the completed tool
 * calls and their real results survive the interruption instead of being
 * lost. Never fabricates: an empty `completed` says nothing was done.
 */
function interruptionNote(reason: string, completed: CompletedTool[]): string {
  const header = `⏱ I stopped before finishing this turn — ${reason}.`;
  if (completed.length === 0) {
    return `${header}\n\nNo tool calls had completed yet, so nothing was changed. ` +
      'Send another message (for example “continue”) and I’ll pick this up.';
  }
  const lines = completed
    .map((c) => `- \`${c.action}\` → ${c.success ? 'succeeded' : 'failed'}: ${c.summary}`)
    .join('\n');
  return `${header}\n\nCompleted before stopping (this is real and has been saved):\n${lines}\n\n` +
    'Send another message (for example “continue”) and I’ll build on the work above rather than starting over.';
}

// ── Working-memory injection constants ────────────────────────────
// Exported so SystemInfoService reports these EXACT values — never a
// second hardcoded copy that could silently drift from what
// retrieveMemoryBlock() actually uses.
/** Max memories auto-injected into a turn's system prompt. */
export const MEMORY_INJECTION_TOP_K = 5;
/** Byte cap on the auto-injected "Relevant memory" block. */
export const MEMORY_INJECTION_MAX_BYTES = 2048;

let pendingStore: PendingTurnStore = new InMemoryPendingTurnStore();
/** Kernel calls this at boot to make paused turns survive a restart. */
export function setPendingTurnStore(store: PendingTurnStore): void { pendingStore = store; }

function readPersistedTurn(json: string): PersistedTurn | null {
  try {
    const state = JSON.parse(json) as PersistedTurn | null;
    if (!state || typeof state.agentId !== 'string' || typeof state.sessionId !== 'string' ||
      !Number.isFinite(state.createdAt) || Date.now() - state.createdAt > PENDING_TTL_MS || state.createdAt > Date.now() ||
      !Array.isArray(state.messages) || !Array.isArray(state.pluginsUsed) ||
      !state.pluginsUsed.every(p => typeof p === 'string') ||
      ![state.promptTokens, state.completionTokens, state.iterationsUsed].every(n => Number.isFinite(n) && n >= 0) ||
      !Array.isArray(state.pending) || state.pending.length === 0 ||
      !state.pending.every(p => p && typeof p.confirmationId === 'string' && typeof p.pluginId === 'string' && typeof p.action === 'string' &&
        p.call && typeof p.call.id === 'string' && typeof p.call.name === 'string' && p.call.arguments && typeof p.call.arguments === 'object' && !Array.isArray(p.call.arguments))) return null;
    return state;
  } catch { return null; }
}

/** Revoke the whole paused turn on denial, only for its owning conversation. */
export function denyPendingConfirmations(sessionId: string, ids: string[]): void {
  for (const id of ids) {
    const json = pendingStore.get(id);
    if (!json) continue;
    const state = readPersistedTurn(json);
    if (!state) { pendingStore.deleteMany([id]); continue; }
    if (state.sessionId !== sessionId) throw new Error('Confirmation belongs to another conversation.');
    pendingStore.deleteMany(state.pending.map(p => p.confirmationId));
  }
}

// ── Lumen identity (loaded once, prepended to every system prompt) ──
// The file lives in backend/data/identity/ (durable, survives rebuilds).
// Its location and first-boot seeding/migration live in core/identity/paths.
let identityCache: string | null = null;

/**
 * Load Lumen's identity once, seeding the file if none exists — migrating
 * any pre-move copy rather than losing it (never overwrites an existing
 * one). Cached for the process lifetime. Kernel calls this at boot; agents
 * read the cache when composing their system prompt.
 */
export function loadLumenIdentity(): string {
  if (identityCache !== null) return identityCache;
  try {
    ensureIdentityFile(); // create-or-migrate, never clobber
    identityCache = fs.readFileSync(identityFilePath(), 'utf8').trim();
  } catch {
    // Identity is guidance, not gating — fall back to the starter text
    // in memory rather than crash if the file can't be read.
    identityCache = STARTER_IDENTITY.trim();
  }
  return identityCache;
}

// ── Curated memories (MEMORIES.md) ────────────────────────────────
// A SECOND, separate mechanism from the semantic memory search (SQLite +
// embeddings): a tiny hand-curated file read IN FULL every session, like
// LUMEN.md. It holds the handful of facts that should always be present
// with no search needed. The ONLY writer is the /remember command (see
// ChatService); it is protected from every plugin, exactly like LUMEN.md.
let curatedMemoriesCache: string | null = null;

/** ~4 KB soft cap. Over this, boot warns to prune — never truncates, never blocks writes. */
export const MEMORIES_SOFT_CAP_BYTES = 4096;

/**
 * Load the curated memories once, seeding the file if none exists —
 * migrating any pre-move copy rather than losing it (never overwrites an
 * existing one). Cached for the process lifetime; the /remember append
 * path refreshes the cache so a new fact is in context on the very next
 * turn without a restart. Warns (does not truncate) past the soft cap.
 */
export function loadCuratedMemories(): string {
  if (curatedMemoriesCache !== null) return curatedMemoriesCache;
  try {
    ensureMemoriesFile(); // create-or-migrate, never clobber
    curatedMemoriesCache = fs.readFileSync(memoriesFilePath(), 'utf8').trim();
    const bytes = Buffer.byteLength(curatedMemoriesCache, 'utf8');
    if (bytes > MEMORIES_SOFT_CAP_BYTES) {
      Logger.scope('BaseAgent').warn(
        `MEMORIES.md is ${bytes} bytes (over the ~${MEMORIES_SOFT_CAP_BYTES}-byte soft cap). ` +
        'It is loaded in full into every prompt — consider pruning it. (Not truncated; writes still allowed.)',
      );
    }
  } catch {
    // Curated memory is guidance, not gating — never crash a turn over it.
    curatedMemoriesCache = '';
  }
  return curatedMemoriesCache;
}

/**
 * Append one curated fact as a new line and refresh the in-memory cache so
 * it takes effect immediately. This is the SOLE writer of MEMORIES.md (the
 * /remember command routes here); no plugin can reach the file. Returns an
 * honest ok/error — never throws into the caller.
 */
export function appendCuratedMemory(text: string): { ok: true; bytes: number } | { ok: false; error: string } {
  const line = text.trim();
  if (!line) return { ok: false, error: 'Nothing to remember — the note was empty.' };
  const p = memoriesFilePath();
  try {
    // Seed/migrate first, so the very first /remember on a fresh install
    // appends to a real file at the durable location instead of creating
    // a bare one that would later block migration of pre-move content.
    ensureMemoriesFile();
    const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(p, `${sep}- ${line}\n`, { encoding: 'utf8' });
    curatedMemoriesCache = null; // force reload
    const reloaded = loadCuratedMemories();
    return { ok: true, bytes: Buffer.byteLength(reloaded, 'utf8') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export abstract class BaseAgent implements IAgent {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly role: string;
  abstract readonly capabilities: AgentCapability[];
  abstract readonly description: string;
  /** System prompt that shapes this agent's behaviour. */
  abstract readonly systemPrompt: string;

  /**
   * Plugin IDs this agent is permitted to invoke as tools. Empty (the
   * default) means no tools: the agent takes the plain single-call
   * path, byte-for-byte as it did before the tool-use loop existed.
   * Subclasses opt in (e.g. CodingAgent → ['terminal-plugin']).
   */
  protected readonly allowedPlugins: string[] = [];

  /** Read-only view of allowedPlugins for introspection (e.g. SystemInfoService). */
  getAllowedPlugins(): string[] {
    return [...this.allowedPlugins];
  }

  /**
   * Max model⇄tool round-trips before the loop aborts honestly. Read
   * lazily (NOT cached in a static field): server.ts imports Kernel —
   * which imports this module via the concrete agent classes — before it
   * calls dotenv.config(), so a value frozen at class-definition time
   * would always see an unset env var and silently fall back to the
   * default, regardless of what .env actually says. Reading inside the
   * method that's called at request time guarantees dotenv has already
   * run. Mirrors the same fix already applied in
   * SqliteMemoryProvider.minSimilarityFloor().
   */
  private static maxToolIterations(): number {
    return Math.max(1, Number(process.env.AGENT_MAX_TOOL_ITERATIONS) || 15);
  }
  /**
   * Total wall-clock budget for a tool loop, in milliseconds. Default 30 min
   * — real observed speed here is ~1.9 tok/s (qwen3:8b), so a multi-step tool
   * loop needs a generous budget. Env-tunable; same lazy-read reasoning as
   * maxToolIterations(). Hitting this no longer discards work — the loop
   * returns its partial progress (see finishInterrupted).
   */
  private static toolWallClockMs(): number {
    return Math.max(1_000, Number(process.env.AGENT_TOOL_TIMEOUT_MS) || 1_800_000);
  }
  /**
   * How many times a *transient* tool failure is automatically retried
   * before the result is surfaced to the model. Same lazy-read reasoning
   * as maxToolIterations(). Default 2 (so a transient call is attempted up
   * to 3 times total). These retries happen INSIDE a single tool call and
   * do NOT consume extra loop iterations.
   */
  private static maxToolRetries(): number {
    return Math.max(0, Number(process.env.AGENT_TOOL_RETRY_LIMIT) || 2);
  }

  /**
   * Substrings that mark a failure as transient — i.e. something that
   * could plausibly succeed on a second attempt (network blips, timeouts,
   * upstream 5xx / rate-limits). This is a strict allow-list: a failure is
   * retried ONLY when its message clearly matches one of these. Everything
   * else — path traversal, disallowed command, sandbox escape, bad
   * arguments, "not permitted", a missing API key — is deterministic and
   * would fail identically every time, so it is surfaced to the model
   * immediately and NEVER retried.
   */
  private static readonly TRANSIENT_ERROR_SIGNATURES = [
    'timeout', 'timed out', 'etimedout', 'timeouterror',
    'network', 'fetch failed', 'failed to reach', 'failed to fetch',
    'econnreset', 'econnrefused', 'econnaborted', 'enotfound', 'eai_again',
    'socket hang up', 'connection reset', 'connection refused',
    'temporarily unavailable', 'rate limit', 'too many requests',
    'http 429', 'http 500', 'http 502', 'http 503', 'http 504',
    'service unavailable', 'bad gateway', 'gateway timeout',
  ];

  /** True only for failures that could plausibly succeed if retried. */
  private static isTransientFailure(result: PluginResult): boolean {
    if (result.success) return false;
    const msg = String(result.error ?? '').toLowerCase();
    if (!msg) return false;
    return BaseAgent.TRANSIENT_ERROR_SIGNATURES.some((sig) => msg.includes(sig));
  }

  /** Short escalating backoff between transient retries (250ms, 500ms, …). */
  private static retryBackoffMs(attempt: number): number {
    return Math.min(2_000, 250 * attempt);
  }

  private _status: AgentStatus = 'idle';
  private _activeTasks = 0;
  protected readonly logger: Logger;
  protected readonly modelRegistry: ModelRegistry;

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
    // Logger is constructed after subclass fields are set via this pattern
    this.logger = Logger.scope(this.constructor.name);
  }

  // ── Abstract methods — subclasses must implement ─────────
  abstract canHandle(request: AgentRequest): boolean;

  /**
   * Default execution: run the request through the assigned
   * local model with this agent's system prompt. Subclasses can
   * override for plugin-driven behaviour.
   *
   * With opts.onEvent this same code path streams: text deltas as they
   * arrive, tool events as the loop runs, pending confirmations when it
   * gates, and a final done. Without opts nothing changes — same loop,
   * one implementation, two output modes.
   */
  async execute(request: AgentRequest, opts?: AgentExecuteOptions): Promise<AgentResponse> {
    // Imported lazily to avoid a module-load cycle (services ↔ agents)
    const { modelService } = await import('../services/ModelService');
    this.beginTask();
    this.logger.info('Executing', { requestId: request.id });
    try {
      const modelId = await this.resolveModel();
      const owner = await modelService.findOwner(modelId);
      if (!owner) throw new Error(`Model "${modelId}" is not available from any provider.`);
      if (owner.model.runnable === false) {
        throw new Error(`Model "${owner.model.name}" cannot run: the GGUF runtime is unavailable.`);
      }

      // Compose the effective system prompt for THIS turn: Lumen's identity
      // first, then the agent's role prompt, then a real "System status"
      // block, then a "Relevant memory" block recalled from the user's
      // message. This happens for EVERY agent — including tool-less ones —
      // because it is context, not a tool call. A resume reuses the saved
      // conversation, so skip re-injection then.
      const isResume = (request.confirmedToolCallIds?.length ?? 0) > 0;
      const systemPrompt = await this.buildSystemPrompt(request, isResume, owner);

      // Tool-use path: taken ONLY when this agent declares plugins AND
      // the owning provider can actually do tool calling. Any other case
      // (no declared plugins, or a provider without tool support such as
      // the GGUF LocalProvider) degrades to the unchanged single call
      // below — no tools are silently dropped, none are faked.
      const providerSupportsTools =
        typeof owner.provider.chatWithTools === 'function' &&
        owner.provider.supportsTools?.() === true;

      // Honesty guard: this agent's role prompt promises tools ("exec",
      // "write", "search", …), but the resolved provider cannot do
      // structured tool calling (e.g. the GGUF LocalProvider). Without
      // an explicit override the model ROLEPLAYS its missing tools —
      // narrating fake "[exec] …" output and claiming files were written
      // — and that narration streams to the user as if it were real.
      // Tell the model plainly its tools are off this turn, and mark the
      // response so callers can see the turn ran degraded.
      const toolsUnavailable = this.allowedPlugins.length > 0 && !providerSupportsTools;
      let effectiveSystemPrompt = systemPrompt;
      if (toolsUnavailable) {
        this.logger.warn(
          `${this.name} declares tools but provider "${owner.provider.id}" cannot do structured tool calling — tools disabled this turn`,
          { requestId: request.id, model: owner.model.id },
        );
        effectiveSystemPrompt +=
          '\n\n## Tool access notice (authoritative)\n' +
          `Your tools are NOT available for this turn: the current model provider ("${owner.provider.id}") ` +
          'does not support structured tool calling. You cannot run commands, write or read files, or ' +
          'search the web right now. Do NOT pretend to invoke tools, do NOT print fake tool output, and ' +
          'do NOT claim any action was performed. If the request requires such an action, state honestly ' +
          'that it needs a tool-capable model (for example an Ollama model such as qwen2.5 or llama3.1) ' +
          'assigned to this agent, and offer whatever help you can give without tools.';
      }

      let response: AgentResponse;

      if (this.allowedPlugins.length > 0 && providerSupportsTools) {
        response = await this.executeWithTools(request, owner, systemPrompt, opts);
      } else if (owner.provider.chatStream) {
        // Plain path — history-aware via chatStream (the same call Chat
        // mode's own streaming path makes) instead of complete()'s single
        // free-floating prompt, so this agent sees prior turns too.
        // complete() remains the fallback for a provider that only
        // implements the required interface members.
        const priorTurns = await this.loadPriorTurns(request);
        const messages: ChatTurn[] = [
          { role: 'system', content: effectiveSystemPrompt },
          ...priorTurns,
        ];
        // Continue/prefill: history already ends with the assistant turn
        // to extend; appending a user turn would break the prefill.
        if (!opts?.continueTurn) messages.push({ role: 'user', content: request.content });
        const streamed = await owner.provider.chatStream(
          messages,
          {
            model: owner.model.remoteId ?? owner.model.id,
            signal: opts?.signal,
            temperature: opts?.temperature,
            contextLength: opts?.contextLength,
          },
          (token) => opts?.onEvent?.({ type: 'text_delta', text: token }),
        );
        response = {
          requestId: request.id,
          agentId: this.id,
          agentName: this.name,
          content: streamed.content,
          model: streamed.model,
          metadata: {
            promptTokens: streamed.promptTokens,
            completionTokens: streamed.completionTokens,
            // Single model call ⇒ the "last" call is the only call.
            lastPromptTokens: streamed.promptTokens,
            lastCompletionTokens: streamed.completionTokens,
            durationMs: streamed.durationMs,
            tokensPerSecond: streamed.tokensPerSecond,
            aborted: streamed.aborted || undefined,
            toolsUnavailable: toolsUnavailable || undefined,
          },
          timestamp: new Date().toISOString(),
        };
      } else {
        const result = await owner.provider.complete(request.content, {
          model: owner.model.remoteId ?? owner.model.id,
          systemPrompt: effectiveSystemPrompt,
        });
        // complete() has no token callback — emit the reply as one
        // honest delta rather than faking a token stream.
        if (result.content) opts?.onEvent?.({ type: 'text_delta', text: result.content });
        response = {
          requestId: request.id,
          agentId: this.id,
          agentName: this.name,
          content: result.content,
          model: result.model,
          metadata: {
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            toolsUnavailable: toolsUnavailable || undefined,
          },
          timestamp: new Date().toISOString(),
        };
      }

      // A pause for confirmation is a halt, not a completion — its
      // pending_confirmation events were already emitted; done only
      // fires for a finished turn.
      if (!(response.pendingConfirmations?.length)) {
        opts?.onEvent?.({ type: 'done', response });
      }
      return response;
    } finally {
      this.endTask();
    }
  }

  // ── Tool-use loop ─────────────────────────────────────────────

  /**
   * Agentic loop: the model proposes tool calls, we execute each against
   * the agent's *declared* plugins, feed the real results back, and call
   * the model again — until it answers with no further tool calls.
   *
   * Guarantees:
   *  - Bounded: at most MAX_TOOL_ITERATIONS round-trips and
   *    TOOL_WALL_CLOCK_MS wall-clock; exceeding either throws an honest
   *    error naming the limit. The wall-clock also aborts any in-flight
   *    model request through a shared AbortController.
   *  - Honest: a tool that fails (success:false) or throws is fed back to
   *    the model verbatim as its tool result — never fabricated into a
   *    plausible success. A *transient* failure (network/timeout/upstream
   *    5xx) is first retried automatically a few times (see
   *    invokeToolWithRetry); if it still fails, that real failure is what
   *    the model sees. Validation/security failures are never retried.
   *  - Scoped: a tool call only resolves against this.allowedPlugins; a
   *    name outside that set comes back as an honest "not available".
   *  - Gated: a capability marked requiresConfirmation is NOT executed on
   *    its own. The loop pauses and returns pendingConfirmations; the
   *    caller must approve (echo the id in confirmedToolCallIds) and
   *    resend to resume from the exact saved state.
   */
  private async executeWithTools(
    request: AgentRequest,
    owner: ResolvedOwner,
    systemPrompt: string,
    opts?: AgentExecuteOptions,
  ): Promise<AgentResponse> {
    const tools = pluginRegistry.toolDefinitions(this.allowedPlugins);
    const confirmed = new Set(request.confirmedToolCallIds ?? []);

    const maxIterations = BaseAgent.maxToolIterations();
    const wallClockMs = BaseAgent.toolWallClockMs();
    const deadline = Date.now() + wallClockMs;

    // A single controller both enforces the wall-clock and lets an
    // in-flight model call be cancelled the instant the budget is spent.
    // A caller-provided signal (user Stop / client disconnect) feeds the
    // same controller, so the loop dies with the caller instead of
    // burning the model with nobody listening.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), wallClockMs);
    const onCallerAbort = () => abort.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) abort.abort();
      else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    // Ollama assembles tool-turn text as one message (never chunked), so
    // each block is emitted whole — one honest delta per block, with a
    // paragraph break between blocks, never a fake token stream. We also
    // accumulate every emitted block into `assembledText` so an aborted
    // turn can return exactly what the user saw (streaming callers) OR the
    // full text (non-streaming callers) rather than losing it.
    let assembledText = '';
    const emitText = (text: string) => {
      if (!text) return;
      const chunk = (assembledText ? '\n\n' : '') + text;
      assembledText += chunk;
      opts?.onEvent?.({ type: 'text_delta', text: chunk });
    };
    // Real tool calls that actually completed this turn (with their honest
    // result summaries), so an abort can report — and persist — precisely
    // what was accomplished before time ran out.
    const completed: CompletedTool[] = [];
    const emitToolEvents = async (call: ToolCall, pluginId: string): Promise<PluginResult> => {
      opts?.onEvent?.({ type: 'tool_call_started', plugin: pluginId, action: call.name, args: call.arguments ?? {} });
      const result = await this.invokeToolWithRetry(request, call, pluginsUsed, deadline, abort.signal);
      const summary = summariseToolResult(result);
      opts?.onEvent?.({ type: 'tool_call_result', plugin: pluginId, action: call.name, success: result.success, summary });
      completed.push({ action: call.name, success: result.success, summary });
      return result;
    };

    // Build a graceful partial response for an interrupted turn (wall-clock
    // timeout, user Stop, or iteration-cap exhaustion) INSTEAD of throwing
    // and discarding everything. It emits an honest note stating what was
    // completed — which both surfaces to the user and, because it becomes
    // the assistant message's content, lands in persisted history so a
    // follow-up turn has real context of the attempt.
    const finishInterrupted = (reason: string, partialText?: string): AgentResponse => {
      if (partialText) emitText(partialText);
      emitText(interruptionNote(reason, completed));
      return {
        requestId: request.id,
        agentId: this.id,
        agentName: this.name,
        content: assembledText,
        model: owner.model.id,
        pluginsUsed: [...pluginsUsed],
        metadata: {
          promptTokens,
          completionTokens,
          lastPromptTokens,
          lastCompletionTokens,
          toolIterations: iteration,
          aborted: true,
        },
        timestamp: new Date().toISOString(),
      };
    };

    // Loop-carried state — restored from a paused turn on resume.
    let messages: ChatTurn[];
    const pluginsUsed = new Set<string>();
    let promptTokens = 0;
    let completionTokens = 0;
    // The FINAL model call's own counts (not the loop-wide sums above):
    // its prompt is the one whose size reflects what the context actually
    // holds at the end of the turn, which context accounting needs —
    // summed counts double-count every re-sent prefix across iterations.
    let lastPromptTokens: number | undefined;
    let lastCompletionTokens: number | undefined;
    let iteration = 0;

    try {
      // ── Resume path: pick up a turn that was paused for approval ──
      const resumed = this.takeResumableTurn(confirmed, request.sessionId);
      if (resumed) {
        messages = resumed.messages;
        resumed.pluginsUsed.forEach((p) => pluginsUsed.add(p));
        promptTokens = resumed.promptTokens;
        completionTokens = resumed.completionTokens;
        iteration = resumed.iterationsUsed;
        this.logger.info('Resuming paused tool turn', { requestId: request.id, approved: [...confirmed] });

        // Run the now-approved calls; anything still unapproved re-pauses.
        const stillPending: PendingToolCall[] = [];
        for (const p of resumed.pending) {
          if (confirmed.has(p.confirmationId)) {
            const result = await emitToolEvents(p.call, p.pluginId);
            messages.push({ role: 'tool', toolName: p.call.name, toolCallId: p.call.id, content: JSON.stringify(result) });
          } else {
            stillPending.push(p);
          }
        }
        if (stillPending.length > 0) {
          return this.pauseForConfirmation(request, owner, messages, stillPending, pluginsUsed, promptTokens, completionTokens, iteration, opts);
        }
        // else fall through and call the model again with the results
      } else {
        const priorTurns = await this.loadPriorTurns(request);
        messages = [
          { role: 'system', content: systemPrompt },
          ...priorTurns,
          { role: 'user', content: request.content },
        ];
        if (confirmed.size > 0) {
          this.logger.warn('confirmedToolCallIds present but no matching paused turn — starting fresh', { requestId: request.id });
        }
      }

      // ── Main loop ──
      while (iteration < maxIterations) {
        if (Date.now() >= deadline) {
          this.logger.warn(
            `Tool loop for ${this.name} hit its ${wallClockMs}ms wall-clock limit after ${iteration} iteration(s); returning partial progress`,
            { requestId: request.id, completedTools: completed.length },
          );
          return finishInterrupted(`the ${wallClockMs}ms time limit was reached`);
        }
        iteration++;

        const turn = await owner.provider.chatWithTools!(
          messages,
          tools,
          {
            model: owner.model.remoteId ?? owner.model.id,
            signal: abort.signal,
            temperature: opts?.temperature,
            contextLength: opts?.contextLength,
          },
          (delta) => opts?.onEvent?.({ type: 'thinking_delta', text: delta }),
        );
        promptTokens += turn.promptTokens ?? 0;
        completionTokens += turn.completionTokens ?? 0;
        lastPromptTokens = turn.promptTokens ?? lastPromptTokens;
        lastCompletionTokens = turn.completionTokens ?? lastCompletionTokens;

        if (turn.aborted) {
          // A model call cut short — by the user's Stop or the wall-clock.
          // Return what completed rather than throwing it all away; the
          // partial model text (if any) is included in the saved note.
          const reason = opts?.signal?.aborted ? 'you stopped it' : `the ${wallClockMs}ms time limit was reached`;
          this.logger.warn(
            `Tool loop for ${this.name} interrupted mid-call (${reason}); returning partial progress`,
            { requestId: request.id, completedTools: completed.length },
          );
          return finishInterrupted(reason, turn.content);
        }

        // No tool calls ⇒ the model produced its final answer.
        if (turn.toolCalls.length === 0) {
          this.logger.info('Tool loop complete', { requestId: request.id, iterations: iteration, pluginsUsed: [...pluginsUsed] });
          emitText(turn.content);
          return this.toolResponse(request, owner, turn.content, pluginsUsed, {
            promptTokens, completionTokens, lastPromptTokens, lastCompletionTokens, iterations: iteration,
          });
        }

        // Record the assistant's tool-call turn, then handle each call:
        // execute safe ones inline, gate the ones needing confirmation.
        messages.push({ role: 'assistant', content: turn.content ?? '', toolCalls: turn.toolCalls });
        emitText(turn.content ?? '');
        const pending: PendingToolCall[] = [];
        for (const call of turn.toolCalls) {
          const plugin = this.resolvePlugin(call.name);
          if (plugin && this.capabilityRequiresConfirmation(plugin, call.name)) {
            // Needs approval. Fresh model-proposed calls are never
            // pre-approved (approval only ever arrives via the resume
            // path above), so we always park it and pause.
            pending.push({ confirmationId: randomUUID(), call, pluginId: plugin.manifest.id, action: call.name });
          } else {
            const result = await emitToolEvents(call, plugin?.manifest.id ?? 'unavailable');
            messages.push({ role: 'tool', toolName: call.name, toolCallId: call.id, content: JSON.stringify(result) });
          }
        }

        if (pending.length > 0) {
          return this.pauseForConfirmation(request, owner, messages, pending, pluginsUsed, promptTokens, completionTokens, iteration, opts);
        }
      }

      // Iteration cap reached without a final answer. Same principle as a
      // timeout: return the real partial progress instead of discarding it.
      // (The cap value/logic is unchanged — only how exhaustion is reported.)
      this.logger.warn(
        `Tool loop for ${this.name} did not converge within ${maxIterations} iterations; returning partial progress`,
        { requestId: request.id, completedTools: completed.length },
      );
      return finishInterrupted(`the ${maxIterations}-iteration limit was reached`);
    } finally {
      clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  /**
   * Resolve and run a single tool call against the agent's declared
   * plugins. Returns a PluginResult in every case — a failure or thrown
   * error becomes { success:false, error } so the model sees the truth.
   * This is the sole execution step; the loop and the resume path both
   * go through here, so nothing runs a tool without this gate having
   * already decided it may.
   */
  private async invokeTool(
    request: AgentRequest,
    call: ToolCall,
    pluginsUsed: Set<string>,
  ): Promise<PluginResult> {
    const plugin = this.resolvePlugin(call.name);
    if (!plugin) {
      this.logger.warn(`Tool "${call.name}" not available to ${this.name}`, { requestId: request.id });
      return { success: false, error: `Tool "${call.name}" is not available to ${this.name}.` };
    }

    pluginsUsed.add(plugin.manifest.id);
    // NOTE: a dedicated EVENTS.PLUGIN_INVOKED bus event would live here for
    // UI/audit — deferred: adding the constant is outside this milestone's
    // file scope (EventBus.ts). The structured log below is the audit trail.
    this.logger.info(`Invoking tool ${plugin.manifest.id}/${call.name}`, { requestId: request.id });

    try {
      return await plugin.execute({
        action: call.name,
        payload: call.arguments ?? {},
        requestId: request.id,
        agentId: this.id,
      });
    } catch (err) {
      // A plugin throwing is still a real result — surface it, don't swallow.
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Run a tool call, automatically retrying ONLY transient failures
   * (network/timeout/upstream-5xx) up to maxToolRetries() times with a
   * short backoff before giving up. Validation/security failures (path
   * traversal, disallowed command, sandbox escape, bad args) are NOT
   * transient, so they are returned on the first attempt and surfaced to
   * the model immediately — retrying them would waste the loop's budget on
   * something that fails identically every time.
   *
   * These retries live inside one tool call: they do NOT advance the loop's
   * iteration counter (so they never buy extra model round-trips), and they
   * respect the loop's wall-clock deadline and abort signal — a retry is
   * skipped if the deadline is reached or the turn is aborted. Whether it
   * succeeds or exhausts its retries, the FINAL PluginResult is returned
   * verbatim, so a genuine failure is still fed back to the model honestly.
   */
  private async invokeToolWithRetry(
    request: AgentRequest,
    call: ToolCall,
    pluginsUsed: Set<string>,
    deadline: number,
    signal: AbortSignal,
  ): Promise<PluginResult> {
    const maxRetries = BaseAgent.maxToolRetries();
    let result = await this.invokeTool(request, call, pluginsUsed);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!BaseAgent.isTransientFailure(result)) break; // permanent failure or success — stop
      if (signal.aborted) break;                        // user Stop / wall-clock abort
      const backoff = BaseAgent.retryBackoffMs(attempt);
      if (Date.now() + backoff >= deadline) break;      // no time left to retry within budget

      this.logger.info(
        `Transient tool failure on ${call.name}; retrying (${attempt}/${maxRetries}) after ${backoff}ms`,
        { requestId: request.id, error: result.error },
      );
      await this.sleep(backoff, signal);
      if (signal.aborted) break;
      result = await this.invokeTool(request, call, pluginsUsed);
    }

    return result;
  }

  /** Abortable sleep — resolves early (never rejects) if the signal fires. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const onAbort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** The plugin this agent may use for a capability action, if any. */
  private resolvePlugin(action: string): IPlugin | undefined {
    return pluginRegistry
      .findByCapability(action)
      .find((p) => this.allowedPlugins.includes(p.manifest.id));
  }

  /** Whether a plugin's capability is flagged requiresConfirmation. */
  private capabilityRequiresConfirmation(plugin: IPlugin, action: string): boolean {
    return plugin.manifest.capabilities.find((c) => c.action === action)?.requiresConfirmation === true;
  }

  /**
   * Freeze the in-progress turn, register each pending call under its
   * confirmation token, and return pendingConfirmations. No further model
   * calls happen this turn — the caller approves and resends to resume.
   */
  private pauseForConfirmation(
    request: AgentRequest,
    owner: ResolvedOwner,
    messages: ChatTurn[],
    pending: PendingToolCall[],
    pluginsUsed: Set<string>,
    promptTokens: number,
    completionTokens: number,
    iteration: number,
    opts?: AgentExecuteOptions,
  ): AgentResponse {
    // Freeze as JSON and register under each pending token. Persisted via
    // the (possibly SQLite-backed) store, so this survives a restart.
    const persisted: PersistedTurn = {
      agentId: this.id,
      sessionId: request.sessionId,
      messages,
      pending,
      pluginsUsed: [...pluginsUsed],
      promptTokens,
      completionTokens,
      iterationsUsed: iteration,
      createdAt: Date.now(),
    };
    const json = JSON.stringify(persisted);
    const expiresAt = Date.now() + PENDING_TTL_MS;
    for (const p of pending) pendingStore.put(p.confirmationId, json, expiresAt);

    const pendingConfirmations: PendingConfirmation[] = pending.map((p) => ({
      id: p.confirmationId,
      plugin: p.pluginId,
      action: p.action,
      args: p.call.arguments ?? {},
    }));
    for (const c of pendingConfirmations) {
      opts?.onEvent?.({ type: 'pending_confirmation', ...c });
    }
    this.logger.info('Tool loop paused for confirmation', {
      requestId: request.id,
      pending: pendingConfirmations.map((c) => `${c.plugin}/${c.action}#${c.id}`),
    });

    return {
      requestId: request.id,
      agentId: this.id,
      agentName: this.name,
      content: '', // no final answer yet — awaiting approval
      model: owner.model.id,
      pluginsUsed: [...pluginsUsed],
      pendingConfirmations,
      metadata: {
        promptTokens,
        completionTokens,
        toolIterations: iteration,
        awaitingConfirmation: true,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /** Find and detach a paused turn matching any approved confirmation id. */
  private takeResumableTurn(confirmed: Set<string>, sessionId: string): PersistedTurn | null {
    for (const id of confirmed) {
      const json = pendingStore.get(id);
      if (!json) continue;
      const state = readPersistedTurn(json);
      if (!state) continue;
      if (state.agentId !== this.id || state.sessionId !== sessionId) continue;
      if (![...confirmed].every(token => state.pending.some(p => p.confirmationId === token))) continue;
      // Detach every token pointing at this turn; unapproved calls get
      // re-registered by pauseForConfirmation if we pause again.
      pendingStore.deleteMany(state.pending.map((p) => p.confirmationId));
      return state;
    }
    if (confirmed.size > 0) throw new Error('Invalid, expired, or cross-conversation confirmation token.');
    return null;
  }

  /**
   * Prior turns for this request's conversation, in the exact ChatTurn
   * shape Chat mode already sends — reuses ChatService.historyTurns()
   * (the same source Chat mode's own streaming path builds from), not a
   * second implementation. Excludes a trailing turn that duplicates the
   * message we're about to send as this turn's own user turn (ChatService
   * already recorded it before routing here, for callers that go through
   * it). Returns [] for a brand-new conversation or any sessionId
   * ChatService doesn't recognise (e.g. an ad-hoc /api/router/send caller)
   * — identical to today's behaviour, never gates the turn.
   */
  private async loadPriorTurns(request: AgentRequest): Promise<ChatTurn[]> {
    try {
      const { chatService } = await import('../services/ChatService');
      const turns = chatService.historyTurns(request.sessionId);
      const last = turns[turns.length - 1];
      return last?.role === 'user' && last.content === request.content
        ? turns.slice(0, -1)
        : turns;
    } catch (err) {
      this.logger.warn('Conversation history unavailable; proceeding without it', { error: String(err) });
      return [];
    }
  }

  // ── System-prompt composition (identity + role + working memory) ──

  /**
   * Effective system prompt for a turn. THREE distinct, always-same-order
   * labeled sections carry identity + memory:
   *   1. Lumen's identity (LUMEN.md)          — always loaded
   *   2. "## Curated memories" (MEMORIES.md)  — always loaded, hand-curated
   *   3. "## Relevant memory"                 — semantically recalled per message
   * with this agent's role prompt and a "System status" block in between.
   * Curated memories, like identity, load every turn (they are a fixed,
   * tiny block); the semantic block and status are skipped on a resume,
   * which reuses the saved conversation.
   */
  private async buildSystemPrompt(request: AgentRequest, isResume: boolean, owner: ResolvedOwner): Promise<string> {
    const parts = [loadLumenIdentity(), this.systemPrompt];
    // Section 2: curated memories — always present (like identity), its own
    // clearly labeled block, distinct from the semantic "Relevant memory".
    const curated = loadCuratedMemories();
    if (curated) parts.push(`## Curated memories\n${curated}`);
    if (!isResume) {
      const status = await this.buildSystemStatusBlock(owner);
      if (status) parts.push(status);
      // Section 3: semantically-retrieved memories (existing system, untouched).
      const memory = await this.retrieveMemoryBlock(request.content);
      if (memory) parts.push(memory);
    }
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * Real, verified facts about Lumen's own configuration and state,
   * formatted as a labelled block — so the model has ground truth to
   * answer from when asked about its own capacity/config, instead of
   * guessing. Lazily imported (like ModelService/MemoryService above)
   * to avoid a module-load cycle: SystemInfoService needs a static
   * import of BaseAgent (for an instanceof check), so BaseAgent's
   * reference back to it must not be static.
   */
  private async buildSystemStatusBlock(owner: ResolvedOwner): Promise<string> {
    try {
      const { systemInfoService } = await import('../services/SystemInfoService');
      const status = await systemInfoService.getStatus({
        agentId: this.id,
        model: owner.model.id,
        providerId: owner.provider.id,
        providerName: owner.provider.name,
      });
      return systemInfoService.formatForPrompt(status);
    } catch (err) {
      this.logger.warn('System status unavailable; proceeding without it', { error: String(err) });
      return '';
    }
  }

  /**
   * Embed the user's message, recall the top matching memories, and format
   * them as a labelled block (~2 KB cap). Returns '' when nothing relevant
   * is found or embeddings are unavailable — never invents a memory.
   */
  private async retrieveMemoryBlock(userMessage: string): Promise<string> {
    try {
      const { memoryService } = await import('../services/MemoryService');
      const hits = await memoryService.list({ semantic: userMessage, limit: MEMORY_INJECTION_TOP_K });
      if (!hits.length) return '';

      const header =
        '## Relevant memory\n' +
        '(Recalled from earlier sessions — use only what is pertinent, and never ' +
        "treat it as the user's current words.)";
      const lines: string[] = [];
      let size = header.length;
      for (const h of hits) {
        const line = `- ${h.content}`;
        if (size + line.length + 1 > MEMORY_INJECTION_MAX_BYTES) break; // ~2 KB cap
        lines.push(line);
        size += line.length + 1;
      }
      return lines.length ? `${header}\n${lines.join('\n')}` : '';
    } catch (err) {
      this.logger.warn('Memory retrieval failed; proceeding without injection', { error: String(err) });
      return '';
    }
  }

  private toolResponse(
    request: AgentRequest,
    owner: ResolvedOwner,
    content: string,
    pluginsUsed: Set<string>,
    stats: {
      promptTokens: number;
      completionTokens: number;
      lastPromptTokens?: number;
      lastCompletionTokens?: number;
      iterations: number;
    },
  ): AgentResponse {
    return {
      requestId: request.id,
      agentId: this.id,
      agentName: this.name,
      content,
      model: owner.model.id,
      pluginsUsed: [...pluginsUsed],
      metadata: {
        promptTokens: stats.promptTokens,
        completionTokens: stats.completionTokens,
        lastPromptTokens: stats.lastPromptTokens,
        lastCompletionTokens: stats.lastCompletionTokens,
        toolIterations: stats.iterations,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ── IAgent implementation ─────────────────────────────────
  getStatus(): AgentStatus {
    return this._status;
  }

  setStatus(status: AgentStatus): void {
    const prev = this._status;
    this._status = status;
    if (prev !== status) {
      eventBus.emit(
        EVENTS.AGENT_STATUS_CHANGED,
        { agentId: this.id, from: prev, to: status },
        this.id
      );
    }
  }

  getMetadata(): AgentMetadata {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      description: this.description,
      capabilities: this.capabilities,
      // Assigned model only — resolving a fallback here would
      // require async I/O; UI treats '' as "not yet assigned".
      defaultModel: this.getAssignedModel() ?? '',
      status: this._status,
      activeTasks: this._activeTasks,
      createdAt: new Date().toISOString(),
    };
  }

  // ── Helpers for subclasses ────────────────────────────────

  /** Resolve the default model provider, or fall back to any registered. */
  protected getProvider(): IModelProvider {
    return this.modelRegistry.getDefault();
  }

  /** The model the user explicitly assigned to this agent, if any. */
  getAssignedModel(): string | null {
    return agentModelStore.get(this.id);
  }

  /**
   * The model this agent will actually use: the persisted
   * assignment if present, otherwise the first runnable model
   * across all providers (Ollama preferred). Throws an honest
   * error when nothing runnable exists.
   */
  async resolveModel(): Promise<string> {
    const assigned = this.getAssignedModel();
    if (assigned) return assigned;

    const { modelService } = await import('../services/ModelService');
    const runnable = (await modelService.listAllModels()).filter((m) => m.runnable !== false);
    if (runnable.length === 0) {
      throw new Error(
        `No model is assigned to ${this.name} and no runnable models were found. ` +
        'Pull an Ollama model from the Models page, or drop a .gguf file into the models folder.'
      );
    }
    const preferred = runnable.find((m) => m.providerId === 'ollama') ?? runnable[0];
    return preferred.id;
  }

  /** Call before execute() body — increments task counter and sets status. */
  protected beginTask(): void {
    this._activeTasks++;
    if (this._status === 'idle') this.setStatus('running');
  }

  /** Call at the end of execute() — decrements task counter, resets status. */
  protected endTask(): void {
    this._activeTasks = Math.max(0, this._activeTasks - 1);
    if (this._activeTasks === 0) this.setStatus('active');
  }
}
