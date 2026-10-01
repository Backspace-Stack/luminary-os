'use strict';
// =============================================================
// Luminary OS — Safe cross-platform process spawning
// scripts/lib/shell.js
//
// ROOT CAUSE THIS FILE FIXES
// ──────────────────────────
// On Windows, npm/npx/vite/ts-node-dev are installed as `.cmd`
// shim files (npm.cmd, vite.cmd, ts-node-dev.cmd). Windows'
// CreateProcess API cannot execute a `.cmd` file directly —
// only a real command interpreter (cmd.exe) knows how to run
// it. This is OFFICIAL, DOCUMENTED Node.js behaviour:
//
//   "On Windows, .bat and .cmd files cannot be directly
//    invoked... If a file is invoked using spawn() and is a
//    script that is not an executable... it must be invoked
//    either using a shell or using exec()."
//   — https://nodejs.org/api/child_process.html
//     #spawning-bat-and-cmd-files-on-windows
//
// So `spawnSync('npm.cmd', ['--version'], { shell: false })`
// fails with ENOENT EVEN WHEN npm.cmd EXISTS AND IS ON PATH.
// This is exactly why "npm.cmd -v" works when a person types
// it into a terminal (because the terminal itself IS a shell
// that knows how to run .cmd files) but silently breaks when
// a Node script tries to spawn it directly with shell:false.
//
// THE FIX
// ───────
// Every spawn in this project goes through runSync()/runAsync()
// below, which ALWAYS forces `shell: true` on Windows — no call
// site can ever forget this again, because the flag is applied
// AFTER any options the caller passes in, overriding mistakes.
// On POSIX this flag is left off (unnecessary there, and
// process-group signal handling is cleaner without a shell
// layer in between).
// =============================================================

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const IS_WIN = process.platform === 'win32';

/**
 * Windows env var names are case-insensitive but Node exposes
 * whatever casing the OS process originally had — usually
 * "Path", sometimes "PATH" depending on how the session was
 * created. Find whichever key actually exists.
 */
function pathKey(env) {
  if (!IS_WIN) return 'PATH';
  const found = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return found || 'Path';
}

/**
 * Locate a binary using the OS's own resolver:
 *   Windows → where.exe   (a real .exe, safe to spawn directly)
 *   POSIX   → which
 * Both are genuine executables, never .cmd/.bat, so this
 * function is safe to call with shell:false even before
 * anything else has been fixed. Returns an array of resolved
 * paths, or an empty array if not found. Never throws.
 */
function which(name) {
  const finder = IS_WIN ? 'where' : 'which';
  try {
    const r = spawnSync(finder, [name], { encoding: 'utf8', shell: false });
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build an env object with <cwd>/node_modules/.bin prepended to
 * PATH — the same trick `npm run <script>` uses internally so
 * locally-installed CLI tools resolve by their bare name
 * (vite, ts-node-dev) without needing npx or an absolute path.
 *
 * This sidesteps an entirely separate Windows landmine: if we
 * built an absolute path to the binary ourselves and the
 * project lives under a directory containing a space (e.g.
 * "C:\Users\Jane Doe\luminary-os"), that path would need exact
 * quoting once it's interpolated into a shell command line.
 * Using a bare name + PATH prepend means the only strings that
 * ever touch the shell command line are space-free tokens like
 * "vite" — cwd itself is passed as a separate OS-level
 * parameter (lpCurrentDirectory) and never string-concatenated,
 * so it can safely contain spaces no matter what.
 */
function withLocalBin(cwd, extraEnv = {}) {
  const localBin = path.join(cwd, 'node_modules', '.bin');
  const key = pathKey(process.env);
  const existing = process.env[key] || '';
  return {
    ...process.env,
    ...extraEnv,
    [key]: `${localBin}${path.delimiter}${existing}`,
  };
}

/**
 * Synchronous spawn with the Windows .cmd fix permanently
 * applied. Use for short commands where you need the result
 * immediately (version checks, `npm install`).
 *
 * `shell: IS_WIN` is intentionally placed AFTER the spread of
 * `opts` so a caller can never accidentally re-introduce the
 * original bug by passing `shell: false`.
 */
function runSync(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
    shell: IS_WIN,
  });
}

/**
 * Asynchronous spawn with the same fix applied. Use for
 * long-running processes (dev servers).
 */
function runAsync(cmd, args = [], opts = {}) {
  return spawn(cmd, args, {
    windowsHide: true,
    ...opts,
    shell: IS_WIN,
  });
}

/**
 * Kill an entire process tree, cross-platform.
 *   Windows → taskkill /F /T /PID  (walks the whole tree;
 *             essential because shell:true means the PID we
 *             hold is cmd.exe's PID, with the real tool as a
 *             grandchild — /T reaches both)
 *   POSIX   → signal the negative PID, which hits the whole
 *             process group IF the child was spawned with
 *             detached:true (making it a group leader)
 */
function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      shell: false, // taskkill.exe is a real executable — no shell needed
    });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
  }
}

/** Full path to the Windows command interpreter, robustly resolved. */
function comSpec() {
  return process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
}

/**
 * Rich diagnostic info for a command — used to print exact,
 * actionable errors instead of a bare "not found".
 */
function diagnose(name) {
  const paths = which(name);
  let version = null;
  let error = null;

  if (paths.length > 0) {
    const r = runSync(name, ['--version']);
    if (r.error) {
      error = r.error.message;
    } else if (r.status !== 0) {
      error = (r.stderr || '').trim() || `exited with code ${r.status}`;
    } else {
      version = (r.stdout || '').trim();
    }
  }

  return { found: paths.length > 0, paths, version, error };
}

module.exports = {
  IS_WIN,
  which,
  withLocalBin,
  runSync,
  runAsync,
  killTree,
  comSpec,
  diagnose,
  pathKey,
};
