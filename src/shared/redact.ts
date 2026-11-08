// Redaction helpers used by logs, `doctor` output and error messages.

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

const SECRET_KEYS =
  /(api[_-]?key|token|secret|passcode|password|cookie|authorization|p256dh|private)/i;

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

/** Deeply copy a value, replacing secret-looking keys and values. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[…]';
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Error) {
      return { name: value.name, message: redactSecrets(value.message) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const secretLike = SECRET_KEYS.test(k) && typeof v === 'string';
      out[k] = secretLike ? '[REDACTED]' : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface IdentityTerms {
  username?: string;
  hostname?: string;
  home?: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove personal identifiers from text meant to be pasted publicly:
 * home directory, username, hostname, tailnet names, IP addresses, emails, secrets.
 */
export function redactIdentity(text: string, ids: IdentityTerms): string {
  let out = redactSecrets(text);
  if (ids.home && ids.home.length > 3) {
    const variants = new Set([
      ids.home,
      ids.home.replace(/\\/g, '/'),
      ids.home.replace(/\//g, '\\'),
    ]);
    for (const v of variants) out = out.replace(new RegExp(escapeRe(v), 'gi'), '~');
  }
  out = out.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b/gi, '<machine>.<tailnet>.ts.net');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '<email>');
  out = out.replace(/\b(?!127\.)(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
  out = out.replace(/\b[A-Za-z]:\\Users\\[^\\\s"']+/gi, 'C:\\Users\\<user>');
  out = out.replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>');
  for (const [term, label] of [
    [ids.username, '<user>'],
    [ids.hostname, '<host>'],
  ] as const) {
    if (term && term.length >= 3) {
      out = out.replace(
        new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'gi'),
        label,
      );
    }
  }
  return out;
}
