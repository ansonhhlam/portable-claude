import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PERMISSION_MODES } from '../shared/api.js';
import { EventLog } from './eventlog.js';
import { readJsonSync, writeJsonAtomicSync } from './fsutil.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';

export const SessionMetaSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  projectId: z.string(),
  cwd: z.string(),
  mode: z.enum(PERMISSION_MODES),
  model: z.string().nullable(),
  sdkSessionId: z.string().nullable(),
  archived: z.boolean(),
  imported: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  preview: z.string(),
  totals: z.object({
    costUsd: z.number(),
    durationMs: z.number(),
    turns: z.number(),
    runs: z.number(),
  }),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;

export type NewSession = Pick<SessionMeta, 'title' | 'projectId' | 'cwd' | 'mode' | 'model'> &
  Partial<Pick<SessionMeta, 'sdkSessionId' | 'imported'>>;

const ID_RE = /^[0-9a-f-]{36}$/;

/** Stores session metadata (meta.json) and event logs (events.jsonl) under one directory. */
export class SessionStore {
  private metas = new Map<string, SessionMeta>();
  private logs = new Map<string, EventLog>();

  constructor(
    readonly dir: string,
    private readonly log: Logger = silentLogger,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    for (const id of fs.readdirSync(dir)) {
      if (!ID_RE.test(id)) continue;
      try {
        const meta = readJsonSync(this.metaFile(id), SessionMetaSchema, () => {
          throw new Error('missing meta.json');
        });
        this.metas.set(id, meta);
      } catch (err) {
        this.log.warn('skipping unreadable session', { session: id, err });
      }
    }
  }

  private metaFile(id: string): string {
    return path.join(this.dir, id, 'meta.json');
  }

  list(): SessionMeta[] {
    return [...this.metas.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): SessionMeta | undefined {
    return ID_RE.test(id) ? this.metas.get(id) : undefined;
  }

  findBySdkSession(sdkSessionId: string): SessionMeta | undefined {
    return [...this.metas.values()].find((m) => m.sdkSessionId === sdkSessionId);
  }

  create(input: NewSession): SessionMeta {
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: randomUUID(),
      title: input.title,
      projectId: input.projectId,
      cwd: input.cwd,
      mode: input.mode,
      model: input.model,
      sdkSessionId: input.sdkSessionId ?? null,
      archived: false,
      imported: input.imported ?? false,
      createdAt: now,
      updatedAt: now,
      preview: '',
      totals: { costUsd: 0, durationMs: 0, turns: 0, runs: 0 },
    };
    this.save(meta);
    return meta;
  }

  update(id: string, patch: Partial<SessionMeta> | ((m: SessionMeta) => void)): SessionMeta {
    const cur = this.metas.get(id);
    if (!cur) throw new Error('No such session');
    const next = structuredClone(cur);
    if (typeof patch === 'function') patch(next);
    else Object.assign(next, patch);
    next.id = cur.id;
    next.updatedAt = new Date().toISOString();
    this.save(next);
    return next;
  }

  private save(meta: SessionMeta): void {
    SessionMetaSchema.parse(meta);
    writeJsonAtomicSync(this.metaFile(meta.id), meta);
    this.metas.set(meta.id, meta);
  }

  events(id: string): EventLog {
    let l = this.logs.get(id);
    if (!l) {
      if (!this.metas.has(id)) throw new Error('No such session');
      l = new EventLog(path.join(this.dir, id, 'events.jsonl'), this.log.child({ session: id }));
      this.logs.set(id, l);
    }
    return l;
  }

  delete(id: string): void {
    this.logs.get(id)?.close();
    this.logs.delete(id);
    this.metas.delete(id);
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
  }

  close(): void {
    for (const l of this.logs.values()) l.close();
    this.logs.clear();
  }
}
