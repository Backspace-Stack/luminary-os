// ============================================================
// IRouterStrategy — Contract for agent-selection algorithms.
//
// The Router delegates the "which agent?" decision to a
// strategy object. This makes routing logic fully swappable:
// keyword matching today, LLM-based classification tomorrow.
// ============================================================

import type { IAgent, AgentRequest } from '../core/types/IAgent';

export interface IRouterStrategy {
  readonly name: string;

  /**
   * Given a set of candidate agents and the incoming request,
   * return the single best agent to handle it.
   * Returns null if no suitable agent is found.
   */
  selectAgent(candidates: IAgent[], request: AgentRequest): IAgent | null;
}
