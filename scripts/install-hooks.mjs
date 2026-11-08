#!/usr/bin/env node
// Enables the repository's zero-dependency git hooks (.githooks/).
// Runs from the `prepare` npm script; silently does nothing outside a git checkout.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || !existsSync('.git') || !existsSync('.githooks')) process.exit(0);
const res = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
if (res.status === 0) console.log('git hooks enabled (.githooks)');
