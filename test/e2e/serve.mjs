// Starts a throwaway longcord server with the mock agent and fixed fake data
// for the end-to-end tests. Requires `npm run build` first.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] ?? '18417';
const home = path.resolve('test-results', 'e2e-data');
fs.rmSync(home, { recursive: true, force: true });
const projects = path.join(home, 'projects');
for (const name of ['my-app', 'docs-site'])
  fs.mkdirSync(path.join(projects, name, 'src'), { recursive: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(
  path.join(home, 'config.json'),
  JSON.stringify(
    {
      projects: [
        { id: 'my-app', name: 'my-app', path: path.join(projects, 'my-app') },
        { id: 'docs-site', name: 'docs-site', path: path.join(projects, 'docs-site') },
      ],
      models: ['claude-sonnet-4-5', 'claude-opus-4-1'],
      dailySpendCapUsd: 25,
      publicUrl: 'https://my-pc.example-tailnet.ts.net',
    },
    null,
    2,
  ),
);
fs.writeFileSync(path.join(home, 'e2e-home.txt'), home);

const child = spawn(
  process.execPath,
  ['dist/cli/bin.js', 'start', '--mock', '--home', home, '--port', port],
  { stdio: 'inherit', env: { ...process.env, LONGCORD_MOCK_DELAY_MS: '15' } },
);
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
