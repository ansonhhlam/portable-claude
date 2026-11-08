import fs from 'node:fs';
import path from 'node:path';
import type { ExecResult, OsLayer } from '../../src/cli/os.js';

export interface FakeOs extends OsLayer {
  calls: { cmd: string; args: string[] }[];
  files: Map<string, string>;
  /** Responses by "cmd arg0 arg1" prefix. */
  responses: Map<string, ExecResult | ((args: string[]) => ExecResult)>;
  fetchResponses: Map<string, Response | Error>;
}

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });

export function fakeOs(
  platform: NodeJS.Platform,
  home = platform === 'win32' ? 'C:\\Users\\you' : '/home/you',
): FakeOs {
  const calls: FakeOs['calls'] = [];
  const files = new Map<string, string>();
  const responses: FakeOs['responses'] = new Map();
  const fetchResponses: FakeOs['fetchResponses'] = new Map();
  return {
    platform,
    homedir: home,
    username: 'you',
    hostname: 'my-pc',
    uid: 501,
    env: platform === 'win32' ? { USERDOMAIN: 'MY-PC' } : {},
    nodePath: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/local/bin/node',
    cliPath:
      platform === 'win32'
        ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules\\longcord\\dist\\cli\\bin.js'
        : '/usr/local/lib/node_modules/longcord/dist/cli/bin.js',
    calls,
    files,
    responses,
    fetchResponses,
    async exec(cmd, args) {
      calls.push({ cmd, args });
      const key = [cmd, ...args].join(' ');
      const match = [...responses.keys()]
        .filter((k) => key.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      if (match === undefined) return { code: 127, stdout: '', stderr: `${cmd}: not found` };
      const r = responses.get(match)!;
      return typeof r === 'function' ? r(args) : r;
    },
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, d) => void files.set(p, d),
    removeFile: (p) => void files.delete(p),
    exists: (p) => files.has(p) || fs.existsSync(p),
    async fetch(url) {
      const key = [...fetchResponses.keys()].find((k) => url.startsWith(k));
      const r = key ? fetchResponses.get(key)! : new Error('offline');
      if (r instanceof Error) throw r;
      return r.clone();
    },
    freeDiskBytes: () => 50 * 1024 ** 3,
    now: () => new Date('2026-03-01T12:00:00Z'),
  };
}

export function tailscaleOk(os: FakeOs, port = 8417): void {
  os.responses.set('tailscale version', ok('1.80.0'));
  os.responses.set(
    'tailscale status --json',
    ok(
      JSON.stringify({
        BackendState: 'Running',
        Self: { DNSName: 'my-pc.example-tailnet.ts.net.' },
        CertDomains: ['my-pc.example-tailnet.ts.net'],
      }),
    ),
  );
  os.responses.set('tailscale serve --bg', ok());
  os.responses.set(
    'tailscale serve status --json',
    ok(
      JSON.stringify({
        Web: { 'my-pc:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } },
      }),
    ),
  );
  os.responses.set('tailscale serve --https=443 off', ok());
}

export { ok };
export const join = path.join;
