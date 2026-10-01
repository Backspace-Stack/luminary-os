// ============================================================
// ModelsFolder — The first-class local models directory.
//
// Lives beside run.bat at the project root:
//
//   luminary-os/
//       run.bat
//       models/        ← this folder
//       backend/
//       frontend/
//
// Created automatically at boot; the user never has to browse
// for it. Drop .gguf files (in any subfolder) and they are
// discovered automatically.
// ============================================================

import fs from 'fs';
import path from 'path';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('ModelsFolder');

const README = `Luminary OS — local models folder
==================================

Drop GGUF model files (*.gguf) anywhere in this folder — subfolders
are fine and are scanned recursively:

    models/
        llama/
            llama3.gguf
        coding/
            deepseek.gguf

Models appear on the Models page automatically while Luminary is
running (no restart or refresh needed). Files are never moved,
copied, or modified — Luminary only reads them.

Download GGUF models from https://huggingface.co (look for .gguf
files on model pages, e.g. "TheBloke" or "bartowski" repositories).
`;

/**
 * Absolute path of the auto-managed models directory
 * (…/luminary-os/models). Overridable for tests via
 * LUMINARY_MODELS_DIR.
 */
export function defaultModelsDir(): string {
  if (process.env.LUMINARY_MODELS_DIR) return process.env.LUMINARY_MODELS_DIR;
  // __dirname: backend/dist/models/gguf (built) or backend/src/models/gguf (dev)
  // → up 3 = backend, up 4 = project root
  return path.resolve(__dirname, '../../../../models');
}

/** Create the models folder (and a README) if missing. Idempotent. */
export function ensureModelsDir(): string {
  const dir = defaultModelsDir();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created models folder: ${dir}`);
    }
    const readme = path.join(dir, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, README, 'utf8');
    }
  } catch (err) {
    logger.error(`Cannot create models folder at ${dir}`, { error: String(err) });
  }
  return dir;
}
