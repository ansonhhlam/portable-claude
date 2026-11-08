# Getting started on iPhone and iPad

Set up the computer first ([Windows](windows.md), [macOS](macos.md) or [Linux](linux.md)).
Then follow these steps on the iPhone or iPad.

## 1. Join your tailnet

1. Install **Tailscale** from the App Store.
2. Open it and sign in with the **same Tailscale account** you used on the computer.
3. Allow the VPN configuration when iOS asks.
4. Check that the computer appears in the Tailscale app's device list.

Tailscale must be connected whenever you use longcord. If your version of the Tailscale
app offers **VPN On Demand** in its settings, turning it on keeps the connection up
automatically.

## 2. Sign in to longcord

The easiest way is a pairing QR code:

1. On the computer, run `longcord pair`.
2. On the iPhone, open the **Camera**, point it at the QR code and tap the link.
3. Safari opens longcord and signs this device in.

Or open your longcord address (shown by `longcord status`, for example
`https://my-pc.example-tailnet.ts.net`) in Safari and sign in with your passcode.

## 3. Add it to the Home Screen

1. In Safari, tap **Share**, then **Add to Home Screen**, then **Add**.
2. Open longcord from the new Home Screen icon.

The Home Screen app has its own sign-in, separate from Safari. If it shows the sign-in
screen, run `longcord pair` again on the computer and scan the code, or use the passcode.

Always open longcord from the Home Screen icon from now on.

## 4. Turn on notifications

Notifications tell you when a session needs approval or finishes. They need **iOS or
iPadOS 16.4 or later** and the Home Screen app (they do not work in a Safari tab).

1. In the Home Screen app, open **Settings** (the gear on the home screen).
2. Under **Notifications**, tap **Enable notifications** and allow them.
3. Tap **Send test notification** to check.

If notifications do not arrive, see [Troubleshooting](../troubleshooting.md).

## Tips

- longcord reconnects automatically when you come back to the app. The connection
  indicator in the header shows **Reconnecting** or **Offline** while it does.
- Focus modes can silence longcord notifications. Allow longcord in the Focus settings if
  you want to be notified while a Focus is on.
- Continue with [Pairing](../guides/pairing.md) and
  [Permission modes](../guides/permission-modes.md).
