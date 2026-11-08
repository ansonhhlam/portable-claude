# Getting help

## Where to ask

- **Questions, setup help and ideas:** start a thread in
  [GitHub Discussions](https://github.com/ansonhhlam/portable-claude/discussions).
- **Bugs:** open an issue using the
  [bug report form](https://github.com/ansonhhlam/portable-claude/issues/new/choose).
- **Feature requests:** use the feature request form on the same page.
- **Security problems:** never post them publicly. Follow [SECURITY.md](SECURITY.md)
  and report privately through
  [GitHub Security Advisories](https://github.com/ansonhhlam/portable-claude/security/advisories/new).

Please search existing issues and discussions first, your question may already
have an answer.

## Include diagnostics

Most problems are easier to solve with the output of:

```sh
longcord doctor
```

It checks your Node.js version, model provider configuration, Tailscale and
`tailscale serve` status, and the server's health. It redacts usernames,
absolute paths and hostnames automatically and never prints API keys.

**Review the output before pasting it anywhere.** Remove anything you are not
comfortable sharing, such as project names or your tailnet name. A redacted
tailnet name looks like `my-pc.example-tailnet.ts.net`.

## What we cannot help with

- Anthropic account, billing or API key issues: contact Anthropic support.
- Amazon Bedrock, Google Vertex AI or Microsoft Foundry access and quotas:
  contact your cloud provider.
- Tailscale account or network problems unrelated to longcord: see the
  Tailscale documentation.

longcord is maintained by volunteers in their spare time. There is no
guaranteed response time.
