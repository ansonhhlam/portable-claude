import type { Config, Secrets } from './config.js';

export type AgentEnvResult =
  { ok: true; env: Record<string, string | undefined> } | { ok: false; error: string };

const PROVIDER_FLAG: Record<Exclude<Config['provider'], 'anthropic'>, string> = {
  bedrock: 'CLAUDE_CODE_USE_BEDROCK',
  vertex: 'CLAUDE_CODE_USE_VERTEX',
  foundry: 'CLAUDE_CODE_USE_FOUNDRY',
};

/** Variables that could make the agent authenticate with a claude.ai login. */
const STRIPPED = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN'];

/**
 * Build the environment for agent processes. Only an Anthropic API key or a
 * supported cloud provider is ever used; claude.ai login tokens are removed.
 */
export function buildAgentEnv(
  config: Pick<Config, 'provider'>,
  secrets: Pick<Secrets, 'apiKey' | 'providerEnv'>,
  base: NodeJS.ProcessEnv = process.env,
): AgentEnvResult {
  const env: Record<string, string | undefined> = { ...base, ...secrets.providerEnv };
  for (const k of STRIPPED) delete env[k];
  if (config.provider === 'anthropic') {
    for (const flag of Object.values(PROVIDER_FLAG)) delete env[flag];
    const key = base.ANTHROPIC_API_KEY || secrets.apiKey;
    if (!key) {
      return {
        ok: false,
        error:
          'No Anthropic API key is configured. Run `longcord setup` or set ANTHROPIC_API_KEY on the computer running longcord.',
      };
    }
    env.ANTHROPIC_API_KEY = key;
    return { ok: true, env };
  }
  env[PROVIDER_FLAG[config.provider]] = '1';
  return { ok: true, env };
}

export function hasCredentials(
  config: Pick<Config, 'provider'>,
  secrets: Pick<Secrets, 'apiKey' | 'providerEnv'>,
  base: NodeJS.ProcessEnv = process.env,
): boolean {
  return buildAgentEnv(config, secrets, base).ok;
}
