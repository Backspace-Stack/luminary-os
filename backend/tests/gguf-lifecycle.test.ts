import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GgufRuntime, type GgufNativeModule } from '../src/models/gguf/GgufRuntime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luminary-gguf-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.gguf');
  const other = path.join(dir, 'other.gguf');
  await fs.writeFile(file, 'GGUF'); await fs.writeFile(other, 'GGUF');
  const events: string[] = [];
  let loads = 0;
  let beforeLoad: (options: { modelPath: string; gpuLayers?: number }) => Promise<void> = async () => {};
  let beforeDispose: () => Promise<void> = async () => {};
  let beforePrompt: () => Promise<void> = async () => {};
  const native = {
    getLlama: async () => ({
      gpu: false,
      loadModel: async (options: { modelPath: string; gpuLayers?: number }) => {
        const id = ++loads; events.push(`load:${id}`);
        await beforeLoad(options);
        let disposed = false;
        return {
          trainContextSize: 4096,
          dispose: async () => {
            events.push(`dispose-start:${id}`); await beforeDispose();
            disposed = true; events.push(`dispose-end:${id}`);
          },
          createContext: async () => {
            assert.equal(disposed, false, 'cannot generate with a disposed model');
            events.push(`context:${id}`);
            return { getSequence: () => id, dispose: async () => { events.push(`context-dispose:${id}`); } };
          },
          tokenize: () => [1],
        };
      },
    }),
    LlamaChatSession: class {
      setChatHistory() {}
      async prompt(_text: string, options: { onResponseChunk(chunk: { text: string }): void }) {
        events.push('prompt'); await beforePrompt(); options.onResponseChunk({ text: 'response' });
      }
    },
  } as unknown as GgufNativeModule;
  const runtime = new GgufRuntime(async () => native);
  return {
    runtime, file, other, events, loads: () => loads,
    onLoad: (fn: typeof beforeLoad) => { beforeLoad = fn; },
    onDispose: (fn: typeof beforeDispose) => { beforeDispose = fn; },
    onPrompt: (fn: typeof beforePrompt) => { beforePrompt = fn; },
    chat: () => runtime.chatStream(file, [{ role: 'user', content: 'hello' }], {}, () => {}),
  };
}

test('concurrent requests load one native model and unload it once', async t => {
  const f = await fixture(t); const load = deferred(); const entered = deferred();
  f.onLoad(async () => { entered.resolve(); await load.promise; });
  const first = f.runtime.loadModel(f.file); await entered.promise;
  const second = f.runtime.loadModel(f.file); await tick();
  load.resolve(); await Promise.all([first, second]);
  assert.equal(f.loads(), 1);
  await f.runtime.unloadAll();
  assert.equal(f.events.filter(e => e.startsWith('dispose-end')).length, 1);
});

test('unload waits for generation and its context disposal', async t => {
  const f = await fixture(t); const prompt = deferred(); const entered = deferred();
  f.onPrompt(async () => { entered.resolve(); await prompt.promise; });
  const chat = f.chat(); await entered.promise;
  const unload = f.runtime.unloadModel(f.file); await tick();
  assert.equal(f.events.includes('dispose-start:1'), false);
  prompt.resolve(); await Promise.all([chat, unload]);
  assert.ok(f.events.indexOf('context-dispose:1') < f.events.indexOf('dispose-start:1'));
  assert.equal(f.runtime.isLoaded(f.file), false);
});

test('generation arriving during unload waits and reloads the model', async t => {
  const f = await fixture(t); await f.runtime.loadModel(f.file);
  const disposal = deferred(); const entered = deferred();
  f.onDispose(async () => { entered.resolve(); await disposal.promise; });
  const unload = f.runtime.unloadModel(f.file); await entered.promise;
  const chat = f.chat(); await tick();
  const generatedDuringDisposal = f.events.includes('prompt');
  disposal.resolve(); await Promise.all([unload, chat]);
  assert.equal(generatedDuringDisposal, false);
  assert.equal(f.loads(), 2);
  assert.ok(f.events.indexOf('dispose-end:1') < f.events.indexOf('context:2'));
});

test('GPU failure safely evicts loaded models then retries GPU and CPU without deadlock', { timeout: 3000 }, async t => {
  const f = await fixture(t); await f.runtime.loadModel(f.file);
  const attempts: Array<number | undefined> = [];
  f.onLoad(async options => {
    attempts.push(options.gpuLayers);
    if (options.gpuLayers !== 0) throw new Error('GPU exhausted');
  });
  await f.runtime.loadModel(f.other);
  assert.deepEqual(attempts, [undefined, undefined, 0]);
  assert.equal(f.runtime.isLoaded(f.file), false);
  assert.equal(f.runtime.isLoaded(f.other), true);
  assert.ok(f.events.indexOf('dispose-end:1') < f.events.indexOf('load:3'));
});

test('another model cannot trigger fallback eviction during active inference', { timeout: 3000 }, async t => {
  const f = await fixture(t); const prompt = deferred(); const entered = deferred();
  f.onPrompt(async () => { entered.resolve(); await prompt.promise; });
  const chat = f.chat(); await entered.promise;
  f.onLoad(async options => { if (options.gpuLayers !== 0) throw new Error('GPU exhausted'); });
  const load = f.runtime.loadModel(f.other); await tick();
  const loadsDuringInference = f.loads();
  prompt.resolve(); await Promise.all([chat, load]);
  assert.equal(loadsDuringInference, 1);
  assert.ok(f.events.indexOf('context-dispose:1') < f.events.indexOf('dispose-start:1'));
  assert.equal(f.runtime.isLoaded(f.other), true);
});

test('a cancelled queued generation does not load weights or create a context', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort();
  const result = await f.runtime.chatStream(f.file, [], { signal: controller.signal }, () => {});
  assert.equal(result.aborted, true);
  assert.deepEqual(f.events, []);
});
