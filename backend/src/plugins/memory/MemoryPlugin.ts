// ============================================================
// MemoryPlugin — Explicit long-term memory for agents.
//
// Two capabilities over the shared MemoryService (SQLite-backed):
//   • remember(content, tags?) — store a fact for later recall.
//   • recall(query)            — semantic search of stored memories.
//
// Both are read/write-safe and non-destructive, so requiresConfirmation
// is false. Results are always real: recall returns whatever the vector
// search actually finds (possibly nothing), never an invented memory.
// ============================================================

import { BasePlugin } from '../BasePlugin';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';
import { memoryService } from '../../services/MemoryService';

const DEFAULT_RECALL_LIMIT = 5;

export class MemoryPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'memory-plugin',
    name: 'Memory Plugin',
    version: '0.1.0',
    description: 'Store and semantically recall long-term memories across sessions.',
    capabilities: [
      {
        action: 'remember',
        description: 'Store a fact or note in long-term memory for later recall.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The fact or note to remember.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to categorise the memory.' },
          },
          required: ['content'],
        },
        requiresConfirmation: false,
      },
      {
        action: 'recall',
        description: 'Semantically search long-term memory and return the most relevant entries.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for.' },
            limit: { type: 'number', description: `Max entries to return (default ${DEFAULT_RECALL_LIMIT}).` },
          },
          required: ['query'],
        },
        requiresConfirmation: false,
      },
    ],
  };

  protected async onInitialize(): Promise<void> {
    this.logger.info('MemoryPlugin ready (remember / recall)');
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    switch (action.action) {
      case 'remember': return this.remember(action);
      case 'recall':   return this.recall(action);
      default:         return this.notImplemented(action.action);
    }
  }

  private async remember(action: PluginAction): Promise<PluginResult> {
    const content = typeof action.payload.content === 'string' ? action.payload.content.trim() : '';
    if (!content) return { success: false, error: 'remember requires a non-empty "content" string.' };
    const tags = Array.isArray(action.payload.tags) ? action.payload.tags.map((t) => String(t)) : [];

    try {
      const entry = await memoryService.create({
        type: 'fact',
        content,
        agentId: action.agentId,
        agentName: action.agentId,
        importance: 'medium',
        tags,
        createdAt: new Date().toISOString(),
      });
      this.logger.info(`remembered memory ${entry.id}`, { requestId: action.requestId });
      return { success: true, data: { id: entry.id, stored: true } };
    } catch (err) {
      return { success: false, error: `Failed to store memory: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async recall(action: PluginAction): Promise<PluginResult> {
    const query = typeof action.payload.query === 'string' ? action.payload.query.trim() : '';
    if (!query) return { success: false, error: 'recall requires a non-empty "query" string.' };
    const requested = Number(action.payload.limit);
    const limit = Number.isFinite(requested) ? Math.min(20, Math.max(1, Math.floor(requested))) : DEFAULT_RECALL_LIMIT;

    try {
      const hits = await memoryService.list({ semantic: query, limit });
      this.logger.info(`recall "${query}" -> ${hits.length} hit(s)`, { requestId: action.requestId });
      return {
        success: true,
        data: {
          query,
          results: hits.map((h) => ({ id: h.id, content: h.content, tags: h.tags, createdAt: h.createdAt })),
          resultCount: hits.length,
        },
      };
    } catch (err) {
      return { success: false, error: `Recall failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
