// Reconnecting Server-Sent Events client.
//
// Mobile browsers (iOS Safari in particular) silently kill connections of
// pages in the background, and the built-in EventSource retry does not know
// about our `?after=<seq>` resume parameter. This wrapper owns the
// connection: it reopens with the last seen sequence number when the page
// becomes visible again, when the network comes back, when a page is restored
// from the back/forward cache, and after errors with exponential backoff.
// Events are de-duplicated by their SSE id (the event sequence number).
//
// Everything platform-specific is injected so the class can be unit tested.

export type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'closed';

export interface MessageLike {
  data: string;
  lastEventId?: string;
}

export interface EventSourceLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: MessageLike) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export type StreamEnvEvent = 'visible' | 'online' | 'offline' | 'pageshow';

/** Platform hooks. `defaultStreamEnv()` wires them to window and document. */
export interface StreamEnv {
  /** Subscribe to a lifecycle signal. Returns an unsubscribe function. */
  on(type: StreamEnvEvent, fn: () => void): () => void;
  isOnline(): boolean;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

export interface ReconnectingStreamOptions<T> {
  /** Builds the URL. `after` is the last seen sequence number, or null. */
  url: (after: number | null) => string;
  factory: EventSourceFactory;
  env: StreamEnv;
  onEvent: (data: T, seq: number | null) => void;
  onStatus?: (status: StreamStatus) => void;
  /** Called after every successful (re)open, e.g. to refresh related state. */
  onOpen?: (reconnect: boolean) => void;
  /** Called on every connection error with the consecutive failure count. */
  onError?: (failures: number) => void;
  /** Sequence number to resume after on the first connect. */
  initialAfter?: number | null;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export class ReconnectingStream<T = unknown> {
  private readonly opts: ReconnectingStreamOptions<T>;
  private source: EventSourceLike | null = null;
  private timer: unknown = null;
  private failures = 0;
  private opened = false;
  private stopped = true;
  private readonly seen = new Set<number>();
  private _lastSeq: number | null;
  /** Events at or below the initial resume point were already handled elsewhere. */
  private readonly floor: number | null;
  private _status: StreamStatus = 'closed';
  private unsubs: (() => void)[] = [];

  constructor(opts: ReconnectingStreamOptions<T>) {
    this.opts = opts;
    this._lastSeq = opts.initialAfter ?? null;
    this.floor = this._lastSeq;
  }

  get lastSeq(): number | null {
    return this._lastSeq;
  }

  get status(): StreamStatus {
    return this._status;
  }

  /** Current backoff delay for the given failure count (before jitter). */
  static backoff(failures: number, min = 1000, max = 30000): number {
    return Math.min(max, min * 2 ** Math.max(0, failures - 1));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const { env } = this.opts;
    this.unsubs = [
      env.on('visible', () => this.reconnectNow()),
      env.on('pageshow', () => this.reconnectNow()),
      env.on('online', () => this.reconnectNow()),
      env.on('offline', () => this.goOffline()),
    ];
    if (env.isOnline()) this.open();
    else this.goOffline();
  }

  stop(): void {
    this.stopped = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.cancelTimer();
    this.closeSource();
    this.setStatus('closed');
  }

  /** Close the current connection and reopen immediately with `after=lastSeq`. */
  reconnectNow(): void {
    if (this.stopped) return;
    if (!this.opts.env.isOnline()) {
      this.goOffline();
      return;
    }
    this.cancelTimer();
    this.failures = 0;
    this.open();
  }

  private open(): void {
    this.closeSource();
    this.setStatus(this.opened ? 'reconnecting' : 'connecting');
    const src = this.opts.factory(this.opts.url(this._lastSeq));
    this.source = src;
    src.onopen = () => {
      if (src !== this.source) return;
      const reconnect = this.opened;
      this.opened = true;
      this.failures = 0;
      this.setStatus('connected');
      this.opts.onOpen?.(reconnect);
    };
    src.onmessage = (ev) => {
      if (src !== this.source) return;
      this.handleMessage(ev);
    };
    src.onerror = () => {
      if (src !== this.source) return;
      this.handleError();
    };
  }

  private handleMessage(ev: MessageLike): void {
    let seq: number | null = null;
    if (ev.lastEventId) {
      const n = Number(ev.lastEventId);
      if (Number.isFinite(n)) seq = n;
    }
    if (seq !== null) {
      if (this.seen.has(seq) || (this.floor !== null && seq <= this.floor)) return;
      this.seen.add(seq);
      if (this._lastSeq === null || seq > this._lastSeq) this._lastSeq = seq;
    }
    let data: T;
    try {
      data = JSON.parse(ev.data) as T;
    } catch {
      return;
    }
    this.opts.onEvent(data, seq);
  }

  private handleError(): void {
    // Take over retrying from the browser so we can resume with ?after=.
    this.closeSource();
    if (this.stopped) return;
    if (!this.opts.env.isOnline()) {
      this.goOffline();
      return;
    }
    this.failures++;
    this.opts.onError?.(this.failures);
    this.setStatus('reconnecting');
    const { minDelayMs = 1000, maxDelayMs = 30000 } = this.opts;
    const base = ReconnectingStream.backoff(this.failures, minDelayMs, maxDelayMs);
    const delay = Math.round(base * (0.75 + this.opts.env.random() * 0.5));
    this.cancelTimer();
    this.timer = this.opts.env.setTimeout(
      () => {
        this.timer = null;
        if (!this.stopped) this.open();
      },
      Math.min(delay, maxDelayMs),
    );
  }

  private goOffline(): void {
    this.cancelTimer();
    this.closeSource();
    if (!this.stopped) this.setStatus('offline');
  }

  private closeSource(): void {
    const src = this.source;
    this.source = null;
    if (src) {
      src.onopen = null;
      src.onmessage = null;
      src.onerror = null;
      src.close();
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.opts.env.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setStatus(s: StreamStatus): void {
    if (s === this._status) return;
    this._status = s;
    this.opts.onStatus?.(s);
  }
}

/** Wires StreamEnv to the real browser window and document. */
export function defaultStreamEnv(win: Window = window, doc: Document = document): StreamEnv {
  return {
    on(type, fn) {
      if (type === 'visible') {
        const h = () => {
          if (doc.visibilityState === 'visible') fn();
        };
        doc.addEventListener('visibilitychange', h);
        return () => doc.removeEventListener('visibilitychange', h);
      }
      if (type === 'pageshow') {
        const h = (ev: PageTransitionEvent) => {
          if (ev.persisted) fn();
        };
        win.addEventListener('pageshow', h);
        return () => win.removeEventListener('pageshow', h);
      }
      win.addEventListener(type, fn);
      return () => win.removeEventListener(type, fn);
    },
    isOnline: () => win.navigator.onLine !== false,
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (handle) => win.clearTimeout(handle as number),
    random: () => Math.random(),
  };
}

export const browserEventSource: EventSourceFactory = (url) =>
  new EventSource(url, { withCredentials: true }) as unknown as EventSourceLike;
