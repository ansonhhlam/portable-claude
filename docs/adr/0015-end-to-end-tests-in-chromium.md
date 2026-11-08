# 15. Run end-to-end tests in Chromium with phone viewports

## Status

Accepted

## Context

The web app must work on iPhone and Android, in light and dark themes. End-to-end tests run
against a local server over plain `http://127.0.0.1`, because Tailscale HTTPS is not available
in CI. The device cookie is always marked `Secure`. Chromium accepts `Secure` cookies on
loopback addresses; WebKit (the engine behind Safari) does not, so a WebKit browser cannot
sign in to a plain-http test server.

Making the cookie non-`Secure` in test mode would mean testing a different security setup
from the one users get.

## Decision

Playwright runs four projects, all in Chromium: an iPhone 14 viewport and a Pixel 7 viewport,
each in light and dark mode. Tests start a real server with the mock agent
(`longcord start --mock`) and sign in through the real pairing flow. The mock agent also
skips the API key check, since it makes no API calls.

## Consequences

- Layout, touch targets, safe areas, themes and the full request flow are tested on phone
  sizes in CI on Windows, macOS and Linux.
- Safari-specific behaviour (for example how iOS drops background connections) is not
  exercised by WebKit itself. The reconnect logic is covered by unit tests with simulated
  page lifecycle events and by an end-to-end test that takes the browser offline and back,
  and should still be checked by hand on a real iPhone before a release.
