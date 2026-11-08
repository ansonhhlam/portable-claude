// Process entry points: the foreground server and the service supervisor.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { packageVersion } from '../shared/version.js';
import { createApp, type App } from './app.js';
import { configFile, defaultConfig, type Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { dataPaths } from './paths.js';
import { createMockSdk } from './sdk/mock.js';
import { createRealSdk } from './sdk/real.js';

export interface ServerOptions {
  dataDir: string;
  mock?: boolean;
  port?: number;
  /** Also log to stderr. */
  foreground?: boolean;
  /** Print the ready line to stdout. */
  print?: (line: string) => void;
}

function readConfig(dataDir: string): Config {
  const file = dataPaths(dataDir).config;
  return fs.existsSync(file) ? configFile(file).get() : defaultConfig();
}

export async function runServer(
  opts: ServerOptions,
): Promise<{ app: App; log: Logger; stop: (reason?: string) => Promise<void> }> {
  const cfg = readConfig(opts.dataDir);
  const paths = dataPaths(opts.dataDir);
  const log = createLogger({
    level: cfg.logLevel,
    dir: paths.logs,
    maxBytes: cfg.logMaxBytes,
    maxFiles: cfg.logMaxFiles,
    console: !!opts.foreground,
    logContent: cfg.logContent,
  });
  const sdk = opts.mock
    ? createMockSdk({ delayMs: Number(process.env.LONGCORD_MOCK_DELAY_MS ?? 40) })
    : createRealSdk();
  const app = await createApp({
    dataDir: opts.dataDir,
    sdk,
    log,
    credentialsOptional: !!opts.mock,
  });
  const { port, host } = await app.listen(opts.port ?? cfg.port, cfg.host);
  log.info('server started', { version: packageVersion(), port, mock: !!opts.mock });

  let caffeinate: ChildProcess | null = null;
  if (cfg.keepAwake && process.platform === 'darwin') {
    caffeinate = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
    caffeinate.on('error', (err) => log.warn('caffeinate failed', { err }));
  }

  opts.print?.(
    `longcord ${packageVersion()} listening on http://${host}:${port}${opts.mock ? ' (mock agent)' : ''}`,
  );
  if (cfg.publicUrl) opts.print?.(`Open ${cfg.publicUrl} on your phone (through Tailscale).`);
  if (opts.print && app.devices.list().length === 0) {
    // First run: offer a one-time link so this computer's browser can sign in.
    const { token } = app.pairing.create();
    const local = host.includes(':') ? `[${host}]` : host;
    opts.print(
      `No devices are signed in yet. Open this one-time link in a browser on this computer:`,
    );
    opts.print(`  http://${local}:${port}/#/pair/${token}`);
    opts.print('To connect a phone, run `longcord pair` in another terminal.');
  }

  let stopping: Promise<void> | null = null;
  const stop = (reason = 'The server is shutting down') =>
    (stopping ??= (async () => {
      log.info('shutting down', { reason });
      caffeinate?.kill();
      await app.close(reason);
      log.info('stopped');
      (log as Logger & { close?: () => void }).close?.();
    })());
  return { app, log, stop };
}

/** Run the server until a signal or supervisor message asks it to stop. */
export async function runForeground(opts: ServerOptions): Promise<void> {
  const { log, stop } = await runServer(opts);
  const shutdown = (code: number) => {
    void stop().finally(() => process.exit(code));
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('message', (m) => {
    if (m && typeof m === 'object' && (m as { type?: string }).type === 'shutdown') shutdown(0);
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err });
    shutdown(1);
  });
  process.on('unhandledRejection', (err) => {
    log.error('unhandled rejection', { err });
  });
}

// ------------------------------------------------------------------ supervisor

export interface SupervisorOptions {
  dataDir: string;
  /** Command that starts one server process. */
  command: string[];
  healthIntervalMs?: number;
  log?: Logger;
  now?: () => Date;
}

export function msUntil(hhmm: string, now: Date): number {
  const [h, m] = hhmm.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h!, m!, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function restartDelay(failures: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, failures - 1));
}

/**
 * Keeps one server process alive: restarts it when it exits or stops answering
 * /healthz, and optionally restarts it once a day.
 */
export class Supervisor {
  private child: ChildProcess | null = null;
  private failures = 0;
  private startedAt = 0;
  private unhealthy = 0;
  private stopped = false;
  private timers: NodeJS.Timeout[] = [];
  private readonly log: Logger;

  constructor(private readonly opts: SupervisorOptions) {
    this.log =
      opts.log ??
      createLogger({
        dir: dataPaths(opts.dataDir).logs,
        fileName: 'supervisor.log',
        console: false,
      });
  }

  start(): void {
    this.spawn();
    this.timers.push(
      setInterval(() => void this.healthCheck(), this.opts.healthIntervalMs ?? 30_000),
    );
    this.scheduleDailyRestart();
  }

  private spawn(): void {
    if (this.stopped) return;
    const [cmd, ...args] = this.opts.command;
    this.startedAt = Date.now();
    this.unhealthy = 0;
    const child = spawn(cmd!, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    this.child = child;
    let errTail = '';
    child.stderr?.on('data', (d: Buffer) => (errTail = (errTail + d.toString()).slice(-2000)));
    this.log.info('server process started', { pid: child.pid });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      if (Date.now() - this.startedAt > 5 * 60_000) this.failures = 0;
      this.failures++;
      const delay = restartDelay(this.failures);
      this.log.warn('server process exited; restarting', {
        code,
        signal,
        delayMs: delay,
        stderr: errTail.slice(-500),
      });
      this.timers.push(setTimeout(() => this.spawn(), delay));
    });
  }

  private port(): number {
    try {
      return readConfig(this.opts.dataDir).port;
    } catch {
      return defaultConfig().port;
    }
  }

  private async healthCheck(): Promise<void> {
    if (!this.child || Date.now() - this.startedAt < 20_000) return;
    let ok: boolean;
    try {
      const res = await fetch(`http://127.0.0.1:${this.port()}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    this.unhealthy = ok ? 0 : this.unhealthy + 1;
    if (this.unhealthy >= 3) {
      this.log.warn('server is not answering health checks; restarting it');
      this.restartChild();
    }
  }

  private scheduleDailyRestart(): void {
    let at: string | null;
    try {
      at = readConfig(this.opts.dataDir).dailyRestart;
    } catch {
      at = null;
    }
    if (!at) return;
    const delay = msUntil(at, (this.opts.now ?? (() => new Date()))());
    this.timers.push(
      setTimeout(() => {
        this.log.info('scheduled daily restart');
        this.restartChild();
        this.scheduleDailyRestart();
      }, delay),
    );
  }

  /** Ask the child to stop gracefully; force it after 15 seconds. The exit handler restarts it. */
  restartChild(): void {
    const c = this.child;
    if (!c) return;
    this.failures = 0;
    this.stopChild(c);
  }

  private stopChild(c: ChildProcess): void {
    try {
      if (c.connected) c.send({ type: 'shutdown' });
      else c.kill('SIGTERM');
    } catch {
      c.kill();
    }
    const force = setTimeout(() => c.kill('SIGKILL'), 15_000);
    force.unref();
    c.once('exit', () => clearTimeout(force));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    const c = this.child;
    if (!c) return;
    await new Promise<void>((resolve) => {
      c.once('exit', () => resolve());
      this.stopChild(c);
    });
  }
}
