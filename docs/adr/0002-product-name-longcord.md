# 2. Name the product longcord

## Status

Accepted

## Context

The product needs a name for the npm package, the CLI command, the web app and the docs.
It must not suggest that it is an official Anthropic product or borrow Anthropic's product
branding, since it is an independent open-source project that uses the Claude Agent SDK.
It should be short to type on a command line, available on npm, and unlikely to collide
with existing tools.

## Decision

The product is called **longcord**: npm package `longcord`, command `longcord`. The name
evokes a long cord between your phone and your computer. The name was checked to be free
on npm before the first release.

The product has its own visual identity: a teal palette and a logo mark of a cord with a
single loop. It does not use Anthropic's colors, logos or product names in its own
branding. Where the docs and the app describe the underlying technology, they say
"Powered by Claude" or "Claude Agent SDK".

The GitHub repository keeps its original name; the package and command are what users see.

## Consequences

- All user-facing text uses "longcord" in lower case.
- Contributors must not add Anthropic logos or product branding to the app or docs.
- If the name ever has to change, the npm package, command name, data directory name and
  service names (`dev.longcord.agent`, `longcord.service`, the `longcord` task) all change
  together, which needs a migration.
