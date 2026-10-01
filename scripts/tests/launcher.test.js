'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, before, after } = require('node:test');
const { IS_WIN, runSync, runAsync, withLocalBin, which } = require('../lib/shell');

function launchConfiguration() {
  let configuration;
  assert.doesNotThrow(() => { configuration = require('../lib/launch-config'); });
  return configuration;
}

const root = path.resolve(__dirname, '../..');
const dependencyRoot = process.env.LUMINARY_LAUNCHER_TEST_CWD || root;
let fixture;
let script;

before(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'luminary launcher regression & '));
  script = path.join(fixture, 'echo arguments.js');
  fs.writeFileSync(script, `process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }));
  process.stderr.write('child stderr');
  process.exitCode = Number(process.env.LAUNCHER_TEST_EXIT || 0);
});`);
});

after(() => fs.rmSync(fixture, { recursive: true, force: true }));

test('managed launcher origin uses the exact bound frontend port including the template default', () => {
  const { resolveFrontendOrigin } = launchConfiguration();
  assert.equal(resolveFrontendOrigin(), 'http://127.0.0.1:5173');
  assert.equal(resolveFrontendOrigin(5180), 'http://127.0.0.1:5180');
  assert.equal(resolveFrontendOrigin(5180, undefined, 'http://localhost:5173'), 'http://127.0.0.1:5180');
  assert.equal(resolveFrontendOrigin(80), 'http://127.0.0.1');
});

test('launcher preserves an explicit same-port localhost origin and process env takes precedence', () => {
  const { resolveFrontendOrigin } = launchConfiguration();
  assert.equal(resolveFrontendOrigin(5180, 'http://localhost:5180'), 'http://localhost:5180');
  assert.equal(resolveFrontendOrigin(5173, 'http://localhost:5173'), 'http://localhost:5173');
  assert.equal(resolveFrontendOrigin(5180, undefined, 'http://localhost:5180'), 'http://localhost:5180');
  assert.equal(resolveFrontendOrigin(5180, 'http://127.0.0.1:5180', 'http://localhost:9999'), 'http://127.0.0.1:5180');
});

test('launcher rejects origin mismatches and unsafe/unserved overrides with actionable errors', () => {
  const { resolveFrontendOrigin } = launchConfiguration();
  for (const value of [
    'http://localhost:9999', 'https://localhost:5180', 'http://example.com:5180',
    'http://0.0.0.0:5180', 'http://127.0.0.1:5180/path', 'http://user:password@127.0.0.1:5180',
    'http://127.0.0.1:5180?token=secret', 'http://127.0.0.1:5180#fragment', '*', '',
  ]) {
    assert.throws(() => resolveFrontendOrigin(5180, value), /FRONTEND_URL.*VITE_PORT.*5180/);
  }
  assert.throws(() => resolveFrontendOrigin(5180, undefined, 'http://localhost:9999'), /FRONTEND_URL.*VITE_PORT.*5180/);
  for (const port of [0, 65536, NaN, 5180.5, '5180junk']) assert.throws(() => resolveFrontendOrigin(port), /VITE_PORT/);
});

test('launcher reads only the frontend origin from actual backend env files and tolerates missing files', () => {
  const { readFrontendUrl } = launchConfiguration();
  const envFile = path.join(fixture, 'backend.env');
  assert.equal(readFrontendUrl(envFile), undefined);
  fs.writeFileSync(envFile, 'OTHER_SECRET=must-not-be-returned\nFRONTEND_URL="http://localhost:5180" # local origin\n');
  assert.equal(readFrontendUrl(envFile), 'http://localhost:5180');
  fs.writeFileSync(envFile, "FRONTEND_URL=http://localhost:5173\nexport FRONTEND_URL='http://127.0.0.1:5180'\n");
  assert.equal(readFrontendUrl(envFile), 'http://127.0.0.1:5180');
});

test('actual launcher rejects a mismatched override before installing or starting services', () => {
  const result = runSync(process.execPath, [path.join(root, 'scripts/start.js')], {
    env: { ...process.env, VITE_PORT: '5180', FRONTEND_URL: 'http://localhost:9999' },
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /FRONTEND_URL.*VITE_PORT 5180/);
  assert.doesNotMatch(result.stdout + result.stderr, /Installing.*dependencies|Starting backend/);
});

function collect(child, input = '') {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => stdout += chunk);
    child.stderr?.on('data', (chunk) => stderr += chunk);
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ stdout, stderr, status, signal }));
    child.stdin?.end(input);
  });
}

for (const options of [{}, { shell: false }]) {
  const mode = options.shell === false ? 'explicit shell:false' : 'default options';
  test(`sync and async preserve literal shell characters with ${mode}`, async () => {
    const payload = ['a value with spaces', 'literal & | < > ^ %PATH% ! ( ) " quotes', ''];
    const opts = { ...options, cwd: fixture, env: { ...process.env, LAUNCHER_TEST_EXIT: '17' } };
    const sync = runSync(process.execPath, [script, ...payload], { ...opts, input: 'stdin payload' });
    assert.ifError(sync.error);
    const async = await collect(runAsync(process.execPath, [script, ...payload], opts), 'stdin payload');
    for (const result of [sync, async]) {
      assert.equal(result.status, 17);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, 'child stderr');
      assert.deepEqual(JSON.parse(result.stdout), { args: payload, input: 'stdin payload', cwd: fixture });
    }
  });
}

test('ignored stdio remains ignored and preserves the child exit code', async () => {
  const opts = { cwd: fixture, stdio: 'ignore', env: { ...process.env, LAUNCHER_TEST_EXIT: '9' } };
  const sync = runSync(process.execPath, [script], opts);
  assert.ifError(sync.error);
  assert.equal(sync.status, 9);
  assert.equal(sync.stdout, null);
  assert.equal(sync.stderr, null);
  const child = runAsync(process.execPath, [script], opts);
  assert.equal(child.stdin, null);
  assert.equal(child.stdout, null);
  assert.equal(child.stderr, null);
  assert.equal((await collect(child)).status, 9);
});

test('missing executable preserves spawnSync error and asynchronous error event', async () => {
  const name = 'luminary-executable-that-does-not-exist-21c7';
  const sync = runSync(name, [], { shell: false });
  assert.equal(sync.error?.code, 'ENOENT');
  await assert.rejects(collect(runAsync(name, [], { shell: false })), { code: 'ENOENT' });
});

test('real npm commands resolve without a shell or DEP0190 warnings', async () => {
  for (const name of IS_WIN ? ['npm', 'npm.cmd', which('npm.cmd')[0]] : ['npm']) {
    assert.ok(name, 'npm must be installed to verify the launcher');
    const sync = runSync(name, ['--version'], { shell: false });
    assert.ifError(sync.error);
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout.trim(), /^\d+\.\d+\.\d+$/);
    const async = await collect(runAsync(name, ['--version'], { shell: false }));
    assert.equal(async.status, 0, async.stderr);
    assert.equal(async.stdout, sync.stdout);
  }

  // Run a separate real Node process so warnings emitted on a later tick
  // are captured without altering this test runner's warning handlers.
  const probe = path.join(fixture, 'npm probe.js');
  fs.writeFileSync(probe, `const { runSync } = require(${JSON.stringify(path.join(root, 'scripts/lib/shell.js'))});
const result = runSync('npm', ['--version']);
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.exitCode = result.status;`);
  const result = runSync(process.execPath, [probe], { shell: false });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /DEP0190/);
});

for (const [tool, directory, versionPattern] of [
  ['tsx', 'backend', /^tsx v\d+\./],
  ['vite', 'frontend', /^vite\/\d+\./],
]) {
  test(`real local ${tool} shim resolves with sync and async parity`, async (t) => {
    const cwd = path.join(dependencyRoot, directory);
    const bin = path.join(cwd, 'node_modules/.bin', tool + (IS_WIN ? '.cmd' : ''));
    if (!fs.existsSync(bin)) return t.skip(`Install ${directory} dependencies to check ${tool}`);
    const opts = { cwd, env: withLocalBin(cwd), shell: false };
    for (const command of [tool, bin]) {
      const sync = runSync(command, ['--version'], opts);
      assert.ifError(sync.error);
      assert.equal(sync.status, 0, sync.stderr);
      assert.match(sync.stdout.trim(), versionPattern);
      const async = await collect(runAsync(command, ['--version'], opts));
      assert.equal(async.status, 0, async.stderr);
      assert.equal(async.stdout, sync.stdout);
    }
  });
}
