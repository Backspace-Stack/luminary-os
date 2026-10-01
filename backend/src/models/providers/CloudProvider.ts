// ============================================================
// CloudProvider — one neutral IModelProvider adapter for the supported
// hosted API formats. It intentionally uses no SDKs: keys stay in the
// existing secret store and the wire formats remain explicit/auditable.
// ============================================================

import type {
  ChatStreamOptions, ChatStreamResult, ChatTurn, CompletionOptions,
  CompletionResponse, EmbeddingOptions, EmbeddingResponse, IModelProvider,
  ModelInfo, ProviderHealth, ToolCall, ToolChatOptions, ToolChatResult,
  ToolDefinition,
} from '../../core/types/IModelProvider';
import { secretsService } from '../../services/SecretsService';

type CloudKind = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'nvidia';
type WireFormat = 'anthropic' | 'openai' | 'gemini';

interface CloudConfig {
  kind: CloudKind;
  label: string;
  secretId: string;
  baseUrl: string;
  wireFormat: WireFormat;
}

const CONFIGS: Record<CloudKind, CloudConfig> = {
  anthropic: {
    kind: 'anthropic', label: 'Anthropic', secretId: 'anthropic_api_key',
    baseUrl: 'https://api.anthropic.com/v1', wireFormat: 'anthropic',
  },
  openai: {
    kind: 'openai', label: 'OpenAI', secretId: 'openai_api_key',
    baseUrl: 'https://api.openai.com/v1', wireFormat: 'openai',
  },
  gemini: {
    kind: 'gemini', label: 'Google Gemini', secretId: 'gemini_api_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', wireFormat: 'gemini',
  },
  deepseek: {
    kind: 'deepseek', label: 'DeepSeek', secretId: 'deepseek_api_key',
    baseUrl: 'https://api.deepseek.com', wireFormat: 'openai',
  },
  nvidia: {
    kind: 'nvidia', label: 'NVIDIA NIM', secretId: 'nvidia_api_key',
    baseUrl: 'https://integrate.api.nvidia.com/v1', wireFormat: 'openai',
  },
};

interface OpenAiResponse {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface AnthropicResponse {
  model?: string;
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface GeminiPart {
  text?: string;
  /** Gemini attaches the signature to the Part, not functionCall itself. */
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
}
interface GeminiResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class CloudProviderError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
    this.name = 'CloudProviderError';
  }
}

/** Converts unknown tool-result JSON into an object Gemini accepts. */
function toolResultObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { result: parsed };
  } catch {
    return { result: content };
  }
}

function modelType(id: string): ModelInfo['type'] {
  return /code|coder/i.test(id) ? 'coding' : 'general';
}

export class CloudProvider implements IModelProvider {
  readonly id: string;
  readonly name: string;
  private readonly config: CloudConfig;

  constructor(kind: CloudKind) {
    this.config = CONFIGS[kind];
    this.id = `cloud-${kind}`;
    this.name = `${this.config.label} Cloud Provider`;
  }

  static createAll(): CloudProvider[] {
    return (Object.keys(CONFIGS) as CloudKind[]).map((kind) => new CloudProvider(kind));
  }

  private key(): string {
    const key = secretsService.resolve(this.config.secretId);
    if (!key) throw new CloudProviderError(`${this.config.label} API key is not configured. Add it in Settings → Integrations.`, 401);
    return key;
  }

  private headers(key = this.key()): Record<string, string> {
    if (this.config.wireFormat === 'anthropic') {
      return { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    }
    if (this.config.wireFormat === 'gemini') {
      return { 'content-type': 'application/json', 'x-goog-api-key': key };
    }
    return { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...init.headers }, signal });
    } catch (err) {
      if (init.signal?.aborted) throw err;
      if (timeout.aborted) throw new CloudProviderError(`${this.config.label} request timed out after ${timeoutMs}ms.`);
      throw new CloudProviderError(`Cannot reach ${this.config.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as { error?: { message?: string } | string; message?: string };
        detail = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? detail;
      } catch { /* retain the status without exposing request headers */ }
      throw new CloudProviderError(`${this.config.label} API request failed: ${detail}`, response.status);
    }
    return response;
  }

  private publicModel(remoteId: string, name = remoteId, contextLength = 0): ModelInfo {
    return {
      id: `${this.id}:${remoteId}`, remoteId, name, family: this.config.label,
      sizeLabel: 'Cloud', type: modelType(remoteId), status: 'loaded', quantization: 'Cloud',
      contextLength, providerId: this.id, runnable: Boolean(secretsService.resolve(this.config.secretId)),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!secretsService.resolve(this.config.secretId)) {
      return { status: 'disconnected', message: `${this.config.label} API key is not configured.`, checkedAt: new Date().toISOString() };
    }
    try {
      await this.listRemoteModels();
      return { status: 'connected', latencyMs: Date.now() - start, message: `${this.config.label} API credentials accepted.`, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err), checkedAt: new Date().toISOString() };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!secretsService.resolve(this.config.secretId)) {
      return [];
    }
    try {
      // Never show guesses or a public catalog. This is deliberately the
      // provider's live, key-scoped model list, so it reflects the account
      // and tier that will actually be billed and allowed to run.
      return await this.listRemoteModels();
    } catch {
      // Authentication/listing failed: do not advertise models the key may
      // not be entitled to use. healthCheck exposes the actual error.
      return [];
    }
  }

  private async listRemoteModels(): Promise<ModelInfo[]> {
    if (this.config.wireFormat === 'gemini') {
      const json = await (await this.request('/models', { method: 'GET' }, 15_000)).json() as {
        models?: Array<{ name?: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }>;
      };
      return (json.models ?? [])
        .filter((m) => m.name && m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => this.publicModel(m.name!.replace(/^models\//, ''), m.displayName, m.inputTokenLimit));
    }
    const json = await (await this.request('/models', { method: 'GET' }, 15_000)).json() as { data?: Array<{ id?: string; display_name?: string }> };
    return (json.data ?? [])
      .filter((m) => m.id && this.supportsChatModel(m.id))
      .map((m) => this.publicModel(m.id!, m.display_name ?? m.id));
  }

  private supportsChatModel(id: string): boolean {
    if (this.config.kind === 'openai') return /^(gpt|o[0-9])[-_]/i.test(id);
    return true;
  }

  async loadModel(_modelId: string): Promise<void> {
    throw new CloudProviderError('Cloud models are managed by their provider and cannot be loaded locally.', 400);
  }

  async unloadModel(_modelId: string): Promise<void> {
    throw new CloudProviderError('Cloud models are managed by their provider and cannot be unloaded locally.', 400);
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    const messages: ChatTurn[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const result = await this.chat(messages, options, []);
    return { content: result.content, model: options.model, providerId: this.id, promptTokens: result.promptTokens, completionTokens: result.completionTokens, durationMs: result.durationMs, finishReason: result.finishReason };
  }

  async chatStream(messages: ChatTurn[], options: ChatStreamOptions, onToken: (token: string) => void): Promise<ChatStreamResult> {
    const result = await this.chat(messages, options, []);
    // The non-streaming formats still return a real cloud response; emit it
    // atomically rather than inventing token boundaries.
    if (result.content) onToken(result.content);
    return { ...result, tokensPerSecond: result.completionTokens && result.durationMs ? Math.round((result.completionTokens / (result.durationMs / 1000)) * 10) / 10 : undefined };
  }

  supportsTools(): boolean {
    // Catalogued models use the documented function-calling formats. A model
    // that rejects a format returns its upstream error; no tool output is forged.
    return true;
  }

  async chatWithTools(messages: ChatTurn[], tools: ToolDefinition[], options: ToolChatOptions): Promise<ToolChatResult> {
    return this.chat(messages, options, tools);
  }

  private async chat(messages: ChatTurn[], options: Pick<CompletionOptions, 'model' | 'temperature' | 'maxTokens' | 'topP' | 'stopSequences'> & { signal?: AbortSignal }, tools: ToolDefinition[]): Promise<ToolChatResult> {
    const start = Date.now();
    try {
      if (this.config.wireFormat === 'anthropic') return await this.anthropicChat(messages, options, tools, start);
      if (this.config.wireFormat === 'gemini') return await this.geminiChat(messages, options, tools, start);
      return await this.openAiChat(messages, options, tools, start);
    } catch (err) {
      if (options.signal?.aborted) return { content: '', toolCalls: [], model: options.model, providerId: this.id, durationMs: Date.now() - start, aborted: true, finishReason: 'error' };
      throw err;
    }
  }

  private async openAiChat(messages: ChatTurn[], options: Pick<CompletionOptions, 'model' | 'temperature' | 'maxTokens' | 'topP' | 'stopSequences'> & { signal?: AbortSignal }, tools: ToolDefinition[], start: number): Promise<ToolChatResult> {
    const json = await (await this.request('/chat/completions', {
      method: 'POST', signal: options.signal,
      body: JSON.stringify({ model: options.model, messages: this.toOpenAiMessages(messages), ...(tools.length ? { tools, tool_choice: 'auto' } : {}), ...(options.temperature !== undefined ? { temperature: options.temperature } : {}), ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}), ...(options.topP !== undefined ? { top_p: options.topP } : {}), ...(options.stopSequences ? { stop: options.stopSequences } : {}) }),
    })).json() as OpenAiResponse;
    const message = json.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).flatMap((call): ToolCall[] => {
      const name = call.function?.name;
      if (!name) return [];
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>; } catch { args = { _raw: call.function?.arguments ?? '' }; }
      return [{ id: call.id, name, arguments: args }];
    });
    return { content: message?.content ?? '', toolCalls, model: json.model ?? options.model, providerId: this.id, promptTokens: json.usage?.prompt_tokens, completionTokens: json.usage?.completion_tokens, durationMs: Date.now() - start, aborted: false, finishReason: json.choices?.[0]?.finish_reason === 'length' ? 'length' : 'stop' };
  }

  private toOpenAiMessages(messages: ChatTurn[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
      if (m.role === 'assistant' && m.toolCalls?.length) return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) };
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? m.toolName, content: m.content };
      return { role: m.role, content: m.content };
    });
  }

  private async anthropicChat(messages: ChatTurn[], options: Pick<CompletionOptions, 'model' | 'temperature' | 'maxTokens' | 'topP' | 'stopSequences'> & { signal?: AbortSignal }, tools: ToolDefinition[], start: number): Promise<ToolChatResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const json = await (await this.request('/messages', {
      method: 'POST', signal: options.signal,
      body: JSON.stringify({ model: options.model, max_tokens: options.maxTokens ?? 4096, ...(system ? { system } : {}), messages: this.toAnthropicMessages(messages.filter((m) => m.role !== 'system')), ...(tools.length ? { tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) } : {}), ...(options.temperature !== undefined ? { temperature: options.temperature } : {}), ...(options.topP !== undefined ? { top_p: options.topP } : {}), ...(options.stopSequences ? { stop_sequences: options.stopSequences } : {}) }),
    })).json() as AnthropicResponse;
    const blocks = json.content ?? [];
    return { content: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''), toolCalls: blocks.filter((b) => b.type === 'tool_use' && b.name).map((b) => ({ id: b.id, name: b.name!, arguments: b.input ?? {} })), model: json.model ?? options.model, providerId: this.id, promptTokens: json.usage?.input_tokens, completionTokens: json.usage?.output_tokens, durationMs: Date.now() - start, aborted: false, finishReason: json.stop_reason === 'max_tokens' ? 'length' : 'stop' };
  }

  private toAnthropicMessages(messages: ChatTurn[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        const previous = out[out.length - 1];
        const block = { type: 'tool_result', tool_use_id: m.toolCallId ?? m.toolName, content: m.content };
        if (previous?.role === 'user' && Array.isArray(previous.content)) (previous.content as unknown[]).push(block);
        else out.push({ role: 'user', content: [block] });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        out.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments ?? {} }))] });
      } else {
        out.push({ role: m.role, content: m.content });
      }
    }
    return out;
  }

  private async geminiChat(messages: ChatTurn[], options: Pick<CompletionOptions, 'model' | 'temperature' | 'maxTokens' | 'topP' | 'stopSequences'> & { signal?: AbortSignal }, tools: ToolDefinition[], start: number): Promise<ToolChatResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const json = await (await this.request(`/models/${encodeURIComponent(options.model)}:generateContent`, {
      method: 'POST', signal: options.signal,
      body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: this.toGeminiContents(messages.filter((m) => m.role !== 'system')), ...(tools.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }] } : {}), generationConfig: { ...(options.temperature !== undefined ? { temperature: options.temperature } : {}), ...(options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}), ...(options.topP !== undefined ? { topP: options.topP } : {}), ...(options.stopSequences ? { stopSequences: options.stopSequences } : {}) } }),
    })).json() as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = parts.flatMap((p): ToolCall[] => p.functionCall?.name ? [{ id: p.functionCall.id, name: p.functionCall.name, arguments: p.functionCall.args ?? {}, providerData: p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : undefined }] : []);
    return { content: parts.map((p) => p.text ?? '').join(''), toolCalls, model: options.model, providerId: this.id, promptTokens: json.usageMetadata?.promptTokenCount, completionTokens: json.usageMetadata?.candidatesTokenCount, durationMs: Date.now() - start, aborted: false, finishReason: json.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop' };
  }

  private toGeminiContents(messages: ChatTurn[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        const previous = out[out.length - 1];
        const part = { functionResponse: { name: m.toolName, response: toolResultObject(m.content), ...(m.toolCallId ? { id: m.toolCallId } : {}) } };
        if (previous?.role === 'user') (previous.parts as unknown[]).push(part);
        else out.push({ role: 'user', parts: [part] });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        out.push({ role: 'model', parts: [...(m.content ? [{ text: m.content }] : []), ...m.toolCalls.map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.arguments ?? {} }, ...((c.providerData as { thoughtSignature?: string } | undefined)?.thoughtSignature ? { thoughtSignature: (c.providerData as { thoughtSignature: string }).thoughtSignature } : {}) }))] });
      } else {
        out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      }
    }
    return out;
  }

  async embed(_options: EmbeddingOptions): Promise<EmbeddingResponse> {
    throw new CloudProviderError(`${this.config.label} embedding is not configured for this provider. Local Ollama embeddings remain in use.`, 501);
  }
}
