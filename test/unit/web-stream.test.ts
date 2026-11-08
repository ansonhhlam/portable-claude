import { describe, expect, it } from 'vitest';
import {
  ReconnectingStream,
  type EventSourceLike,
  type MessageLike,
  type StreamEnv,
  type StreamEnvEvent,
  type StreamStatus,
} from '../../src/web/stream.js';

class FakeSource implements EventSourceLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: MessageLike) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.({});
  }
  send(seq: number | null, data: unknown): void {
    this.onmessage?.({
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: seq === null ? '' : String(seq),
    });
  }
  fail(): void {
    this.onerror?.({});
  }
}

class FakeEnv implements StreamEnv {
  online = true;
  rand = 0.5;
  timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  private listeners = new Map<StreamEnvEvent, Set<() => void>>();
  on(type: StreamEnvEvent, fn: () => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }
  emit(type: StreamEnvEvent): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  isOnline(): boolean {
    return this.online;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const t = { fn, ms, cleared: false };
    this.timers.push(t);
    return t;
  }
  clearTimeout(handle: unknown): void {
    (handle as { cleared: boolean }).cleared = true;
  }
  random(): number {
    return this.rand;
  }
  /** Runs the most recent pending timer. */
  fireTimer(): number {
    const t = [...this.timers].reverse().find((x) => !x.cleared);
    if (!t) throw new Error('no pending timer');
    t.cleared = true;
    t.fn();
    return t.ms;
  }
  pendingTimers(): number {
    return this.timers.filter((t) => !t.cleared).length;
  }
}

interface Ev {
  seq: number;
  n?: number;
}

function setup(opts: { initialAfter?: number | null } = {}) {
  const env = new FakeEnv();
  const sources: FakeSource[] = [];
  const events: { data: Ev; seq: number | null }[] = [];
  const statuses: StreamStatus[] = [];
  const opens: boolean[] = [];
  const errors: number[] = [];
  const stream = new ReconnectingStream<Ev>({
    url: (after) => (after === null ? '/events' : `/events?after=${after}`),
    factory: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    env,
    onEvent: (data, seq) => events.push({ data, seq }),
    onStatus: (s) => statuses.push(s),
    onOpen: (reconnect) => opens.push(reconnect),
    onError: (n) => errors.push(n),
    initialAfter: opts.initialAfter ?? null,
  });
  const last = () => {
    const s = sources[sources.length - 1];
    if (!s) throw new Error('no source');
    return s;
  };
  return { env, sources, events, statuses, opens, errors, stream, last };
}

describe('ReconnectingStream', () => {
  it('connects without ?after on first start and reports status', () => {
    const t = setup();
    t.stream.start();
    expect(t.sources).toHaveLength(1);
    expect(t.last().url).toBe('/events');
    expect(t.stream.status).toBe('connecting');
    t.last().open();
    expect(t.stream.status).toBe('connected');
    expect(t.opens).toEqual([false]);
  });

  it('delivers parsed events and tracks lastSeq', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(1, { seq: 1 });
    t.last().send(2, { seq: 2 });
    expect(t.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(t.events[0]?.data).toEqual({ seq: 1 });
    expect(t.stream.lastSeq).toBe(2);
  });

  it('ignores replayed duplicates after a reconnect', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(1, { seq: 1 });
    t.last().send(2, { seq: 2 });
    t.last().fail();
    t.env.fireTimer();
    expect(t.last().url).toBe('/events?after=2');
    t.last().open();
    // A server may replay an event that was already delivered.
    t.last().send(2, { seq: 2 });
    t.last().send(3, { seq: 3 });
    t.last().send(3, { seq: 3 });
    expect(t.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(t.stream.lastSeq).toBe(3);
  });

  it('skips events at or below initialAfter', () => {
    const t = setup({ initialAfter: 5 });
    t.stream.start();
    expect(t.last().url).toBe('/events?after=5');
    t.last().open();
    t.last().send(4, { seq: 4 });
    t.last().send(5, { seq: 5 });
    t.last().send(6, { seq: 6 });
    expect(t.events.map((e) => e.seq)).toEqual([6]);
  });

  it('passes events without an id through with seq null', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(null, { seq: 0, n: 1 });
    t.last().send(null, { seq: 0, n: 1 });
    expect(t.events).toHaveLength(2);
    expect(t.events[0]?.seq).toBeNull();
    expect(t.stream.lastSeq).toBeNull();
  });

  it('ignores messages that are not JSON', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(1, 'not json {');
    expect(t.events).toHaveLength(0);
  });

  it('reconnects immediately with ?after=lastSeq when the page becomes visible again', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(7, { seq: 7 });
    // The browser killed the connection while the page was in the background.
    const dead = t.last();
    dead.fail();
    expect(dead.closed).toBe(true);
    expect(t.env.pendingTimers()).toBe(1);

    t.env.emit('visible');
    expect(t.sources).toHaveLength(2);
    expect(t.last().url).toBe('/events?after=7');
    // The pending backoff timer was cancelled, so no second connection appears.
    expect(t.env.pendingTimers()).toBe(0);
    t.last().open();
    expect(t.stream.status).toBe('connected');
    expect(t.opens).toEqual([false, true]);
  });

  it('closes a still-open connection and reopens on visible', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(3, { seq: 3 });
    const first = t.last();
    t.env.emit('visible');
    expect(first.closed).toBe(true);
    expect(first.onmessage).toBeNull();
    expect(t.last().url).toBe('/events?after=3');
  });

  it('ignores callbacks from a replaced connection', () => {
    const t = setup();
    t.stream.start();
    const first = t.last();
    first.open();
    t.env.emit('visible');
    // Even if the old object still fires, nothing reaches the consumer.
    first.onmessage?.({ data: '{"seq":9}', lastEventId: '9' });
    expect(t.events).toHaveLength(0);
  });

  it.each<StreamEnvEvent>(['online', 'pageshow'])('reconnects on %s', (type) => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(4, { seq: 4 });
    t.env.emit(type);
    expect(t.sources).toHaveLength(2);
    expect(t.last().url).toBe('/events?after=4');
  });

  it('goes offline without retrying, and reconnects when back online', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(1, { seq: 1 });
    t.env.online = false;
    t.env.emit('offline');
    expect(t.stream.status).toBe('offline');
    expect(t.last().closed).toBe(true);
    // Errors while offline do not schedule retries.
    t.env.emit('visible');
    expect(t.sources).toHaveLength(1);
    expect(t.env.pendingTimers()).toBe(0);

    t.env.online = true;
    t.env.emit('online');
    expect(t.sources).toHaveLength(2);
    expect(t.last().url).toBe('/events?after=1');
    expect(t.stream.status).toBe('reconnecting');
    t.last().open();
    expect(t.stream.status).toBe('connected');
  });

  it('starts offline when the network is down', () => {
    const t = setup();
    t.env.online = false;
    t.stream.start();
    expect(t.sources).toHaveLength(0);
    expect(t.stream.status).toBe('offline');
  });

  it('backs off exponentially up to the cap and resets after a successful open', () => {
    const t = setup();
    t.stream.start();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      t.last().fail();
      delays.push(t.env.fireTimer());
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(t.errors).toEqual([1, 2, 3, 4, 5, 6, 7]);

    t.last().open();
    t.last().fail();
    expect(t.env.fireTimer()).toBe(1000);
  });

  it('applies jitter around the base delay', () => {
    const t = setup();
    t.stream.start();
    t.env.rand = 0;
    t.last().fail();
    expect(t.env.fireTimer()).toBe(750);
    t.env.rand = 1;
    t.last().fail();
    expect(t.env.fireTimer()).toBe(2500);
  });

  it('computes the base backoff', () => {
    expect(ReconnectingStream.backoff(1)).toBe(1000);
    expect(ReconnectingStream.backoff(2)).toBe(2000);
    expect(ReconnectingStream.backoff(5)).toBe(16000);
    expect(ReconnectingStream.backoff(6)).toBe(30000);
    expect(ReconnectingStream.backoff(50)).toBe(30000);
    expect(ReconnectingStream.backoff(3, 500, 1500)).toBe(1500);
  });

  it('reports status transitions in order', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().fail();
    t.env.fireTimer();
    t.last().open();
    t.stream.stop();
    expect(t.statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected', 'closed']);
  });

  it('stop closes the connection, cancels timers and removes listeners', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().fail();
    expect(t.env.pendingTimers()).toBe(1);
    t.stream.stop();
    expect(t.env.pendingTimers()).toBe(0);
    expect(t.env.listenerCount()).toBe(0);
    expect(t.stream.status).toBe('closed');
    t.env.emit('visible');
    expect(t.sources).toHaveLength(1);
  });

  it('can be started again after stop and resumes after lastSeq', () => {
    const t = setup();
    t.stream.start();
    t.last().open();
    t.last().send(2, { seq: 2 });
    t.stream.stop();
    t.stream.start();
    expect(t.last().url).toBe('/events?after=2');
  });
});
