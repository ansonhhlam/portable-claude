// Home: sessions that need you, all sessions, spend, and the New session button.
import type { SessionSummary, SpendInfo, StateResponse } from '../../shared/api.js';
import { Scope, subscribeState, type View } from '../app.js';
import { clear, formatRelative, formatUsd, h, icon } from '../dom.js';
import { appHeader, stateBadge } from './common.js';

let showArchived = false;

export function needsYou(s: SessionSummary): boolean {
  return !s.archived && (s.pendingApprovals > 0 || s.state === 'waiting');
}

export function spendText(spend: SpendInfo): string {
  const today = formatUsd(spend.todayUsd);
  if (spend.dailyCapUsd === null) return `Today ${today}`;
  return `Today ${today} of ${formatUsd(spend.dailyCapUsd)} cap`;
}

function sessionRow(s: SessionSummary): HTMLElement {
  const pending =
    s.pendingApprovals > 0
      ? h('span', {
          class: 'badge badge-waiting',
          text: s.pendingApprovals === 1 ? '1 approval' : `${s.pendingApprovals} approvals`,
        })
      : null;
  return h(
    'li',
    { class: 'session-item' },
    h(
      'a',
      {
        class: 'session-row',
        testid: 'session-row',
        attrs: { href: `#/s/${encodeURIComponent(s.id)}`, 'data-session-id': s.id },
      },
      h(
        'div',
        { class: 'session-row-top' },
        h('span', { class: 'session-title', text: s.title || 'Untitled session' }),
        stateBadge(s.state, false),
      ),
      h(
        'div',
        { class: 'session-meta' },
        h('span', { text: s.projectName }),
        h('span', { attrs: { 'aria-hidden': 'true' }, text: '·' }),
        h('span', { text: formatRelative(s.updatedAt) }),
        s.totals.costUsd > 0 ? h('span', { attrs: { 'aria-hidden': 'true' }, text: '·' }) : null,
        s.totals.costUsd > 0 ? h('span', { text: formatUsd(s.totals.costUsd) }) : null,
        s.archived ? h('span', { class: 'tag', text: 'Archived' }) : null,
        s.imported ? h('span', { class: 'tag', text: 'Imported' }) : null,
      ),
      s.preview ? h('p', { class: 'session-preview', text: s.preview }) : null,
      pending,
    ),
  );
}

export function homeView(scope: Scope): View {
  const settings = h(
    'a',
    {
      class: 'icon-btn',
      testid: 'settings-button',
      attrs: { href: '#/settings', 'aria-label': 'Settings' },
    },
    icon('settings'),
  );
  const header = appHeader(scope, { title: 'longcord', brand: true, actions: [settings] });
  const spendLine = h('p', { class: 'spend-line', attrs: { 'aria-live': 'polite' } });
  const needs = h('section', {
    class: 'section needs-you',
    testid: 'home-needs-you',
    attrs: { 'aria-labelledby': 'needs-you-title', hidden: true },
  });
  const list = h('section', { class: 'section', attrs: { 'aria-labelledby': 'sessions-title' } });
  const archivedToggle = h('input', {
    id: 'show-archived',
    attrs: { type: 'checkbox' },
  });
  archivedToggle.checked = showArchived;

  const fab = h(
    'a',
    {
      class: 'fab',
      testid: 'new-session-button',
      attrs: { href: '#/new' },
    },
    icon('plus'),
    h('span', { text: 'New session' }),
  );

  function render(s: StateResponse): void {
    spendLine.textContent = spendText(s.spend);
    spendLine.classList.toggle('spend-capped', s.spend.capReached);
    if (s.spend.capReached) spendLine.textContent += ' · daily cap reached';

    const urgent = s.sessions.filter(needsYou);
    clear(needs);
    needs.hidden = urgent.length === 0;
    if (urgent.length) {
      needs.append(
        h('h2', { class: 'section-title', id: 'needs-you-title', text: 'Needs you' }),
        h('ul', { class: 'session-list' }, ...urgent.map(sessionRow)),
      );
    }

    const others = s.sessions
      .filter((x) => !needsYou(x) && (showArchived || !x.archived))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    clear(list);
    list.append(
      h(
        'div',
        { class: 'section-head' },
        h('h2', { class: 'section-title', id: 'sessions-title', text: 'Sessions' }),
        h(
          'label',
          { class: 'toggle', attrs: { for: 'show-archived' } },
          archivedToggle,
          h('span', { text: 'Show archived' }),
        ),
      ),
    );
    if (s.projects.length === 0) {
      list.append(
        h(
          'div',
          { class: 'empty' },
          h('p', { text: 'No projects yet.' }),
          h(
            'p',
            { class: 'muted' },
            'On your computer, run ',
            h('code', { text: 'longcord projects add <path>' }),
            ' to add a project folder.',
          ),
        ),
      );
    } else if (others.length === 0 && urgent.length === 0) {
      list.append(
        h(
          'div',
          { class: 'empty' },
          h('p', { text: 'No sessions yet.' }),
          h('p', { class: 'muted', text: 'Start one with the New session button.' }),
        ),
      );
    } else if (others.length) {
      list.append(h('ul', { class: 'session-list' }, ...others.map(sessionRow)));
    }
  }

  archivedToggle.addEventListener('change', () => {
    showArchived = archivedToggle.checked;
    const s = latest;
    if (s) render(s);
  });

  let latest: StateResponse | null = null;
  subscribeState(scope, (s) => {
    latest = s;
    render(s);
  });

  const el = h(
    'div',
    { class: 'screen' },
    header,
    h('main', { class: 'content with-fab', attrs: { id: 'main' } }, spendLine, needs, list),
    fab,
  );
  return { el };
}
