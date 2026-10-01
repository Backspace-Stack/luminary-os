// ============================================================
// Router — The central request dispatcher for Luminary OS.
//
// Request flow:
//   HTTP Layer → Router.route() → AgentRegistry.findCapable()
//   → IRouterStrategy.selectAgent() → IAgent.execute()
//   → AgentResponse → HTTP Layer
//
// The Router is the single entry point for ALL user requests.
// It has no knowledge of concrete agent implementations.
// ============================================================

import { agentRegistry } from '../core/registry/AgentRegistry';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { Logger } from '../core/logger/Logger';
import type { AgentRequest, AgentResponse, IAgent } from '../core/types/IAgent';
import type { IRouterStrategy } from './IRouterStrategy';
import { KeywordStrategy } from './strategies/KeywordStrategy';

const logger = Logger.scope('Router');

export interface RouterRequest extends AgentRequest {
  /** Optionally force a specific agent by ID (bypasses strategy). */
  targetAgentId?: string;
  /** Optionally force a specific routing strategy. */
  strategyOverride?: string;
}

export class RouterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'RouterError';
  }
}

export class Router {
  private static instance: Router;
  private strategy: IRouterStrategy;
  private fallbackAgentId: string | null = null;

  private constructor(strategy: IRouterStrategy = new KeywordStrategy()) {
    this.strategy = strategy;
  }

  static getInstance(): Router {
    if (!Router.instance) Router.instance = new Router();
    return Router.instance;
  }

  /** Swap the routing strategy at runtime. */
  setStrategy(strategy: IRouterStrategy): void {
    logger.info(`Routing strategy changed to: ${strategy.name}`);
    this.strategy = strategy;
  }

  /** Set a fallback agent ID used when no candidates match. */
  setFallback(agentId: string): void {
    this.fallbackAgentId = agentId;
  }

  /**
   * Select the agent that would handle a request, without executing it.
   * Used by streaming flows (chat) that dispatch to the agent's model
   * directly but still rely on the Router for agent selection.
   */
  selectAgent(request: RouterRequest): IAgent {
    if (request.targetAgentId) {
      const agent = agentRegistry.findById(request.targetAgentId);
      if (!agent) {
        throw new RouterError(`Target agent "${request.targetAgentId}" not found.`, 'AGENT_NOT_FOUND');
      }
      return agent;
    }

    const candidates = agentRegistry.findCapable(request);
    if (candidates.length === 0) {
      if (this.fallbackAgentId) {
        const fallback = agentRegistry.findById(this.fallbackAgentId);
        if (fallback) return fallback;
      }
      throw new RouterError('No agent is capable of handling this request.', 'NO_HANDLER');
    }

    const selected = this.strategy.selectAgent(candidates, request);
    if (!selected) throw new RouterError('Strategy returned no agent.', 'STRATEGY_ERROR');
    return selected;
  }

  /**
   * Route a request to the most appropriate agent and return its response.
   *
   * Steps:
   *   1. If targetAgentId is set, bypass strategy and go directly to that agent.
   *   2. Ask the AgentRegistry for all agents that canHandle() the request.
   *   3. Use the strategy to pick the best one.
   *   4. Call agent.execute() and return the response.
   */
  async route(request: RouterRequest): Promise<AgentResponse> {
    const start = Date.now();
    logger.debug('Routing request', { id: request.id, preview: request.content.slice(0, 80) });

    eventBus.emit(EVENTS.AGENT_REQUEST_RECEIVED, { requestId: request.id }, 'Router');

    // 1. Direct routing
    if (request.targetAgentId) {
      const agent = agentRegistry.findById(request.targetAgentId);
      if (!agent) {
        throw new RouterError(
          `Target agent "${request.targetAgentId}" not found.`,
          'AGENT_NOT_FOUND'
        );
      }
      return this.dispatch(agent, request, start);
    }

    // 2. Capability-based routing
    const candidates = agentRegistry.findCapable(request);

    if (candidates.length === 0) {
      // 3. Fallback
      if (this.fallbackAgentId) {
        const fallback = agentRegistry.findById(this.fallbackAgentId);
        if (fallback) {
          logger.info('No capable agent found — using fallback', { fallbackId: this.fallbackAgentId });
          return this.dispatch(fallback, request, start);
        }
      }

      eventBus.emit(EVENTS.ROUTER_NO_HANDLER, { requestId: request.id }, 'Router');
      throw new RouterError(
        'No agent is capable of handling this request.',
        'NO_HANDLER'
      );
    }

    // 4. Strategy selection
    const selected = this.strategy.selectAgent(candidates, request);
    if (!selected) {
      throw new RouterError('Strategy returned no agent.', 'STRATEGY_ERROR');
    }

    return this.dispatch(selected, request, start);
  }

  private async dispatch(agent: IAgent, request: RouterRequest, start: number): Promise<AgentResponse> {
    logger.info(`Dispatching to agent: ${agent.name}`, { agentId: agent.id, requestId: request.id });

    eventBus.emit(EVENTS.ROUTER_DISPATCHED, { agentId: agent.id, requestId: request.id }, 'Router');

    try {
      const response = await agent.execute(request);
      const durationMs = Date.now() - start;

      logger.debug('Agent response received', { agentId: agent.id, durationMs });
      eventBus.emit(EVENTS.AGENT_RESPONSE_SENT, { agentId: agent.id, requestId: request.id, durationMs }, 'Router');

      return { ...response, durationMs };
    } catch (err) {
      logger.error(`Agent "${agent.id}" threw during execute()`, { error: String(err) });
      eventBus.emit(EVENTS.AGENT_ERROR, { agentId: agent.id, requestId: request.id, error: String(err) }, 'Router');
      throw err;
    }
  }
}

export const router = Router.getInstance();
