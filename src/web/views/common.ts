// Shared view pieces: header, badges, dialogs.
import type { PermissionModeName, SessionState } from '../../shared/api.js';
import { type ConnectionStatus, Scope, subscribeConnection } from '../app.js';
import { h, icon } from '../dom.js';
import { logoMark } from '../logo.js';

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

export function connectionIndicator(scope: Scope): HTMLElement {
  const label = h('span', { class: 'conn-label' });
  const el = h(
    'span',
    { class: 'conn', testid: 'connection-status', attrs: { role: 'status' } },
    h('span', { class: 'conn-dot', attrs: { 'aria-hidden': 'true' } }),
    label,
  );
  subscribeConnection(scope, (s) => {
    el.dataset['status'] = s;
    label.textContent = CONNECTION_LABEL[s];
  });
  return el;
}

export interface HeaderOptions {
  title: string | HTMLElement;
  back?: string;
  brand?: boolean;
  actions?: HTMLElement[];
  sub?: HTMLElement | null;
}

export function appHeader(scope: Scope, opts: HeaderOptions): HTMLElement {
  const left = h('div', { class: 'header-left' });
  if (opts.back) {
    left.appendChild(
      h('a', { class: 'icon-btn', attrs: { href: opts.back, 'aria-label': 'Back' } }, icon('back')),
    );
  }
  if (opts.brand) left.appendChild(h('span', { class: 'brand' }, logoMark(22)));
  const title =
    typeof opts.title === 'string'
      ? h('h1', { class: 'header-title', text: opts.title, attrs: { tabindex: '-1' } })
      : opts.title;
  left.appendChild(title);

  return h(
    'header',
    { class: 'app-header' },
    h(
      'div',
      { class: 'header-row' },
      left,
      h('div', { class: 'header-right' }, connectionIndicator(scope), ...(opts.actions ?? [])),
    ),
    opts.sub ?? null,
  );
}

const STATE_LABEL: Record<SessionState, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting for you',
};

export function stateBadge(state: SessionState, testid = true): HTMLElement {
  const el = h('span', {
    class: `badge badge-${state}`,
    text: STATE_LABEL[state],
    testid: testid ? 'state-badge' : undefined,
  });
  return el;
}

export function updateStateBadge(el: HTMLElement, state: SessionState): void {
  el.className = `badge badge-${state}`;
  el.textContent = STATE_LABEL[state];
}

export function stateLabel(state: SessionState): string {
  return STATE_LABEL[state];
}

export const MODE_INFO: Record<PermissionModeName, { label: string; short: string; help: string }> =
  {
    default: {
      label: 'Ask first',
      short: 'Ask',
      help: 'Asks you before running commands or changing files.',
    },
    acceptEdits: {
      label: 'Accept edits',
      short: 'Edits',
      help: 'Changes files in the project without asking. Still asks before running commands.',
    },
    plan: {
      label: 'Plan only',
      short: 'Plan',
      help: 'Reads and plans without changing anything. Good for reviewing an approach first.',
    },
    auto: {
      label: 'Auto',
      short: 'Auto',
      help: 'Runs routine actions on its own and asks only for ones that look risky.',
    },
    bypassPermissions: {
      label: 'Bypass permissions',
      short: 'Bypass',
      help: 'Never asks. Runs any command and edits any file your user account can reach. Only for disposable or sandboxed projects.',
    },
  };

// ------------------------------------------------------------ dialogs
function openDialog(build: (dialog: HTMLDialogElement, close: (v: string) => void) => void) {
  return new Promise<string>((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    const close = (v: string) => {
      dialog.close(v);
    };
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue);
      dialog.remove();
    });
    dialog.addEventListener('cancel', () => {
      dialog.returnValue = '';
    });
    build(dialog, close);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export interface ConfirmOptions {
  title: string;
  body: string | HTMLElement;
  confirmLabel: string;
  danger?: boolean;
  testid?: string;
}

export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const v = await openDialog((dialog, close) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', titleId);
    if (opts.testid) dialog.dataset['testid'] = opts.testid;
    const confirm = h('button', {
      class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`,
      text: opts.confirmLabel,
      attrs: { type: 'button' },
      testid: 'dialog-confirm',
      on: { click: () => close('ok') },
    });
    const cancel = h('button', {
      class: 'btn',
      text: 'Cancel',
      attrs: { type: 'button', autofocus: true },
      testid: 'dialog-cancel',
      on: { click: () => close('') },
    });
    dialog.append(
      h(
        'h2',
        { class: 'dialog-title', id: titleId },
        opts.danger ? icon('warn') : null,
        opts.title,
      ),
      typeof opts.body === 'string' ? h('p', { class: 'dialog-body', text: opts.body }) : opts.body,
      h('div', { class: 'dialog-actions' }, cancel, confirm),
    );
  });
  return v === 'ok';
}

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  confirmLabel: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
}

/** Returns the entered text, or null when cancelled. */
export async function promptDialog(opts: PromptOptions): Promise<string | null> {
  let field: HTMLInputElement | HTMLTextAreaElement | null = null;
  const v = await openDialog((dialog, close) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const fieldId = `${titleId}-field`;
    dialog.setAttribute('aria-labelledby', titleId);
    field = opts.multiline
      ? h('textarea', { class: 'input', id: fieldId, attrs: { rows: 3 } })
      : h('input', { class: 'input', id: fieldId, attrs: { type: 'text', autocomplete: 'off' } });
    field.value = opts.value ?? '';
    if (opts.placeholder) field.placeholder = opts.placeholder;
    field.setAttribute('autofocus', '');
    const f = field;
    const form = h(
      'form',
      {
        on: {
          submit: (ev) => {
            ev.preventDefault();
            if (opts.required && !f.value.trim()) {
              f.focus();
              return;
            }
            close('ok');
          },
        },
      },
      h('h2', { class: 'dialog-title', id: titleId, text: opts.title }),
      h('label', { class: 'label', text: opts.label, attrs: { for: fieldId } }),
      field,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', {
          class: 'btn',
          text: 'Cancel',
          attrs: { type: 'button' },
          on: { click: () => close('') },
        }),
        h('button', {
          class: 'btn btn-primary',
          text: opts.confirmLabel,
          attrs: { type: 'submit' },
          testid: 'dialog-confirm',
        }),
      ),
    );
    dialog.append(form);
  });
  if (v !== 'ok' || !field) return null;
  return (field as HTMLInputElement | HTMLTextAreaElement).value;
}

/** Bottom sheet with a list of actions. Resolves with the chosen id or ''. */
export function actionSheet(
  title: string,
  actions: { id: string; label: string; danger?: boolean }[],
): Promise<string> {
  return openDialog((dialog, close) => {
    dialog.classList.add('sheet');
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.append(
      h('h2', { class: 'dialog-title', id: titleId, text: title }),
      h(
        'div',
        { class: 'sheet-actions' },
        ...actions.map((a) =>
          h('button', {
            class: `btn btn-block ${a.danger ? 'btn-danger-outline' : ''}`,
            text: a.label,
            attrs: { type: 'button' },
            testid: `sheet-${a.id}`,
            on: { click: () => close(a.id) },
          }),
        ),
        h('button', {
          class: 'btn btn-block',
          text: 'Cancel',
          attrs: { type: 'button' },
          on: { click: () => close('') },
        }),
      ),
    );
    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog) close('');
    });
  });
}

export function bypassWarningBody(): HTMLElement {
  return h(
    'div',
    { class: 'dialog-body' },
    h('p', {
      text: 'In this mode nothing asks for your approval. Any command can run and any file your user account can reach can be changed or deleted, including outside this project.',
    }),
    h('p', {
      text: 'Only use it for disposable or sandboxed projects, and never with untrusted content (web pages, issues, dependencies) in the loop.',
    }),
  );
}
