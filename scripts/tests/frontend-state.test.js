'use strict';
// Hook simulation: controlled hook state/effects and API promises, not full React rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
// Use the frontend's declared compiler dependency, not a root transitive peer.
const ts = createRequire(path.join(root, 'frontend/package.json'))('typescript');

// Executes actual hook code with controlled hook state, timers and API promises.
// No fetch, model runtime, browser, external service or real delay is involved.
function harness(file, exportName, api, args = []) {
  const slots = [], timers = new Map(), listeners = new Map();
  let cursor = 0, nextTimer = 0, queued = false, mounted = true, value;
  const effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; if (mounted) render(); }); } };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, patch => {
        const next = typeof patch === 'function' ? patch(slot.value) : patch;
        if (!Object.is(next, slot.value)) { slot.value = next; schedule(); }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: fn, deps };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        slots[index]?.cleanup?.();
        slots[index] = { fn, deps };
        effects.push(index);
      }
    },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => {
      if (name === 'react') return react;
      if (name === '@/services/api') return api;
      if (name === '@/lib/prefs') return { getPrefs: () => ({ streamTokens: true }) };
      throw new Error('Unexpected dependency: ' + name);
    },
    window: {
      setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
      clearTimeout: id => timers.delete(id),
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    },
    AbortController, Date, Map, Set, Error, Promise, console,
  }, { filename: file });
  function render() {
    cursor = 0;
    value = module.exports[exportName](...args);
    for (const index of effects.splice(0)) slots[index].cleanup = slots[index].fn();
  }
  render();
  return {
    get value() { return value; },
    async settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); },
    fire(ms) {
      for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); }
    },
    replayEffects() {
      for (const slot of slots) if (slot?.fn) slot.cleanup?.();
      for (const slot of slots) if (slot?.fn) slot.cleanup = slot.fn();
    },
    unmount() { mounted = false; for (const slot of slots) if (slot?.fn) slot.cleanup?.(); },
    remount() { slots.length = 0; timers.clear(); effects.length = 0; mounted = true; render(); },
    dispatch(name, event) { listeners.get(name)?.(event); },
  };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

const note = { id: 'n', title: 'N', content: 'original', updatedAt: '0' };

test("hook simulation: generation Stop ownership and full/partial history reconciliation preserve draft", async () => {
  let list = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const generation = deferred();
  const stopped = [];
  const chat = harness('frontend/src/hooks/useChat.ts', 'useChat', { chatApi: {
    listConversations: async () => list,
    getConversation: async id => ({ id, agentId: 'conversation-agent', messages: [{ id: id + '-msg', role: 'user', content: id }] }),
    generate: async () => generation.promise,
    stop: async id => { stopped.push(id); return { stopped: true }; },
    deny: async () => { throw new Error('deny failed'); },
  } });
  await chat.settle();
  assert.equal(chat.value.activeId, 'a');
  const sending = chat.value.send('hello');
  await chat.settle();
  await chat.value.openConversation('b');
  await chat.settle();
  await chat.value.stop();
  assert.deepEqual(stopped, ['a'], 'Stop must target the generating conversation after switching');
  generation.resolve();
  await sending;
  chat.value.setDraft('keep this draft');
  await chat.settle();
  list = [{ id: 'a', title: 'A' }];
  await chat.value.reconcileHistory();
  await chat.settle();
  assert.equal(chat.value.activeId, null);
  assert.equal(chat.value.conversations.length, 1);
  assert.equal(chat.value.messages.length, 0);
  assert.equal(chat.value.draft, 'keep this draft');
  chat.value.resetHistory();
  await chat.settle();
  assert.equal(chat.value.conversations.length, 0);
  assert.equal(chat.value.draft, 'keep this draft');
  chat.unmount();
});

test("hook simulation: failed memory delete keeps card and exposes backend error", async () => {

  const memory = harness('frontend/src/hooks/useMemory.ts', 'useMemory', { memoryApi: {
    list: async () => [{ id: 'm', content: 'keep me' }],
    remove: async () => { throw new Error('delete failed'); },
  } });
  await memory.settle();
  await memory.value.remove('m');
  await memory.settle();
  assert.equal(memory.value.memories.length, 1);
  assert.equal(memory.value.error, 'delete failed');
  memory.unmount();
});

test("hook simulation: model assignment and agent action failures surface without fake state updates", async () => {

  const agents = harness('frontend/src/hooks/useAgents.ts', 'useAgents', { agentsApi: {
    list: async () => [{ id: 'agent', defaultModel: 'existing', status: 'idle' }],
    setModel: async () => { throw new Error('assignment rejected'); },
    activate: async () => { throw new Error('activate failed'); },
    pause: async () => { throw new Error('pause failed'); },
  } });
  await agents.settle();
  assert.equal(await agents.value.setModel('agent', 'requested'), false);
  await agents.settle();
  assert.equal(agents.value.agents[0].defaultModel, 'existing');
  assert.equal(agents.value.error, 'assignment rejected');
  await agents.value.activate('agent');
  await agents.settle();
  assert.equal(agents.value.error, 'activate failed');
  await agents.value.pause('agent');
  await agents.settle();
  assert.equal(agents.value.error, 'pause failed');
  agents.unmount();
});

test("hook simulation: device mutation failures preserve state and expose errors", async () => {

  const devices = harness('frontend/src/hooks/useDevices.ts', 'useDevices', { devicesApi: {
    list: async () => [{ id: 'device', status: 'disconnected' }],
    connect: async () => { throw new Error('connect failed'); },
    disconnect: async () => { throw new Error('disconnect failed'); },
  } });
  await devices.settle();
  await devices.value.connect('device');
  await devices.settle();
  assert.equal(devices.value.error, 'connect failed');
  assert.equal(devices.value.devices[0].status, 'disconnected');
  await devices.value.disconnect('device');
  await devices.settle();
  assert.equal(devices.value.error, 'disconnect failed');
  devices.unmount();
});

test("hook simulation: failed Ask presave retains edits, skips research and retries after StrictMode replay", async () => {

  let failSave = true, askCount = 0, savedContent = 'original';
  const notes = harness('frontend/src/hooks/useNotes.ts', 'useNotes', { notesApi: {
    list: async () => [note],
    update: async (_id, patch) => { if (failSave) throw new Error('save failed'); savedContent = patch.content ?? savedContent; return { ...note, ...patch, updatedAt: '1' }; },
    ask: async () => { askCount++; return { answer: 'answer', note: { ...note, content: savedContent + ' answer' } }; },
  } }, [true]);
  await notes.settle();
  notes.replayEffects();
  await notes.settle();
  notes.value.edit('n', { content: 'must survive' });
  await notes.settle();
  const answer = await notes.value.ask('n', 'must survive');
  await notes.settle();
  assert.equal(answer, null);
  assert.equal(askCount, 0, 'No research should begin until queued edits save');
  assert.equal(notes.value.notes[0].content, 'must survive');
  assert.equal(notes.value.error, 'save failed');
  failSave = false;
  notes.fire(2800);
  await notes.settle();
  assert.equal(savedContent, 'must survive', 'StrictMode replay must not disable retry');
  assert.equal(notes.value.saving, false);
  notes.unmount();
});

test("hook simulation: closing Notes during autosave drains the final edit", async () => {

  const firstSave = deferred();
  const writes = [];
  const close = harness('frontend/src/hooks/useNotes.ts', 'useNotes', { notesApi: {
    list: async () => [note],
    update: async (_id, patch) => { writes.push(patch.content); if (writes.length === 1) await firstSave.promise; return { ...note, updatedAt: '2' }; },
  } }, [true]);
  await close.settle();
  close.value.edit('n', { content: 'first' });
  close.fire(700);
  await close.settle();
  close.value.edit('n', { content: 'latest' });
  close.unmount();
  firstSave.resolve();
  await close.settle();
  assert.deepEqual(writes, ['first', 'latest'], 'Closing during a write must drain newer queued edits');
});

test("hook simulation: Ask waits for an existing save and protects researched content", async () => {

  const presave = deferred();
  let presaveComplete = false, serializedAskCount = 0;
  const serialized = harness('frontend/src/hooks/useNotes.ts', 'useNotes', { notesApi: {
    list: async () => [note],
    update: async (_id, patch) => { await presave.promise; presaveComplete = true; return { ...note, ...patch, updatedAt: '3' }; },
    ask: async () => { assert.ok(presaveComplete); serializedAskCount++; return { answer: 'answer', note }; },
  } }, [true]);
  await serialized.settle();
  serialized.value.edit('n', { content: 'selected passage' });
  serialized.fire(700);
  await serialized.settle();
  const asking = serialized.value.ask('n', 'selected passage');
  await serialized.settle();
  assert.equal(serializedAskCount, 0);
  serialized.value.edit('n', { content: 'blocked while researching' });
  await serialized.settle();
  assert.equal(serialized.value.notes[0].content, 'selected passage');
  presave.resolve();
  await asking;
  assert.equal(serializedAskCount, 1);
  serialized.unmount();
});

test('hook simulation: failed save survives Notes unmount/remount within the tab and resumes autosave', async () => {
  let failSave = true;
  let stored = 'original';
  let delayedList = null;
  const notes = harness('frontend/src/hooks/useNotes.ts', 'useNotes', { notesApi: {
    list: async () => {
      const snapshot = stored;
      if (delayedList) await delayedList.promise;
      return [{ ...note, content: snapshot }];
    },
    update: async (_id, patch) => {
      if (failSave) throw new Error('backend offline');
      stored = patch.content ?? stored;
      return { ...note, content: stored, updatedAt: '4' };
    },
  } }, [true]);
  await notes.settle();
  notes.value.edit('n', { content: 'recover after leaving Notes' });
  notes.fire(700);
  await notes.settle();
  let warned = false;
  notes.dispatch('beforeunload', { preventDefault: () => { warned = true; }, returnValue: undefined });
  assert.ok(warned, 'Unsaved text should warn before tab reload');
  notes.unmount();
  await notes.settle();
  warned = false;
  notes.dispatch('beforeunload', { preventDefault: () => { warned = true; }, returnValue: undefined });
  assert.ok(warned, 'Leaving Notes must not remove the unsaved-text warning');
  failSave = false;
  delayedList = deferred();
  notes.remount();
  await notes.settle();
  assert.equal(stored, 'recover after leaving Notes');
  delayedList.resolve();
  await notes.settle();
  assert.equal(notes.value.notes[0].content, 'recover after leaving Notes');
  assert.equal(stored, 'recover after leaving Notes');
  assert.equal(notes.value.saving, false);
  warned = false;
  notes.dispatch('beforeunload', { preventDefault: () => { warned = true; }, returnValue: undefined });
  assert.equal(warned, false, 'Successfully saved drafts should not warn');
  notes.unmount();
});
