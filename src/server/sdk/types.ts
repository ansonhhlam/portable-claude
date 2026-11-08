// The subset of the Claude Agent SDK this server relies on. The real SDK
// satisfies these types structurally; the mock implements them for tests and demos.
import type {
  CanUseTool,
  ListSessionsOptions,
  Options,
  PermissionMode,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
  GetSessionMessagesOptions,
} from '@anthropic-ai/claude-agent-sdk';

export type {
  CanUseTool,
  Options,
  PermissionMode,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
};
export type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

export interface AgentQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  close(): void;
}

export interface AgentSdk {
  readonly kind: 'real' | 'mock';
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): AgentQuery;
  listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
  getSessionMessages(
    sessionId: string,
    options?: GetSessionMessagesOptions,
  ): Promise<SessionMessage[]>;
}
