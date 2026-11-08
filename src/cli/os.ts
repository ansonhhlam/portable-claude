// Everything the CLI does to the operating system goes through this layer so
// that commands can be tested with a fake.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface OsLayer {
  platform: NodeJS.Platform;
  homedir: string;
  username: string;
  hostname: string;
  uid: number;
  env: NodeJS.ProcessEnv;
  /** Absolute path of the Node executable. */
  nodePath: string;
  /** Absolute path of this CLI's entry script. */
  cliPath: string;
  exec(
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number; input?: string },
  ): Promise<ExecResult>;
  readFile(p: string): string | null;
  writeFile(p: string, data: string, mode?: number): void;
  removeFile(p: string): void;
  exists(p: string): boolean;
  fetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
  freeDiskBytes(p: string): number | null;
  now(): Date;
}

/** Resolve a command on PATH, including Windows .cmd/.exe shims. */
function resolveCommand(cmd: string, env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32' || path.isAbsolute(cmd) || /\.(exe|cmd|bat)$/i.test(cmd))
    return cmd;
  const exts = (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';');
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext.toLowerCase());
      if (fs.existsSync(full)) return full;
    }
  }
  return cmd;
}

export function realOs(): OsLayer {
  const env = process.env;
  return {
    platform: process.platform,
    homedir: os.homedir(),
    username: safe(() => os.userInfo().username, 'user'),
    hostname: os.hostname(),
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    env,
    nodePath: process.execPath,
    cliPath: path.resolve(process.argv[1] ?? ''),
    exec(cmd, args, opts = {}) {
      return new Promise((resolve) => {
        const exe = resolveCommand(cmd, env);
        // .cmd/.bat shims must run through the shell on Windows; quote arguments safely.
        const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
        const child = viaShell
          ? spawn(`"${exe}" ${args.map(winQuote).join(' ')}`, { shell: true, windowsHide: true })
          : spawn(exe, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 30_000);
        child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
        child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ code: 127, stdout, stderr: stderr + String(err.message) });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, stdout, stderr });
        });
        if (opts.input !== undefined) child.stdin?.end(opts.input);
        else child.stdin?.end();
      });
    },
    readFile(p) {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile(p, data, mode) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data, mode === undefined ? undefined : { mode });
    },
    removeFile(p) {
      fs.rmSync(p, { force: true });
    },
    exists: (p) => fs.existsSync(p),
    async fetch(url, init = {}) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), init.timeoutMs ?? 10_000);
      try {
        return await fetch(url, { ...init, signal: ac.signal });
      } finally {
        clearTimeout(t);
      }
    },
    freeDiskBytes(p) {
      try {
        const s = fs.statfsSync(p);
        return s.bavail * s.bsize;
      } catch {
        return null;
      }
    },
    now: () => new Date(),
  };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function winQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-.:/\\=@]+$/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** Quote for a POSIX shell / systemd ExecStart line. */
export function shQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-.:/=@]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
