# Releasing

longcord is released with [release-please](https://github.com/googleapis/release-please)
and published to npm from GitHub Actions with
[provenance](https://docs.npmjs.com/generating-provenance-statements).
Nobody publishes from a laptop.

## How it works

1. Every merge to `main` runs `.github/workflows/release-please.yml`.
2. release-please reads the [Conventional Commits](https://www.conventionalcommits.org/)
   since the last release and opens (or updates) a release pull request titled
   like `chore(main): release 1.2.0`. It bumps `version` in `package.json` and
   `package-lock.json`, updates `.release-please-manifest.json`, and adds the
   release notes to `CHANGELOG.md`.
   - `fix:` gives a patch release, `feat:` a minor release, and `!` or a
     `BREAKING CHANGE:` footer a major release.
   - `docs:`, `test:`, `chore:` and similar types do not trigger a release on
     their own.
3. When a maintainer merges the release pull request, release-please creates
   the `vX.Y.Z` tag and a GitHub release, then calls
   `.github/workflows/publish.yml` in the same run.
4. The publish workflow checks that `NPM_TOKEN` is set and that the tag matches
   `package.json`, runs `npm ci`, `npm run build` and `npm test`, publishes with
   `npm publish --provenance --access public`, and attaches the packed `.tgz` to
   the GitHub release.

The publish workflow is called directly because tags created with the default
`GITHUB_TOKEN` do not trigger other workflows. It still runs on a manually
pushed `v*.*.*` tag, and can be started from the Actions tab
(**Run workflow**, with the tag as input) to retry a failed publish.

Configuration lives in `release-please-config.json` and
`.release-please-manifest.json` at the repository root.

## One-time setup

### npm token

1. Sign in to [npmjs.com](https://www.npmjs.com/) with the account that will
   own the `longcord` package, and enable two-factor authentication.
2. Create a token under **Access Tokens > Generate New Token**:
   - a **granular access token** with read and write permission, limited to the
     `longcord` package (for the very first publish, before the package exists,
     allow it to publish new packages and narrow it afterwards), or
   - a classic **Automation** token.
3. In this repository, open **Settings > Secrets and variables > Actions** and
   add it as a repository secret named `NPM_TOKEN`.
4. Set a reminder to rotate it before it expires.

### Optional: npm trusted publishing

npm can trust this repository's publish workflow through OpenID Connect, so no
long-lived token is needed. After the first release, open the package settings
on npmjs.com, add a trusted publisher for GitHub Actions with owner
`ansonhhlam`, repository `portable-claude` and workflow `publish.yml`, then
change the publish workflow to drop `NODE_AUTH_TOKEN` and the `NPM_TOKEN` check,
and delete the secret. The workflow already has `id-token: write`.

### Package metadata

Before the first release, `package.json` must not be `"private": true`, and its
`repository.url` must point at `https://github.com/ansonhhlam/portable-claude`
(npm rejects provenance when they disagree). `npm run pack:check` should pass.

## Cutting 1.0.0

The config pins the first release to 1.0.0 with `"release-as": "1.0.0"`, and the
manifest starts at `0.0.0`.

1. Make sure `main` is green and the docs are accurate.
2. Merge any pending work. release-please opens `chore(main): release 1.0.0`.
3. Review the pull request: the version, `CHANGELOG.md`, and that CI passes.
4. Merge it. Watch the **release-please** run in the Actions tab; its
   `publish` job publishes to npm and uploads the `.tgz` to the release.
5. Check the result:

   ```sh
   npm view longcord version
   npx longcord@latest --version
   ```

6. **Remove `release-as`** from the `"."` entry in `release-please-config.json`
   in a follow-up pull request (`chore: stop pinning release version`).
   Otherwise every later release pull request would also propose 1.0.0.

## Verifying provenance

- The package page on npmjs.com shows a **Provenance** section linking to the
  exact commit and workflow run that built it.
- From any project with the package installed, run:

  ```sh
  npm audit signatures
  ```

  It should report verified registry signatures and attestations for
  `longcord`.

## If a publish fails

- **`NPM_TOKEN` missing or expired:** add or replace the secret, then re-run the
  failed job, or run the **publish** workflow manually with the tag.
- **Tag does not match `package.json`:** something edited the version outside
  release-please. Fix it on `main` through a new release pull request; do not
  move or reuse a published tag.
- **Tests failed:** fix forward with a `fix:` commit. release-please will propose
  the next patch version.
- npm versions cannot be reused, even after `npm unpublish`. If a bad version
  ships, publish a fixed patch and run `npm deprecate longcord@X.Y.Z "<reason>"`.

## GitHub settings to turn on

Repository **Settings**:

- **Code security**
  - Secret scanning: on
  - Push protection: on
  - Private vulnerability reporting: on (required for the links in
    `SECURITY.md` and the issue templates)
  - Dependabot alerts and Dependabot security updates: on
  - CodeQL is configured by `.github/workflows/codeql.yml`; leave default setup off
    so the two do not conflict
- **Rules > Rulesets** (or **Branches > Branch protection**) for `main`:
  - Require a pull request before merging
  - Require status checks to pass, and require branches to be up to date. Select:
    - `lint`
    - `test (ubuntu-latest, node 22)`, `test (ubuntu-latest, node 24)`,
      `test (macos-latest, node 22)`, `test (macos-latest, node 24)`,
      `test (windows-latest, node 22)`, `test (windows-latest, node 24)`
    - `build`
    - `links`
    - `scan` (the privacy and gitleaks scan from `.github/workflows/privacy.yml`)
    - `analyze (javascript-typescript)` (CodeQL, optional)
  - Block force pushes
  - Restrict deletions
- **Actions > General**
  - Workflow permissions: **Read repository contents and packages permissions**
    (read-only default). Each workflow asks for anything more per job.
  - Tick **Allow GitHub Actions to create and approve pull requests**, so
    release-please can open release pull requests.
- **General > Features**: enable Discussions (linked from `SUPPORT.md` and the
  issue template chooser).
- **General > Pull Requests**: allow squash merging and set the default commit
  message to the pull request title, so the Conventional Commit title becomes
  the commit on `main`.

Personal account **Settings > Emails**:

- Tick **Keep my email addresses private**.
- Tick **Block command line pushes that expose my email**, and commit with your
  `*@users.noreply.github.com` address.

Status checks only appear in the ruleset picker after they have run at least
once, so open a test pull request first if the list is empty.
