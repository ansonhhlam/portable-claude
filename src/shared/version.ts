import { readFileSync } from 'node:fs';

let cached: string | undefined;

/** Package version, read from package.json next to the installed code. */
export function packageVersion(): string {
  if (cached) return cached;
  for (const rel of ['../../package.json', '../../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'longcord' && pkg.version) return (cached = pkg.version);
    } catch {
      /* try next */
    }
  }
  return (cached = '0.0.0');
}

export const PRODUCT_NAME = 'longcord';
