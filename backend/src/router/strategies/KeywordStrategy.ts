// ============================================================
// KeywordStrategy — Keyword-based agent selection.
//
// Scores each candidate agent by counting how many of its
// capability trigger-keywords appear in the request content.
// The highest-scoring agent wins. Falls back to the first
// agent that returned canHandle() = true.
//
// This is intentionally simple — a future LLMRoutingStrategy
// can replace it without changing the Router.
// ============================================================

import type { IAgent, AgentRequest } from '../../core/types/IAgent';
import type { IRouterStrategy } from '../IRouterStrategy';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('KeywordStrategy');

export class KeywordStrategy implements IRouterStrategy {
  readonly name = 'keyword';

  selectAgent(candidates: IAgent[], request: AgentRequest): IAgent | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const content = request.content.toLowerCase();

    const scored = candidates.map((agent) => {
      const score = agent.capabilities.reduce((total, cap) => {
        const hits = cap.triggerKeywords.filter((kw) =>
          content.includes(kw.toLowerCase())
        ).length;
        return total + hits;
      }, 0);
      return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const winner = scored[0];
    logger.debug('Agent selected by keyword scoring', {
      winner: winner.agent.name,
      score: winner.score,
      candidates: scored.map((s) => ({ name: s.agent.name, score: s.score })),
    });

    return winner.agent;
  }
}
