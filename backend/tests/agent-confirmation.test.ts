import { test, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BaseAgent, setPendingTurnStore } from '../src/agents/BaseAgent';
import { modelRegistry } from '../src/core/registry/ModelRegistry';
import { pluginRegistry } from '../src/core/registry/PluginRegistry';
import { FilePlugin } from '../src/plugins/file/FilePlugin';
import { modelService } from '../src/services/ModelService';
import { KeywordStrategy } from '../src/router/strategies/KeywordStrategy';
import { ConversationAgent } from '../src/agents/ConversationAgent';
import { CodingAgent } from '../src/agents/CodingAgent';
import { ResearchAgent } from '../src/agents/ResearchAgent';
import { HomeAgent } from '../src/agents/HomeAgent';
import type { AgentRequest } from '../src/core/types/IAgent';
import type { IModelProvider } from '../src/core/types/IModelProvider';

class ToolAgent extends BaseAgent {
  readonly id='test-agent'; readonly name='Test'; readonly role='test'; readonly description='test'; readonly systemPrompt='test'; readonly capabilities=[];
  protected readonly allowedPlugins=['file-plugin'];
  canHandle(){return true;}
  async resolveModel(){return 'test-model';}
}
let dir:string; let root:string;
const store = new Map<string,{json:string;expiresAt:number}>();
const req = (sessionId='session', confirmedToolCallIds?:string[]):AgentRequest => ({id:'request',sessionId,content:'write the test file',timestamp:new Date().toISOString(),confirmedToolCallIds});
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'luminary-agent-'));root=path.join(dir,'sandbox');
  process.env.FILE_SANDBOX_DIR=root; process.env.FILE_ALLOWED_DIRS='';
  process.env.LUMEN_IDENTITY_PATH=path.join(dir,'identity.md'); process.env.LUMEN_MEMORIES_PATH=path.join(dir,'memories.md');
  await pluginRegistry.register(new FilePlugin());
});
beforeEach(()=>{
  mock.restoreAll();store.clear();
  setPendingTurnStore({put(id,json,expiresAt){store.set(id,{json,expiresAt});},get(id){const item=store.get(id);return item && item.expiresAt>Date.now()?item.json:null;},deleteMany(ids){ids.forEach(id=>store.delete(id));}});
});
after(async()=>{mock.restoreAll();await pluginRegistry.shutdownAll();await fs.rm(dir,{recursive:true,force:true});});
function agent(){
  let calls=0;
  const provider:IModelProvider={id:'mock',name:'Mock',supportsTools:()=>true,
    async healthCheck(){return {status:'connected',checkedAt:new Date().toISOString()};},
    async listModels(){return [];},async loadModel(){},async unloadModel(){},
    async complete(){throw new Error('Unexpected plain completion');},async embed(){throw new Error('Unexpected embed');},
    async chatWithTools(){calls++;return {content:calls===1?'':'done',model:'test-model',providerId:'mock',toolCalls:calls===1?[{id:'model-proposed-id',name:'write',arguments:{path:'approved.txt',content:'original payload'}}]:[],durationMs:1,aborted:false};}};
  mock.method(modelService,'findOwner',async()=>({provider,model:{id:'test-model',name:'Test',providerId:'mock',providerName:'Mock',family:'test',sizeLabel:'0 B',type:'general',status:'loaded',contextLength:2048}}));
  return new ToolAgent(modelRegistry);
}
test('agent pauses writes, resumes exact saved payload after approval, and consumes the token', async()=>{
  const a=agent();const paused=await a.execute(req());const token=paused.pendingConfirmations![0].id;
  assert.notEqual(token,'model-proposed-id');assert.equal(await fs.stat(path.join(root,'approved.txt')).then(()=>true,()=>false),false);
  const done=await a.execute({...req('session',[token]),content:'write something different'});
  assert.equal(done.content,'done');assert.equal(await fs.readFile(path.join(root,'approved.txt'),'utf8'),'original payload');assert.equal(store.has(token),false);
  await fs.unlink(path.join(root,'approved.txt'));
  await assert.rejects(a.execute(req('session',[token])), /confirmation|approval|expired/i);
});
test('approval cannot resume another conversation, and leaves the rightful token usable', async()=>{
  const a=agent();const paused=await a.execute(req());const token=paused.pendingConfirmations![0].id;
  await assert.rejects(a.execute(req('other-session',[token])), /confirmation|approval|session|conversation/i);
  assert.equal(store.has(token),true);
  await a.execute(req('session',[token]));await fs.unlink(path.join(root,'approved.txt'));
});
test('expired and unknown tokens do not restart the model or perform tools', async()=>{
  const a=agent();const paused=await a.execute(req());const token=paused.pendingConfirmations![0].id;
  store.get(token)!.expiresAt=Date.now()-1;
  await assert.rejects(a.execute(req('session',[token])), /confirmation|approval|expired/i);
  await assert.rejects(a.execute(req('session',['model-proposed-id'])), /confirmation|approval|expired/i);
});
test('a denied token is revoked server-side and cannot later execute', async()=>{
  const a=agent();const paused=await a.execute(req());const token=paused.pendingConfirmations![0].id;
  const {denyPendingConfirmations}=await import('../src/agents/BaseAgent');
  denyPendingConfirmations('session',[token]);
  await assert.rejects(a.execute(req('session',[token])),/confirmation|approval|expired/i);
});

test('malformed persisted approvals fail closed without executing a tool', async()=>{
  const a=agent();const paused=await a.execute(req());const token=paused.pendingConfirmations![0].id;
  const valid=store.get(token)!.json;
  for(const bad of ['null','{bad',JSON.stringify({...JSON.parse(valid),createdAt:'invalid'}),JSON.stringify({...JSON.parse(valid),pending:[null]})]){
    store.get(token)!.json=bad;
    await assert.rejects(a.execute(req('session',[token])),/confirmation|approval|expired/i);
    assert.equal(await fs.stat(path.join(root,'approved.txt')).then(()=>true,()=>false),false);
  }
});
test('router selects coding, research, home and conversation agents for representative prompts',()=>{
  const candidates=[new CodingAgent(modelRegistry),new ResearchAgent(modelRegistry),new HomeAgent(modelRegistry),new ConversationAgent(modelRegistry)];
  for(const [content,id] of [['debug this TypeScript function','coding-agent'],['research and search for sources','research-agent'],['turn the lights on in the bedroom','home-agent'],['hello, how are you','conversation-agent']]){
    assert.equal(new KeywordStrategy().selectAgent(candidates,{...req(),content})?.id,id);
  }
});
