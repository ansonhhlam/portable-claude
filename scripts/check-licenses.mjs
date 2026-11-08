#!/usr/bin/env node
// Fails if any installed production dependency (transitively) uses a license
// that is not compatible with distributing this MIT project, or has no license.
// Development-only packages are checked too, but only copyleft licenses fail there.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'MPL-2.0', // file-level copyleft; fine to depend on unmodified
]);

// Reviewed exceptions: packages whose license field is not an SPDX id.
const REVIEWED = {
  // The Agent SDK is distributed under Anthropic's terms (Commercial Terms of
  // Service). It is a dependency the user installs, not code we redistribute
  // or relicense. See docs/adr/0006-api-key-and-cloud-provider-auth-only.md.
  '@anthropic-ai/claude-agent-sdk': 'Anthropic Commercial Terms',
};
const REVIEWED_PREFIX = ['@anthropic-ai/claude-agent-sdk-'];

const DENY = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|BUSL)/i;

function satisfies(expr) {
  // Handles "A OR B", "(A OR B)", "A AND B".
  const clean = expr.replace(/[()]/g, '').trim();
  if (/ OR /i.test(clean)) return clean.split(/ OR /i).some((p) => satisfies(p));
  if (/ AND /i.test(clean)) return clean.split(/ AND /i).every((p) => satisfies(p));
  return ALLOWED.has(clean);
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const problems = [];
let checked = 0;
for (const [key, info] of Object.entries(lock.packages ?? {})) {
  if (!key) continue;
  const name = key.split('node_modules/').pop();
  const pkgFile = path.join(key, 'package.json');
  if (!existsSync(pkgFile)) continue; // optional dependency for another platform
  let license = info.license;
  if (!license) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    license =
      typeof pkg.license === 'string'
        ? pkg.license
        : (pkg.license?.type ??
          (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : undefined));
  }
  checked++;
  if (REVIEWED[name] || REVIEWED_PREFIX.some((p) => name.startsWith(p))) continue;
  const dev = info.dev === true;
  if (!license) {
    if (!dev) problems.push(`${name}: no license`);
    continue;
  }
  if (DENY.test(license) && !satisfies(license))
    problems.push(`${name}: ${license}${dev ? ' (dev)' : ''}`);
  else if (!dev && !satisfies(license))
    problems.push(`${name}: ${license} (not on the allowed list)`);
}

if (problems.length) {
  console.error('License check failed:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`License check passed (${checked} packages).`);
