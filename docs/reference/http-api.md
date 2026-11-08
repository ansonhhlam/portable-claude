# HTTP API and events

The web app talks to the server over a small JSON API. The types are defined in
[`src/shared/api.ts`](../../src/shared/api.ts); this page summarises them.

## Rules for every request

- The server listens on `127.0.0.1` only. Your phone reaches it through `tailscale serve`.
- Every `/api/*` route needs a signed device cookie (`lc_session`, `HttpOnly; Secure; SameSite=Strict`),
  except `POST /api/auth/login` and `POST /api/auth/pair`.
- Requests that change anything (`POST`, `PATCH`, `DELETE`) must send an `Origin` header matching the
  server's own address, and a JSON body with `Content-Type: application/json`. Others get `403` or `415`.
- Errors are JSON: `{ "error": "Human readable message", "code": "machine_code" }`.
- `GET /healthz` needs no sign-in and returns only `{ "ok": true }`. The service watchdog uses it.
- The web app's static files (HTML, JavaScript, CSS, icons) are public: they contain no data.

## Sign-in

| Method and path         | Body                        | Result                                                                                    |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /api/auth/pair`   | `{ token, deviceName? }`    | Sets the device cookie. Tokens work once and expire after 10 minutes.                     |
| `POST /api/auth/login`  | `{ passcode, deviceName? }` | Sets the device cookie. Repeated failures lock the client out (`429` with `Retry-After`). |
| `POST /api/auth/logout` | `{}`                        | Forgets this device and clears the cookie.                                                |
| `GET /api/me`           |                             | `MeInfo`: device, version, models, whether the mock agent is running.                     |

## Sessions

| Method and path                                | Body                                           | Result                                                                                 |
| ---------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/state`                               |                                                | `StateResponse`: me, sessions, projects, spend.                                        |
| `GET /api/sessions`                            |                                                | `SessionSummary[]`                                                                     |
| `POST /api/sessions`                           | `CreateSessionRequest`                         | `201` `SessionDetail`. `bypassPermissions` needs `confirmBypass: true`.                |
| `GET /api/sessions/:id`                        |                                                | `SessionDetail`, including `pendingApprovalIds`.                                       |
| `PATCH /api/sessions/:id`                      | `{ title?, archived? }`                        | `SessionDetail`                                                                        |
| `DELETE /api/sessions/:id`                     | `{}`                                           | Deletes the session and its log.                                                       |
| `POST /api/sessions/:id/messages`              | `{ text }`                                     | `202 { queued }`. Sent while the agent works, the message is queued into the same run. |
| `POST /api/sessions/:id/interrupt`             | `{}`                                           | Stops the current run.                                                                 |
| `POST /api/sessions/:id/mode`                  | `{ mode, confirmBypass? }`                     | Changes the permission mode live.                                                      |
| `POST /api/sessions/:id/approvals/:approvalId` | `{ decision: allow \| deny \| always, note? }` | `409 expired` if it is no longer waiting.                                              |
| `GET /api/import/candidates?projectId=`        |                                                | `ImportCandidate[]`: sessions on this computer that are not imported yet.              |
| `POST /api/import`                             | `{ projectId, sdkSessionId }`                  | `201` `SessionDetail` with the history imported read-only.                             |

Errors you may see: `spend_cap` (429, daily cap reached), `no_credentials` (409, no API key),
`bypass_confirm_required` (400), `unknown_project` (400), `bad_path` (400).

## Devices, spend and notifications

| Method and path              | Body                   | Result                                    |
| ---------------------------- | ---------------------- | ----------------------------------------- |
| `GET /api/devices`           |                        | `DeviceInfo[]`                            |
| `DELETE /api/devices/:id`    | `{}`                   | Revokes the device immediately.           |
| `GET /api/spend`             |                        | `SpendInfo`                               |
| `GET /api/push/key`          |                        | `{ publicKey }` (VAPID, base64url)        |
| `POST /api/push/subscribe`   | `PushSubscribeRequest` | Saves this device's push subscription.    |
| `DELETE /api/push/subscribe` | `{ endpoint }`         | Removes it.                               |
| `POST /api/push/test`        | `{}`                   | Sends a test notification to this device. |

## Live events (Server-Sent Events)

`GET /api/sessions/:id/events` streams the session's event log. Each message is:

```text
id: 42
data: {"seq":42,"ts":"2026-01-01T10:00:00.000Z","type":"tool.start","data":{...}}
```

- Every event is stored before it is sent, with a sequence number that only goes up.
- On reconnect the browser sends `Last-Event-ID`; the app also passes `?after=<lastSeq>`. The server
  sends every event after that number, then continues live. Clients ignore any `seq` they have seen.
- The server sends a `: ping` comment every 20 seconds to keep proxies from closing the stream.

`GET /api/events` is a lighter stream for the home screen. It sends `hello`, `sessions.changed`
(with `sessionId`) and `spend.changed`; the app refetches `/api/state` when it sees them.

### Event types

| Type                | Data                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `session.created`   | `title`, `projectId`, `mode`                                                                       |
| `session.renamed`   | `title`                                                                                            |
| `user.message`      | `text`, `queued`                                                                                   |
| `assistant.delta`   | `messageId`, `text` (a piece to append), `parentToolUseId`                                         |
| `assistant.message` | `messageId`, `text` (full text so far), `parentToolUseId`                                          |
| `tool.start`        | `toolUseId`, `name`, `summary`, `parentToolUseId`                                                  |
| `tool.end`          | `toolUseId`, `isError`, `output` (truncated), `truncated`                                          |
| `approval.request`  | `approvalId`, `toolName`, `title`, `summary`, `input`, `diff`, `canAlwaysAllow`, `parentToolUseId` |
| `approval.resolved` | `approvalId`, `resolution` (`allow`, `deny`, `always`, `expired`, `aborted`), `note?`              |
| `run.started`       | `runId`                                                                                            |
| `run.finished`      | `runId`, `isError`, `subtype`, `costUsd`, `durationMs`, `turns`, `errors`                          |
| `state`             | `state`: `idle`, `working` or `waiting`                                                            |
| `mode.changed`      | `mode`                                                                                             |
| `history.message`   | `role`, `text`, `tools`: imported, read-only history                                               |
| `notice`            | `level`, `message`                                                                                 |

A non-null `parentToolUseId` means the event belongs to a subagent started by that tool call.
