// ============================================================
// IMemoryProvider — Core contract for agent memory storage.
//
// Agents use IMemoryProvider to persist and retrieve facts,
// context, and instructions across sessions. Implementations
// can range from a simple in-memory map to vector stores
// like ChromaDB or Qdrant.
// ============================================================

export type MemoryType = 'fact' | 'context' | 'instruction' | 'episodic';
export type Importance = 'high' | 'medium' | 'low';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  /** The agent that created this memory */
  agentId: string;
  agentName: string;
  /** Optional embedding vector (populated by embedding model) */
  embedding?: number[];
  importance: Importance;
  tags: string[];
  createdAt: string;
  /** Optional expiry — null = permanent */
  expiresAt?: string;
}

export interface MemoryQuery {
  type?: MemoryType;
  agentId?: string;
  importance?: Importance;
  tags?: string[];
  /**
   * Semantic search query. When set, providers that support embeddings
   * embed this string and rank stored entries by cosine similarity —
   * this is a real vector search, not substring matching. Providers
   * without embeddings return no semantic results (never a fake match).
   */
  semantic?: string;
  /**
   * Minimum cosine similarity (0..1) an entry must reach to be returned
   * by a semantic query. Undefined ⇒ no floor (rank-only). Lets callers
   * inject only genuinely-relevant memory instead of a fixed top-K.
   */
  minScore?: number;
  limit?: number;
}

export interface MemoryWriteResult {
  id: string;
  success: boolean;
}

/**
 * IMemoryProvider — All memory backends implement this interface.
 *
 * Short-term in-conversation context is managed by agents internally.
 * Long-term memory that should persist across sessions is stored
 * via this interface.
 */
export interface IMemoryProvider {
  readonly id: string;
  readonly name: string;

  /** Persist a new memory entry. Returns the stored ID. */
  write(entry: Omit<MemoryEntry, 'id'>): Promise<MemoryWriteResult>;

  /** Read a single entry by ID. */
  read(id: string): Promise<MemoryEntry | null>;

  /** Query entries with optional filters. */
  query(params: MemoryQuery): Promise<MemoryEntry[]>;

  /** Update an existing entry. */
  update(id: string, patch: Partial<MemoryEntry>): Promise<boolean>;

  /** Hard-delete an entry. */
  delete(id: string): Promise<boolean>;

  /** Return total number of stored entries. */
  count(): Promise<number>;

  /** Provider health status for observability. */
  healthCheck(): Promise<{ status: 'ok' | 'error'; message?: string }>;
}
