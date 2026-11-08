# Getting started on macOS

This guide sets up longcord on a Mac. It takes about 15 minutes. When you are done,
continue with the [iPhone](iphone.md) or [Android](android.md) guide.

## What you need

- A Mac that can stay on and awake while you are away (see
  [Travelling](../guides/travel.md)).
- A [Tailscale](https://tailscale.com/) account (the free personal plan is enough).
- Access to a model:
  - an **Anthropic API key** from the [Anthropic Console](https://console.anthropic.com/), or
  - an Amazon Bedrock, Google Vertex AI or Microsoft Foundry account with access to Claude
    models.

  A Claude subscription (Pro, Max) cannot be used. API usage is billed separately; see
  [Spending](../guides/spending.md).

## 1. Install Node.js

longcord needs Node.js 20.19 or newer; the current LTS release (22 or later) is
recommended. Download the LTS installer from [nodejs.org](https://nodejs.org/), or with
[Homebrew](https://brew.sh/):

```sh
brew install node
```

Check it in Terminal:

```sh
node --version
```

## 2. Install Tailscale

Install Tailscale from [tailscale.com/download](https://tailscale.com/download) or the
Mac App Store, open it and sign in.

Make sure the `tailscale` command works in Terminal:

```sh
tailscale status
```

If the command is not found, see Tailscale's documentation on using the command line on
macOS; setup needs it to run `tailscale serve`.

In the Tailscale admin console:

- On the **DNS** page, enable **MagicDNS** and **HTTPS Certificates**.
- On the **Machines** page, choose **Disable key expiry** for this Mac so it stays
  connected while you are away.

## 3. Install longcord

```sh
npm install -g longcord
longcord --version
```

If npm reports a permissions error, your Node.js installation puts global packages in a
system folder. Installing Node.js with Homebrew or a version manager avoids this; do not
use `sudo npm install -g`.

## 4. Run setup

```sh
longcord setup
```

The setup wizard asks for:

1. **Your model provider** and its credentials. The API key is stored in `secrets.json` in
   `~/Library/Application Support/longcord`, readable only by you.
2. **Project folders** the phone may work in, for example `~/code/my-app`. You can add more
   later with `longcord projects add <path>`.
3. **A passcode** for signing in from a browser.
4. **A daily spend cap** (optional, recommended).

It then:

- installs a **LaunchAgent** (`dev.longcord.agent`) that starts the server when you log in
  and keeps it running,
- runs `tailscale serve --bg --https=443 http://127.0.0.1:8417` so your tailnet devices can
  reach it over HTTPS,
- offers to keep the Mac awake while longcord runs (`--fix-sleep` turns on the `keepAwake`
  option).

For scripted installs, every question has a flag, for example:

```sh
longcord setup --provider anthropic --project ~/code/my-app --daily-cap 10 --fix-sleep --yes
```

Without `--api-key`, setup asks for the key interactively, which keeps it out of your shell
history. See the [CLI reference](../reference/cli.md) for all flags.

### Folder access permissions

If your projects are in **Documents**, **Desktop** or **Downloads**, macOS protects those
folders. The background service may be blocked from reading them, and sessions then fail
with errors like "Operation not permitted". Either keep projects in another folder such as
`~/code`, or allow access in **System Settings > Privacy & Security > Files and Folders**
(or **Full Disk Access**) for `node`.

### After a restart

The LaunchAgent starts when you log in. If FileVault is on, a restarted Mac waits at the
unlock screen until someone types the password, so longcord is unreachable until then.
See [Travelling](../guides/travel.md).

## 5. Check that it works

```sh
longcord status
longcord doctor
```

`longcord status` shows whether the service is running and your HTTPS address, for example
`https://my-pc.example-tailnet.ts.net`. `longcord doctor` checks everything end to end and
explains how to fix problems.

## 6. Connect your phone

Continue with [iPhone and iPad](iphone.md) or [Android](android.md).

Something not working? See [Troubleshooting](../troubleshooting.md).
