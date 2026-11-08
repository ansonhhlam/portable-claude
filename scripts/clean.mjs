#!/usr/bin/env node
// Cross-platform `rm -rf` for build output.
import { rmSync } from 'node:fs';
for (const dir of process.argv.slice(2)) rmSync(dir, { recursive: true, force: true });
