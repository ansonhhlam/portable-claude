# CLI reference

<!-- This file is generated from the CLI help text by `npm run docs:cli`. Do not edit by hand. -->

Run `longcord --help` or `longcord <command> --help` to see the same text in your terminal.

```text
longcord <version>: control a coding agent on this computer from your phone. Powered by Claude.

Usage: longcord <command> [options]

Commands:
  setup      Interactive first-time setup: API key, projects, Tailscale, background service, pairing
  start      Run the server in the foreground (the background service runs this for you)
  status     Show whether longcord is running and how it is configured
  logs       Print recent server log lines
  pair       Show a one-time QR code to connect a phone (valid 10 minutes)
  passcode   Create a new fallback passcode for signing in without a QR code
  projects   Manage the folders the agent is allowed to work in
  devices    List or revoke paired phones and browsers
  config     Read or change settings (see docs/reference/configuration.md)
  doctor     Check the installation and print fixes (output is safe to share)
  update     Explain how to update longcord
  uninstall  Remove the background service and Tailscale serve config; optionally delete data

Global options:
  --home <dir>               Use this data directory (default: per-OS location, or LONGCORD_HOME)
  -h, --help                 Show help
  -v, --version              Show the version

Run `longcord <command> --help` for details.
```

## setup

```text
Interactive first-time setup: API key, projects, Tailscale, background service, pairing

Usage:
  longcord setup [options]

Options:
  --api-key <value>          Anthropic API key to store (otherwise asked, or read from ANTHROPIC_API_KEY)
  --provider <value>         anthropic (default), bedrock, vertex or foundry
  --project <value>          Folder the agent may work in (repeatable)
  --passcode <value>         Fallback passcode for signing in without a QR code (default: generated)
  --port <value>             Local port (default 8417)
  --daily-cap <value>        Daily spend cap in US dollars
  --no-service               Do not install the background service
  --no-tailscale             Do not configure tailscale serve
  --fix-sleep                Apply the safe sleep fix for this OS without asking
  -y, --yes                  Non-interactive: never prompt, use flags and defaults

Examples:
  longcord setup
  longcord setup --yes --api-key "$ANTHROPIC_API_KEY" --project ~/code/my-app --daily-cap 20
```

## start

```text
Run the server in the foreground (the background service runs this for you)

Usage:
  longcord start [--mock] [--port <n>]

Options:
  --mock                     Use the built-in mock agent: no API key needed and no API calls (for demos and development)
  --port <value>             Override the configured port
  --service                  Run under the supervisor that restarts the server if it stops (used by the background service)

Examples:
  longcord start
  longcord start --mock --port 9000
```

## status

```text
Show whether longcord is running and how it is configured

Usage:
  longcord status [--json]

Options:
  --json                     Print machine-readable JSON

Examples:
  longcord status
```

## logs

```text
Print recent server log lines

Usage:
  longcord logs [--lines <n>] [--follow]

Options:
  -n, --lines <value>        Number of lines to show (default 50)
  -f, --follow               Keep printing new lines

Examples:
  longcord logs -n 200
  longcord logs --follow
```

## pair

```text
Show a one-time QR code to connect a phone (valid 10 minutes)

Usage:
  longcord pair [--url <https-url>]

Options:
  --url <value>              Base URL to put in the QR code (default: the Tailscale URL from setup)

Examples:
  longcord pair
```

## passcode

```text
Create a new fallback passcode for signing in without a QR code

Usage:
  longcord passcode [--set]

Options:
  --set                      Type your own passcode instead of generating one

Examples:
  longcord passcode
  longcord passcode --set
```

## projects

```text
Manage the folders the agent is allowed to work in

Usage:
  longcord projects list
  longcord projects add <folder> [--name <name>]
  longcord projects remove <id>

Options:
  --name <value>             Display name for the project (default: folder name)

Examples:
  longcord projects add ~/code/my-app
  longcord projects remove my-app-1a2b3c
```

## devices

```text
List or revoke paired phones and browsers

Usage:
  longcord devices list
  longcord devices revoke <id>

Examples:
  longcord devices list
  longcord devices revoke 3f2a
```

## config

```text
Read or change settings (see docs/reference/configuration.md)

Usage:
  longcord config get [key]
  longcord config set <key> <value>
  longcord config path

Examples:
  longcord config get
  longcord config set dailySpendCapUsd 15
  longcord config set dailyRestart null
```

## doctor

```text
Check the installation and print fixes (output is safe to share)

Usage:
  longcord doctor [--offline] [--json]

Options:
  --offline                  Skip checks that use the network (API key validity, clock)
  --json                     Print machine-readable JSON

Examples:
  longcord doctor
  longcord doctor --offline
```

## update

```text
Explain how to update longcord

Usage:
  longcord update

Examples:
  longcord update
```

## uninstall

```text
Remove the background service and Tailscale serve config; optionally delete data

Usage:
  longcord uninstall [--delete-data] [--yes]

Options:
  --delete-data              Also delete sessions, settings, keys and logs
  -y, --yes                  Do not ask for confirmation

Examples:
  longcord uninstall
  longcord uninstall --delete-data --yes
```

Permission modes accepted by the app: `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`.
