#!/usr/bin/env node
// Verifies that `npm pack` would publish exactly what users need.
import { execSync } from 'node:child_process';

const out = execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8' });
const [info] = JSON.parse(out);
const files = info.files.map((f) => f.path);

const required = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/cli/bin.js',
  'dist/server/app.js',
  'dist/web/index.html',
  'dist/web/sw.js',
  'dist/web/manifest.webmanifest',
];
const forbidden = [
  /^src\//,
  /^test\//,
  /^\.work\//,
  /^docs\//,
  /\.map$/,
  /^scripts\//,
  /\.env/,
  /secrets/,
  /config\.json$/,
  /^\.github\//,
  /node_modules/,
];

const missing = required.filter((r) => !files.includes(r));
const extra = files.filter((f) => forbidden.some((re) => re.test(f)));
if (missing.length || extra.length) {
  if (missing.length)
    console.error(
      'Missing from the package (run `npm run build` first?):\n  ' + missing.join('\n  '),
    );
  if (extra.length) console.error('Must not be published:\n  ' + extra.join('\n  '));
  process.exit(1);
}
console.log(
  `Package contents OK: ${files.length} files, ${(info.size / 1024).toFixed(0)} kB packed.`,
);
