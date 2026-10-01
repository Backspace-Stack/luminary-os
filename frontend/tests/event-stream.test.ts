import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { subscribeEventStream } from '../src/services/eventStream';

async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'Expected observable stream behavior before deadline');
}

test('SSE client preserves split UTF-8, CRLF and multiline data without dispatching comments or partial events', async () => {
  const body = Buffer.from(': ping\r\nid: 1\r\ndata: first\r\ndata: café 🕯\r\n\r\ndata: incomplete');
  const endpoint = await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const byte of body) res.write(Buffer.from([byte]));
    res.end();
  });
  const messages: string[] = [];
  const stop = subscribeEventStream(endpoint.url, data => messages.push(data), { retryMs: 500 });
  try { await waitFor(() => messages.length > 0); assert.deepEqual(messages, ['first\ncafé 🕯']); }
  finally { stop(); await endpoint.close(); }
});

test('SSE client authenticates in headers and keeps credentials out of the URL', async () => {
  const endpoint = await fixture((req, res) => {
    if (req.headers.authorization !== 'Bearer fixture' || req.url !== '/events') { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: authorized\n\n');
  });
  let message = '';
  const stop = subscribeEventStream(endpoint.url, data => { message = data; }, { headers: () => ({ Authorization: 'Bearer fixture' }) });
  try { await waitFor(() => message !== ''); assert.equal(message, 'authorized'); }
  finally { stop(); await endpoint.close(); }
});

test('SSE client reconnects after a dropped stream and rereads the current auth headers', async () => {
  let connections = 0, current = 'first', message = '';
  const endpoint = await fixture((req, res) => {
    connections++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (connections === 1) { current = 'second'; res.end(': disconnected\n\n'); }
    else if (req.headers.authorization === 'Bearer second') res.end('data: recovered\n\n');
    else res.end();
  });
  const stop = subscribeEventStream(endpoint.url, data => { message = data; }, { retryMs: 10, headers: () => ({ Authorization: `Bearer ${current}` }) });
  try { await waitFor(() => message !== ''); assert.equal(message, 'recovered'); }
  finally { stop(); await endpoint.close(); }
});

test('closing an SSE subscription aborts the live connection and prevents more callbacks', async () => {
  let connected = false, closed = false, called = false;
  const endpoint = await fixture((req, res) => {
    connected = true;
    req.on('close', () => { closed = true; });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
  });
  const stop = subscribeEventStream(endpoint.url, () => { called = true; }, { retryMs: 10 });
  try { await waitFor(() => connected); stop(); await waitFor(() => closed); assert.equal(called, false); }
  finally { stop(); await endpoint.close(); }
});

test('SSE client reports rejected authentication without continuously retrying it', async () => {
  let requests = 0;
  const endpoint = await fixture((_req, res) => { requests++; res.writeHead(401); res.end(); });
  const states: string[] = [];
  const stop = subscribeEventStream(endpoint.url, () => assert.fail('Unauthorized event delivered'), { retryMs: 10, onState: state => states.push(state) });
  try {
    await waitFor(() => states.includes('unauthorized'));
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.equal(requests, 1);
  } finally { stop(); await endpoint.close(); }
});

test('model API subscription recovers immediately when a runtime token is supplied or rotated', async () => {
  const { modelsApi, setApiAuthToken } = await import('../src/services/api');
  const endpoint = await fixture((req, res) => {
    if (!['Bearer fixture', 'Bearer rotated'].includes(String(req.headers.authorization))) { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // The actual backend initially sends only a comment, not a snapshot event.
    res.write(': connected\n\ndata: null\n\ndata: malformed\n\n');
  });
  const original = globalThis.fetch;
  globalThis.fetch = (input, options) => original(typeof input === 'string' && input.startsWith('/api/') ? endpoint.url : input, options);
  let updates = 0;
  const states: string[] = [];
  const stop = modelsApi.subscribe(() => { updates++; }, state => states.push(state));
  try {
    await waitFor(() => states.includes('unauthorized'));
    setApiAuthToken('fixture');
    await waitFor(() => updates === 1);
    setApiAuthToken('rotated');
    await waitFor(() => updates === 2);
    assert.equal(updates, 2);
  } finally { stop(); setApiAuthToken(null); globalThis.fetch = original; await endpoint.close(); }
});

test('SSE frame limits include empty data lines so an unterminated frame cannot grow without bounds', async () => {
  const endpoint = await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data:\n'.repeat(60_000) + '\n');
  });
  const messages: string[] = [], states: string[] = [];
  const stop = subscribeEventStream(endpoint.url, data => messages.push(data), { retryMs: 500, onState: state => states.push(state) });
  try { await waitFor(() => states.includes('reconnecting')); assert.equal(messages.length, 0); }
  finally { stop(); await endpoint.close(); }
});

test('a throwing state observer does not leak an unhandled rejection or prevent event delivery', async () => {
  const endpoint = await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: delivered\n\n');
  });
  let message = '';
  const stop = subscribeEventStream(endpoint.url, data => { message = data; }, { retryMs: 500, onState: () => { throw new Error('Observer failed'); } });
  try { await waitFor(() => message !== ''); assert.equal(message, 'delivered'); }
  finally { stop(); await endpoint.close(); }
});
