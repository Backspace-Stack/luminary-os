// ============================================================
// SystemInfoService — Real, verified facts about Lumen's own
// configuration and state.
//
// Exists so agents (including tool-less ConversationAgent) can answer
// questions about their own capacity/config from ground truth instead
// of guessing. Every number here is either read live (fs.stat, a DB
// count, process.uptime()) or imported from the single place that
// actually defines it (BaseAgent's injection constants, the memory
// provider's similarity floor) — nothing here is a second hardcoded
// copy that could drift from what the system actually does.
//
// A plain service, not a plugin: ConversationAgent has no tools and
// must still get this information automatically every turn.
// ============================================================

import fs from 'fs';
import path from 'path';
import { agentRegistry } from '../core/registry/AgentRegistry';
import { memoryService } from './MemoryService';
import { BaseAgent, MEMORY_INJECTION_TOP_K, MEMORY_INJECTION_MAX_BYTES } from '../agents/BaseAgent';
import { minSimilarityFloor } from '../memory/providers/SqliteMemoryProvider';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('SystemInfoService');

export interface AgentSummary {
  id: string;
  name: string;
  /** Empty = this agent has no tools (e.g. ConversationAgent). */
  allowedPlugins: string[];
  /** The model explicitly assigned to this agent, or null if none. */
  assignedModel: string | null;
}

export interface SystemStatus {
  /** Process uptime in whole seconds (real, from Node's process.uptime()). */
  uptimeSeconds: number;
  memory: {
    /** Stored memory row count, or null if it couldn't be read (never guessed). */
    rowCount: number | null;
    dbPath: string;
    /** DB file size in bytes, or null if the file doesn't exist / can't be stat'd. */
    dbSizeBytes: number | null;
    /** How many memories are auto-injected per turn — imported from BaseAgent, not duplicated. */
    injectionTopK: number;
    /** Byte cap on the auto-injected memory block — imported from BaseAgent, not duplicated. */
    injectionCapBytes: number;
    /** Minimum cosine similarity a memory must clear to be returned — imported live from the memory provider, not duplicated. */
    similarityFloor: number;
  };
  agents: AgentSummary[];
  /** This specific turn's already-resolved model/provider, when known. */
  currentTurn?: {
    agentId: string;
    model: string;
    providerId: string;
    providerName: string;
  };
}

function resolveDbPath(): string {
  // Mirrors Kernel.initPersistence()'s resolution exactly (same env var,
  // same default suffix) so this always reports the DB file actually in
  // use — not a guess at where it might be.
  return process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '../../data/luminary.db');
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export class SystemInfoService {
  /**
   * Build a real, verified snapshot. `currentTurn`, when supplied, is
   * THIS turn's already-resolved model/provider (passed in by the
   * caller rather than re-resolved here) so the report matches exactly
   * what the turn will actually use — no duplicate resolution, no risk
   * of reporting a stale or different model.
   */
  async getStatus(currentTurn?: SystemStatus['currentTurn']): Promise<SystemStatus> {
    const dbPath = resolveDbPath();

    let dbSizeBytes: number | null = null;
    try {
      dbSizeBytes = fs.statSync(dbPath).size;
    } catch {
      dbSizeBytes = null; // file doesn't exist yet / unreadable — never guess a size
    }

    let rowCount: number | null = null;
    try {
      rowCount = (await memoryService.stats()).total;
    } catch (err) {
      logger.warn('Could not read memory row count', { error: String(err) });
      rowCount = null;
    }

    // instanceof, not a cast: an agent that ever doesn't extend BaseAgent
    // is honestly reported as having no tools/assignment, never guessed.
    const agents: AgentSummary[] = agentRegistry.getAll().map((agent) => ({
      id: agent.id,
      name: agent.name,
      allowedPlugins: agent instanceof BaseAgent ? agent.getAllowedPlugins() : [],
      assignedModel: agent instanceof BaseAgent ? agent.getAssignedModel() : null,
    }));

    return {
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rowCount,
        dbPath,
        dbSizeBytes,
        injectionTopK: MEMORY_INJECTION_TOP_K,
        injectionCapBytes: MEMORY_INJECTION_MAX_BYTES,
        similarityFloor: minSimilarityFloor(),
      },
      agents,
      currentTurn,
    };
  }

  /** Render a SystemStatus as a compact, labelled block for a system prompt. */
  formatForPrompt(status: SystemStatus): string {
    const lines: string[] = [
      '## System status',
      '(Real, live values — when asked about your own capacity, configuration, or ' +
      'capabilities, answer from THIS block. Never estimate or invent a number.)',
    ];
    if (status.currentTurn) {
      lines.push(`- Model in use this turn: ${status.currentTurn.model} (via ${status.currentTurn.providerName})`);
    }
    const memLine = status.memory.rowCount === null
      ? 'Long-term memory: unknown (database unavailable)'
      : `Long-term memory: ${status.memory.rowCount} stored entr${status.memory.rowCount === 1 ? 'y' : 'ies'}` +
        (status.memory.dbSizeBytes !== null ? `, ${formatBytes(status.memory.dbSizeBytes)} on disk` : '') +
        ` (${status.memory.dbPath})`;
    lines.push(`- ${memLine}`);
    lines.push(
      `- Automatic recall per turn: top ${status.memory.injectionTopK} memories, minimum similarity ` +
      `${status.memory.similarityFloor}, capped at ~${Math.round(status.memory.injectionCapBytes / 1024)}KB of injected text.`,
    );
    lines.push(`- Process uptime: ${formatDuration(status.uptimeSeconds)}`);
    lines.push(
      `- Registered agents: ${status.agents
        .map((a) => `${a.name} (tools: ${a.allowedPlugins.length ? a.allowedPlugins.join(', ') : 'none'})`)
        .join('; ')}`,
    );
    return lines.join('\n');
  }
}

export const systemInfoService = new SystemInfoService();
