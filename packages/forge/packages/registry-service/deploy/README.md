# Forge Registry — Deploy

Infrastructure and deployment automation for the Forge Remote Registry service.

## Directory Structure

```
deploy/
├── scripts/
│   ├── deploy.sh          # Full deployment pipeline (build → terraform → verify)
│   ├── redeploy.sh        # Update running instance with new image
│   ├── smoke-test.sh      # Validate a running registry instance
│   ├── ssh.sh             # SSH helper (resolves IP from terraform)
│   ├── teardown.sh        # Destroy infrastructure (interactive confirm)
│   ├── create-keypair.sh  # Create EC2 key pair
│   └── user-data.sh       # EC2 cloud-init bootstrap (used by Terraform)
├── terraform/
│   └── public-global/     # Production Terraform (EC2 + CloudFront + S3 + WAF)
│       ├── main.tf        # Provider config, data sources
│       ├── ec2.tf         # Instance, security group, user-data
│       ├── cdn.tf         # CloudFront distribution
│       ├── s3.tf          # Artifact bucket + OAC
│       ├── waf.tf         # WAF Web ACL (rate limiting)
│       ├── iam.tf         # Instance profile + policies
│       ├── monitoring.tf  # CloudWatch alarms + dashboard
│       ├── dns.tf         # Route53 (when custom domain enabled)
│       ├── acm.tf         # ACM certificate (when custom domain enabled)
│       ├── outputs.tf     # Terraform outputs
│       ├── variables.tf   # Input variables
│       ├── terraform.tfvars.example  # Example variable values
│       └── terraform.tfvars          # Actual values (git-ignored)
├── templates/
│   ├── docker-compose.prod.yml   # Production compose template
│   └── forge-registry.yaml.tpl   # Service config (Terraform-rendered)
├── dev/
│   └── config.yaml        # Local development config
├── enterprise/             # Enterprise deployment examples
│   ├── docker-compose.example.yaml
│   ├── configs/            # Auth strategy config examples
│   └── examples/           # OPA webhook example
└── Dockerfile.registry     # Multi-stage Dockerfile (patched for monorepo)
```

## Quick Start

### First-time deployment

```bash
# 1. Create EC2 key pair
./scripts/create-keypair.sh

# 2. Configure variables
cp terraform/public-global/terraform.tfvars.example terraform/public-global/terraform.tfvars
# Edit terraform.tfvars with your values

# 3. Deploy everything
./scripts/deploy.sh
```

### Update running service (new code)

```bash
./scripts/redeploy.sh
```

### SSH into the instance

```bash
./scripts/ssh.sh
./scripts/ssh.sh -- sudo docker logs forge-registry --tail 50
```

### Validate a running instance

```bash
./scripts/smoke-test.sh <EC2_IP>
./scripts/smoke-test.sh --from-terraform --api-key <ADMIN_KEY>
```

### Tear down infrastructure

```bash
./scripts/teardown.sh
```

## Architecture

```
Internet → CloudFront (CDN + WAF) → EC2 (t4g.small, ARM64)
                                      ├── nginx (TLS termination)
                                      ├── forge-registry (port 8744)
                                      └── typesense (port 8108, internal)

S3 (artifact storage) ← forge-registry (write)
S3 ← CloudFront OAC (read, for artifact downloads)
```

## Known Issues / Deviations from Scripts

These are documented learnings from the first deployment (2026-05-16):

1. **AL2023 curl-minimal conflict**: `dnf install curl` fails because `curl-minimal` is pre-installed. Fix: use `--allowerasing` flag (patched in user-data.sh).

2. **Typesense healthcheck**: The `typesense:0.25.2` image does not include `curl`. The docker-compose healthcheck must use a bash TCP check: `bash -c '</dev/tcp/localhost/8108'`.

3. **S3 credentials**: The registry service's `config.ts` requires explicit `FORGE_REGISTRY_S3_ACCESS_KEY_ID` env vars — it does NOT fall back to EC2 instance profile. An IAM user with scoped S3 access is created and credentials are passed via docker-compose environment.

4. **Port binding**: If not running nginx, the registry must bind `0.0.0.0:8744` (not `127.0.0.1:8744`) for CloudFront to reach it directly.

5. **Admin API key**: Generated on first container start and logged once. If lost during crash-loop debugging, delete the volume (`docker volume rm forge-registry_registry-data`) to force regeneration.

## Vault Documentation

Full deployment procedures and architecture concepts are documented in the Horus Vault:
- `procedures/forge-registry-deploy.md` — Step-by-step deployment procedure
- `concepts/forge-registry-architecture.md` — Infrastructure architecture
