import fs from 'node:fs';
import path from 'node:path';
import type { EventPayloads, EventType, SessionEvent } from '../shared/api.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';

export type Listener = (ev: SessionEvent) => void;

/** Events whose loss would be most visible are flushed to disk immediately. */
const DURABLE: ReadonlySet<EventType> = new Set([
  'session.created',
  'user.message',
  'assistant.message',
  'approval.request',
  'approval.resolved',
  'run.finished',
  'mode.changed',
]);

export interface LoadReport {
  events: number;
  truncatedBytes: number;
  skippedLines: number;
}

/**
 * Append-only, per-session event log stored as JSON Lines.
 * Every event gets a monotonic sequence number starting at 1.
 */
export class EventLog {
  private events: SessionEvent[] = [];
  private fd: number | null = null;
  private listeners = new Set<Listener>();
  readonly report: LoadReport;

  constructor(
    readonly file: string,
    private readonly log: Logger = silentLogger,
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.report = this.load();
  }

  /** Load the log, repairing a truncated or corrupt tail left by a crash. */
  private load(): LoadReport {
    const report: LoadReport = { events: 0, truncatedBytes: 0, skippedLines: 0 };
    let buf: Buffer;
    try {
      buf = fs.readFileSync(this.file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return report;
      throw err;
    }
    let pos = 0;
    let goodEnd = 0;
    let lastSeq = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      if (nl === -1) break; // incomplete final line
      const line = buf.subarray(pos, nl).toString('utf8').trim();
      pos = nl + 1;
      if (!line) {
        goodEnd = pos;
        continue;
      }
      const ev = parseEvent(line);
      if (!ev || ev.seq <= lastSeq) {
        report.skippedLines++;
        goodEnd = pos;
        continue;
      }
      lastSeq = ev.seq;
      this.events.push(ev);
      goodEnd = pos;
    }
    if (goodEnd < buf.length) {
      report.truncatedBytes = buf.length - goodEnd;
      fs.truncateSync(this.file, goodEnd);
      this.log.warn('repaired truncated event log', { bytes: report.truncatedBytes });
    }
    if (report.skippedLines)
      this.log.warn('skipped invalid event log lines', { lines: report.skippedLines });
    report.events = this.events.length;
    return report;
  }

  get lastSeq(): number {
    return this.events.at(-1)?.seq ?? 0;
  }

  get size(): number {
    return this.events.length;
  }

  append<K extends EventType>(type: K, data: EventPayloads[K]): SessionEvent {
    const ev = { seq: this.lastSeq + 1, ts: new Date().toISOString(), type, data } as SessionEvent;
    if (this.fd === null) this.fd = fs.openSync(this.file, 'a', 0o600);
    fs.writeSync(this.fd, JSON.stringify(ev) + '\n');
    if (DURABLE.has(type)) fs.fsyncSync(this.fd);
    this.events.push(ev);
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (err) {
        this.log.error('event listener failed', { err });
      }
    }
    return ev;
  }

  /** Events with seq greater than `after`. */
  since(after: number): SessionEvent[] {
    if (after <= 0) return this.events.slice();
    // Sequence numbers are dense from 1 unless lines were skipped; binary search to be safe.
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid]!.seq <= after) lo = mid + 1;
      else hi = mid;
    }
    return this.events.slice(lo);
  }

  all(): readonly SessionEvent[] {
    return this.events;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    if (this.fd !== null) {
      try {
        fs.fsyncSync(this.fd);
      } catch {
        /* ignore */
      }
      fs.closeSync(this.fd);
    }
    this.fd = null;
    this.listeners.clear();
  }
}

function parseEvent(line: string): SessionEvent | null {
  try {
    const v = JSON.parse(line) as Partial<SessionEvent>;
    if (
      typeof v.seq === 'number' &&
      Number.isInteger(v.seq) &&
      v.seq > 0 &&
      typeof v.type === 'string' &&
      typeof v.ts === 'string' &&
      v.data &&
      typeof v.data === 'object'
    ) {
      return v as SessionEvent;
    }
  } catch {
    /* invalid */
  }
  return null;
}
