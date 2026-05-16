---
name: forge-registry-ops
description: Use this skill when the user asks about deploying, redeploying, troubleshooting, or operating the Forge Remote Registry AWS infrastructure. Triggers on phrases like "deploy the registry", "redeploy", "update the registry", "SSH into the registry", "registry is down", "check registry health", "terraform apply", "registry infrastructure", or any request related to the Forge Registry's AWS deployment (EC2, CloudFront, S3, WAF).
---

# forge-registry-ops

## When this skill fires

Trigger phrases:

- "deploy the registry" / "deploy forge registry"
- "redeploy" / "push a new image" / "update the running registry"
- "SSH into the registry" / "check the instance"
- "registry is down" / "health check failing"
- "terraform apply" / "terraform plan" / "update infrastructure"
- "smoke test the registry"
- "tear down the registry"
- "what's the registry IP" / "CloudFront domain"

## Architecture Quick Reference

```
Internet → CloudFront + WAF (rate-limit) → EC2 (t4g.small, ARM64)
                                             ├── nginx (TLS)
                                             ├── forge-registry (:8744)
                                             └── typesense (:8108)
S3 ← artifact storage (OAC for reads, IAM user for writes)
```

## Key Paths

| What | Path |
|------|------|
| Deploy scripts | `packages/forge/packages/registry-service/deploy/scripts/` |
| Terraform | `packages/forge/packages/registry-service/deploy/terraform/public-global/` |
| Dockerfile | `packages/forge/packages/registry-service/deploy/Dockerfile.registry` |
| Docker compose template | `packages/forge/packages/registry-service/deploy/templates/docker-compose.prod.yml` |
| Service config template | `packages/forge/packages/registry-service/deploy/templates/forge-registry.yaml.tpl` |
| EC2 bootstrap | `packages/forge/packages/registry-service/deploy/scripts/user-data.sh` |
| SSH key | `~/Desktop/horus-registry-us-east-1.pem` |

## Vault Documentation

Always consult these Vault pages for detailed procedures and architecture:

| Page | Content |
|------|---------|
| `procedures/forge-registry-deploy.md` | Full step-by-step deployment procedure |
| `concepts/forge-registry-architecture.md` | Infrastructure architecture + design decisions |
| `learnings/forge-registry-deploy-gotchas.md` | Known pitfalls (AL2023, pnpm, Typesense, S3 creds) |

Load context:
```
knowledge_resolve_context(repo: "horus")
knowledge_search(query: "forge registry deploy", scope: { program: "horus" })
```

## Available Scripts

| Script | Usage |
|--------|-------|
| `deploy.sh` | Full deploy: `./deploy.sh` or `./deploy.sh --skip-build` or `--plan-only` |
| `redeploy.sh` | Code update: `./redeploy.sh` or `./redeploy.sh --pull-only` |
| `smoke-test.sh` | Validate: `./smoke-test.sh <IP>` or `--from-terraform --api-key <KEY>` |
| `ssh.sh` | SSH: `./ssh.sh` or `./ssh.sh -- <command>` |
| `teardown.sh` | Destroy: `./teardown.sh` (interactive confirmation) |
| `create-keypair.sh` | First-time: `./create-keypair.sh` |

## Common Operations

### Deploy from scratch
```bash
cd packages/forge/packages/registry-service/deploy
./scripts/create-keypair.sh
cp terraform/public-global/terraform.tfvars.example terraform/public-global/terraform.tfvars
# Edit tfvars
./scripts/deploy.sh
```

### Update running service (new code)
```bash
./scripts/redeploy.sh
```

### Debug a failing instance
```bash
./scripts/ssh.sh
# On EC2:
sudo docker logs forge-registry --tail 50
sudo docker logs forge-typesense --tail 50
cat /var/log/forge-registry-init.log
sudo docker compose -f /opt/forge-registry/docker-compose.yml ps
```

### Check current state
```bash
cd terraform/public-global
terraform output                    # All outputs
terraform output registry_elastic_ip  # Just the IP
```

## Critical Gotchas (from first deploy)

1. **AL2023 curl-minimal**: Use `dnf install -y --allowerasing curl`
2. **pnpm v11 breaks builds**: Dockerfile pins `pnpm@9.15.9` — do not upgrade
3. **Typesense has no curl**: Healthcheck must use bash TCP check
4. **S3 needs explicit creds**: Registry doesn't use instance profile; needs IAM user access keys
5. **Port binding**: Without nginx, use `0.0.0.0:8744` not `127.0.0.1:8744`
6. **Admin API key**: Generated once on first boot — capture immediately from logs
7. **gh auth scope**: Needs `write:packages` for GHCR push
8. **@horus/search in Dockerfile**: Required by `@forge/core` — must be in COPY steps

## Terraform State

State is LOCAL at `terraform/public-global/terraform.tfstate`. Back up this file. If lost, Terraform cannot manage existing resources and you'll need to import them.

## Current Deployment (2026-05-16)

| Resource | Value |
|----------|-------|
| Region | us-east-1 |
| Instance | t4g.small (ARM64) |
| Image | `ghcr.io/arjunkhera/horus/forge-registry:latest` |
| S3 Bucket | `horus-forge-registry` |
| WAF Rate Limit | 2000 req/5min/IP |
| CloudWatch Alarms | 5 (CF requests, WAF blocks, S3 egress, CPU, status check) |
| Monthly Cost | ~$18 |

## Billing Protection

| Budget | Limit | Action |
|--------|-------|--------|
| `Horus-Monthly-Total` | $50/mo | Email alerts at 50%, 80%, 100% |
| `Horus-Hard-Limit-75` | $75/mo | **Auto-stops EC2** via Lambda kill switch |

**Kill switch flow:** Spend > $75 → AWS Budgets → SNS (`budget-kill-switch`) → Lambda (`budget-kill-switch`) → `ec2:StopInstances`

**After a budget kill:**
```bash
aws ec2 start-instances --instance-ids <id> --region us-east-1
```

Instance is tagged `BudgetKilled=true` when stopped by the kill switch.
