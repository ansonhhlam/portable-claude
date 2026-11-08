# Troubleshooting

Start with the doctor on the computer. It checks Node.js, your configuration and
credentials, Tailscale and `tailscale serve`, the background service and the server, and
tells you how to fix each problem:

```sh
longcord doctor
```

Add `--offline` to skip checks that contact the model provider. If you ask for help,
paste the doctor output: it redacts usernames, paths and hostnames, but read it before
posting anyway. See [SUPPORT.md](../SUPPORT.md).

The server log is the next place to look:

```sh
longcord logs --lines 200
longcord logs --follow
```

## The phone cannot reach longcord

Check, in order:

1. **Tailscale is connected on the phone.** Open the Tailscale app; it should say
   connected, and the computer should be listed.
2. **The computer is on, awake and online.** If you are away, see
   [Travelling](guides/travel.md).
3. **longcord is running.** On the computer: `longcord status`.
4. **`tailscale serve` is set up.** `longcord doctor` checks this. To set it up again:

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:8417
   ```

   Use your own port if you changed it.

5. **You are using the right address.** `longcord status` prints it, for example
   `https://my-pc.example-tailnet.ts.net`. It must start with `https://`.

## "HTTPS certificates are not enabled"

`tailscale serve` needs HTTPS certificates for your tailnet. In the Tailscale admin console,
open the **DNS** page, make sure **MagicDNS** is on, and enable **HTTPS Certificates**.
Then run the `tailscale serve` command above again. The first HTTPS request can take a few
seconds while the certificate is issued.

## The app keeps reconnecting

The header shows **Reconnecting** while the app is restoring its live connection, and
**Offline** when the phone has no network. Short reconnects are normal: phones pause
background apps, and longcord catches up automatically when you return, without
duplicating or losing messages.

If it never settles:

- Check that Tailscale is still connected on the phone. Phones sometimes switch the VPN
  off to save battery; see the [iPhone](getting-started/iphone.md) or
  [Android](getting-started/android.md) guide for how to keep it on.
- Check the computer: `longcord status`, then `longcord logs`.
- Captive portals (hotel or airport Wi-Fi sign-in pages) can block traffic until you sign
  in. Open any website in the browser first.
- Close the app completely and open it again.

If you were signed out (for example because the device was revoked), the app shows the
sign-in screen.

## Notifications do not arrive on iPhone or iPad

- You need **iOS or iPadOS 16.4 or later**.
- longcord must be **added to the Home Screen** and opened from there. Notifications do
  not work in a Safari tab.
- The Home Screen app has its own sign-in. Enable notifications from inside the Home Screen
  app, in **Settings > Notifications**.
- In iOS **Settings > Notifications > longcord**, make sure notifications are allowed.
- Check that a **Focus** mode is not silencing them.
- Tap **Send test notification**. If the test arrives but real notifications do not, check
  `longcord logs` for push errors.
- If you removed and re-added the app to the Home Screen, enable notifications again; the
  old subscription no longer works.
- Notifications reach the phone through Apple's push service, so the phone needs an
  internet connection, but not Tailscale, to receive them.

## Notifications do not arrive on Android

- Check that notifications are allowed for Chrome (and for the installed longcord app, if it
  appears separately) in Android settings.
- Make sure battery saving is not restricting Chrome.
- Tap **Send test notification** in **Settings > Notifications** in longcord.

## The service does not start

Run `longcord doctor` and `longcord logs` first. Then, per OS:

**Windows**

- Open **Task Scheduler** and find the task named `longcord`. Check **Last Run Result** and
  the **History** tab.
- If it only starts after you sign in, Windows did not allow starting at boot without
  signing in for your account. Turn on automatic sign-in, or sign in after each reboot.
- Run `longcord start` in a terminal to see errors directly. Stop it with Ctrl+C before
  starting the service again.

**macOS**

- Check the LaunchAgent: `launchctl list | grep dev.longcord.agent`. A non-zero status in
  the second column means it exited with an error.
- LaunchAgents only run while you are logged in. After a restart with FileVault on, nothing
  runs until someone unlocks the Mac.
- "Operation not permitted" errors usually mean macOS privacy protection is blocking access
  to folders like Documents. See [Folder access permissions](getting-started/macos.md#folder-access-permissions).

**Linux**

- `systemctl --user status longcord` and `journalctl --user -u longcord -n 100`.
- If it does not start at boot, check that lingering is on:
  `loginctl show-user $USER --property=Linger` should print `Linger=yes`. Turn it on with
  `loginctl enable-linger`.
- Make sure the Node.js used by the service is the same one you installed longcord with.
  Node.js installed by a version manager is only on your shell's `PATH`; run
  `longcord setup` again from a shell where `node --version` is correct.

To reinstall the service on any OS, run `longcord setup` again. Existing settings are kept.

## Port 8417 is already in use

Another program uses the port. Choose another one, then run setup again so the service and
`tailscale serve` use the new port:

```sh
longcord config set port 8517
longcord setup
```

## Locked out after wrong passcodes

After 5 wrong passcodes, sign-in from that device is locked for 15 minutes, and each
further lockout doubles the wait. To get back in:

- **Pair instead:** run `longcord pair` on the computer and scan the QR code. Pairing does
  not use the passcode.
- **Forgot the passcode:** set a new one with `longcord passcode` (random) or
  `longcord passcode --set`.
- **Clear the lockout:** restart longcord on the computer (restart the service, or stop and
  start `longcord start`).

## "Daily spend cap reached"

New messages are blocked until local midnight on the computer. Raise or remove the cap:

```sh
longcord config set dailySpendCapUsd 20
longcord config set dailySpendCapUsd null
```

See [Spending](guides/spending.md).

## Sessions fail to start or reply

- **Authentication errors:** check your credentials with `longcord doctor`. For an
  Anthropic API key, make sure it is active in the Anthropic Console and the account has
  credit. Store a new key with `longcord setup`.
- **Cloud providers:** check that your Bedrock, Vertex AI or Foundry credentials are
  available to the service, not only in your terminal, and that the model is enabled in
  your cloud account and region.
- **Project folder missing:** if a project folder was moved or deleted, remove it with
  `longcord projects remove <id>` and add the new location.

## An approval shows "Expired"

The request is no longer waiting, for example because the run was stopped, the agent
process restarted, or the server restarted. Send a message to continue; the agent asks
again if it still needs to.

## Still stuck?

See [SUPPORT.md](../SUPPORT.md) for where to ask, and include the output of
`longcord doctor`.
