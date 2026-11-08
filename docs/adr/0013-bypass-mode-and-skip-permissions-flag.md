# 13. Set the skip-permissions flag only for bypass sessions

## Status

Accepted

## Context

The Claude Agent SDK only lets a session use the `bypassPermissions` mode when the agent
process was started with `allowDangerouslySkipPermissions`. Setting that option on every
agent would make switching modes instant, but would leave every session one mode change
away from running anything without asking, including through a bug or a forged request.

## Decision

- The agent process is started with `allowDangerouslySkipPermissions` only when the
  session's mode is `bypassPermissions` at the time the process starts.
- Choosing bypass, when creating a session or switching modes, requires an explicit
  confirmation. The API rejects the request with `bypass_confirm_required` unless it
  carries `confirmBypass: true`, and the app shows a strong warning before sending it.
- Switching a running session to bypass records the new mode and restarts the agent
  process with the option when the session is idle, so a run in progress is never
  restarted mid-way.
- While a session is in bypass mode, the app shows a persistent red banner.

## Consequences

- Sessions that never use bypass never run with the option set.
- Switching to bypass takes effect at the next idle point, which can be a few seconds
  later than other mode changes.
- The confirmation requirement is enforced by the server, not only by the app.
