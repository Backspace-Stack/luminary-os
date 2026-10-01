import { BaseAgent } from './BaseAgent';
import type { AgentRequest, AgentCapability } from '../core/types/IAgent';
import type { ModelRegistry } from '../core/registry/ModelRegistry';

export class ConversationAgent extends BaseAgent {
  readonly id = 'conversation-agent';
  readonly name = 'Conversation Agent';
  readonly role = 'Conversation';
  readonly description =
    'Handles natural language conversations, general Q&A, and user interactions with contextual memory and session awareness.';
  readonly systemPrompt =
    'You are the Conversation Agent of Luminary OS, a helpful local AI assistant. ' +
    'Answer clearly and concisely. Use Markdown formatting where it improves readability.';

  readonly capabilities: AgentCapability[] = [
    {
      name: 'natural-language',
      description: 'General conversation and Q&A',
      triggerKeywords: ['hello', 'hi', 'what', 'how', 'why', 'when', 'who', 'explain', 'tell me', 'can you', 'help'],
    },
    {
      name: 'summarisation',
      description: 'Summarise text or content',
      triggerKeywords: ['summarise', 'summarize', 'summary', 'tldr', 'overview', 'brief'],
    },
    {
      name: 'translation',
      description: 'Translate between languages',
      triggerKeywords: ['translate', 'translation', 'in french', 'in spanish', 'in hindi'],
    },
  ];

  constructor(modelRegistry: ModelRegistry) {
    super(modelRegistry);
  }

  canHandle(_request: AgentRequest): boolean {
    // Conversation agent is the default handler — accepts everything
    // that more specific agents don't claim.
    return true;
  }
}
