# Horus Repository

## CLI Release Process

Before performing any release, publish, or version bump on this repository:

1. Call `knowledge_search` with query `"Horus CLI release procedure"` and scope `{ "repo": "Horus" }`
2. Read the returned procedure page with `knowledge_get_page`
3. Follow every step in order — do not skip steps

The canonical release procedure lives in Vault (`shared/procedures/horus-cli-release.md`). Always fetch the latest version before proceeding.

---

## Post-Merge Docker Rebuild

For changes to backend services only (not CLI):

```bash
cd /path/to/Horus
docker compose build <service> && docker compose up -d <service>
```

Where `<service>` is one of: `anvil`, `vault`, `forge`.
