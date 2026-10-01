import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SqliteDatabase } from '../src/memory/providers/SqliteMemoryProvider';
import type { Note } from '../src/notes/SqliteNotesStore';
import type { StoredConversation } from '../src/services/ChatService';
import type { AppSettings } from '../src/services/SettingsService';
import type { IntegrationStatus } from '../src/services/SecretsService';
import type { AgentMetadata, AgentResponse } from '../src/core/types/IAgent';
import type { IModelProvider, ModelInfo } from '../src/core/types/IModelProvider';

let directory: string, jsonDirectory: string, url: string;
let server: Server, db: SqliteDatabase;
let notes: typeof import('../src/services/NotesService');
let chats: typeof import('../src/services/ChatService');
let settings: typeof import('../src/services/SettingsService');
let secrets: typeof import('../src/services/SecretsService');
let assignments: typeof import('../src/services/AgentModelStore');
let agents: typeof import('../src/core/registry/AgentRegistry');
let providers: typeof import('../src/core/registry/ModelRegistry');
let sqlite: typeof import('../src/memory/providers/SqliteMemoryProvider');
let noteStores: typeof import('../src/notes/SqliteNotesStore');
let secretStores: typeof import('../src/secrets/SqliteSecretStore');
let watcher: typeof import('../src/models/gguf/GgufWatcher');
let listedModels: ModelInfo[] = [];
const oldEnv = new Map<string, string | undefined>();

function env(name: string, value: string) {
  if (!oldEnv.has(name)) oldEnv.set(name, process.env[name]);
  process.env[name] = value;
}

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luminary feature routes '));
  jsonDirectory = path.join(directory, 'json');
  env('LUMINARY_DATA_DIR', jsonDirectory);
  env('DB_PATH', path.join(directory, 'state.sqlite'));
  env('LUMINARY_MODELS_DIR', path.join(directory, 'models'));
  env('NODE_ENV', 'production');
  env('LOG_LEVEL', 'error');
  env('TAVILY_API_KEY', 'fixture-environment-secret');
  await fs.mkdir(process.env.LUMINARY_MODELS_DIR!, { recursive: true });

  // Set every storage location before importing singleton services.
  [notes, chats, settings, secrets, assignments, agents, providers, sqlite, noteStores, secretStores, watcher] = await Promise.all([
    import('../src/services/NotesService'), import('../src/services/ChatService'),
    import('../src/services/SettingsService'), import('../src/services/SecretsService'),
    import('../src/services/AgentModelStore'), import('../src/core/registry/AgentRegistry'),
    import('../src/core/registry/ModelRegistry'), import('../src/memory/providers/SqliteMemoryProvider'),
    import('../src/notes/SqliteNotesStore'), import('../src/secrets/SqliteSecretStore'),
    import('../src/models/gguf/GgufWatcher'),
  ]);
  db = sqlite.openDatabase(process.env.DB_PATH!);
  notes.notesService.setStore(new noteStores.SqliteNotesStore(db));
  secrets.secretsService.setStore(new secretStores.SqliteSecretStore(db));

  // Discovery metadata only. Any accidental loading, inference, or
  // embedding fails locally instead of calling a real provider.
  const forbidden = async (): Promise<never> => { throw new Error('This test must not run or load a model'); };
  const provider: IModelProvider = {
    id: 'fixture-discovery', name: 'Controlled discovery fixture',
    listModels: async () => listedModels,
    healthCheck: forbidden, loadModel: forbidden, unloadModel: forbidden,
    complete: forbidden, embed: forbidden, pullModel: forbidden,
  };
  providers.modelRegistry.register(provider);
  const { ConversationAgent } = await import('../src/agents/ConversationAgent');
  agents.agentRegistry.register(new ConversationAgent(providers.modelRegistry));

  const [noteRoute, chatRoute, settingsRoute, integrationRoute, agentRoute, errors] = await Promise.all([
    import('../src/routes/notes'), import('../src/routes/chat'), import('../src/routes/settings'),
    import('../src/routes/integrations'), import('../src/routes/agents'), import('../src/middleware/errorHandler'),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/notes', noteRoute.default);
  app.use('/api/chat', chatRoute.default);
  app.use('/api/settings', settingsRoute.default);
  app.use('/api/integrations', integrationRoute.default);
  app.use('/api/agents', agentRoute.default);
  app.use(errors.errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  mock.restoreAll();
  watcher?.ggufWatcher.stop();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  db?.close();
  for (const [key, value] of oldEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

async function request<T = unknown>(route: string, method = 'GET', body?: unknown) {
  const response = await fetch(url + route, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as { success: boolean; message?: string; data: T } };
}

async function blockJsonWrites(run: () => Promise<void>) {
  const backup = jsonDirectory + '-backup';
  await fs.mkdir(jsonDirectory, { recursive: true });
  await fs.rename(jsonDirectory, backup);
  await fs.writeFile(jsonDirectory, 'A file cannot be used as a storage directory');
  try { await run(); }
  finally { await fs.unlink(jsonDirectory); await fs.rename(backup, jsonDirectory); }
}

function model(id: string, name: string, runnable = true): ModelInfo {
  return {
    id, name, runnable, providerId: 'fixture-discovery', family: 'fixture',
    sizeLabel: 'metadata only', type: 'general', status: 'unloaded', quantization: 'unknown', contextLength: 0,
  };
}

test('notes preserve Unicode content through CRUD and a real SQLite reopen', async () => {
  const content = "Quoted ' text\n\nनोट 🕯\n";
  const created = await request<Note>('/api/notes', 'POST', { title: '  Study\n note  ', content });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.title, 'Study note');
  assert.equal(created.body.data.content, content);
  const id = created.body.data.id;
  const patched = await request<Note>(`/api/notes/${id}`, 'PATCH', { title: 'x'.repeat(150) });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.title.length, 120);
  assert.equal(patched.body.data.title.endsWith('…'), true);
  assert.equal(patched.body.data.content, content);
  db.close();
  db = sqlite.openDatabase(process.env.DB_PATH!);
  notes.notesService.setStore(new noteStores.SqliteNotesStore(db));
  secrets.secretsService.setStore(new secretStores.SqliteSecretStore(db));
  assert.deepEqual((await request<Note>(`/api/notes/${id}`)).body.data, patched.body.data);
  assert.ok((await request<Note[]>('/api/notes')).body.data.some(note => note.id === id));
  assert.equal((await request(`/api/notes/${id}`, 'DELETE')).status, 200);
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    assert.equal((await request(`/api/notes/${id}`, method, method === 'PATCH' ? { content: 'lost' } : undefined)).status, 404);
  }
});

test('invalid note field types return 400 without creating or modifying data', async () => {
  const note = (await request<Note>('/api/notes', 'POST', { title: 'Stable', content: 'original' })).body.data;
  const before = (await request<Note[]>('/api/notes')).body.data.length;
  for (const bad of [{ title: 7 }, { content: {} }, { title: null }]) {
    assert.equal((await request('/api/notes', 'POST', bad)).status, 400);
    assert.equal((await request(`/api/notes/${note.id}`, 'PATCH', bad)).status, 400);
  }
  assert.equal((await request<Note[]>('/api/notes')).body.data.length, before);
  assert.equal((await request<Note>(`/api/notes/${note.id}`)).body.data.content, 'original');
});

test('Ask Lumen rejects blank/stale passages and unavailable research without altering the note', async () => {
  const note = (await request<Note>('/api/notes', 'POST', { title: 'Read', content: 'existing passage' })).body.data;
  assert.equal((await request(`/api/notes/${note.id}/ask`, 'POST', { selection: ' ' })).status, 400);
  assert.equal((await request(`/api/notes/${note.id}/ask`, 'POST', { selection: 'deleted passage' })).status, 409);
  assert.equal((await request(`/api/notes/${note.id}/ask`, 'POST', { selection: 'existing passage' })).status, 503);
  assert.deepEqual((await request<Note>(`/api/notes/${note.id}`)).body.data, note);
  assert.throws(() => new notes.NotesService().list(), { statusCode: 503 });
});

test('conversations create, rename, pin, summarize and persist without generating a response', async () => {
  const created = await request<StoredConversation>('/api/chat/conversations', 'POST', { title: '  Roadmap  ' });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal(created.body.data.title, 'Roadmap');
  assert.deepEqual(created.body.data.messages, []);
  const updated = await request<StoredConversation>(`/api/chat/conversations/${id}`, 'PATCH', { title: ' Plans ', agentId: 'conversation-agent' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.title, 'Plans');
  assert.equal(new chats.ChatService().get(id).title, 'Plans');
  const listed = await request<Array<{ id: string; messageCount: number; lastMessage: string }>>('/api/chat/conversations');
  assert.deepEqual(listed.body.data.find(item => item.id === id)?.messageCount, 0);
  assert.equal(listed.body.data.find(item => item.id === id)?.lastMessage, '');
  assert.equal((await request<{ stopped: boolean }>(`/api/chat/conversations/${id}/stop`, 'POST')).body.data.stopped, false);
  assert.equal((await request(`/api/chat/conversations/${id}`, 'PATCH', { agentId: 'missing-agent' })).status, 404);
  assert.equal((await request(`/api/chat/conversations/${id}`, 'DELETE')).status, 200);
  assert.equal((await request(`/api/chat/conversations/${id}`)).status, 404);
  assert.throws(() => new chats.ChatService().get(id), { statusCode: 404 });
});

test('conversation field type errors are 400 and leave existing conversations unchanged', async () => {
  const conversation = (await request<StoredConversation>('/api/chat/conversations', 'POST', { title: 'Stable' })).body.data;
  const before = chats.chatService.list().length;
  for (const title of [7, {}, null]) {
    assert.equal((await request('/api/chat/conversations', 'POST', { title })).status, 400);
    assert.equal((await request(`/api/chat/conversations/${conversation.id}`, 'PATCH', { title })).status, 400);
  }
  assert.equal((await request(`/api/chat/conversations/${conversation.id}`, 'PATCH', { agentId: 7 })).status, 400);
  assert.equal(chats.chatService.list().length, before);
  assert.equal(chats.chatService.get(conversation.id).title, 'Stable');
});

test('failed conversation disk writes reject CRUD and preserve the previously saved state', async () => {
  const conversation = (await request<StoredConversation>('/api/chat/conversations', 'POST', { title: 'Saved' })).body.data;
  const before = structuredClone(chats.chatService.allConversations());
  await blockJsonWrites(async () => {
    assert.equal((await request('/api/chat/conversations', 'POST', { title: 'Unsaved' })).status, 503);
    assert.equal((await request(`/api/chat/conversations/${conversation.id}`, 'PATCH', { title: 'Unsaved' })).status, 503);
    assert.equal((await request(`/api/chat/conversations/${conversation.id}`, 'PATCH', { agentId: 'conversation-agent' })).status, 503);
    assert.equal((await request(`/api/chat/conversations/${conversation.id}`, 'DELETE')).status, 503);
    assert.deepEqual(chats.chatService.allConversations(), before);
  });
  assert.deepEqual(new chats.ChatService().allConversations(), before);
});

test('settings validate folders, persist an absolute path and clear only when explicitly requested', async () => {
  const folder = path.join(directory, 'empty model folder');
  const file = path.join(directory, 'plain-file.txt');
  await fs.mkdir(folder);
  await fs.writeFile(file, 'not a model');
  // Windows cannot express a relative path between different drives.
  // Resolve this request from the disposable directory so the regression
  // still exercises a real relative input when the checkout is on E:.
  const selected = await (async () => {
    const previousCwd = process.cwd();
    process.chdir(directory);
    try { return await request<AppSettings>('/api/settings/gguf-folder', 'PUT', { path: 'empty model folder' }); }
    finally { process.chdir(previousCwd); }
  })();
  assert.equal(selected.status, 200);
  assert.equal(selected.body.data.ggufFolder, folder);
  assert.equal(new settings.SettingsService().getGgufFolder(), folder);
  for (const body of [{}, { path: 7 }, { path: path.join(directory, 'absent') }, { path: file }]) {
    assert.equal((await request('/api/settings/gguf-folder', 'PUT', body)).status, 400);
    assert.equal(settings.settingsService.getGgufFolder(), folder);
  }
  assert.equal((await request<AppSettings>('/api/settings/gguf-folder', 'PUT', { path: null })).body.data.ggufFolder, null);
  assert.equal(new settings.SettingsService().getGgufFolder(), null);
});

test('failed settings writes return 503 without claiming or retaining an unsaved selection', async () => {
  const before = settings.settingsService.get();
  await blockJsonWrites(async () => {
    assert.equal((await request('/api/settings/gguf-folder', 'PUT', { path: directory })).status, 503);
    assert.deepEqual(settings.settingsService.get(), before);
  });
  assert.deepEqual(new settings.SettingsService().get(), before);
});

test('integration keys persist in SQLite and status/error responses never expose their values', async () => {
  const saved = 'fixture-saved-secret-DO-NOT-ECHO';
  const status = (await request<IntegrationStatus[]>('/api/integrations')).body.data.find(item => item.id === 'tavily');
  assert.equal(status?.source, 'env');
  const changed = await request<IntegrationStatus>('/api/integrations/tavily', 'PUT', { value: ` ${saved} ` });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.source, 'saved');
  assert.equal(secrets.secretsService.resolve('tavily'), saved);
  const reopened = sqlite.openDatabase(process.env.DB_PATH!);
  try { assert.equal(new secretStores.SqliteSecretStore(reopened).get('tavily'), saved); }
  finally { reopened.close(); }
  for (const response of [changed, await request('/api/integrations'), await request('/api/integrations/tavily', 'PUT', { value: {} })]) {
    assert.equal(JSON.stringify(response.body).includes(saved), false);
    assert.equal(JSON.stringify(response.body).includes('fixture-environment-secret'), false);
  }
  assert.equal((await request('/api/integrations/tavily', 'PUT', {})).status, 400);
  assert.equal((await request('/api/integrations/unknown', 'PUT', { value: saved })).status, 404);
  assert.equal((await request<IntegrationStatus>('/api/integrations/tavily', 'DELETE')).body.data.source, 'env');
  assert.equal(secrets.secretsService.resolve('tavily'), 'fixture-environment-secret');
  assert.equal((await request<IntegrationStatus>('/api/integrations/tavily', 'PUT', { value: '  ' })).body.data.source, 'env');
  assert.throws(() => new secrets.SecretsService().set('tavily', saved), { statusCode: 503 });
});

test('embedding-only models cannot be assigned to a chat agent', async () => {
  const id = 'conversation-agent';
  const previous = assignments.agentModelStore.get(id);
  listedModels = [{ ...model('fixture:embedding', 'embedding fixture'), type: 'embedding' }];
  assert.equal((await request(`/api/agents/${id}/model`, 'PUT', { model: 'fixture:embedding' })).status, 400);
  assert.equal(assignments.agentModelStore.get(id), previous);
});

test('agent state and assignment routes return honest input/not-found failures without loading models', async () => {
  const id = 'conversation-agent';
  assert.equal((await request<AgentMetadata>(`/api/agents/${id}/activate`, 'POST')).body.data.status, 'active');
  assert.equal((await request<AgentMetadata>(`/api/agents/${id}/pause`, 'POST')).body.data.status, 'idle');
  for (const action of ['activate', 'pause']) assert.equal((await request(`/api/agents/missing/${action}`, 'POST')).status, 404);
  assert.equal((await request('/api/agents/missing/model', 'PUT', { model: 'fixture' })).status, 404);
  for (const value of ['', 7, {}]) assert.equal((await request(`/api/agents/${id}/model`, 'PUT', { model: value })).status, 400);
  listedModels = [model('fixture:not-runnable', 'unavailable fixture', false)];
  assert.equal((await request(`/api/agents/${id}/model`, 'PUT', { model: 'not-installed' })).status, 400);
  assert.equal((await request(`/api/agents/${id}/model`, 'PUT', { model: 'fixture:not-runnable' })).status, 400);
  assert.equal(assignments.agentModelStore.get(id), null);
  listedModels = [model('fixture:canonical', 'display name')];
  const assigned = await request<AgentMetadata>(`/api/agents/${id}/model`, 'PUT', { model: 'display name' });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.defaultModel, 'fixture:canonical');
  assert.equal(new assignments.AgentModelStore().get(id), 'fixture:canonical');
});

test('failed assignment writes reject changes and clearing without losing the saved assignment', async () => {
  const id = 'conversation-agent';
  assignments.agentModelStore.set(id, 'fixture:saved');
  const before = assignments.agentModelStore.get(id);
  listedModels = [model('fixture:other', 'other')];
  await blockJsonWrites(async () => {
    assert.equal((await request(`/api/agents/${id}/model`, 'PUT', { model: 'fixture:other' })).status, 503);
    assert.equal(assignments.agentModelStore.get(id), before);
    assert.throws(() => assignments.agentModelStore.clear(id), { statusCode: 503 });
    assert.equal(assignments.agentModelStore.get(id), before);
  });
  assert.equal(new assignments.AgentModelStore().get(id), before);
  assignments.agentModelStore.clear(id);
  assert.equal(assignments.agentModelStore.get(id), null);
  assert.equal(new assignments.AgentModelStore().get(id), null);
});

test('streamed execution failure plus unavailable storage closes the response and clears generation state', async () => {
  const conversation = (await request<StoredConversation>('/api/chat/conversations', 'POST', { title: 'Stream failure' })).body.data;
  listedModels = [model('fixture:stream', 'stream fixture')];
  const agent = agents.agentRegistry.findById('conversation-agent') as import('../src/agents/ConversationAgent').ConversationAgent;
  mock.method(agent, 'execute', async () => { throw new Error('Controlled execution failure; no provider was called'); });
  try {
    await blockJsonWrites(async () => {
      const response = await fetch(url + '/api/chat/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id, mode: 'send', content: 'test user message' }),
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Content-Type') ?? '', /application\/x-ndjson/);
      const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string; message?: string });
      assert.equal(events.some(event => event.type === 'done'), false);
      assert.match(events.find(event => event.type === 'error')?.message ?? '', /could not be saved/);
      assert.equal(chats.chatService.isGenerating(conversation.id), false);
    });
    assert.deepEqual(chats.chatService.get(conversation.id), conversation);
    assert.deepEqual(new chats.ChatService().get(conversation.id), conversation);
  } finally { mock.restoreAll(); }
});

test('generation drafts stay private and a successful save preserves concurrent conversation edits', async () => {
  const conversation = chats.chatService.create('Starting title');
  const before = structuredClone(conversation);
  const other = chats.chatService.create('Other chat');
  listedModels = [model('fixture:success', 'controlled result fixture')];
  const agent = agents.agentRegistry.findById('conversation-agent') as import('../src/agents/ConversationAgent').ConversationAgent;
  let finish!: (value: AgentResponse) => void;
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const result = new Promise<AgentResponse>(resolve => { finish = resolve; });
  const controlled: AgentResponse = { requestId: 'fixture', agentId: agent.id, agentName: agent.name, content: 'controlled answer', timestamp: new Date().toISOString() };
  mock.method(agent, 'execute', async () => { started(); return result; });
  let done = false;
  const pending = chats.chatService.generate(
    { conversationId: conversation.id, mode: 'send', content: 'draft message' },
    { onMeta() {}, onToken() {}, onDone() { done = true; } },
  );
  try {
    await began;
    assert.deepEqual(chats.chatService.get(conversation.id), before);
    assert.deepEqual(chats.chatService.historyTurns(conversation.id), [{ role: 'user', content: 'draft message' }]);
    chats.chatService.rename(other.id, 'Other chat updated while waiting');
    chats.chatService.rename(conversation.id, 'User selected this title while waiting');
    finish(controlled);
    await pending;
    assert.equal(done, true);
    const saved = chats.chatService.get(conversation.id);
    assert.equal(saved.title, 'User selected this title while waiting');
    assert.deepEqual(saved.messages.map(message => message.content), ['draft message', 'controlled answer']);
    const reopened = new chats.ChatService();
    assert.equal(reopened.get(conversation.id).title, 'User selected this title while waiting');
    assert.deepEqual(reopened.get(conversation.id).messages.map(message => ({ role: message.role, content: message.content })), [
      { role: 'user', content: 'draft message' }, { role: 'assistant', content: 'controlled answer' },
    ]);
    assert.equal(reopened.get(other.id).title, 'Other chat updated while waiting');
    assert.equal(chats.chatService.isGenerating(conversation.id), false);
  } finally { finish(controlled); await pending.catch(() => {}); mock.restoreAll(); }
});

test('Stop during delayed model discovery cancels the turn before execution or loading', async () => {
  const conversation = chats.chatService.create('Cancelled before execution');
  const before = structuredClone(conversation);
  listedModels = [model('fixture:cancelled', 'metadata only')];
  const provider = providers.modelRegistry.findById('fixture-discovery')!;
  const agent = agents.agentRegistry.findById('conversation-agent') as import('../src/agents/ConversationAgent').ConversationAgent;
  let finish!: () => void;
  let started!: () => void;
  let executions = 0, loads = 0;
  const began = new Promise<void>(resolve => { started = resolve; });
  const discovery = new Promise<void>(resolve => { finish = resolve; });
  mock.method(provider, 'listModels', async () => { started(); await discovery; return listedModels; });
  mock.method(provider, 'loadModel', async () => { loads++; throw new Error('Loading is forbidden'); });
  mock.method(agent, 'execute', async () => {
    executions++;
    return { requestId: 'fixture', agentId: agent.id, agentName: agent.name, content: 'must not be emitted', timestamp: new Date().toISOString() };
  });
  const pending = chats.chatService.generate(
    { conversationId: conversation.id, mode: 'send', content: 'cancel this turn' },
    { onMeta() {}, onToken() {}, onDone() {} },
  );
  try {
    await began;
    assert.equal(chats.chatService.isGenerating(conversation.id), true);
    assert.equal(chats.chatService.stop(conversation.id), true);
    finish();
    await assert.rejects(pending, { statusCode: 409 });
    assert.equal(executions, 0);
    assert.equal(loads, 0);
    assert.equal(chats.chatService.isGenerating(conversation.id), false);
    assert.deepEqual(chats.chatService.get(conversation.id), before);
  } finally { finish(); await pending.catch(() => {}); mock.restoreAll(); }
});

test('a delayed note answer inserts into unchanged notes and rejects concurrent content edits', async () => {
  const { ResearchAgent } = await import('../src/agents/ResearchAgent');
  const { noteAskService } = await import('../src/services/NoteAskService');
  const research = new ResearchAgent(providers.modelRegistry);
  agents.agentRegistry.register(research);
  try {
    for (const change of ['unchanged', 'edited', 'removed']) {
      const note = notes.notesService.create('Concurrent', 'passage\n\nold tail');
      let finish!: (value: AgentResponse) => void;
      let started!: () => void;
      const began = new Promise<void>(resolve => { started = resolve; });
      const response = new Promise<AgentResponse>(resolve => { finish = resolve; });
      mock.method(research, 'execute', async () => { started(); return response; });
      const pending = noteAskService.ask(note.id, 'passage');
      await began;
      const content = change === 'removed' ? 'new editor content' : 'new prefix\npassage\n\nnew tail';
      if (change !== 'unchanged') notes.notesService.update(note.id, { content });
      finish({ requestId: 'fixture', agentId: research.id, agentName: research.name, content: 'controlled answer', timestamp: new Date().toISOString() });
      if (change === 'unchanged') {
        const result = await pending;
        assert.ok(result.note.content.startsWith('passage\n'));
        assert.ok(result.note.content.includes('controlled answer'));
        assert.ok(result.note.content.endsWith('old tail'));
      } else {
        await assert.rejects(pending, { statusCode: 409 });
        assert.equal(notes.notesService.get(note.id).content, content);
      }
      mock.restoreAll();
    }
  } finally { mock.restoreAll(); agents.agentRegistry.unregister(research.id); }
});
