// A scripted stand-in for the Claude Agent SDK. It never touches the network
// or the filesystem and is used by the test suite, demos and screenshots.
//
// The reply depends on keywords in the prompt:
//   "fail"      the run ends with an error
//   "wait"      the agent works until interrupted
//   "subagent"  a Task tool call with nested subagent activity
//   "bash"/"test"  a Bash command that needs approval
//   "edit"/"fix"   a file read plus an Edit that needs approval
//   anything else  a short text reply
import { randomUUID } from 'node:crypto';
import { AsyncQueue, sleep } from '../queue.js';
import type {
  AgentQuery,
  AgentSdk,
  CanUseTool,
  Options,
  PermissionMode,
  PermissionUpdate,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
} from './types.js';

export interface MockSdkOptions {
  /** Delay between streamed chunks, in ms. */
  delayMs?: number;
  /** Sessions reported by listSessions (simulating sessions started in a terminal). */
  sessions?: SDKSessionInfo[];
  history?: Record<string, SessionMessage[]>;
  costPerTurnUsd?: number;
}

export const MOCK_TERMINAL_SESSION_ID = '0b5e7c4e-6a43-4b8e-9d2a-1f3c5a7e9b10';

const DEFAULT_SESSIONS: SDKSessionInfo[] = [
  {
    sessionId: MOCK_TERMINAL_SESSION_ID,
    summary: 'Add input validation to the signup form',
    lastModified: Date.UTC(2026, 0, 15, 9, 30),
    gitBranch: 'feature/signup-validation',
    firstPrompt: 'Add input validation to the signup form',
  },
];

const DEFAULT_HISTORY: Record<string, SessionMessage[]> = {
  [MOCK_TERMINAL_SESSION_ID]: [
    msg('user', 'Add input validation to the signup form'),
    msg('assistant', [
      { type: 'text', text: 'I added validation for the email and password fields.' },
      { type: 'tool_use', id: 'toolu_hist_1', name: 'Edit', input: { file_path: 'src/signup.ts' } },
    ]),
    msg('user', 'Thanks. Can you also add tests?'),
    msg('assistant', [{ type: 'text', text: 'Sure. I will add tests in the next step.' }]),
  ],
};

function msg(type: 'user' | 'assistant', content: unknown): SessionMessage {
  return {
    type,
    uuid: randomUUID(),
    session_id: MOCK_TERMINAL_SESSION_ID,
    message: { role: type, content },
    parent_tool_use_id: null,
    parent_agent_id: null,
  };
}

export interface MockSdk extends AgentSdk {
  readonly queries: MockQuery[];
}

export function createMockSdk(opts: MockSdkOptions = {}): MockSdk {
  const queries: MockQuery[] = [];
  return {
    kind: 'mock',
    queries,
    query(params) {
      const q = new MockQuery(params.prompt, params.options, opts);
      queries.push(q);
      return q;
    },
    async listSessions() {
      return structuredClone(opts.sessions ?? DEFAULT_SESSIONS);
    },
    async getSessionMessages(id) {
      return structuredClone((opts.history ?? DEFAULT_HISTORY)[id] ?? []);
    },
  };
}

type Step =
  | { kind: 'text'; text: string; parent?: string }
  | {
      kind: 'tool';
      name: string;
      input: Record<string, unknown>;
      result: string;
      parent?: string;
      id?: string;
    }
  | { kind: 'wait' }
  | { kind: 'fail'; error: string };

function scriptFor(text: string): Step[] {
  const t = text.toLowerCase();
  if (t.includes('fail')) {
    return [
      { kind: 'text', text: 'Starting, but this run is set up to fail.' },
      { kind: 'fail', error: 'Mock failure requested' },
    ];
  }
  const steps: Step[] = [];
  if (t.includes('wait')) {
    steps.push({ kind: 'text', text: 'Working on a long task…' }, { kind: 'wait' });
    return steps;
  }
  if (t.includes('subagent')) {
    const id = 'toolu_' + randomUUID().slice(0, 8);
    steps.push(
      { kind: 'text', text: 'I will ask a subagent to research this.' },
      {
        kind: 'tool',
        id,
        name: 'Task',
        input: { description: 'Survey the codebase', prompt: 'Find all API routes' },
        result: 'Found 4 routes in src/routes.',
      },
    );
    // Nested steps are emitted while the Task tool is running (see runTool).
  }
  if (t.includes('bash') || t.includes('test')) {
    steps.push(
      { kind: 'text', text: 'Let me run the test suite.' },
      { kind: 'tool', name: 'Bash', input: { command: 'npm test', description: 'Run tests' }, result: '12 passing (1.2s)' },
    );
  }
  if (t.includes('edit') || t.includes('fix')) {
    steps.push(
      { kind: 'text', text: 'I will look at the file first.' },
      {
        kind: 'tool',
        name: 'Read',
        input: { file_path: 'src/app.ts' },
        result: 'export function greet(name) {\n  return "Hello " + name;\n}\n',
      },
      {
        kind: 'tool',
        name: 'Edit',
        input: {
          file_path: 'src/app.ts',
          old_string: 'export function greet(name) {\n  return "Hello " + name;',
          new_string: 'export function greet(name: string): string {\n  return `Hello ${name}`;',
        },
        result: 'The file src/app.ts has been updated.',
      },
    );
  }
  steps.push({
    kind: 'text',
    text: steps.length
      ? 'All done. **Summary:** the requested change is complete.'
      : `Mock reply: you said "${text.slice(0, 80)}". This server is running the **mock agent**, so no API calls were made.`,
  });
  return steps;
}

export class MockQuery implements AgentQuery {
  private out = new AsyncQueue<SDKMessage>();
  private mode: PermissionMode;
  private turnAbort: AbortController | null = null;
  private closed = false;
  private readonly sessionId: string;
  private allowRules = new Set<string>();
  private costSoFar = 0;
  readonly received: string[] = [];
  readonly modeChanges: PermissionMode[] = [];

  constructor(
    private readonly prompt: AsyncIterable<SDKUserMessage>,
    private readonly options: Options,
    private readonly opts: MockSdkOptions,
  ) {
    this.mode = options.permissionMode ?? 'default';
    this.sessionId = options.resume ?? randomUUID();
    void this.run();
  }

  get permissionMode(): PermissionMode {
    return this.mode;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private get delay(): number {
    return this.opts.delayMs ?? 40;
  }

  private emit(m: Record<string, unknown>): void {
    if (!this.out.isEnded) this.out.push(m as unknown as SDKMessage);
  }

  private async run(): Promise<void> {
    this.emit({
      type: 'system',
      subtype: 'init',
      session_id: this.sessionId,
      cwd: this.options.cwd ?? '',
      model: this.options.model ?? 'mock-model',
      permissionMode: this.mode,
      tools: ['Bash', 'Read', 'Edit', 'Write', 'Task'],
      uuid: randomUUID(),
    });
    try {
      for await (const m of this.prompt) {
        if (this.closed) break;
        const content = m.message.content;
        const text =
          typeof content === 'string'
            ? content
            : content.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : '')).join('');
        this.received.push(text);
        await this.turn(text);
      }
    } finally {
      this.out.end();
    }
  }

  private async turn(text: string): Promise<void> {
    const ac = new AbortController();
    this.turnAbort = ac;
    const started = Date.now();
    let turns = 1;
    let error: string | null = null;
    try {
      for (const step of scriptFor(text)) {
        if (step.kind === 'text') await this.streamText(step.text, ac.signal, step.parent ?? null);
        else if (step.kind === 'tool') {
          turns++;
          await this.runTool(step, ac.signal);
        } else if (step.kind === 'wait') await sleep(10 * 60_000, ac.signal);
        else if (step.kind === 'fail') error = step.error;
      }
    } catch (err) {
      if (!ac.signal.aborted) throw err;
      error = 'Interrupted by user';
    } finally {
      this.turnAbort = null;
    }
    this.costSoFar += (this.opts.costPerTurnUsd ?? 0.0042) * turns;
    this.emit({
      type: 'result',
      subtype: error ? 'error_during_execution' : 'success',
      is_error: !!error,
      duration_ms: Date.now() - started,
      duration_api_ms: Date.now() - started,
      num_turns: turns,
      result: error ? '' : 'done',
      errors: error ? [error] : [],
      stop_reason: null,
      // Like the real SDK, cost is cumulative for the life of the query.
      total_cost_usd: Number(this.costSoFar.toFixed(6)),
      usage: {},
      modelUsage: {},
      permission_denials: [],
      uuid: randomUUID(),
      session_id: this.sessionId,
    });
  }

  private async streamText(text: string, signal: AbortSignal, parent: string | null): Promise<void> {
    const id = 'msg_' + randomUUID().slice(0, 12);
    const wrap = (event: unknown) =>
      this.emit({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: randomUUID(), session_id: this.sessionId });
    wrap({ type: 'message_start', message: { id, role: 'assistant', content: [] } });
    wrap({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    const chunks = text.match(/\S+\s*/g) ?? [text];
    for (const c of chunks) {
      if (this.delay) await sleep(this.delay, signal);
      else if (signal.aborted) throw new Error('aborted');
      wrap({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } });
    }
    wrap({ type: 'content_block_stop', index: 0 });
    this.emit({
      type: 'assistant',
      message: { id, role: 'assistant', content: [{ type: 'text', text }] },
      parent_tool_use_id: parent,
      uuid: randomUUID(),
      session_id: this.sessionId,
    });
    wrap({ type: 'message_stop' });
  }

  private needsApproval(name: string, input: Record<string, unknown>): boolean {
    if (this.allowRules.has(ruleKey(name, input))) return false;
    switch (this.mode) {
      case 'bypassPermissions':
        return false;
      case 'acceptEdits':
      case 'auto':
        return name === 'Bash';
      case 'plan':
      case 'default':
      case 'dontAsk':
        return name === 'Bash' || name === 'Edit' || name === 'Write';
    }
  }

  private async runTool(
    step: Extract<Step, { kind: 'tool' }>,
    signal: AbortSignal,
  ): Promise<void> {
    const id = step.id ?? 'toolu_' + randomUUID().slice(0, 12);
    const parent = step.parent ?? null;
    this.emit({
      type: 'assistant',
      message: {
        id: 'msg_' + randomUUID().slice(0, 12),
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: step.name, input: step.input }],
      },
      parent_tool_use_id: parent,
      uuid: randomUUID(),
      session_id: this.sessionId,
    });
    let result = step.result;
    let isError = false;
    if (this.mode === 'plan' && (step.name === 'Edit' || step.name === 'Write')) {
      result = 'Plan mode: file changes are not allowed until the plan is approved.';
      isError = true;
    } else if (this.needsApproval(step.name, step.input)) {
      const can: CanUseTool | undefined = this.options.canUseTool;
      const suggestions: PermissionUpdate[] = [
        {
          type: 'addRules',
          rules: [{ toolName: step.name, ...ruleContent(step.name, step.input) }],
          behavior: 'allow',
          destination: 'session',
        },
      ];
      const decision = can
        ? await can(step.name, step.input, {
            signal,
            suggestions,
            toolUseID: id,
            requestId: randomUUID(),
            ...(parent ? { agentID: parent } : {}),
          })
        : { behavior: 'deny' as const, message: 'No permission handler' };
      if (signal.aborted) throw new Error('aborted');
      if (!decision || decision.behavior === 'deny') {
        result = `Permission denied${decision?.message ? `: ${decision.message}` : ''}`;
        isError = true;
      } else {
        for (const u of decision.updatedPermissions ?? []) {
          if (u.type === 'addRules' && u.behavior === 'allow') {
            for (const r of u.rules) this.allowRules.add(`${r.toolName}:${r.ruleContent ?? ''}`);
          }
        }
      }
    }
    if (step.name === 'Task' && !isError) {
      // Subagent activity, attributed to the parent Task tool call.
      await this.streamText('Looking through the routes folder.', signal, id);
      await this.runTool(
        { kind: 'tool', name: 'Read', input: { file_path: 'src/routes/index.ts' }, result: '…', parent: id },
        signal,
      );
    }
    if (this.delay) await sleep(this.delay * 2, signal);
    this.emit({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }],
      },
      parent_tool_use_id: parent,
      uuid: randomUUID(),
      session_id: this.sessionId,
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.out[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<undefined> {
    this.turnAbort?.abort(new Error('interrupted'));
    return undefined;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode;
    this.modeChanges.push(mode);
  }

  close(): void {
    this.closed = true;
    this.turnAbort?.abort(new Error('closed'));
    this.out.end();
  }
}

function ruleContent(name: string, input: Record<string, unknown>): { ruleContent?: string } {
  if (name === 'Bash' && typeof input.command === 'string') return { ruleContent: input.command };
  return {};
}

function ruleKey(name: string, input: Record<string, unknown>): string {
  return `${name}:${ruleContent(name, input).ruleContent ?? ''}`;
}
