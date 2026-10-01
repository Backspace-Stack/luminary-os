// ============================================================
// AgentService — Business logic for agent management.
//
// HTTP routes call this service. The service calls registries
// and the Router. Routes never touch registries directly.
// ============================================================

import { agentRegistry } from '../core/registry/AgentRegistry';
import { router } from '../router/Router';
import type { AgentMetadata, AgentRequest, AgentResponse } from '../core/types/IAgent';
import type { RouterRequest } from '../router/Router';
import { agentModelStore } from './AgentModelStore';
import { modelService } from './ModelService';
import { Logger } from '../core/logger/Logger';
import { randomUUID } from 'crypto';

const logger = Logger.scope('AgentService');

export class AgentService {

  /** Return metadata for all registered agents. */
  listAgents(): AgentMetadata[] {
    return agentRegistry.getAll().map((a) => a.getMetadata());
  }

  /** Return metadata for a single agent, or null if not found. */
  getAgent(id: string): AgentMetadata | null {
    return agentRegistry.findById(id)?.getMetadata() ?? null;
  }

  /** Activate an agent (set status to 'active'). */
  activateAgent(id: string): AgentMetadata {
    const agent = agentRegistry.findById(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);
    agent.setStatus('active');
    logger.info(`Agent activated: ${id}`);
    return agent.getMetadata();
  }

  /** Pause an agent (set status to 'idle'). */
  pauseAgent(id: string): AgentMetadata {
    const agent = agentRegistry.findById(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);
    agent.setStatus('idle');
    logger.info(`Agent paused: ${id}`);
    return agent.getMetadata();
  }

  /**
   * Assign a real installed model to an agent and persist the choice.
   * Validates against the live model list so a typo can't be stored.
   */
  async setAgentModel(id: string, model: string): Promise<AgentMetadata> {
    const agent = agentRegistry.findById(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);

    const installed = await modelService.listAllModels();
    const found = installed.find((m) => m.id === model) ?? installed.find((m) => m.name === model);
    if (!found) {
      throw new Error(
        `Model "${model}" is not installed. Install it from the Models page first.`
      );
    }
    if (found.runnable === false) {
      throw new Error(
        `Model "${found.name}" cannot run: the GGUF runtime is unavailable on this machine. ` +
        'Assign an Ollama model instead.'
      );
    }

    // Store the canonical id (Ollama tag, or GGUF file path)
    agentModelStore.set(id, found.id);
    logger.info(`Agent model updated: ${id} → ${found.id}`);
    return agent.getMetadata();
  }

  /**
   * Route a message through the Router and return the agent's response.
   * This is the primary entry point for all user interactions.
   */
  async routeMessage(
    content: string,
    sessionId: string,
    targetAgentId?: string,
    confirmedToolCallIds?: string[],
  ): Promise<AgentResponse> {
    const request: RouterRequest = {
      id: randomUUID(),
      sessionId,
      content,
      targetAgentId,
      confirmedToolCallIds,
      timestamp: new Date().toISOString(),
    };

    logger.info('Routing message', { requestId: request.id, targetAgentId });
    return router.route(request);
  }

  /**
   * Inspect which agent would handle a given message without executing it.
   * Useful for the UI to show routing decisions.
   */
  previewRouting(content: string): { agentId: string; agentName: string; score: string } | null {
    const mockRequest: AgentRequest = {
      id: 'preview',
      sessionId: 'preview',
      content,
      timestamp: new Date().toISOString(),
    };
    const candidates = agentRegistry.findCapable(mockRequest);
    if (!candidates.length) return null;
    const first = candidates[0];
    return { agentId: first.id, agentName: first.name, score: `${candidates.length} candidate(s)` };
  }
}

export const agentService = new AgentService();
