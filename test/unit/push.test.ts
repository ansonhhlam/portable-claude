import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/server/logger.js';
import { PushService, type PushSender } from '../../src/server/push.js';
import { pair, startTestApp, tmpDir, type TestApp } from './helpers.js';

const vapid = () => ({ subject: 'mailto:you@example.com', publicKey: 'pub', privateKey: 'priv' });
const sub = (n: number) => ({
  endpoint: `https://push.example.com/s/${n}`,
  keys: { p256dh: 'p', auth: 'a' },
});

describe('PushService', () => {
  it('sends to each subscription and prunes expired ones (404/410)', async () => {
    const statuses: Record<string, number> = {
      'https://push.example.com/s/1': 201,
      'https://push.example.com/s/2': 410,
      'https://push.example.com/s/3': 404,
      'https://push.example.com/s/4': 500,
    };
    const sender: PushSender = async (s) => statuses[s.endpoint]!;
    const svc = new PushService(path.join(tmpDir(), 'push.json'), vapid, sender, silentLogger);
    for (const n of [1, 2, 3]) svc.subscribe('dev-a', sub(n));
    svc.subscribe('dev-b', sub(4));
    const r = await svc.notify({ title: 't', body: 'b', url: '/', tag: 'x' });
    expect(r).toEqual({ sent: 1, pruned: 2, failed: 1 });
    expect(svc.count()).toBe(2);
    expect(svc.count('dev-a')).toBe(1);
  });

  it('handles sender errors, per-device delivery and removal', async () => {
    let calls = 0;
    const sender: PushSender = async () => {
      calls++;
      throw new Error('network');
    };
    const svc = new PushService(path.join(tmpDir(), 'push.json'), vapid, sender, silentLogger);
    svc.subscribe('dev-a', sub(1));
    svc.subscribe('dev-b', sub(2));
    expect((await svc.notify({ title: 't', body: 'b', url: '/', tag: 'x' }, 'dev-a')).failed).toBe(
      1,
    );
    expect(calls).toBe(1);
    svc.removeDevice('dev-a');
    svc.unsubscribe(sub(2).endpoint);
    expect(svc.count()).toBe(0);
    expect(() =>
      svc.subscribe('d', {
        endpoint: 'http://insecure.example.com/x',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    ).toThrow();
  });

  it('does nothing without VAPID keys', async () => {
    const svc = new PushService(
      path.join(tmpDir(), 'push.json'),
      () => null,
      async () => 201,
      silentLogger,
    );
    svc.subscribe('d', sub(1));
    expect(await svc.notify({ title: 't', body: 'b', url: '/', tag: 'x' })).toEqual({
      sent: 0,
      pruned: 0,
      failed: 0,
    });
    expect(svc.publicKey()).toBeNull();
  });
});

describe('push API', () => {
  let t: TestApp;
  afterEach(async () => t?.close());

  it('exposes the VAPID key, subscribes, tests and unsubscribes', async () => {
    t = await startTestApp();
    await pair(t);
    const key = (await t.client.json<{ publicKey: string }>('GET', '/api/push/key')).body.publicKey;
    expect(key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await t.client.json('POST', '/api/push/test')).status).toBe(409);
    await t.client.json('POST', '/api/push/subscribe', sub(9));
    const r = await t.client.json<{ sent: number }>('POST', '/api/push/test');
    expect(r.body.sent).toBe(1);
    expect(t.sent[0]!.payload).toMatchObject({ title: 'Test notification' });
    expect(
      (await t.client.json('POST', '/api/push/subscribe', { endpoint: 'nope', keys: {} })).status,
    ).toBe(400);
    await t.client.json('DELETE', '/api/push/subscribe', { endpoint: sub(9).endpoint });
    expect(t.app.push.count()).toBe(0);
  });

  it('prunes a subscription the push service reports as gone', async () => {
    t = await startTestApp();
    await pair(t);
    await t.client.json('POST', '/api/push/subscribe', sub(5));
    t.pushStatus.value = 410;
    const r = await t.client.json('POST', '/api/push/test');
    expect(r.status).toBe(409);
    expect(t.app.push.count()).toBe(0);
  });
});
