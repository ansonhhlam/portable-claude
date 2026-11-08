// Settings: projects, devices, notifications, spend, about.
import type { DeviceInfo, StateResponse } from '../../shared/api.js';
import { api, errorMessage } from '../api.js';
import {
  getState,
  navigate,
  refreshState,
  Scope,
  subscribeState,
  toast,
  type View,
} from '../app.js';
import { clear, formatRelative, formatUsd, h } from '../dom.js';
import {
  currentSubscription,
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  pushSupported,
} from '../push.js';
import { appHeader, confirmDialog } from './common.js';

const REPO_URL = 'https://github.com/ansonhhlam/portable-claude';

function section(title: string, id: string, ...children: (Node | null)[]): HTMLElement {
  return h(
    'section',
    { class: 'section card', attrs: { 'aria-labelledby': id } },
    h('h2', { class: 'section-title', id, text: title }),
    ...children,
  );
}

export function settingsView(scope: Scope, onLoggedOut: () => void): View {
  const header = appHeader(scope, { title: 'Settings', back: '#/' });

  // ---------------------------------------------------------------- projects
  const projects = h('ul', { class: 'plain-list', testid: 'projects-list' });
  const projectsSection = section(
    'Projects',
    'set-projects',
    projects,
    h(
      'p',
      { class: 'hint' },
      'Add a project on your computer with ',
      h('code', { text: 'longcord projects add <path>' }),
      '.',
    ),
  );

  // ---------------------------------------------------------------- devices
  const devices = h('ul', { class: 'plain-list', testid: 'devices-list' });
  async function loadDevices(): Promise<void> {
    try {
      renderDevices(await api.devices());
    } catch (err) {
      clear(devices);
      devices.append(h('li', { class: 'form-error', text: errorMessage(err) }));
    }
  }
  function renderDevices(list: DeviceInfo[]): void {
    clear(devices);
    for (const d of list) {
      const revoke = h('button', {
        class: 'btn btn-danger-outline btn-small',
        text: d.current ? 'Sign out' : 'Revoke',
        testid: 'device-revoke',
        attrs: { type: 'button', 'aria-label': `${d.current ? 'Sign out' : 'Revoke'} ${d.name}` },
      });
      revoke.addEventListener('click', () => {
        void (async () => {
          const ok = await confirmDialog({
            title: d.current ? 'Sign out this device?' : `Revoke ${d.name}?`,
            body: d.current
              ? 'You will need the passcode or a new pairing code to sign in again.'
              : 'That device is signed out immediately and stops receiving notifications.',
            confirmLabel: d.current ? 'Sign out' : 'Revoke',
            danger: true,
            testid: 'revoke-confirm',
          });
          if (!ok) return;
          try {
            await api.revokeDevice(d.id);
            if (d.current) {
              onLoggedOut();
              return;
            }
            toast(`${d.name} revoked`);
            await loadDevices();
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        })();
      });
      devices.append(
        h(
          'li',
          { class: 'device-row', testid: 'device-row' },
          h(
            'div',
            { class: 'device-text' },
            h(
              'span',
              { class: 'device-name' },
              d.name,
              d.current ? h('span', { class: 'tag', text: 'This device' }) : null,
            ),
            h('span', {
              class: 'muted small',
              text: `Added ${formatRelative(d.createdAt)}${d.lastSeenAt ? ` · last seen ${formatRelative(d.lastSeenAt)}` : ''}`,
            }),
          ),
          revoke,
        ),
      );
    }
  }
  const devicesSection = section('Devices', 'set-devices', devices);

  // ---------------------------------------------------------------- notifications
  const pushStatus = h('p', { class: 'muted', attrs: { 'aria-live': 'polite' } });
  const pushEnable = h('button', {
    class: 'btn btn-primary',
    text: 'Enable notifications',
    testid: 'push-enable',
    attrs: { type: 'button' },
  });
  const pushDisable = h('button', {
    class: 'btn',
    text: 'Turn off',
    testid: 'push-disable',
    attrs: { type: 'button', hidden: true },
  });
  const pushTest = h('button', {
    class: 'btn',
    text: 'Send test notification',
    testid: 'push-test',
    attrs: { type: 'button', hidden: true },
  });
  const iosNote = h('p', {
    class: 'hint',
    text: 'On iPhone and iPad, notifications need iOS 16.4 or later and longcord added to the Home Screen: tap Share, then Add to Home Screen, and open it from there.',
  });

  async function renderPush(): Promise<void> {
    if (!pushSupported()) {
      pushStatus.textContent =
        isIos() && !isStandalone()
          ? 'Add longcord to your Home Screen to enable notifications.'
          : 'This browser does not support notifications.';
      pushEnable.hidden = true;
      pushDisable.hidden = true;
      pushTest.hidden = true;
      return;
    }
    const sub = await currentSubscription().catch(() => null);
    const on = sub !== null && Notification.permission === 'granted';
    pushStatus.textContent = on
      ? 'Notifications are on for this device. You get one when a session needs you or finishes.'
      : Notification.permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser or system settings.'
        : 'Get notified when a session needs approval or finishes.';
    pushEnable.hidden = on;
    pushDisable.hidden = !on;
    pushTest.hidden = !on;
  }

  pushEnable.addEventListener('click', () => {
    void (async () => {
      pushEnable.disabled = true;
      try {
        await enablePush();
        toast('Notifications enabled');
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        pushEnable.disabled = false;
        await renderPush();
      }
    })();
  });
  pushDisable.addEventListener('click', () => {
    void (async () => {
      try {
        await disablePush();
        toast('Notifications turned off');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      await renderPush();
    })();
  });
  pushTest.addEventListener('click', () => {
    void (async () => {
      try {
        await api.pushTest();
        toast('Test notification sent');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    })();
  });

  const pushSection = section(
    'Notifications',
    'set-push',
    pushStatus,
    h('div', { class: 'button-row' }, pushEnable, pushTest, pushDisable),
    isIos() ? iosNote : null,
  );

  // ---------------------------------------------------------------- spend
  const spend = h('dl', { class: 'facts', testid: 'spend-info' });
  const spendSection = section(
    'Spend',
    'set-spend',
    spend,
    h('p', {
      class: 'hint',
      text: 'Costs are estimates reported by the Claude Agent SDK. The daily cap is set on your computer.',
    }),
  );

  // ---------------------------------------------------------------- about
  const about = h('dl', { class: 'facts' });
  const logout = h('button', {
    class: 'btn btn-danger-outline',
    text: 'Sign out',
    testid: 'logout',
    attrs: { type: 'button' },
  });
  logout.addEventListener('click', () => {
    void (async () => {
      try {
        await api.logout();
      } catch {
        /* signed out locally either way */
      }
      onLoggedOut();
    })();
  });
  const aboutSection = section(
    'About',
    'set-about',
    about,
    h('p', { class: 'muted' }, 'Powered by Claude, through the Claude Agent SDK.'),
    h(
      'p',
      null,
      h('a', {
        class: 'link',
        text: 'Source code and documentation',
        attrs: { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' },
      }),
    ),
    h('div', { class: 'button-row' }, logout),
  );

  function fact(dl: HTMLElement, k: string, v: string | Node): void {
    dl.append(h('dt', { text: k }), h('dd', null, v));
  }

  function render(s: StateResponse): void {
    clear(projects);
    if (s.projects.length === 0)
      projects.append(h('li', { class: 'muted', text: 'No projects yet.' }));
    for (const p of s.projects) {
      projects.append(
        h(
          'li',
          { class: 'project-row' },
          h('span', { class: 'device-name', text: p.name }),
          h('code', { class: 'small path', text: p.path }),
        ),
      );
    }

    clear(spend);
    fact(spend, 'Today', formatUsd(s.spend.todayUsd));
    fact(
      spend,
      'Daily cap',
      s.spend.dailyCapUsd === null ? 'None' : formatUsd(s.spend.dailyCapUsd),
    );
    if (s.spend.capReached) {
      fact(
        spend,
        'Status',
        h('span', {
          class: 'text-danger',
          text: 'Cap reached. New runs are blocked until tomorrow.',
        }),
      );
    }

    clear(about);
    fact(about, 'Version', s.me.version);
    fact(about, 'This device', s.me.deviceName);
    if (s.me.mock) {
      fact(
        about,
        'Mode',
        h('span', {
          class: 'tag tag-mock',
          testid: 'mock-indicator',
          text: 'Mock SDK (no real model calls)',
        }),
      );
    }
  }

  subscribeState(scope, render);
  if (!getState()) void refreshState();
  void loadDevices();
  void renderPush();

  const el = h(
    'div',
    { class: 'screen' },
    header,
    h(
      'main',
      { class: 'content', attrs: { id: 'main' } },
      pushSection,
      devicesSection,
      projectsSection,
      spendSection,
      aboutSection,
    ),
  );
  return { el };
}

export function afterLogout(): void {
  navigate('#/login', true);
}
