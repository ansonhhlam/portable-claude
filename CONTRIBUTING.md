# Contributing to longcord

Thanks for your interest in improving longcord. Bug reports, documentation
fixes and pull requests are all welcome. By taking part you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

For security problems, do not open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

You need:

- Node.js 22 or newer (the package supports Node.js 20.19+, CI tests on 22 and 24)
- git
- optionally [gitleaks](https://github.com/gitleaks/gitleaks#installing), so the
  pre-commit hook can scan staged changes for secrets locally (CI always runs it)

```sh
git clone https://github.com/ansonhhlam/portable-claude.git
cd portable-claude
npm install
```

`npm install` runs the `prepare` script, which sets `git config core.hooksPath
.githooks`. That enables a dependency-free pre-commit hook that runs the privacy
scanner, and gitleaks when it is installed.

### Running locally without an API key

```sh
npm run dev
```

This runs `longcord start --mock`, which swaps the Claude Agent SDK for a
built-in mock that streams scripted responses. You can work on the server, the
CLI and the web app without an Anthropic API key or cloud credentials, and
without spending anything. Open the URL it prints in your browser.

To try a real session, configure a provider as described in the README (an
Anthropic API key, or Amazon Bedrock, Google Vertex AI or Microsoft Foundry
environment variables) and run `longcord start`.

## Checks and tests

| Command                  | What it does                                                    |
| ------------------------ | --------------------------------------------------------------- |
| `npm run lint`           | ESLint and Prettier (`--check`)                                 |
| `npm run typecheck`      | TypeScript type checking                                        |
| `npm run build`          | Builds the server and CLI to `dist/` and the web app to `dist/web` |
| `npm test`               | Unit tests (Vitest)                                             |
| `npm run test:coverage`  | Unit tests with a coverage report in `coverage/`                |
| `npm run test:e2e`       | End-to-end tests (Playwright) against the mock SDK              |
| `npm run docs:check`     | Verifies CLI `--help` output matches `docs/reference/cli.md`    |
| `npm run licenses`       | Fails on GPL, AGPL or unknown dependency licenses               |
| `npm run pack:check`     | Validates what `npm pack` would publish                         |
| `npm run privacy-check`  | Scans tracked files for secrets and personal data               |

Before the first end-to-end run, install the browsers once:

```sh
npx playwright install --with-deps chromium webkit
```

CI runs all of the above on Linux, macOS and Windows. Running `npm run lint`,
`npm run typecheck` and `npm test` before pushing catches most failures.

## Project layout

```text
src/server   HTTP and WebSocket server, session management, Agent SDK integration
src/web      the mobile-first PWA served by the server
src/cli      the `longcord` command (start, doctor, ...)
src/shared   types and protocol code used by both server and web
test/unit    Vitest unit tests
test/e2e     Playwright end-to-end tests
docs/        user and maintainer documentation
scripts/     repository tooling (privacy scanner, git hook installer, checks)
```

## Commit messages and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org/). Release
notes and version numbers are generated from them, so the pull request title
(which becomes the squash commit message) must follow the format:

```text
feat: add push notifications for finished sessions
fix(server): reject session paths outside the project directory
docs: explain tailscale serve setup on Windows
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`,
`chore`. Mark breaking changes with `!` (for example `feat!: ...`) and a
`BREAKING CHANGE:` footer.

Keep pull requests focused. Include tests for behavior changes, and fill in the
pull request checklist.

## Keep secrets and personal data out

This repository is public, and everything in its history stays public. Never
commit:

- API keys, tokens, cloud credentials, private keys or VAPID keys
- real email addresses (use `you@example.com`, or your
  `*@users.noreply.github.com` address for commits)
- absolute paths from your machine (write `C:\Users\you\code\my-app` or
  `/home/you/code/my-app` instead)
- hostnames, IP addresses or tailnet names (use `127.0.0.1`, the `192.0.2.x`
  documentation range, and `my-pc.example-tailnet.ts.net`)
- session transcripts, logs, screenshots or `longcord doctor` output from your
  own machine

`npm run privacy-check` (also run by the pre-commit hook and in CI) scans
tracked and staged files for these patterns. It also flags your own username
and hostname, which it reads at runtime and never writes anywhere. CI runs it
over the full history together with gitleaks.

If a test needs a value that looks like a secret or personal data, make it
obviously fake and add it to `.privacy-allowlist`, one entry per line: a file
glob, a space, then the exact literal text that may appear in matching files:

```text
<file-glob> <exact fake value>
```

For example, a glob of `test/fixtures/**` followed by a fake key made of
repeated `FAKE` segments.

The allowlist is for deliberate fake fixtures only. Never add a real value to
it. If you committed something real, rotate it first (see
[SECURITY.md](SECURITY.md)), then ask a maintainer for help removing it.

## Documentation

Docs are part of the change. If you add or change a CLI flag, a config option,
an environment variable or user-visible behavior, update the matching page in
`docs/` in the same pull request. `npm run docs:check` fails when the CLI help
and `docs/reference/cli.md` disagree, and CI checks that relative links in
Markdown files resolve.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
