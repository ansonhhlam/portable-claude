// Shared app state: server state cache, connection status, navigation,
// toasts and screen reader announcements.
import type { StateResponse } from '../shared/api.js';
import { api, ApiRequestError, errorMessage } from './api.js';
import type { StreamStatus } from './stream.js';

/** Collects cleanup functions for a view. */
export class Scope {
  private fns: (() => void)[] = [];
  add(fn: () => void): void {
    this.fns.push(fn);
  }
  dispose(): void {
    const fns = this.fns;
    this.fns = [];
    for (const fn of fns.reverse()) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }
}

export interface View {
  el: HTMLElement;
  /** Element to focus after navigation (defaults to the main heading). */
  focus?: HTMLElement;
  destroy?: () => void;
}

// ------------------------------------------------------------ server state
let state: StateResponse | null = null;
const stateListeners = new Set<(s: StateResponse) => void>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<StateResponse | null> | null = null;

export function getState(): StateResponse | null {
  return state;
}

export function subscribeState(scope: Scope, fn: (s: StateResponse) => void): void {
  stateListeners.add(fn);
  scope.add(() => stateListeners.delete(fn));
  if (state) fn(state);
}

export function refreshState(): Promise<StateResponse | null> {
  if (inflight) return inflight;
  inflight = api
    .state()
    .then((s) => {
      state = s;
      for (const fn of stateListeners) fn(s);
      return s;
    })
    .catch((err: unknown) => {
      if (!(err instanceof ApiRequestError && err.status === 401)) {
        // Network errors are reflected by the connection indicator.
        if (!(err instanceof ApiRequestError && err.status === 0))
          toast(errorMessage(err), 'error');
      }
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Debounced refresh, used for bursts of global events. */
export function scheduleRefresh(delay = 250): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshState();
  }, delay);
}

export function clearState(): void {
  state = null;
}

// ------------------------------------------------------------ connection
export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';
const streams = new Map<string, StreamStatus>();
const connListeners = new Set<(s: ConnectionStatus) => void>();

export function connectionStatus(): ConnectionStatus {
  const values = [...streams.values()];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (values.includes('offline')) return 'offline';
  if (values.some((v) => v === 'reconnecting' || v === 'connecting')) return 'reconnecting';
  return 'connected';
}

export function setStreamStatus(key: string, status: StreamStatus | null): void {
  if (status === null || status === 'closed') streams.delete(key);
  else streams.set(key, status);
  const s = connectionStatus();
  for (const fn of connListeners) fn(s);
}

export function subscribeConnection(scope: Scope, fn: (s: ConnectionStatus) => void): void {
  connListeners.add(fn);
  scope.add(() => connListeners.delete(fn));
  fn(connectionStatus());
}

// ------------------------------------------------------------ navigation
export function navigate(hash: string, replace = false): void {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

// ------------------------------------------------------------ toasts and announcements
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const region = document.getElementById('toasts');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.classList.add('toast-hide'), kind === 'error' ? 6000 : 3500);
  setTimeout(() => el.remove(), kind === 'error' ? 6600 : 4100);
}

let announceTimer: ReturnType<typeof setTimeout> | null = null;
/** Polite screen reader announcement. */
export function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (!region) return;
  if (announceTimer) clearTimeout(announceTimer);
  region.textContent = '';
  announceTimer = setTimeout(() => {
    region.textContent = message;
  }, 50);
}
