// ============================================================
// AgentRegistry — Central registry for all IAgent instances.
//
// The Router queries this registry to find capable agents.
// Agents register themselves here during Kernel bootstrap.
// ============================================================

import type { IAgent, AgentRequest } from '../types/IAgent';
import { eventBus, EVENTS } from '../events/EventBus';
import { Logger } from '../logger/Logger';

const logger = Logger.scope('AgentRegistry');

export class AgentRegistry {
  private static instance: AgentRegistry;
  private agents = new Map<string, IAgent>();

  private constructor() {}

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) AgentRegistry.instance = new AgentRegistry();
    return AgentRegistry.instance;
  }

  /**
   * Register an agent. Throws if an agent with the same ID is already registered.
   */
  register(agent: IAgent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered.`);
    }
    this.agents.set(agent.id, agent);
    logger.info(`Registered agent: ${agent.name}`, { id: agent.id, role: agent.role });
    eventBus.emit(EVENTS.AGENT_REGISTERED, { agentId: agent.id, agentName: agent.name }, 'AgentRegistry');
  }

  /** Deregister an agent by ID. */
  unregister(id: string): boolean {
    const removed = this.agents.delete(id);
    if (removed) logger.info(`Unregistered agent: ${id}`);
    return removed;
  }

  /** Get all registered agents. */
  getAll(): IAgent[] {
    return Array.from(this.agents.values());
  }

  /** Find a single agent by ID. */
  findById(id: string): IAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * Return all agents that report canHandle() === true for the request.
   * Agents are evaluated in registration order.
   */
  findCapable(request: AgentRequest): IAgent[] {
    return this.getAll().filter((agent) => {
      try {
        return agent.canHandle(request);
      } catch (err) {
        logger.warn(`canHandle() threw for agent "${agent.id}"`, { error: String(err) });
        return false;
      }
    });
  }

  /** Total number of registered agents. */
  count(): number {
    return this.agents.size;
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }
}

export const agentRegistry = AgentRegistry.getInstance();
