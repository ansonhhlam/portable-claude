import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionEvent } from '../../src/shared/api.js';
import { createApp, type App } from '../../src/server/app.js';
import { LoginLimiter } from '../../src/server/auth.js';
import type { PushSender } from '../../src/server/push.js';
import { createMockSdk, type MockSdk } from '../../src/server/sdk/mock.js';

export function tmpDir(prefix = 'lc-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const FAKE_KEY = 'sk-ant-test-00000000000000000000';

export interface TestApp {
  app: App;
  sdk: MockSdk;
  base: string;
  dir: string;
  project: string;
  sent: { endpoint: string; payload: unknown }[];
  pushStatus: { value: number };
  client: Client;
  close(): Promise<void>;
}

export class Client {
  cookie = '';
  constructor(
    readonly base: string,
    readonly origin: string = base,
  ) {}

  async req(
    method: string,
    p: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (method !== 'GET') h.origin ??= this.origin;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(this.base + p, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    return res;
  }

  async json<T = unknown>(
    method: string,
    p: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await this.req(method, p, body);
    return { status: res.status, body: (await res.json()) as T };
  }
}

export async function startTestApp(
  opts: {
    config?: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
    limiter?: LoginLimiter;
    dir?: string;
    delayMs?: number;
  } = {},
): Promise<TestApp> {
  const dir = opts.dir ?? tmpDir();
  const project = path.join(dir, 'projects', 'demo-app');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  if (!fs.existsSync(path.join(dir, 'config.json'))) {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({
        projects: [{ id: 'demo', name: 'demo-app', path: project }],
        ...opts.config,
      }),
    );
  }
  const sdk = createMockSdk({ delayMs: opts.delayMs ?? 0 });
  const sent: TestApp['sent'] = [];
  const pushStatus = { value: 201 };
  const sender: PushSender = async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return pushStatus.value;
  };
  const app = await createApp({
    dataDir: dir,
    sdk,
    pushSender: sender,
    env: opts.env ?? { ANTHROPIC_API_KEY: FAKE_KEY },
    webDir: path.join(dir, 'web'),
    limiter: opts.limiter ?? new LoginLimiter(),
    interruptGraceMs: 200,
  });
  const { port } = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const client = new Client(base);
  return {
    app,
    sdk,
    base,
    dir,
    project,
    sent,
    pushStatus,
    client,
    close: () => app.close(),
  };
}

/** Pair a client using a fresh one-time token. */
export async function pair(
  t: TestApp,
  client: Client = t.client,
  name = 'Test phone',
): Promise<void> {
  const { token } = t.app.pairing.create();
  const res = await client.req('POST', '/api/auth/pair', { token, deviceName: name });
  if (res.status !== 200) throw new Error(`pair failed: ${res.status}`);
}

export async function waitFor<T>(
  fn: () => T | undefined | false | Promise<T | undefined | false>,
  ms = 5000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function events(t: TestApp, id: string): readonly SessionEvent[] {
  return t.app.store.events(id).all();
}

export function lastOf<K extends SessionEvent['type']>(
  evs: readonly SessionEvent[],
  type: K,
): Extract<SessionEvent, { type: K }> | undefined {
  return [...evs].reverse().find((e) => e.type === type) as
    Extract<SessionEvent, { type: K }> | undefined;
}

/** Read an SSE stream until `count` data messages arrive (or timeout). */
export async function readSse(
  url: string,
  cookie: string,
  count: number,
  headers: Record<string, string> = {},
  ms = 4000,
): Promise<{ id: string | null; data: unknown }[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const out: { id: string | null; data: unknown }[] = [];
  try {
    const res = await fetch(url, { headers: { cookie, ...headers }, signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (out.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let id: string | null = null;
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) id = line.slice(4);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) out.push({ id, data: JSON.parse(data) });
      }
    }
    ac.abort();
  } catch (err) {
    if (!ac.signal.aborted) throw err;
  } finally {
    clearTimeout(timer);
  }
  return out;
}
