# Horus Repository

## CLI Release Checklist

After completing **any change to the `cli/` directory**, check whether a CLI release is needed before closing out the task.

### Does this change need a release?

| Change | Release? |
|--------|----------|
| New/changed command, flag, or output | **Yes** |
| Bug fix in CLI logic | **Yes** |
| Backend-only change (Anvil, Vault, Forge, qmd-daemon) | No |
| `docker-compose.yml`, `setup.sh`, `update.sh` only | No |
| Docs only | No |

### Release steps (in order, do not skip)

1. `cd cli && npm run typecheck && npm run test`
2. Bump `"version"` in `cli/package.json` (patch / minor / major)
3. `git add cli/package.json && git commit -m "chore(cli): bump version to X.Y.Z"`
4. `git push origin master`
5. `git tag cli/vX.Y.Z && git push origin cli/vX.Y.Z`
6. `./publish-cli.sh <otp>` — run from **repo root**, need authenticator OTP
7. `npm view @arkhera30/cli version` — confirm new version is live

> Full details in Vault: `shared/procedures/horus-cli-release.md`

---

## Post-Merge Docker Rebuild

For changes to backend services only (not CLI):

```bash
cd /path/to/Horus
docker compose build <service> && docker compose up -d <service>
```

Where `<service>` is one of: `anvil`, `vault`, `forge`.
