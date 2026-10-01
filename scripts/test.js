'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'backend/tests/*.test.ts', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, LOG_LEVEL: 'error' }, windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
