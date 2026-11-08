// API contract shared by the server, the CLI and the web app.
// Everything here is plain data: safe to serialize as JSON.

export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
] as const;
export type PermissionModeName = (typeof PERMISSION_MODES)[number];

export type SessionState = 'idle' | 'working' | 'waiting';

export interface ProjectInfo {
  id: string;
  name: string;
  /** Absolute path on the server machine. */
  path: string;
}

export interface SessionTotals {
  costUsd: number;
  durationMs: number;
  turns: number;
  runs: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  mode: PermissionModeName;
  model: string | null;
  state: SessionState;
  archived: boolean;
  imported: boolean;
  createdAt: string;
  updatedAt: string;
  /** Number of approvals waiting for an answer. */
  pendingApprovals: number;
  /** Highest event sequence number in the session log. */
  lastSeq: number;
  totals: SessionTotals;
  preview: string;
}

export interface SessionDetail extends SessionSummary {
  /** Approval ids that are currently waiting. Others are expired or answered. */
  pendingApprovalIds: string[];
}

export interface SpendInfo {
  todayUsd: number;
  dailyCapUsd: number | null;
  capReached: boolean;
  /** Local date (YYYY-MM-DD) the numbers refer to. */
  date: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

export interface MeInfo {
  deviceId: string;
  deviceName: string;
  version: string;
  models: string[];
  defaultModel: string | null;
  mock: boolean;
}

export interface StateResponse {
  me: MeInfo;
  sessions: SessionSummary[];
  projects: ProjectInfo[];
  spend: SpendInfo;
}

export interface CreateSessionRequest {
  projectId: string;
  prompt: string;
  mode: PermissionModeName;
  model?: string | null;
  title?: string;
  /** Optional sub-folder of the project, relative to its root. */
  cwd?: string;
  /** Required when mode is bypassPermissions. */
  confirmBypass?: boolean;
}

export interface UpdateSessionRequest {
  title?: string;
  archived?: boolean;
}

export interface SendMessageRequest {
  text: string;
}

export interface SetModeRequest {
  mode: PermissionModeName;
  confirmBypass?: boolean;
}

export type ApprovalDecision = 'allow' | 'deny' | 'always';

export interface ApprovalAnswerRequest {
  decision: ApprovalDecision;
  note?: string;
}

export interface ImportCandidate {
  sdkSessionId: string;
  summary: string;
  lastModified: number;
  gitBranch: string | null;
}

export interface ImportRequest {
  projectId: string;
  sdkSessionId: string;
}

export interface LoginRequest {
  passcode: string;
  deviceName?: string;
}

export interface PairRequest {
  token: string;
  deviceName?: string;
}

export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface ApiError {
  error: string;
  code: string;
}

// ---------------------------------------------------------------- events

export type ApprovalResolution = 'allow' | 'deny' | 'always' | 'expired' | 'aborted';

export interface DiffPreview {
  path: string;
  /** Unified-diff style lines, already truncated. */
  lines: { kind: 'add' | 'del' | 'ctx'; text: string }[];
  truncated: boolean;
}

/** Payloads for every event kind, keyed by `type`. */
export interface EventPayloads {
  'session.created': { title: string; projectId: string; mode: PermissionModeName };
  'session.renamed': { title: string };
  'user.message': { text: string; queued: boolean };
  'assistant.delta': { messageId: string; text: string; parentToolUseId: string | null };
  'assistant.message': { messageId: string; text: string; parentToolUseId: string | null };
  'tool.start': {
    toolUseId: string;
    name: string;
    summary: string;
    parentToolUseId: string | null;
  };
  'tool.end': {
    toolUseId: string;
    isError: boolean;
    output: string;
    truncated: boolean;
  };
  'approval.request': {
    approvalId: string;
    toolName: string;
    title: string;
    summary: string;
    input: string;
    diff: DiffPreview | null;
    canAlwaysAllow: boolean;
    parentToolUseId: string | null;
  };
  'approval.resolved': { approvalId: string; resolution: ApprovalResolution; note?: string };
  'run.started': { runId: string };
  'run.finished': {
    runId: string;
    isError: boolean;
    subtype: string;
    costUsd: number;
    durationMs: number;
    turns: number;
    errors: string[];
  };
  state: { state: SessionState };
  'mode.changed': { mode: PermissionModeName };
  'history.message': {
    role: 'user' | 'assistant';
    text: string;
    tools: string[];
  };
  notice: { level: 'info' | 'warn' | 'error'; message: string };
}

export type EventType = keyof EventPayloads;

export type SessionEvent = {
  [K in EventType]: { seq: number; ts: string; type: K; data: EventPayloads[K] };
}[EventType];

/** Messages on the global `/api/events` stream (not persisted). */
export type GlobalEvent =
  | { type: 'hello'; ts: string }
  | { type: 'sessions.changed'; ts: string; sessionId: string }
  | { type: 'spend.changed'; ts: string };
