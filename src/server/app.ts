import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  PERMISSION_MODES,
  type DeviceInfo,
  type GlobalEvent,
  type ImportCandidate,
  type MeInfo,
  type ProjectInfo,
  type PermissionModeName,
  type SessionDetail,
  type SessionEvent,
  type SessionSummary,
  type StateResponse,
} from '../shared/api.js';
import { packageVersion } from '../shared/version.js';
import { Approvals } from './approvals.js';
import {
  COOKIE_NAME,
  DeviceStore,
  LoginLimiter,
  PairingStore,
  clearedCookie,
  parseCookie,
  readCookies,
  sessionCookie,
  signCookie,
  verifyPasscode,
} from './auth.js';
import { configFile, secretsFile, type Config, type Project, type Secrets } from './config.js';
import { buildAgentEnv } from './credentials.js';
import type { JsonFile } from './fsutil.js';
import {
  HttpError,
  isLoopback,
  readJsonBody,
  securityHeaders,
  sendJson,
  serveStatic,
} from './http.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import { migrate } from './migrations.js';
import { dataPaths, type DataPaths } from './paths.js';
import { PathError, resolveSessionCwd } from './projects.js';
import { PushService, generateVapidKeys, webPushSender, type PushSender } from './push.js';
import { AgentError, AgentManager } from './runner.js';
import type { AgentSdk } from './sdk/types.js';
import { SessionStore, type SessionMeta } from './sessions.js';
import { SpendTracker } from './spend.js';

export interface AppOptions {
  dataDir: string;
  sdk: AgentSdk;
  log?: Logger;
  pushSender?: PushSender;
  /** Directory of the built web app. */
  webDir?: string;
  /** Environment used to find credentials (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  limiter?: LoginLimiter;
  interruptGraceMs?: number;
  /** Skip the API key check (only for the mock agent, which makes no API calls). */
  credentialsOptional?: boolean;
}

export interface App {
  server: http.Server;
  paths: DataPaths;
  manager: AgentManager;
  approvals: Approvals;
  store: SessionStore;
  config: JsonFile<Config>;
  secrets: JsonFile<Secrets>;
  pairing: PairingStore;
  devices: DeviceStore;
  push: PushService;
  listen(port?: number, host?: string): Promise<{ port: number; host: string }>;
  close(reason?: string): Promise<void>;
}

const DEFAULT_WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  device: { id: string; name: string } | null;
};
type Handler = (ctx: Ctx) => Promise<void> | void;

const CreateSessionBody = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(100_000),
  mode: z.enum(PERMISSION_MODES),
  model: z.string().min(1).nullable().optional(),
  title: z.string().max(200).optional(),
  cwd: z.string().max(500).optional(),
  confirmBypass: z.boolean().optional(),
});
const UpdateSessionBody = z.object({
  title: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});
const MessageBody = z.object({ text: z.string().min(1).max(100_000) });
const ModeBody = z.object({
  mode: z.enum(PERMISSION_MODES),
  confirmBypass: z.boolean().optional(),
});
const ApprovalBody = z.object({
  decision: z.enum(['allow', 'deny', 'always']),
  note: z.string().max(2000).optional(),
});
const ImportBody = z.object({
  projectId: z.string().min(1),
  sdkSessionId: z.string().min(1).max(200),
});
const LoginBody = z.object({
  passcode: z.string().min(1).max(200),
  deviceName: z.string().max(60).optional(),
});
const PairBody = z.object({
  token: z.string().min(10).max(200),
  deviceName: z.string().max(60).optional(),
});
const SubscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
const UnsubscribeBody = z.object({ endpoint: z.string().max(2000) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(
      400,
      'invalid_request',
      `Invalid request: ${issue?.path.join('.') || 'body'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return r.data;
}

export async function createApp(opts: AppOptions): Promise<App> {
  const log = opts.log ?? silentLogger;
  const paths = dataPaths(opts.dataDir);
  const migration = migrate(paths, log);
  if (migration.from !== migration.to)
    log.info('data migrated', { ...migration, backup: migration.backup ? 'created' : null });

  const config = configFile(paths.config);
  const secrets = secretsFile(paths.secrets);
  config.get(); // validate early
  // Generate per-installation secrets on first run.
  const s0 = secrets.get();
  if (!s0.cookieSecret || !s0.vapidPublicKey || !s0.vapidPrivateKey) {
    const vapid = s0.vapidPublicKey && s0.vapidPrivateKey ? null : await generateVapidKeys();
    secrets.update((s) => {
      s.cookieSecret ??= randomBytes(32).toString('base64url');
      if (vapid) {
        s.vapidPublicKey = vapid.publicKey;
        s.vapidPrivateKey = vapid.privateKey;
      }
    });
  }

  const env = opts.env ?? process.env;
  const store = new SessionStore(paths.sessions, log);
  const approvals = new Approvals();
  const spend = new SpendTracker(paths.spend);
  const devices = new DeviceStore(paths.devices);
  const pairing = new PairingStore(paths.pairing);
  const limiter = opts.limiter ?? new LoginLimiter();
  const push = new PushService(
    paths.push,
    () => {
      const s = secrets.get();
      return s.vapidPublicKey && s.vapidPrivateKey
        ? {
            subject: config.get().pushSubject,
            publicKey: s.vapidPublicKey,
            privateKey: s.vapidPrivateKey,
          }
        : null;
    },
    opts.pushSender ?? webPushSender(),
    log,
  );

  // -------------------------------------------------------------- global stream
  const globalClients = new Set<ServerResponse>();
  const broadcast = (ev: GlobalEvent) => {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of globalClients) c.write(line);
  };
  const notify = (payload: Parameters<PushService['notify']>[0]) => {
    void push.notify(payload).catch((err: unknown) => log.warn('push error', { err }));
  };

  const manager = new AgentManager({
    sdk: opts.sdk,
    store,
    approvals,
    spend,
    config: () => config.get(),
    agentEnv: () =>
      opts.credentialsOptional
        ? { ok: true, env: {} }
        : buildAgentEnv(config.get(), secrets.get(), env),
    log,
    ...(opts.interruptGraceMs !== undefined ? { interruptGraceMs: opts.interruptGraceMs } : {}),
    hooks: {
      sessionChanged: (id) =>
        broadcast({ type: 'sessions.changed', ts: new Date().toISOString(), sessionId: id }),
      runFinished: (meta, ok, errors) => {
        notify({
          title: ok ? 'Run finished' : 'Run failed',
          body: ok
            ? meta.title
            : `${meta.title}: ${errors[0] ?? 'the run ended with an error'}`.slice(0, 180),
          url: `/#/s/${meta.id}`,
          tag: `run-${meta.id}`,
        });
        broadcast({ type: 'spend.changed', ts: new Date().toISOString() });
      },
      capReached: (today, cap) =>
        notify({
          title: 'Daily spend cap reached',
          body: `$${today.toFixed(2)} of $${cap.toFixed(2)} used today. New runs are paused.`,
          url: '/#/settings',
          tag: 'spend-cap',
        }),
    },
  });
  manager.recover();

  approvals.onRequested((sessionId, toolName) => {
    const meta = store.get(sessionId);
    notify({
      title: 'Approval needed',
      body: `${meta?.title ?? 'A session'} wants to use ${toolName}`,
      url: `/#/s/${sessionId}`,
      tag: `approval-${sessionId}`,
    });
    broadcast({ type: 'sessions.changed', ts: new Date().toISOString(), sessionId });
  });
  approvals.onResolved((sessionId) =>
    broadcast({ type: 'sessions.changed', ts: new Date().toISOString(), sessionId }),
  );

  // -------------------------------------------------------------- helpers
  const projectName = (id: string) =>
    config.get().projects.find((p) => p.id === id)?.name ?? 'Removed project';

  const summary = (m: SessionMeta): SessionSummary => ({
    id: m.id,
    title: m.title,
    projectId: m.projectId,
    projectName: projectName(m.projectId),
    mode: m.mode,
    model: m.model,
    state: manager.state(m.id),
    archived: m.archived,
    imported: m.imported,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    pendingApprovals: approvals.pendingFor(m.id).length,
    lastSeq: store.events(m.id).lastSeq,
    totals: m.totals,
    preview: m.preview,
  });
  const detail = (m: SessionMeta): SessionDetail => ({
    ...summary(m),
    pendingApprovalIds: approvals.pendingFor(m.id),
  });

  const me = (device: { id: string; name: string }): MeInfo => {
    const cfg = config.get();
    return {
      deviceId: device.id,
      deviceName: device.name,
      version: packageVersion(),
      models: cfg.models,
      defaultModel: cfg.defaultModel,
      mock: opts.sdk.kind === 'mock',
    };
  };

  const getSession = (id: string | undefined): SessionMeta => {
    const m = id ? store.get(id) : undefined;
    if (!m) throw new HttpError(404, 'not_found', 'Session not found');
    return m;
  };

  const checkBypass = (mode: PermissionModeName, confirmed?: boolean) => {
    if (mode === 'bypassPermissions' && !confirmed) {
      throw new HttpError(
        400,
        'bypass_confirm_required',
        'Bypass mode lets the agent run any tool without asking. Confirm to turn it on.',
      );
    }
  };

  const clientKey = (req: IncomingMessage): string => {
    const viaProxy = isLoopback(req.socket.remoteAddress);
    const login = req.headers['tailscale-user-login'];
    if (viaProxy && typeof login === 'string' && login) return `ts:${login}`;
    const fwd = req.headers['x-forwarded-for'];
    if (viaProxy && typeof fwd === 'string' && fwd) return `ip:${fwd.split(',')[0]!.trim()}`;
    return `ip:${req.socket.remoteAddress ?? 'unknown'}`;
  };

  const issueDevice = (res: ServerResponse, name: string, extra: Record<string, unknown> = {}) => {
    const secret = secrets.get().cookieSecret!;
    const d = devices.create(name);
    sendJson(
      res,
      200,
      { ok: true, deviceId: d.id, ...extra },
      { 'Set-Cookie': sessionCookie(signCookie(secret, d.id, d.token)) },
    );
  };

  const rateLimited = (req: IncomingMessage) => {
    const wait = limiter.retryAfter(clientKey(req));
    if (wait > 0) {
      throw new HttpError(
        429,
        'locked_out',
        `Too many failed attempts. Try again in ${Math.ceil(wait / 60_000)} minute(s).`,
        {
          'Retry-After': String(Math.ceil(wait / 1000)),
        },
      );
    }
  };

  // -------------------------------------------------------------- routes
  const routes: { method: string; re: RegExp; auth: boolean; h: Handler }[] = [];
  const route = (method: string, pattern: string, h: Handler, auth = true) => {
    const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, '([^/]+)') + '$');
    routes.push({ method, re, auth, h });
  };

  route('GET', '/healthz', ({ res }) => sendJson(res, 200, { ok: true }), false);

  route(
    'POST',
    '/api/auth/login',
    async ({ req, res }) => {
      rateLimited(req);
      const body = parse(LoginBody, await readJsonBody(req));
      const key = clientKey(req);
      if (!verifyPasscode(body.passcode, secrets.get().passcodeHash)) {
        limiter.fail(key);
        log.warn('failed login attempt');
        throw new HttpError(401, 'bad_passcode', 'That passcode is not right.');
      }
      limiter.succeed(key);
      log.info('device signed in with passcode');
      issueDevice(res, body.deviceName ?? 'Device');
    },
    false,
  );

  route(
    'POST',
    '/api/auth/pair',
    async ({ req, res }) => {
      rateLimited(req);
      const body = parse(PairBody, await readJsonBody(req));
      const key = clientKey(req);
      if (!pairing.consume(body.token)) {
        limiter.fail(key);
        log.warn('failed pairing attempt');
        throw new HttpError(
          401,
          'bad_pairing_token',
          'This pairing code is invalid, already used, or expired. Run `longcord pair` again.',
        );
      }
      limiter.succeed(key);
      log.info('device paired');
      issueDevice(res, body.deviceName ?? 'Device');
    },
    false,
  );

  route('POST', '/api/auth/logout', ({ res, device }) => {
    if (device) {
      devices.revoke(device.id);
      push.removeDevice(device.id);
    }
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
  });

  route('GET', '/api/me', ({ res, device }) => sendJson(res, 200, me(device!)));

  route('GET', '/api/state', ({ res, device }) => {
    const cfg = config.get();
    const body: StateResponse = {
      me: me(device!),
      sessions: store.list().map(summary),
      projects: cfg.projects.map((p) => displayProject(p)),
      spend: spend.info(cfg.dailySpendCapUsd),
    };
    sendJson(res, 200, body);
  });

  route('GET', '/api/projects', ({ res }) =>
    sendJson(
      res,
      200,
      config.get().projects.map((p) => displayProject(p)),
    ),
  );
  route('GET', '/api/sessions', ({ res }) => sendJson(res, 200, store.list().map(summary)));

  route('POST', '/api/sessions', async ({ req, res }) => {
    const body = parse(CreateSessionBody, await readJsonBody(req));
    const cfg = config.get();
    const project = cfg.projects.find((p) => p.id === body.projectId);
    if (!project)
      throw new HttpError(400, 'unknown_project', 'That project is not in the allowed list');
    checkBypass(body.mode, body.confirmBypass);
    if (body.model && cfg.models.length && !cfg.models.includes(body.model)) {
      throw new HttpError(400, 'unknown_model', 'That model is not in the configured list');
    }
    let cwd: string;
    try {
      cwd = resolveSessionCwd(project, body.cwd);
    } catch (err) {
      if (err instanceof PathError) throw new HttpError(400, 'bad_path', err.message);
      throw err;
    }
    const title = body.title?.trim() || body.prompt.trim().replace(/\s+/g, ' ').slice(0, 60);
    const meta = store.create({
      title,
      projectId: project.id,
      cwd,
      mode: body.mode,
      model: body.model ?? null,
    });
    store
      .events(meta.id)
      .append('session.created', { title, projectId: project.id, mode: body.mode });
    try {
      manager.send(meta.id, body.prompt);
    } catch (err) {
      await manager.remove(meta.id);
      store.delete(meta.id);
      throw err;
    }
    sendJson(res, 201, detail(store.get(meta.id)!));
  });

  route('GET', '/api/sessions/:id', ({ res, params }) =>
    sendJson(res, 200, detail(getSession(params[0]))),
  );

  route('PATCH', '/api/sessions/:id', async ({ req, res, params }) => {
    const meta = getSession(params[0]);
    const body = parse(UpdateSessionBody, await readJsonBody(req));
    if (body.title !== undefined && body.title !== meta.title) {
      store.update(meta.id, { title: body.title });
      store.events(meta.id).append('session.renamed', { title: body.title });
    }
    if (body.archived !== undefined) {
      store.update(meta.id, { archived: body.archived });
      if (body.archived) await manager.release(meta.id);
    }
    broadcast({ type: 'sessions.changed', ts: new Date().toISOString(), sessionId: meta.id });
    sendJson(res, 200, detail(store.get(meta.id)!));
  });

  route('DELETE', '/api/sessions/:id', async ({ res, params }) => {
    const meta = getSession(params[0]);
    await manager.remove(meta.id);
    store.delete(meta.id);
    broadcast({ type: 'sessions.changed', ts: new Date().toISOString(), sessionId: meta.id });
    sendJson(res, 200, { ok: true });
  });

  route('POST', '/api/sessions/:id/messages', async ({ req, res, params }) => {
    const meta = getSession(params[0]);
    const body = parse(MessageBody, await readJsonBody(req));
    if (meta.archived) store.update(meta.id, { archived: false });
    manager.send(meta.id, body.text);
    sendJson(res, 202, { ok: true, queued: manager.state(meta.id) !== 'idle' });
  });

  route('POST', '/api/sessions/:id/interrupt', async ({ res, params }) => {
    const meta = getSession(params[0]);
    await manager.interrupt(meta.id);
    sendJson(res, 202, { ok: true });
  });

  route('POST', '/api/sessions/:id/mode', async ({ req, res, params }) => {
    const meta = getSession(params[0]);
    const body = parse(ModeBody, await readJsonBody(req));
    checkBypass(body.mode, body.confirmBypass);
    await manager.setMode(meta.id, body.mode);
    sendJson(res, 200, detail(store.get(meta.id)!));
  });

  route('POST', '/api/sessions/:id/approvals/:approvalId', async ({ req, res, params }) => {
    const meta = getSession(params[0]);
    const body = parse(ApprovalBody, await readJsonBody(req));
    const ok = approvals.answer(meta.id, params[1]!, body.decision, body.note);
    if (!ok)
      throw new HttpError(409, 'expired', 'This request is no longer waiting for an answer.');
    sendJson(res, 200, { ok: true });
  });

  route('GET', '/api/sessions/:id/events', ({ req, res, url, params }) => {
    const meta = getSession(params[0]);
    const log = store.events(meta.id);
    const header = Number(req.headers['last-event-id']);
    const query = Number(url.searchParams.get('after'));
    const after = Math.max(
      Number.isFinite(header) ? header : 0,
      Number.isFinite(query) ? query : 0,
    );
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    let sent = after;
    const write = (ev: SessionEvent) => {
      if (ev.seq <= sent) return;
      sent = ev.seq;
      res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    for (const ev of log.since(after)) write(ev);
    const unsub = log.subscribe(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    const done = () => {
      clearInterval(ping);
      unsub();
      sseClients.delete(res);
    };
    sseClients.add(res);
    req.on('close', done);
    res.on('error', done);
  });

  route('GET', '/api/events', ({ req, res }) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(
      `data: ${JSON.stringify({ type: 'hello', ts: new Date().toISOString() } satisfies GlobalEvent)}\n\n`,
    );
    globalClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      globalClients.delete(res);
    });
  });

  route('GET', '/api/import/candidates', async ({ res, url }) => {
    const project = config.get().projects.find((p) => p.id === url.searchParams.get('projectId'));
    if (!project) throw new HttpError(400, 'unknown_project', 'Unknown project');
    const list = await opts.sdk.listSessions({ dir: project.path, limit: 50 });
    const out: ImportCandidate[] = list
      .filter((s) => !store.findBySdkSession(s.sessionId))
      .map((s) => ({
        sdkSessionId: s.sessionId,
        summary: s.customTitle ?? s.summary ?? s.firstPrompt ?? 'Untitled session',
        lastModified: s.lastModified,
        gitBranch: s.gitBranch ?? null,
      }));
    sendJson(res, 200, out);
  });

  route('POST', '/api/import', async ({ req, res }) => {
    const body = parse(ImportBody, await readJsonBody(req));
    const cfg = config.get();
    const project = cfg.projects.find((p) => p.id === body.projectId);
    if (!project) throw new HttpError(400, 'unknown_project', 'Unknown project');
    const existing = store.findBySdkSession(body.sdkSessionId);
    if (existing) return sendJson(res, 200, detail(existing));
    const candidates = await opts.sdk.listSessions({ dir: project.path, limit: 200 });
    const info = candidates.find((c) => c.sessionId === body.sdkSessionId);
    if (!info) throw new HttpError(404, 'not_found', 'That session was not found in this project');
    const messages = await opts.sdk.getSessionMessages(body.sdkSessionId, { dir: project.path });
    const title = (info.customTitle ?? info.summary ?? 'Imported session').slice(0, 80);
    const meta = store.create({
      title,
      projectId: project.id,
      cwd: resolveSessionCwd(project),
      mode: cfg.defaultMode === 'bypassPermissions' ? 'default' : cfg.defaultMode,
      model: null,
      sdkSessionId: body.sdkSessionId,
      imported: true,
    });
    const log = store.events(meta.id);
    log.append('session.created', { title, projectId: project.id, mode: meta.mode });
    let preview = '';
    for (const m of messages) {
      if (m.type !== 'user' && m.type !== 'assistant') continue;
      const { text, tools } = flattenHistory(m.message);
      if (!text && tools.length === 0) continue;
      log.append('history.message', { role: m.type, text: text.slice(0, 50_000), tools });
      if (text) preview = text;
    }
    log.append('notice', {
      level: 'info',
      message: 'History imported read-only. Send a message to continue this session here.',
    });
    store.update(meta.id, { preview: preview.replace(/\s+/g, ' ').slice(0, 160) });
    sendJson(res, 201, detail(store.get(meta.id)!));
  });

  route('GET', '/api/devices', ({ res, device }) =>
    sendJson(res, 200, devices.list(device!.id) satisfies DeviceInfo[]),
  );

  route('DELETE', '/api/devices/:id', ({ res, params, device }) => {
    const name = devices.revoke(params[0]!);
    if (!name) throw new HttpError(404, 'not_found', 'Device not found');
    push.removeDevice(params[0]!);
    log.info('device revoked from the app');
    const self = params[0] === device!.id;
    sendJson(res, 200, { ok: true }, self ? { 'Set-Cookie': clearedCookie() } : {});
  });

  route('GET', '/api/spend', ({ res }) =>
    sendJson(res, 200, spend.info(config.get().dailySpendCapUsd)),
  );

  route('GET', '/api/push/key', ({ res }) => sendJson(res, 200, { publicKey: push.publicKey() }));

  route('POST', '/api/push/subscribe', async ({ req, res, device }) => {
    const body = parse(SubscribeBody, await readJsonBody(req));
    try {
      push.subscribe(device!.id, body);
    } catch (err) {
      throw new HttpError(400, 'bad_subscription', (err as Error).message);
    }
    sendJson(res, 200, { ok: true });
  });

  route('DELETE', '/api/push/subscribe', async ({ req, res }) => {
    const body = parse(UnsubscribeBody, await readJsonBody(req));
    push.unsubscribe(body.endpoint);
    sendJson(res, 200, { ok: true });
  });

  route('POST', '/api/push/test', async ({ res, device }) => {
    const r = await push.notify(
      {
        title: 'Test notification',
        body: 'Notifications from longcord are working.',
        url: '/#/settings',
        tag: 'test',
      },
      device!.id,
    );
    if (r.sent === 0) {
      throw new HttpError(
        409,
        'push_not_delivered',
        'No notification was delivered. Turn notifications on for this device first.',
      );
    }
    sendJson(res, 200, r);
  });

  // -------------------------------------------------------------- dispatch
  const sseClients = new Set<ServerResponse>();
  const webDir = opts.webDir ?? DEFAULT_WEB_DIR;

  const allowedOrigin = (req: IncomingMessage, origin: string): boolean => {
    const cfg = config.get();
    const port = (server.address() as { port?: number } | null)?.port ?? cfg.port;
    const allowed = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ]);
    if (cfg.publicUrl) allowed.add(new URL(cfg.publicUrl).origin);
    const host = req.headers.host;
    if (host) allowed.add(`https://${host}`);
    const fwdHost = req.headers['x-forwarded-host'];
    if (typeof fwdHost === 'string' && isLoopback(req.socket.remoteAddress))
      allowed.add(`https://${fwdHost}`);
    return allowed.has(origin);
  };

  const authenticate = (req: IncomingMessage): { id: string; name: string } | null => {
    const raw = readCookies(req.headers.cookie)[COOKIE_NAME];
    const secret = secrets.get().cookieSecret;
    if (!raw || !secret) return null;
    const parsed = parseCookie(secret, raw);
    if (!parsed) return null;
    const d = devices.verify(parsed.deviceId, parsed.token);
    return d ? { id: d.id, name: d.name } : null;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const https = req.headers['x-forwarded-proto'] === 'https';
    securityHeaders(res, https);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    try {
      const isApi = url.pathname.startsWith('/api/') || url.pathname === '/healthz';
      if (!isApi) {
        if (method !== 'GET' && method !== 'HEAD')
          throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        serveStatic(webDir, url.pathname, req, res);
        return;
      }
      const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
      if (!r) {
        const any = routes.some((x) => x.re.test(url.pathname));
        throw new HttpError(
          any ? 405 : 404,
          any ? 'method_not_allowed' : 'not_found',
          any ? 'Method not allowed' : 'Not found',
        );
      }
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = req.headers.origin;
        if (!origin || !allowedOrigin(req, origin)) {
          log.warn('blocked cross-origin request');
          throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
        }
      }
      const device = r.auth ? authenticate(req) : null;
      if (r.auth && !device) throw new HttpError(401, 'unauthenticated', 'Sign in required');
      const params = (r.re.exec(url.pathname) ?? []).slice(1).map((p) => decodeURIComponent(p));
      await r.h({ req, res, url, params, device });
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, code: err.code }, err.headers);
      } else if (err instanceof AgentError) {
        sendJson(res, err.status, { error: err.message, code: err.code });
      } else {
        log.error('request failed', { err, path: url.pathname.replace(/[0-9a-f-]{36}/g, ':id') });
        sendJson(res, 500, { error: 'Internal error', code: 'internal' });
      }
    }
  };

  const server = http.createServer((req, res) => void handle(req, res));
  server.headersTimeout = 30_000;
  server.requestTimeout = 0; // SSE streams stay open
  server.keepAliveTimeout = 65_000;

  let closed = false;
  return {
    server,
    paths,
    manager,
    approvals,
    store,
    config,
    secrets,
    pairing,
    devices,
    push,
    listen(port = config.get().port, host = config.get().host) {
      if (!isLoopback(host === 'localhost' ? '127.0.0.1' : host)) {
        return Promise.reject(new Error('Refusing to listen on a non-loopback address'));
      }
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const a = server.address() as { port: number; address: string };
          resolve({ port: a.port, host: a.address });
        });
      });
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      await manager.shutdown(reason);
      for (const c of [...sseClients, ...globalClients]) c.end();
      store.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      });
    },
  };
}

/** Text and tool names from a stored transcript message. */
export function flattenHistory(message: unknown): { text: string; tools: string[] } {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return { text: content, tools: [] };
  const texts: string[] = [];
  const tools: string[] = [];
  if (Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      else if (b.type === 'tool_use' && typeof b.name === 'string') tools.push(b.name);
    }
  }
  return { text: texts.join('\n\n'), tools };
}

/**
 * Projects as shown to devices: the home folder is shortened to `~` so phones,
 * screenshots and screen shares do not reveal the account name.
 */
export function displayProject(p: Project, home: string = os.homedir()): ProjectInfo {
  const rel = path.relative(home, p.path);
  const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return { id: p.id, name: p.name, path: inside ? `~${path.sep}${rel}` : p.path };
}
