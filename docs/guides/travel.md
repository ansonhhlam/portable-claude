# Travelling: keeping your computer reachable

longcord is only useful while the computer at home is on, awake, online and running the
service. When you are away, nobody is there to press a button. Work through this checklist
before you leave, and test it: lock the screen, walk away, and use longcord from your
phone over mobile data.

## Checklist

### 1. The computer stays awake

- **Windows:** `longcord setup --fix-sleep` turns off sleep and hibernate while plugged in.
  Or go to **Settings > System > Power** and set sleep to **Never** when plugged in.
- **macOS:** `longcord setup --fix-sleep` turns on the `keepAwake` option, which keeps the
  Mac awake while longcord runs (it uses the built-in `caffeinate`). A MacBook with its
  lid closed still sleeps unless an external display, keyboard and power are connected,
  so leave the lid open.
- **Linux:** disable suspend in your desktop's power settings, or for a server:
  `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`.
- Run `longcord doctor`. It warns when sleep settings are likely to interrupt longcord.

### 2. longcord starts by itself after a reboot

Updates and power cuts reboot computers. `longcord setup` installs a service (skip it with
`--no-service`, but then you must start longcord yourself):

- **Windows:** the Task Scheduler task tries to start at boot without anyone signing in.
  If Windows does not allow that for your account, it starts when you sign in, so turn on
  automatic sign-in or make sure someone can sign in. Set **active hours** in Windows
  Update so restarts happen when you expect them.
- **macOS:** the LaunchAgent starts when you log in. After a reboot, a Mac with
  **FileVault** waits at the unlock screen and nothing runs until someone types the
  password at the Mac. If you need unattended restarts, consider the security trade-off of
  automatic login (which requires FileVault to be off) carefully, or avoid rebooting while
  away (postpone macOS updates).
- **Linux:** the systemd user unit starts at boot because setup enables lingering
  (`loginctl enable-linger`). Full-disk encryption that asks for a passphrase at boot will
  block this, as on macOS.

Check with `longcord status` after a test reboot.

### 3. The computer turns itself back on after a power cut

Most desktop PCs have a firmware (BIOS/UEFI) setting named something like **Restore on AC
power loss**, **AC back** or **After power failure**. Set it to **Power on**. Laptops
usually keep running on battery, but may not restart by themselves once the battery runs
out. Some Macs have **Start up automatically after a power failure** in Energy settings.

A small **UPS** (uninterruptible power supply) rides through short outages and protects
against corrupted files. Plug the router and modem into it too.

### 4. Tailscale stays signed in

- In the Tailscale admin console, **disable key expiry** for the computer. Otherwise its
  login expires after a period (180 days by default) and someone must re-authenticate at
  the computer.
- Make sure Tailscale starts automatically on the computer (the default on most systems).
- Confirm HTTPS still works: `longcord doctor` checks `tailscale serve`.

### 5. The internet connection

- If your home internet goes down, longcord is unreachable until it returns. Routers and
  modems usually reconnect on their own after an outage; leaving them on a UPS helps.
- No router configuration is needed for Tailscale. You do not need port forwarding, a
  static IP address or dynamic DNS.
- If reliability really matters, some routers support a mobile data backup connection.
- Tailscale works over almost any network on the phone side, including hotel Wi-Fi and
  mobile data. If a network blocks Tailscale's direct connections, it falls back to its
  relay servers over HTTPS, which is slower but usually works.

### 6. Fewer surprises

- Optional: restart longcord daily at a quiet time to clear any stuck state:
  `longcord config set dailyRestart 04:00`.
- Set a daily spend cap (see [Spending](spending.md)) so a runaway session cannot run up a
  large bill while you cannot react.
- Turn on notifications on the phone so you see when a session needs you or finishes.
- Pair a second device (for example a tablet or a laptop browser) as a backup.
- Write down the steps to revoke a lost phone: remove it from Tailscale in the admin
  console (works from any browser) and revoke it in longcord from another device.

## Countries that block or restrict VPNs

Tailscale is a VPN, built on the WireGuard protocol. Some countries block VPN traffic,
restrict which VPN services may be used, or regulate VPN use by law. Reported examples
over recent years include China, Iran, Russia, Turkmenistan, Belarus, Myanmar and the
United Arab Emirates, but the list, the rules and how strictly they are enforced change
over time and differ for residents and visitors.

What this means in practice:

- Tailscale may not connect, or may work only intermittently, in some places. Its relay
  fallback can help on networks that only block the WireGuard protocol, but it can also be
  blocked.
- Hotel, airport, workplace and school networks sometimes block VPNs too. Mobile data or
  another network may work where Wi-Fi does not.
- Using a VPN may be illegal or restricted where you are going. **Check current official
  travel advice and local law before you travel**, and follow it. This guide is not legal
  advice.
- Plan for being without longcord: finish or pause important sessions before you leave,
  and do not rely on remote access for anything time-critical.
