# 5. Reach the server through Tailscale; bind to loopback only

## Status

Accepted

## Context

The phone needs to reach a server on a home computer from anywhere. Common options are
port forwarding on the router, a public tunnel service, or a private overlay network.
Anything reachable from the internet invites scanning and password guessing against a
service that can run commands on the computer. Browsers also require HTTPS for service
workers, push notifications and installable apps, and getting a trusted certificate for a
home computer is hard.

## Decision

- The server binds to `127.0.0.1` (configurable only to other loopback addresses) and
  never listens on a network interface.
- Remote access goes through Tailscale. The command
  `tailscale serve --bg --https=443 http://127.0.0.1:8417` forwards the computer's tailnet
  HTTPS address to the server. Tailscale provides the private network, WireGuard encryption and a trusted certificate
  for the `*.ts.net` name.
- The docs explicitly warn against `tailscale funnel`, which would make the service public.
- longcord does its own authentication on top (see
  [ADR 0008](0008-device-cookies-pairing-and-passcode.md)); being on the tailnet is not
  enough to use it.

## Consequences

- No router configuration, no public exposure, and real HTTPS with no certificate work.
- Users need a Tailscale account and the Tailscale app on each phone. Where VPNs are
  blocked, longcord may be unreachable; the travel guide says so.
- Other devices on the user's tailnet can reach the sign-in page, which is why longcord
  still requires per-device sign-in and recommends Tailscale access controls.
- Local programs on the same computer can reach the port; they still need a device cookie.
