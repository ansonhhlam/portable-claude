import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configFile,
  defaultConfig,
  parseConfigValue,
  setConfigValue,
  unknownConfigKeys,
} from '../../src/server/config.js';
import {
  DataFileError,
  JsonFile,
  readJsonSync,
  writeJsonAtomicSync,
} from '../../src/server/fsutil.js';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  currentVersion,
  migrate,
} from '../../src/server/migrations.js';
import { dataPaths, defaultDataDir } from '../../src/server/paths.js';
import {
  PathError,
  findProjectFor,
  isInside,
  makeProject,
  projectIdFor,
  resolveSessionCwd,
} from '../../src/server/projects.js';
import { SessionStore } from '../../src/server/sessions.js';
import { SpendTracker, localDate } from '../../src/server/spend.js';
import { z } from 'zod';
import { tmpDir } from './helpers.js';

describe('atomic files', () => {
  it('writes atomically and validates on read', () => {
    const dir = tmpDir();
    const f = path.join(dir, 'a', 'x.json');
    writeJsonAtomicSync(f, { n: 1 });
    expect(readJsonSync(f, z.object({ n: z.number() }), () => ({ n: 0 }))).toEqual({ n: 1 });
    expect(fs.readdirSync(path.dirname(f))).toEqual(['x.json']);
    fs.writeFileSync(f, '{bad');
    expect(() => readJsonSync(f, z.object({ n: z.number() }), () => ({ n: 0 }))).toThrow(
      DataFileError,
    );
    fs.writeFileSync(f, '{"n":"str"}');
    expect(() => readJsonSync(f, z.object({ n: z.number() }), () => ({ n: 0 }))).toThrow(
      /validation/,
    );
    expect(
      readJsonSync(path.join(dir, 'missing.json'), z.object({ n: z.number() }), () => ({ n: 7 })),
    ).toEqual({ n: 7 });
  });

  it('JsonFile reloads when another process changes the file', () => {
    const f = path.join(tmpDir(), 'c.json');
    const jf = new JsonFile(f, z.object({ v: z.number() }), () => ({ v: 0 }));
    expect(jf.get().v).toBe(0);
    jf.set({ v: 1 });
    writeJsonAtomicSync(f, { v: 22 });
    expect(jf.get().v).toBe(22);
    jf.update((d) => {
      d.v++;
    });
    expect(jf.get().v).toBe(23);
  });
});

describe('config', () => {
  it('has documented defaults and binds to loopback', () => {
    const c = defaultConfig();
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(8417);
    expect(c.dailySpendCapUsd).toBeNull();
  });
  it('warns about unknown keys and parses CLI values', () => {
    expect(unknownConfigKeys({ port: 1, colour: 'red' })).toEqual(['colour']);
    expect(parseConfigValue('port', '9000')).toBe(9000);
    expect(parseConfigValue('logContent', 'true')).toBe(true);
    expect(parseConfigValue('dailySpendCapUsd', 'null')).toBeNull();
    expect(parseConfigValue('models', '["a","b"]')).toEqual(['a', 'b']);
    const c = setConfigValue(defaultConfig(), 'dailySpendCapUsd', '5');
    expect(c.dailySpendCapUsd).toBe(5);
    expect(() => setConfigValue(c, 'nope', '1')).toThrow(/Unknown config key/);
    expect(() => setConfigValue(c, 'host', '0.0.0.0')).toThrow(/Invalid value/);
    expect(() => setConfigValue(c, 'port', '80')).toThrow(/Invalid value/);
  });
  it('rejects invalid config files', () => {
    const f = path.join(tmpDir(), 'config.json');
    fs.writeFileSync(f, JSON.stringify({ host: '0.0.0.0' }));
    expect(() => configFile(f).get()).toThrow(DataFileError);
  });
});

describe('data directory', () => {
  it('follows per-OS conventions', () => {
    expect(
      defaultDataDir({ APPDATA: 'C:\\Users\\you\\AppData\\Roaming' }, 'win32', 'C:\\Users\\you'),
    ).toMatch(/Roaming[\\/]longcord$/);
    expect(defaultDataDir({}, 'darwin', '/Users/you')).toBe(
      path.join('/Users/you', 'Library', 'Application Support', 'longcord'),
    );
    expect(defaultDataDir({ XDG_DATA_HOME: '/home/you/.data' }, 'linux', '/home/you')).toBe(
      path.join('/home/you/.data', 'longcord'),
    );
    expect(defaultDataDir({}, 'linux', '/home/you')).toBe(
      path.join('/home/you', '.local', 'share', 'longcord'),
    );
    expect(defaultDataDir({ LONGCORD_HOME: 'rel' }, 'linux', '/home/you')).toBe(
      path.resolve('rel'),
    );
  });
});

describe('migrations', () => {
  it('initialises a fresh directory without a backup', () => {
    const p = dataPaths(tmpDir());
    const r = migrate(p);
    expect(r).toEqual({ from: 0, to: SCHEMA_VERSION, backup: null });
    expect(fs.existsSync(p.sessions)).toBe(true);
    expect(currentVersion(p)).toBe(SCHEMA_VERSION);
    expect(migrate(p).backup).toBeNull();
  });

  it('migration 1 creates the layout', () => {
    const p = dataPaths(tmpDir());
    MIGRATIONS.find((m) => m.to === 1)!.up(p);
    for (const d of [p.sessions, p.logs, p.backups]) expect(fs.existsSync(d)).toBe(true);
  });

  it('migration 2 fills in session metadata, after backing up v1 data', () => {
    const p = dataPaths(tmpDir());
    migrate(p, undefined, MIGRATIONS, 1);
    const id = '11111111-2222-4333-8444-555555555555';
    const old = {
      id,
      title: 'Old',
      projectId: 'demo',
      cwd: '/tmp',
      mode: 'default',
      createdAt: 'a',
      updatedAt: 'b',
    };
    fs.mkdirSync(path.join(p.sessions, id), { recursive: true });
    fs.writeFileSync(path.join(p.sessions, id, 'meta.json'), JSON.stringify(old));
    const r = migrate(p);
    expect(r.from).toBe(1);
    expect(r.to).toBe(2);
    expect(r.backup && fs.existsSync(path.join(r.backup, 'sessions', id, 'meta.json'))).toBe(true);
    const store = new SessionStore(p.sessions);
    expect(store.get(id)).toMatchObject({
      totals: { runs: 0 },
      preview: '',
      imported: false,
      archived: false,
      sdkSessionId: null,
    });
  });

  it('refuses data from a newer version', () => {
    const p = dataPaths(tmpDir());
    writeJsonAtomicSync(p.schema, { version: SCHEMA_VERSION + 1 });
    expect(() => migrate(p)).toThrow(/newer/);
  });

  it('keeps only the five newest backups', () => {
    const p = dataPaths(tmpDir());
    migrate(p, undefined, MIGRATIONS, 1);
    fs.mkdirSync(p.backups, { recursive: true });
    for (let i = 0; i < 7; i++) fs.mkdirSync(path.join(p.backups, `2000-01-0${i}-v1`));
    migrate(p);
    expect(fs.readdirSync(p.backups)).toHaveLength(5);
  });
});

describe('project paths', () => {
  const setup = () => {
    const root = tmpDir();
    const proj = path.join(root, 'my-app');
    fs.mkdirSync(path.join(proj, 'pkg', 'inner'), { recursive: true });
    fs.mkdirSync(path.join(root, 'outside'));
    return { root, proj, project: makeProject(proj) };
  };

  it('accepts the root and sub-folders', () => {
    const { proj, project } = setup();
    expect(resolveSessionCwd(project)).toBe(fs.realpathSync.native(proj));
    expect(resolveSessionCwd(project, 'pkg/inner')).toBe(
      fs.realpathSync.native(path.join(proj, 'pkg', 'inner')),
    );
  });

  it('rejects traversal, absolute paths and missing folders', () => {
    const { project } = setup();
    expect(() => resolveSessionCwd(project, '../outside')).toThrow(PathError);
    expect(() => resolveSessionCwd(project, 'pkg/../../outside')).toThrow(/traversal/);
    expect(() => resolveSessionCwd(project, '..\\outside')).toThrow(/traversal/);
    expect(() => resolveSessionCwd(project, path.resolve('/'))).toThrow(/relative/);
    expect(() => resolveSessionCwd(project, 'C:\\Windows')).toThrow(/relative/);
    expect(() => resolveSessionCwd(project, 'nope')).toThrow(/does not exist/);
  });

  it('rejects symlinks that escape the project', () => {
    const { root, proj, project } = setup();
    const link = path.join(proj, 'escape');
    try {
      fs.symlinkSync(path.join(root, 'outside'), link, 'junction');
    } catch {
      return; // symlinks unavailable on this machine
    }
    expect(() => resolveSessionCwd(project, 'escape')).toThrow(/link/);
  });

  it('validates folders for projects add', () => {
    const { root, proj } = setup();
    expect(makeProject(proj, 'Nice name').name).toBe('Nice name');
    expect(() => makeProject(path.parse(root).root)).toThrow(/root/);
    expect(() => makeProject(path.join(root, 'missing'))).toThrow(PathError);
    expect(projectIdFor(proj)).toMatch(/^my-app-[0-9a-f]{6}$/);
    expect(findProjectFor([makeProject(proj)], path.join(proj, 'pkg'))?.name).toBe('my-app');
    expect(findProjectFor([makeProject(proj)], path.join(root, 'outside'))).toBeUndefined();
    expect(isInside(proj, path.join(proj, 'a'))).toBe(true);
    expect(isInside(proj, path.join(root, 'my-app-other'))).toBe(false);
  });
});

describe('spend', () => {
  it('tracks daily totals and the cap, notifying once per day', () => {
    let now = new Date(2026, 0, 10, 12);
    const s = new SpendTracker(path.join(tmpDir(), 'spend.json'), () => now);
    s.add(0.5);
    s.add(0.25);
    s.add(-1);
    expect(s.today()).toBeCloseTo(0.75);
    expect(s.capReached(1)).toBe(false);
    expect(s.capReached(null)).toBe(false);
    s.add(0.3);
    expect(s.capReached(1)).toBe(true);
    expect(s.shouldNotifyCap(1)).toBe(true);
    expect(s.shouldNotifyCap(1)).toBe(false);
    now = new Date(2026, 0, 11, 1);
    expect(s.today()).toBe(0);
    expect(s.info(1)).toMatchObject({ todayUsd: 0, capReached: false, date: localDate(now) });
  });
});

describe('display helpers', () => {
  it('shortens project paths inside the home folder and strips Markdown from previews', async () => {
    const { displayProject } = await import('../../src/server/app.js');
    const { plainPreview } = await import('../../src/server/runner.js');
    const home = path.resolve('/home/you');
    expect(
      displayProject({ id: 'a', name: 'a', path: path.join(home, 'code', 'app') }, home).path,
    ).toBe(`~${path.sep}${path.join('code', 'app')}`);
    expect(displayProject({ id: 'b', name: 'b', path: path.resolve('/srv/app') }, home).path).toBe(
      path.resolve('/srv/app'),
    );
    expect(
      plainPreview('All **done**. See [the docs](https://example.com)\n```js\ncode\n```  `x`'),
    ).toBe('All done. See the docs x');
  });
});
