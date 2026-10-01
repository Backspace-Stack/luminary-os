import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { createAccessControl, assertSafeBind } from '../src/middleware/accessControl';

test('local API rejects hostile Origin, missing-Origin cross-site requests and DNS-rebound hosts before mutation', async()=>{
  let mutations=0;const app=express();
  app.use(createAccessControl({host:'127.0.0.1',frontendUrl:'http://localhost:5173',allowedHosts:['localhost','127.0.0.1']}));
  app.post('/api/mutate',(_req,res)=>{mutations++;res.sendStatus(200);});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mutate`;
  const post = (headers: Record<string,string>) => new Promise<number>(resolve => {
    const req = request(url, {method:'POST',headers}, res=>{res.resume();resolve(res.statusCode!);});req.end();
  });
  try{
    assert.equal(await post({Host:'127.0.0.1',Origin:'https://hostile.example'}),403);
    assert.equal(await post({Host:'hostile.example'}),403);
    assert.equal(await post({Host:'127.0.0.1','Sec-Fetch-Site':'cross-site'}),403);
    assert.equal(mutations,0);
    assert.equal(await post({Host:'127.0.0.1',Origin:'http://localhost:5173'}),200);
    assert.equal(await post({Host:'127.0.0.1'}),200);assert.equal(mutations,2);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('external bind requires an API token and refuses wildcard origins',()=>{
  assert.throws(()=>assertSafeBind('0.0.0.0','', 'http://localhost:5173'),/token/i);
  assert.throws(()=>assertSafeBind('127.0.0.1','', '*'),/origin|URL/i);
  assert.doesNotThrow(()=>assertSafeBind('127.0.0.1','', 'http://localhost:5173'));
  assert.doesNotThrow(()=>assertSafeBind('0.0.0.0','test-token', 'http://localhost:5173'));
});
