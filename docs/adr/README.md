# Architecture decision records

Each record describes one significant decision: the situation, what we decided, and what
follows from it. Records are not edited after they are accepted; a later record supersedes
an earlier one instead. See [ADR 0001](0001-record-architecture-decisions.md).

| ADR                                                   | Decision                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| [0001](0001-record-architecture-decisions.md)         | Record architecture decisions                                |
| [0002](0002-product-name-longcord.md)                 | Name the product longcord                                    |
| [0003](0003-node-http-without-framework.md)           | Use `node:http` without a web framework                      |
| [0004](0004-sse-and-append-only-event-log.md)         | Server-Sent Events over an append-only event log             |
| [0005](0005-tailscale-serve-and-loopback-binding.md)  | Reach the server through Tailscale; bind to loopback only    |
| [0006](0006-api-key-and-cloud-provider-auth-only.md)  | Authenticate the agent with API keys or cloud providers only |
| [0007](0007-mock-sdk-through-dependency-injection.md) | Mock the Agent SDK through dependency injection              |
| [0008](0008-device-cookies-pairing-and-passcode.md)   | Per-device cookies from pairing links or a passcode          |
| [0009](0009-public-static-app-shell.md)               | Serve the static app shell without authentication            |
| [0010](0010-zod-for-configuration.md)                 | Validate configuration with zod                              |
| [0011](0011-own-license-check-script.md)              | Check dependency licenses with our own script                |
| [0012](0012-projects-managed-from-the-cli-only.md)    | Manage project folders from the CLI only                     |
| [0013](0013-bypass-mode-and-skip-permissions-flag.md) | Set the skip-permissions flag only for bypass sessions       |
| [0014](0014-cost-from-cumulative-sdk-total.md)        | Track cost from the SDK's cumulative total                   |
| [0015](0015-end-to-end-tests-in-chromium.md)          | Run end-to-end tests in Chromium with phone viewports        |
