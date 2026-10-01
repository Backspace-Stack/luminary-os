#!/usr/bin/env node
// Checks the actual Git index; errors never print credential values.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
if (!files.length) throw new Error('Git index is empty; stage the intended public files before checking.');
const forbidden = /^Memory(?:\/|$)|(?:^|\/)(?:node_modules|dist|build|\.claude|data)(?:\/|$)|(?:^|\/)\.env(?:$|\.(?!example$))|\.(?:gguf|safetensors|db(?:-shm|-wal)?|sqlite(?:3)?(?:-shm|-wal)?|pem|key|log)$/i;
const credential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/;
const failures = [];
let bytes = 0;
const blobs = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: files.map(file => `:${file}\n`).join(''), maxBuffer: 32 * 1024 * 1024, windowsHide: true });
let offset = 0;
for (const file of files) {
  if (forbidden.test(file)) failures.push(`${file}: private/generated path`);
  const end = blobs.indexOf(10, offset);
  const header = blobs.subarray(offset, end).toString('utf8').match(/^[a-f0-9]+ blob (\d+)$/);
  if (!header) throw new Error(`Cannot inspect index blob: ${file}`);
  const size = Number(header[1]);
  const content = blobs.subarray(end + 1, end + 1 + size);
  offset = end + 1 + size + 1;
  bytes += content.length;
  if (content.length > 5 * 1024 * 1024) failures.push(`${file}: exceeds 5 MiB review threshold`);
  if (!content.includes(0) && credential.test(content.toString('utf8'))) failures.push(`${file}: possible credential/private key`);
  if (/(?:^|\/)\.env\.example$/.test(file)) {
    for (const line of content.toString('utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && match[2] && !/^(?:["']{2}|your[-_]|replace[-_]|placeholder|changeme)/i.test(match[2])) failures.push(`${file}: configured secret variable ${match[1]}`);
    }
  }
  if (!fs.existsSync(path.join(root, file))) failures.push(`${file}: staged file missing from working tree`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Repository index check passed: ${files.length} files, ${bytes.toLocaleString('en-US')} bytes; no forbidden artifacts or recognized credentials.`);
