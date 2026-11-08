#!/usr/bin/env node
// Generates docs/reference/cli.md from the CLI's own help text.
// With --check, fails if the file is out of date (used in CI).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const target = 'docs/reference/cli.md';
if (!existsSync('dist/cli/index.js')) {
  console.error('Build first: npm run build:server');
  process.exit(1);
}
const { cliReference } = await import(new URL('../dist/cli/index.js', import.meta.url));
const expected = cliReference();

if (process.argv.includes('--check')) {
  const actual = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (actual !== expected) {
    console.error(
      `${target} does not match the CLI help text. Run \`npm run docs:cli\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`${target} matches the CLI help text.`);
  // Every configuration key must be documented.
  const { CONFIG_KEYS } = await import(new URL('../dist/server/config.js', import.meta.url));
  const configDoc = readFileSync('docs/reference/configuration.md', 'utf8');
  const undocumented = CONFIG_KEYS.filter((k) => !configDoc.includes(`| \`${k}\``));
  if (undocumented.length) {
    console.error(`docs/reference/configuration.md is missing: ${undocumented.join(', ')}`);
    process.exit(1);
  }
  console.log('docs/reference/configuration.md documents every configuration key.');
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${target}`);
}
