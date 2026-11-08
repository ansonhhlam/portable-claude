import type { OsLayer } from './os.js';

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  loggedIn: boolean;
  /** Machine DNS name without the trailing dot, e.g. my-pc.example-tailnet.ts.net */
  dnsName: string | null;
  httpsEnabled: boolean;
  error?: string;
}

export const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download';
export const TAILSCALE_HTTPS_DOCS = 'https://tailscale.com/kb/1153/enabling-https';

/** The tailscale binary name, with the default Windows/macOS install locations as fallbacks. */
export function tailscaleCandidates(os: OsLayer): string[] {
  if (os.platform === 'win32') return ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
  if (os.platform === 'darwin')
    return ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  return ['tailscale'];
}

export async function findTailscale(os: OsLayer): Promise<string | null> {
  for (const c of tailscaleCandidates(os)) {
    const r = await os.exec(c, ['version'], { timeoutMs: 10_000 });
    if (r.code === 0) return c;
  }
  return null;
}

export async function tailscaleStatus(os: OsLayer): Promise<TailscaleStatus> {
  const bin = await findTailscale(os);
  if (!bin)
    return {
      installed: false,
      running: false,
      loggedIn: false,
      dnsName: null,
      httpsEnabled: false,
    };
  const r = await os.exec(bin, ['status', '--json'], { timeoutMs: 15_000 });
  let data: { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null } =
    {};
  try {
    data = JSON.parse(r.stdout) as typeof data;
  } catch {
    return {
      installed: true,
      running: false,
      loggedIn: false,
      dnsName: null,
      httpsEnabled: false,
      error: 'could not read tailscale status',
    };
  }
  const dnsName = data.Self?.DNSName?.replace(/\.$/, '') || null;
  return {
    installed: true,
    running: data.BackendState === 'Running',
    loggedIn: data.BackendState === 'Running' || data.BackendState === 'Starting',
    dnsName,
    httpsEnabled: Array.isArray(data.CertDomains) && data.CertDomains.length > 0,
  };
}

export function serveTarget(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Configure `tailscale serve` to proxy HTTPS on the tailnet to the local server. */
export async function enableServe(
  os: OsLayer,
  port: number,
): Promise<{ ok: boolean; message: string }> {
  const bin = await findTailscale(os);
  if (!bin) return { ok: false, message: 'Tailscale is not installed' };
  const r = await os.exec(bin, ['serve', '--bg', '--https=443', serveTarget(port)], {
    timeoutMs: 30_000,
  });
  if (r.code !== 0)
    return { ok: false, message: (r.stderr || r.stdout).trim() || 'tailscale serve failed' };
  return { ok: true, message: 'tailscale serve is forwarding HTTPS to the local server' };
}

export async function disableServe(os: OsLayer): Promise<{ ok: boolean; message: string }> {
  const bin = await findTailscale(os);
  if (!bin) return { ok: true, message: 'Tailscale is not installed' };
  const r = await os.exec(bin, ['serve', '--https=443', 'off'], { timeoutMs: 30_000 });
  return {
    ok: r.code === 0,
    message: (r.stderr || r.stdout).trim() || 'tailscale serve turned off',
  };
}

/** Does the current serve config forward to our port? */
export async function serveConfigured(os: OsLayer, port: number): Promise<boolean | null> {
  const bin = await findTailscale(os);
  if (!bin) return null;
  const r = await os.exec(bin, ['serve', 'status', '--json'], { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  return r.stdout.includes(`127.0.0.1:${port}`) || r.stdout.includes(`localhost:${port}`);
}
