# 4. Server-Sent Events over an append-only event log

## Status

Accepted

## Context

The phone must show sessions live: streamed text, tool calls, approval requests. Phones
are unreliable clients. iOS and Android suspend background pages and silently drop their
connections, networks change, and the app may be closed at any moment. After any of these
the app must show exactly what happened while it was away, without losing or duplicating
anything.

WebSockets are bidirectional, but the client-to-server direction here is a handful of
ordinary requests (send a message, answer an approval). WebSockets would also need our own
reconnection, resume and heartbeat protocol, and are harder to inspect and test.

## Decision

- Every session has an append-only log, `sessions/<id>/events.jsonl`, with one JSON event
  per line and a strictly increasing sequence number.
- Everything the app displays is derived from these events. Session metadata
  (`meta.json`) is a cache of totals and state for listing.
- The app reads a session with `GET /api/sessions/<id>/events?after=<seq>`, a Server-Sent
  Events stream. The server replays all events after `seq` from the log, then streams new
  ones live. Each SSE message carries the sequence number as its `id`.
- The client owns reconnection: it reconnects with the last sequence number it saw when
  the page becomes visible, when the network returns, when a page is restored from cache,
  and after errors with exponential backoff. It ignores events it has already seen.
- Actions from the app are plain JSON `POST`, `PATCH` and `DELETE` requests.
- A separate global stream carries small "something changed" notices without replay.

## Consequences

- Reconnecting is simple and exact; it is the same code path as the first load.
- The log is a complete audit trail of a session and makes debugging and testing easy.
- SSE works through `tailscale serve` and standard HTTP tooling without special handling.
- Logs grow with session length. Streamed text is buffered into larger delta events to
  keep logs compact.
- Writes must be careful about partial lines after a crash; the server repairs a truncated
  last line when it opens a log.
