#!/usr/bin/env node
// =============================================================
// Luminary OS — Universal Launcher  (scripts/start.js)
//
// Works on Windows 10/11, macOS, Linux.
// All process spawning goes through scripts/lib/shell.js,
// which fixes the Windows ".cmd cannot be exec'd directly" bug
// in exactly one place. See that file for the full explanation.
// =============================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const http = require('http');
const {
  IS_WIN, which, withLocalBin, runSync, runAsync, killTree, comSpec, diagnose,
} = require('./lib/shell');
const { readFrontendUrl, resolveFrontendOrigin } = require('./lib/launch-config');

// ── Paths & ports ─────────────────────────────────────────────
const ROOT          = path.resolve(__dirname, '..');
const BACKEND_DIR   = path.join(ROOT, 'backend');
const FRONTEND_DIR  = path.join(ROOT, 'frontend');
const BACKEND_PORT  = parseInt(process.env.PORT      || '3001', 10);
const FRONTEND_PORT = Number(process.env.VITE_PORT || '5173');

// ── Terminal capability detection ─────────────────────────────
// Delegates to lib/banner.js's supportsColor(), which uses Node's
// own process.stdout.hasColors() — the correct, maintained way to
// answer this. A plain double-clicked run.bat window (classic
// conhost, no WT_SESSION) DOES support ANSI on Windows 10+; the
// old hand-rolled check wrongly said no and killed all color.
const { supportsColor } = require('./lib/banner');
const HAS_FANCY_TERM = supportsColor();

const SYM = HAS_FANCY_TERM
  ? { ok: '✓', fail: '✗', arrow: '→', warn: '⚠', mark: '✦', hr: '─' }
  : { ok: '[OK]', fail: '[X]', arrow: '->', warn: '[!]', mark: '*', hr: '-' };

// ── Colours ──────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
};
const col = (k, t) => `${k}${t}${C.reset}`;

// ── Process tracking ──────────────────────────────────────────
const services     = []; // { proc, label }
let   shuttingDown = false;

// ── Terminal helpers ──────────────────────────────────────────
const log = {
  ok   : (m) => console.log(col(C.green,  `  ${SYM.ok}  ${m}`)),
  fail : (m) => console.error(col(C.red,  `  ${SYM.fail}  ${m}`)),
  info : (m) => console.log(col(C.cyan,   `  ${SYM.arrow}  ${m}`)),
  warn : (m) => console.log(col(C.yellow, `  ${SYM.warn}  ${m}`)),
  step : (m) => console.log(col(C.bold,   `\n  ${m}`)),
  dim  : (m) => console.log(col(C.dim,    `     ${m}`)),
  hr   : ()  => console.log(col(C.dim,    '  ' + SYM.hr.repeat(52))),
};

// ── Spinner ───────────────────────────────────────────────────
class Spinner {
  constructor(label) {
    this.label  = label;
    this.frames = HAS_FANCY_TERM
      ? ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
      : ['-', '\\', '|', '/'];
    this.i = 0;
    this.timer = null;
    this.elapsed = 0;
  }

  start() {
    process.stdout.write('\n');
    this.timer = setInterval(() => {
      this.elapsed += 120;
      const frame = this.frames[this.i++ % this.frames.length];
      const secs  = (this.elapsed / 1000).toFixed(1);
      process.stdout.write(`\r  ${col(C.cyan, frame)}  ${this.label}  ${col(C.dim, `${secs}s`)}`);
    }, 120);
    return this;
  }

  succeed(msg) { this._stop(); console.log(col(C.green, `  ${SYM.ok}  ${msg || this.label}`)); }
  fail(msg)    { this._stop(); console.error(col(C.red,  `  ${SYM.fail}  ${msg || this.label}`)); }

  _stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    process.stdout.write('\r' + ' '.repeat(76) + '\r');
  }
}

// ── Banner ────────────────────────────────────────────────────
const { banner: luminaryBanner } = require('./lib/banner');
function banner() {
  luminaryBanner('', 'v0.1.0');
}

// ── Requirement checks ─────────────────────────────────────────
function checkNode() {
  const ver   = process.versions.node;
  const major = parseInt(ver.split('.')[0], 10);

  if (major !== 24) {
    log.fail(`Node.js v24 LTS required — this script is running on v${ver}`);
    log.dim('Download the latest LTS: https://nodejs.org');
    process.exit(1);
  }

  const paths = which('node');
  const loc   = paths.length ? `  (${paths[0]})` : '';
  log.ok(`Node.js v${ver}${col(C.dim, loc)}`);
}

function checkNpm() {
  const diag = diagnose('npm');

  if (diag.found && diag.version) {
    log.ok(`npm v${diag.version}${col(C.dim, `  (${diag.paths[0]})`)}`);
    return;
  }

  // ── Rich, actionable diagnostics — never just "npm not found" ──
  log.fail('npm was not found or could not be run.');
  console.log('');
  log.dim(`Search method  : ${IS_WIN ? 'where npm' : 'which npm'}`);
  log.dim(`Found on PATH  : ${diag.found ? diag.paths.join(', ') : 'no'}`);
  if (diag.error) log.dim(`Error detail   : ${diag.error}`);
  console.log('');

  const nodePaths = which('node');
  if (nodePaths.length > 0) {
    const nodeDir   = path.dirname(nodePaths[0]);
    const expectedNpm = path.join(nodeDir, IS_WIN ? 'npm.cmd' : 'npm');
    log.dim('Node.js was found at:');
    log.dim(`  ${nodePaths[0]}`);
    log.dim('npm is normally installed in the SAME folder. Check:');
    log.dim(`  ${expectedNpm}  ${fs.existsSync(expectedNpm) ? '(exists)' : '(MISSING)'}`);
    console.log('');
  }

  log.dim('Most common fixes, in order of likelihood:');
  log.dim('  1. Close ALL terminal / cmd windows, then run this again.');
  log.dim('     Windows only refreshes PATH for NEW windows opened');
  log.dim('     after Node.js finishes installing.');
  log.dim('  2. Reinstall Node.js from https://nodejs.org, then restart');
  log.dim('     your computer (guarantees a clean PATH).');
  if (IS_WIN) {
    log.dim('  3. If you use nvm-windows: run "nvm use <version>" first.');
  }
  console.log('');
  process.exit(1);
}

function checkDir(dir, label) {
  if (!fs.existsSync(dir)) {
    log.fail(`${label}/ directory missing: ${dir}`);
    log.dim('Run this from the luminary-os project root folder.');
    process.exit(1);
  }
  log.ok(`${label}/ found`);
}

// ── Port check ────────────────────────────────────────────────
function isPortFree(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/', timeout: 400 },
      (res) => { res.resume(); resolve(false); } // something answered → taken
    );
    req.on('error',   () => resolve(true));      // refused → free
    req.on('timeout', () => { req.destroy(); resolve(true); });
  });
}

// ── .env bootstrap ────────────────────────────────────────────
function ensureEnv(dir, label) {
  const envFile    = path.join(dir, '.env');
  const envExample = path.join(dir, '.env.example');
  if (!fs.existsSync(envFile)) {
    if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envFile);
      log.ok(`${label} .env created from .env.example`);
    }
  } else {
    log.ok(`${label} .env ready`);
  }
}

// ── Binary existence check ────────────────────────────────────
function localBinPath(dir, name) {
  return path.join(dir, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name);
}

function hasLocalBin(dir, name) {
  return fs.existsSync(localBinPath(dir, name));
}

// ── Dependency installation (with binary-level verification) ──
// Folder existence alone is not proof of a complete install —
// an interrupted `npm install` can leave node_modules present
// but missing the actual CLI binaries we need. We verify the
// binaries themselves and self-heal with one reinstall attempt.
function installDeps(dir, label, requiredBins) {
  const nm  = path.join(dir, 'node_modules');
  const pkg = path.join(dir, 'package.json');

  if (!fs.existsSync(pkg)) {
    log.fail(`${label}/package.json not found`);
    process.exit(1);
  }

  const doInstall = () => {
    log.info(`Installing ${label} dependencies (first run — ~30s)…`);
    console.log('');
    const r = runSync('npm', ['ci', '--prefer-offline', '--no-fund', '--no-audit'], {
      cwd: dir, stdio: 'inherit',
    });
    console.log('');
    return r.status === 0;
  };

  if (!fs.existsSync(nm)) {
    if (!doInstall()) {
      log.fail(`Failed to install ${label} dependencies`);
      log.dim(`Try manually: cd ${path.relative(ROOT, dir)} && npm ci`);
      process.exit(1);
    }
  }

  // Verify the actual binaries exist — catches partial/corrupted installs
  const missing = requiredBins.filter((b) => !hasLocalBin(dir, b));
  if (missing.length > 0) {
    log.warn(`${label}: missing [${missing.join(', ')}] — reinstalling once…`);
    if (!doInstall()) {
      log.fail(`${label}: reinstall failed`);
      process.exit(1);
    }
    const stillMissing = requiredBins.filter((b) => !hasLocalBin(dir, b));
    if (stillMissing.length > 0) {
      log.fail(`${label}: still missing [${stillMissing.join(', ')}] after reinstall`);
      log.dim(`Try manually: cd ${path.relative(ROOT, dir)} && rmdir /s /q node_modules && npm ci`);
      process.exit(1);
    }
  }

  log.ok(`${label} dependencies verified [${requiredBins.join(', ')}]`);
}

// ── Wait for HTTP health endpoint ─────────────────────────────
function waitForHttp(url, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode < 500) { res.resume(); resolve(); }
        else { res.resume(); retry(); }
      });
      req.setTimeout(1000, () => req.destroy());
      req.on('error', retry);
    };

    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url} after ${timeoutMs / 1000}s`));
      } else {
        setTimeout(attempt, 700);
      }
    };

    attempt();
  });
}

// ── Open browser ──────────────────────────────────────────────
function openBrowser(url) {
  try {
    if (IS_WIN) {
      // cmd.exe itself is a real, fixed-path .exe — no .cmd
      // shimming issue here, so shell:false + explicit comSpec
      // is the most direct, reliable path.
      // The empty '' argument is required: `start` treats the
      // first quoted arg as a window title, so we must supply
      // an empty title before the URL or `start` mis-parses it.
      runAsync(comSpec(), ['/c', 'start', '', url], {
        detached: true, stdio: 'ignore', shell: false,
      }).unref();
    } else if (process.platform === 'darwin') {
      runAsync('open', [url], { detached: true, stdio: 'ignore', shell: false }).unref();
    } else {
      runAsync('xdg-open', [url], { detached: true, stdio: 'ignore', shell: false }).unref();
    }
  } catch {
    log.info(`Open your browser: ${url}`);
  }
}

// ── Spawn a service (backend/frontend dev server) ──────────────
// Uses a BARE command name ('vite', 'tsx') with that
// project's node_modules/.bin prepended to PATH — exactly what
// `npm run <script>` does internally. This avoids npx entirely
// and avoids ever constructing an absolute path that could
// contain spaces (e.g. "C:\Users\Jane Doe\luminary-os\...").
function spawnService({ label, color, bin, args, cwd, env = {} }) {
  const prefix = col(color + C.bold, `  [${label}]`) + ' ';

  const proc = runAsync(bin, args, {
    cwd,
    env: withLocalBin(cwd, { ...env, FORCE_COLOR: '1', NODE_ENV: 'development' }),
    detached: !IS_WIN,          // Unix: process-group leader, for clean killTree()
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const isNoise = (line) => /^\s*$/.test(line) || /^> /.test(line) || /^npm warn/i.test(line);
  const isHighlight = (line) => /ready|started|listening|Local:|Network:|compiled|VITE v/i.test(line);

  const pipe = (stream) =>
    stream.on('data', (buf) => {
      buf.toString().split('\n').forEach((line) => {
        if (isNoise(line)) return;
        process.stdout.write(prefix + col(isHighlight(line) ? color : C.dim, line) + '\n');
      });
    });

  if (proc.stdout) pipe(proc.stdout);
  if (proc.stderr) pipe(proc.stderr);

  proc.on('error', (err) => {
    if (!shuttingDown) {
      log.fail(`[${label}] failed to start: ${err.message}`);
      shutdown(`${label}-spawn-error`, 1);
    }
  });

  proc.on('exit', (code, signal) => {
    if (!shuttingDown) {
      // The service died on its own while we expected it to keep
      // running — treat this as a startup/runtime failure, not a
      // silent background event, so run.bat shows the error and
      // keeps the window open.
      log.fail(`[${label}] exited unexpectedly (code ${code}, signal ${signal})`);
      shutdown(`${label}-crashed`, 1);
    }
  });

  services.push({ proc, label });
  return proc;
}

// ── Graceful shutdown ─────────────────────────────────────────
// exitCode defaults to 0 (clean, user-initiated stop via Ctrl+C).
// Failure paths explicitly pass 1 so run.bat can detect the
// non-zero exit code and keep the window open to show the error.
function shutdown(reason = 'exit', exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n');
  log.hr();
  log.warn(`Shutting down (${reason})…`);

  services.forEach(({ proc, label }) => {
    killTree(proc.pid);
    log.dim(`${label} stopped`);
  });

  log.hr();
  log.dim('Luminary OS stopped.\n');
  process.exit(exitCode);
}

// ── Entry point ───────────────────────────────────────────────
async function main() {
  banner();

  // 1. Requirements
  log.step('Checking requirements…');
  checkNode();
  const frontendUrl = resolveFrontendOrigin(
    FRONTEND_PORT, process.env.FRONTEND_URL, readFrontendUrl(path.join(BACKEND_DIR, '.env')),
  );
  checkNpm();
  checkDir(BACKEND_DIR,  'backend');
  checkDir(FRONTEND_DIR, 'frontend');

  // 2. Port availability (warn only — the dev server itself will
  //    give a clear EADDRINUSE error if it truly can't bind)
  log.step('Checking ports…');
  const [bFree, fFree] = await Promise.all([isPortFree(BACKEND_PORT), isPortFree(FRONTEND_PORT)]);
  bFree ? log.ok(`Port ${BACKEND_PORT}  (backend)  is free`)
        : log.warn(`Port ${BACKEND_PORT} is already in use — change PORT in backend/.env if needed`);
  fFree ? log.ok(`Port ${FRONTEND_PORT} (frontend) is free`)
        : log.warn(`Port ${FRONTEND_PORT} is already in use — set VITE_PORT in the launcher environment if needed`);

  // 3. Environment files
  log.step('Checking environment files…');
  ensureEnv(BACKEND_DIR,  'Backend');
  ensureEnv(FRONTEND_DIR, 'Frontend');

  // 4. Dependencies — verified at the binary level, not just folder existence
  log.step('Checking dependencies…');
  installDeps(BACKEND_DIR,  'backend',  ['tsx']);
  installDeps(FRONTEND_DIR, 'frontend', ['vite']);

  // 5. Start backend — mirrors backend/package.json's own "dev" script exactly.
  //    tsx (not ts-node-dev): ts-node-dev hooks child_process and wraps every
  //    spawned node script in a CJS require, which crashes node-llama-cpp's
  //    ESM binding probe (testBindingBinary.js uses top-level await) on the
  //    very first boot after a fresh install. Plain tsx (no watch mode) is
  //    ESM-native, leaves child processes alone, and binds within seconds.
  log.step('Starting backend…');
  spawnService({
    label: 'backend',
    color: C.magenta,
    bin:   'tsx',
    args:  ['src/server.ts'],
    cwd:   BACKEND_DIR,
    env:   { PORT: String(BACKEND_PORT), FRONTEND_URL: frontendUrl },
  });

  const backendSpinner = new Spinner(`Waiting for backend on :${BACKEND_PORT}…`).start();
  try {
    await waitForHttp(`http://127.0.0.1:${BACKEND_PORT}/api/health`, 60_000);
    backendSpinner.succeed(`Backend ready  ${SYM.arrow}  http://localhost:${BACKEND_PORT}`);
  } catch (err) {
    backendSpinner.fail('Backend failed to start within 60 seconds.');
    log.dim('Common causes:');
    log.dim('  • A TypeScript error in backend/src/ (scroll up for the [backend] log)');
    log.dim(`  • Port ${BACKEND_PORT} is already used by another program`);
    log.dim('  • Dependencies are corrupted — try deleting backend/node_modules');
    shutdown('backend-timeout', 1);
    return;
  }

  // 6. Start frontend — same flags Vite uses by default, plus an
  //    explicit port/host so our own health-check and browser-open
  //    logic stay deterministic regardless of vite.config.ts.
  log.step('Starting frontend…');
  spawnService({
    label: 'frontend',
    color: C.cyan,
    bin:   'vite',
    args:  ['--port', String(FRONTEND_PORT), '--strictPort', '--host', '127.0.0.1'],
    cwd:   FRONTEND_DIR,
    env:   { BACKEND_PORT: String(BACKEND_PORT) },
  });

  const viteSpinner = new Spinner('Compiling frontend…').start();
  try {
    await waitForHttp(frontendUrl, 60_000);
    viteSpinner.succeed(`Frontend ready  ${SYM.arrow}  ${frontendUrl}`);
  } catch {
    viteSpinner.fail('Frontend failed to start within 60 seconds.');
    shutdown('frontend-timeout', 1);
    return;
  }

  // 7. Summary
  console.log('');
  log.hr();
  console.log(col(C.magenta + C.bold, `\n  ${SYM.mark}  Luminary OS is running!\n`));
  console.log(col(C.cyan + C.bold, `  App      ${SYM.arrow}  ${frontendUrl}`));
  console.log(col(C.magenta,       `  API      ${SYM.arrow}  http://localhost:${BACKEND_PORT}`));
  console.log(col(C.dim,           `  Health   ${SYM.arrow}  http://localhost:${BACKEND_PORT}/api/health`));
  console.log(col(C.dim,           `  Router   ${SYM.arrow}  POST /api/router/send`));
  console.log('');
  console.log(col(C.dim, '  Press Ctrl+C to stop all services'));
  log.hr();
  console.log('');

  // 8. Open browser
  openBrowser(frontendUrl);

  // 9. Shutdown signals — clean stop, exit code 0
  process.on('SIGINT',  () => shutdown('SIGINT (Ctrl+C)', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  if (!IS_WIN) process.on('SIGHUP', () => shutdown('SIGHUP', 0));

  process.stdin.resume();
}

main().catch((err) => {
  log.fail(`Fatal: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  shutdown('fatal-error', 1);
});
