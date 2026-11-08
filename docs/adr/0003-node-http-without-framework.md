# 3. Use node:http without a web framework

## Status

Accepted

## Context

The server exposes about twenty JSON routes, two Server-Sent Events streams and static
files. It runs unattended on personal computers, so every dependency is a long-term
maintenance and supply-chain cost. Web frameworks bring routing and middleware
conveniences, but also large dependency trees and behavior (body parsing, error pages,
headers) that we would need to audit and configure for our security requirements anyway.

## Decision

The server uses Node.js's built-in `node:http` module with a small router of our own. We
write the few helpers we need ourselves: JSON body reading with a size limit, JSON
responses, cookie handling, the Origin check, security headers, static file serving and
SSE.

## Consequences

- Production dependencies stay few, and the security-relevant request handling is all in
  our code where it can be reviewed and tested.
- We own a little more code, including edge cases a framework would handle. The helpers
  are unit tested.
- Long-lived SSE connections are straightforward with the raw response object.
- Contributors used to a framework need a moment to find their way around; the routes are
  defined in one place.
