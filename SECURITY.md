# Security Policy

longcord runs coding sessions with real access to files and commands on your
computer, so we take security reports seriously.

## Supported versions

| Version                | Supported             |
| ---------------------- | --------------------- |
| Latest `1.x` release   | Yes                   |
| Older `1.x` releases   | Upgrade to the latest |
| `0.x` and pre-releases | No                    |

Security fixes are released as patch versions of the latest minor release.

## Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for a
security problem.

Report it privately through GitHub Security Advisories:
<https://github.com/ansonhhlam/portable-claude/security/advisories/new>

Include, where you can:

- the longcord version (`longcord --version`) and your OS and Node.js version
- what an attacker can do, and what access they need first
- steps to reproduce, or a proof of concept
- any suggested fix

Review anything you attach first. Do not include API keys, tokens, session
transcripts with private code, or your real tailnet name. `longcord doctor`
output is redacted automatically, but please read it before sharing.

We aim to acknowledge reports within a few days, keep you updated as we work
on a fix, and credit you in the advisory unless you prefer otherwise.

## Scope

In scope:

- the longcord server and CLI (for example: binding to anything other than
  `127.0.0.1`, authentication or pairing bypass, path traversal outside a
  session's project directory, command injection, leaking API keys or
  credentials into logs, responses or the web app)
- the bundled web app (for example: XSS, CSRF, unsafe handling of session
  output, service worker or push notification issues)
- the published npm package and its release pipeline (for example: tampered
  artifacts, missing provenance)

Out of scope:

- vulnerabilities in Tailscale, the Claude Agent SDK, Node.js, or the model
  provider; please report those to the respective project
- actions a session takes because you approved them, or because you chose a
  permissive permission mode
- attacks that require an already compromised computer or tailnet account
- denial of service from your own devices on your own tailnet

## How this repository protects against leaks

- Every push and pull request runs [gitleaks](https://github.com/gitleaks/gitleaks)
  over the full history, plus `scripts/privacy-check.mjs`, a scanner that looks
  for API keys, tokens, private keys, real email addresses, absolute user paths,
  hostnames, IP addresses and files that must never be committed.
- A pre-commit hook runs the same privacy scanner locally.
- Maintainers should keep GitHub secret scanning and push protection turned on
  for this repository (Settings > Code security).

## If you accidentally paste a key

If an API key, cloud credential or token ends up in an issue, pull request,
commit, log or screenshot, **rotate it immediately** with the provider (for
example in the Anthropic Console, or your AWS, Google Cloud or Azure account).
Deleting the comment or rewriting the commit is not enough: assume anything
that was public, even briefly, has been copied. Then let us know through a
private advisory so we can help clean up.
