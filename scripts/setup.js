#!/usr/bin/env node
// =============================================================
// Luminary OS — First-Time Setup  (scripts/setup.js)
//
// Run once after downloading/cloning. Installs dependencies
// for root, backend, and frontend, and prepares .env files.
// Uses the same scripts/lib/shell.js helper as start.js so the
// Windows .cmd spawning fix applies here too.
// =============================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const { IS_WIN, runSync } = require('./lib/shell');

const ROOT = path.resolve(__dirname, '..');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const col  = (k, t) => `${k}${t}${C.reset}`;
const ok   = (m) => console.log(col(C.green, `  ✓  ${m}`));
const fail = (m) => console.error(col(C.red, `  ✗  ${m}`));
const info = (m) => console.log(col(C.cyan, `  →  ${m}`));
const step = (m) => console.log(col(C.bold, `\n  ${m}`));
const hr   = ()  => console.log(col(C.dim, '  ' + '─'.repeat(52)));

const { banner: luminaryBanner } = require('./lib/banner');
function banner() {
  luminaryBanner('Setup', 'v0.1.0');
}

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major !== 24) {
    fail(`Node.js v24 LTS required (found v${process.versions.node})`);
    console.log(col(C.yellow, '  Download from: https://nodejs.org'));
    process.exit(1);
  }
  ok(`Node.js v${process.versions.node}`);
}

function npmInstall(label, cwd) {
  info(`Installing ${label} dependencies…`);
  const r = runSync('npm', ['ci', '--no-fund', '--no-audit'], { cwd, stdio: 'inherit' });
  if (r.status !== 0) {
    fail(`Failed: ${label} dependency install`);
    log_hint(cwd);
    process.exit(1);
  }
  ok(`${label} dependencies installed`);
}

function log_hint(cwd) {
  console.log(col(C.dim, `  Try manually: cd ${path.relative(ROOT, cwd) || '.'} && npm ci`));
}

function copyEnv(dir, label) {
  const env = path.join(dir, '.env');
  const ex  = path.join(dir, '.env.example');
  if (!fs.existsSync(env) && fs.existsSync(ex)) {
    fs.copyFileSync(ex, env);
    ok(`${label} .env created`);
  } else if (fs.existsSync(env)) {
    ok(`${label} .env already exists`);
  }
}

function main() {
  banner();

  step('Checking Node.js…');
  checkNode();

  step('Installing repository tools…');
  npmInstall('Repository', ROOT);

  step('Installing backend dependencies…');
  npmInstall('Backend', path.join(ROOT, 'backend'));

  step('Installing frontend dependencies…');
  npmInstall('Frontend', path.join(ROOT, 'frontend'));

  step('Configuring environment files…');
  copyEnv(path.join(ROOT, 'backend'),  'Backend');
  copyEnv(path.join(ROOT, 'frontend'), 'Frontend');

  console.log('\n');
  hr();
  console.log(col(C.green + C.bold, '  ✓  Setup complete!\n'));
  console.log('  To start Luminary OS, run:\n');

  if (IS_WIN) {
    console.log(col(C.cyan, '      run.bat'));
    console.log(col(C.dim,  '      — or —'));
    console.log(col(C.cyan, '      npm start'));
  } else {
    console.log(col(C.cyan, '      ./Other/run.sh'));
    console.log(col(C.dim,  '      — or —'));
    console.log(col(C.cyan, '      npm start'));
  }

  hr();
  console.log('');
}

main();
