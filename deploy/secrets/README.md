# Sealed control-plane secrets (A3)

The six out-of-band secrets are committed here as **SealedSecret** resources —
encrypted with the in-cluster sealed-secrets controller's public key, so they
are safe to keep in Git. ArgoCD (`horus-secrets` app, sync-wave -1) applies
them; the controller unseals each into a normal `Secret` in `horus-system`
before the wave-0 workloads start.

## Prerequisites (one-time, post-provision)

The controller is installed by the `sealed-secrets` ArgoCD app (Helm,
namespace `sealed-secrets`, controller name `sealed-secrets-controller`). Before
sealing, confirm it is running and install the `kubeseal` CLI matching the chart:

```bash
kubectl -n sealed-secrets rollout status deploy/sealed-secrets-controller
kubeseal --controller-namespace sealed-secrets --fetch-cert   # sanity check
```

`kubeseal` defaults (controller name `sealed-secrets-controller`, namespace
`sealed-secrets`) match this deployment, so no extra flags are needed.

## General pattern

Build a plain Secret with `--dry-run=client`, pipe through `kubeseal`, commit the
sealed output. Never commit the plain Secret.

```bash
kubectl create secret generic <NAME> -n horus-system \
  --from-literal=KEY=VALUE ... --dry-run=client -o yaml \
  | kubeseal --controller-namespace sealed-secrets --format yaml \
  > deploy/secrets/<NAME>.sealed.yaml
```

Then uncomment the file in `kustomization.yaml` and commit.

## The six secrets

### 1. `vault-secrets`
```bash
kubectl create secret generic vault-secrets -n horus-system \
  --from-literal=NEO4J_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=NEO4J_AUTH="neo4j/$(<the password above>)" \
  --from-literal=TYPESENSE_API_KEY="$(openssl rand -hex 24)" \
  --from-literal=GITHUB_TOKEN="<PAT with repo scope>" \
  --from-literal=GITHUB_REPO="Arjunkhera/horus-knowledge" \
  --dry-run=client -o yaml | kubeseal --controller-namespace sealed-secrets --format yaml \
  > vault-secrets.sealed.yaml
```
`NEO4J_AUTH` must be `neo4j/<NEO4J_PASSWORD>` (same password). `horus-knowledge`
already exists, seeded with a master branch.

### 2 + 3. `horus-service-secrets` and `horus-principal-pub` — via `horus operator init`
operator-service generates the principal keypair on first boot. `horus operator
init` fetches the bundle and renders BOTH secrets as one multi-doc YAML; pipe it
straight through `kubeseal` (handles multi-doc → two SealedSecrets):
```bash
horus operator init --namespace horus-system --dry-run \
  | kubeseal --controller-namespace sealed-secrets --format yaml \
  > principal-secrets.sealed.yaml
```
This yields SealedSecrets for `horus-service-secrets`
(`HORUS_CLIENT_JWKS_JSON`, `HORUS_INTERNAL_SIGNING_KEY_JSON`) and
`horus-principal-pub` (`pub.jwk`). Requires a port-forward to operator-service
or `--operator-url`; see `horus operator init --help`.

### 4. `forge-registry-secrets` (S3 creds for the in-cluster registry → bucket `horus-forge-registry`, us-east-1)
```bash
kubectl create secret generic forge-registry-secrets -n horus-system \
  --from-literal=FORGE_REGISTRY_S3_ACCESS_KEY_ID="<arkhera IAM key id>" \
  --from-literal=FORGE_REGISTRY_S3_SECRET_ACCESS_KEY="<arkhera IAM secret>" \
  --dry-run=client -o yaml | kubeseal --controller-namespace sealed-secrets --format yaml \
  > forge-registry-secrets.sealed.yaml
```

### 5. `backup-credentials`
```bash
kubectl create secret generic backup-credentials -n horus-system \
  --from-literal=AWS_ACCESS_KEY_ID="<arkhera IAM key id>" \
  --from-literal=AWS_SECRET_ACCESS_KEY="<arkhera IAM secret>" \
  --from-literal=AWS_REGION="us-east-1" \
  --from-literal=BACKUP_BUCKET="horus-operator-backup-065585372120" \
  --dry-run=client -o yaml | kubeseal --controller-namespace sealed-secrets --format yaml \
  > backup-credentials.sealed.yaml
```

### 6. `grafana-admin`
```bash
kubectl create secret generic grafana-admin -n horus-system \
  --from-literal=password="$(openssl rand -hex 16)" \
  --dry-run=client -o yaml | kubeseal --controller-namespace sealed-secrets --format yaml \
  > grafana-admin.sealed.yaml
```

## Rotation
Re-run the relevant command and re-commit. The controller re-unseals on sync.
The controller's sealing key is itself backed up by the `operator-sqlite-backup`
sibling? No — back up the controller key separately:
`kubectl -n sealed-secrets get secret -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml`
and store it offline; losing it means re-sealing every secret on a new cluster.
