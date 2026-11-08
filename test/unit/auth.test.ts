import { afterEach, describe, expect, it } from 'vitest';
import {
  LoginLimiter,
  PairingStore,
  generatePasscode,
  hashPasscode,
  parseCookie,
  passcodeProblem,
  readCookies,
  signCookie,
  verifyPasscode,
} from '../../src/server/auth.js';
import { Client, pair, startTestApp, tmpDir, type TestApp } from './helpers.js';
import http from 'node:http';
import path from 'node:path';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('passcodes', () => {
  it('hashes and verifies', () => {
    const h = hashPasscode('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifyPasscode('correct horse battery', h)).toBe(true);
    expect(verifyPasscode('wrong', h)).toBe(false);
    expect(verifyPasscode('x', null)).toBe(false);
    expect(verifyPasscode('x', 'garbage')).toBe(false);
  });
  it('generates readable passcodes and validates length', () => {
    const p = generatePasscode();
    expect(p).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(passcodeProblem('short')).toMatch(/at least/);
    expect(passcodeProblem('x'.repeat(201))).toMatch(/too long/);
    expect(passcodeProblem('long enough')).toBeNull();
  });
});

describe('cookies', () => {
  it('signs and rejects tampering', () => {
    const v = signCookie('s'.repeat(40), 'dev', 'tok');
    expect(parseCookie('s'.repeat(40), v)).toEqual({ deviceId: 'dev', token: 'tok' });
    expect(parseCookie('t'.repeat(40), v)).toBeNull();
    expect(parseCookie('s'.repeat(40), v.replace('tok', 'tak'))).toBeNull();
    expect(parseCookie('s'.repeat(40), 'a.b')).toBeNull();
    expect(readCookies('a=1; b = two%20x; junk')).toEqual({ a: '1', b: 'two x' });
  });
});

describe('pairing tokens', () => {
  it('work once and expire after 10 minutes', () => {
    let now = 1_000_000;
    const store = new PairingStore(path.join(tmpDir(), 'pairing.json'), () => now);
    const a = store.create();
    expect(store.consume(a.token)).toBe(true);
    expect(store.consume(a.token)).toBe(false);
    const b = store.create();
    now += 10 * 60_000 + 1;
    expect(store.consume(b.token)).toBe(false);
    expect(store.consume('never-issued-token')).toBe(false);
  });
});

describe('login limiter', () => {
  it('locks out after repeated failures, with growing lock time', () => {
    let now = 0;
    const l = new LoginLimiter({ maxFailures: 3, lockMs: 1000, now: () => now });
    l.fail('a');
    l.fail('a');
    expect(l.retryAfter('a')).toBe(0);
    l.fail('a');
    expect(l.retryAfter('a')).toBe(1000);
    expect(l.retryAfter('b')).toBe(0);
    now += 1001;
    expect(l.retryAfter('a')).toBe(0);
    l.fail('a');
    l.fail('a');
    l.fail('a');
    expect(l.retryAfter('a')).toBe(2000);
  });
  it('has a global limit across clients', () => {
    const l = new LoginLimiter({ globalMaxFailures: 4, lockMs: 500, now: () => 0 });
    for (const k of ['a', 'b', 'c', 'd']) l.fail(k);
    expect(l.retryAfter('fresh')).toBe(500);
  });
});

describe('HTTP auth', () => {
  it('requires authentication for API routes but not for /healthz', async () => {
    t = await startTestApp();
    expect((await fetch(`${t.base}/healthz`)).status).toBe(200);
    expect(await (await fetch(`${t.base}/healthz`)).json()).toEqual({ ok: true });
    for (const p of ['/api/state', '/api/sessions', '/api/devices', '/api/me', '/api/sessions/x/events']) {
      expect((await fetch(t.base + p)).status).toBe(401);
    }
  });

  it('pairs a device with a one-time token and sets a hardened cookie', async () => {
    t = await startTestApp();
    const { token } = t.app.pairing.create();
    const res = await t.client.req('POST', '/api/auth/pair', { token, deviceName: 'My phone' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await t.client.json('GET', '/api/state')).status).toBe(200);
    const other = new Client(t.base);
    expect((await other.req('POST', '/api/auth/pair', { token, deviceName: 'x' })).status).toBe(401);
  });

  it('signs in with the passcode and locks out after failures', async () => {
    t = await startTestApp({ limiter: new LoginLimiter({ maxFailures: 3 }) });
    t.app.secrets.update((s) => {
      s.passcodeHash = hashPasscode('open sesame 123');
    });
    const c = new Client(t.base);
    expect((await c.req('POST', '/api/auth/login', { passcode: 'nope' })).status).toBe(401);
    expect((await c.req('POST', '/api/auth/login', { passcode: 'open sesame 123', deviceName: 'Tablet' })).status).toBe(200);
    expect((await c.json('GET', '/api/me')).body).toMatchObject({ deviceName: 'Tablet' });
    const d = new Client(t.base);
    for (let i = 0; i < 3; i++) await d.req('POST', '/api/auth/login', { passcode: 'wrong' });
    const locked = await d.req('POST', '/api/auth/login', { passcode: 'open sesame 123' });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
  });

  it('does not accept a passcode when none is set', async () => {
    t = await startTestApp();
    expect((await t.client.req('POST', '/api/auth/login', { passcode: 'anything' })).status).toBe(401);
  });

  it('revokes devices from the app and from the store (CLI path)', async () => {
    t = await startTestApp();
    await pair(t, t.client, 'Phone A');
    const b = new Client(t.base);
    await pair(t, b, 'Phone B');
    const list = (await t.client.json<{ id: string; name: string; current: boolean }[]>('GET', '/api/devices')).body;
    expect(list.map((d) => d.name).sort()).toEqual(['Phone A', 'Phone B']);
    const bId = list.find((d) => d.name === 'Phone B')!.id;
    expect((await t.client.json('DELETE', `/api/devices/${bId}`)).status).toBe(200);
    expect((await b.json('GET', '/api/state')).status).toBe(401);
    // Revoking through the device store, as the CLI does, takes effect immediately.
    const aId = list.find((d) => d.name === 'Phone A')!.id;
    expect(t.app.devices.revoke(aId.slice(0, 8))).toBe('Phone A');
    expect((await t.client.json('GET', '/api/state')).status).toBe(401);
  });

  it('logout clears the cookie and the device', async () => {
    t = await startTestApp();
    await pair(t);
    const res = await t.client.req('POST', '/api/auth/logout', {});
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(t.app.devices.list()).toHaveLength(0);
  });

  it('blocks cross-origin state changes (CSRF)', async () => {
    t = await startTestApp();
    await pair(t);
    const evil = new Client(t.base, 'https://evil.example.com');
    evil.cookie = t.client.cookie;
    const r = await evil.req('POST', '/api/sessions', { projectId: 'demo', prompt: 'x', mode: 'default' });
    expect(r.status).toBe(403);
    // A missing Origin header is also refused.
    const res = await fetch(`${t.base}/api/sessions`, {
      method: 'POST',
      headers: { cookie: t.client.cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    // Requests through the Tailscale HTTPS name are allowed. fetch() cannot set
    // the Host header, so use node:http for this one.
    const status = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ title: 'x' });
      const req = http.request(
        `${t!.base}/api/sessions/00000000-0000-0000-0000-000000000000`,
        {
          method: 'PATCH',
          headers: {
            host: 'my-pc.example-tailnet.ts.net',
            origin: 'https://my-pc.example-tailnet.ts.net',
            cookie: t!.client.cookie,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(status).toBe(404);
  });

  it('rejects non-JSON bodies and oversized requests', async () => {
    t = await startTestApp();
    await pair(t);
    const res = await fetch(`${t.base}/api/sessions`, {
      method: 'POST',
      headers: { cookie: t.client.cookie, origin: t.base, 'content-type': 'text/plain' },
      body: 'hi',
    });
    expect(res.status).toBe(415);
    const big = await fetch(`${t.base}/api/sessions`, {
      method: 'POST',
      headers: { cookie: t.client.cookie, origin: t.base, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x'.repeat(1_100_000) }),
    });
    expect(big.status).toBe(413);
    const bad = await fetch(`${t.base}/api/sessions`, {
      method: 'POST',
      headers: { cookie: t.client.cookie, origin: t.base, 'content-type': 'application/json' },
      body: '{nope',
    });
    expect(bad.status).toBe(400);
  });

  it('sets strict security headers', async () => {
    t = await startTestApp();
    const res = await fetch(`${t.base}/healthz`);
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('content-security-policy')).not.toContain('unsafe-inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('refuses to listen on a non-loopback address', async () => {
    t = await startTestApp();
    await expect(t.app.listen(0, '0.0.0.0')).rejects.toThrow(/non-loopback/);
  });
});
