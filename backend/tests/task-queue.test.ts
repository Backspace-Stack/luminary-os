import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelTaskQueue } from '../src/models/gguf/ModelTaskQueue';

test('same-model tasks wait for predecessor and recover after rejection; different models can run',async()=>{
  const queue=new ModelTaskQueue();const order:string[]=[];let release!:()=>void;
  const blocked=new Promise<void>(r=>{release=r;});
  const first=queue.run('one',async()=>{order.push('first');await blocked;throw new Error('expected failure');});
  const firstSettled=first.catch(()=>{});
  const second=queue.run('one',async()=>{order.push('second');});
  await queue.run('two',async()=>{order.push('other');});
  assert.deepEqual(order,['first','other']);release();await firstSettled;await second;
  assert.deepEqual(order,['first','other','second']);
});
