import readline from 'node:readline';
import { configFile, secretsFile, type Config, type Secrets } from '../server/config.js';
import type { JsonFile } from '../server/fsutil.js';
import { dataPaths, defaultDataDir, type DataPaths } from '../server/paths.js';
import type { OsLayer } from './os.js';
import { realOs } from './os.js';

export interface Prompter {
  ask(question: string, opts?: { secret?: boolean; default?: string }): Promise<string>;
  confirm(question: string, def?: boolean): Promise<boolean>;
}

export interface CliContext {
  os: OsLayer;
  paths: DataPaths;
  config: JsonFile<Config>;
  secrets: JsonFile<Secrets>;
  out(line?: string): void;
  err(line?: string): void;
  prompt: Prompter;
  interactive: boolean;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function terminalPrompter(input = process.stdin, output = process.stdout): Prompter {
  const ask = (question: string, opts: { secret?: boolean; default?: string } = {}) =>
    new Promise<string>((resolve) => {
      const rl = readline.createInterface({ input, output, terminal: true });
      const suffix = opts.default ? ` (${opts.default})` : '';
      if (opts.secret) {
        // Hide typed characters for secrets.
        const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
        let prompted = false;
        anyRl._writeToOutput = (s: string) => {
          if (!prompted) {
            output.write(s);
            prompted = true;
          } else if (s.includes('\n') || s.includes('\r')) output.write('\n');
        };
      }
      rl.question(`${question}${suffix}: `, (answer) => {
        rl.close();
        resolve(answer.trim() || opts.default || '');
      });
    });
  return {
    ask,
    async confirm(question, def = true) {
      const a = (await ask(`${question} [${def ? 'Y/n' : 'y/N'}]`)).toLowerCase();
      if (!a) return def;
      return a === 'y' || a === 'yes';
    },
  };
}

export function createContext(overrides: Partial<CliContext> = {}): CliContext {
  const os = overrides.os ?? realOs();
  const root = defaultDataDir(os.env, os.platform, os.homedir);
  const paths = overrides.paths ?? dataPaths(root);
  return {
    os,
    paths,
    config: overrides.config ?? configFile(paths.config),
    secrets: overrides.secrets ?? secretsFile(paths.secrets),
    out: overrides.out ?? ((l = '') => process.stdout.write(l + '\n')),
    err: overrides.err ?? ((l = '') => process.stderr.write(l + '\n')),
    prompt: overrides.prompt ?? terminalPrompter(),
    interactive: overrides.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY),
  };
}
