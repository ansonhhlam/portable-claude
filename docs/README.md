# longcord documentation

longcord runs coding sessions on your own computer with the Claude Agent SDK and lets you
follow, steer and approve them from your phone. The server binds to `127.0.0.1` only and
you reach it privately through [Tailscale](https://tailscale.com/).

## Getting started

Set up the computer first, then the phone.

| Computer                              | Phone                                        |
| ------------------------------------- | -------------------------------------------- |
| [Windows](getting-started/windows.md) | [iPhone and iPad](getting-started/iphone.md) |
| [macOS](getting-started/macos.md)     | [Android](getting-started/android.md)        |
| [Linux](getting-started/linux.md)     |                                              |

## Guides

- [Pairing phones and other devices](guides/pairing.md)
- [Permission modes: how much the agent may do without asking](guides/permission-modes.md)
- [Spending and the daily cap](guides/spending.md)
- [Resuming sessions started on the computer](guides/resuming-sessions.md)
- [Travelling: keeping your computer reachable](guides/travel.md)

## Reference and background

- [CLI reference](reference/cli.md)
- [Configuration reference](reference/configuration.md)
- [Environment variables](reference/environment.md)
- [HTTP API and events](reference/http-api.md)
- [Troubleshooting](troubleshooting.md)
- [Upgrading](upgrading.md)
- [Security model and hardening checklist](security.md)
- [Architecture](architecture.md)
- [Architecture decision records](adr/README.md)

## For maintainers

- [Releasing](maintainers/releasing.md)
- [Contributing](../CONTRIBUTING.md)
