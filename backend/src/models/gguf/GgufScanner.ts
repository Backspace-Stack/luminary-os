// ============================================================
// GgufScanner — Recursive discovery of .gguf model files.
//
// Read-only: walks the configured folder, records file paths and
// metadata, and parses each file's GGUF header for real model
// info (architecture, quantization, context length). Files are
// never copied, moved, or modified. Parsed metadata is cached by
// path + mtime so rescans stay cheap.
// ============================================================

import fs from 'fs';
import path from 'path';
import { Logger } from '../../core/logger/Logger';

const logger = Logger.scope('GgufScanner');

export interface GgufMetadata {
  architecture?: string;
  modelName?: string;
  /** e.g. "3.8B" from general.size_label */
  parameterSize?: string;
  /** e.g. "Q4_K_M" from general.file_type */
  quantization?: string;
  contextLength?: number;
}

export interface GgufFileInfo {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  meta: GgufMetadata;
}

const MAX_DEPTH = 16;
/** Header window per file — general.* keys sit at the front. */
const HEADER_READ_BYTES = 8 * 1024 * 1024;
const GGUF_MAGIC = 0x46554747; // 'GGUF' little-endian

// llama.cpp general.file_type → quantization label
const FILE_TYPE_NAMES: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1',
  10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S',
  15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS',
  20: 'IQ2_XS', 21: 'Q2_K_S', 22: 'IQ3_XS', 23: 'IQ3_XXS', 24: 'IQ1_S',
  25: 'IQ4_NL', 26: 'IQ3_S', 27: 'IQ3_M', 28: 'IQ2_S', 29: 'IQ2_M',
  30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16',
};

/** Sequential little-endian reader that throws on underrun. */
class Reader {
  offset = 0;
  constructor(private buf: Buffer) {}

  private need(n: number): void {
    if (this.offset + n > this.buf.length) throw new RangeError('buffer underrun');
  }
  u8():  number { this.need(1); return this.buf.readUInt8(this.offset++); }
  u16(): number { this.need(2); const v = this.buf.readUInt16LE(this.offset); this.offset += 2; return v; }
  u32(): number { this.need(4); const v = this.buf.readUInt32LE(this.offset); this.offset += 4; return v; }
  i32(): number { this.need(4); const v = this.buf.readInt32LE(this.offset); this.offset += 4; return v; }
  u64(): number { this.need(8); const v = this.buf.readBigUInt64LE(this.offset); this.offset += 8; return Number(v); }
  i64(): number { this.need(8); const v = this.buf.readBigInt64LE(this.offset); this.offset += 8; return Number(v); }
  f32(): number { this.need(4); const v = this.buf.readFloatLE(this.offset); this.offset += 4; return v; }
  f64(): number { this.need(8); const v = this.buf.readDoubleLE(this.offset); this.offset += 8; return v; }
  string(): string {
    const len = this.u64();
    this.need(len);
    const s = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return s;
  }
  skip(n: number): void { this.need(n); this.offset += n; }
}

/** Read one GGUF metadata value of the given type; return scalars, skip blobs. */
function readValue(r: Reader, type: number): unknown {
  switch (type) {
    case 0: return r.u8();
    case 1: return r.u8();          // i8 — sign irrelevant for our keys
    case 2: return r.u16();
    case 3: return r.u16();
    case 4: return r.u32();
    case 5: return r.i32();
    case 6: return r.f32();
    case 7: return r.u8() !== 0;    // bool
    case 8: return r.string();
    case 9: {                       // array: elem type + count + elems
      const elemType = r.u32();
      const count = r.u64();
      for (let i = 0; i < count; i++) readValue(r, elemType);
      return undefined;             // array contents not needed
    }
    case 10: return r.u64();
    case 11: return r.i64();
    case 12: return r.f64();
    default:
      throw new RangeError(`unknown GGUF value type ${type}`);
  }
}

/**
 * Parse the GGUF header of a file for model metadata.
 * Best-effort: returns whatever was readable before the header
 * window ran out (huge tokenizer arrays live past our window).
 */
export function parseGgufHeader(filePath: string): GgufMetadata {
  const meta: GgufMetadata = {};
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(HEADER_READ_BYTES, size));
    fs.readSync(fd, buf, 0, buf.length, 0);

    const r = new Reader(buf);
    if (r.u32() !== GGUF_MAGIC) return meta;      // not a GGUF file
    const version = r.u32();
    if (version < 2 || version > 3) return meta;  // v1 (u32 lengths) unsupported
    r.u64();                                      // tensor_count
    const kvCount = r.u64();

    const wanted = new Set(['general.architecture', 'general.name', 'general.size_label', 'general.file_type']);
    let contextKey: string | null = null;

    for (let i = 0; i < kvCount; i++) {
      const key = r.string();
      const type = r.u32();
      const value = readValue(r, type);

      if (key === 'general.architecture' && typeof value === 'string') {
        meta.architecture = value;
        contextKey = `${value}.context_length`;
      } else if (key === 'general.name' && typeof value === 'string') {
        meta.modelName = value;
      } else if (key === 'general.size_label' && typeof value === 'string') {
        meta.parameterSize = value;
      } else if (key === 'general.file_type' && typeof value === 'number') {
        meta.quantization = FILE_TYPE_NAMES[value] ?? `FT_${value}`;
      } else if (contextKey && key === contextKey && typeof value === 'number') {
        meta.contextLength = value;
      }
      wanted.delete(key);

      // All interesting keys found — no need to walk tokenizer blobs
      if (wanted.size === 0 && meta.contextLength !== undefined) break;
    }
  } catch (err) {
    if (!(err instanceof RangeError)) {
      logger.warn(`GGUF header parse failed for ${filePath}`, { error: String(err) });
    }
    // RangeError = header window exhausted — keep what we parsed
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return meta;
}

export class GgufScanner {
  private cache = new Map<string, { mtimeMs: number; sizeBytes: number; info: GgufFileInfo }>();

  /** Recursively scan a folder for .gguf files (read-only). */
  scan(root: string): GgufFileInfo[] {
    const results: GgufFileInfo[] = [];
    const seen = new Set<string>();
    this.walk(root, 0, results);

    // Drop cache entries for files that disappeared
    results.forEach((f) => seen.add(f.filePath));
    for (const key of this.cache.keys()) {
      if (!seen.has(key)) this.cache.delete(key);
    }
    return results.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  private walk(dir: string, depth: number, out: GgufFileInfo[]): void {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`Cannot read directory: ${dir}`, { error: String(err) });
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walk(full, depth + 1, out);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        try {
          out.push(this.fileInfo(full));
        } catch (err) {
          logger.warn(`Cannot stat GGUF file: ${full}`, { error: String(err) });
        }
      }
    }
  }

  private fileInfo(filePath: string): GgufFileInfo {
    const stat = fs.statSync(filePath);
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.size) {
      return cached.info;
    }

    const info: GgufFileInfo = {
      filePath,
      fileName: path.basename(filePath),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      meta: parseGgufHeader(filePath),
    };
    this.cache.set(filePath, { mtimeMs: stat.mtimeMs, sizeBytes: stat.size, info });
    return info;
  }
}
