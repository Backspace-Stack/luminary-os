#!/usr/bin/env node
// =============================================================
// Luminary OS — Memories viewer (READ-ONLY)
//
// Prints the curated MEMORIES.md in full, plus basic stats for the
// semantic memory database. It opens SQLite in readonly mode and never
// writes anything, anywhere — this is a visibility tool, not an editor.
// To ADD a curated fact, use /remember in the app.
//
// Uses only what the backend already depends on (better-sqlite3) — no
// new dependencies. Degrades honestly: a missing file or an
// unavailable driver is reported, never faked.
// =============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'backend', 'data');
// The user-facing Memory folder at the project root — the live files the
// app loads and /remember writes to (mirrors identityDir() in the backend).
const IDENTITY_DIR = path.join(ROOT, 'Memory');
const MEMORIES_MD = process.env.LUMEN_MEMORIES_PATH
  ? path.resolve(process.env.LUMEN_MEMORIES_PATH)
  : path.join(IDENTITY_DIR, 'MEMORIES.md');
const IDENTITY_MD = process.env.LUMEN_IDENTITY_PATH
  ? path.resolve(process.env.LUMEN_IDENTITY_PATH)
  : path.join(IDENTITY_DIR, 'LUMEN.md');
const DB_FILE = path.join(DATA_DIR, 'luminary.db');

// Minimal ANSI colour, disabled when not a TTY or NO_COLOR is set.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const violet = (s) => c('35', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);

const rule = () => console.log(dim('─'.repeat(64)));
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return null; } };

console.log();
console.log(violet(bold('  LUMEN — MEMORIES')));
console.log();

// ── 1. Curated memories (MEMORIES.md, always loaded into every prompt) ──
rule();
console.log(bold('  Curated memories') + dim('  (loaded in full every session)'));
console.log(dim(`  ${MEMORIES_MD}`));
rule();

if (!fs.existsSync(MEMORIES_MD)) {
  console.log(yellow('  No MEMORIES.md yet.'));
  console.log(dim('  It is created on first boot, or the first time you use /remember.'));
} else {
  const text = fs.readFileSync(MEMORIES_MD, 'utf8');
  const lines = text.split(/\r?\n/);
  const facts = lines.filter((l) => l.trim().startsWith('-'));
  console.log();
  for (const line of lines) {
    if (!line.trim()) { console.log(); continue; }
    console.log(line.trim().startsWith('-') ? `  ${green(line.trim())}` : dim(`  ${line}`));
  }
  console.log();
  const bytes = Buffer.byteLength(text, 'utf8');
  const SOFT_CAP = 4096; // mirrors MEMORIES_SOFT_CAP_BYTES in BaseAgent
  console.log(dim(`  ${facts.length} fact(s) · ${fmtBytes(bytes)}`));
  if (bytes > SOFT_CAP) {
    console.log(yellow(`  Over the ~${fmtBytes(SOFT_CAP)} soft cap — consider pruning (it is sent with every prompt).`));
  }
}

// ── 2. Identity file (LUMEN.md) — presence/size only, not dumped ──
console.log();
rule();
console.log(bold('  Identity') + dim('  (LUMEN.md)'));
rule();
const idSize = sizeOf(IDENTITY_MD);
console.log(idSize === null
  ? yellow('  Not created yet.')
  : `  ${dim(IDENTITY_MD)}\n  ${fmtBytes(idSize)}`);

// ── 3. Semantic memory database (SQLite) — read-only stats ──
console.log();
rule();
console.log(bold('  Semantic memory database') + dim('  (searched on demand)'));
rule();

const dbSize = sizeOf(DB_FILE);
if (dbSize === null) {
  console.log(yellow('  No database yet — it is created on first boot.'));
  console.log(dim(`  Expected at: ${DB_FILE}`));
} else {
  // WAL/SHM sidecars hold recent writes; report them so the number on
  // disk matches what the user actually sees in the folder.
  const wal = sizeOf(`${DB_FILE}-wal`) ?? 0;
  const shm = sizeOf(`${DB_FILE}-shm`) ?? 0;
  console.log(`  ${dim(DB_FILE)}`);
  console.log(`  Size: ${fmtBytes(dbSize)}` + (wal || shm ? dim(`  (+ WAL ${fmtBytes(wal)}, SHM ${fmtBytes(shm)})`) : ''));

  let Database;
  try {
    Database = require(path.join(ROOT, 'backend', 'node_modules', 'better-sqlite3'));
  } catch {
    try { Database = require('better-sqlite3'); } catch { Database = null; }
  }

  if (!Database) {
    console.log(yellow('  Row counts unavailable: better-sqlite3 is not installed.'));
    console.log(dim('  Run setup first (Lumen Setup), then try again.'));
  } else {
    let db;
    try {
      db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
      const count = (sql) => { try { return db.prepare(sql).get().n; } catch { return null; } };
      const total = count('SELECT COUNT(*) AS n FROM memories');
      const nowIso = new Date().toISOString();
      const live = (() => {
        try {
          return db.prepare('SELECT COUNT(*) AS n FROM memories WHERE expiresAt IS NULL OR expiresAt > ?').get(nowIso).n;
        } catch { return null; }
      })();
      const embedded = count('SELECT COUNT(*) AS n FROM memories WHERE embedding IS NOT NULL');
      const pending = count('SELECT COUNT(*) AS n FROM pending_turns');

      if (total === null) {
        console.log(yellow('  No "memories" table yet — nothing has been stored.'));
      } else {
        console.log(`  Memories stored: ${bold(String(total))}` +
          (live !== null && live !== total ? dim(`  (${live} live, ${total - live} expired)`) : ''));
        if (embedded !== null) {
          console.log(dim(`  With embeddings: ${embedded}/${total}` +
            (embedded < total ? '  — the rest fall back to keyword matching' : '')));
        }
        // Most recent few, for a quick sanity check that recall has content.
        try {
          const recent = db.prepare('SELECT content, createdAt FROM memories ORDER BY createdAt DESC LIMIT 3').all();
          if (recent.length) {
            console.log();
            console.log(dim('  Most recent:'));
            for (const r of recent) {
              const when = String(r.createdAt).slice(0, 10);
              const snippet = String(r.content).replace(/\s+/g, ' ').slice(0, 68);
              console.log(dim(`    ${when}  `) + snippet + (String(r.content).length > 68 ? dim('…') : ''));
            }
          }
        } catch { /* optional detail — never fail the whole report over it */ }
      }
      if (pending !== null && pending > 0) {
        console.log();
        console.log(dim(`  Pending tool confirmations awaiting approval: ${pending}`));
      }
    } catch (err) {
      console.log(yellow(`  Could not read the database: ${err.message}`));
      if (/being used|locked/i.test(err.message)) {
        console.log(dim('  It may be locked by a running Luminary OS — this view is safe to retry.'));
      }
    } finally {
      try { db && db.close(); } catch { /* nothing to do */ }
    }
  }
}

console.log();
rule();
console.log(dim('  Read-only view. To add a curated fact, use  /remember <fact>  in the app.'));
rule();
console.log();
