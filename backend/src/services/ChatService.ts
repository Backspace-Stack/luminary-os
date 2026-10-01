// ============================================================
// ChatService — Real chat sessions backed by local Ollama.
//
// Responsibilities:
//   • Conversation CRUD, persisted to backend/data/conversations.json
//     so sessions survive app restarts.
//   • Streaming generation: picks the agent via the Router,
//     resolves the agent's assigned model, and streams tokens
//     from the provider. Supports send / regenerate / continue.
//   • Stop generation: per-conversation AbortControllers.
//
// Errors are honest: if Ollama is unreachable or no model is
// installed, the caller receives the real error — never a fake
// response.
// ============================================================

import { randomUUID } from 'crypto';
import { router } from '../router/Router';
import { modelService } from './ModelService';
import { agentRegistry } from '../core/registry/AgentRegistry';
import type { BaseAgent, AgentStreamEvent } from '../agents/BaseAgent';
import { appendCuratedMemory } from '../agents/BaseAgent';
import type { ChatTurn } from '../core/types/IModelProvider';
import type { AgentResponse, PendingConfirmation } from '../core/types/IAgent';
import { JsonStore } from '../core/persistence/JsonStore';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('ChatService');

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  model?: string;
  createdAt: string;
  durationMs?: number;
  tokensPerSecond?: number;
  /** True when the user stopped generation before it finished. */
  stopped?: boolean;
  // ── Per-message performance metadata ──────────────────────────
  // Every field below is a REAL number reported by the provider for
  // this generation (Ollama prompt_eval_count / eval_count / ps
  // context_length) or derived from those by exact arithmetic.
  // Absent means unknown — the UI shows "unknown", never a guess.
  /** Prompt tokens the provider reported processing for this reply. */
  inputTokens?: number;
  /** Completion tokens the provider reported generating. */
  outputTokens?: number;
  /** Effective runtime context window of the model instance that generated this. */
  contextWindow?: number;
  /** Total conversation tokens occupying the context after this reply. */
  contextUsed?: number;
}

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  /** Explicit agent this conversation is pinned to (the mode selector). */
  agentId: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
  lastAgentName: string | null;
}

export type GenerateMode = 'send' | 'regenerate' | 'continue' | 'resume';

export interface GenerateParams {
  conversationId: string;
  mode: GenerateMode;
  /** Required for mode 'send' — the new user message. */
  content?: string;
  /** Force a specific agent instead of automatic routing. */
  targetAgentId?: string;
  /** Sampling temperature (0–2); omitted → provider default. */
  temperature?: number;
  /** Context window (num_ctx) for providers that support it. */
  contextLength?: number;
  /** Approval tokens for mode 'resume' — see PendingConfirmation. */
  confirmedToolCallIds?: string[];
}

export interface StreamEvents {
  /** Emitted once, before tokens: which agent/model will answer. */
  onMeta: (meta: { agentId: string; agentName: string; model: string; messageId: string }) => void;
  onToken: (token: string) => void;
  onDone: (message: StoredMessage) => void;
  /**
   * Emitted instead of onMeta/onDone when a tool-capable agent's turn
   * paused for approval. Nothing was persisted yet — resend mode
   * 'resume' with the approved id(s) to continue, or drop it (it
   * expires on its own).
   */
  onPending?: (info: {
    agentId: string;
    agentName: string;
    model?: string;
    pendingConfirmations: PendingConfirmation[];
  }) => void;
  /**
   * Structured agent-loop events, forwarded verbatim from BaseAgent's
   * stream (thinking_delta / tool_call_started / tool_call_result /
   * pending_confirmation) so the route can put them on the wire.
   * Optional — consumers that only understand meta/token/done/pending
   * simply skip it. thinking_delta is deliberately NOT folded into
   * onToken/target.content — it's ephemeral live feedback, never part
   * of the persisted assistant message.
   */
  onAgentEvent?: (
    event: Extract<AgentStreamEvent, { type: 'thinking_delta' | 'tool_call_started' | 'tool_call_result' | 'pending_confirmation' }>,
  ) => void;
}

export class ChatError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ChatError';
  }
}

export class ChatService {
  private store = new JsonStore<StoredConversation[]>('conversations.json', []);
  private conversations: StoredConversation[];
  private activeGenerations = new Map<string, AbortController>();
  private generationDrafts = new Map<string, { original: StoredConversation; working: StoredConversation }>();

  constructor() {
    this.conversations = this.store.load();
    // Conversations persisted before the mode selector existed have no
    // agentId — default them to Chat rather than leaving it undefined.
    for (const conv of this.conversations) {
      if (!conv.agentId) conv.agentId = 'conversation-agent';
    }
    logger.info(`Loaded ${this.conversations.length} persisted conversation(s)`);
  }

  /** Read-only snapshot of every stored conversation — for analytics.
   *  Returns the live array (callers must not mutate it). */
  allConversations(): readonly StoredConversation[] {
    return this.conversations;
  }

  // ── Conversation CRUD ───────────────────────────────────────

  list(): ConversationSummary[] {
    return [...this.conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => {
        const last = c.messages[c.messages.length - 1];
        const lastAgent = [...c.messages].reverse().find((m) => m.role === 'assistant');
        return {
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          messageCount: c.messages.length,
          lastMessage: last?.content.slice(0, 120) ?? '',
          lastAgentName: lastAgent?.agentName ?? null,
        };
      });
  }

  get(id: string): StoredConversation {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) throw new ChatError(`Conversation "${id}" not found`, 404);
    return conv;
  }

  create(title?: string): StoredConversation {
    const now = new Date().toISOString();
    const conv: StoredConversation = {
      id: randomUUID(),
      title: title?.trim() || 'New Chat',
      createdAt: now,
      updatedAt: now,
      messages: [],
      // Default to Chat (ConversationAgent) — the mode selector can
      // switch this before or after the first message.
      agentId: 'conversation-agent',
    };
    this.persist([...this.conversations, conv]);
    this.conversations.push(conv);
    return conv;
  }

  rename(id: string, title: string): StoredConversation {
    const conv = this.get(id);
    const updated = { ...conv, title: title.trim() || conv.title, updatedAt: new Date().toISOString() };
    this.persist(this.conversations.map(c => c.id === id ? updated : c));
    Object.assign(conv, updated);
    return conv;
  }

  /** Pin this conversation to an explicit agent (the mode selector). */
  setAgentId(id: string, agentId: string): StoredConversation {
    const conv = this.get(id);
    if (!agentRegistry.findById(agentId)) {
      throw new ChatError(`Agent "${agentId}" not found`, 404);
    }
    const updated = { ...conv, agentId, updatedAt: new Date().toISOString() };
    this.persist(this.conversations.map(c => c.id === id ? updated : c));
    Object.assign(conv, updated);
    return conv;
  }

  /**
   * Prior turns for a conversation, in ChatTurn shape (role + content
   * only) — the exact transform the streaming path below builds from
   * conv.messages. BaseAgent reuses this same method (not a re-implementation)
   * so Agent / Deep Research modes see the same history Chat mode already
   * sends. Empty for an unknown conversation id — never throws.
   */
  historyTurns(conversationId: string): ChatTurn[] {
    let conv: StoredConversation;
    try {
      // Agents need the current turn while it is being generated, but
      // public GET/list must expose only successfully persisted history.
      conv = this.generationDrafts.get(conversationId)?.working ?? this.get(conversationId);
    } catch {
      return [];
    }
    return conv.messages.map((m): ChatTurn => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
  }

  remove(id: string): void {
    const remaining = this.conversations.filter((c) => c.id !== id);
    if (this.conversations.length === remaining.length) {
      throw new ChatError(`Conversation "${id}" not found`, 404);
    }
    this.persist(remaining);
    this.stop(id);
    this.conversations = remaining;
  }

  // ── Generation ──────────────────────────────────────────────

  isGenerating(conversationId: string): boolean {
    return this.generationDrafts.has(conversationId) || this.activeGenerations.has(conversationId);
  }

  /** Abort an in-flight generation for a conversation. */
  stop(conversationId: string): boolean {
    const controller = this.activeGenerations.get(conversationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Run one generation turn, streaming tokens through `events`.
   * Resolves when generation finishes, is stopped, or fails.
   * Throws ChatError for invalid requests; provider errors
   * propagate so the route can report them honestly.
   */
  async generate(params: GenerateParams, events: StreamEvents): Promise<void> {
    const original = structuredClone(this.get(params.conversationId));
    if (this.isGenerating(original.id)) {
      throw new ChatError('A response is already being generated for this conversation', 409);
    }
    const conv = structuredClone(original);
    const controller = new AbortController();
    this.generationDrafts.set(conv.id, { original, working: conv });
    this.activeGenerations.set(conv.id, controller);
    try {
      await this.generateTurn(conv, params, events, controller);
    } finally {
      this.generationDrafts.delete(conv.id);
      this.activeGenerations.delete(conv.id);
    }
  }

  private async generateTurn(conv: StoredConversation, params: GenerateParams, events: StreamEvents, controller: AbortController): Promise<void> {

    // ── /remember — the ONE shared interception point ──────────────
    // Both the dashboard (POST /api/chat/generate) and the DiscordBridge
    // funnel through THIS method, so intercepting here means /remember
    // works identically on both surfaces, implemented once. A pure
    // curated-memory write: append + confirm, NO agent, NO model call —
    // near-instant even on slow hardware. Anything else falls through to
    // the normal pipeline entirely unchanged.
    if (params.mode === 'send') {
      const match = /^\s*\/remember\b[ \t]*([\s\S]*)$/i.exec(params.content ?? '');
      if (match) { this.handleRemember(conv, match[1].trim(), events); return; }
    }

    // 1. Prepare history according to mode
    if (params.mode === 'send') {
      const content = params.content?.trim();
      if (!content) throw new ChatError('"content" is required for mode "send"');
      conv.messages.push({
        id: randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      });
      // First user message becomes the conversation title
      if (conv.messages.filter((m) => m.role === 'user').length === 1) {
        conv.title = content.length > 48 ? `${content.slice(0, 48)}…` : content;
      }
    } else if (params.mode === 'regenerate') {
      // Drop the trailing assistant message (if any) and redo it
      const last = conv.messages[conv.messages.length - 1];
      if (last?.role === 'assistant') conv.messages.pop();
      if (conv.messages.length === 0 || conv.messages[conv.messages.length - 1].role !== 'user') {
        throw new ChatError('Nothing to regenerate — no preceding user message');
      }
    } else if (params.mode === 'continue') {
      const last = conv.messages[conv.messages.length - 1];
      if (last?.role !== 'assistant') {
        throw new ChatError('Nothing to continue — the last message is not an assistant response');
      }
    } else if (params.mode === 'resume') {
      // Approving a paused tool call — no new user message, the one
      // that triggered the pause is already the last message.
      const last = conv.messages[conv.messages.length - 1];
      if (last?.role !== 'user') {
        throw new ChatError('Nothing to resume — no pending confirmation for this conversation');
      }
    }

    // 2. Select agent via the Router (same logic as /api/router/send).
    //    An explicit targetAgentId wins; otherwise fall back to the
    //    conversation's own pinned agent (never silent auto-routing
    //    once a mode has been chosen for this conversation).
    const targetAgentId = params.targetAgentId ?? conv.agentId;
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
    const agent = router.selectAgent({
      id: randomUUID(),
      sessionId: conv.id,
      content: lastUser?.content ?? '',
      targetAgentId,
      timestamp: new Date().toISOString(),
    }) as BaseAgent;
    conv.agentId = targetAgentId;

    // 3. Resolve the model and its owning provider — Ollama tags and
    //    GGUF file paths both work; the model must actually be runnable.
    const modelId = await agent.resolveModel();
    if (controller.signal.aborted) throw new ChatError('Generation cancelled before execution.', 409);
    const owner = await modelService.findOwner(modelId);
    if (controller.signal.aborted) throw new ChatError('Generation cancelled before execution.', 409);
    if (!owner) {
      throw new ChatError(
        `Model "${modelId}" is not available from any provider. Check the Models page.`, 404);
    }
    if (owner.model.runnable === false) {
      throw new ChatError(
        `Model "${owner.model.name}" cannot run: the GGUF runtime is unavailable on this machine.`, 501);
    }
    const provider = owner.provider;

    // 3b. From here everything runs through BaseAgent.execute() — the ONE
    //     loop /api/router/send also uses — so identity, memory recall,
    //     the system-status block, tools and the confirmation gate apply
    //     uniformly to Chat, Agent and Deep Research. execute() streams
    //     structured events; this method only adapts them onto the chat
    //     wire protocol (meta/token/done/pending + forwarded tool events).
    const usesTools = agent.getAllowedPlugins().length > 0 && provider.supportsTools?.() === true;
    const continuing = params.mode === 'continue';
    if (usesTools && continuing) {
      throw new ChatError('Continue is not supported in this mode — use Regenerate instead.', 400);
    }
    const modelDisplayName = owner.model.name;

    // 4. Target message: continue appends to the existing assistant
    //    message; send/regenerate/resume create a new one.
    const target: StoredMessage = continuing
      ? conv.messages[conv.messages.length - 1]
      : {
          id: randomUUID(),
          role: 'assistant',
          content: '',
          agentId: agent.id,
          agentName: agent.name,
          model: modelDisplayName,
          createdAt: new Date().toISOString(),
        };

    // Meta timing: plain chat announces the responder up front (as it
    // always has); a tool turn defers it until the first text arrives so
    // a pause with no preamble reaches the client as only the pending
    // events — no phantom empty reply bubble.
    let metaSent = false;
    const ensureMeta = () => {
      if (metaSent) return;
      metaSent = true;
      events.onMeta({ agentId: agent.id, agentName: agent.name, model: modelDisplayName, messageId: target.id });
    };
    if (!usesTools) ensureMeta();

    const started = Date.now();

    let response: AgentResponse;
    try {
      if (controller.signal.aborted) throw new ChatError('Generation cancelled before execution.', 409);
      response = await agent.execute(
        {
          id: randomUUID(),
          sessionId: conv.id,
          content: lastUser?.content ?? '',
          confirmedToolCallIds: params.confirmedToolCallIds,
          timestamp: new Date().toISOString(),
        },
        {
          signal: controller.signal,
          temperature: params.temperature,
          contextLength: params.contextLength,
          continueTurn: continuing || undefined,
          onEvent: (ev) => {
            switch (ev.type) {
              case 'text_delta':
                ensureMeta();
                target.content += ev.text;
                events.onToken(ev.text);
                break;
              case 'thinking_delta':
              case 'tool_call_started':
              case 'tool_call_result':
              case 'pending_confirmation':
                events.onAgentEvent?.(ev);
                break;
              case 'done':
                break; // execute()'s return value is the authoritative response
            }
          },
        },
      );
    } catch (err) {
      // Real failure (Ollama down, model missing, …). Persist the user
      // message so it isn't lost, but store no fake assistant reply.
      this.touch(conv);
      throw err;
    } finally {
      this.activeGenerations.delete(conv.id);
    }

    // 5. Paused for approval — nothing final to persist yet. The client
    //    approves by resending mode 'resume' with confirmedToolCallIds
    //    (same pending-turn store and resume semantics as /api/router/send)
    //    or simply lets the pause expire.
    if (response.pendingConfirmations && response.pendingConfirmations.length > 0) {
      this.touch(conv);
      events.onPending?.({
        agentId: response.agentId,
        agentName: response.agentName,
        model: response.model,
        pendingConfirmations: response.pendingConfirmations,
      });
      return;
    }

    // 6. Persist the outcome. target.content accumulated the streamed
    //    deltas — for tool turns that includes any pre-tool text the
    //    user watched, which response.content alone wouldn't carry.
    if (!continuing && target.content.length === 0) target.content = response.content;
    const meta = response.metadata ?? {};
    target.model = modelDisplayName;
    target.durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : Date.now() - started;
    target.tokensPerSecond = typeof meta.tokensPerSecond === 'number' ? meta.tokensPerSecond : undefined;
    target.stopped = meta.aborted ? true : undefined;

    // 6b. Per-message performance metadata — real provider numbers only.
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
    const inputTokens = num(meta.promptTokens);
    const outputTokens = num(meta.completionTokens);
    if (continuing) {
      // A continued message keeps ONE honest meaning per field: input =
      // the latest full prompt (which included the partial reply being
      // extended); output = every token generated for this message.
      target.inputTokens = inputTokens ?? target.inputTokens;
      target.outputTokens = outputTokens !== undefined
        ? (target.outputTokens ?? 0) + outputTokens
        : target.outputTokens;
    } else {
      target.inputTokens = inputTokens;
      target.outputTokens = outputTokens;
    }

    // Effective runtime context window, read back from the provider AFTER
    // the generation (the instance that just answered is still loaded).
    // Optional capability — providers that can't report it yield unknown.
    try {
      target.contextWindow = await provider.getLoadedContextWindow?.(owner.model.remoteId ?? owner.model.id);
    } catch {
      target.contextWindow = undefined;
    }

    // Cumulative context occupancy after this reply, from the FINAL model
    // call's reported counts (loop sums re-count re-sent prefixes). Two
    // reporting behaviours exist for prompt_eval_count across Ollama
    // versions — full prompt vs. uncached suffix — and this recurrence is
    // exact under both: a full count necessarily ≥ the previous total (the
    // prompt contains that whole history), so the larger branch is the
    // full-prompt case and the smaller is the warm-cache delta case.
    const lastP = num(meta.lastPromptTokens) ?? inputTokens;
    const lastR = num(meta.lastCompletionTokens) ?? outputTokens;
    if (lastP !== undefined && lastR !== undefined) {
      const prevUsed = continuing
        ? target.contextUsed ?? 0
        : [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.contextUsed !== undefined)?.contextUsed ?? 0;
      target.contextUsed = (lastP >= prevUsed ? lastP : prevUsed + lastP) + lastR;
    } else if (!continuing) {
      target.contextUsed = undefined;
    }
    ensureMeta();
    if (!continuing && target.content.length > 0) {
      conv.messages.push(target);
    }
    this.touch(conv);
    events.onDone(target);
  }

  /**
   * Handle a /remember command: append the note to the curated MEMORIES.md
   * (the ONLY writer of that file) and reply with a short confirmation —
   * no agent selection, no model call. The command + confirmation are
   * persisted as a normal exchange so history stays coherent, but a bare
   * command never becomes the conversation title. Emits the same
   * meta/token/done events every consumer already understands, so the
   * dashboard renders it as a reply and the Discord bridge sends it whole.
   */
  private handleRemember(conv: StoredConversation, note: string, events: StreamEvents): void {
    const messageId = randomUUID();
    const now = new Date().toISOString();

    let reply: string;
    let persist = false;
    if (!note) {
      reply = 'Usage: `/remember <fact>` — I’ll keep that fact in my always-loaded curated memories.';
    } else {
      const res = appendCuratedMemory(note);
      if (res.ok) {
        persist = true;
        reply = `Got it — I’ll always keep this in mind: “${note}”.\n(Saved to curated memories — loaded in full every session, no search needed. Now ${res.bytes} bytes.)`;
        logger.info(`/remember appended a curated memory (${res.bytes} bytes total)`);
      } else {
        reply = `I couldn’t save that to curated memory: ${res.error}`;
        logger.warn(`/remember failed to write: ${res.error}`);
      }
    }

    const assistantMsg: StoredMessage = {
      id: messageId, role: 'assistant', content: reply,
      agentId: 'system', agentName: 'Lumen', model: 'curated-memory', createdAt: now,
    };

    events.onMeta({ agentId: 'system', agentName: 'Lumen', model: 'curated-memory', messageId });
    events.onToken(reply);

    if (persist) {
      // Record the exchange WITHOUT letting a command set the title.
      conv.messages.push({ id: randomUUID(), role: 'user', content: `/remember ${note}`, createdAt: now });
      conv.messages.push(assistantMsg);
    }
    this.touch(conv);
    events.onDone(assistantMsg);
  }

  private touch(conv: StoredConversation): void {
    // Stage one conversation against the latest list. Failed writes do
    // not publish its draft or roll back another conversation's edits.
    // A deleted conversation must stay deleted even if its stream ends.
    const current = this.get(conv.id);
    const original = this.generationDrafts.get(conv.id)?.original;
    const updated = { ...conv, updatedAt: new Date().toISOString() };
    if (original) {
      if (current.title !== original.title) updated.title = current.title;
      if (current.agentId !== original.agentId) updated.agentId = current.agentId;
    }
    this.persist(this.conversations.map(c => c.id === conv.id ? updated : c));
    Object.assign(current, updated);
  }

  private persist(conversations = this.conversations): void {
    if (!this.store.save(conversations)) {
      throw new ChatError('Conversation changes could not be saved. Check the data folder and try again.', 503);
    }
  }
}

export const chatService = new ChatService();
