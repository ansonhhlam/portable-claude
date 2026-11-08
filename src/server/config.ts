import { z } from 'zod';
import { PERMISSION_MODES } from '../shared/api.js';
import { JsonFile } from './fsutil.js';

export const DEFAULT_PORT = 8417;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
});

/** Every key is documented in docs/reference/configuration.md. */
export const ConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(DEFAULT_PORT),
  host: z.enum(['127.0.0.1', '::1', 'localhost']).default('127.0.0.1'),
  publicUrl: z.string().url().startsWith('https://').nullable().default(null),
  projects: z.array(ProjectSchema).default([]),
  provider: z.enum(['anthropic', 'bedrock', 'vertex', 'foundry']).default('anthropic'),
  models: z.array(z.string().min(1)).default([]),
  defaultModel: z.string().min(1).nullable().default(null),
  defaultMode: z.enum(PERMISSION_MODES).default('default'),
  dailySpendCapUsd: z.number().positive().nullable().default(null),
  idleTimeoutMinutes: z
    .number()
    .positive()
    .max(24 * 60)
    .default(15),
  maxToolOutputChars: z.number().int().min(200).max(100_000).default(4000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logContent: z.boolean().default(false),
  logMaxBytes: z
    .number()
    .int()
    .min(64 * 1024)
    .default(5 * 1024 * 1024),
  logMaxFiles: z.number().int().min(1).max(50).default(5),
  dailyRestart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM (24h)')
    .nullable()
    .default(null),
  keepAwake: z.boolean().default(false),
  pushSubject: z
    .string()
    .regex(/^(mailto:|https:\/\/)/, 'must start with mailto: or https://')
    .default('https://github.com/ansonhhlam/portable-claude'),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export const CONFIG_KEYS = Object.keys(ConfigSchema.shape) as (keyof Config)[];

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

/** Keys present in a raw config object that the schema does not know. */
export function unknownConfigKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.keys(raw).filter((k) => !(k in ConfigSchema.shape));
}

/** Parse a CLI string value for `config set` into the right type for `key`. */
export function parseConfigValue(key: keyof Config, value: string): unknown {
  const shape = ConfigSchema.shape[key];
  if (value === 'null') return null;
  const probe = shape.safeParse(value);
  if (probe.success) return probe.data;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  if (value.startsWith('[')) return JSON.parse(value) as unknown;
  return value;
}

export function setConfigValue(cfg: Config, key: string, value: string): Config {
  if (!(key in ConfigSchema.shape)) throw new Error(`Unknown config key: ${key}`);
  const k = key as keyof Config;
  const next = { ...cfg, [k]: parseConfigValue(k, value) };
  const res = ConfigSchema.safeParse(next);
  if (!res.success) throw new Error(`Invalid value for ${key}: ${res.error.issues[0]?.message}`);
  return res.data;
}

export function configFile(file: string): JsonFile<Config> {
  return new JsonFile(file, ConfigSchema, defaultConfig);
}

// ------------------------------------------------------------- secrets

export const SecretsSchema = z.object({
  apiKey: z.string().min(1).nullable().default(null),
  /** Extra environment for cloud providers (e.g. CLAUDE_CODE_USE_BEDROCK, AWS_REGION). */
  providerEnv: z.record(z.string(), z.string()).default({}),
  cookieSecret: z.string().min(32).nullable().default(null),
  passcodeHash: z.string().nullable().default(null),
  vapidPublicKey: z.string().nullable().default(null),
  vapidPrivateKey: z.string().nullable().default(null),
});
export type Secrets = z.infer<typeof SecretsSchema>;

export function secretsFile(file: string): JsonFile<Secrets> {
  return new JsonFile(file, SecretsSchema, () => SecretsSchema.parse({}), 0o600);
}
