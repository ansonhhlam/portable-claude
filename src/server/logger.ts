import fs from 'node:fs';
import path from 'node:path';
import { redactValue } from '../shared/redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  /** Directory for rotated log files. Omit to log to stderr only. */
  dir?: string;
  maxBytes?: number;
  maxFiles?: number;
  /** Also write to stderr (foreground mode). */
  console?: boolean;
  /** Log file name inside dir (default longcord.log). */
  fileName?: string;
  /** Allow prompt and file contents in debug logs (off by default). */
  logContent?: boolean;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Log user content (prompts, file text) only when content logging is enabled. */
  content(msg: string, fields: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export const LOG_FILE = 'longcord.log';

class FileSink {
  private size = 0;
  private fd: number | null = null;
  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
    private readonly name: string,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.open();
  }
  private get file(): string {
    return path.join(this.dir, this.name);
  }
  private open(): void {
    this.fd = fs.openSync(this.file, 'a', 0o600);
    this.size = fs.fstatSync(this.fd).size;
  }
  write(line: string): void {
    if (this.fd === null) return;
    const buf = Buffer.from(line);
    if (this.size + buf.length > this.maxBytes) this.rotate();
    fs.writeSync(this.fd!, buf);
    this.size += buf.length;
  }
  private rotate(): void {
    if (this.fd !== null) fs.closeSync(this.fd);
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
      const to = `${this.file}.${i}`;
      try {
        if (fs.existsSync(from)) fs.renameSync(from, to);
      } catch {
        /* best effort */
      }
    }
    this.open();
  }
  close(): void {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
  }
}

export function createLogger(opts: LoggerOptions = {}): Logger & { close(): void } {
  const min = ORDER[opts.level ?? 'info'];
  const sink = opts.dir
    ? new FileSink(
        opts.dir,
        opts.maxBytes ?? 5 * 1024 * 1024,
        opts.maxFiles ?? 5,
        opts.fileName ?? LOG_FILE,
      )
    : null;
  const toConsole = opts.console ?? !sink;

  const make = (base: Record<string, unknown>): Logger => {
    const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
      if (ORDER[level] < min) return;
      const rec = {
        time: new Date().toISOString(),
        level,
        msg,
        ...(redactValue({ ...base, ...fields }) as Record<string, unknown>),
      };
      const line = JSON.stringify(rec) + '\n';
      sink?.write(line);
      if (toConsole) process.stderr.write(line);
    };
    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      content: (m, f) => {
        if (opts.logContent) emit('debug', m, f);
      },
      child: (f) => make({ ...base, ...f }),
    };
  };
  return Object.assign(make({}), { close: () => sink?.close() });
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  content() {},
  child() {
    return silentLogger;
  },
};
