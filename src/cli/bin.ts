#!/usr/bin/env node
import { main } from './index.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`Error: ${(err as Error)?.message ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
