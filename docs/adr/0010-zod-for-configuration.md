# 10. Validate configuration with zod

## Status

Accepted

## Context

`config.json` is edited by `longcord setup`, by `longcord config set`, and sometimes by
hand. Some keys are security relevant (`host`, `port`, `projects`) and a typo should not
silently fall back to something unsafe or crash the service at 3 a.m. We also want one
place that defines each key's type, default and limits, shared by the server, the CLI and
the docs.

## Decision

The configuration schema is defined once with [zod](https://zod.dev/). It provides the
TypeScript types, the defaults and the validation. `host` is limited to loopback addresses.
`longcord config set` converts the string value to the key's type and validates the whole
configuration before saving. Unknown keys are reported by `longcord doctor`. Secrets use
a separate schema and file.

## Consequences

- Invalid configuration is rejected with a clear message instead of misbehaving later.
- Adding a key means one schema entry plus documentation.
- zod is a production dependency. It has no dependencies of its own and is widely used.
