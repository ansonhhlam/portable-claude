// Session screen: header, permission mode chips, timeline and composer.
import {
  PERMISSION_MODES,
  type PermissionModeName,
  type SessionDetail,
  type SessionEvent,
  type SessionState,
} from '../../shared/api.js';
import { api, ApiRequestError, errorMessage } from '../api.js';
import {
  announce,
  navigate,
  refreshState,
  Scope,
  setStreamStatus,
  toast,
  type View,
} from '../app.js';
import { formatDuration, formatUsd, h, icon } from '../dom.js';
import { browserEventSource, defaultStreamEnv, ReconnectingStream } from '../stream.js';
import {
  actionSheet,
  appHeader,
  bypassWarningBody,
  confirmDialog,
  MODE_INFO,
  promptDialog,
  stateLabel,
  updateStateBadge,
} from './common.js';
import { Timeline } from './timeline.js';

export function sessionEventsUrl(id: string, after: number | null): string {
  const base = `/api/sessions/${encodeURIComponent(id)}/events`;
  return after === null ? base : `${base}?after=${after}`;
}

export function sessionView(scope: Scope, id: string): View {
  let detail: SessionDetail | null = null;
  let state: SessionState = 'idle';
  let mode: PermissionModeName = 'default';

  // ---------------------------------------------------------------- header
  const titleBtn = h('button', {
    class: 'header-title title-btn',
    text: 'Loading…',
    testid: 'session-title',
    attrs: { type: 'button', 'aria-label': 'Session title, tap to rename' },
    on: { click: () => void rename() },
  });
  const badge = h('span', { class: 'badge badge-idle', text: 'Idle', testid: 'state-badge' });
  const menuBtn = h(
    'button',
    {
      class: 'icon-btn',
      testid: 'session-menu',
      attrs: { type: 'button', 'aria-label': 'Session actions' },
      on: { click: () => void openMenu() },
    },
    icon('more'),
  );
  const totals = h('p', { class: 'totals', testid: 'session-totals' });

  const chips = h('div', {
    class: 'chips',
    attrs: { role: 'group', 'aria-label': 'Permission mode' },
  });
  const chipEls = new Map<PermissionModeName, HTMLButtonElement>();
  for (const m of PERMISSION_MODES) {
    const chip = h('button', {
      class: `chip ${m === 'bypassPermissions' ? 'chip-danger' : ''}`,
      text: MODE_INFO[m].short,
      testid: `mode-chip-${m}`,
      attrs: { type: 'button', 'aria-pressed': 'false', title: MODE_INFO[m].help },
      on: { click: () => void changeMode(m) },
    });
    chipEls.set(m, chip);
    chips.append(chip);
  }

  const banner = h(
    'div',
    { class: 'bypass-banner', testid: 'bypass-banner', attrs: { role: 'alert', hidden: true } },
    icon('warn'),
    h('span', {
      text: 'Bypass mode: nothing asks for approval. Any command can run and any file can change.',
    }),
  );

  const header = appHeader(scope, {
    title: titleBtn,
    back: '#/',
    actions: [menuBtn],
    sub: h(
      'div',
      { class: 'header-sub' },
      h('div', { class: 'header-sub-row' }, badge, totals),
      chips,
      banner,
    ),
  });

  // ---------------------------------------------------------------- timeline
  const timeline = new Timeline({
    answer: async (approvalId, decision, note) => {
      await api.answerApproval(id, approvalId, note ? { decision, note } : { decision });
    },
  });

  // ---------------------------------------------------------------- composer
  const input = h('textarea', {
    class: 'input composer-input',
    id: 'composer-input',
    testid: 'composer-input',
    attrs: { rows: 1, placeholder: 'Message', enterkeyhint: 'send', 'aria-label': 'Message' },
  });
  const sendBtn = h(
    'button',
    { class: 'btn btn-primary composer-send', testid: 'send-button', attrs: { type: 'submit' } },
    icon('send'),
    h('span', { class: 'sr-only', text: 'Send' }),
  );
  const stopBtn = h(
    'button',
    {
      class: 'btn btn-danger-outline composer-stop',
      testid: 'stop-button',
      attrs: { type: 'button', hidden: true },
      on: { click: () => void stop() },
    },
    icon('stop'),
    h('span', { text: 'Stop' }),
  );
  const composer = h(
    'form',
    {
      class: 'composer',
      on: {
        submit: (ev) => {
          ev.preventDefault();
          void send();
        },
      },
    },
    input,
    stopBtn,
    sendBtn,
  );

  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      void send();
    }
  });

  // ---------------------------------------------------------------- rendering
  function setTitle(t: string): void {
    titleBtn.textContent = t || 'Untitled session';
    document.title = `${t || 'Session'} · longcord`;
  }

  function setState(s: SessionState, live: boolean): void {
    const changed = s !== state;
    state = s;
    updateStateBadge(badge, s);
    stopBtn.hidden = s === 'idle';
    if (changed && live) announce(`Session ${stateLabel(s).toLowerCase()}`);
  }

  function setMode(m: PermissionModeName): void {
    mode = m;
    for (const [k, chip] of chipEls) {
      chip.setAttribute('aria-pressed', String(k === m));
      chip.classList.toggle('chip-active', k === m);
    }
    banner.hidden = m !== 'bypassPermissions';
  }

  function setTotals(d: SessionDetail): void {
    const t = d.totals;
    totals.textContent =
      t.runs === 0
        ? ''
        : `${formatUsd(t.costUsd)} · ${formatDuration(t.durationMs)} · ${t.turns === 1 ? '1 turn' : `${t.turns} turns`}`;
  }

  function applyDetail(d: SessionDetail): void {
    detail = d;
    setTitle(d.title);
    setState(d.state, false);
    setMode(d.mode);
    setTotals(d);
    timeline.setPending(d.pendingApprovalIds, d.lastSeq);
  }

  let detailTimer: ReturnType<typeof setTimeout> | null = null;
  async function loadDetail(): Promise<SessionDetail | null> {
    try {
      const d = await api.session(id);
      applyDetail(d);
      return d;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        toast('This session no longer exists.', 'error');
        navigate('#/', true);
      } else if (!(err instanceof ApiRequestError && (err.status === 401 || err.status === 0))) {
        toast(errorMessage(err), 'error');
      }
      return null;
    }
  }
  function scheduleDetail(): void {
    if (detailTimer) clearTimeout(detailTimer);
    detailTimer = setTimeout(() => {
      detailTimer = null;
      void loadDetail();
    }, 300);
  }
  scope.add(() => {
    if (detailTimer) clearTimeout(detailTimer);
  });

  function onEvent(ev: SessionEvent, live: boolean): void {
    switch (ev.type) {
      case 'state':
        setState(ev.data.state, live);
        break;
      case 'mode.changed':
        setMode(ev.data.mode);
        break;
      case 'session.renamed':
        setTitle(ev.data.title);
        break;
      case 'run.finished':
        if (live) scheduleDetail();
        break;
      default:
        break;
    }
    timeline.apply(ev, live);
  }

  // ---------------------------------------------------------------- stream
  let replayUntil = 0;
  const stream = new ReconnectingStream<SessionEvent>({
    url: (after) => sessionEventsUrl(id, after),
    factory: browserEventSource,
    env: defaultStreamEnv(),
    onEvent: (ev) => onEvent(ev, ev.seq > replayUntil),
    onStatus: (s) => setStreamStatus('session', s),
    onOpen: (reconnect) => {
      // After a reconnect, approvals may have expired while we were away.
      if (reconnect) void loadDetail();
    },
    onError: (failures) => {
      // EventSource hides the status code; check whether we were signed out.
      if (failures === 2) void refreshState();
    },
  });
  scope.add(() => {
    stream.stop();
    setStreamStatus('session', null);
  });

  void (async () => {
    const d = await loadDetail();
    if (!d) return;
    replayUntil = d.lastSeq;
    stream.start();
    timeline.scrollToBottom();
  })();

  // ---------------------------------------------------------------- actions
  async function send(): Promise<void> {
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    sendBtn.disabled = true;
    input.value = '';
    autosize();
    try {
      await api.sendMessage(id, text);
      timeline.scrollToBottom();
    } catch (err) {
      input.value = text;
      autosize();
      toast(errorMessage(err), 'error');
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function stop(): Promise<void> {
    stopBtn.disabled = true;
    try {
      await api.interrupt(id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      stopBtn.disabled = false;
    }
  }

  async function confirmBypass(): Promise<boolean> {
    return confirmDialog({
      title: 'Turn off all approvals?',
      body: bypassWarningBody(),
      confirmLabel: 'Switch to bypass',
      danger: true,
      testid: 'bypass-confirm',
    });
  }

  async function changeMode(m: PermissionModeName): Promise<void> {
    if (m === mode) return;
    let confirmed = false;
    if (m === 'bypassPermissions') {
      confirmed = await confirmBypass();
      if (!confirmed) return;
    }
    try {
      await api.setMode(id, m, confirmed);
      setMode(m);
      announce(`Mode: ${MODE_INFO[m].label}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'bypass_confirm_required' && !confirmed) {
        if (await confirmBypass()) {
          try {
            await api.setMode(id, m, true);
            setMode(m);
          } catch (err2) {
            toast(errorMessage(err2), 'error');
          }
        }
        return;
      }
      toast(errorMessage(err), 'error');
    }
  }

  async function rename(): Promise<void> {
    const t = await promptDialog({
      title: 'Rename session',
      label: 'Title',
      value: detail?.title ?? '',
      confirmLabel: 'Save',
      required: true,
    });
    if (t === null || !t.trim()) return;
    try {
      const d = await api.updateSession(id, { title: t.trim() });
      applyDetail(d);
      void refreshState();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function openMenu(): Promise<void> {
    const archived = detail?.archived ?? false;
    const choice = await actionSheet('Session', [
      { id: 'rename', label: 'Rename' },
      { id: 'archive', label: archived ? 'Unarchive' : 'Archive' },
      { id: 'delete', label: 'Delete', danger: true },
    ]);
    if (choice === 'rename') await rename();
    if (choice === 'archive') {
      try {
        const d = await api.updateSession(id, { archived: !archived });
        applyDetail(d);
        void refreshState();
        toast(archived ? 'Session unarchived' : 'Session archived');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
    if (choice === 'delete') {
      const ok = await confirmDialog({
        title: 'Delete this session?',
        body: 'Its history is removed from longcord. Files changed in the project stay as they are. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
        testid: 'delete-confirm',
      });
      if (!ok) return;
      try {
        await api.deleteSession(id);
        void refreshState();
        navigate('#/', true);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
  }

  const el = h(
    'div',
    { class: 'screen session-screen' },
    header,
    h('main', { class: 'content timeline-wrap', attrs: { id: 'main' } }, timeline.el),
    h('div', { class: 'composer-bar' }, composer),
  );
  return { el, focus: titleBtn };
}
