import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { readJsonSync, writeJsonAtomicSync } from './fsutil.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import type { DataPaths } from './paths.js';

export const SCHEMA_VERSION = 2;

const SchemaFile = z.object({ version: z.number().int().min(0) });

export interface Migration {
  to: number;
  description: string;
  up(paths: DataPaths): void;
}

export const MIGRATIONS: Migration[] = [
  {
    to: 1,
    description: 'create the data directory layout',
    up(p) {
      for (const d of [p.sessions, p.logs, p.backups]) fs.mkdirSync(d, { recursive: true });
    },
  },
  {
    to: 2,
    description: 'add usage totals, preview and import flag to session metadata',
    up(p) {
      if (!fs.existsSync(p.sessions)) return;
      for (const id of fs.readdirSync(p.sessions)) {
        const file = path.join(p.sessions, id, 'meta.json');
        if (!fs.existsSync(file)) continue;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        raw.totals ??= { costUsd: 0, durationMs: 0, turns: 0, runs: 0 };
        raw.preview ??= '';
        raw.imported ??= false;
        raw.archived ??= false;
        raw.model ??= null;
        raw.sdkSessionId ??= null;
        writeJsonAtomicSync(file, raw);
      }
    },
  },
];

export function currentVersion(paths: DataPaths): number {
  return readJsonSync(paths.schema, SchemaFile, () => ({ version: 0 })).version;
}

export interface MigrationResult {
  from: number;
  to: number;
  backup: string | null;
}

/**
 * Bring the data directory up to SCHEMA_VERSION. Before changing anything,
 * the previous state is copied into backups/. Refuses to run on data written
 * by a newer version.
 */
export function migrate(
  paths: DataPaths,
  log: Logger = silentLogger,
  migrations: Migration[] = MIGRATIONS,
  target = SCHEMA_VERSION,
): MigrationResult {
  fs.mkdirSync(paths.root, { recursive: true });
  const from = currentVersion(paths);
  if (from > target) {
    throw new Error(
      `Data directory uses schema v${from}, newer than this version supports (v${target}). Update longcord.`,
    );
  }
  if (from === target) return { from, to: target, backup: null };

  let backup: string | null = null;
  if (from > 0) backup = backupData(paths, from);

  let version = from;
  const pending = migrations.filter((m) => m.to > from && m.to <= target).sort((a, b) => a.to - b.to);
  for (const m of pending) {
    log.info('running data migration', { to: m.to, description: m.description });
    m.up(paths);
    version = m.to;
    writeJsonAtomicSync(paths.schema, { version });
  }
  return { from, to: version, backup };
}

export function backupData(paths: DataPaths, version: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(paths.backups, `${stamp}-v${version}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(paths.root)) {
    if (entry === 'backups' || entry === 'logs') continue;
    fs.cpSync(path.join(paths.root, entry), path.join(dest, entry), { recursive: true });
  }
  pruneBackups(paths.backups, 5);
  return dest;
}

function pruneBackups(dir: string, keep: number): void {
  const all = fs.readdirSync(dir).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  }
}
