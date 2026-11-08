import type { AgentSdk } from './types.js';

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

let mod: Promise<SdkModule> | undefined;
const load = (): Promise<SdkModule> => (mod ??= import('@anthropic-ai/claude-agent-sdk'));

/**
 * Adapter over the installed Claude Agent SDK. The module is loaded lazily so
 * commands that never start an agent stay fast.
 */
export function createRealSdk(): AgentSdk {
  return {
    kind: 'real',
    query(params) {
      // query() is synchronous in the SDK; wrap it so the lazy import stays hidden.
      let inner: ReturnType<SdkModule['query']> | undefined;
      const ready = load().then((m) => (inner = m.query(params)));
      return {
        async *[Symbol.asyncIterator]() {
          const q = await ready;
          yield* q;
        },
        async interrupt() {
          return (await ready).interrupt();
        },
        async setPermissionMode(mode) {
          await (await ready).setPermissionMode(mode);
        },
        close() {
          if (inner) inner.close();
          else void ready.then((q) => q.close()).catch(() => undefined);
        },
      };
    },
    async listSessions(options) {
      return (await load()).listSessions(options);
    },
    async getSessionMessages(id, options) {
      return (await load()).getSessionMessages(id, options);
    },
  };
}
