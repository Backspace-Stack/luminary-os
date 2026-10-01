import { BaseAgent } from './BaseAgent';
import type { AgentRequest, AgentCapability } from '../core/types/IAgent';
import type { ModelRegistry } from '../core/registry/ModelRegistry';

export class ResearchAgent extends BaseAgent {
  readonly id = 'research-agent';
  readonly name = 'Research Agent';
  readonly role = 'Research';
  readonly description =
    'Performs deep research, information synthesis, and generates structured reports. Can search the web (Tavily) and read/write sandbox files.';
  readonly systemPrompt =
    'You are the Research Agent of Luminary OS. Synthesize information carefully, ' +
    'structure answers with Markdown headings and lists, and clearly separate facts from inference. ' +
    'You can search the web with the "search" tool for anything you cannot know from training alone (current events, recent facts) — ' +
    'use it and cite the source URLs it returns. If a search fails, say so honestly rather than guessing. ' +
    'You can also read and write files in the sandbox; writes and deletes pause for user approval before running. ' +
    'When the user asks you to save something to their notes ("add this to my notes", "note that down"), ' +
    'actually do it with the note tools — call listNotes to see what exists, then appendToNote if one of ' +
    'them is clearly the right home for it, or createNote with a short title drawn from the subject if none is. ' +
    'Never claim something was saved unless the tool call succeeded.';

  /** ResearchAgent may search the web, use the sandbox filesystem, memory, notes, and system-info tools. */
  protected readonly allowedPlugins = ['file-plugin', 'tavily-plugin', 'memory-plugin', 'notes-plugin', 'systeminfo-plugin'];

  readonly capabilities: AgentCapability[] = [
    {
      name: 'research',
      description: 'Research a topic and synthesize findings',
      triggerKeywords: ['research', 'investigate', 'find out', 'look into', 'explore', 'study', 'analyse', 'analyze'],
    },
    {
      name: 'web-search',
      description: 'Search the web for current information',
      triggerKeywords: ['search', 'google', 'look up', 'find', 'latest', 'current', 'news', 'recent'],
    },
    {
      name: 'report-generation',
      description: 'Generate a structured report on a subject',
      triggerKeywords: ['report', 'write a report', 'document', 'brief', 'analysis', 'findings'],
    },
    {
      name: 'paper-reading',
      description: 'Read and summarize academic papers',
      triggerKeywords: ['paper', 'arxiv', 'academic', 'publication', 'journal', 'doi'],
    },
  ];

  constructor(modelRegistry: ModelRegistry) {
    super(modelRegistry);
  }

  canHandle(request: AgentRequest): boolean {
    const content = request.content.toLowerCase();
    return this.capabilities.some((cap) =>
      cap.triggerKeywords.some((kw) => content.includes(kw))
    );
  }
}
