// Background service installation per OS. Everything goes through OsLayer.
import path from 'node:path';
import type { OsLayer } from './os.js';
import { shQuote, xmlEscape } from './os.js';

export const SERVICE_NAME = 'longcord';
export const LAUNCHD_LABEL = 'dev.longcord.agent';

export type ServiceState = 'running' | 'stopped' | 'not-installed' | 'unknown';

export interface InstallResult {
  ok: boolean;
  /** Short description of how the service starts, for the user. */
  mode: string;
  notes: string[];
  error?: string;
}

export interface ServiceManager {
  readonly kind: 'windows-task' | 'launchd' | 'systemd';
  install(): Promise<InstallResult>;
  uninstall(): Promise<{ ok: boolean; message: string }>;
  state(): Promise<ServiceState>;
  /** Where the service definition lives (for status/doctor output). */
  location(): string;
}

/** The command the service runs: `node <cli> start --service --home <dataDir>`. */
export function serviceCommand(os: OsLayer, dataDir: string): string[] {
  return [os.nodePath, os.cliPath, 'start', '--service', '--home', dataDir];
}

export function serviceManager(os: OsLayer, dataDir: string): ServiceManager {
  if (os.platform === 'win32') return new WindowsTask(os, dataDir);
  if (os.platform === 'darwin') return new LaunchAgent(os, dataDir);
  return new SystemdUser(os, dataDir);
}

// ------------------------------------------------------------------ Windows

export function windowsTaskXml(
  os: OsLayer,
  dataDir: string,
  logonType: 'S4U' | 'InteractiveToken',
): string {
  const [cmd, ...args] = serviceCommand(os, dataDir);
  const user = `${os.env.USERDOMAIN ? os.env.USERDOMAIN + '\\' : ''}${os.username}`;
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
  const trigger =
    logonType === 'S4U'
      ? '<BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger>'
      : `<LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(user)}</UserId></LogonTrigger>`;
  return `<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>longcord server (remote control for coding agents)</Description>
  </RegistrationInfo>
  <Triggers>
    ${trigger}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEscape(user)}</UserId>
      <LogonType>${logonType}</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(cmd!)}</Command>
      <Arguments>${xmlEscape(quoted)}</Arguments>
      <WorkingDirectory>${xmlEscape(dataDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

class WindowsTask implements ServiceManager {
  readonly kind = 'windows-task' as const;
  constructor(
    private readonly os: OsLayer,
    private readonly dataDir: string,
  ) {}

  location(): string {
    return `Task Scheduler: ${SERVICE_NAME}`;
  }

  private async register(xmlFile: string): Promise<{ code: number; err: string }> {
    const ps = `Register-ScheduledTask -TaskName '${SERVICE_NAME}' -Xml (Get-Content -Raw -LiteralPath '${xmlFile.replace(/'/g, "''")}') -Force | Out-Null`;
    const r = await this.os.exec(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeoutMs: 60_000 },
    );
    return { code: r.code, err: (r.stderr || r.stdout).trim() };
  }

  async install(): Promise<InstallResult> {
    const xmlFile = path.join(this.dataDir, 'service', 'longcord-task.xml');
    const notes: string[] = [];
    // First choice: start at boot without anyone signing in (S4U). This needs
    // administrator rights; without them, fall back to starting at sign-in.
    this.os.writeFile(xmlFile, windowsTaskXml(this.os, this.dataDir, 'S4U'));
    let r = await this.register(xmlFile);
    let mode = 'starts when the computer boots, even before anyone signs in';
    if (r.code !== 0) {
      this.os.writeFile(xmlFile, windowsTaskXml(this.os, this.dataDir, 'InteractiveToken'));
      r = await this.register(xmlFile);
      mode = 'starts when you sign in to Windows';
      notes.push(
        'To start at boot without signing in, run `longcord setup` again from an administrator terminal,',
        'or turn on automatic sign-in (see docs/getting-started/windows.md).',
      );
    }
    if (r.code !== 0)
      return { ok: false, mode, notes, error: r.err || 'Could not register the scheduled task' };
    await this.os.exec('schtasks.exe', ['/Run', '/TN', SERVICE_NAME]);
    return { ok: true, mode, notes };
  }

  async uninstall() {
    await this.os.exec('schtasks.exe', ['/End', '/TN', SERVICE_NAME]);
    const r = await this.os.exec('schtasks.exe', ['/Delete', '/TN', SERVICE_NAME, '/F']);
    return {
      ok: r.code === 0 || /cannot find/i.test(r.stderr),
      message: r.code === 0 ? 'Scheduled task removed' : 'No scheduled task to remove',
    };
  }

  async state(): Promise<ServiceState> {
    const r = await this.os.exec('schtasks.exe', [
      '/Query',
      '/TN',
      SERVICE_NAME,
      '/FO',
      'CSV',
      '/NH',
    ]);
    if (r.code !== 0) return 'not-installed';
    if (/"Running"/i.test(r.stdout)) return 'running';
    if (/"(Ready|Disabled|Queued)"/i.test(r.stdout)) return 'stopped';
    return 'unknown';
  }
}

// ------------------------------------------------------------------ macOS

export function launchdPlist(os: OsLayer, dataDir: string): string {
  const args = serviceCommand(os, dataDir)
    .map((a) => `    <string>${xmlEscape(a)}</string>`)
    .join('\n');
  const logs = path.join(dataDir, 'logs');
  const pathEnv = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(dataDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathEnv}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logs, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logs, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

class LaunchAgent implements ServiceManager {
  readonly kind = 'launchd' as const;
  constructor(
    private readonly os: OsLayer,
    private readonly dataDir: string,
  ) {}

  location(): string {
    return path.join(this.os.homedir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  }

  private get domain(): string {
    return `gui/${this.os.uid}`;
  }

  async install(): Promise<InstallResult> {
    this.os.writeFile(this.location(), launchdPlist(this.os, this.dataDir), 0o644);
    await this.os.exec('launchctl', ['bootout', `${this.domain}/${LAUNCHD_LABEL}`]);
    const r = await this.os.exec('launchctl', ['bootstrap', this.domain, this.location()]);
    if (r.code !== 0)
      return { ok: false, mode: '', notes: [], error: (r.stderr || r.stdout).trim() };
    await this.os.exec('launchctl', ['kickstart', '-k', `${this.domain}/${LAUNCHD_LABEL}`]);
    return {
      ok: true,
      mode: 'starts when you log in and restarts if it stops',
      notes: [
        'macOS runs LaunchAgents after login. For unattended reboots, turn on automatic login (see docs/getting-started/macos.md).',
      ],
    };
  }

  async uninstall() {
    await this.os.exec('launchctl', ['bootout', `${this.domain}/${LAUNCHD_LABEL}`]);
    const existed = this.os.exists(this.location());
    this.os.removeFile(this.location());
    return { ok: true, message: existed ? 'LaunchAgent removed' : 'No LaunchAgent to remove' };
  }

  async state(): Promise<ServiceState> {
    if (!this.os.exists(this.location())) return 'not-installed';
    const r = await this.os.exec('launchctl', ['print', `${this.domain}/${LAUNCHD_LABEL}`]);
    if (r.code !== 0) return 'stopped';
    return /state = running/.test(r.stdout) ? 'running' : 'stopped';
  }
}

// ------------------------------------------------------------------ Linux

export function systemdUnit(os: OsLayer, dataDir: string): string {
  const exec = serviceCommand(os, dataDir).map(shQuote).join(' ');
  return `[Unit]
Description=longcord server (remote control for coding agents)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
WorkingDirectory=${shQuote(dataDir)}
Restart=always
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
}

class SystemdUser implements ServiceManager {
  readonly kind = 'systemd' as const;
  constructor(
    private readonly os: OsLayer,
    private readonly dataDir: string,
  ) {}

  location(): string {
    const base = this.os.env.XDG_CONFIG_HOME ?? path.join(this.os.homedir, '.config');
    return path.join(base, 'systemd', 'user', `${SERVICE_NAME}.service`);
  }

  async install(): Promise<InstallResult> {
    this.os.writeFile(this.location(), systemdUnit(this.os, this.dataDir), 0o644);
    const notes: string[] = [];
    let r = await this.os.exec('systemctl', ['--user', 'daemon-reload']);
    if (r.code === 0)
      r = await this.os.exec('systemctl', ['--user', 'enable', '--now', `${SERVICE_NAME}.service`]);
    if (r.code !== 0) return { ok: false, mode: '', notes, error: (r.stderr || r.stdout).trim() };
    const linger = await this.os.exec('loginctl', ['enable-linger', this.os.username]);
    if (linger.code !== 0) {
      notes.push(
        `Could not enable lingering. Run: sudo loginctl enable-linger ${this.os.username}`,
      );
    }
    return {
      ok: true,
      mode:
        linger.code === 0
          ? 'starts at boot and restarts if it stops'
          : 'starts when you log in and restarts if it stops',
      notes,
    };
  }

  async uninstall() {
    await this.os.exec('systemctl', ['--user', 'disable', '--now', `${SERVICE_NAME}.service`]);
    const existed = this.os.exists(this.location());
    this.os.removeFile(this.location());
    await this.os.exec('systemctl', ['--user', 'daemon-reload']);
    return {
      ok: true,
      message: existed ? 'systemd user service removed' : 'No systemd service to remove',
    };
  }

  async state(): Promise<ServiceState> {
    if (!this.os.exists(this.location())) return 'not-installed';
    const r = await this.os.exec('systemctl', ['--user', 'is-active', `${SERVICE_NAME}.service`]);
    const s = r.stdout.trim();
    if (s === 'active') return 'running';
    if (s === 'inactive' || s === 'failed' || s === 'activating') return 'stopped';
    return 'unknown';
  }
}

// ------------------------------------------------------------------ sleep

export interface SleepCheck {
  status: 'pass' | 'warn' | 'unknown';
  detail: string;
  fixable: boolean;
}

export async function checkSleep(os: OsLayer): Promise<SleepCheck> {
  if (os.platform === 'win32') {
    const r = await os.exec('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE']);
    const m = r.stdout.match(/AC Power Setting Index:\s*0x([0-9a-f]+)/i);
    if (!m) return { status: 'unknown', detail: 'Could not read the sleep setting', fixable: true };
    const secs = parseInt(m[1]!, 16);
    return secs === 0
      ? { status: 'pass', detail: 'Sleep is off when plugged in', fixable: false }
      : {
          status: 'warn',
          detail: `The computer sleeps after ${Math.round(secs / 60)} minutes when plugged in`,
          fixable: true,
        };
  }
  if (os.platform === 'darwin') {
    const r = await os.exec('pmset', ['-g']);
    const m = r.stdout.match(/^\s*sleep\s+(\d+)/m);
    if (!m) return { status: 'unknown', detail: 'Could not read the sleep setting', fixable: true };
    return m[1] === '0'
      ? { status: 'pass', detail: 'System sleep is off', fixable: false }
      : { status: 'warn', detail: `The Mac sleeps after ${m[1]} minutes idle`, fixable: true };
  }
  const r = await os.exec('systemctl', ['is-enabled', 'suspend.target']);
  if (r.stdout.trim() === 'masked')
    return { status: 'pass', detail: 'Suspend is disabled', fixable: false };
  return {
    status: 'warn',
    detail: 'Suspend may be enabled; see docs/guides/travel.md',
    fixable: false,
  };
}

/**
 * Apply the safe sleep fix for this OS. On Windows this turns off sleep and
 * hibernate while plugged in. On macOS it turns on the keepAwake option, which
 * runs `caffeinate` alongside the server. Linux is documented only.
 */
export async function fixSleep(
  os: OsLayer,
): Promise<{ ok: boolean; message: string; setKeepAwake?: boolean }> {
  if (os.platform === 'win32') {
    const a = await os.exec('powercfg', ['/change', 'standby-timeout-ac', '0']);
    const b = await os.exec('powercfg', ['/change', 'hibernate-timeout-ac', '0']);
    return a.code === 0 && b.code === 0
      ? { ok: true, message: 'Sleep and hibernate are now off while plugged in' }
      : { ok: false, message: 'powercfg failed; change it in Settings > System > Power' };
  }
  if (os.platform === 'darwin') {
    return {
      ok: true,
      message: 'keepAwake is on: longcord keeps the Mac awake while it runs',
      setKeepAwake: true,
    };
  }
  return { ok: false, message: 'On Linux, disable suspend yourself (see docs/guides/travel.md)' };
}
