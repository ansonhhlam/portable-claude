import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalResolution } from '../shared/api.js';
import type { EventLog } from './eventlog.js';
import type { PermissionResult, PermissionUpdate } from './sdk/types.js';
import { diffPreview, inputJson, summarizeTool } from './summarize.js';

interface Pending {
  sessionId: string;
  log: EventLog;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
  cleanup: () => void;
}

export interface ApprovalRequestOptions {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  toolUseID?: string;
  agentID?: string;
  title?: string;
  suppressAlwaysAllowRule?: boolean;
}

export type ApprovalListener = (sessionId: string, toolName: string, summary: string) => void;

/** Tracks permission requests from the agent until the user answers them. */
export class Approvals {
  private pending = new Map<string, Pending>();
  private onRequest: ApprovalListener[] = [];
  private onSettled: ((sessionId: string) => void)[] = [];

  onRequested(fn: ApprovalListener): void {
    this.onRequest.push(fn);
  }

  onResolved(fn: (sessionId: string) => void): void {
    this.onSettled.push(fn);
  }

  request(
    sessionId: string,
    log: EventLog,
    toolName: string,
    input: Record<string, unknown>,
    opts: ApprovalRequestOptions,
  ): Promise<PermissionResult> {
    const approvalId = randomUUID();
    const summary = summarizeTool(toolName, input);
    const suggestions = opts.suggestions ?? [];
    return new Promise<PermissionResult>((resolve) => {
      if (opts.signal.aborted) {
        resolve({ behavior: 'deny', message: 'Cancelled' });
        return;
      }
      const onAbort = () => this.settle(approvalId, 'aborted', { behavior: 'deny', message: 'Cancelled' });
      opts.signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(approvalId, {
        sessionId,
        log,
        input,
        suggestions,
        resolve,
        cleanup: () => opts.signal.removeEventListener('abort', onAbort),
      });
      log.append('approval.request', {
        approvalId,
        toolName,
        title: opts.title ?? `Allow ${toolName}?`,
        summary,
        input: inputJson(input),
        diff: diffPreview(toolName, input),
        canAlwaysAllow: suggestions.length > 0 && !opts.suppressAlwaysAllowRule,
        parentToolUseId: opts.agentID ?? null,
      });
      for (const fn of this.onRequest) fn(sessionId, toolName, summary);
    });
  }

  /** Answer a pending request. Returns false if it is no longer pending. */
  answer(sessionId: string, approvalId: string, decision: ApprovalDecision, note?: string): boolean {
    const p = this.pending.get(approvalId);
    if (!p || p.sessionId !== sessionId) return false;
    const cleanNote = note?.trim().slice(0, 2000) || undefined;
    if (decision === 'deny') {
      this.settle(
        approvalId,
        'deny',
        {
          behavior: 'deny',
          message: cleanNote ? `The user denied this action: ${cleanNote}` : 'The user denied this action.',
        },
        cleanNote,
      );
    } else if (decision === 'always') {
      this.settle(approvalId, 'always', {
        behavior: 'allow',
        updatedInput: p.input,
        updatedPermissions: p.suggestions,
      });
    } else {
      this.settle(approvalId, 'allow', { behavior: 'allow', updatedInput: p.input });
    }
    return true;
  }

  private settle(id: string, resolution: ApprovalResolution, result: PermissionResult, note?: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.cleanup();
    p.log.append('approval.resolved', { approvalId: id, resolution, ...(note ? { note } : {}) });
    p.resolve(result);
    for (const fn of this.onSettled) fn(p.sessionId);
  }

  pendingFor(sessionId: string): string[] {
    return [...this.pending.entries()].filter(([, p]) => p.sessionId === sessionId).map(([id]) => id);
  }

  /** Deny everything pending for one session (e.g. on interrupt). */
  abortSession(sessionId: string, reason: string): void {
    for (const id of this.pendingFor(sessionId)) {
      this.settle(id, 'aborted', { behavior: 'deny', message: reason, interrupt: true }, reason);
    }
  }

  /** Deny everything (graceful shutdown). */
  denyAll(reason: string): void {
    for (const [id] of [...this.pending]) {
      this.settle(id, 'aborted', { behavior: 'deny', message: reason, interrupt: true }, reason);
    }
  }

  /**
   * Mark requests left open in a log (for example by a crash or restart) as expired.
   * Returns how many were expired.
   */
  static expireStale(log: EventLog, isPending: (id: string) => boolean): number {
    const open = new Set<string>();
    for (const ev of log.all()) {
      if (ev.type === 'approval.request') open.add(ev.data.approvalId);
      else if (ev.type === 'approval.resolved') open.delete(ev.data.approvalId);
    }
    let n = 0;
    for (const id of open) {
      if (isPending(id)) continue;
      log.append('approval.resolved', { approvalId: id, resolution: 'expired' });
      n++;
    }
    return n;
  }
}
