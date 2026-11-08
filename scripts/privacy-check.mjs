#!/usr/bin/env node
// Privacy and secret scanner for this public repository.
//
// Scans the content that will be committed (the git index), or with
// --history every line ever added in any commit, for secrets, personal
// information and files that must never be published.
//
// Usage:
//   node scripts/privacy-check.mjs            # scan the index (tracked + staged)
//   node scripts/privacy-check.mjs --history  # scan the full history of all refs
//
// Deliberate fake fixtures can be allowed in `.privacy-allowlist`.
// The current machine's username and hostname are read at runtime and are
// never written anywhere.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { isIPv6 } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const HISTORY = args.has('--history');
const QUIET = args.has('--quiet');

function git(argv, input) {
  const res = spawnSync('git', argv, {
    input,
    maxBuffer: 1024 * 1024 * 512,
  });
  if (res.status !== 0) {
    process.stderr.write(res.stderr);
    throw new Error(`git ${argv.join(' ')} failed`);
  }
  return res.stdout;
}

const repoRoot = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();
process.chdir(repoRoot);

// ---------------------------------------------------------------- allowlist
/** @type {{ glob: RegExp, literal: string }[]} */
const allow = [];
const allowFile = path.join(repoRoot, '.privacy-allowlist');
if (existsSync(allowFile)) {
  for (const raw of readFileSync(allowFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    allow.push({ glob: globToRegExp(line.slice(0, sp)), literal: line.slice(sp + 1).trim() });
  }
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

function isAllowed(file, match) {
  return allow.some((a) => a.glob.test(file) && match.includes(a.literal));
}

// ------------------------------------------------------------------- rules
// Some phrases are assembled from fragments so this file does not flag itself.
const j = (...p) => p.join('');
const BRAND = new RegExp(j('Claude', '\\s+', 'Code'), 'i');
const NOTE_WORDS = new RegExp(
  [
    j('as ', 'requested'),
    j('build ', 'prompt'),
    j('hand', 'over'),
    j('as an ', 'AI'),
    j('AI ', 'assistant'),
    j('coding ', 'assistant'),
    j('language ', 'model wrote'),
    j('Co-Authored-By: ', 'Claude'),
    j('Generated with \\[', 'Claude'),
    j('Chat', 'GPT'),
    j('Co', 'pilot'),
    j('progress ', 'log'),
  ].join('|'),
  'i',
);

const PLACEHOLDER_USERS = new Set([
  'you',
  'your-name',
  'yourname',
  'username',
  'user',
  'me',
  'public',
  'default',
  '<you>',
  '%username%',
  '$user',
]);

const GENERIC_IDENTITIES = new Set([
  'runner',
  'runneradmin',
  'root',
  'admin',
  'administrator',
  'user',
  'you',
  'vscode',
  'codespace',
  'node',
  'localhost',
  'ubuntu',
  'docker',
]);

function identityTerms() {
  const terms = new Set();
  try {
    terms.add(os.userInfo().username);
  } catch {
    /* ignore */
  }
  terms.add(os.hostname().split('.')[0]);
  for (const t of (process.env.PRIVACY_CHECK_EXTRA ?? '').split(',')) terms.add(t.trim());
  return [...terms]
    .filter((t) => t && t.length >= 4 && !GENERIC_IDENTITIES.has(t.toLowerCase()))
    .map((t) => ({
      re: new RegExp(
        `(?<![A-Za-z0-9+/=_-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9+/=_-])`,
        'i',
      ),
    }));
}
const IDENTITY = identityTerms();

function ipv4Allowed(ip) {
  const o = ip.split('.').map(Number);
  if (o.some((n) => n > 255)) return true; // not an address
  if (o[0] === 127 || o[0] === 0) return true;
  if (o[0] === 192 && o[1] === 0 && o[2] === 2) return true; // TEST-NET-1
  if (o[0] === 198 && o[1] === 51 && o[2] === 100) return true; // TEST-NET-2
  if (o[0] === 203 && o[1] === 0 && o[2] === 113) return true; // TEST-NET-3
  if (ip === '255.255.255.255' || ip === '100.64.0.0') return true;
  return false;
}

function ipv6Allowed(ip) {
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('2001:db8:') || l.startsWith('::ffff:127');
}

const EMAIL_OK = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|users\.noreply\.github\.com|noreply\.github\.com)$|^git@github\.com$/i;

/**
 * @typedef {{ id: string, test: (line: string, file: string) => string | null }} Rule
 * @type {Rule[]}
 */
const LINE_RULES = [
  regexRule('anthropic-key', /sk-ant-[A-Za-z0-9_-]{8,}/),
  regexRule('private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/),
  regexRule('github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/),
  regexRule('npm-token', /\bnpm_[A-Za-z0-9]{36}\b/),
  regexRule('aws-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/),
  regexRule('slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/),
  regexRule('vapid-public-key', /(?<![A-Za-z0-9_-])B[A-Za-z0-9_-]{86}(?![A-Za-z0-9_-])/),
  regexRule(
    'vapid-private-key',
    /(?:private[_-]?key|vapid[_-]?private)["'`\s]*[:=]\s*["'`][A-Za-z0-9_-]{43}["'`]/i,
  ),
  regexRule(
    'secret-assignment',
    /(?:api[_-]?key|secret|token|passcode|password)["'`]?\s*[:=]\s*["'`][A-Za-z0-9_\-+/]{24,}={0,2}["'`]/i,
  ),
  {
    id: 'absolute-user-path',
    test(line) {
      const res = [
        /\b[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+([^\\/\s"'`<>)\]]+)/gi,
        /(?<![A-Za-z0-9.])\/Users\/([^/\s"'`<>)\]]+)/g,
        /(?<![A-Za-z0-9.])\/home\/([^/\s"'`<>)\]]+)/g,
      ];
      for (const re of res) {
        for (const m of line.matchAll(re)) {
          if (!PLACEHOLDER_USERS.has(m[1].toLowerCase())) return m[0];
        }
      }
      return null;
    },
  },
  {
    id: 'tailnet-name',
    test(line) {
      for (const m of line.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b/gi)) {
        if (!/example/i.test(m[0])) return m[0];
      }
      return null;
    },
  },
  {
    id: 'email-address',
    test(line) {
      for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g)) {
        if (!EMAIL_OK.test(m[0])) return m[0];
      }
      return null;
    },
  },
  {
    id: 'ipv4-address',
    test(line) {
      for (const m of line.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.]*\d)/g)) {
        if (!ipv4Allowed(m[0])) return m[0];
      }
      return null;
    },
  },
  {
    id: 'ipv6-address',
    test(line) {
      for (const m of line.matchAll(/(?<![\w:.])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi)) {
        const ip = m[0];
        if (!/[0-9a-f]{3}/i.test(ip) && !ip.includes('::')) continue;
        if (isIPv6(ip) && !ipv6Allowed(ip)) return ip;
      }
      return null;
    },
  },
  {
    id: 'machine-identity',
    test(line) {
      for (const t of IDENTITY) {
        const m = line.match(t.re);
        if (m) return m[0];
      }
      return null;
    },
  },
  regexRule('product-branding', BRAND),
];

const DOC_RULES = [regexRule('working-notes-language', NOTE_WORDS)];

function regexRule(id, re) {
  return {
    id,
    test(line) {
      const m = line.match(re);
      return m ? m[0] : null;
    },
  };
}

const FORBIDDEN_PATHS = [
  /(^|\/)\.env(\.(?!example$)[^/]*)?$/,
  /^config\.json$/,
  /(^|\/)data\//,
  /(^|\/)secrets\.json$/,
  /(^|\/)vapid[^/]*\.json$/,
  /\.(pem|key|p12|pfx|har|log|dmp|heapsnapshot)$/i,
  /(^|\/)id_(rsa|ed25519)/,
  /(^|\/)\.work\//,
  /(^|\/)BUILD_PROMPT\.md$/i,
  /(^|\/)CLAUDE(\.local)?\.md$/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)\.(claude|cursor|windsurf|continue|copilot)\//,
  /^reference\//,
  /(^|\/)(node_modules|dist|coverage|test-results|playwright-report|\.vite)\//,
  /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i,
  /(^|\/)\.(idea)\//,
  /(^|\/)\.vscode\/(?!extensions\.json$)/,
];

const DOC_FILE = /\.(md|mdx|txt)$/i;

// ------------------------------------------------------------------- scan
/** @type {{ where: string, rule: string, excerpt: string }[]} */
const findings = [];

function redact(s) {
  if (s.length <= 6) return s[0] + '*'.repeat(s.length - 1);
  return s.slice(0, 4) + '…(' + s.length + ' chars)';
}

function report(where, rule, match) {
  findings.push({ where, rule, excerpt: redact(match) });
}

function scanText(file, text, lineOffsetLabel) {
  if (text.includes('\u0000')) return; // binary
  const lines = text.split(/\r?\n/);
  const isDoc = DOC_FILE.test(file);
  lines.forEach((line, i) => {
    const where = lineOffsetLabel ? lineOffsetLabel(i) : `${file}:${i + 1}`;
    scanLine(file, line, where, isDoc);
  });
}

function scanLine(file, line, where, isDoc) {
  if (line.length > 20000) line = line.slice(0, 20000);
  for (const rule of LINE_RULES) {
    const m = rule.test(line, file);
    if (m && !isAllowed(file, m)) report(where, rule.id, m);
  }
  if (isDoc) {
    for (const rule of DOC_RULES) {
      const m = rule.test(line, file);
      if (m && !isAllowed(file, m)) report(where, rule.id, m);
    }
  }
}

function checkPath(file, where) {
  if (FORBIDDEN_PATHS.some((re) => re.test(file)) && !isAllowed(file, file)) {
    report(where ?? file, 'forbidden-file', file);
  }
  // A file name itself can leak identity.
  for (const t of IDENTITY) if (t.re.test(file)) report(where ?? file, 'machine-identity-path', file);
}

function scanIndex() {
  const entries = git(['ls-files', '-s', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((e) => {
      const tab = e.indexOf('\t');
      const [, sha] = e.slice(0, tab).split(' ');
      return { sha, file: e.slice(tab + 1) };
    });
  if (entries.length === 0) return 0;
  for (const { file } of entries) checkPath(file);
  const out = git(['cat-file', '--batch'], entries.map((e) => e.sha).join('\n') + '\n');
  let pos = 0;
  for (const { file } of entries) {
    const nl = out.indexOf(0x0a, pos);
    const header = out.subarray(pos, nl).toString('utf8');
    const size = Number(header.split(' ')[2]);
    const body = out.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    if (file === '.privacy-allowlist') continue;
    scanText(file, body.toString('utf8'));
  }
  return entries.length;
}

function scanHistory() {
  const SEP = '\u001eCOMMIT\u001e';
  const log = git([
    'log',
    '--all',
    '-p',
    '--no-color',
    '--no-ext-diff',
    '--unified=0',
    `--format=${SEP}%H%n%an%n%ae%n%cn%n%ce%n%B${SEP}END`,
  ]).toString('utf8');
  let commit = '';
  let file = '';
  let newLine = 0;
  let commits = 0;
  const chunks = log.split(SEP);
  for (let c = 1; c < chunks.length; c++) {
    const chunk = chunks[c];
    // Header chunks hold: hash, author, email, committer, email, message.
    if (/^[0-9a-f]{40}\n/.test(chunk)) {
      commits++;
      const lines = chunk.split('\n');
      commit = lines[0].slice(0, 10);
      const [, aName, aMail, cName, cMail, ...msg] = lines;
      for (const [label, mail] of [
        ['author', aMail],
        ['committer', cMail],
      ]) {
        if (!/@users\.noreply\.github\.com$|^noreply@github\.com$/.test(mail)) {
          report(`commit ${commit} (${label})`, 'non-noreply-email', mail);
        }
      }
      for (const [label, name] of [
        ['author', aName],
        ['committer', cName],
      ]) {
        for (const t of IDENTITY) if (t.re.test(name)) report(`commit ${commit} (${label})`, 'machine-identity', name);
      }
      msg.forEach((l, i) => scanLine('COMMIT_MSG.md', l, `commit ${commit} message:${i + 1}`, true));
      continue;
    }
    // diff chunk
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+++ ')) {
        file = line.startsWith('+++ b/') ? line.slice(6) : '';
        if (file) checkPath(file, `commit ${commit} ${file}`);
        continue;
      }
      if (line.startsWith('@@')) {
        const m = line.match(/\+(\d+)/);
        newLine = m ? Number(m[1]) : 0;
        continue;
      }
      if (line.startsWith('+') && file && file !== '.privacy-allowlist') {
        scanLine(file, line.slice(1), `commit ${commit} ${file}:${newLine}`, DOC_FILE.test(file));
        newLine++;
      }
    }
  }
  return commits;
}

let scanned;
try {
  scanned = HISTORY ? scanHistory() : scanIndex();
} catch (err) {
  if (HISTORY && /does not have any commits/.test(String(err))) scanned = 0;
  else throw err;
}

if (findings.length) {
  console.error(`privacy-check: ${findings.length} problem(s) found:\n`);
  for (const f of findings) console.error(`  ${f.where}  [${f.rule}]  ${f.excerpt}`);
  console.error(
    '\nRemove the data, replace it with a neutral placeholder, or (for deliberate fake\n' +
      'fixtures only) add an entry to .privacy-allowlist.',
  );
  process.exit(1);
}
if (!QUIET) {
  console.log(`privacy-check: ok (${scanned} ${HISTORY ? 'commits' : 'files'} scanned)`);
}
