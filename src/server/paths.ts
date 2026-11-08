import os from 'node:os';
import path from 'node:path';

/**
 * Per-OS data directory:
 *  - Windows: %APPDATA%\longcord
 *  - macOS:   ~/Library/Application Support/longcord
 *  - Linux:   $XDG_DATA_HOME/longcord (default ~/.local/share/longcord)
 * `LONGCORD_HOME` overrides it (useful for tests and portable installs).
 */
export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.LONGCORD_HOME) return path.resolve(env.LONGCORD_HOME);
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'longcord');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'longcord');
  return path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'longcord');
}

export interface DataPaths {
  root: string;
  config: string;
  secrets: string;
  schema: string;
  devices: string;
  pairing: string;
  push: string;
  spend: string;
  sessions: string;
  logs: string;
  backups: string;
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    config: path.join(root, 'config.json'),
    secrets: path.join(root, 'secrets.json'),
    schema: path.join(root, 'schema.json'),
    devices: path.join(root, 'devices.json'),
    pairing: path.join(root, 'pairing.json'),
    push: path.join(root, 'push-subscriptions.json'),
    spend: path.join(root, 'spend.json'),
    sessions: path.join(root, 'sessions'),
    logs: path.join(root, 'logs'),
    backups: path.join(root, 'backups'),
  };
}
