// New session form, and the list of sessions on the computer that can be imported.
import { PERMISSION_MODES, type PermissionModeName, type StateResponse } from '../../shared/api.js';
import { api, ApiRequestError, errorMessage } from '../api.js';
import {
  getState,
  navigate,
  refreshState,
  Scope,
  subscribeState,
  toast,
  type View,
} from '../app.js';
import { clear, formatRelative, h } from '../dom.js';
import { appHeader, bypassWarningBody, confirmDialog, MODE_INFO } from './common.js';

let lastProjectId = '';
let lastMode: PermissionModeName = 'default';

export function newSessionView(scope: Scope): View {
  const header = appHeader(scope, { title: 'New session', back: '#/' });
  const error = h('p', { class: 'form-error', attrs: { role: 'alert' } });

  const project = h('select', { class: 'input', id: 'ns-project', testid: 'project-select' });
  const prompt = h('textarea', {
    class: 'input prompt-input',
    id: 'ns-prompt',
    testid: 'prompt-input',
    attrs: { rows: 6, required: true, placeholder: 'What should it work on?' },
  });
  const mode = h('select', { class: 'input', id: 'ns-mode', testid: 'mode-select' });
  for (const m of PERMISSION_MODES) {
    mode.append(h('option', { text: MODE_INFO[m].label, attrs: { value: m } }));
  }
  mode.value = lastMode;
  const modeHelp = h('p', { class: 'hint', id: 'ns-mode-help', attrs: { 'aria-live': 'polite' } });
  mode.setAttribute('aria-describedby', 'ns-mode-help');
  const updateModeHelp = () => {
    const m = mode.value as PermissionModeName;
    modeHelp.textContent = MODE_INFO[m].help;
    modeHelp.classList.toggle('hint-danger', m === 'bypassPermissions');
  };
  mode.addEventListener('change', updateModeHelp);
  updateModeHelp();

  const model = h('select', { class: 'input', id: 'ns-model' });
  const modelField = h(
    'div',
    { class: 'field', attrs: { hidden: true } },
    h('label', { class: 'label', text: 'Model', attrs: { for: 'ns-model' } }),
    model,
  );

  const importLink = h('a', {
    class: 'link',
    text: 'Resume a session from this computer',
    testid: 'import-link',
    attrs: { href: '#/import' },
  });
  const updateImportLink = () => {
    importLink.setAttribute('href', `#/import/${encodeURIComponent(project.value)}`);
  };
  project.addEventListener('change', () => {
    lastProjectId = project.value;
    updateImportLink();
  });

  const submit = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Start session',
    testid: 'create-session',
    attrs: { type: 'submit' },
  });

  const noProjects = h(
    'div',
    { class: 'empty', attrs: { hidden: true } },
    h('p', { text: 'No projects yet.' }),
    h(
      'p',
      { class: 'muted' },
      'On your computer, run ',
      h('code', { text: 'longcord projects add <path>' }),
      ' to add a project folder.',
    ),
  );

  let filled = false;
  function fill(s: StateResponse): void {
    if (filled) return;
    filled = true;
    clear(project);
    for (const p of s.projects)
      project.append(h('option', { text: p.name, attrs: { value: p.id } }));
    if (s.projects.some((p) => p.id === lastProjectId)) project.value = lastProjectId;
    noProjects.hidden = s.projects.length > 0;
    form.hidden = s.projects.length === 0;
    updateImportLink();

    clear(model);
    model.append(
      h('option', {
        text: s.me.defaultModel ? `Default (${s.me.defaultModel})` : 'Default',
        attrs: { value: '' },
      }),
    );
    for (const m of s.me.models) model.append(h('option', { text: m, attrs: { value: m } }));
    modelField.hidden = s.me.models.length === 0;
  }

  const form = h(
    'form',
    {
      class: 'form',
      on: {
        submit: (ev) => {
          ev.preventDefault();
          void create();
        },
      },
    },
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', text: 'Project', attrs: { for: 'ns-project' } }),
      project,
      h('p', { class: 'hint' }, importLink),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', text: 'Prompt', attrs: { for: 'ns-prompt' } }),
      prompt,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', text: 'Permission mode', attrs: { for: 'ns-mode' } }),
      mode,
      modeHelp,
    ),
    modelField,
    error,
    h('div', { class: 'bottom-bar' }, submit),
  );

  async function create(): Promise<void> {
    error.textContent = '';
    const text = prompt.value.trim();
    if (!project.value) {
      error.textContent = 'Choose a project.';
      project.focus();
      return;
    }
    if (!text) {
      error.textContent = 'Write a prompt to start the session.';
      prompt.focus();
      return;
    }
    const m = mode.value as PermissionModeName;
    let confirmBypass = false;
    if (m === 'bypassPermissions') {
      confirmBypass = await confirmDialog({
        title: 'Start without any approvals?',
        body: bypassWarningBody(),
        confirmLabel: 'Start in bypass mode',
        danger: true,
        testid: 'bypass-confirm',
      });
      if (!confirmBypass) return;
    }
    submit.disabled = true;
    try {
      const detail = await api.createSession({
        projectId: project.value,
        prompt: text,
        mode: m,
        model: model.value || null,
        confirmBypass: confirmBypass || undefined,
      });
      lastMode = m;
      prompt.value = '';
      void refreshState();
      navigate(`#/s/${encodeURIComponent(detail.id)}`, true);
    } catch (err) {
      error.textContent = errorMessage(err);
      if (err instanceof ApiRequestError && err.code === 'bypass_confirm_required') mode.focus();
    } finally {
      submit.disabled = false;
    }
  }

  subscribeState(scope, fill);
  if (!getState()) void refreshState();

  const el = h(
    'div',
    { class: 'screen' },
    header,
    h('main', { class: 'content', attrs: { id: 'main' } }, noProjects, form),
  );
  return { el, focus: prompt };
}

export function importView(scope: Scope, projectId: string): View {
  const header = appHeader(scope, { title: 'Resume a session', back: '#/new' });
  const body = h('div', { attrs: { 'aria-live': 'polite' } });
  const intro = h('p', { class: 'muted' });

  const s = getState();
  const projectName = s?.projects.find((p) => p.id === projectId)?.name ?? 'this project';
  intro.textContent = `Sessions started on your computer in ${projectName}. Importing one shows its history here and lets you continue it from your phone.`;

  async function load(): Promise<void> {
    clear(body);
    body.append(h('p', { class: 'muted', text: 'Loading…' }));
    try {
      const list = await api.importCandidates(projectId);
      clear(body);
      if (list.length === 0) {
        body.append(
          h('div', { class: 'empty' }, h('p', { text: 'No sessions found for this project.' })),
        );
        return;
      }
      const ul = h('ul', { class: 'session-list' });
      for (const c of list.sort((a, b) => b.lastModified - a.lastModified)) {
        const btn = h('button', {
          class: 'btn btn-primary',
          text: 'Import',
          testid: 'import-button',
          attrs: { type: 'button' },
        });
        btn.addEventListener('click', () => {
          void (async () => {
            btn.disabled = true;
            try {
              const detail = await api.importSession({ projectId, sdkSessionId: c.sdkSessionId });
              void refreshState();
              navigate(`#/s/${encodeURIComponent(detail.id)}`, true);
            } catch (err) {
              toast(errorMessage(err), 'error');
              btn.disabled = false;
            }
          })();
        });
        ul.append(
          h(
            'li',
            { class: 'session-item import-item', testid: 'import-candidate' },
            h(
              'div',
              { class: 'import-text' },
              h('span', { class: 'session-title', text: c.summary || 'Untitled session' }),
              h(
                'span',
                { class: 'session-meta' },
                formatRelative(c.lastModified),
                c.gitBranch ? ` · ${c.gitBranch}` : '',
              ),
            ),
            btn,
          ),
        );
      }
      body.append(ul);
    } catch (err) {
      clear(body);
      body.append(h('p', { class: 'form-error', text: errorMessage(err) }));
    }
  }

  if (projectId) void load();
  else body.append(h('p', { class: 'form-error', text: 'Choose a project first.' }));

  const el = h(
    'div',
    { class: 'screen' },
    header,
    h('main', { class: 'content', attrs: { id: 'main' } }, intro, body),
  );
  return { el };
}
