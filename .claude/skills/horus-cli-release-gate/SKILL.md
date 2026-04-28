---
name: horus-cli-release-gate
description: Use this skill when the user asks to release the Horus CLI, publish `@arkhera30/cli` to npm, bump the CLI version, or ship CLI behavior changes. Triggers on phrases like "release the CLI", "npm publish", "ship a new horus version", "bump the CLI version", "tag a release", or any request that ends in `npm publish` for `packages/cli`. This skill walks the canonical CLI release procedure and gates the release on tests, build, and tagging — preventing the common mistake of publishing without a corresponding git tag (which is what triggers the full image rebuild).
---

# horus-cli-release-gate

## When this skill fires

Trigger phrases:

- "release the CLI"
- "publish the CLI" / "npm publish"
- "ship a new `horus` version" / "bump CLI version"
- "release `@arkhera30/cli`"
- "tag a release"
- The user mentions a CLI bug fix and says "let's get this out"

## What is being released

The Horus CLI is one of two release channels (the other is service Docker images, which are **automatic** on merge to master and do not need this skill).

| Item | What it is |
|---|---|
| Package | `@arkhera30/cli` (public npm) |
| Source | `packages/cli/` in the Horus monorepo |
| Binary | `horus` |
| Used by | Every Horus user — this CLI is the **only** way to run Horus |
| What ships | The CLI binary, embedded `docker-compose.yml` template, embedded service URL list |

A CLI release is needed whenever:
- New CLI commands or flags are added.
- The embedded compose template changes (new service, port change, healthcheck change, env var).
- Bug fixes to setup/up/down/status/connect/doctor/backup commands.

## The procedure

This skill is a checklist, not a black box. Each step matters.

### 0. Prerequisite

You must be in a `forge_develop` session for the Horus repo. The canonical clone is blocked. If you are not in a session:

```
forge_develop({ repo: "Horus", workItem: "<release-work-item-id>" })
```

Then `cd <sessionPath>/packages/cli`.

### 1. Bump the version

Edit `packages/cli/package.json`. Use semver:
- **Patch** (`x.y.Z`) for bug fixes only.
- **Minor** (`x.Y.0`) for new commands or new flags.
- **Major** (`X.0.0`) for breaking changes (CLI flag removed, command renamed, env-var name changed).

### 2. Build

```
cd packages/cli
pnpm build
```

If this fails, **stop**. Do not proceed.

### 3. Test

```
pnpm test
```

The CLI has Vitest tests for `connect`, `guide`, `help`, `test-env`. All must pass. If a test fails, **stop and investigate**. Do not skip.

### 4. Publish to npm

```
npm publish
```

This publishes `@arkhera30/cli` to the public npm registry. Requires npm auth (the user must be logged in as the package owner).

### 5. Tag the release

This step is **not optional** — it triggers a full multi-arch image rebuild.

```
git tag v<version>      # e.g. git tag v0.4.0
git push origin v<version>
```

On a version tag (`v*.*.*`), the GitHub Actions workflow `.github/workflows/docker-publish.yml` rebuilds **all** service images regardless of which paths changed, and tags them with the semver. This is what gives users a coherent "v0.4.0" of Horus.

If you skip the tag, npm gets the new CLI but GHCR doesn't get matching semver-tagged images.

### 6. Verify

```
npm info @arkhera30/cli version    # Confirm npm has the new version
```

For users to pick up the new CLI:

```
horus update     # or: npm install -g @arkhera30/cli@latest
```

Service images update on next `horus up` after CI completes.

## What this skill prevents

- **Publishing without testing.** Step 3 must pass.
- **Publishing without tagging.** Step 5 is the link between npm and GHCR.
- **Editing the CLI on the canonical clone.** Step 0 enforces session usage.
- **Confusing CLI release with service image release.** Service images go out automatically on every merge to master — that's a separate, automatic flow.

## Background reading

- Vault page: `shared/procedures/horus-release.md` — full release procedure (both channels)
- Vault page: `shared/guides/horus-cli-package.md` — CLI internals
- Vault page: `shared/guides/horus-development-workflow.md` — overall dev/deploy flow
