# Getting started on Android

Set up the computer first ([Windows](windows.md), [macOS](macos.md) or [Linux](linux.md)).
Then follow these steps on the Android phone or tablet. Menu names differ a little between
manufacturers.

## 1. Join your tailnet

1. Install **Tailscale** from Google Play.
2. Open it and sign in with the **same Tailscale account** you used on the computer.
3. Allow the VPN connection when Android asks.
4. Check that the computer appears in the Tailscale app's device list.

To keep Tailscale connected:

- **Always-on VPN:** open **Settings > Network & internet > VPN**, tap the gear next to
  Tailscale, and turn on **Always-on VPN**.
- **Battery:** open **Settings > Apps > Tailscale > Battery** and choose **Unrestricted**,
  so Android does not stop it in the background.

## 2. Sign in to longcord

The easiest way is a pairing QR code:

1. On the computer, run `longcord pair`.
2. On the phone, scan the QR code with the camera (or Google Lens) and open the link in
   **Chrome**.
3. longcord signs this device in.

Or open your longcord address (shown by `longcord status`, for example
`https://my-pc.example-tailnet.ts.net`) in Chrome and sign in with your passcode.

## 3. Install the app

In Chrome, open the menu (three dots) and tap **Install app** or **Add to Home screen**.
Open longcord from the new icon. It keeps the same sign-in as Chrome.

## 4. Turn on notifications

1. In longcord, open **Settings** (the gear on the home screen).
2. Under **Notifications**, tap **Enable notifications** and allow them.
3. Tap **Send test notification** to check.

If notifications do not show up, check **Settings > Apps > Chrome > Notifications** (and
the longcord app's notification settings, if it appears as its own app), and make sure
battery saving is not restricting Chrome.

## Tips

- longcord reconnects automatically when you come back to the app. The connection
  indicator in the header shows **Reconnecting** or **Offline** while it does.
- Continue with [Pairing](../guides/pairing.md) and
  [Permission modes](../guides/permission-modes.md).
- Something not working? See [Troubleshooting](../troubleshooting.md).
