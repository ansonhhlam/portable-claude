# 11. Check dependency licenses with our own script

## Status

Accepted

## Context

longcord is MIT licensed and published to npm. A dependency under a strong copyleft
license (GPL or AGPL) or without a recognizable license would create obligations or
uncertainty for everyone who installs it. We want CI to fail when such a dependency
appears. Existing license checker packages work, but bring their own dependency trees and
configuration formats for what is a small task.

## Decision

`npm run licenses` runs a short script in `scripts/` that walks the installed packages,
reads each package's declared license, and fails on GPL, AGPL or unknown licenses.
Exceptions, if ever needed for packages with incomplete metadata, are listed explicitly in
the script and reviewed like code. CI runs it in the `lint` job.

## Consequences

- License problems are caught in the pull request that introduces them.
- The rules are explicit and easy to review in one file.
- We maintain the script ourselves, and it only reads declared licenses; it does not audit
  bundled files.
