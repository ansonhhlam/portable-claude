import { randomUUID } from 'node:crypto';
import type { PermissionModeName, SessionState } from '../shared/api.js';
import { Approvals } from './approvals.js';
import type { Config } from './config.js';
import type { AgentEnvResult } from './credentials.js';
import type { EventLog } from './eventlog.js';
import type { Logger } from './logger.js';
import { AsyncQueue } from './queue.js';
import type { AgentQuery, AgentSdk, Options, SDKMessage, SDKUserMessage } from './sdk/types.js';
import type { SessionMeta, SessionStore } from './sessions.js';
import type { SpendTracker } from './spend.js';
import { summarizeTool, toolResultText, truncate } from './summarize.js';

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export interface RunnerHooks {
  sessionChanged(sessionId: string): void;
  runFinished(meta: SessionMeta, ok: boolean, errors: string[]): void;
  capReached(todayUsd: number, capUsd: number): void;
}

export interface AgentManagerDeps {
  sdk: AgentSdk;
  store: SessionStore;
  approvals: Approvals;
  spend: SpendTracker;
  config: () => Config;
  agentEnv: () => AgentEnvResult;
  log: Logger;
  hooks: RunnerHooks;
  /** How long to wait for a result after an interrupt before forcing the run closed. */
  interruptGraceMs?: number;
}

/** Owns one agent runner per active session. */
export class AgentManager {
  private runners = new Map<string, Runner>();
  private shuttingDown = false;

  constructor(private readonly deps: AgentManagerDeps) {}

  private runner(id: string): Runner {
    let r = this.runners.get(id);
    if (!r) {
      if (!this.deps.store.get(id)) throw new AgentError('not_found', 'Session not found', 404);
      r = new Runner(id, this.deps);
      this.runners.set(id, r);
    }
    return r;
  }

  state(id: string): SessionState {
    return this.runners.get(id)?.state ?? 'idle';
  }

  /** True if the session currently has a live agent process. */
  isLive(id: string): boolean {
    return this.runners.get(id)?.live ?? false;
  }

  send(id: string, text: string): void {
    if (this.shuttingDown)
      throw new AgentError('shutting_down', 'The server is shutting down', 503);
    this.runner(id).send(text);
  }

  async interrupt(id: string): Promise<void> {
    await this.runners.get(id)?.interrupt();
  }

  async setMode(id: string, mode: PermissionModeName): Promise<void> {
    await this.runner(id).setMode(mode);
  }

  /** Stop the agent process for a session (it resumes on the next message). */
  async release(id: string): Promise<void> {
    await this.runners.get(id)?.release();
  }

  async remove(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (r) {
      this.deps.approvals.abortSession(id, 'Session deleted');
      await r.release();
      this.runners.delete(id);
    }
  }

  /**
   * After a restart, close anything a previous process left open in the logs:
   * pending approvals become expired, and an unfinished run is marked stopped.
   */
  recover(): void {
    for (const meta of this.deps.store.list()) {
      const log = this.deps.store.events(meta.id);
      Approvals.expireStale(log, (aid) => this.deps.approvals.pendingFor(meta.id).includes(aid));
      const lastState = [...log.all()].reverse().find((e) => e.type === 'state');
      if (lastState && lastState.type === 'state' && lastState.data.state !== 'idle') {
        log.append('notice', {
          level: 'warn',
          message: 'The server restarted while the agent was working. Send a message to continue.',
        });
        log.append('state', { state: 'idle' });
      }
    }
  }

  async shutdown(reason = 'The server is shutting down'): Promise<void> {
    this.shuttingDown = true;
    this.deps.approvals.denyAll(reason);
    await Promise.all([...this.runners.values()].map((r) => r.release()));
  }
}

type PendingText = { text: string; parent: string | null };

class Runner {
  state: SessionState = 'idle';
  private query: AgentQuery | null = null;
  private input: AsyncQueue<SDKUserMessage> | null = null;
  private loop: Promise<void> | null = null;
  private runId: string | null = null;
  private costSeen = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private interruptTimer: NodeJS.Timeout | null = null;
  private assistantText = new Map<string, string>();
  private streamMsg = new Map<string, string>();
  private deltas = new Map<string, PendingText>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly log: EventLog;
  private readonly logger: Logger;

  constructor(
    readonly id: string,
    private readonly deps: AgentManagerDeps,
  ) {
    this.log = deps.store.events(id);
    this.logger = deps.log.child({ session: id });
  }

  get live(): boolean {
    return this.query !== null;
  }

  private get meta(): SessionMeta {
    const m = this.deps.store.get(this.id);
    if (!m) throw new AgentError('not_found', 'Session not found', 404);
    return m;
  }

  private setState(s: SessionState): void {
    if (this.state === s) return;
    this.state = s;
    this.log.append('state', { state: s });
    this.deps.hooks.sessionChanged(this.id);
  }

  private start(): void {
    const envRes = this.deps.agentEnv();
    if (!envRes.ok) throw new AgentError('no_credentials', envRes.error, 409);
    const cfg = this.deps.config();
    const meta = this.meta;
    const input = new AsyncQueue<SDKUserMessage>();
    const model = meta.model ?? cfg.defaultModel;
    const options: Options = {
      cwd: meta.cwd,
      permissionMode: meta.mode,
      allowDangerouslySkipPermissions: meta.mode === 'bypassPermissions',
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      env: envRes.env,
      canUseTool: async (toolName, toolInput, o) => {
        this.setState('waiting');
        try {
          return await this.deps.approvals.request(this.id, this.log, toolName, toolInput, {
            signal: o.signal,
            ...(o.suggestions ? { suggestions: o.suggestions } : {}),
            toolUseID: o.toolUseID,
            ...(o.agentID ? { agentID: o.agentID } : {}),
            ...(o.title ? { title: o.title } : {}),
            ...(o.suppressAlwaysAllowRule ? { suppressAlwaysAllowRule: true } : {}),
          });
        } finally {
          if (this.deps.approvals.pendingFor(this.id).length === 0 && this.state === 'waiting') {
            this.setState(this.runId ? 'working' : 'idle');
          }
        }
      },
      stderr: (data) => this.logger.debug('agent stderr', { bytes: data.length }),
      ...(model ? { model } : {}),
      ...(meta.sdkSessionId ? { resume: meta.sdkSessionId } : {}),
    };
    this.costSeen = meta.sdkSessionId ? meta.totals.costUsd : 0;
    this.input = input;
    this.query = this.deps.sdk.query({ prompt: input, options });
    this.logger.info('agent started', { resume: !!meta.sdkSessionId, mode: meta.mode });
    const q = this.query;
    this.loop = this.consume(q).finally(() => {
      if (this.query === q) {
        this.query = null;
        this.input = null;
      }
    });
  }

  private async consume(q: AgentQuery): Promise<void> {
    try {
      for await (const m of q) this.handle(m);
    } catch (err) {
      if (this.query === q) {
        this.logger.error('agent stopped with an error', { err });
        this.log.append('notice', {
          level: 'error',
          message: `The agent stopped: ${String((err as Error)?.message ?? err)}`,
        });
      }
    } finally {
      this.flush();
      if (this.runId)
        this.finishRun({
          isError: true,
          subtype: 'stopped',
          costUsd: 0,
          durationMs: 0,
          turns: 0,
          errors: ['The agent process ended'],
        });
      if (this.deps.approvals.pendingFor(this.id).length)
        this.deps.approvals.abortSession(this.id, 'Agent stopped');
      this.setState('idle');
    }
  }

  private handle(m: SDKMessage): void {
    switch (m.type) {
      case 'system': {
        if (m.subtype === 'init' && m.session_id && m.session_id !== this.meta.sdkSessionId) {
          this.deps.store.update(this.id, { sdkSessionId: m.session_id });
        }
        return;
      }
      case 'stream_event': {
        this.ensureRun();
        const parent = m.parent_tool_use_id ?? null;
        const key = parent ?? '';
        const ev = m.event as unknown as Record<string, unknown> & { type: string };
        if (ev.type === 'message_start') {
          const msg = ev.message as { id?: string } | undefined;
          if (msg?.id) this.streamMsg.set(key, msg.id);
        } else if (ev.type === 'content_block_start') {
          const block = ev.content_block as { type?: string } | undefined;
          const id = this.streamMsg.get(key);
          if (block?.type === 'text' && id && this.assistantText.get(id))
            this.bufferDelta(id, '\n\n', parent);
        } else if (ev.type === 'content_block_delta') {
          const delta = ev.delta as { type?: string; text?: string } | undefined;
          const id = this.streamMsg.get(key);
          if (delta?.type === 'text_delta' && delta.text && id)
            this.bufferDelta(id, delta.text, parent);
        }
        return;
      }
      case 'assistant': {
        this.ensureRun();
        const parent = m.parent_tool_use_id ?? null;
        const msg = m.message as unknown as { id: string; content: unknown };
        this.flush();
        for (const block of Array.isArray(msg.content)
          ? (msg.content as Record<string, unknown>[])
          : []) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            const prev = this.assistantText.get(msg.id);
            const text = prev ? `${prev}\n\n${block.text}` : block.text;
            this.assistantText.set(msg.id, text);
            this.log.append('assistant.message', {
              messageId: msg.id,
              text,
              parentToolUseId: parent,
            });
            if (!parent) this.setPreview(text);
          } else if (
            block.type === 'tool_use' &&
            typeof block.id === 'string' &&
            typeof block.name === 'string'
          ) {
            const input = (block.input ?? {}) as Record<string, unknown>;
            this.log.append('tool.start', {
              toolUseId: block.id,
              name: block.name,
              summary: summarizeTool(block.name, input),
              parentToolUseId: parent,
            });
          }
        }
        return;
      }
      case 'user': {
        const content = (m.message as { content?: unknown }).content;
        if (!Array.isArray(content)) return;
        for (const block of content as Record<string, unknown>[]) {
          if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
          const { text, truncated } = truncate(
            toolResultText(block.content),
            this.deps.config().maxToolOutputChars,
          );
          this.log.append('tool.end', {
            toolUseId: block.tool_use_id,
            isError: block.is_error === true,
            output: text,
            truncated,
          });
        }
        return;
      }
      case 'result': {
        this.flush();
        const total = m.total_cost_usd ?? 0;
        const delta = total >= this.costSeen ? total - this.costSeen : total;
        this.costSeen = total;
        this.finishRun({
          isError: m.is_error || m.subtype !== 'success',
          subtype: m.subtype,
          costUsd: Number(delta.toFixed(6)),
          durationMs: m.duration_ms ?? 0,
          turns: m.num_turns ?? 0,
          errors: 'errors' in m && Array.isArray(m.errors) ? m.errors.map(String) : [],
        });
        if (this.input && this.input.pending > 0) this.ensureRun();
        else this.setState('idle');
        this.scheduleIdle();
        return;
      }
      default:
        return;
    }
  }

  private ensureRun(): void {
    if (this.runId) return;
    this.runId = randomUUID();
    this.log.append('run.started', { runId: this.runId });
    if (this.state !== 'waiting') this.setState('working');
  }

  private finishRun(r: {
    isError: boolean;
    subtype: string;
    costUsd: number;
    durationMs: number;
    turns: number;
    errors: string[];
  }): void {
    const runId = this.runId ?? randomUUID();
    this.runId = null;
    if (this.interruptTimer) clearTimeout(this.interruptTimer);
    this.interruptTimer = null;
    this.log.append('run.finished', { runId, ...r });
    const meta = this.deps.store.update(this.id, (mm) => {
      mm.totals.costUsd = Number((mm.totals.costUsd + r.costUsd).toFixed(6));
      mm.totals.durationMs += r.durationMs;
      mm.totals.turns += r.turns;
      mm.totals.runs += 1;
    });
    this.deps.spend.add(r.costUsd);
    this.deps.hooks.runFinished(meta, !r.isError, r.errors);
    const cap = this.deps.config().dailySpendCapUsd;
    if (this.deps.spend.shouldNotifyCap(cap))
      this.deps.hooks.capReached(this.deps.spend.today(), cap!);
    this.deps.hooks.sessionChanged(this.id);
  }

  private bufferDelta(id: string, text: string, parent: string | null): void {
    const cur = this.deltas.get(id);
    if (cur) cur.text += text;
    else this.deltas.set(id, { text, parent });
    this.flushTimer ??= setTimeout(() => this.flush(), 100);
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const [id, d] of this.deltas) {
      this.log.append('assistant.delta', {
        messageId: id,
        text: d.text,
        parentToolUseId: d.parent,
      });
    }
    this.deltas.clear();
  }

  private setPreview(text: string): void {
    this.deps.store.update(this.id, { preview: plainPreview(text) });
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const ms = this.deps.config().idleTimeoutMinutes * 60_000;
    this.idleTimer = setTimeout(() => {
      if (this.state === 'idle' && this.deps.approvals.pendingFor(this.id).length === 0) {
        this.logger.info('releasing idle agent');
        void this.release();
      }
    }, ms);
    this.idleTimer.unref();
  }

  send(text: string): void {
    const clean = text.trim();
    if (!clean) throw new AgentError('empty', 'Message is empty');
    const cfg = this.deps.config();
    if (this.deps.spend.capReached(cfg.dailySpendCapUsd)) {
      throw new AgentError(
        'spend_cap',
        `The daily spend cap of $${cfg.dailySpendCapUsd?.toFixed(2)} has been reached. Raise it with \`longcord config set dailySpendCapUsd <amount>\` or wait until tomorrow.`,
        429,
      );
    }
    if (!this.query || !this.input || this.input.isEnded) this.start();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const queued = this.state !== 'idle';
    this.log.append('user.message', { text: clean, queued });
    this.deps.store.update(this.id, { preview: clean.slice(0, 160) });
    this.ensureRun();
    this.input!.push({
      type: 'user',
      message: { role: 'user', content: clean },
      parent_tool_use_id: null,
    });
    this.deps.hooks.sessionChanged(this.id);
  }

  async interrupt(): Promise<void> {
    this.deps.approvals.abortSession(this.id, 'Interrupted by the user');
    if (!this.query) return;
    try {
      await this.query.interrupt();
    } catch (err) {
      this.logger.warn('interrupt failed', { err });
    }
    if (this.runId && !this.interruptTimer) {
      this.interruptTimer = setTimeout(() => {
        this.interruptTimer = null;
        if (!this.runId) return;
        this.flush();
        this.finishRun({
          isError: true,
          subtype: 'interrupted',
          costUsd: 0,
          durationMs: 0,
          turns: 0,
          errors: ['Interrupted by the user'],
        });
        this.setState('idle');
      }, this.deps.interruptGraceMs ?? 5000);
    }
  }

  async setMode(mode: PermissionModeName): Promise<void> {
    const prev = this.meta.mode;
    if (prev === mode) return;
    this.deps.store.update(this.id, { mode });
    this.log.append('mode.changed', { mode });
    this.deps.hooks.sessionChanged(this.id);
    if (!this.query) return;
    const needsRestart = mode === 'bypassPermissions' && prev !== 'bypassPermissions';
    try {
      await this.query.setPermissionMode(mode);
    } catch (err) {
      this.logger.warn('live mode change failed; the agent restarts on the next message', { err });
      if (this.state === 'idle') await this.release();
      return;
    }
    // A process started without the bypass safety flag is restarted when idle
    // so the new mode takes effect for every tool.
    if (needsRestart && this.state === 'idle') await this.release();
  }

  async release(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const q = this.query;
    const loop = this.loop;
    this.query = null;
    this.input?.end();
    this.input = null;
    if (!q) return;
    try {
      q.close();
    } catch (err) {
      this.logger.warn('close failed', { err });
    }
    if (loop) {
      await Promise.race([loop, new Promise((r) => setTimeout(r, 3000).unref())]);
    }
    this.flush();
    if (this.runId) {
      this.finishRun({
        isError: true,
        subtype: 'stopped',
        costUsd: 0,
        durationMs: 0,
        turns: 0,
        errors: ['The agent was stopped'],
      });
    }
    this.setState('idle');
    this.logger.info('agent released');
  }
}

/** One line of plain text for list previews: Markdown markers removed. */
export function plainPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
