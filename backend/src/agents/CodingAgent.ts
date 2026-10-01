import { BaseAgent } from './BaseAgent';
import type { AgentRequest, AgentCapability } from '../core/types/IAgent';
import type { ModelRegistry } from '../core/registry/ModelRegistry';

export class CodingAgent extends BaseAgent {
  readonly id = 'coding-agent';
  readonly name = 'Coding Agent';
  readonly role = 'Coding';
  readonly description =
    'Specializes in code generation, review, debugging, refactoring, and software architecture guidance.';
  readonly systemPrompt =
    'You are the Coding Agent of Luminary OS, an expert software engineer. ' +
    'Write correct, idiomatic code. Always put code in fenced Markdown blocks with the language tag. ' +
    'Explain briefly; prefer working code over prose. ' +
    'You may run sandboxed shell commands via the "exec" tool (allowed binaries only, e.g. ls, cat, pwd, echo, node, git, npm) ' +
    'and read/write/list/delete files via the file tools, in the sandbox or any allowed real folder. ' +
    'Use "readFolderTree" to understand a folder\'s structure before acting on it. ' +
    'You can also open an http/https URL in the default browser ("openUrl") and control media playback ("playPause", "next", "previous"). ' +
    'Writing or deleting a file pauses for the user to approve before it happens — propose the action and let it be confirmed. ' +
    'Use these when you genuinely need to inspect or change files; report real tool output honestly and never invent results.';

  /** CodingAgent may drive the sandboxed terminal, filesystem, browser, memory, and system-info tools. */
  protected readonly allowedPlugins = ['terminal-plugin', 'file-plugin', 'browser-plugin', 'memory-plugin', 'systeminfo-plugin'];

  readonly capabilities: AgentCapability[] = [
    {
      name: 'code-generation',
      description: 'Generate code from natural language descriptions',
      triggerKeywords: ['write code', 'implement', 'create a function', 'generate', 'code', 'script', 'class', 'module'],
    },
    {
      name: 'code-review',
      description: 'Review code for bugs, style, and best practices',
      triggerKeywords: ['review', 'check my code', 'code review', 'pr', 'pull request', 'refactor'],
    },
    {
      name: 'debugging',
      description: 'Debug errors and fix issues',
      triggerKeywords: ['debug', 'fix', 'error', 'bug', 'exception', 'crash', 'broken', 'not working'],
    },
    {
      name: 'architecture',
      description: 'Software design and architecture guidance',
      triggerKeywords: ['architecture', 'design pattern', 'structure', 'system design', 'schema'],
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
