import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { Sandbox } from '../src/plugins/shared/Sandbox';
import { FilePlugin } from '../src/plugins/file/FilePlugin';
import { TerminalPlugin } from '../src/plugins/terminal/TerminalPlugin';
import type { PluginAction } from '../src/core/types/IPlugin';

let temp: string;
let root: string;
const action = (name: string, payload: Record<string, unknown>): PluginAction => ({ action: name, payload, requestId: 'test', agentId: 'test' });
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'luminary-tools-'));
  root = path.join(temp, 'sandbox');
  await fs.mkdir(root);
  process.env.FILE_SANDBOX_DIR = root;
  process.env.TERMINAL_SANDBOX_DIR = root;
  process.env.FILE_ALLOWED_DIRS = '';
  process.env.LOG_LEVEL = 'error';
});
afterEach(async () => { mock.restoreAll(); await fs.rm(temp, { recursive: true, force: true }); });

test('filesystem accepts normalized and absolute allowed paths, blocks traversal and sibling-prefix escapes', async () => {
  const sandbox = new Sandbox(root);
  for (const value of ['a/../file.txt', path.join(root, 'file.txt')]) assert.ok('abs' in await sandbox.safeResolve(value));
  for (const value of ['../escape', path.join(temp, 'sandbox-other', 'file'), path.parse(root).root, '', null, 'bad\0path']) assert.ok('error' in await sandbox.safeResolve(value), String(value));
});
test('filesystem blocks symlink targets, ancestor junction escapes, and protected paths', async () => {
  const outside = path.join(temp, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const secret = path.join(root, 'identity.md');
  await fs.writeFile(secret, 'protected');
  const sandbox = new Sandbox(root, [secret]);
  for (const p of ['link', 'link/new/file', 'identity.md']) assert.ok('error' in await sandbox.safeResolve(p));
});

test('filesystem accepts Windows short-name roots without exposing protected files or junction escapes', { skip: process.platform !== 'win32' }, async (t) => {
  root = path.join(root, 'multiple alias ancestors', 'inner sandbox folder');
  await fs.mkdir(root, { recursive: true });
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class ShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder output, uint size); }'; $buffer = New-Object System.Text.StringBuilder 32768; if ([ShortPath]::GetShortPathName($env:LUMINARY_TEST_ALIAS_ROOT, $buffer, 32768) -eq 0) { exit 1 }; [Console]::Write($buffer.ToString())`;
  const shortRoot = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, LUMINARY_TEST_ALIAS_ROOT: root },
  });
  if (shortRoot.toLowerCase() === root.toLowerCase()) { t.skip('This volume does not provide a short-name alias for the fixture'); return; }
  const secret = path.join(root, 'protected-identity.txt');
  await fs.writeFile(secret, 'protected');
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested', 'unicode.txt'), '€ text');
  const sandbox = new Sandbox(shortRoot, [path.join(shortRoot, 'protected-identity.txt'), path.join(shortRoot, 'future-secret.txt')]);
  const mixedRoot = path.join(path.dirname(root), path.basename(shortRoot));
  for (const value of ['nested/unicode.txt', path.join(root, 'nested', 'unicode.txt'), path.join(mixedRoot, 'nested', 'unicode.txt'), 'new/file.txt']) {
    const resolved = await sandbox.safeResolve(value);
    assert.ok('abs' in resolved, JSON.stringify(resolved));
  }
  assert.ok('content' in await sandbox.read('nested/unicode.txt', 1024));
  const tree = await sandbox.readTree('.', 2);
  assert.ok('node' in tree);
  assert.equal(tree.node.children?.find(entry => entry.name === 'nested')?.type, 'dir');
  for (const value of ['protected-identity.txt', secret, path.join(root, 'future-secret.txt'), '../outside']) {
    assert.ok('error' in await sandbox.safeResolve(value), value);
  }
  const outside = path.join(temp, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'escape'), 'junction');
  assert.ok('error' in await sandbox.safeResolve('escape/file.txt'));
  const junctionRoot = path.join(temp, 'junction-root'); await fs.symlink(outside, junctionRoot, 'junction');
  assert.ok('error' in await new Sandbox(junctionRoot).safeResolve('file.txt'));
  await fs.mkdir(path.join(outside, 'child'));
  assert.ok('error' in await new Sandbox(path.join(junctionRoot, 'child')).safeResolve('file.txt'));
  process.env.FILE_SANDBOX_DIR = shortRoot;
  const plugin = new FilePlugin(); await plugin.initialize();
  assert.equal((await plugin.execute(action('write', { path: 'created/file.txt', content: 'alias write' }))).success, true);
  assert.equal(await fs.readFile(path.join(root, 'created', 'file.txt'), 'utf8'), 'alias write');
});
test('filesystem rejects platform-confusing paths', async () => {
  const sandbox = new Sandbox(root);
  const bad = process.platform === 'win32' ? ['C:relative.txt', 'file.txt:stream', '\\\\server\\share\\file'] : ['C:\\Windows\\file', '..\\escape', '\\\\server\\share'];
  for (const p of bad) assert.ok('error' in await sandbox.safeResolve(p), p);
});

test('filesystem rejects outside Windows network paths before filesystem access', { skip: process.platform !== 'win32' }, async () => {
  const sandbox = new Sandbox(root);
  let calls = 0;
  const refuse = () => { calls++; throw Object.assign(new Error('Unexpected filesystem access'), { code: 'EACCES' }); };
  mock.method(fsSync.realpathSync, 'native', refuse);
  mock.method(fs, 'lstat', refuse);
  mock.method(fs, 'stat', refuse);
  mock.method(fs, 'realpath', refuse);
  const result = await sandbox.safeResolve('\\\\unreachable-host\\share\\file.txt');
  assert.ok('error' in result);
  assert.equal(calls, 0);
});
test('read caps bytes without breaking UTF-8; writes/deletes stay confined and advertise confirmation', async () => {
  await fs.writeFile(path.join(root, 'unicode.txt'), '€'.repeat(100));
  const result = await new Sandbox(root).read('unicode.txt', 4);
  assert.ok('content' in result);
  assert.equal(result.truncated, true);
  assert.equal(result.content.includes('\uFFFD'), false);
  const file = new FilePlugin(); await file.initialize();
  for (const name of ['write', 'delete']) assert.equal(file.manifest.capabilities.find(c => c.action === name)?.requiresConfirmation, true);
  assert.equal((await file.execute(action('write', { path: '../outside', content: 'x' }))).success, false);
  assert.equal((await file.execute(action('write', { path: 'ok.txt', content: 'x' }))).success, true);
  assert.equal((await file.execute(action('delete', { path: 'ok.txt' }))).success, true);
  assert.equal((await file.execute(action('delete', { path: '../outside' }))).success, false);
});
test('terminal native commands are literal, bounded and confined; execution is confirmation-gated', async () => {
  const plugin = new TerminalPlugin(); await plugin.initialize();
  assert.equal(plugin.manifest.capabilities.find(c => c.action === 'exec')?.requiresConfirmation, true);
  assert.equal((await plugin.execute(action('exec', { command: 'pwd' }))).success, true);
  const echo = await plugin.execute(action('exec', { command: 'echo', args: ['hello > output; exit'] }));
  assert.equal((echo.data as {stdout:string}).stdout, 'hello > output; exit');
  const long = await plugin.execute(action('exec', { command: 'echo', args: ['€'.repeat(10000)] }));
  assert.ok(Buffer.byteLength((long.data as {stdout:string}).stdout) < 4200);
  assert.equal((await plugin.execute(action('exec', { command: 'cat', args: ['../outside'] }))).success, false);
  assert.equal((await plugin.execute(action('exec', { command: 'node', args: ['-e', 'process.exit()'] }))).success, false);
});
test('terminal rejects Git injection, mutation, malformed arguments and option abbreviations', async () => {
  const plugin = new TerminalPlugin(); await plugin.initialize();
  const cases: unknown[] = [
    ['status', ';whoami'], ['diff', '>out'], ['status', '../outside'], ['-c', 'alias.x=bad', 'status'],
    ['branch', 'new-branch'], ['tag', '-d', 'old'], ['--git-dir=../outside', 'status'],
    ['--out=marker', 'log'], ['--exec-p=bad', 'status'], ['show', '--textconv'],
    [42], 'status', ['status', null],
  ];
  for (const args of cases) {
    const res = await plugin.execute(action('exec', {command:'git', args}));
    assert.equal(res.success, false, JSON.stringify(args));
    assert.match(res.error ?? '', /reject|permit|argument/i, JSON.stringify(args));
  }
});
test('Git status cannot execute a repository-local fsmonitor program or discover a parent repo', async () => {
  const marker = path.join(temp, 'executed');
  const helper = path.join(temp, 'fsmonitor.cjs');
  await fs.writeFile(helper, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  execFileSync('git', ['init', '--quiet', root], {windowsHide:true});
  execFileSync('git', ['-C', root, 'config', 'core.fsmonitor', `node "${helper}"`], {windowsHide:true});
  const plugin = new TerminalPlugin(); await plugin.initialize();
  const res = await plugin.execute(action('exec', {command:'git',args:['status','--porcelain']}));
  assert.equal(res.success, true, res.error);
  assert.equal(await fs.stat(marker).then(()=>true,()=>false), false);
});

test('Git rejects external gitdir pointers, junctions and object alternates', async () => {
  const external = path.join(temp, 'external');
  execFileSync('git', ['init', '--quiet', external], { windowsHide: true });
  const plugin = new TerminalPlugin(); await plugin.initialize();
  const metadata = path.join(root, '.git');
  await fs.writeFile(metadata, `gitdir: ${path.join(external, '.git')}\n`);
  assert.equal((await plugin.execute(action('exec', {command:'git',args:['status']}))).success, false);
  await fs.unlink(metadata);
  await fs.symlink(path.join(external, '.git'), metadata, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await plugin.execute(action('exec', {command:'git',args:['status']}))).success, false);
  await fs.unlink(metadata);
  execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  await fs.writeFile(path.join(metadata, 'objects', 'info', 'alternates'), path.join(external, '.git', 'objects'));
  assert.equal((await plugin.execute(action('exec', {command:'git',args:['log']}))).success, false);
});

test('terminal reports subprocess timeout and bounds both captured streams', async () => {
  execFileSync('git', ['init', '--quiet', root], {windowsHide:true});
  const plugin=new TerminalPlugin(); await plugin.initialize();
  for (const timedOut of [true,false]) {
    mock.method(childProcess, 'execFile', (...args: unknown[]) => {
      const options=args[2] as {shell:boolean;timeout:number;maxBuffer:number};
      assert.equal(options.shell,false);assert.equal(options.timeout,10000);assert.equal(options.maxBuffer,1024*1024);
      const callback=args[3] as (error:Error | null, stdout:string, stderr:string)=>void;
      callback(timedOut?Object.assign(new Error('timeout'),{killed:true}):null,'€'.repeat(10000),'x'.repeat(10000));
    });
    const result=await plugin.execute(action('exec',{command:'git',args:['status']}));
    assert.equal(result.success,!timedOut);
    const data=result.data as {stdout:string;stderr:string;timedOut?:boolean};
    assert.ok(Buffer.byteLength(data.stdout)<4200);assert.ok(Buffer.byteLength(data.stderr)<4200);
    assert.equal(data.stdout.includes('\uFFFD'),false);
    if(timedOut)assert.equal(data.timedOut,true);
    mock.restoreAll();
  }
});
