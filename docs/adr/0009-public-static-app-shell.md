# 9. Serve the static app shell without authentication

## Status

Accepted

## Context

The web app must load before the user has signed in, so it can show the sign-in screen
and handle pairing links. Browsers also fetch the manifest, icons and service worker
without credentials in some situations, and installing the app to the home screen needs
them.

## Decision

- The static app shell (HTML, JavaScript, CSS, manifest, icons and `/sw.js`) is served
  without authentication. It is identical for every user and contains no data, settings
  or secrets.
- Every `/api` route and every event stream requires a valid device cookie, except
  `/healthz`, which only reports that the server is up and is used by the supervisor and
  `longcord doctor`.
- All data reaches the app through the authenticated API after sign-in.
- The service worker has no fetch handler and caches nothing, so no API response is ever
  stored by it.

## Consequences

- Sign-in, pairing and installation work without special cases.
- Someone who can reach the server learns only that longcord is running and which version
  of the public app shell it serves.
- Every new route must be added behind authentication, with public exceptions marked
  explicitly in the route table, and should come with a test that it rejects
  unauthenticated requests.
