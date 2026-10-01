import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import models from '../src/routes/models';
import { createAuthTokenMiddleware } from '../src/middleware/authToken';

async function serve(app: express.Express, run:(url:string)=>Promise<void>) {
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  try {await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);} finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
test('bearer middleware rejects absent/wrong tokens while health remains open',async()=>{
  process.env.API_AUTH_TOKEN='test-only-token';
  const app=express();app.use('/api',createAuthTokenMiddleware()!);app.get('/api/health',(_req,res)=>res.sendStatus(200));app.get('/api/private',(_req,res)=>res.sendStatus(200));
  await serve(app,async url=>{
    assert.equal((await fetch(url+'/api/health')).status,200);
    assert.equal((await fetch(url+'/api/private')).status,401);
    assert.equal((await fetch(url+'/api/private',{headers:{Authorization:'Bearer wrong'}})).status,401);
    assert.equal((await fetch(url+'/api/private',{headers:{Authorization:'Bearer test-only-token'}})).status,200);
  });delete process.env.API_AUTH_TOKEN;
});
test('model upload rejects streams, traversal and invalid magic, and never overwrites an existing model',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luminary-upload-'));process.env.LUMINARY_MODELS_DIR=dir;
  const app=express();app.use('/models',models);app.use((err:Error & {statusCode?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(err.statusCode??500).json({message:err.message}));
  try {await serve(app,async url=>{
    for(const name of ['../bad.gguf','bad:stream.gguf','NUL.gguf'])assert.equal((await fetch(url+'/models/upload?name='+encodeURIComponent(name),{method:'PUT',body:'GGUFtest'})).status,400,name);
    assert.equal((await fetch(url+'/models/upload?name=invalid.gguf',{method:'PUT',body:'junk'})).status,400);
    assert.equal((await fetch(url+'/models/upload?name=test.gguf',{method:'PUT',body:'GGUFtest'})).status,200);
    assert.equal((await fetch(url+'/models/upload?name=test.gguf',{method:'PUT',body:'GGUFdifferent'})).status,409);
    assert.equal(await fs.readFile(path.join(dir,'test.gguf'),'utf8'),'GGUFtest');
    assert.deepEqual((await fs.readdir(dir)).sort(),['test.gguf']);
  });}finally{delete process.env.LUMINARY_MODELS_DIR;await fs.rm(dir,{recursive:true,force:true});}
});
