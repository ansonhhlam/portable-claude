// Entry point: boot, authentication gate, hash router and the global event stream.
import './styles.css';
import type { GlobalEvent } from '../shared/api.js';
import { onUnauthorized } from './api.js';
import {
  clearState,
  navigate,
  refreshState,
  scheduleRefresh,
  Scope,
  setStreamStatus,
  type View,
} from './app.js';
import { clear, h } from './dom.js';
import { browserEventSource, defaultStreamEnv, ReconnectingStream } from './stream.js';
import { homeView } from './views/home.js';
import { loginView, pairView } from './views/login.js';
import { importView, newSessionView } from './views/new-session.js';
import { sessionView } from './views/session.js';
import { settingsView } from './views/settings.js';

const root = document.getElementById('view');
if (!root) throw new Error('missing #view');
const viewRoot: HTMLElement = root;

let authed = false;
let unauthorized = false;
let returnTo = '#/';
let scope = new Scope();

// ------------------------------------------------------------ global stream
const globalStream = new ReconnectingStream<GlobalEvent>({
  url: () => '/api/events',
  factory: browserEventSource,
  env: defaultStreamEnv(),
  onEvent: (ev) => {
    if (ev.type === 'sessions.changed' || ev.type === 'spend.changed') scheduleRefresh();
  },
  onStatus: (s) => setStreamStatus('global', s),
  onOpen: (reconnect) => {
    if (reconnect) scheduleRefresh(0);
  },
  onError: (failures) => {
    if (failures === 2) void refreshState();
  },
});

function startSignedIn(): void {
  authed = true;
  unauthorized = false;
  globalStream.start();
}

function signedOut(): void {
  authed = false;
  globalStream.stop();
  setStreamStatus('global', null);
  clearState();
}

onUnauthorized(() => {
  unauthorized = true;
  const current = location.hash || '#/';
  if (!current.startsWith('#/login') && !current.startsWith('#/pair')) returnTo = current;
  if (authed || !current.startsWith('#/login')) {
    signedOut();
    navigate('#/login', true);
  }
});

async function afterAuth(): Promise<void> {
  const s = await refreshState();
  if (!s) return;
  startSignedIn();
  const target = returnTo;
  returnTo = '#/';
  navigate(target, true);
}

// ------------------------------------------------------------ router
type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'import'; projectId: string }
  | { name: 'session'; id: string }
  | { name: 'settings' }
  | { name: 'login' }
  | { name: 'pair'; token: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const [first, second] = parts;
  switch (first) {
    case undefined:
      return { name: 'home' };
    case 'new':
      return { name: 'new' };
    case 'import':
      return { name: 'import', projectId: second ?? '' };
    case 's':
      return second ? { name: 'session', id: second } : { name: 'home' };
    case 'settings':
      return { name: 'settings' };
    case 'login':
      return { name: 'login' };
    case 'pair':
      return second ? { name: 'pair', token: second } : { name: 'login' };
    default:
      return { name: 'home' };
  }
}

const TITLES: Partial<Record<Route['name'], string>> = {
  home: 'longcord',
  new: 'New session · longcord',
  import: 'Resume a session · longcord',
  settings: 'Settings · longcord',
  login: 'Sign in · longcord',
  pair: 'Pair device · longcord',
};

function show(view: View, focusTop = true): void {
  clear(viewRoot);
  viewRoot.append(view.el);
  const target = view.focus ?? view.el.querySelector<HTMLElement>('h1, .header-title') ?? view.el;
  if (focusTop) window.scrollTo({ top: 0 });
  // Move focus for screen readers without scrolling the page.
  target.focus({ preventScroll: true });
}

function render(): void {
  scope.dispose();
  scope = new Scope();
  const route = parseRoute(location.hash);
  document.title = TITLES[route.name] ?? 'longcord';

  if (route.name === 'pair') {
    show(pairView(scope, route.token, () => void afterAuth()));
    return;
  }
  if (route.name === 'login' || !authed) {
    if (!authed && !unauthorized && route.name !== 'login') {
      // Still booting; boot() will render again.
      return;
    }
    show(loginView(scope, () => void afterAuth()));
    return;
  }

  switch (route.name) {
    case 'home':
      show(homeView(scope));
      break;
    case 'new':
      show(newSessionView(scope));
      break;
    case 'import':
      show(importView(scope, route.projectId));
      break;
    case 'session':
      show(sessionView(scope, route.id), false);
      break;
    case 'settings':
      show(
        settingsView(scope, () => {
          signedOut();
          unauthorized = true;
          returnTo = '#/';
          navigate('#/login', true);
        }),
      );
      break;
  }
}

window.addEventListener('hashchange', render);

// ------------------------------------------------------------ boot
function offlineScreen(): View {
  const retry = h('button', {
    class: 'btn btn-primary',
    text: 'Try again',
    attrs: { type: 'button' },
    on: { click: () => void boot() },
  });
  const el = h(
    'main',
    { class: 'auth', attrs: { id: 'main' } },
    h('h1', { class: 'auth-title', text: 'Cannot reach your computer', attrs: { tabindex: '-1' } }),
    h('p', {
      class: 'muted center',
      text: 'Check that longcord is running on your computer and that this device is connected to your tailnet.',
    }),
    retry,
  );
  return { el, focus: retry };
}

async function boot(): Promise<void> {
  const route = parseRoute(location.hash);
  if (route.name === 'pair') {
    render();
    return;
  }
  const s = await refreshState();
  if (s) {
    startSignedIn();
    if (route.name === 'login') navigate('#/', true);
    else render();
  } else if (unauthorized) {
    render();
  } else {
    show(offlineScreen());
  }
}

window.addEventListener('online', () => {
  if (!authed && !unauthorized) void boot();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* notifications are unavailable without the worker; the app still works */
    });
  });
}

void boot();
