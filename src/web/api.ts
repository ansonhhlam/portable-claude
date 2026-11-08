// Typed client for the longcord server API (same origin, cookie auth).
import type {
  ApiError,
  ApprovalAnswerRequest,
  CreateSessionRequest,
  DeviceInfo,
  ImportCandidate,
  ImportRequest,
  LoginRequest,
  PairRequest,
  PermissionModeName,
  PushSubscribeRequest,
  SessionDetail,
  SpendInfo,
  StateResponse,
  UpdateSessionRequest,
} from '../shared/api.js';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called whenever an API request returns 401 (except login and pairing). */
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

function isApiError(v: unknown): v is ApiError {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ApiError).error === 'string' &&
    typeof (v as ApiError).code === 'string'
  );
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { authFlow?: boolean } = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  };
  if (method !== 'GET') {
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError(0, 'network', 'Cannot reach your computer. Check your connection.');
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.authFlow) unauthorizedHandler?.();
    if (isApiError(data)) throw new ApiRequestError(res.status, data.code, data.error);
    throw new ApiRequestError(res.status, `http_${res.status}`, `Request failed (${res.status}).`);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  pair: (body: PairRequest) => request<unknown>('POST', '/api/auth/pair', body, { authFlow: true }),
  login: (body: LoginRequest) =>
    request<unknown>('POST', '/api/auth/login', body, { authFlow: true }),
  logout: () => request<unknown>('POST', '/api/auth/logout', {}, { authFlow: true }),

  state: () => request<StateResponse>('GET', '/api/state'),
  session: (id: string) => request<SessionDetail>('GET', `/api/sessions/${enc(id)}`),
  createSession: (body: CreateSessionRequest) =>
    request<SessionDetail>('POST', '/api/sessions', body),
  updateSession: (id: string, body: UpdateSessionRequest) =>
    request<SessionDetail>('PATCH', `/api/sessions/${enc(id)}`, body),
  deleteSession: (id: string) => request<unknown>('DELETE', `/api/sessions/${enc(id)}`),
  sendMessage: (id: string, text: string) =>
    request<unknown>('POST', `/api/sessions/${enc(id)}/messages`, { text }),
  interrupt: (id: string) => request<unknown>('POST', `/api/sessions/${enc(id)}/interrupt`, {}),
  setMode: (id: string, mode: PermissionModeName, confirmBypass = false) =>
    request<unknown>('POST', `/api/sessions/${enc(id)}/mode`, { mode, confirmBypass }),
  answerApproval: (id: string, approvalId: string, body: ApprovalAnswerRequest) =>
    request<unknown>('POST', `/api/sessions/${enc(id)}/approvals/${enc(approvalId)}`, body),

  importCandidates: (projectId: string) =>
    request<ImportCandidate[]>('GET', `/api/import/candidates?projectId=${enc(projectId)}`),
  importSession: (body: ImportRequest) => request<SessionDetail>('POST', '/api/import', body),

  devices: () => request<DeviceInfo[]>('GET', '/api/devices'),
  revokeDevice: (id: string) => request<unknown>('DELETE', `/api/devices/${enc(id)}`),
  spend: () => request<SpendInfo>('GET', '/api/spend'),

  pushKey: () => request<{ publicKey: string }>('GET', '/api/push/key'),
  pushSubscribe: (body: PushSubscribeRequest) =>
    request<unknown>('POST', '/api/push/subscribe', body),
  pushUnsubscribe: (endpoint: string) =>
    request<unknown>('DELETE', '/api/push/subscribe', { endpoint }),
  pushTest: () => request<unknown>('POST', '/api/push/test', {}),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
