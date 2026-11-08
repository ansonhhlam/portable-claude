import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkDataIntegrity,
  formatDoctor,
  nodeVersionOk,
  runDoctor,
} from '../../src/cli/doctor.js';
import { COMMANDS, cliReference, commandHelp, main } from '../../src/cli/index.js';
import { shQuote, winQuote, xmlEscape } from '../../src/cli/os.js';
import {
  checkSleep,
  fixSleep,
  launchdPlist,
  serviceManager,
  systemdUnit,
  windowsTaskXml,
} from '../../src/cli/services.js';
import { enableServe, serveConfigured, tailscaleStatus } from '../../src/cli/tailscale.js';
import { createContext, type Prompter } from '../../src/cli/context.js';
import { dataPaths } from '../../src/server/paths.js';
import { DeviceStore } from '../../src/server/auth.js';
import { fakeOs, ok, tailscaleOk, type FakeOs } from './fake-os.js';
import { FAKE_KEY, tmpDir } from './helpers.js';

async function exec(
  argv: string[],
  os: FakeOs = fakeOs('linux'),
  dir?: string,
  opts: { prompt?: Prompter; interactive?: boolean } = {},
) {
  const lines: string[] = [];
  const errs: string[] = [];
  const home = dir ?? tmpDir();
  const code = await main(['--home', home, ...argv], {
    os,
    out: (l = '') => lines.push(l),
    err: (l = '') => errs.push(l),
    interactive: opts.interactive ?? false,
    ...(opts.prompt ? { prompt: opts.prompt } : {}),
  });
  return { code, out: lines.join('\n'), err: errs.join('\n'), dir: home };
}

describe('cli basics', () => {
  it('prints help and version', async () => {
    expect((await exec(['--help'])).out).toContain('Commands:');
    expect((await exec(['--version'])).out).toMatch(/^\d+\.\d+\.\d+/);
    expect((await exec(['setup', '--help'])).out).toContain('--api-key');
    const unknown = await exec(['frobnicate']);
    expect(unknown.code).toBe(2);
    const bad = await exec(['status', '--bogus']);
    expect(bad.code).toBe(2);
  });

  it('documents every command in the generated reference', () => {
    const ref = cliReference();
    for (const c of COMMANDS) {
      expect(ref).toContain(`## ${c.name}`);
      expect(ref).toContain(commandHelp(c));
    }
    expect(ref).not.toContain('--child');
  });
});

describe('projects, devices, config, passcode', () => {
  it('adds, lists and removes projects, rejecting bad folders', async () => {
    const os = fakeOs('linux');
    const dir = tmpDir();
    const proj = path.join(dir, 'work', 'my-app');
    fs.mkdirSync(proj, { recursive: true });
    expect((await exec(['projects', 'add', proj, '--name', 'My App'], os, dir)).out).toContain(
      'Project allowed: My App',
    );
    expect((await exec(['projects', 'add', proj], os, dir)).out).toContain('Already allowed');
    const list = await exec(['projects', 'list'], os, dir);
    expect(list.out).toContain('My App');
    const id = list.out.split(/\s+/)[0]!;
    expect((await exec(['projects', 'add', path.join(dir, 'missing')], os, dir)).code).toBe(1);
    expect((await exec(['projects', 'remove', 'nope'], os, dir)).code).toBe(1);
    expect((await exec(['projects', 'remove', id], os, dir)).out).toContain('Removed My App');
    expect((await exec(['projects', 'list'], os, dir)).out).toContain('No projects');
    expect((await exec(['projects'], os, dir)).code).toBe(1);
  });

  it('lists and revokes devices', async () => {
    const dir = tmpDir();
    const store = new DeviceStore(dataPaths(dir).devices);
    const d = store.create('Pocket phone');
    expect((await exec(['devices', 'list'], fakeOs('linux'), dir)).out).toContain('Pocket phone');
    expect((await exec(['devices', 'revoke', 'zzzz'], fakeOs('linux'), dir)).code).toBe(1);
    expect(
      (await exec(['devices', 'revoke', d.id.slice(0, 6)], fakeOs('linux'), dir)).out,
    ).toContain('Revoked Pocket phone');
    expect(new DeviceStore(dataPaths(dir).devices).list()).toHaveLength(0);
  });

  it('gets and sets config with validation', async () => {
    const dir = tmpDir();
    expect(
      (await exec(['config', 'set', 'dailySpendCapUsd', '12.5'], fakeOs('linux'), dir)).out,
    ).toContain('12.5');
    expect(
      JSON.parse((await exec(['config', 'get', 'dailySpendCapUsd'], fakeOs('linux'), dir)).out),
    ).toBe(12.5);
    expect((await exec(['config', 'set', 'host', '0.0.0.0'], fakeOs('linux'), dir)).code).toBe(1);
    expect((await exec(['config', 'set', 'projects', '[]'], fakeOs('linux'), dir)).code).toBe(1);
    expect((await exec(['config', 'get', 'nope'], fakeOs('linux'), dir)).code).toBe(1);
    expect((await exec(['config', 'set', 'port', '9001'], fakeOs('linux'), dir)).out).toContain(
      'Restart',
    );
    expect((await exec(['config', 'path'], fakeOs('linux'), dir)).out).toContain('config.json');
    expect(JSON.parse((await exec(['config', 'get'], fakeOs('linux'), dir)).out).port).toBe(9001);
  });

  it('generates or sets a passcode', async () => {
    const dir = tmpDir();
    const r = await exec(['passcode'], fakeOs('linux'), dir);
    expect(r.out).toMatch(/New passcode: [a-z2-9-]{19}/);
    expect(fs.readFileSync(dataPaths(dir).secrets, 'utf8')).toContain('scrypt$');
    const prompt: Prompter = { ask: async () => 'typed passcode 1', confirm: async () => true };
    expect(
      (await exec(['passcode', '--set'], fakeOs('linux'), dir, { prompt, interactive: true })).out,
    ).toContain('updated');
    expect((await exec(['passcode', '--set'], fakeOs('linux'), dir)).code).toBe(1);
  });
});

describe('setup', () => {
  it('runs non-interactively with flags on Linux', async () => {
    const os = fakeOs('linux');
    tailscaleOk(os);
    os.responses.set('systemctl', ok());
    os.responses.set('loginctl enable-linger', ok());
    const dir = tmpDir();
    const proj = path.join(dir, 'proj');
    fs.mkdirSync(proj);
    const r = await exec(
      [
        'setup',
        '--yes',
        '--api-key',
        FAKE_KEY,
        '--project',
        proj,
        '--daily-cap',
        '10',
        '--port',
        '9100',
      ],
      os,
      dir,
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('API key stored');
    expect(r.out).toContain('Fallback passcode');
    expect(r.out).toContain('https://my-pc.example-tailnet.ts.net');
    expect(r.out).toContain('Background service installed');
    expect(r.out).toContain('/#/pair/');
    const cfg = JSON.parse(fs.readFileSync(dataPaths(dir).config, 'utf8'));
    expect(cfg).toMatchObject({
      port: 9100,
      dailySpendCapUsd: 10,
      publicUrl: 'https://my-pc.example-tailnet.ts.net',
    });
    expect(cfg.projects).toHaveLength(1);
    expect(
      os.calls.some(
        (c) =>
          c.cmd === 'tailscale' &&
          c.args.join(' ') === 'serve --bg --https=443 http://127.0.0.1:9100',
      ),
    ).toBe(true);
    expect([...os.files.keys()].some((f) => f.endsWith('longcord.service'))).toBe(true);
    if (process.platform !== 'win32')
      expect(fs.statSync(dataPaths(dir).secrets).mode & 0o777).toBe(0o600);
    // Secrets never appear in the output.
    expect(r.out).not.toContain(FAKE_KEY);
  });

  it('asks questions interactively and reports missing Tailscale', async () => {
    const os = fakeOs('darwin', '/Users/you');
    os.responses.set('launchctl', ok());
    os.responses.set('pmset -g', ok(' sleep 10\n'));
    const answers = [FAKE_KEY, ''];
    const prompt: Prompter = { ask: async () => answers.shift() ?? '', confirm: async () => true };
    const r = await exec(['setup'], os, undefined, { prompt, interactive: true });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Tailscale is not installed');
    expect(r.out).toContain('keepAwake is on');
    expect(JSON.parse(fs.readFileSync(dataPaths(r.dir).config, 'utf8')).keepAwake).toBe(true);
    expect(r.out).toContain('run `longcord pair`');
  });

  it('uses the API key from the environment without storing it', async () => {
    const os = fakeOs('linux');
    os.env.ANTHROPIC_API_KEY = FAKE_KEY;
    const r = await exec(['setup', '--yes', '--no-service', '--no-tailscale'], os);
    expect(r.out).toContain('from the environment');
    expect(fs.readFileSync(dataPaths(r.dir).secrets, 'utf8')).not.toContain(FAKE_KEY);
  });
});

describe('services', () => {
  it('generates a Windows task that starts at boot, falling back to logon', async () => {
    const os = fakeOs('win32');
    const xml = windowsTaskXml(os, 'C:\\Users\\you\\AppData\\Roaming\\longcord', 'S4U');
    expect(xml).toContain('<LogonType>S4U</LogonType>');
    expect(xml).toContain('<BootTrigger>');
    expect(xml).toContain('<RestartOnFailure>');
    expect(xml).toContain('start --service --home');
    let attempts = 0;
    os.responses.set('powershell.exe', () => ({
      code: attempts++ === 0 ? 1 : 0,
      stdout: '',
      stderr: attempts === 1 ? 'Access is denied.' : '',
    }));
    os.responses.set('schtasks.exe /Run', ok());
    const svc = serviceManager(os, 'C:\\data');
    const r = await svc.install();
    expect(r.ok).toBe(true);
    expect(r.mode).toContain('sign in');
    const written = [...os.files.values()][0]!;
    expect(written).toContain('<LogonType>InteractiveToken</LogonType>');
    os.responses.set('schtasks.exe /Query', ok('"\\longcord","N/A","Running"'));
    expect(await svc.state()).toBe('running');
    os.responses.set('schtasks.exe /Query', ok('"\\longcord","N/A","Ready"'));
    expect(await svc.state()).toBe('stopped');
    os.responses.set('schtasks.exe /End', ok());
    os.responses.set('schtasks.exe /Delete', ok());
    expect((await svc.uninstall()).ok).toBe(true);
    os.responses.delete('schtasks.exe /Query');
    expect(await svc.state()).toBe('not-installed');
  });

  it('generates a launchd agent with KeepAlive', async () => {
    const os = fakeOs('darwin', '/Users/you');
    const plist = launchdPlist(os, '/Users/you/Library/Application Support/longcord');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<string>--service</string>');
    os.responses.set('launchctl', ok());
    const svc = serviceManager(os, '/data');
    expect((await svc.install()).ok).toBe(true);
    expect(os.calls.some((c) => c.args[0] === 'bootstrap' && c.args[1] === 'gui/501')).toBe(true);
    os.responses.set('launchctl print', ok('state = running'));
    expect(await svc.state()).toBe('running');
    expect((await svc.uninstall()).message).toContain('removed');
    expect(await svc.state()).toBe('not-installed');
  });

  it('generates a systemd user unit with Restart=always and enables lingering', async () => {
    const os = fakeOs('linux');
    const unit = systemdUnit(os, '/home/you/.local/share/longcord dir');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain("'/home/you/.local/share/longcord dir'");
    os.responses.set('systemctl', ok());
    os.responses.set('loginctl enable-linger', { code: 1, stdout: '', stderr: 'denied' });
    const svc = serviceManager(os, '/data');
    const r = await svc.install();
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toContain('sudo loginctl enable-linger you');
    os.responses.set('systemctl --user is-active', ok('active\n'));
    expect(await svc.state()).toBe('running');
    os.responses.set('systemctl --user is-active', ok('failed\n'));
    expect(await svc.state()).toBe('stopped');
    expect((await svc.uninstall()).ok).toBe(true);
  });

  it('reports failures from the service manager', async () => {
    const os = fakeOs('linux');
    os.responses.set('systemctl', { code: 1, stdout: '', stderr: 'Failed to connect to bus' });
    expect((await serviceManager(os, '/d').install()).error).toContain('bus');
  });

  it('checks and fixes sleep settings per OS', async () => {
    const win = fakeOs('win32');
    win.responses.set('powercfg /query', ok('Current AC Power Setting Index: 0x00000708'));
    expect((await checkSleep(win)).status).toBe('warn');
    win.responses.set('powercfg /change', ok());
    expect((await fixSleep(win)).ok).toBe(true);
    win.responses.set('powercfg /query', ok('Current AC Power Setting Index: 0x00000000'));
    expect((await checkSleep(win)).status).toBe('pass');
    const mac = fakeOs('darwin');
    mac.responses.set('pmset -g', ok(' sleep  0\n'));
    expect((await checkSleep(mac)).status).toBe('pass');
    expect((await fixSleep(mac)).setKeepAwake).toBe(true);
    const lin = fakeOs('linux');
    lin.responses.set('systemctl is-enabled', ok('masked'));
    expect((await checkSleep(lin)).status).toBe('pass');
    expect((await fixSleep(lin)).ok).toBe(false);
    expect((await checkSleep(fakeOs('win32'))).status).toBe('unknown');
  });

  it('quotes arguments safely', () => {
    expect(shQuote("it's here")).toBe(`'it'\\''s here'`);
    expect(shQuote('/plain/path')).toBe('/plain/path');
    expect(winQuote('C:\\Program Files\\x')).toBe('"C:\\Program Files\\x"');
    expect(winQuote('simple')).toBe('simple');
    expect(xmlEscape('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});

describe('tailscale', () => {
  it('reads status and configures serve', async () => {
    const os = fakeOs('linux');
    expect((await tailscaleStatus(os)).installed).toBe(false);
    tailscaleOk(os);
    const s = await tailscaleStatus(os);
    expect(s).toMatchObject({
      installed: true,
      running: true,
      httpsEnabled: true,
      dnsName: 'my-pc.example-tailnet.ts.net',
    });
    expect((await enableServe(os, 8417)).ok).toBe(true);
    expect(await serveConfigured(os, 8417)).toBe(true);
    expect(await serveConfigured(os, 9999)).toBe(false);
    os.responses.set('tailscale status --json', ok('not json'));
    expect((await tailscaleStatus(os)).running).toBe(false);
  });
});

describe('doctor', () => {
  it('passes a healthy setup and redacts identifiers', async () => {
    const os = fakeOs('linux');
    tailscaleOk(os);
    os.responses.set('systemctl --user is-active', ok('active'));
    os.responses.set('systemctl is-enabled suspend.target', ok('masked'));
    os.fetchResponses.set('http://127.0.0.1:8417/healthz', new Response('{"ok":true}'));
    os.fetchResponses.set(
      'https://api.anthropic.com/',
      new Response('{}', {
        status: 200,
        headers: { date: new Date('2026-03-01T12:00:30Z').toUTCString() },
      }),
    );
    const dir = tmpDir();
    const proj = path.join(dir, 'p');
    fs.mkdirSync(proj);
    os.files.set(path.join(os.homedir, '.config', 'systemd', 'user', 'longcord.service'), 'x');
    const ctx = createContext({
      os,
      paths: dataPaths(dir),
      out: () => undefined,
      err: () => undefined,
      interactive: false,
    });
    ctx.config.set({ ...ctx.config.get(), projects: [{ id: 'p', name: 'p', path: proj }] });
    ctx.secrets.update((s) => void (s.apiKey = FAKE_KEY));
    const results = await runDoctor(ctx, { offline: false });
    const failing = results.filter((r) => r.status !== 'pass');
    expect(failing).toEqual([]);
    const text = formatDoctor(results, os);
    expect(text).not.toContain('my-pc.example-tailnet');
    expect(text).toContain('<machine>.<tailnet>.ts.net');
    expect(text).not.toContain(FAKE_KEY);
  });

  it('fails clearly and exits non-zero when things are missing', async () => {
    const os = fakeOs('linux');
    const r = await exec(['doctor', '--offline'], os);
    expect(r.code).toBe(1);
    expect(r.out).toContain('[FAIL] API credentials');
    expect(r.out).toContain('[FAIL] Tailscale: not installed');
    expect(r.out).toContain('fix:');
    const json = await exec(['doctor', '--offline', '--json'], os);
    expect(JSON.parse(json.out).find((c: { id: string }) => c.id === 'credentials').status).toBe(
      'fail',
    );
  });

  it('detects a rejected key, clock skew and a busy port', async () => {
    const os = fakeOs('linux');
    os.fetchResponses.set(
      'https://api.anthropic.com/',
      new Response('{}', {
        status: 401,
        headers: { date: new Date('2026-03-01T11:50:00Z').toUTCString() },
      }),
    );
    const dir = tmpDir();
    const ctx = createContext({
      os,
      paths: dataPaths(dir),
      out: () => undefined,
      err: () => undefined,
      interactive: false,
    });
    ctx.secrets.update((s) => void (s.apiKey = FAKE_KEY));
    const net = await import('node:net');
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    ctx.config.set({ ...ctx.config.get(), port });
    const results = await runDoctor(ctx, { offline: false });
    blocker.close();
    expect(results.find((r) => r.id === 'credentials')?.status).toBe('fail');
    expect(results.find((r) => r.id === 'clock')?.status).toBe('warn');
    expect(results.find((r) => r.id === 'health')?.detail).toContain('used by another program');
  });

  it('checks data integrity without repairing', () => {
    const dir = tmpDir();
    const p = dataPaths(dir);
    const sdir = path.join(p.sessions, 'abc');
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'meta.json'), '{}');
    fs.writeFileSync(path.join(sdir, 'events.jsonl'), '{"seq":1}\nbroken\n{"seq":3,"partial');
    fs.writeFileSync(p.config, '{bad json');
    const r = checkDataIntegrity(p);
    expect(r.sessions).toBe(1);
    expect(r.problems.join('\n')).toContain('incomplete line');
    expect(r.problems.join('\n')).toContain('1 unreadable');
    expect(r.problems.join('\n')).toContain('config.json is not valid JSON');
    expect(fs.readFileSync(path.join(sdir, 'events.jsonl'), 'utf8')).toContain('partial');
  });

  it('compares node versions', () => {
    expect(nodeVersionOk('v20.19.0')).toBe(true);
    expect(nodeVersionOk('v20.18.9')).toBe(false);
    expect(nodeVersionOk('v22.1.0')).toBe(true);
    expect(nodeVersionOk('v18.20.0')).toBe(false);
  });
});

describe('status, logs, pair, update, uninstall', () => {
  it('status reports JSON', async () => {
    const os = fakeOs('linux');
    const r = await exec(['status', '--json'], os);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.out)).toMatchObject({
      running: false,
      service: 'not-installed',
      projects: 0,
    });
    os.fetchResponses.set('http://127.0.0.1:8417/healthz', new Response('{"ok":true}'));
    const human = await exec(['status'], os);
    expect(human.code).toBe(0);
    expect(human.out).toContain('running on 127.0.0.1:8417');
  });

  it('logs prints formatted lines', async () => {
    const dir = tmpDir();
    expect((await exec(['logs'], fakeOs('linux'), dir)).out).toContain('No log file');
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'logs', 'longcord.log'),
      '{"time":"2026-01-01T10:00:00.000Z","level":"info","msg":"server started","port":8417}\nplain line\n',
    );
    const r = await exec(['logs', '-n', '5'], fakeOs('linux'), dir);
    expect(r.out).toContain('2026-01-01 10:00:00 INFO  server started {"port":8417}');
    expect(r.out).toContain('plain line');
  });

  it('pair needs a URL and prints a QR code', async () => {
    const dir = tmpDir();
    expect((await exec(['pair'], fakeOs('linux'), dir)).code).toBe(1);
    expect(
      (await exec(['pair', '--url', 'http://insecure.example.com'], fakeOs('linux'), dir)).code,
    ).toBe(1);
    const r = await exec(
      ['pair', '--url', 'https://my-pc.example-tailnet.ts.net'],
      fakeOs('linux'),
      dir,
    );
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/https:\/\/my-pc\.example-tailnet\.ts\.net\/#\/pair\/[A-Za-z0-9_-]{20,}/);
    expect(r.out).toContain('not running');
  });

  it('update explains the steps', async () => {
    expect((await exec(['update'])).out).toContain('npm install -g longcord@latest');
  });

  it('uninstall removes the service and optionally the data', async () => {
    const os = fakeOs('linux');
    tailscaleOk(os);
    os.responses.set('systemctl', ok());
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ publicUrl: 'https://my-pc.example-tailnet.ts.net' }),
    );
    expect((await exec(['uninstall'], os, dir)).code).toBe(1);
    const keep = await exec(['uninstall', '--yes'], os, dir);
    expect(keep.out).toContain('Data kept');
    expect(os.calls.some((c) => c.args.join(' ') === 'serve --https=443 off')).toBe(true);
    const del = await exec(['uninstall', '--yes', '--delete-data'], os, dir);
    expect(del.out).toContain('Data deleted');
    expect(fs.existsSync(dir)).toBe(false);
  });
});
