import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { OllamaProvider } from '../src/models/providers/OllamaProvider';
import { openDatabase, SqliteMemoryProvider, SqlitePendingTurnStore, minSimilarityFloor } from '../src/memory/providers/SqliteMemoryProvider';
afterEach(() => mock.restoreAll());
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: {'Content-Type':'application/json'} });

test('Ollama health and discovery normalize actual provider data', async () => {
  mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/api/version')) return response({version:'test-version'});
    if (url.endsWith('/api/ps')) return response({models:[{name:'test:1',size:123,size_vram:0}]});
    if (url.endsWith('/api/show')) return response({model_info:{'test.context_length':8192}});
    return response({models:[{name:'test:1',model:'test:1',size:123,digest:'digest',details:{family:'test'}}]});
  });
  const provider = new OllamaProvider();
  assert.equal((await provider.healthCheck()).status, 'connected');
  const [model] = await provider.listModels();
  assert.equal(model.name, 'test:1'); assert.equal(model.status, 'loaded'); assert.equal(model.contextLength,8192);
});
test('Ollama disconnected and malformed responses fail honestly', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('connection refused'); });
  assert.equal((await new OllamaProvider().healthCheck()).status, 'disconnected');
  await assert.rejects(new OllamaProvider().listModels(), /Cannot reach Ollama/);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => response({models:'invalid'}));
  await assert.rejects(new OllamaProvider().listModels());
});
test('Ollama NDJSON supports split UTF-8 and final line, errors do not fabricate completion', async () => {
  const bytes = new TextEncoder().encode('{"message":{"content":"€"},"done":false}\n{"done":true,"eval_count":3}');
  mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,25));c.enqueue(bytes.slice(25));c.close();}})));
  const tokens:string[]=[];
  const result = await new OllamaProvider().chatStream([], {model:'test'}, t=>tokens.push(t));
  assert.equal(result.content,'€'); assert.deepEqual(tokens,['€']); assert.equal(result.completionTokens,3);
  mock.restoreAll(); mock.method(globalThis,'fetch',async()=>new Response('{bad json}\n'));
  await assert.rejects(new OllamaProvider().chatStream([], {model:'test'},()=>{}));
});
test('Ollama cancellation returns partial content and aborted status', async () => {
  const abort = new AbortController();
  mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"message":{"content":"partial"},"done":false}\n'));},pull(c){abort.abort();c.error(new Error('aborted'));}})));
  const result=await new OllamaProvider().chatStream([], {model:'test',signal:abort.signal},()=>{});
  assert.equal(result.aborted,true); assert.equal(result.content,'partial');
});

test('Ollama rejects provider error records and incomplete chat/tool streams', async () => {
  for (const trailer of ['{"error":"provider exhausted"}\n', '']) {
    mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/api/show') ? response({capabilities:[]}) : new Response('{"message":{"content":"partial","tool_calls":[{"function":{"name":"write","arguments":{}}}]},"done":false}\n' + trailer));
    await assert.rejects(new OllamaProvider().chatStream([], {model:'test'},()=>{}), /provider exhausted|completion/i);
    await assert.rejects(new OllamaProvider().chatWithTools([], [], {model:'test'}), /provider exhausted|completion/i);
    mock.restoreAll();
  }
});
test('SQLite memories persist, search, delete and skip corrupt/malformed metadata', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luminary-memory-'));
  const dbFile=path.join(dir,'state.sqlite'); let db=openDatabase(dbFile);
  try {
    let memory=new SqliteMemoryProvider(db,async()=>[1,0]);
    const entry={type:'fact' as const,content:'test fact',agentId:'test',agentName:'Test',importance:'medium' as const,tags:['test'],createdAt:new Date().toISOString()};
    const written=await memory.write(entry); assert.equal(written.success,true);
    assert.equal((await memory.query({semantic:'related'}))[0].id,written.id);
    db.close(); db=openDatabase(dbFile); memory=new SqliteMemoryProvider(db,async()=>[1,0]);
    assert.equal((await memory.read(written.id))?.content,'test fact');
    db.prepare('UPDATE memories SET tags=? WHERE id=?').run('{bad',written.id);
    assert.equal(await memory.read(written.id),null);
    db.prepare('UPDATE memories SET tags=? WHERE id=?').run('{}',written.id);
    assert.deepEqual(await memory.query({tags:['test']}),[]);
    assert.equal(await memory.delete(written.id),true); assert.equal(await memory.count(),0);
    const pending=new SqlitePendingTurnStore(db); pending.put('expired','{}',Date.now()-1); assert.equal(pending.get('expired'),null);
    pending.put('live','{}',Date.now()+10000); assert.equal(pending.get('live'),'{}'); pending.deleteMany(['live']); assert.equal(pending.get('live'),null);
  } finally {db.close(); await fs.rm(dir,{recursive:true,force:true});}
});
test('blank memory relevance configuration keeps the conservative default', () => {
  const old=process.env.MEMORY_MIN_SIMILARITY; process.env.MEMORY_MIN_SIMILARITY='';
  try {assert.equal(minSimilarityFloor(),0.5);} finally {if(old===undefined)delete process.env.MEMORY_MIN_SIMILARITY;else process.env.MEMORY_MIN_SIMILARITY=old;}
});
