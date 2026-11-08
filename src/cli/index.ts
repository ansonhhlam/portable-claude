import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { PERMISSION_MODES } from '../shared/api.js';
import { packageVersion } from '../shared/version.js';
import {
  DeviceStore,
  PairingStore,
  PAIRING_TTL_MS,
  generatePasscode,
  hashPasscode,
  passcodeProblem,
} from '../server/auth.js';
import { CONFIG_KEYS, ConfigSchema, setConfigValue, type Config } from '../server/config.js';
import { dataPaths } from '../server/paths.js';
import { PathError, makeProject } from '../server/projects.js';
import { SpendTracker } from '../server/spend.js';
import { CliError, createContext, type CliContext } from './context.js';
import { formatDoctor, nodeVersionOk, runDoctor, MIN_NODE } from './doctor.js';
import { checkSleep, fixSleep, serviceCommand, serviceManager } from './services.js';
import {
  TAILSCALE_DOWNLOAD,
  TAILSCALE_HTTPS_DOCS,
  disableServe,
  enableServe,
  tailscaleStatus,
} from './tailscale.js';

type Options = NonNullable<ParseArgsConfig['options']>;
type Values = Record<string, string | boolean | string[] | undefined>;

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string[];
  options: Options;
  /** Help text per option (keys of `options`). */
  optionHelp: Record<string, string>;
  examples: string[];
  hidden?: string[];
  run(ctx: CliContext, values: Values, positionals: string[]): Promise<number>;
}

const sub = (positionals: string[], allowed: string[], cmd: string): string => {
  const s = positionals[0];
  if (!s || !allowed.includes(s))
    throw new CliError(
      `Usage: longcord ${cmd} ${allowed.join('|')} … (see longcord ${cmd} --help)`,
    );
  return s;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function healthy(ctx: CliContext, port: number): Promise<boolean> {
  return ctx.os
    .fetch(`http://127.0.0.1:${port}/healthz`, { timeoutMs: 2000 })
    .then((r) => r.ok)
    .catch(() => false);
}

// ------------------------------------------------------------------ setup

async function setup(ctx: CliContext, v: Values): Promise<number> {
  const yes = v.yes === true || !ctx.interactive;
  const out = ctx.out;
  out(`longcord ${packageVersion()} setup`);
  out('');

  if (!nodeVersionOk(process.version)) {
    throw new CliError(
      `Node.js ${MIN_NODE.join('.')} or newer is required (found ${process.version}). Install an LTS release from https://nodejs.org`,
    );
  }
  out(`✓ Node.js ${process.version}`);

  // Provider and API key
  let cfg = ctx.config.get();
  const providerFlag = str(v.provider);
  if (providerFlag) cfg = setConfigValue(cfg, 'provider', providerFlag);
  if (cfg.provider === 'anthropic') {
    let key = str(v['api-key']);
    const existing = ctx.secrets.get().apiKey;
    if (!key && !existing && ctx.os.env.ANTHROPIC_API_KEY) {
      out('✓ Using ANTHROPIC_API_KEY from the environment (not stored).');
    } else if (
      !key &&
      !yes &&
      (!existing || !(await ctx.prompt.confirm('An API key is already stored. Keep it?', true)))
    ) {
      out('longcord uses your own Anthropic API key. API usage is billed by Anthropic,');
      out(
        'separately from any Claude subscription. Create a key at https://console.anthropic.com/',
      );
      key = await ctx.prompt.ask('Anthropic API key', { secret: true });
    }
    if (key) {
      if (!key.startsWith('sk-ant-'))
        out(
          '! That does not look like an Anthropic API key (they start with sk-ant-). Storing it anyway.',
        );
      ctx.secrets.update((s) => {
        s.apiKey = key!;
      });
      out(`✓ API key stored in ${path.basename(ctx.paths.secrets)} (readable only by you)`);
    } else if (!existing && !ctx.os.env.ANTHROPIC_API_KEY) {
      out(
        '! No API key stored yet. Run `longcord setup --api-key <key>` before starting a session.',
      );
    }
  } else {
    out(
      `✓ Provider: ${cfg.provider}. Configure its credentials as described in docs/reference/environment.md`,
    );
  }

  // Projects
  const projectFlags = (v.project as string[] | undefined) ?? [];
  const toAdd = [...projectFlags];
  if (!yes && projectFlags.length === 0) {
    out('');
    out('Choose project folders the agent may work in. Leave empty to finish.');
    for (;;) {
      const p = await ctx.prompt.ask('Project folder');
      if (!p) break;
      toAdd.push(p);
    }
  }
  for (const p of toAdd) cfg = addProject(ctx, cfg, p);
  if (cfg.projects.length === 0)
    out('! No projects yet. Add one later with `longcord projects add <folder>`.');

  // Options
  if (str(v.port)) cfg = setConfigValue(cfg, 'port', str(v.port)!);
  if (str(v['daily-cap'])) cfg = setConfigValue(cfg, 'dailySpendCapUsd', str(v['daily-cap'])!);
  ctx.config.set(cfg);

  // Passcode
  const passFlag = str(v.passcode);
  if (passFlag || !ctx.secrets.get().passcodeHash) {
    const pass = passFlag ?? generatePasscode();
    const problem = passcodeProblem(pass);
    if (problem) throw new CliError(problem);
    ctx.secrets.update((s) => {
      s.passcodeHash = hashPasscode(pass);
    });
    out(
      passFlag
        ? '✓ Passcode set'
        : `✓ Fallback passcode (write it down; it is shown only now): ${pass}`,
    );
  }

  // Tailscale
  if (v.tailscale !== false) {
    out('');
    const ts = await tailscaleStatus(ctx.os);
    if (!ts.installed)
      out(
        `! Tailscale is not installed. Install it from ${TAILSCALE_DOWNLOAD}, log in, then run setup again.`,
      );
    else if (!ts.running)
      out('! Tailscale is installed but not connected. Open it and log in, then run setup again.');
    else if (!ts.httpsEnabled)
      out(
        `! HTTPS is not enabled for your tailnet. Enable it (${TAILSCALE_HTTPS_DOCS}), then run setup again.`,
      );
    else {
      const r = await enableServe(ctx.os, cfg.port);
      if (r.ok && ts.dnsName) {
        cfg = ctx.config.update((c) => {
          c.publicUrl = `https://${ts.dnsName}`;
        });
        out(`✓ Tailscale: your phone can reach longcord at https://${ts.dnsName}`);
      } else out(`! tailscale serve failed: ${r.message}`);
    }
  }

  // Service
  if (v.service !== false) {
    const svc = serviceManager(ctx.os, ctx.paths.root);
    const r = await svc.install();
    if (r.ok) {
      out(`✓ Background service installed: ${r.mode}`);
      for (const n of r.notes) out(`  ${n}`);
    } else out(`! Could not install the background service: ${r.error}`);
  }

  // Sleep
  const sleep = await checkSleep(ctx.os);
  if (sleep.status !== 'pass') {
    out(`! ${sleep.detail}`);
    const fix =
      sleep.fixable &&
      (v['fix-sleep'] === true ||
        (!yes && (await ctx.prompt.confirm('Keep the computer awake while plugged in?', true))));
    if (fix) {
      const r = await fixSleep(ctx.os);
      if (r.setKeepAwake) ctx.config.update((c) => void (c.keepAwake = true));
      out(`${r.ok ? '✓' : '!'} ${r.message}`);
    }
  } else out(`✓ ${sleep.detail}`);

  // Pairing
  out('');
  if (cfg.publicUrl) await printPairing(ctx, cfg.publicUrl);
  else out('When Tailscale is ready, run `longcord pair` to connect your phone.');
  return 0;
}

function addProject(ctx: CliContext, cfg: Config, input: string, name?: string): Config {
  let project;
  try {
    project = makeProject(input, name, process.cwd());
  } catch (err) {
    if (err instanceof PathError) throw new CliError(`${input}: ${err.message}`);
    throw err;
  }
  if (cfg.projects.some((p) => p.id === project.id)) {
    ctx.out(`✓ Already allowed: ${project.name}`);
    return cfg;
  }
  ctx.out(`✓ Project allowed: ${project.name} (${project.id})`);
  return { ...cfg, projects: [...cfg.projects, project] };
}

async function printPairing(ctx: CliContext, base: string): Promise<void> {
  const pairing = new PairingStore(ctx.paths.pairing);
  const { token, expiresAt } = pairing.create();
  const url = `${base.replace(/\/$/, '')}/#/pair/${token}`;
  const qrcode = await import('qrcode');
  const qr = await qrcode.toString(url, {
    type: 'terminal',
    small: true,
    errorCorrectionLevel: 'M',
  });
  ctx.out('Scan this code with your phone camera (it works once, for 10 minutes):');
  ctx.out(qr);
  ctx.out(url);
  ctx.out(`Expires at ${new Date(expiresAt).toLocaleTimeString()}.`);
}

// ------------------------------------------------------------------ commands

export const COMMANDS: CommandSpec[] = [
  {
    name: 'setup',
    summary:
      'Interactive first-time setup: API key, projects, Tailscale, background service, pairing',
    usage: ['longcord setup [options]'],
    options: {
      'api-key': { type: 'string' },
      provider: { type: 'string' },
      project: { type: 'string', multiple: true },
      passcode: { type: 'string' },
      port: { type: 'string' },
      'daily-cap': { type: 'string' },
      'no-service': { type: 'boolean' },
      'no-tailscale': { type: 'boolean' },
      'fix-sleep': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
    optionHelp: {
      'api-key': 'Anthropic API key to store (otherwise asked, or read from ANTHROPIC_API_KEY)',
      provider: 'anthropic (default), bedrock, vertex or foundry',
      project: 'Folder the agent may work in (repeatable)',
      passcode: 'Fallback passcode for signing in without a QR code (default: generated)',
      port: 'Local port (default 8417)',
      'daily-cap': 'Daily spend cap in US dollars',
      'no-service': 'Do not install the background service',
      'no-tailscale': 'Do not configure tailscale serve',
      'fix-sleep': 'Apply the safe sleep fix for this OS without asking',
      yes: 'Non-interactive: never prompt, use flags and defaults',
    },
    examples: [
      'longcord setup',
      'longcord setup --yes --api-key "$ANTHROPIC_API_KEY" --project ~/code/my-app --daily-cap 20',
    ],
    run: (ctx, v) => setup(ctx, v),
  },
  {
    name: 'start',
    summary: 'Run the server in the foreground (the background service runs this for you)',
    usage: ['longcord start [--mock] [--port <n>]'],
    options: {
      mock: { type: 'boolean' },
      port: { type: 'string' },
      service: { type: 'boolean' },
      child: { type: 'boolean' },
    },
    optionHelp: {
      mock: 'Use the built-in mock agent: no API key needed and no API calls (for demos and development)',
      port: 'Override the configured port',
      service:
        'Run under the supervisor that restarts the server if it stops (used by the background service)',
    },
    hidden: ['child'],
    examples: ['longcord start', 'longcord start --mock --port 9000'],
    async run(ctx, v) {
      const { runForeground, Supervisor } = await import('../server/main.js');
      const port = str(v.port) ? Number(v.port) : undefined;
      if (v.service) {
        const cmd = [ctx.os.nodePath, ctx.os.cliPath, 'start', '--child', '--home', ctx.paths.root];
        if (v.mock) cmd.push('--mock');
        if (port) cmd.push('--port', String(port));
        const sup = new Supervisor({ dataDir: ctx.paths.root, command: cmd });
        sup.start();
        const stop = () => void sup.stop().finally(() => process.exit(0));
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        return new Promise<number>(() => undefined);
      }
      await runForeground({
        dataDir: ctx.paths.root,
        mock: v.mock === true,
        foreground: !v.child,
        ...(port ? { port } : {}),
        print: v.child ? () => undefined : (l) => ctx.out(l),
      });
      return new Promise<number>(() => undefined);
    },
  },
  {
    name: 'status',
    summary: 'Show whether longcord is running and how it is configured',
    usage: ['longcord status [--json]'],
    options: { json: { type: 'boolean' } },
    optionHelp: { json: 'Print machine-readable JSON' },
    examples: ['longcord status'],
    async run(ctx, v) {
      const cfg = ctx.config.get();
      const svc = serviceManager(ctx.os, ctx.paths.root);
      const sessionsDir = ctx.paths.sessions;
      const status = {
        version: packageVersion(),
        dataDir: ctx.paths.root,
        port: cfg.port,
        publicUrl: cfg.publicUrl,
        running: await healthy(ctx, cfg.port),
        service: await svc.state(),
        projects: cfg.projects.length,
        devices: new DeviceStore(ctx.paths.devices).list().length,
        sessions: fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).length : 0,
        spendTodayUsd: Number(new SpendTracker(ctx.paths.spend).today().toFixed(4)),
        dailySpendCapUsd: cfg.dailySpendCapUsd,
      };
      if (v.json) ctx.out(JSON.stringify(status, null, 2));
      else {
        ctx.out(`longcord ${status.version}`);
        ctx.out(
          `  server:    ${status.running ? `running on 127.0.0.1:${status.port}` : 'not running'}`,
        );
        ctx.out(`  service:   ${status.service}`);
        ctx.out(`  phone URL: ${status.publicUrl ?? 'not set (run longcord setup)'}`);
        ctx.out(
          `  projects:  ${status.projects}   devices: ${status.devices}   sessions: ${status.sessions}`,
        );
        ctx.out(
          `  spend:     $${status.spendTodayUsd.toFixed(2)} today${status.dailySpendCapUsd ? ` of $${status.dailySpendCapUsd.toFixed(2)} cap` : ''}`,
        );
        ctx.out(`  data:      ${status.dataDir}`);
      }
      return status.running ? 0 : 3;
    },
  },
  {
    name: 'logs',
    summary: 'Print recent server log lines',
    usage: ['longcord logs [--lines <n>] [--follow]'],
    options: { lines: { type: 'string', short: 'n' }, follow: { type: 'boolean', short: 'f' } },
    optionHelp: {
      lines: 'Number of lines to show (default 50)',
      follow: 'Keep printing new lines',
    },
    examples: ['longcord logs -n 200', 'longcord logs --follow'],
    async run(ctx, v) {
      const file = path.join(ctx.paths.logs, 'longcord.log');
      const n = Number(str(v.lines) ?? 50);
      if (!fs.existsSync(file)) {
        ctx.out('No log file yet. Start longcord first.');
        return 0;
      }
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (const l of lines.slice(-n)) ctx.out(formatLogLine(l));
      if (!v.follow) return 0;
      let size = fs.statSync(file).size;
      fs.watchFile(file, { interval: 500 }, (cur) => {
        if (cur.size < size) size = 0; // rotated
        if (cur.size === size) return;
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(cur.size - size);
        fs.readSync(fd, buf, 0, buf.length, size);
        fs.closeSync(fd);
        size = cur.size;
        for (const l of buf.toString('utf8').split('\n').filter(Boolean)) ctx.out(formatLogLine(l));
      });
      return new Promise<number>(() => undefined);
    },
  },
  {
    name: 'pair',
    summary: 'Show a one-time QR code to connect a phone (valid 10 minutes)',
    usage: ['longcord pair [--url <https-url>]'],
    options: { url: { type: 'string' } },
    optionHelp: { url: 'Base URL to put in the QR code (default: the Tailscale URL from setup)' },
    examples: ['longcord pair'],
    async run(ctx, v) {
      const base = str(v.url) ?? ctx.config.get().publicUrl;
      if (!base)
        throw new CliError(
          'No phone URL configured. Run `longcord setup` (with Tailscale connected) or pass --url.',
        );
      if (!/^https:\/\//.test(base)) throw new CliError('The pairing URL must start with https://');
      if (!(await healthy(ctx, ctx.config.get().port)))
        ctx.out('! The server is not running right now; start it before scanning.');
      await printPairing(ctx, base);
      ctx.out(`The code works once and expires in ${PAIRING_TTL_MS / 60_000} minutes.`);
      return 0;
    },
  },
  {
    name: 'passcode',
    summary: 'Create a new fallback passcode for signing in without a QR code',
    usage: ['longcord passcode [--set]'],
    options: { set: { type: 'boolean' } },
    optionHelp: { set: 'Type your own passcode instead of generating one' },
    examples: ['longcord passcode', 'longcord passcode --set'],
    async run(ctx, v) {
      let pass: string;
      if (v.set) {
        if (!ctx.interactive) throw new CliError('--set needs an interactive terminal');
        pass = await ctx.prompt.ask('New passcode', { secret: true });
        const again = await ctx.prompt.ask('Repeat passcode', { secret: true });
        if (pass !== again) throw new CliError('The passcodes do not match');
      } else pass = generatePasscode();
      const problem = passcodeProblem(pass);
      if (problem) throw new CliError(problem);
      ctx.secrets.update((s) => void (s.passcodeHash = hashPasscode(pass)));
      ctx.out(v.set ? 'Passcode updated.' : `New passcode: ${pass}`);
      ctx.out(
        'Devices that are already signed in stay signed in. Revoke them with `longcord devices revoke`.',
      );
      return 0;
    },
  },
  {
    name: 'projects',
    summary: 'Manage the folders the agent is allowed to work in',
    usage: [
      'longcord projects list',
      'longcord projects add <folder> [--name <name>]',
      'longcord projects remove <id>',
    ],
    options: { name: { type: 'string' } },
    optionHelp: { name: 'Display name for the project (default: folder name)' },
    examples: ['longcord projects add ~/code/my-app', 'longcord projects remove my-app-1a2b3c'],
    async run(ctx, v, pos) {
      const action = sub(pos, ['list', 'add', 'remove'], 'projects');
      if (action === 'list') {
        const ps = ctx.config.get().projects;
        if (!ps.length) ctx.out('No projects. Add one with `longcord projects add <folder>`.');
        for (const p of ps) ctx.out(`${p.id}  ${p.name}  ${p.path}`);
        return 0;
      }
      const target = pos[1];
      if (!target)
        throw new CliError(
          `Usage: longcord projects ${action} <${action === 'add' ? 'folder' : 'id'}>`,
        );
      if (action === 'add') {
        const cfg = addProject(ctx, ctx.config.get(), target, str(v.name));
        ctx.config.set(cfg);
        return 0;
      }
      const cfg = ctx.config.get();
      const match = cfg.projects.find((p) => p.id === target || p.path === path.resolve(target));
      if (!match) throw new CliError(`No project ${target}. See \`longcord projects list\`.`);
      ctx.config.set({ ...cfg, projects: cfg.projects.filter((p) => p.id !== match.id) });
      ctx.out(`Removed ${match.name}. Existing sessions for it can no longer start new runs.`);
      return 0;
    },
  },
  {
    name: 'devices',
    summary: 'List or revoke paired phones and browsers',
    usage: ['longcord devices list', 'longcord devices revoke <id>'],
    options: {},
    optionHelp: {},
    examples: ['longcord devices list', 'longcord devices revoke 3f2a'],
    async run(ctx, _v, pos) {
      const action = sub(pos, ['list', 'revoke'], 'devices');
      const store = new DeviceStore(ctx.paths.devices);
      if (action === 'list') {
        const ds = store.list();
        if (!ds.length) ctx.out('No devices. Pair one with `longcord pair`.');
        for (const d of ds)
          ctx.out(
            `${d.id.slice(0, 8)}  ${d.name}  paired ${d.createdAt.slice(0, 10)}  last seen ${d.lastSeenAt?.slice(0, 16).replace('T', ' ') ?? 'never'}`,
          );
        return 0;
      }
      if (!pos[1]) throw new CliError('Usage: longcord devices revoke <id>');
      const name = store.revoke(pos[1]);
      if (!name)
        throw new CliError(`No single device matches ${pos[1]}. See \`longcord devices list\`.`);
      ctx.out(`Revoked ${name}. It is signed out immediately.`);
      return 0;
    },
  },
  {
    name: 'config',
    summary: 'Read or change settings (see docs/reference/configuration.md)',
    usage: [
      'longcord config get [key]',
      'longcord config set <key> <value>',
      'longcord config path',
    ],
    options: {},
    optionHelp: {},
    examples: [
      'longcord config get',
      'longcord config set dailySpendCapUsd 15',
      'longcord config set dailyRestart null',
    ],
    async run(ctx, _v, pos) {
      const action = sub(pos, ['get', 'set', 'path'], 'config');
      if (action === 'path') {
        ctx.out(ctx.paths.config);
        return 0;
      }
      const cfg = ctx.config.get();
      if (action === 'get') {
        const key = pos[1];
        if (key && !(key in ConfigSchema.shape))
          throw new CliError(`Unknown key ${key}. Keys: ${CONFIG_KEYS.join(', ')}`);
        ctx.out(JSON.stringify(key ? cfg[key as keyof Config] : cfg, null, 2));
        return 0;
      }
      const [, key, value] = pos;
      if (!key || value === undefined)
        throw new CliError('Usage: longcord config set <key> <value>');
      if (key === 'projects')
        throw new CliError('Use `longcord projects add|remove` to change projects.');
      try {
        ctx.config.set(setConfigValue(cfg, key, value));
      } catch (err) {
        throw new CliError((err as Error).message);
      }
      ctx.out(`${key} = ${JSON.stringify(ctx.config.get()[key as keyof Config])}`);
      if (
        [
          'port',
          'host',
          'logLevel',
          'logContent',
          'logMaxBytes',
          'logMaxFiles',
          'keepAwake',
          'dailyRestart',
        ].includes(key)
      ) {
        ctx.out('Restart longcord for this change to take effect.');
      }
      return 0;
    },
  },
  {
    name: 'doctor',
    summary: 'Check the installation and print fixes (output is safe to share)',
    usage: ['longcord doctor [--offline] [--json]'],
    options: { offline: { type: 'boolean' }, json: { type: 'boolean' } },
    optionHelp: {
      offline: 'Skip checks that use the network (API key validity, clock)',
      json: 'Print machine-readable JSON',
    },
    examples: ['longcord doctor', 'longcord doctor --offline'],
    async run(ctx, v) {
      const results = await runDoctor(ctx, { offline: v.offline === true });
      if (v.json) {
        const { redactIdentity } = await import('../shared/redact.js');
        ctx.out(
          redactIdentity(JSON.stringify(results, null, 2), {
            username: ctx.os.username,
            hostname: ctx.os.hostname,
            home: ctx.os.homedir,
          }),
        );
      } else ctx.out(formatDoctor(results, ctx.os));
      return results.some((r) => r.status === 'fail') ? 1 : 0;
    },
  },
  {
    name: 'update',
    summary: 'Explain how to update longcord',
    usage: ['longcord update'],
    options: {},
    optionHelp: {},
    examples: ['longcord update'],
    async run(ctx) {
      ctx.out(`You have longcord ${packageVersion()}. To update:`);
      ctx.out('');
      ctx.out('  npm install -g longcord@latest');
      ctx.out('  longcord setup --yes --no-tailscale');
      ctx.out('');
      ctx.out('The second command reinstalls the background service so it runs the new version.');
      ctx.out(
        'Your data is migrated automatically on first start, with a backup. See docs/upgrading.md.',
      );
      return 0;
    },
  },
  {
    name: 'uninstall',
    summary: 'Remove the background service and Tailscale serve config; optionally delete data',
    usage: ['longcord uninstall [--delete-data] [--yes]'],
    options: { 'delete-data': { type: 'boolean' }, yes: { type: 'boolean', short: 'y' } },
    optionHelp: {
      'delete-data': 'Also delete sessions, settings, keys and logs',
      yes: 'Do not ask for confirmation',
    },
    examples: ['longcord uninstall', 'longcord uninstall --delete-data --yes'],
    async run(ctx, v) {
      const yes = v.yes === true;
      if (!yes && !ctx.interactive) throw new CliError('Pass --yes to uninstall without prompts.');
      if (!yes && !(await ctx.prompt.confirm('Remove the longcord background service?', true)))
        return 1;
      const r = await serviceManager(ctx.os, ctx.paths.root).uninstall();
      ctx.out(`✓ ${r.message}`);
      const cfg = ctx.config.get();
      if (
        cfg.publicUrl &&
        (yes || (await ctx.prompt.confirm('Turn off tailscale serve on port 443?', true)))
      ) {
        const s = await disableServe(ctx.os);
        ctx.out(`${s.ok ? '✓' : '!'} ${s.message}`);
      }
      let del = v['delete-data'] === true;
      if (!del && !yes)
        del = await ctx.prompt.confirm(`Also delete all data in ${ctx.paths.root}?`, false);
      if (del) {
        fs.rmSync(ctx.paths.root, { recursive: true, force: true });
        ctx.out('✓ Data deleted');
      } else ctx.out(`Data kept in ${ctx.paths.root}`);
      ctx.out('Finally, remove the program with: npm uninstall -g longcord');
      return 0;
    },
  },
];

function formatLogLine(line: string): string {
  try {
    const { time, level, msg, ...rest } = JSON.parse(line) as Record<string, unknown>;
    const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${String(time).replace('T', ' ').slice(0, 19)} ${String(level).toUpperCase().padEnd(5)} ${String(msg)}${extra}`;
  } catch {
    return line;
  }
}

// ------------------------------------------------------------------ help

const GLOBAL_HELP = [
  ['--home <dir>', 'Use this data directory (default: per-OS location, or LONGCORD_HOME)'],
  ['-h, --help', 'Show help'],
  ['-v, --version', 'Show the version'],
];

function optionLabel(name: string, o: Options[string]): string {
  const short = o.short ? `-${o.short}, ` : '';
  return `${short}--${name}${o.type === 'string' ? ' <value>' : ''}`;
}

export function commandHelp(c: CommandSpec): string {
  const lines = [c.summary, '', 'Usage:', ...c.usage.map((u) => `  ${u}`)];
  const opts = Object.entries(c.options).filter(([n]) => !c.hidden?.includes(n));
  if (opts.length) {
    lines.push('', 'Options:');
    for (const [n, o] of opts)
      lines.push(`  ${optionLabel(n, o).padEnd(26)} ${c.optionHelp[n] ?? ''}`);
  }
  lines.push('', 'Examples:', ...c.examples.map((e) => `  ${e}`));
  return lines.join('\n');
}

export function mainHelp(): string {
  const lines = [
    `longcord ${packageVersion()}: control a coding agent on this computer from your phone. Powered by Claude.`,
    '',
    'Usage: longcord <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`),
    '',
    'Global options:',
    ...GLOBAL_HELP.map(([a, b]) => `  ${a!.padEnd(26)} ${b}`),
    '',
    'Run `longcord <command> --help` for details.',
  ];
  return lines.join('\n');
}

/** Markdown reference for docs/reference/cli.md (kept in sync by `npm run docs:check`). */
export function cliReference(): string {
  const out = [
    '# CLI reference',
    '',
    '<!-- This file is generated from the CLI help text by `npm run docs:cli`. Do not edit by hand. -->',
    '',
    'Run `longcord --help` or `longcord <command> --help` to see the same text in your terminal.',
    '',
    '```text',
    mainHelp().replace(/^longcord \S+:/, 'longcord <version>:'),
    '```',
    '',
  ];
  for (const c of COMMANDS) {
    out.push(`## ${c.name}`, '', '```text', commandHelp(c), '```', '');
  }
  out.push(
    `Permission modes accepted by the app: ${PERMISSION_MODES.map((m) => `\`${m}\``).join(', ')}.`,
    '',
  );
  return out.join('\n');
}

// ------------------------------------------------------------------ main

export async function main(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const out = overrides.out ?? ((l = '') => process.stdout.write(l + '\n'));
  const err = overrides.err ?? ((l = '') => process.stderr.write(l + '\n'));
  // Global flags may appear anywhere.
  let home: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--home') home = argv[++i];
    else if (a.startsWith('--home=')) home = a.slice(7);
    else rest.push(a);
  }
  const [name, ...args] = rest;
  if (!name || name === '-h' || name === '--help' || name === 'help') {
    out(mainHelp());
    return 0;
  }
  if (name === '-v' || name === '--version') {
    out(packageVersion());
    return 0;
  }
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    err(`Unknown command: ${name}`);
    err('Run `longcord --help` to see the commands.');
    return 2;
  }
  if (args.includes('--help') || args.includes('-h')) {
    out(commandHelp(cmd));
    return 0;
  }
  // parseArgs supports --no-<flag> only through explicit options.
  const options: Options = { ...cmd.options };
  let values: Values;
  let positionals: string[];
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
    values = parsed.values as Values;
    positionals = parsed.positionals;
  } catch (e) {
    err((e as Error).message);
    err(`Run \`longcord ${cmd.name} --help\` for usage.`);
    return 2;
  }
  // Normalise --no-x flags into x: false.
  for (const k of Object.keys(values)) {
    if (k.startsWith('no-')) {
      values[k.slice(3)] = false;
      delete values[k];
    }
  }
  const ctx = createContext({
    ...overrides,
    out,
    err,
    ...(home ? { paths: dataPaths(path.resolve(home)) } : {}),
  });
  try {
    return await cmd.run(ctx, values, positionals);
  } catch (e) {
    if (e instanceof CliError) {
      err(`Error: ${e.message}`);
      return e.exitCode;
    }
    err(`Error: ${(e as Error).message}`);
    return 1;
  }
}

export { serviceCommand };
