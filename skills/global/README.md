# Global client skills — source of truth

These are the **6 global skills** delivered to every Horus client via `horus connect`
(`horus-anvil`, `horus-vault`, `horus-forge`, `horus-context`, `capture`, `triage`).

Until now they had **no version-controlled source** — they were published to the
control-plane registry ad-hoc, which let content drift out of sync with the actual
architecture (e.g. `horus-forge` kept teaching the retired `localhost:8744` /
CloudFront / `type: filesystem` registry long after the control-plane migration).
This directory is the canonical source so that can't happen silently again.

## Layout

```
skills/global/<id>/
  SKILL.md        # the skill body delivered to agents
  metadata.yaml   # registry metadata (id, name, version, type, tags, files)
```

`capture` is local-only (not published to the registry) and has no `metadata.yaml`.

## Delivery

`horus connect` (connected mode, since CLI PR #383) installs these from the
**control-plane registry** (`https://horus.arjunkhera.io/api/v1/forge`), not from
the image. So changing a skill here is not enough — you must **republish** the new
version to the registry for clients to pick it up.

## Publishing a new version

1. Edit `SKILL.md` and bump `version:` in `metadata.yaml` (semver; immutable —
   re-publishing an existing version returns `409 VERSION_CONFLICT`).
2. Publish (requires a `tenant: default`, `registry-admin`/`publisher` JWT):

   ```
   POST {registry}/artifacts/skill/<id>/<version>
   body: { "files": { "metadata.yaml": "<base64>", "SKILL.md": "<base64>" } }
   ```

   where `{registry}` = `https://horus.arjunkhera.io/api/v1/forge`.
3. Verify: `GET {registry}/artifacts/skill/<id>/<version>` → 200, then
   `horus connect` on a client delivers the new content.

> Registry writes require **tenant `default`** (an `alpha`-tenant token gets
> `403 TENANT_MISMATCH`) and the `registry-admin` (or `publisher`) role.
