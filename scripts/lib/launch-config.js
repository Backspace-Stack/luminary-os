'use strict';

const fs = require('node:fs');
const { parseEnv } = require('node:util');

/** Read the one backend setting needed before managed processes start. */
function readFrontendUrl(envFile) {
  try {
    return parseEnv(fs.readFileSync(envFile, 'utf8')).FRONTEND_URL || undefined;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** One exact served origin for backend authorization and the opened UI. */
function resolveFrontendOrigin(port = 5173, configuredUrl, backendUrl) {
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error('VITE_PORT must be an integer from 1 through 65535.');
  }
  const canonical = new URL(`http://127.0.0.1:${number}`).origin;
  // A copied .env.example is a bootstrap default, not a request to keep
  // authorizing port 5173 after the managed frontend port changes.
  const override = configuredUrl !== undefined
    ? configuredUrl
    : backendUrl === 'http://localhost:5173' ? undefined : backendUrl;
  if (override === undefined) return canonical;

  const message = `FRONTEND_URL must match VITE_PORT ${number}: use ${canonical} or ${new URL(`http://localhost:${number}`).origin}. Remove the override to use the managed default.`;
  let parsed;
  try { parsed = new URL(override); } catch { throw new Error(message); }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      Number(parsed.port || 80) !== number || parsed.origin !== override || parsed.username || parsed.password) {
    throw new Error(message);
  }
  return parsed.origin;
}

module.exports = { readFrontendUrl, resolveFrontendOrigin };
