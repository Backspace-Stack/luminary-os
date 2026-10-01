// ============================================================
// GgufRuntime — Real in-process GGUF inference via node-llama-cpp.
//
// Nothing here is faked: models are genuinely loaded into memory
// (llama.cpp under the hood, GPU-accelerated where available) and
// every token comes from real inference. If node-llama-cpp cannot
// initialise on this machine, the runtime reports itself
// unavailable with the real reason — models are then listed but
// not runnable.
//
// node-llama-cpp v3 is ESM-only; this CommonJS backend loads it
// through a dynamic import that survives TypeScript's CJS
// transform (see importEsm below).
// ============================================================

import type { ChatTurn, ChatStreamResult } from '../../core/types/IModelProvider';
import { eventBus, EVENTS } from '../../core/events/EventBus';
import { Logger } from '../../core/logger/Logger';
import path from 'path';
import fs from 'fs';
import type { Llama, LlamaModel, ChatHistoryItem } from 'node-llama-cpp';
import { ModelTaskQueue } from './ModelTaskQueue';

const logger = Logger.scope('GgufRuntime');

// TypeScript compiles `import()` to `require()` under CommonJS,
// which cannot load ESM packages — this keeps it a real import().
const importEsm = new Function('specifier', 'return import(specifier)') as
  (specifier: 'node-llama-cpp') => Promise<typeof import('node-llama-cpp')>;

/** Injectable native module boundary; production always uses node-llama-cpp. */
export type GgufNativeModule = Pick<typeof import('node-llama-cpp'), 'getLlama' | 'LlamaChatSession'>;

export interface RuntimeStatus {
  available: boolean;
  message: string;
  /** e.g. "vulkan", "cuda", "metal", false (CPU) — from llama.gpu */
  gpu?: string | false;
}

export interface LoadedGgufModel {
  filePath: string;
  name: string;
  sizeBytes: number;
  loadedAt: string;
}

export class GgufRuntimeError extends Error {
  constructor(message: string, public readonly statusCode = 501) {
    super(message);
    this.name = 'GgufRuntimeError';
  }
}

export class GgufRuntime {
  constructor(private readonly importNative: () => Promise<GgufNativeModule> = () => importEsm('node-llama-cpp')) {}

  private llama: Llama | null = null;
  private status: RuntimeStatus = { available: false, message: 'Runtime not probed yet' };
  private probed = false;
  private probePromise: Promise<RuntimeStatus> | null = null;
  private models = new Map<string, { model: LlamaModel; loadedAt: string; sizeBytes: number }>();
  /**
   * One runtime-wide queue owns loading, inference and disposal. GPU fallback
   * can evict every loaded model, so separate per-model queues are insufficient.
   */
  private busy = new ModelTaskQueue();

  private withNative<T>(task: () => Promise<T>): Promise<T> {
    return this.busy.run('runtime', task);
  }

  /** Initialise node-llama-cpp once; honest failure if unavailable. */
  probe(): Promise<RuntimeStatus> {
    if (this.probed) return Promise.resolve(this.status);
    if (this.probePromise) return this.probePromise;

    this.probePromise = (async () => {
      try {
        const { getLlama } = await this.importNative();
        this.llama = await getLlama();
        const gpu = this.llama.gpu as string | false;
        this.status = {
          available: true,
          message: `node-llama-cpp ready (${gpu ? `GPU: ${gpu}` : 'CPU'})`,
          gpu,
        };
        logger.info(`GGUF runtime available — ${this.status.message}`);
      } catch (err) {
        this.status = {
          available: false,
          message: `node-llama-cpp could not initialise: ${err instanceof Error ? err.message : String(err)}`,
        };
        logger.warn(`GGUF runtime unavailable`, { error: this.status.message });
      }
      this.probed = true;
      this.probePromise = null;
      return this.status;
    })();
    return this.probePromise;
  }

  getStatus(): RuntimeStatus {
    return { ...this.status };
  }

  isAvailable(): boolean {
    return this.status.available;
  }

  isLoaded(filePath: string): boolean {
    return this.models.has(path.resolve(filePath));
  }

  listLoaded(): LoadedGgufModel[] {
    return Array.from(this.models.entries()).map(([filePath, m]) => ({
      filePath,
      name: path.basename(filePath),
      sizeBytes: m.sizeBytes,
      loadedAt: m.loadedAt,
    }));
  }

  private requireAvailable(): void {
    if (!this.status.available) {
      throw new GgufRuntimeError(
        `GGUF runtime is not available: ${this.status.message}`
      );
    }
  }

  /** Load a .gguf file into memory for real. Idempotent per path. */
  loadModel(filePath: string): Promise<void> {
    return this.withNative(() => this.loadModelOwned(filePath));
  }

  /** Internal helpers run only while the runtime queue is owned; never requeue. */
  private async loadModelOwned(filePath: string): Promise<void> {
    await this.probe();
    this.requireAvailable();
    const key = path.resolve(filePath);
    if (this.models.has(key)) return;
    if (!fs.existsSync(key)) {
      throw new GgufRuntimeError(`GGUF file not found: ${key}`, 404);
    }
    const sizeBytes = fs.statSync(key).size;

    logger.info(`Loading GGUF model: ${key}`);
    const start = Date.now();
    const llama = this.llama;
    if (!llama) throw new GgufRuntimeError('GGUF runtime is not initialized.');
    let model: LlamaModel | undefined;
    try {
      model = await llama.loadModel({ modelPath: key });
    } catch (err) {
      // GPU out of memory (large model, shared VRAM, other models
      // loaded…) — fall back to CPU instead of failing. Slower,
      // but the model genuinely runs.
      // node-llama-cpp reports GPU failures with generic messages
      // (the real cause goes to stderr), so treat every load
      // failure the same way: evict, retry GPU, then run on CPU.
      const msg = err instanceof Error ? err.message : String(err);
      if (this.models.size > 0) {
        logger.warn(`Load failed for ${path.basename(key)} — evicting ${this.models.size} loaded model(s) and retrying`);
        await this.unloadAllOwned();
        try {
          model = await llama.loadModel({ modelPath: key });
        } catch { /* still failing — CPU below */ }
      }
      if (!model) {
        logger.warn(`GPU load failed for ${path.basename(key)} — running on CPU instead`, { error: msg.slice(0, 200) });
        try {
          model = await llama.loadModel({ modelPath: key, gpuLayers: 0 });
        } catch (cpuErr) {
          const cpuMsg = cpuErr instanceof Error ? cpuErr.message : String(cpuErr);
          throw new GgufRuntimeError(
            `Could not load "${path.basename(key)}" (GPU failed: ${msg.slice(0, 120)}; CPU failed: ${cpuMsg.slice(0, 120)})`, 500);
        }
      }
    }
    this.models.set(key, {
      model,
      loadedAt: new Date().toISOString(),
      sizeBytes,
    });
    logger.info(`GGUF model loaded in ${Date.now() - start}ms: ${path.basename(key)}`);
    eventBus.emit(EVENTS.MODEL_LOADED, { modelId: key, providerId: 'local' }, 'GgufRuntime');
  }

  /** Unload and free the model's memory for real. */
  unloadModel(filePath: string): Promise<void> {
    return this.withNative(() => this.unloadModelOwned(filePath));
  }

  private async unloadModelOwned(filePath: string): Promise<void> {
    const key = path.resolve(filePath);
    const entry = this.models.get(key);
    if (!entry) return;
    await entry.model.dispose();
    this.models.delete(key);
    logger.info(`GGUF model unloaded: ${path.basename(key)}`);
    eventBus.emit(EVENTS.MODEL_UNLOADED, { modelId: key, providerId: 'local' }, 'GgufRuntime');
  }

  unloadAll(): Promise<void> {
    return this.withNative(() => this.unloadAllOwned());
  }

  private async unloadAllOwned(): Promise<void> {
    for (const key of Array.from(this.models.keys())) {
      await this.unloadModelOwned(key);
    }
  }

  /**
   * Real streaming chat. Loads the model on demand (kept loaded
   * after), replays the conversation history, and streams tokens
   * from llama.cpp. Supports abort via signal.
   */
  async chatStream(
    filePath: string,
    messages: ChatTurn[],
    options: { signal?: AbortSignal; temperature?: number },
    onToken: (token: string) => void,
  ): Promise<ChatStreamResult> {
    const key = path.resolve(filePath);

    // Keep the model owned from its load through final context disposal.
    return this.withNative(async (): Promise<ChatStreamResult> => {
      if (options.signal?.aborted) {
        return { content: '', model: path.basename(key), providerId: 'local', durationMs: 0, aborted: true };
      }
      await this.loadModelOwned(filePath);
      const { model } = this.models.get(key)!;
      const { LlamaChatSession } = await this.importNative();

      const start = Date.now();
      const systemPrompt = messages.find((m) => m.role === 'system')?.content;
      const turns = messages.filter((m) => m.role !== 'system');

      // History = everything before the final prompt turn
      let promptText: string;
      const history = [...turns];
      const last = history[history.length - 1];
      if (last?.role === 'user') {
        history.pop();
        promptText = last.content;
      } else {
        // 'continue' flow: history ends with an assistant message.
        // llama.cpp chat sessions need a user turn to generate, so
        // continuation is requested explicitly — real inference,
        // slightly different mechanics than Ollama's prefill.
        promptText = 'Continue your previous response from exactly where it stopped. Do not repeat anything you already wrote.';
      }

      const context = await model.createContext({
        contextSize: Math.min(4096, model.trainContextSize || 4096),
      });
      try {
        const session = new LlamaChatSession({
          contextSequence: context.getSequence(),
          ...(systemPrompt && { systemPrompt }),
        });

        if (history.length > 0) {
          const chatHistory: ChatHistoryItem[] = [];
          if (systemPrompt) chatHistory.push({ type: 'system', text: systemPrompt });
          for (const turn of history) {
            if (turn.role === 'user') chatHistory.push({ type: 'user', text: turn.content });
            else chatHistory.push({ type: 'model', response: [turn.content] });
          }
          session.setChatHistory(chatHistory);
        }

        let content = '';
        let aborted = false;
        let inThought = false;
        try {
          // onResponseChunk (not onTextChunk) so reasoning models'
          // thought segments stream too — otherwise a model like
          // DeepSeek-R1 looks frozen while it thinks.
          await session.prompt(promptText, {
            temperature: options.temperature,
            signal: options.signal,
            stopOnAbortSignal: true, // return what was generated instead of throwing
            onResponseChunk: (chunk: { type?: string; segmentType?: string; text: string }) => {
              let piece = chunk.text ?? '';
              if (!piece) return;
              const isThought = chunk.type === 'segment' && chunk.segmentType === 'thought';
              // Mark the reasoning region honestly in the output
              if (isThought && !inThought) { piece = `*Thinking…*\n\n${piece}`; inThought = true; }
              else if (!isThought && inThought) { piece = `\n\n---\n\n${piece}`; inThought = false; }
              content += piece;
              onToken(piece);
            },
          });
        } catch (err) {
          if (options.signal?.aborted) aborted = true;
          else throw err;
        }
        if (options.signal?.aborted) aborted = true;

        const durationMs = Date.now() - start;
        // Real token count from the model's own tokenizer
        let completionTokens: number | undefined;
        try { completionTokens = content ? model.tokenize(content).length : 0; } catch { /* optional */ }
        const tokensPerSecond = completionTokens && durationMs > 500
          ? Math.round((completionTokens / (durationMs / 1000)) * 10) / 10
          : undefined;

        return {
          content,
          model: path.basename(key),
          providerId: 'local',
          completionTokens,
          durationMs,
          tokensPerSecond,
          aborted,
        };
      } finally {
        await context.dispose();
      }
    });
  }
}

export const ggufRuntime = new GgufRuntime();
