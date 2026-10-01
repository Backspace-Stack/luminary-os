// ============================================================
// LocalProvider — First-class local GGUF model provider.
//
// Discovery: scans the auto-created models/ folder (beside
// run.bat) plus the optional extra folder from Settings,
// recursively, on every list. Files are never copied, moved, or
// modified — only paths and parsed header metadata are kept.
//
// Execution: real in-process inference through GgufRuntime
// (node-llama-cpp). When the runtime is unavailable the models
// are still listed, marked not runnable, with the honest reason.
// ============================================================

import type {
  IModelProvider,
  ModelInfo,
  CompletionOptions,
  CompletionResponse,
  EmbeddingOptions,
  EmbeddingResponse,
  ProviderHealth,
  ChatTurn,
  ChatStreamOptions,
  ChatStreamResult,
} from '../../core/types/IModelProvider';
import { settingsService } from '../../services/SettingsService';
import { GgufScanner, type GgufFileInfo } from '../gguf/GgufScanner';
import { ggufRuntime, GgufRuntimeError } from '../gguf/GgufRuntime';
import { defaultModelsDir } from '../gguf/ModelsFolder';
import { Logger } from '../../core/logger/Logger';
import path from 'path';
import fs from 'fs';

const logger = Logger.scope('LocalProvider');

export { GgufRuntimeError as LocalProviderError };

/** All folders scanned for GGUF files: models/ + optional extra. */
export function ggufFolders(): string[] {
  const dirs = [defaultModelsDir()];
  const extra = settingsService.getGgufFolder();
  if (extra && !dirs.some((d) => path.resolve(d) === path.resolve(extra))) {
    dirs.push(extra);
  }
  return dirs;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Best-effort model categorisation from name/architecture — presentation only. */
function classify(fileName: string, architecture?: string): ModelInfo['type'] {
  const n = fileName.toLowerCase();
  const a = (architecture ?? '').toLowerCase();
  if (n.includes('embed') || a.includes('bert')) return 'embedding';
  if (n.includes('llava') || n.includes('vision') || n.includes('moondream') || a === 'clip' || a === 'mllama') return 'vision';
  if (n.includes('coder') || n.includes('codellama') || n.includes('starcoder') || n.startsWith('code')) return 'coding';
  return 'general';
}

export class LocalProvider implements IModelProvider {
  readonly id = 'local';
  readonly name = 'Local GGUF Provider';

  private scanner = new GgufScanner();

  /** Rescan all GGUF folders (read-only). */
  private scanAll(): GgufFileInfo[] {
    const seen = new Set<string>();
    const results: GgufFileInfo[] = [];
    for (const dir of ggufFolders()) {
      if (!fs.existsSync(dir)) continue;
      for (const file of this.scanner.scan(dir)) {
        const key = path.resolve(file.filePath);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(file);
        }
      }
    }
    return results;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    const files = this.scanAll();
    const runtime = ggufRuntime.getStatus();
    const extra = settingsService.getGgufFolder();
    return {
      status: 'connected',
      latencyMs: Date.now() - start,
      message:
        `${files.length} GGUF file(s) in ${defaultModelsDir()}` +
        (extra ? ` (+ ${extra})` : '') +
        ` · Runtime: ${runtime.available ? runtime.message : `unavailable — ${runtime.message}`}`,
      checkedAt: new Date().toISOString(),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const files = this.scanAll();
    const runnable = ggufRuntime.isAvailable();
    logger.debug(`listModels() — ${files.length} GGUF file(s), runtime ${runnable ? 'available' : 'unavailable'}`);
    return files.map((f) => ({
      id: f.filePath,
      name: f.meta.modelName ?? f.fileName.replace(/\.gguf$/i, ''),
      family: f.meta.architecture ?? 'unknown',
      sizeLabel: formatBytes(f.sizeBytes),
      sizeBytes: f.sizeBytes,
      type: classify(f.fileName, f.meta.architecture),
      status: ggufRuntime.isLoaded(f.filePath) ? 'loaded' as const : 'unloaded' as const,
      quantization: f.meta.quantization ?? '—',
      contextLength: f.meta.contextLength ?? 0,
      parameterSize: f.meta.parameterSize,
      modifiedAt: f.modifiedAt,
      providerId: this.id,
      runnable,
      filePath: f.filePath,
    }));
  }

  /** Really load the GGUF into memory via node-llama-cpp. */
  async loadModel(modelId: string): Promise<void> {
    await ggufRuntime.loadModel(modelId);
  }

  /** Really free the model's memory. */
  async unloadModel(modelId: string): Promise<void> {
    await ggufRuntime.unloadModel(modelId);
  }

  async chatStream(
    messages: ChatTurn[],
    options: ChatStreamOptions,
    onToken: (token: string) => void,
  ): Promise<ChatStreamResult> {
    return ggufRuntime.chatStream(
      options.model,
      messages,
      { signal: options.signal, temperature: options.temperature },
      onToken,
    );
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResponse> {
    const messages: ChatTurn[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const result = await ggufRuntime.chatStream(
      options.model,
      messages,
      { temperature: options.temperature },
      () => { /* non-streaming caller */ },
    );
    return {
      content: result.content,
      model: result.model,
      providerId: this.id,
      completionTokens: result.completionTokens,
      durationMs: result.durationMs,
      finishReason: 'stop',
    };
  }

  async embed(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    throw new GgufRuntimeError(
      `Embeddings via the GGUF runtime are not implemented yet (model "${options.model}"). Use an Ollama embedding model.`
    );
  }
}
