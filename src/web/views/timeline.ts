// Renders a session's event stream as a timeline.
import type {
  ApprovalDecision,
  ApprovalResolution,
  DiffPreview,
  EventPayloads,
  SessionEvent,
} from '../../shared/api.js';
import { ApiRequestError, errorMessage } from '../api.js';
import { announce, toast } from '../app.js';
import { formatDuration, formatUsd, h } from '../dom.js';
import { setMarkdown } from '../markdown.js';

const MAX_OUTPUT_CHARS = 4000;

interface AssistantEntry {
  el: HTMLElement;
  body: HTMLElement;
  text: string;
}

interface ToolEntry {
  li: HTMLElement;
  details: HTMLDetailsElement;
  status: HTMLElement;
  output: HTMLPreElement;
  children: HTMLElement;
}

interface ApprovalEntry {
  seq: number;
  li: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  outcome: HTMLElement;
  resolved: ApprovalResolution | null;
  buttons: HTMLButtonElement[];
}

export interface TimelineOptions {
  answer: (approvalId: string, decision: ApprovalDecision, note?: string) => Promise<void>;
}

const RESOLUTION_TEXT: Record<ApprovalResolution, string> = {
  allow: 'Allowed',
  deny: 'Denied',
  always: 'Always allowed',
  expired: 'Expired',
  aborted: 'Cancelled',
};

function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}

function nearBottom(): boolean {
  const doc = document.documentElement;
  return window.innerHeight + window.scrollY >= doc.scrollHeight - 160;
}

export function renderDiff(diff: DiffPreview): HTMLElement {
  const pre = h('pre', { class: 'diff', attrs: { 'aria-label': `Changes to ${diff.path}` } });
  for (const line of diff.lines) {
    const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
    pre.append(h('span', { class: `diff-line diff-${line.kind}`, text: `${prefix} ${line.text}` }));
  }
  if (diff.truncated)
    pre.append(h('span', { class: 'diff-line diff-more', text: '… (truncated)' }));
  return h('div', { class: 'diff-wrap' }, h('div', { class: 'diff-path', text: diff.path }), pre);
}

export function runFinishedText(d: EventPayloads['run.finished']): string {
  const parts = [
    d.isError ? (d.subtype && d.subtype !== 'error' ? `Error (${d.subtype})` : 'Error') : 'Done',
    formatUsd(d.costUsd),
    formatDuration(d.durationMs),
    d.turns === 1 ? '1 turn' : `${d.turns} turns`,
  ];
  return parts.join(' · ');
}

export class Timeline {
  readonly el: HTMLElement;
  private readonly opts: TimelineOptions;
  private readonly assistant = new Map<string, AssistantEntry>();
  private readonly tools = new Map<string, ToolEntry>();
  private readonly approvals = new Map<string, ApprovalEntry>();
  private readonly dirty = new Set<string>();
  private rafPending = false;
  private scrollPending = false;
  private pendingIds: Set<string> | null = null;
  private detailSeq = 0;

  constructor(opts: TimelineOptions) {
    this.opts = opts;
    this.el = h('ol', {
      class: 'timeline',
      testid: 'timeline',
      attrs: { role: 'log', 'aria-live': 'off', 'aria-label': 'Session activity' },
    });
  }

  /** Approval ids that are waiting, from SessionDetail, and that detail's lastSeq. */
  setPending(ids: string[], lastSeq: number): void {
    this.pendingIds = new Set(ids);
    this.detailSeq = lastSeq;
    for (const [id, entry] of this.approvals) this.refreshApproval(id, entry);
  }

  get hasPendingApproval(): boolean {
    for (const [id, e] of this.approvals) if (this.isPending(id, e)) return true;
    return false;
  }

  apply(ev: SessionEvent, live: boolean): void {
    const stick = nearBottom();
    switch (ev.type) {
      case 'user.message':
        this.root().append(
          h(
            'li',
            { class: 'msg msg-user' },
            h('div', { class: 'bubble', text: ev.data.text }),
            ev.data.queued ? h('span', { class: 'tag tag-queued', text: 'Queued' }) : null,
          ),
        );
        break;
      case 'assistant.delta':
      case 'assistant.message': {
        const entry = this.assistantEntry(ev.data.messageId, ev.data.parentToolUseId);
        if (ev.type === 'assistant.delta') {
          entry.text += ev.data.text;
          this.markDirty(ev.data.messageId);
        } else {
          entry.text = ev.data.text;
          entry.el.classList.remove('streaming');
          this.dirty.delete(ev.data.messageId);
          setMarkdown(entry.body, entry.text);
          if (live && !ev.data.parentToolUseId) announce('New reply');
        }
        break;
      }
      case 'tool.start':
        this.toolStart(ev.data);
        break;
      case 'tool.end':
        this.toolEnd(ev.data);
        break;
      case 'approval.request':
        this.approvalRequest(ev.seq, ev.data);
        if (live) announce(`Approval needed: ${ev.data.title}`);
        break;
      case 'approval.resolved':
        this.approvalResolved(ev.data);
        break;
      case 'run.finished': {
        const d = ev.data;
        const li = h(
          'li',
          { class: `run-line ${d.isError ? 'run-error' : ''}`, testid: 'run-finished' },
          h('span', { text: runFinishedText(d) }),
        );
        if (d.isError && d.errors.length) {
          li.append(h('ul', { class: 'run-errors' }, ...d.errors.map((e) => h('li', { text: e }))));
        }
        this.root().append(li);
        if (live) announce(d.isError ? 'Run ended with an error' : 'Run finished');
        break;
      }
      case 'history.message': {
        const d = ev.data;
        this.root().append(
          h(
            'li',
            { class: `msg msg-history msg-${d.role === 'user' ? 'user' : 'assistant'}` },
            h('span', { class: 'tag', text: 'Imported' }),
            h('div', { class: 'bubble', text: d.text }),
            d.tools.length
              ? h('p', { class: 'history-tools', text: `Used: ${d.tools.join(', ')}` })
              : null,
          ),
        );
        break;
      }
      case 'notice':
        this.root().append(
          h('li', {
            class: `notice notice-${ev.data.level}`,
            text: ev.data.message,
            attrs: ev.data.level === 'error' ? { role: 'note' } : {},
          }),
        );
        break;
      case 'mode.changed':
      case 'session.renamed':
      case 'session.created':
      case 'run.started':
      case 'state':
        // Reflected in the header by the session view.
        break;
    }
    if (stick) this.scrollToBottom();
  }

  scrollToBottom(): void {
    if (this.scrollPending) return;
    this.scrollPending = true;
    requestAnimationFrame(() => {
      this.scrollPending = false;
      window.scrollTo({ top: document.documentElement.scrollHeight });
    });
  }

  // ------------------------------------------------------------ containers
  private root(): HTMLElement {
    return this.el;
  }

  private containerFor(parentToolUseId: string | null): HTMLElement {
    if (parentToolUseId) {
      const parent = this.tools.get(parentToolUseId);
      if (parent) return parent.children;
    }
    return this.el;
  }

  // ------------------------------------------------------------ assistant text
  private assistantEntry(messageId: string, parent: string | null): AssistantEntry {
    let entry = this.assistant.get(messageId);
    if (!entry) {
      const body = h('div', { class: 'bubble markdown' });
      const el = h('li', { class: 'msg msg-assistant streaming' }, body);
      this.containerFor(parent).append(el);
      entry = { el, body, text: '' };
      this.assistant.set(messageId, entry);
    }
    return entry;
  }

  private markDirty(id: string): void {
    this.dirty.add(id);
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const stick = nearBottom();
      for (const d of this.dirty) {
        const e = this.assistant.get(d);
        if (e) setMarkdown(e.body, e.text);
      }
      this.dirty.clear();
      if (stick) this.scrollToBottom();
    });
  }

  // ------------------------------------------------------------ tools
  private toolStart(d: EventPayloads['tool.start']): void {
    if (this.tools.has(d.toolUseId)) return;
    const status = h('span', { class: 'tool-status', text: 'Running' });
    const output = h('pre', { class: 'tool-output', attrs: { hidden: true } });
    const children = h('ol', { class: 'tool-children' });
    const details = h(
      'details',
      { class: 'tool-details' },
      h(
        'summary',
        { class: 'tool-summary' },
        h('span', { class: 'tool-dot', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'tool-name', text: d.name }),
        h('span', { class: 'tool-desc', text: d.summary }),
        status,
      ),
      h('div', { class: 'tool-body' }, output, children),
    );
    const li = h(
      'li',
      {
        class: 'tool tool-running',
        testid: 'tool-row',
        attrs: { 'data-tool-use-id': d.toolUseId },
      },
      details,
    );
    this.containerFor(d.parentToolUseId).append(li);
    this.tools.set(d.toolUseId, { li, details, status, output, children });
  }

  private toolEnd(d: EventPayloads['tool.end']): void {
    const t = this.tools.get(d.toolUseId);
    if (!t) return;
    t.li.classList.remove('tool-running');
    t.li.classList.add(d.isError ? 'tool-error' : 'tool-done');
    t.status.textContent = d.isError ? 'Failed' : 'Done';
    if (d.output) {
      t.output.hidden = false;
      t.output.textContent = truncate(d.output) + (d.truncated ? '\n… (output truncated)' : '');
    }
  }

  // ------------------------------------------------------------ approvals
  private approvalRequest(seq: number, d: EventPayloads['approval.request']): void {
    if (this.approvals.has(d.approvalId)) return;
    const buttons: HTMLButtonElement[] = [];
    const btn = (label: string, cls: string, testid: string, fn: () => void) => {
      const b = h('button', {
        class: `btn ${cls}`,
        text: label,
        testid,
        attrs: { type: 'button' },
      });
      b.addEventListener('click', fn);
      buttons.push(b);
      return b;
    };

    const noteId = `deny-note-${d.approvalId}`;
    const note = h('textarea', {
      class: 'input',
      id: noteId,
      testid: 'approval-deny-note',
      attrs: { rows: 2, placeholder: 'Optional: tell it what to do instead' },
    });
    const denyForm = h(
      'div',
      { class: 'deny-form', attrs: { hidden: true } },
      h('label', { class: 'label', text: 'Reason (optional)', attrs: { for: noteId } }),
      note,
      h(
        'div',
        { class: 'approval-actions' },
        btn('Back', '', 'approval-deny-cancel', () => {
          denyForm.hidden = true;
          actions.hidden = false;
        }),
        btn('Send deny', 'btn-danger', 'approval-deny-send', () => {
          void this.send(d.approvalId, 'deny', note.value.trim() || undefined);
        }),
      ),
    );

    const actions = h(
      'div',
      { class: 'approval-actions' },
      btn('Deny', 'btn-danger-outline', 'approval-deny', () => {
        actions.hidden = true;
        denyForm.hidden = false;
        note.focus();
      }),
      d.canAlwaysAllow
        ? btn('Always allow', '', 'approval-always', () => void this.send(d.approvalId, 'always'))
        : null,
      btn('Allow', 'btn-primary', 'approval-allow', () => void this.send(d.approvalId, 'allow')),
    );

    const body = h(
      'div',
      { class: 'approval-body' },
      d.summary ? h('pre', { class: 'approval-summary', text: d.summary }) : null,
      d.diff ? renderDiff(d.diff) : null,
      d.input
        ? h(
            'details',
            { class: 'approval-input' },
            h('summary', { text: 'Details' }),
            h('pre', { text: truncate(d.input, 20000) }),
          )
        : null,
    );
    const outcome = h('p', { class: 'approval-outcome', attrs: { hidden: true } });
    const li = h(
      'li',
      {
        class: 'approval',
        testid: 'approval-card',
        attrs: { 'data-approval-id': d.approvalId, 'aria-label': `Approval: ${d.title}` },
      },
      h(
        'div',
        { class: 'approval-head' },
        h('span', { class: 'approval-tool', text: d.toolName }),
        h('strong', { class: 'approval-title', text: d.title }),
      ),
      body,
      actions,
      denyForm,
      outcome,
    );
    this.containerFor(d.parentToolUseId).append(li);
    const entry: ApprovalEntry = { seq, li, body, actions, outcome, resolved: null, buttons };
    this.approvals.set(d.approvalId, entry);
    this.refreshApproval(d.approvalId, entry);
    // Keep pending approvals expanded inside a tool row.
    const parentTool = d.parentToolUseId ? this.tools.get(d.parentToolUseId) : undefined;
    if (parentTool) parentTool.details.open = true;
  }

  private approvalResolved(d: EventPayloads['approval.resolved']): void {
    const entry = this.approvals.get(d.approvalId);
    if (!entry) return;
    entry.resolved = d.resolution;
    this.collapse(
      entry,
      RESOLUTION_TEXT[d.resolution] + (d.note ? ` · “${d.note}”` : ''),
      d.resolution,
    );
  }

  private isPending(id: string, e: ApprovalEntry): boolean {
    if (e.resolved) return false;
    if (this.pendingIds === null) return true;
    return this.pendingIds.has(id) || e.seq > this.detailSeq;
  }

  private refreshApproval(id: string, e: ApprovalEntry): void {
    if (e.resolved) return;
    if (this.isPending(id, e)) {
      e.li.classList.remove('approval-done');
      e.body.hidden = false;
      e.actions.hidden = false;
      e.outcome.hidden = true;
      delete e.outcome.dataset['testid'];
      for (const b of e.buttons) b.disabled = false;
    } else {
      this.collapse(e, 'Expired', 'expired');
    }
  }

  private collapse(e: ApprovalEntry, text: string, kind: ApprovalResolution): void {
    e.li.classList.add('approval-done', `approval-${kind}`);
    e.body.hidden = true;
    e.actions.hidden = true;
    const deny = e.li.querySelector<HTMLElement>('.deny-form');
    if (deny) deny.hidden = true;
    e.outcome.hidden = false;
    e.outcome.textContent = text;
    if (kind === 'expired') e.outcome.dataset['testid'] = 'approval-expired';
    else delete e.outcome.dataset['testid'];
  }

  private async send(approvalId: string, decision: ApprovalDecision, note?: string): Promise<void> {
    const e = this.approvals.get(approvalId);
    if (!e || e.resolved) return;
    for (const b of e.buttons) b.disabled = true;
    try {
      await this.opts.answer(approvalId, decision, note);
      // The approval.resolved event collapses the card. Show progress until then.
      if (!e.resolved) {
        e.outcome.hidden = false;
        e.outcome.textContent = 'Sending…';
      }
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        (err.status === 404 || err.status === 409 || err.status === 410)
      ) {
        e.resolved = 'expired';
        this.collapse(e, 'Expired', 'expired');
        toast(err.message, 'error');
        return;
      }
      toast(errorMessage(err), 'error');
      for (const b of e.buttons) b.disabled = false;
    }
  }
}
