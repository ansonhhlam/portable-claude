# Pairing devices

Every phone, tablet or browser that uses longcord signs in on its own. There are two ways
to do that: scan a pairing QR code (easiest), or type the passcode.

Before you start, the device must be connected to your tailnet. See the setup guide for
[iPhone and iPad](../getting-started/iphone.md) or [Android](../getting-started/android.md).

## Pair with a QR code

1. On the computer, run:

   ```sh
   longcord pair
   ```

   It prints a QR code and a link like
   `https://my-pc.example-tailnet.ts.net/#/pair/<token>`.

2. On the phone, open the camera and point it at the QR code, then open the link. (You can
   also send yourself the link through a private channel and open it.)
3. The app pairs the device straight away and names it after the device and browser, for
   example "iPhone Safari". You land on the home screen.

The link works **once** and expires after **10 minutes**. If it has expired or was already
used, run `longcord pair` again.

> Treat the QR code like a password while it is valid. Do not post screenshots of it.

## Sign in with the passcode

Open your longcord address (for example `https://my-pc.example-tailnet.ts.net`) on the
device, type the passcode, adjust the device name if you like, and tap **Sign in**.

You chose the passcode during `longcord setup`. To change it, run on the computer:

```sh
longcord passcode          # prints a new random passcode
longcord passcode --set    # lets you type one
```

After 5 wrong attempts, sign-in is locked for 15 minutes, and each further lockout doubles
the wait. See [Troubleshooting](../troubleshooting.md) if you are locked out.

## Install the app on the home screen

Installing gives longcord its own icon and full-screen window, and on iPhone it is required
for notifications.

- **iPhone and iPad (Safari):** tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the menu and tap **Install app** or **Add to Home screen**.

An installed app keeps its own sign-in on iPhone and iPad, separate from Safari. If you
installed the app after signing in in Safari, sign in again inside the app (run
`longcord pair` once more, or use the passcode).

## See and revoke devices

- **On the phone:** **Settings > Devices** lists every device with when it was added and
  last seen. **Revoke** signs a device out immediately and stops its notifications. On the
  current device the button reads **Sign out**.
- **On the computer:**

  ```sh
  longcord devices list
  longcord devices revoke <id>
  ```

If a phone is lost or stolen, revoke it and also remove it from your tailnet in the
Tailscale admin console. See [Security](../security.md).
