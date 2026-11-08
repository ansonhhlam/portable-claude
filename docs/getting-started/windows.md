# Getting started on Windows

This guide sets up longcord on a Windows 10 or 11 PC. It takes about 15 minutes. When you
are done, continue with the [iPhone](iphone.md) or [Android](android.md) guide.

## What you need

- A Windows PC that can stay on while you are away (see [Travelling](../guides/travel.md)).
- A [Tailscale](https://tailscale.com/) account (the free personal plan is enough).
- Access to a model:
  - an **Anthropic API key** from the [Anthropic Console](https://console.anthropic.com/), or
  - an Amazon Bedrock, Google Vertex AI or Microsoft Foundry account with access to Claude
    models.

  A Claude subscription (Pro, Max) cannot be used. API usage is billed separately; see
  [Spending](../guides/spending.md).

## 1. Install Node.js

longcord needs Node.js 20.19 or newer; the current LTS release (22 or later) is
recommended. Open **PowerShell** and run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download the LTS installer from [nodejs.org](https://nodejs.org/). Close and reopen
PowerShell, then check:

```powershell
node --version
```

## 2. Install Tailscale

```powershell
winget install tailscale.tailscale
```

Or download it from [tailscale.com/download](https://tailscale.com/download). Start
Tailscale and sign in.

In the Tailscale admin console, open the **DNS** page and make sure **MagicDNS** and
**HTTPS Certificates** are enabled. longcord needs them for the `https://...ts.net`
address.

While you are in the admin console, open the **Machines** page, find this PC, and choose
**Disable key expiry** so it stays connected while you are away.

## 3. Install longcord

```powershell
npm install -g longcord
longcord --version
```

If PowerShell says running scripts is disabled on this system, either use
**Command Prompt** instead, or run `longcord.cmd` in place of `longcord`.

## 4. Run setup

```powershell
longcord setup
```

The setup wizard asks for:

1. **Your model provider** and its credentials. The API key is stored in `secrets.json` in
   your longcord data folder (`%APPDATA%\longcord`), not in your environment.
2. **Project folders** the phone may work in, for example `C:\Users\you\code\my-app`. You
   can add more later with `longcord projects add <path>`.
3. **A passcode** for signing in from a browser.
4. **A daily spend cap** (optional, recommended).

It then:

- installs a **Task Scheduler** task named `longcord` that starts the server at boot
  (without signing in, where Windows allows it; otherwise when you sign in) and restarts
  it if it fails,
- runs `tailscale serve --bg --https=443 http://127.0.0.1:8417` so your tailnet devices
  can reach it over HTTPS,
- offers to turn off sleep while plugged in (`--fix-sleep`).

If a step cannot be completed, setup tells you what to do. For example, if Tailscale could
not be configured, run the `tailscale serve` command above yourself.

For scripted installs, every question has a flag, for example:

```powershell
longcord setup --provider anthropic --project C:\Users\you\code\my-app --daily-cap 10 --fix-sleep --yes
```

Without `--api-key`, setup asks for the key interactively, which keeps it out of your shell
history. See the [CLI reference](../reference/cli.md) for all flags.

## 5. Check that it works

```powershell
longcord status
longcord doctor
```

`longcord status` shows whether the service is running and your HTTPS address, for example
`https://my-pc.example-tailnet.ts.net`. `longcord doctor` checks everything end to end and
explains how to fix problems.

## 6. Connect your phone

Continue with [iPhone and iPad](iphone.md) or [Android](android.md).

## Useful commands

```powershell
longcord logs --follow        # watch the server log
longcord pair                 # show a QR code to sign in a new device
longcord projects list        # see which folders are available
longcord update               # show how to update to the latest version
```

Something not working? See [Troubleshooting](../troubleshooting.md).
