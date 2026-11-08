# Getting started on Linux

This guide sets up longcord on a Linux desktop or server with systemd (for example
Ubuntu, Debian, Fedora or Arch). When you are done, continue with the
[iPhone](iphone.md) or [Android](android.md) guide.

## What you need

- A Linux machine that stays on (see [Travelling](../guides/travel.md)).
- systemd, for the background service. Without it, run `longcord start` yourself.
- A [Tailscale](https://tailscale.com/) account (the free personal plan is enough).
- Access to a model:
  - an **Anthropic API key** from the [Anthropic Console](https://console.anthropic.com/), or
  - an Amazon Bedrock, Google Vertex AI or Microsoft Foundry account with access to Claude
    models.

  A Claude subscription (Pro, Max) cannot be used. API usage is billed separately; see
  [Spending](../guides/spending.md).

## 1. Install Node.js

longcord needs Node.js 20.19 or newer; the current LTS release (22 or later) is
recommended. Distribution packages are often older, so check first:

```sh
node --version
```

If it is missing or too old, install a current LTS release from
[nodejs.org](https://nodejs.org/en/download) (it lists package manager and version
manager options). A version manager such as `nvm` installs Node.js in your home folder,
which also avoids needing `sudo` for global npm packages.

## 2. Install Tailscale

Follow [tailscale.com/download/linux](https://tailscale.com/download/linux), then sign in:

```sh
sudo tailscale up
```

Allow your user to manage `tailscale serve` without `sudo`:

```sh
sudo tailscale set --operator=$USER
```

In the Tailscale admin console:

- On the **DNS** page, enable **MagicDNS** and **HTTPS Certificates**.
- On the **Machines** page, choose **Disable key expiry** for this machine.

## 3. Install longcord

```sh
npm install -g longcord
longcord --version
```

Do not use `sudo npm install -g`. If npm reports a permissions error, use a Node.js
version manager or set an npm prefix in your home folder.

## 4. Run setup

```sh
longcord setup
```

The setup wizard asks for:

1. **Your model provider** and its credentials. The API key is stored in `secrets.json` in
   `~/.local/share/longcord` (or `$XDG_DATA_HOME/longcord`), readable only by you.
2. **Project folders** the phone may work in, for example `~/code/my-app`. You can add more
   later with `longcord projects add <path>`.
3. **A passcode** for signing in from a browser.
4. **A daily spend cap** (optional, recommended).

It then:

- installs a **systemd user unit** (`longcord.service`, `Restart=always`) and runs
  `loginctl enable-linger` so it starts at boot even when you are not logged in,
- runs `tailscale serve --bg --https=443 http://127.0.0.1:8417` so your tailnet devices can
  reach it over HTTPS.

Setup does not change suspend settings on Linux. On a desktop, turn off automatic suspend
in your power settings; see [Travelling](../guides/travel.md).

For scripted installs, every question has a flag, for example:

```sh
longcord setup --provider anthropic --project ~/code/my-app --daily-cap 10 --yes
```

Without `--api-key`, setup asks for the key interactively, which keeps it out of your shell
history. See the [CLI reference](../reference/cli.md) for all flags.

### Managing the service

```sh
systemctl --user status longcord
systemctl --user restart longcord
journalctl --user -u longcord
longcord logs --follow
```

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
