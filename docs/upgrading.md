# Upgrading

## Update longcord

Install the latest version from npm, then run setup again so the background service runs
the new version:

```sh
npm install -g longcord@latest
longcord setup --yes --no-tailscale
```

`longcord setup` keeps your settings, API key, projects and paired devices. `longcord update`
prints these same steps if you forget them.

Check the new version with `longcord --version`, then run `longcord doctor`.

Release notes are in [CHANGELOG.md](../CHANGELOG.md) and on the GitHub releases page.
longcord follows [semantic versioning](https://semver.org/): a new major version (for
example 2.0.0) may need you to change something, and its release notes say what.

## Data migrations

When a new version changes how data is stored, longcord upgrades your data directory
automatically the first time it starts:

1. It copies the current data into `backups/` in your data directory.
2. It applies the changes and records the new data version.
3. It logs what it did; see `longcord logs`.

You do not need to do anything. If something goes wrong, the backup lets you restore the
previous state (stop longcord, put the backed-up files back, and install the previous
version).

## Downgrading

An older version of longcord refuses to start on data that a newer version has already
upgraded, with a message saying the data is newer than it supports. This protects your
data from being misread.

To go back to an older version anyway:

1. Stop longcord.
2. Restore the data from the backup made before the upgrade, in `backups/`.
3. Install the older version: `npm install -g longcord@<version>`.

Sessions and changes made after the upgrade are not in the backup.

## Updating Node.js

longcord supports Node.js 20.19 and newer. After a major Node.js update, run
`longcord doctor`. If the service fails to start, run `longcord setup` again so it points
at the new Node.js installation.

## Uninstalling

```sh
longcord uninstall
npm uninstall -g longcord
```

`longcord uninstall` removes the background service and the `tailscale serve`
configuration but keeps your data. Add `--delete-data` to also delete the data directory,
including sessions, devices and stored credentials. This cannot be undone.
