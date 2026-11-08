import { afterEach, describe, expect, it } from 'vitest';
import type { SessionDetail } from '../../src/shared/api.js';
import { events, lastOf, pair, readSse, startTestApp, waitFor, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

async function create(prompt: string, mode = 'default', extra: Record<string, unknown> = {}) {
  const r = await t.client.json<SessionDetail>('POST', '/api/sessions', { projectId: 'demo', prompt, mode, ...extra });
  expect(r.status).toBe(201);
  return r.body;
}

const finished = (id: string, n = 1) =>
  waitFor(() => events(t, id).filter((e) => e.type === 'run.finished').length >= n && t.app.manager.state(id) === 'idle');

describe('agent sessions', () => {
  it('runs a prompt and records text, totals and cost', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('hello there');
    await finished(s.id);
    const evs = events(t, s.id);
    expect(evs[0]!.type).toBe('session.created');
    expect(evs.some((e) => e.type === 'assistant.delta')).toBe(true);
    const msg = lastOf(evs, 'assistant.message');
    expect(msg?.data.text).toContain('Mock reply');
    const run = lastOf(evs, 'run.finished')!;
    expect(run.data.isError).toBe(false);
    expect(run.data.costUsd).toBeGreaterThan(0);
    const detail = (await t.client.json<SessionDetail>('GET', `/api/sessions/${s.id}`)).body;
    expect(detail.totals.runs).toBe(1);
    expect(detail.state).toBe('idle');
    expect(detail.preview).toContain('Mock reply');
    const spend = (await t.client.json<{ todayUsd: number }>('GET', '/api/spend')).body;
    expect(spend.todayUsd).toBeCloseTo(run.data.costUsd);
    expect(t.sent.length).toBe(0); // no push subscriptions yet
  });

  it('asks for approval and continues after allow', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('please run the bash tests');
    const req = await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    expect(req.data.toolName).toBe('Bash');
    expect(req.data.summary).toBe('npm test');
    expect(req.data.canAlwaysAllow).toBe(true);
    expect(t.app.manager.state(s.id)).toBe('waiting');
    const r = await t.client.json('POST', `/api/sessions/${s.id}/approvals/${req.data.approvalId}`, { decision: 'allow' });
    expect(r.status).toBe(200);
    await finished(s.id);
    const evs = events(t, s.id);
    expect(lastOf(evs, 'approval.resolved')?.data.resolution).toBe('allow');
    const end = evs.find((e) => e.type === 'tool.end' && !e.data.isError);
    expect(end).toBeDefined();
    // Answering twice reports expiry.
    const again = await t.client.json<{ code: string }>('POST', `/api/sessions/${s.id}/approvals/${req.data.approvalId}`, { decision: 'allow' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('expired');
  });

  it('sends a deny note back to the agent', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('edit the file');
    const req = await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    expect(req.data.toolName).toBe('Edit');
    expect(req.data.diff?.path).toBe('src/app.ts');
    expect(req.data.diff?.lines.some((l) => l.kind === 'add')).toBe(true);
    await t.client.json('POST', `/api/sessions/${s.id}/approvals/${req.data.approvalId}`, { decision: 'deny', note: 'use a template literal' });
    await finished(s.id);
    const evs = events(t, s.id);
    expect(lastOf(evs, 'approval.resolved')?.data).toMatchObject({ resolution: 'deny', note: 'use a template literal' });
    const end = evs.find((e) => e.type === 'tool.end' && e.data.isError);
    expect(end?.type === 'tool.end' && end.data.output).toContain('use a template literal');
  });

  it('"always allow" applies the SDK suggestions so the next request is not asked', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('run bash tests');
    const req = await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    await t.client.json('POST', `/api/sessions/${s.id}/approvals/${req.data.approvalId}`, { decision: 'always' });
    await finished(s.id);
    await t.client.json('POST', `/api/sessions/${s.id}/messages`, { text: 'run the bash tests again' });
    await finished(s.id, 2);
    expect(events(t, s.id).filter((e) => e.type === 'approval.request')).toHaveLength(1);
    expect(t.sdk.queries).toHaveLength(1);
  });

  it('expires pending approvals left behind by a restart', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('run bash tests');
    const req = await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    // Simulate a crash: the process dies without resolving anything.
    const dir = t.dir;
    t.app.store.close();
    (t.app.manager as unknown as { runners: Map<string, unknown> }).runners.clear();
    await new Promise<void>((r) => t.app.server.close(() => r()));
    t.app.server.closeAllConnections();
    t = await startTestApp({ dir });
    const evs = events(t, s.id);
    const res = lastOf(evs, 'approval.resolved');
    expect(res?.data).toMatchObject({ approvalId: req.data.approvalId, resolution: 'expired' });
    expect(lastOf(evs, 'state')?.data.state).toBe('idle');
    const detail = (await (async () => {
      await pair(t);
      return t.client.json<SessionDetail>('GET', `/api/sessions/${s.id}`);
    })()).body;
    expect(detail.pendingApprovalIds).toEqual([]);
  });

  it('cancels a pending approval cleanly when the run is interrupted', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('run bash tests');
    await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    await t.client.json('POST', `/api/sessions/${s.id}/interrupt`);
    await finished(s.id);
    const evs = events(t, s.id);
    expect(lastOf(evs, 'approval.resolved')?.data.resolution).toBe('aborted');
    expect(lastOf(evs, 'run.finished')?.data.isError).toBe(true);
  });

  it('interrupts a long run', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('wait for a while');
    await waitFor(() => t.app.manager.state(s.id) === 'working' && lastOf(events(t, s.id), 'assistant.message'));
    const r = await t.client.json('POST', `/api/sessions/${s.id}/interrupt`);
    expect(r.status).toBe(202);
    await finished(s.id);
    expect(lastOf(events(t, s.id), 'run.finished')?.data.errors).toContain('Interrupted by user');
  });

  it('queues follow-up messages sent while the agent is working', async () => {
    t = await startTestApp({ delayMs: 5 });
    await pair(t);
    const s = await create('hello one');
    const r = await t.client.json<{ queued: boolean }>('POST', `/api/sessions/${s.id}/messages`, { text: 'hello two' });
    expect(r.body.queued).toBe(true);
    await finished(s.id, 2);
    const msgs = events(t, s.id).filter((e) => e.type === 'user.message');
    expect(msgs.map((m) => m.type === 'user.message' && m.data.queued)).toEqual([false, true]);
    expect(t.sdk.queries).toHaveLength(1);
    expect(t.sdk.queries[0]!.received).toEqual(['hello one', 'hello two']);
  });

  it('changes permission mode live and requires confirmation for bypass', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('hello');
    await finished(s.id);
    const ok = await t.client.json<SessionDetail>('POST', `/api/sessions/${s.id}/mode`, { mode: 'acceptEdits' });
    expect(ok.body.mode).toBe('acceptEdits');
    expect(t.sdk.queries[0]!.modeChanges).toContain('acceptEdits');
    const refused = await t.client.json<{ code: string }>('POST', `/api/sessions/${s.id}/mode`, { mode: 'bypassPermissions' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('bypass_confirm_required');
    const bypass = await t.client.json<SessionDetail>('POST', `/api/sessions/${s.id}/mode`, { mode: 'bypassPermissions', confirmBypass: true });
    expect(bypass.body.mode).toBe('bypassPermissions');
    expect(lastOf(events(t, s.id), 'mode.changed')?.data.mode).toBe('bypassPermissions');
    // The process started without the bypass flag is released and restarts with it.
    await waitFor(() => !t.app.manager.isLive(s.id));
    await t.client.json('POST', `/api/sessions/${s.id}/messages`, { text: 'run bash tests' });
    await finished(s.id, 2);
    expect(t.sdk.queries).toHaveLength(2);
    expect(events(t, s.id).filter((e) => e.type === 'approval.request')).toHaveLength(0);
  });

  it('creating a session in bypass mode needs confirmation', async () => {
    t = await startTestApp();
    await pair(t);
    const r = await t.client.json<{ code: string }>('POST', '/api/sessions', { projectId: 'demo', prompt: 'x', mode: 'bypassPermissions' });
    expect(r.body.code).toBe('bypass_confirm_required');
    await create('hello', 'bypassPermissions', { confirmBypass: true });
  });

  it('frees idle agents and resumes transparently', async () => {
    t = await startTestApp({ config: { idleTimeoutMinutes: 0.001 } });
    await pair(t);
    const s = await create('hello');
    await finished(s.id);
    await waitFor(() => !t.app.manager.isLive(s.id));
    const sdkId = t.app.store.get(s.id)!.sdkSessionId;
    expect(sdkId).toBeTruthy();
    await t.client.json('POST', `/api/sessions/${s.id}/messages`, { text: 'hello again' });
    await finished(s.id, 2);
    expect(t.sdk.queries).toHaveLength(2);
    expect(t.sdk.queries[1]!.received).toEqual(['hello again']);
  });

  it('reports failed runs', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('please fail');
    await finished(s.id);
    const run = lastOf(events(t, s.id), 'run.finished')!;
    expect(run.data.isError).toBe(true);
    expect(run.data.errors).toContain('Mock failure requested');
  });

  it('shows subagent activity under its parent tool call', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('use a subagent');
    await finished(s.id);
    const evs = events(t, s.id);
    const task = evs.find((e) => e.type === 'tool.start' && e.data.name === 'Task');
    expect(task).toBeDefined();
    const parent = task!.type === 'tool.start' ? task!.data.toolUseId : '';
    expect(evs.some((e) => e.type === 'tool.start' && e.data.parentToolUseId === parent)).toBe(true);
    expect(evs.some((e) => e.type === 'assistant.message' && e.data.parentToolUseId === parent)).toBe(true);
  });

  it('refuses new runs once the daily spend cap is reached', async () => {
    t = await startTestApp({ config: { dailySpendCapUsd: 0.001 } });
    await pair(t);
    await t.app.push.subscribe(
      (await t.client.json<{ deviceId: string }>('GET', '/api/me')).body.deviceId,
      { endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'p', auth: 'a' } },
    );
    const s = await create('hello');
    await finished(s.id);
    const r = await t.client.json<{ code: string; error: string }>('POST', `/api/sessions/${s.id}/messages`, { text: 'more' });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('spend_cap');
    const r2 = await t.client.json<{ code: string }>('POST', '/api/sessions', { projectId: 'demo', prompt: 'x', mode: 'default' });
    expect(r2.body.code).toBe('spend_cap');
    expect(t.app.store.list()).toHaveLength(1);
    await waitFor(() => t.sent.some((m) => (m.payload as { tag: string }).tag === 'spend-cap'));
    const spend = (await t.client.json<{ capReached: boolean }>('GET', '/api/spend')).body;
    expect(spend.capReached).toBe(true);
  });

  it('refuses to start without an API key and never falls back to another login', async () => {
    t = await startTestApp({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'should-be-ignored' } });
    await pair(t);
    const r = await t.client.json<{ code: string }>('POST', '/api/sessions', { projectId: 'demo', prompt: 'x', mode: 'default' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('no_credentials');
    expect(t.sdk.queries).toHaveLength(0);
  });

  it('renames, archives and deletes sessions', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('hello');
    await finished(s.id);
    const renamed = await t.client.json<SessionDetail>('PATCH', `/api/sessions/${s.id}`, { title: 'New name' });
    expect(renamed.body.title).toBe('New name');
    const archived = await t.client.json<SessionDetail>('PATCH', `/api/sessions/${s.id}`, { archived: true });
    expect(archived.body.archived).toBe(true);
    expect((await t.client.json('DELETE', `/api/sessions/${s.id}`)).status).toBe(200);
    expect((await t.client.json('GET', `/api/sessions/${s.id}`)).status).toBe(404);
  });

  it('imports a session started elsewhere and resumes it', async () => {
    t = await startTestApp();
    await pair(t);
    const c = await t.client.json<{ sdkSessionId: string; summary: string }[]>('GET', '/api/import/candidates?projectId=demo');
    expect(c.body).toHaveLength(1);
    const imp = await t.client.json<SessionDetail>('POST', '/api/import', { projectId: 'demo', sdkSessionId: c.body[0]!.sdkSessionId });
    expect(imp.status).toBe(201);
    expect(imp.body.imported).toBe(true);
    const hist = events(t, imp.body.id).filter((e) => e.type === 'history.message');
    expect(hist.length).toBe(4);
    // Already imported sessions are no longer offered.
    expect((await t.client.json<unknown[]>('GET', '/api/import/candidates?projectId=demo')).body).toHaveLength(0);
    await t.client.json('POST', `/api/sessions/${imp.body.id}/messages`, { text: 'continue please' });
    await finished(imp.body.id);
    expect(t.sdk.queries[0]!.received).toEqual(['continue please']);
    const q = t.sdk.queries[0] as unknown as { sessionId: string };
    expect(q.sessionId).toBe(c.body[0]!.sdkSessionId);
  });

  it('replays events over SSE after a given sequence and dedupes on reconnect', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('hello');
    await finished(s.id);
    const total = t.app.store.events(s.id).lastSeq;
    const all = await readSse(`${t.base}/api/sessions/${s.id}/events`, t.client.cookie, total);
    expect(all.map((m) => Number(m.id))).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    // Simulated background: the client reconnects with Last-Event-ID and receives only newer events.
    const half = Math.floor(total / 2);
    const rest = await readSse(`${t.base}/api/sessions/${s.id}/events?after=1`, t.client.cookie, total - half, { 'last-event-id': String(half) });
    expect(Number(rest[0]!.id)).toBe(half + 1);
    // Live events arrive after the backlog.
    const live = readSse(`${t.base}/api/sessions/${s.id}/events?after=${total}`, t.client.cookie, 1);
    await new Promise((r) => setTimeout(r, 100));
    await t.client.json('PATCH', `/api/sessions/${s.id}`, { title: 'Renamed' });
    const got = await live;
    expect(got[0]!.data).toMatchObject({ seq: total + 1, type: 'session.renamed' });
  });

  it('sends push notifications for approvals and finished runs', async () => {
    t = await startTestApp();
    await pair(t);
    const me = (await t.client.json<{ deviceId: string }>('GET', '/api/me')).body;
    const sub = await t.client.json('POST', '/api/push/subscribe', { endpoint: 'https://push.example.com/sub/2', keys: { p256dh: 'p', auth: 'a' } });
    expect(sub.status).toBe(200);
    expect(t.app.push.count(me.deviceId)).toBe(1);
    const s = await create('run bash tests');
    const req = await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    await waitFor(() => t.sent.some((m) => (m.payload as { title: string }).title === 'Approval needed'));
    await t.client.json('POST', `/api/sessions/${s.id}/approvals/${req.data.approvalId}`, { decision: 'allow' });
    await finished(s.id);
    await waitFor(() => t.sent.some((m) => (m.payload as { title: string }).title === 'Run finished'));
    // Notification text never includes the command itself.
    expect(JSON.stringify(t.sent)).not.toContain('npm test');
  });

  it('shuts down gracefully, denying pending approvals', async () => {
    t = await startTestApp();
    await pair(t);
    const s = await create('run bash tests');
    await waitFor(() => lastOf(events(t, s.id), 'approval.request'));
    const log = t.app.store.events(s.id);
    await t.app.close('Server shutting down');
    expect([...log.all()].some((e) => e.type === 'approval.resolved' && e.data.resolution === 'aborted')).toBe(true);
    expect(t.sdk.queries[0]!.isClosed).toBe(true);
  });
});
