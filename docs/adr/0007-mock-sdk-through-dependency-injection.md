# 7. Mock the Agent SDK through dependency injection

## Status

Accepted

## Context

Most of longcord's behavior (sessions, approvals, event logs, reconnects, the web app)
depends on what the agent does. Testing against the real model is slow, costs money,
needs credentials, and is not deterministic. Contributors should be able to work on the
server and app without an API key, and CI must not need secrets.

## Decision

- The server talks to the SDK only through a narrow interface (start a query, list and
  resume sessions). The real implementation wraps `@anthropic-ai/claude-agent-sdk` and is
  loaded lazily.
- A mock implementation of the same interface produces scripted, realistic event
  sequences: streamed text, tool calls, nested sub-agent activity, approval requests,
  errors and costs.
- The implementation is passed in when the server is created. `longcord start --mock` (and
  `npm run dev`) uses the mock. Unit and end-to-end tests use it too.

## Consequences

- `npm run dev`, unit tests and Playwright tests need no API key and cost nothing.
- Approval flows, reconnects and error handling can be tested deterministically.
- The mock can drift from the real SDK's behavior. The adapter around the real SDK is kept
  thin, and SDK updates must be checked against the mock's assumptions.
- The app shows a "Mock SDK" indicator in Settings so a mock server is never mistaken for
  a real one.
