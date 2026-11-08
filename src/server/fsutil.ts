import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

export interface WriteOptions {
  /** File mode for new files, e.g. 0o600 for secrets. Ignored on Windows. */
  mode?: number;
}

/** Write a file atomically: write a temp file in the same directory, fsync, rename. */
export function writeFileAtomicSync(file: string, data: string, opts: WriteOptions = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', opts.mode ?? 0o644);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    renameWithRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (opts.mode !== undefined && process.platform !== 'win32') fs.chmodSync(file, opts.mode);
}

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

/** Windows can briefly refuse renames over files another process has open. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      Atomics.wait(SLEEP_CELL, 0, 0, 15);
    }
  }
}

export function writeJsonAtomicSync(file: string, value: unknown, opts: WriteOptions = {}): void {
  writeFileAtomicSync(file, JSON.stringify(value, null, 2) + '\n', opts);
}

export class DataFileError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${path.basename(file)}: ${message}`);
    this.name = 'DataFileError';
  }
}

/** Read and validate a JSON file. Returns `fallback` if the file does not exist. */
export function readJsonSync<T>(file: string, schema: z.ZodType<T>, fallback: () => T): T {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DataFileError(file, 'is not valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DataFileError(
      file,
      `failed validation: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}

export function mtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * A JSON file cached in memory and reloaded when another process (such as the
 * CLI) changes it on disk.
 */
export class JsonFile<T> {
  private value: T | undefined;
  private loadedMtime = -1;
  private loadedSize = -1;

  constructor(
    readonly file: string,
    private readonly schema: z.ZodType<T>,
    private readonly fallback: () => T,
    private readonly mode?: number,
  ) {}

  get(): T {
    let st: fs.Stats | undefined;
    try {
      st = fs.statSync(this.file);
    } catch {
      st = undefined;
    }
    const m = st?.mtimeMs ?? 0;
    const s = st?.size ?? 0;
    if (this.value === undefined || m !== this.loadedMtime || s !== this.loadedSize) {
      this.value = readJsonSync(this.file, this.schema, this.fallback);
      this.loadedMtime = m;
      this.loadedSize = s;
    }
    return this.value;
  }

  set(value: T): void {
    writeJsonAtomicSync(this.file, value, this.mode === undefined ? {} : { mode: this.mode });
    this.value = value;
    const st = fs.statSync(this.file);
    this.loadedMtime = st.mtimeMs;
    this.loadedSize = st.size;
  }

  update(fn: (v: T) => T | void): T {
    const cur = structuredClone(this.get());
    const next = (fn(cur) ?? cur) as T;
    this.set(next);
    return next;
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
