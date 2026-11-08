# 6. Authenticate the agent with API keys or cloud providers only

## Status

Accepted

## Context

The Claude Agent SDK can authenticate in several ways. Besides an Anthropic API key and
the Amazon Bedrock, Google Vertex AI and Microsoft Foundry integrations, a computer may
have a claude.ai login stored by other tools. Consumer subscription logins are meant for
Anthropic's own apps and are governed by different terms than the API. A third-party
server that relays a subscription login to other devices is not an appropriate use of
those credentials, and it would blur who is responsible for the usage.

## Decision

- longcord supports exactly four providers: an Anthropic API key, Amazon Bedrock, Google
  Vertex AI and Microsoft Foundry, configured with `longcord setup` (`--provider`).
- The API key is stored in `secrets.json` with file mode 600. Cloud providers use their
  standard credential configuration and environment variables.
- When starting an agent, the server removes OAuth token variables for claude.ai logins
  from the agent's environment, so a session cannot pick up a subscription login by
  accident.
- The docs state clearly that API usage is billed separately from Claude subscriptions.

## Consequences

- Users need an API key or a cloud account with Claude models enabled, and pay per use.
  This is a real barrier for some users, and the docs are upfront about it.
- Billing is transparent and controllable with provider spend limits and longcord's daily
  cap.
- There is no login flow for longcord to implement or keep working.
