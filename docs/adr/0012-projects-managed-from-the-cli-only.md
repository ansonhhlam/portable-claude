# 12. Manage project folders from the CLI only

## Status

Accepted

## Context

A session runs in a project folder, and the agent works relative to it. If the phone could
choose any folder, a stolen or compromised device could start a session in the home
directory, a folder of credentials or system configuration. Folder browsing from the phone
would also expose the computer's directory structure over the API.

## Decision

- Project folders are added, renamed and removed only on the computer:
  `longcord projects add <path> [--name <name>]`, `longcord projects remove <id>`,
  `longcord projects list`, or during `longcord setup`.
- The API exposes the list of projects read-only. Creating a session takes a project id,
  never a path.
- The app explains how to add a project with the CLI.

## Consequences

- Access from the phone is limited to folders the user deliberately chose while at the
  computer.
- Adding a project while away is not possible. Users who need flexibility can add a parent
  folder of their code, accepting the wider scope.
- Permission modes still decide what the agent may do inside and outside the project (see
  [Permission modes](../guides/permission-modes.md)); a project is a starting point, not a
  sandbox.
