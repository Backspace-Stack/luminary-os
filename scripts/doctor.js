#!/usr/bin/env node
// =============================================================
// Luminary OS — Environment Doctor  (scripts/doctor.js)
//
// Run: node scripts/doctor.js   (or  npm run doctor)
//
// Diagnoses the full environment and reports exactly what's
// working, what's missing, and how to fix it. Uses the shared
// scripts/lib/shell.js helper so version checks are correct on
// Windows (the original doctor.js called npm with shell:false,
// which silently failed for the same reason start.js did).
// =============================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const http = require('http');
const { IS_WIN, which, runSync, comSpec } = require('./lib/shell');

const ROOT = path.resolve(__dirname, '..');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', white: '\x1b[37m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const col = (k, t) => `${k}${t}${C.reset}`;

const results = [];

function check(label, fn) {
  try {
    results.push({ label, ...fn() });
  } catch (e) {
    results.push({ label, ok: false, value: e.message, fix: null });
  }
}

function httpPing(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/api/health', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode < 500 ? 'running' : 'error'); }
    );
    req.on('error',   () => resolve('offline'));
    req.on('timeout', () => { req.destroy(); resolve('offline'); });
  });
}

function localBinPath(dir, name) {
  return path.join(dir, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name);
}

const { banner: luminaryBanner } = require('./lib/banner');

async function main() {
  luminaryBanner('Doctor', 'v0.1.0');
  console.log(col(C.dim, '  Checking your environment…\n'));

  // ── System ────────────────────────────────────────────────
  check('Node.js 24 LTS', () => {
    const ver = process.versions.node;
    const major = parseInt(ver.split('.')[0], 10);
    return major === 24
      ? { ok: true,  value: `v${ver}` }
      : { ok: false, value: `v${ver}`, fix: 'Install Node.js v24 LTS from https://nodejs.org' };
  });

  check('npm ≥ 10', () => {
    const r = runSync('npm', ['--version']);
    if (r.error || r.status !== 0) {
      return { ok: false, value: 'not found or failed to run', fix: 'Reinstall Node.js (includes npm)' };
    }
    const ver = r.stdout.trim();
    const major = parseInt(ver.split('.')[0], 10);
    return major >= 10
      ? { ok: true,  value: `v${ver}` }
      : { ok: false, value: `v${ver}`, fix: 'Run: npm install -g npm@latest' };
  });

  check('git (optional)', () => {
    const r = runSync('git', ['--version']);
    return (!r.error && r.status === 0)
      ? { ok: true, value: r.stdout.trim().replace('git version ', '') }
      : { ok: true, value: 'not installed (optional)', fix: null };
  });

  // ── Project structure ──────────────────────────────────────
  for (const [rel, label] of [
    ['backend',               'backend/ directory'],
    ['frontend',              'frontend/ directory'],
    ['backend/package.json',  'backend/package.json'],
    ['frontend/package.json', 'frontend/package.json'],
    ['scripts/start.js',      'scripts/start.js'],
    ['scripts/lib/shell.js',  'scripts/lib/shell.js'],
  ]) {
    check(label, () => {
      const exists = fs.existsSync(path.join(ROOT, rel));
      return exists
        ? { ok: true,  value: 'present' }
        : { ok: false, value: 'missing', fix: `Re-download or restore ${rel}` };
    });
  }

  // ── Dependencies (binary-level, not just folder existence) ──
  check('backend/node_modules', () => {
    const exists = fs.existsSync(path.join(ROOT, 'backend', 'node_modules'));
    return exists
      ? { ok: true,  value: 'installed' }
      : { ok: false, value: 'missing', fix: 'Run: cd backend && npm ci' };
  });

  check('frontend/node_modules', () => {
    const exists = fs.existsSync(path.join(ROOT, 'frontend', 'node_modules'));
    return exists
      ? { ok: true,  value: 'installed' }
      : { ok: false, value: 'missing', fix: 'Run: cd frontend && npm ci' };
  });

  check('ts-node-dev binary', () => {
    const bin = localBinPath(path.join(ROOT, 'backend'), 'ts-node-dev');
    return fs.existsSync(bin)
      ? { ok: true,  value: bin.replace(ROOT, '.') }
      : { ok: false, value: 'missing', fix: 'Run: cd backend && npm ci' };
  });

  check('vite binary', () => {
    const bin = localBinPath(path.join(ROOT, 'frontend'), 'vite');
    return fs.existsSync(bin)
      ? { ok: true,  value: bin.replace(ROOT, '.') }
      : { ok: false, value: 'missing', fix: 'Run: cd frontend && npm ci' };
  });

  // ── Environment files ──────────────────────────────────────
  for (const [dir, label] of [['backend', 'Backend'], ['frontend', 'Frontend']]) {
    check(`${label} .env`, () => {
      const hasEnv = fs.existsSync(path.join(ROOT, dir, '.env'));
      const hasEx  = fs.existsSync(path.join(ROOT, dir, '.env.example'));
      if (hasEnv) return { ok: true, value: 'present' };
      if (hasEx)  return { ok: false, value: 'missing', fix: `Run: cd ${dir} && copy .env.example .env` };
      return { ok: false, value: 'missing (.env.example also missing)', fix: null };
    });
  }

  // ── Running services ───────────────────────────────────────
  const [beStatus, feStatus] = await Promise.all([httpPing(3001), httpPing(5173)]);

  check('Backend (:3001)', () => ({
    ok: beStatus === 'running', value: beStatus,
    fix: beStatus !== 'running' ? 'Start with: npm start' : null,
  }));

  check('Frontend (:5173)', () => ({
    ok: feStatus === 'running', value: feStatus,
    fix: feStatus !== 'running' ? 'Start with: npm start' : null,
  }));

  // ── Optional services ──────────────────────────────────────
  const ollamaStatus = await httpPing(11434);
  check('Ollama (:11434, optional)', () => ({
    ok: true, // non-blocking — the app starts without it
    value: ollamaStatus === 'running'
      ? 'running ✓'
      : 'not running (Chat/Models will show connection errors)',
    fix: ollamaStatus === 'running' ? null : 'Install from https://ollama.com and run: ollama serve',
  }));

  // ── Windows-specific diagnostics ───────────────────────────
  if (IS_WIN) {
    check('ComSpec (cmd.exe)', () => {
      const cs = comSpec();
      return fs.existsSync(cs)
        ? { ok: true, value: cs }
        : { ok: false, value: `${cs} (not found!)`, fix: 'Your Windows install may be corrupted — contact IT' };
    });

    check('PATHEXT includes .CMD', () => {
      const pathext = (process.env.PATHEXT || '').toUpperCase();
      return pathext.includes('.CMD')
        ? { ok: true, value: 'yes' }
        : { ok: false, value: pathext || '(not set)', fix: 'Add ;.CMD;.BAT to your PATHEXT environment variable' };
    });

    check('node.exe location', () => {
      const paths = which('node');
      return paths.length
        ? { ok: true, value: paths[0] }
        : { ok: false, value: 'not found via where.exe', fix: 'Reinstall Node.js and ensure "Add to PATH" is checked' };
    });

    check('npm.cmd location', () => {
      const paths = which('npm');
      return paths.length
        ? { ok: true, value: paths[0] }
        : { ok: false, value: 'not found via where.exe', fix: 'See npm fix above' };
    });
  }

  // ── Print results ──────────────────────────────────────────
  console.log('');
  console.log(col(C.dim, '  ' + '─'.repeat(52)));

  const categoryHeaders = {
    'Node.js 24 LTS':              '\n  System',
    'backend/ directory':        '\n  Project Structure',
    'backend/node_modules':      '\n  Dependencies',
    'Backend .env':              '\n  Environment Files',
    'Backend (:3001)':           '\n  Running Services',
    'Ollama (:11434, optional)': '\n  Optional Services',
    'ComSpec (cmd.exe)':         '\n  Windows Diagnostics',
  };

  let fails = 0;
  for (const { label, ok, value, fix } of results) {
    if (categoryHeaders[label]) console.log(col(C.bold, categoryHeaders[label]));
    const icon  = ok ? col(C.green, '  ✓') : col(C.red, '  ✗');
    const lbl   = col(ok ? C.dim : C.white, label.padEnd(26));
    const val   = col(ok ? C.dim : C.yellow, value);
    console.log(`${icon}  ${lbl} ${val}`);
    if (!ok && fix) console.log(col(C.dim, `         Fix: ${fix}`));
    if (!ok) fails++;
  }

  console.log('');
  console.log(col(C.dim, '  ' + '─'.repeat(52)));

  if (fails === 0) {
    console.log(col(C.green + C.bold, '\n  ✦  All checks passed! Luminary OS is healthy.\n'));
  } else {
    console.log(col(C.yellow + C.bold, `\n  ⚠  ${fails} check${fails > 1 ? 's' : ''} failed. See fix hints above.`));
    console.log(col(C.dim, IS_WIN
      ? '  Quick fix: double-click Other\\setup.bat\n'
      : '  Quick fix: bash Other/setup.sh\n'
    ));
  }
}

main().catch((err) => {
  console.error(col(C.red, `\n  ✗  Doctor failed: ${err.message}\n`));
  process.exit(1);
});
