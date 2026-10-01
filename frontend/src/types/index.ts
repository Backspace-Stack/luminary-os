// ============================================================
// Frontend types — mirror the backend core/types interfaces.
// Keep in sync with backend/src/core/types/*.ts
// ============================================================

export type ModelStatus  = 'loaded' | 'unloaded';
export type ModelType    = 'general' | 'coding' | 'embedding' | 'vision';
export type AgentStatus  = 'active' | 'idle' | 'running' | 'error' | 'disabled';
export type TaskStatus   = 'running' | 'queued' | 'completed' | 'failed';
export type DeviceStatus = 'connected' | 'streaming' | 'offline' | 'pairing';
export type DeviceType   = 'browser' | 'windows' | 'esp32' | 'camera' | 'linux' | 'macos';
export type MemoryType   = 'fact' | 'context' | 'instruction' | 'episodic';
export type Importance   = 'high' | 'medium' | 'low';

export interface AgentCapability {
  name: string;
  description: string;
  triggerKeywords: string[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: AgentCapability[];
  defaultModel: string;   // resolved at runtime — NOT hardcoded in UI
  status: AgentStatus;
  activeTasks: number;
  createdAt: string;
}

export interface LLMModel {
  id: string;
  name: string;
  family: string;
  sizeLabel: string;
  sizeBytes?: number;
  type: ModelType;
  status: ModelStatus;
  quantization: string;
  contextLength: number;
  parameterSize?: string;
  modifiedAt?: string;
  speed?: string;
  providerId: string;     // which IModelProvider owns this model
  providerName?: string;
  /** False for discovered GGUF files with no runtime installed. */
  runnable?: boolean;
  /** Absolute path on disk for file-based models (GGUF). */
  filePath?: string;
}

/** Mirrors backend AppSettings. */
export interface AppSettings {
  ggufFolder: string | null;
}

/** A model currently loaded in Ollama's memory (GET /api/models/running). */
export interface RunningModel {
  name: string;
  sizeBytes: number;
  sizeVramBytes: number;
  expiresAt?: string;
}

/** Mirrors backend ProviderHealth. */
export interface ProviderHealth {
  status: 'connected' | 'disconnected' | 'error' | 'initialising';
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

/** Streaming progress while pulling a model from the Ollama registry. */
export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface Task {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  status: TaskStatus;
  progress: number;
  startedAt: string;
}

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  agentId: string;
  agentName: string;
  importance: Importance;
  tags: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  ipAddress: string;
  lastSeenAt: string;
  version: string;
  capabilities: string[];
}

/** Mirrors SystemService.SystemSnapshot */
export interface SystemStatus {
  version: string;
  uptime: string;
  uptimeMs: number;
  agents: {
    total: number;
    active: number;
    activeAgentName: string | null;
    activeModelName: string | null;
  };
  tasks: { running: number; total: number };
  plugins: { total: number; active: number };
  devices: { total: number; online: number; offline: number };
  memory: { total: number; providerStatus: string };
  providers: { total: number; defaultId: string | null };
  resources: {
    cpuPercent: number;
    gpuPercent: number | null;
    ramUsedGB: number;
    ramTotalGB: number;
  };
}

/** Mirrors backend StoredMessage — a persisted chat message. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  model?: string;
  createdAt: string;
  durationMs?: number;
  tokensPerSecond?: number;
  /** True when generation was stopped before completion. */
  stopped?: boolean;
  /** Real provider-reported prompt tokens for this reply (absent = unknown). */
  inputTokens?: number;
  /** Real provider-reported completion tokens (absent = unknown). */
  outputTokens?: number;
  /** Effective runtime context window of the generating model instance. */
  contextWindow?: number;
  /** Conversation tokens occupying the context after this reply. */
  contextUsed?: number;
}

/** Mirrors backend ConversationSummary (list view). */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
  lastAgentName: string | null;
}

/** Mirrors backend StoredConversation (detail view). */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  /** Explicit agent this conversation is pinned to (the mode selector). */
  agentId: string;
}

// ── Notes (mirrors backend notes/SqliteNotesStore + NoteAskService) ──

/** One of the user's notes — freeform text, independent of every other note. */
export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** Result of POST /api/notes/:id/ask — the saved note plus the real answer. */
export interface AskNoteResult {
  note: Note;
  answer: string;
  agentName: string;
  model?: string;
  durationMs?: number;
}

/** Mirrors backend PendingConfirmation — a paused tool call awaiting approval. */
export interface PendingConfirmation {
  id: string;
  plugin: string;
  action: string;
  args: Record<string, unknown>;
}

// ── Usage analytics (mirrors backend AnalyticsService) ─────────
export type AnalyticsRange = 'all' | '30d' | '7d';
export type AnalyticsMetric = 'tokens' | 'messages';

export interface AnalyticsModel {
  model: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Share of the active metric, 0–100. */
  pct: number;
}

export interface AnalyticsDay {
  date: string;                     // YYYY-MM-DD, local
  count: number;
  tokens: number;
  byModel: Record<string, number>;  // value in the active metric per model
}

export interface AnalyticsComparison {
  label: string;
  times: number;
}

export interface Analytics {
  range: AnalyticsRange;
  metric: AnalyticsMetric;
  generatedAt: string;
  totals: {
    sessions: number;
    messages: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    peakHour: number | null;
    favoriteModel: string | null;
  };
  models: AnalyticsModel[];
  daily: AnalyticsDay[];
  calendar: AnalyticsDay[];
  comparison: AnalyticsComparison | null;
}

export type NavPage =
  | 'dashboard'
  | 'chat'
  | 'models'
  | 'agents'
  | 'memory'
  | 'devices'
  | 'theme'
  | 'settings';
