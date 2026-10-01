// ============================================================
// AgentModelStore — Persisted agent → model assignments.
//
// The user picks a real installed Ollama model for each agent
// on the Agents page. The choice is stored on disk so it
// survives app restarts. No model names are hardcoded anywhere:
// when an agent has no explicit assignment, callers fall back
// to the first model installed in Ollama at runtime.
// ============================================================

import { JsonStore } from '../core/persistence/JsonStore';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('AgentModelStore');

type AssignmentMap = Record<string, string>;

export class AgentModelStore {
  private store = new JsonStore<AssignmentMap>('agent-models.json', {});
  private assignments: AssignmentMap;

  constructor() {
    this.assignments = this.store.load();
  }

  /** The explicitly assigned model for an agent, or null. */
  get(agentId: string): string | null {
    return this.assignments[agentId] ?? null;
  }

  set(agentId: string, model: string): void {
    this.assignments[agentId] = model;
    this.store.save(this.assignments);
    logger.info(`Model assigned: ${agentId} → ${model}`);
  }

  clear(agentId: string): void {
    delete this.assignments[agentId];
    this.store.save(this.assignments);
  }

  all(): AssignmentMap {
    return { ...this.assignments };
  }
}

export const agentModelStore = new AgentModelStore();
