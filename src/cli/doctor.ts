import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { redactIdentity } from '../shared/redact.js';
import { packageVersion } from '../shared/version.js';
import { ConfigSchema, SecretsSchema, unknownConfigKeys, type Config } from '../server/config.js';
import { SCHEMA_VERSION, currentVersion } from '../server/migrations.js';
import type { DataPaths } from '../server/paths.js';
import type { CliContext } from './context.js';
import type { OsLayer } from './os.js';
import { checkSleep, serviceManager } from './services.js';
import {
  TAILSCALE_DOWNLOAD,
  TAILSCALE_HTTPS_DOCS,
  serveConfigured,
  tailscaleStatus,
} from './tailscale.js';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export const MIN_NODE = [20, 19] as const;

export function nodeVersionOk(version: string): boolean {
  const [maj = 0, min = 0] = version.replace(/^v/, '').split('.').map(Number);
  return maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1]);
}

/** Read-only integrity check of the data directory (never repairs anything). */
export function checkDataIntegrity(paths: DataPaths): { problems: string[]; sessions: number } {
  const problems: string[] = [];
  let sessions = 0;
  if (!fs.existsSync(paths.root)) return { problems, sessions };
  const json = (file: string, validate?: (v: unknown) => boolean) => {
    if (!fs.existsSync(file)) return;
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (validate && !validate(v)) problems.push(`${path.basename(file)} has invalid contents`);
    } catch {
      problems.push(`${path.basename(file)} is not valid JSON`);
    }
  };
  json(paths.config, (v) => ConfigSchema.safeParse(v).success);
  json(paths.secrets, (v) => SecretsSchema.safeParse(v).success);
  for (const f of [paths.devices, paths.push, paths.spend, paths.schema]) json(f);
  if (fs.existsSync(paths.sessions)) {
    for (const id of fs.readdirSync(paths.sessions)) {
      const dir = path.join(paths.sessions, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      sessions++;
      json(path.join(dir, 'meta.json'));
      const log = path.join(dir, 'events.jsonl');
      if (!fs.existsSync(log)) continue;
      const text = fs.readFileSync(log, 'utf8');
      const lines = text.split('\n');
      const last = lines.pop();
      if (last)
        problems.push(
          `session ${id.slice(0, 8)}: event log ends with an incomplete line (repaired on next start)`,
        );
      let bad = 0;
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          JSON.parse(l);
        } catch {
          bad++;
        }
      }
      if (bad)
        problems.push(
          `session ${id.slice(0, 8)}: ${bad} unreadable event line(s) (skipped on load)`,
        );
    }
  }
  return { problems, sessions };
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

export interface DoctorOptions {
  offline: boolean;
}

export async function runDoctor(ctx: CliContext, opts: DoctorOptions): Promise<CheckResult[]> {
  const { os, paths } = ctx;
  const results: CheckResult[] = [];
  const add = (r: CheckResult) => results.push(r);

  // Node
  const nodeVer = process.version;
  add(
    nodeVersionOk(nodeVer)
      ? { id: 'node', name: 'Node.js version', status: 'pass', detail: nodeVer }
      : {
          id: 'node',
          name: 'Node.js version',
          status: 'fail',
          detail: `${nodeVer} is too old`,
          fix: `Install Node.js ${MIN_NODE.join('.')} or newer (an LTS release) from https://nodejs.org`,
        },
  );

  // Config and data
  let cfg: Config | null = null;
  try {
    cfg = ctx.config.get();
    const raw = fs.existsSync(paths.config)
      ? (JSON.parse(fs.readFileSync(paths.config, 'utf8')) as unknown)
      : {};
    const unknown = unknownConfigKeys(raw);
    add(
      unknown.length
        ? {
            id: 'config',
            name: 'Configuration',
            status: 'warn',
            detail: `Unknown keys: ${unknown.join(', ')}`,
            fix: 'Remove them with `longcord config` or edit config.json',
          }
        : {
            id: 'config',
            name: 'Configuration',
            status: 'pass',
            detail: fs.existsSync(paths.config) ? 'valid' : 'defaults (no config file yet)',
          },
    );
  } catch (err) {
    add({
      id: 'config',
      name: 'Configuration',
      status: 'fail',
      detail: (err as Error).message,
      fix: 'Fix or delete config.json, then run `longcord setup`',
    });
  }

  const integrity = checkDataIntegrity(paths);
  let version = 0;
  try {
    version = currentVersion(paths);
  } catch {
    integrity.problems.push('schema.json is unreadable');
  }
  add(
    integrity.problems.length
      ? {
          id: 'data',
          name: 'Data integrity',
          status: 'warn',
          detail: integrity.problems.slice(0, 5).join('; '),
          fix: 'Restart longcord to repair logs; see docs/troubleshooting.md',
        }
      : version > SCHEMA_VERSION
        ? {
            id: 'data',
            name: 'Data integrity',
            status: 'fail',
            detail: `data uses schema v${version}, newer than this version`,
            fix: 'Update longcord',
          }
        : {
            id: 'data',
            name: 'Data integrity',
            status: 'pass',
            detail: `${integrity.sessions} session(s), schema v${version || SCHEMA_VERSION}`,
          },
  );

  if (cfg) {
    const missing = cfg.projects.filter((p) => !fs.existsSync(p.path));
    add(
      cfg.projects.length === 0
        ? {
            id: 'projects',
            name: 'Projects',
            status: 'warn',
            detail: 'No project folders are allowed yet',
            fix: 'Run `longcord projects add <folder>`',
          }
        : missing.length
          ? {
              id: 'projects',
              name: 'Projects',
              status: 'warn',
              detail: `${missing.length} project folder(s) missing: ${missing.map((p) => p.name).join(', ')}`,
              fix: 'Remove them with `longcord projects remove <id>`',
            }
          : {
              id: 'projects',
              name: 'Projects',
              status: 'pass',
              detail: `${cfg.projects.length} project(s)`,
            },
    );
  }

  // Credentials
  const provider = cfg?.provider ?? 'anthropic';
  let secretsOk = true;
  let apiKey: string | null = null;
  try {
    apiKey = os.env.ANTHROPIC_API_KEY || ctx.secrets.get().apiKey;
  } catch {
    secretsOk = false;
  }
  if (!secretsOk) {
    add({
      id: 'credentials',
      name: 'API credentials',
      status: 'fail',
      detail: 'secrets.json is unreadable',
      fix: 'Run `longcord setup` to store the API key again',
    });
  } else if (provider !== 'anthropic') {
    add({
      id: 'credentials',
      name: 'API credentials',
      status: 'pass',
      detail: `Using ${provider} (credentials come from its own configuration)`,
    });
  } else if (!apiKey) {
    add({
      id: 'credentials',
      name: 'API credentials',
      status: 'fail',
      detail: 'No Anthropic API key configured',
      fix: 'Run `longcord setup` or set ANTHROPIC_API_KEY',
    });
  } else if (opts.offline) {
    add({
      id: 'credentials',
      name: 'API credentials',
      status: 'skip',
      detail: 'API key present; validity not checked (--offline)',
    });
  } else {
    const r = await checkApiKey(os, apiKey);
    add(r.check);
    if (r.serverDate) {
      const skew = Math.abs(os.now().getTime() - r.serverDate.getTime()) / 1000;
      add(
        skew > 120
          ? {
              id: 'clock',
              name: 'Clock',
              status: 'warn',
              detail: `Clock is off by about ${Math.round(skew)} seconds`,
              fix: 'Turn on automatic time sync in your OS settings',
            }
          : { id: 'clock', name: 'Clock', status: 'pass', detail: 'in sync' },
      );
    }
  }
  if (opts.offline || provider !== 'anthropic' || !apiKey) {
    add({ id: 'clock', name: 'Clock', status: 'skip', detail: 'needs the online API check' });
  }

  // Tailscale
  const ts = await tailscaleStatus(os);
  if (!ts.installed) {
    add({
      id: 'tailscale',
      name: 'Tailscale',
      status: 'fail',
      detail: 'not installed',
      fix: `Install it from ${TAILSCALE_DOWNLOAD}`,
    });
  } else if (!ts.running) {
    add({
      id: 'tailscale',
      name: 'Tailscale',
      status: 'fail',
      detail: 'installed but not connected',
      fix: 'Open Tailscale and log in (or run `tailscale up`)',
    });
  } else if (!ts.httpsEnabled) {
    add({
      id: 'tailscale',
      name: 'Tailscale',
      status: 'fail',
      detail: 'HTTPS certificates are not enabled for this tailnet',
      fix: `Enable HTTPS: ${TAILSCALE_HTTPS_DOCS}`,
    });
  } else {
    add({
      id: 'tailscale',
      name: 'Tailscale',
      status: 'pass',
      detail: `connected as ${ts.dnsName ?? 'this machine'}`,
    });
  }
  const port = cfg?.port ?? 8417;
  if (ts.installed) {
    const serve = await serveConfigured(os, port);
    add(
      serve
        ? {
            id: 'serve',
            name: 'Tailscale serve',
            status: 'pass',
            detail: `forwards HTTPS to 127.0.0.1:${port}`,
          }
        : {
            id: 'serve',
            name: 'Tailscale serve',
            status: 'fail',
            detail: 'not forwarding to longcord',
            fix: `Run: tailscale serve --bg --https=443 http://127.0.0.1:${port}`,
          },
    );
  }

  // Service and server health
  const svc = serviceManager(os, paths.root);
  const state = await svc.state();
  add(
    state === 'running'
      ? {
          id: 'service',
          name: 'Background service',
          status: 'pass',
          detail: `running (${svc.location()})`,
        }
      : state === 'not-installed'
        ? {
            id: 'service',
            name: 'Background service',
            status: 'warn',
            detail: 'not installed',
            fix: 'Run `longcord setup` to install it',
          }
        : {
            id: 'service',
            name: 'Background service',
            status: 'warn',
            detail: `installed but ${state}`,
            fix: 'Check `longcord logs`; reinstall with `longcord setup`',
          },
  );
  let healthy: boolean;
  try {
    const res = await os.fetch(`http://127.0.0.1:${port}/healthz`, { timeoutMs: 3000 });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  if (healthy) {
    add({
      id: 'health',
      name: 'Server health',
      status: 'pass',
      detail: `answering on 127.0.0.1:${port}`,
    });
  } else {
    const free = await portFree(port);
    add(
      free
        ? {
            id: 'health',
            name: 'Server health',
            status: 'warn',
            detail: 'server is not running',
            fix: 'Start it with `longcord start` or the background service',
          }
        : {
            id: 'health',
            name: 'Server health',
            status: 'fail',
            detail: `port ${port} is used by another program`,
            fix: 'Choose another port: `longcord config set port <n>` and run `longcord setup` again',
          },
    );
  }

  // Disk
  const free = os.freeDiskBytes(fs.existsSync(paths.root) ? paths.root : os.homedir);
  if (free === null)
    add({ id: 'disk', name: 'Disk space', status: 'skip', detail: 'could not read free space' });
  else {
    const gb = free / 1024 ** 3;
    add(
      gb < 0.2
        ? {
            id: 'disk',
            name: 'Disk space',
            status: 'fail',
            detail: `${gb.toFixed(2)} GB free`,
            fix: 'Free up disk space',
          }
        : gb < 1
          ? {
              id: 'disk',
              name: 'Disk space',
              status: 'warn',
              detail: `${gb.toFixed(2)} GB free`,
              fix: 'Free up disk space',
            }
          : { id: 'disk', name: 'Disk space', status: 'pass', detail: `${gb.toFixed(1)} GB free` },
    );
  }

  // Sleep
  const sleep = await checkSleep(os);
  add({
    id: 'sleep',
    name: 'Sleep settings',
    status: sleep.status === 'unknown' ? 'warn' : sleep.status,
    detail:
      cfg?.keepAwake && os.platform === 'darwin'
        ? `${sleep.detail} (keepAwake is on)`
        : sleep.detail,
    ...(sleep.status === 'pass'
      ? {}
      : { fix: sleep.fixable ? 'Run `longcord setup --fix-sleep`' : 'See docs/guides/travel.md' }),
  });

  return results;
}

async function checkApiKey(
  os: OsLayer,
  key: string,
): Promise<{ check: CheckResult; serverDate: Date | null }> {
  try {
    const res = await os.fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      timeoutMs: 10_000,
    });
    const date = res.headers.get('date');
    const serverDate = date ? new Date(date) : null;
    if (res.ok)
      return {
        check: {
          id: 'credentials',
          name: 'API credentials',
          status: 'pass',
          detail: 'API key accepted',
        },
        serverDate,
      };
    if (res.status === 401 || res.status === 403) {
      return {
        check: {
          id: 'credentials',
          name: 'API credentials',
          status: 'fail',
          detail: 'API key was rejected',
          fix: 'Create a new key in the Anthropic Console and run `longcord setup`',
        },
        serverDate,
      };
    }
    return {
      check: {
        id: 'credentials',
        name: 'API credentials',
        status: 'warn',
        detail: `API answered with status ${res.status}`,
      },
      serverDate,
    };
  } catch {
    return {
      check: {
        id: 'credentials',
        name: 'API credentials',
        status: 'warn',
        detail: 'Could not reach the Anthropic API',
        fix: 'Check the internet connection, or use --offline',
      },
      serverDate: null,
    };
  }
}

const ICON: Record<CheckStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  skip: 'SKIP',
};

/** Human-readable report. Safe to paste publicly: identifiers are redacted. */
export function formatDoctor(results: CheckResult[], os: OsLayer): string {
  const lines = [
    `longcord ${packageVersion()} doctor (${os.platform}, node ${process.version})`,
    '',
  ];
  for (const r of results) {
    lines.push(`[${ICON[r.status]}] ${r.name}: ${r.detail}`);
    if (r.fix && r.status !== 'pass') lines.push(`       fix: ${r.fix}`);
  }
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  lines.push(
    '',
    `${fails} failed, ${warns} warning(s). Review this output before posting it publicly.`,
  );
  return redactIdentity(lines.join('\n'), {
    username: os.username,
    hostname: os.hostname,
    home: os.homedir,
  });
}
