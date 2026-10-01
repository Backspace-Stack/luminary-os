// ============================================================
// IAgent — Core contract for every agent in Luminary OS.
// All agents must implement this interface. The Router and
// AgentRegistry work exclusively with IAgent, never with
// concrete agent classes.
// ============================================================

export interface AgentRequest {
  /** Unique request ID (nanoid / uuid) */
  id: string;
  /** Conversation or task session ID */
  sessionId: string;
  /** Raw user message or task instruction */
  content: string;
  /** Optional structured context from prior turns */
  context?: ConversationTurn[];
  /** Arbitrary routing metadata injected by the Router */
  metadata?: Record<string, unknown>;
  /**
   * Confirmation tokens the user has approved for this turn. Each id
   * comes from a prior response's `pendingConfirmations`. Resending the
   * original request with these filled resumes a paused tool loop and
   * runs the approved actions. Empty/absent ⇒ nothing is pre-approved.
   */
  confirmedToolCallIds?: string[];
  /** ISO timestamp */
  timestamp: string;
}

/**
 * A tool call the agent has paused on, awaiting user approval. Returned
 * on AgentResponse when a requiresConfirmation action was proposed but
 * not yet confirmed. Echo `id` back in AgentRequest.confirmedToolCallIds
 * to approve and resume.
 */
export interface PendingConfirmation {
  /** Server-generated approval token (globally unique for this turn). */
  id: string;
  /** Plugin that owns the action, e.g. "file-plugin". */
  plugin: string;
  /** Capability action, e.g. "write". */
  action: string;
  /** Arguments the model proposed for the action. */
  args: Record<string, unknown>;
}

export interface ConversationTurn {
  role: 'user' | 'agent' | 'system';
  content: string;
  agentId?: string;
  timestamp: string;
}

export interface AgentResponse {
  /** Mirrors AgentRequest.id */
  requestId: string;
  /** ID of the agent that produced this response */
  agentId: string;
  /** Human-readable agent name */
  agentName: string;
  /** The actual response content */
  content: string;
  /** Model provider + model name used (if any) */
  model?: string;
  /** Plugins invoked during this response */
  pluginsUsed?: string[];
  /**
   * Set when the tool loop paused for approval. The turn produced no
   * final answer; the caller must approve (or drop) these and resend
   * the request with the ids in `confirmedToolCallIds` to continue.
   */
  pendingConfirmations?: PendingConfirmation[];
  /** Arbitrary metadata (token count, latency, etc.) */
  metadata?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
  /** Wall-clock ms from request receipt to response */
  durationMs?: number;
}

export type AgentStatus = 'active' | 'idle' | 'running' | 'error' | 'disabled';

export interface AgentCapability {
  /** Unique capability key, e.g. "code-generation" */
  name: string;
  description: string;
  /** Keywords that hint this agent should handle a request */
  triggerKeywords: string[];
}

export interface AgentMetadata {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: AgentCapability[];
  /** Currently assigned model name — '' when none assigned yet. */
  defaultModel: string;
  status: AgentStatus;
  activeTasks: number;
  createdAt: string;
}

/**
 * IAgent — Every specialist agent must implement this interface.
 *
 * Agents are the primary unit of work in Luminary OS. They receive
 * a structured AgentRequest from the Router, optionally invoke Plugins
 * and a ModelProvider, and return an AgentResponse.
 */
export interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly capabilities: AgentCapability[];

  /**
   * Called by the Router to decide whether this agent can handle
   * the given request. Implementations should be fast (no I/O).
   */
  canHandle(request: AgentRequest): boolean;

  /**
   * Primary execution method. The Router calls this after
   * canHandle() returns true.
   */
  execute(request: AgentRequest): Promise<AgentResponse>;

  /** Snapshot of the agent's current runtime state. */
  getStatus(): AgentStatus;

  /** Allow the Kernel / Router to toggle agent state. */
  setStatus(status: AgentStatus): void;

  /** Full metadata for API serialisation. */
  getMetadata(): AgentMetadata;
}
