# 8. Per-device cookies from pairing links or a passcode

## Status

Accepted

## Context

Being on the tailnet must not be enough to control the computer (see
[ADR 0005](0005-tailscale-serve-and-loopback-binding.md)). Users sign in from phones,
where typing long secrets is painful, and they need to cut off a single lost device
without disturbing the others. Tokens stored in JavaScript-accessible storage can be
stolen by any script injection.

## Decision

- A device signs in either with a **pairing link** or the **passcode**:
  - `longcord pair` on the computer creates a random one-time token shown as a QR code and
    link (`/#/pair/<token>`). It is valid once, for 10 minutes. The token sits in the URL
    fragment, which browsers do not send in requests or referrers, and the app removes it
    from the address bar immediately.
  - The passcode is chosen during setup or with `longcord passcode`. Only a slow salted
    hash is stored.
- A successful sign-in creates a device record and sets a signed cookie for that device:
  `HttpOnly`, `Secure`, `SameSite=Strict`. Revoking the device invalidates the cookie.
- Failed passcode attempts are rate limited: 5 failures lock a client out for 15 minutes,
  doubling with each lockout, plus a global limit.
- State-changing requests must carry the app's own `Origin`.

## Consequences

- Sign-in on a phone is a camera scan; no secret has to be typed.
- Each device can be listed and revoked from the CLI or the app.
- Scripts in the page cannot read the cookie, and other sites cannot use it.
- On iPhone, a Home Screen app has its own cookie storage, so users may need to sign in
  once more after installing it. The docs explain this.
- Anyone holding an unlocked, signed-in phone has access. Revocation and screen locks are
  the mitigation.
