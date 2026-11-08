import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import type { DeviceInfo } from '../shared/api.js';
import { JsonFile } from './fsutil.js';

export const COOKIE_NAME = 'lc_session';
export const PAIRING_TTL_MS = 10 * 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- passcode

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export function verifyPasscode(passcode: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(passcode, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/** A random, readable passcode: 4 groups of 4 characters without look-alikes. */
export function generatePasscode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

export function passcodeProblem(passcode: string): string | null {
  if (passcode.length < 8) return 'The passcode must be at least 8 characters.';
  if (passcode.length > 200) return 'The passcode is too long.';
  return null;
}

// ---------------------------------------------------------------- devices

const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenHash: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
const DevicesSchema = z.object({ devices: z.array(DeviceSchema) });
type Device = z.infer<typeof DeviceSchema>;

const PairingSchema = z.object({
  tokens: z.array(z.object({ hash: z.string(), expiresAt: z.number() })),
});

export class DeviceStore {
  private file: JsonFile<z.infer<typeof DevicesSchema>>;
  private lastTouch = new Map<string, number>();

  constructor(path: string) {
    this.file = new JsonFile(path, DevicesSchema, () => ({ devices: [] }), 0o600);
  }

  list(currentId?: string): DeviceInfo[] {
    return this.file.get().devices.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      current: d.id === currentId,
    }));
  }

  /** Create a device and return its raw token (only ever shown inside the cookie). */
  create(name: string): { id: string; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const clean =
      name
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, 60) || 'Device';
    this.file.update((d) => {
      d.devices.push({
        id,
        name: clean,
        tokenHash: sha256(token),
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
      });
    });
    return { id, token };
  }

  verify(id: string, token: string): Device | null {
    const d = this.file.get().devices.find((x) => x.id === id);
    if (!d || !safeEqual(d.tokenHash, sha256(token))) return null;
    const now = Date.now();
    if (now - (this.lastTouch.get(id) ?? 0) > 5 * 60_000) {
      this.lastTouch.set(id, now);
      this.file.update((all) => {
        const dev = all.devices.find((x) => x.id === id);
        if (dev) dev.lastSeenAt = new Date(now).toISOString();
      });
    }
    return d;
  }

  /** Revoke by id or unique id prefix. Returns the revoked device's name. */
  revoke(idOrPrefix: string): string | null {
    const matches = this.file
      .get()
      .devices.filter((d) => d.id === idOrPrefix || d.id.startsWith(idOrPrefix));
    if (matches.length !== 1) return null;
    const target = matches[0]!;
    this.file.update((all) => {
      all.devices = all.devices.filter((d) => d.id !== target.id);
    });
    return target.name;
  }
}

export class PairingStore {
  private file: JsonFile<z.infer<typeof PairingSchema>>;
  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = new JsonFile(path, PairingSchema, () => ({ tokens: [] }), 0o600);
  }

  /** Create a one-time pairing token that expires after 10 minutes. */
  create(): { token: string; expiresAt: number } {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.file.update((d) => {
      d.tokens = d.tokens.filter((t) => t.expiresAt > this.now());
      d.tokens.push({ hash: sha256(token), expiresAt });
    });
    return { token, expiresAt };
  }

  /** Consume a token. Works once, and only before it expires. */
  consume(token: string): boolean {
    const hash = sha256(token);
    const data = this.file.get();
    const match = data.tokens.find((t) => safeEqual(t.hash, hash));
    const valid = !!match && match.expiresAt > this.now();
    if (match || data.tokens.some((t) => t.expiresAt <= this.now())) {
      this.file.update((d) => {
        d.tokens = d.tokens.filter((t) => t.hash !== hash && t.expiresAt > this.now());
      });
    }
    return valid;
  }
}

// ---------------------------------------------------------------- cookies

export function signCookie(secret: string, deviceId: string, token: string): string {
  const body = `${deviceId}.${token}`;
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function parseCookie(
  secret: string,
  value: string,
): { deviceId: string; token: string } | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [deviceId, token, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${deviceId}.${token}`).digest('base64url');
  return safeEqual(sig, expected) ? { deviceId, token } : null;
}

export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(value: string, maxAgeDays = 400): string {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeDays * 86400}`;
}

export function clearedCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

// ---------------------------------------------------------------- rate limiting

export interface LimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  globalMaxFailures?: number;
  now?: () => number;
}

/**
 * Login rate limiting with lockout. After `maxFailures` failures within the
 * window a client is locked out; repeated lockouts double the lock time.
 * A global limit protects against attempts spread over many clients.
 */
export class LoginLimiter {
  private clients = new Map<
    string,
    { failures: number[]; lockedUntil: number; lockouts: number }
  >();
  private global: number[] = [];
  private globalLockedUntil = 0;
  private readonly o: Required<LimiterOptions>;

  constructor(opts: LimiterOptions = {}) {
    this.o = {
      maxFailures: opts.maxFailures ?? 5,
      windowMs: opts.windowMs ?? 15 * 60_000,
      lockMs: opts.lockMs ?? 15 * 60_000,
      globalMaxFailures: opts.globalMaxFailures ?? 50,
      now: opts.now ?? Date.now,
    };
  }

  /** Milliseconds until the client may try again, or 0 if allowed. */
  retryAfter(key: string): number {
    const now = this.o.now();
    const c = this.clients.get(key);
    return Math.max(0, (c?.lockedUntil ?? 0) - now, this.globalLockedUntil - now);
  }

  fail(key: string): void {
    const now = this.o.now();
    const c = this.clients.get(key) ?? { failures: [], lockedUntil: 0, lockouts: 0 };
    c.failures = c.failures.filter((t) => now - t < this.o.windowMs);
    c.failures.push(now);
    if (c.failures.length >= this.o.maxFailures) {
      c.lockouts++;
      c.lockedUntil = now + Math.min(this.o.lockMs * 2 ** (c.lockouts - 1), 24 * 3600_000);
      c.failures = [];
    }
    this.clients.set(key, c);
    this.global = this.global.filter((t) => now - t < 3600_000);
    this.global.push(now);
    if (this.global.length >= this.o.globalMaxFailures) {
      this.globalLockedUntil = now + this.o.lockMs;
      this.global = [];
    }
  }

  succeed(key: string): void {
    const c = this.clients.get(key);
    if (c) c.failures = [];
  }
}
