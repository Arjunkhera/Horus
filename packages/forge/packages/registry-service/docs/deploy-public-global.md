# Forge Registry — Public Global Deployment Runbook

**Domain:** `registry.horus.dev`  
**Infrastructure:** AWS EC2 t4g.small (ARM) + S3 + CloudFront + WAF + Route 53 + CloudWatch  
**IaC:** Terraform (path: `deploy/terraform/public-global/`)  
**Target cost:** $30–50 / month

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Terraform | ≥ 1.7 | `brew install terraform` |
| AWS CLI | ≥ 2.x | `brew install awscli` |
| AWS credentials | — | Role or IAM user with admin-equivalent permissions |
| EC2 key pair | — | Created in the target region; name used in `tfvars` |

The following resources must exist **before** first apply:

- Route 53 hosted zone for `horus.dev` (zone ID automatically discovered by Terraform)
- EC2 key pair in `us-east-1` (or the region you configure)

---

## Architecture

```
Browser / CLI
     │ HTTPS
     ▼
CloudFront (PriceClass_100, WAF attached)
  ├── /artifacts/*  ──▶  S3 bucket (OAC, long TTL)
  └── /*            ──▶  EC2 t4g.small (nginx → docker → forge-registry:8744)
                              │
                              ├── typesense:8108  (search)
                              └── IAM instance profile → S3 bucket
```

- **TLS termination** at CloudFront (ACM cert, TLSv1.2+).
- **nginx** on EC2 handles HTTP→HTTPS redirect and proxies to the app container.
- **WAF rate rule**: 2 000 requests / 5 min / IP (CloudFront scope).
- **Auth strategy**: `builtin` — one publisher key, reads are unauthenticated.

---

## First-time Deployment

### 1. Create a `terraform.tfvars` file (never commit this)

```hcl
# deploy/terraform/public-global/terraform.tfvars
aws_region             = "us-east-1"
key_pair_name          = "my-ec2-key"
ssh_cidr               = "203.0.113.10/32"   # your operator IP
s3_bucket_name         = "horus-forge-registry"
publisher_key_id       = "pub-<random-id>"   # the builtin admin key ID
typesense_api_key      = "<random-strong-key>"
cloudwatch_alarm_email = "ops@example.com"   # optional
```

Generate the publisher key ID:
```bash
openssl rand -hex 16   # use this as publisher_key_id
openssl rand -hex 32   # use this as typesense_api_key
```

### 2. Initialise Terraform

```bash
cd packages/forge/packages/registry-service/deploy/terraform/public-global
terraform init
```

### 3. Review the plan

```bash
terraform plan -var-file=terraform.tfvars
```

Confirm:
- One EC2 `t4g.small` instance
- One S3 bucket with versioning enabled
- One CloudFront distribution with WAF
- ACM certificate in `us-east-1`
- Route 53 A + AAAA alias records
- CloudWatch alarms + SNS topic

### 4. Apply

```bash
terraform apply -var-file=terraform.tfvars
```

ACM certificate DNS validation can take 2–5 minutes.  
CloudFront distribution deployment typically takes 10–15 minutes.

### 5. Verify

```bash
# Health endpoint
curl -f https://registry.horus.dev/health

# Types listing (unauthenticated read)
curl https://registry.horus.dev/types

# Expected: HTTP 200
```

---

## Configuring the Publisher API Key

After the instance is running, register the publisher key in the builtin auth
database.  SSH to the instance and run:

```bash
# SSH (replace with the EIP from terraform output)
ssh -i ~/.ssh/my-ec2-key.pem ec2-user@<ec2_public_ip>

# Register the key
docker exec forge-registry \
  node -e "
const { registerKey } = require('./dist/auth/builtin');
registerKey('<publisher_key_id>', 'publisher', 'publish');
"
```

Alternatively, use the admin HTTP endpoint (requires the instance to have
started successfully):

```bash
# No admin endpoint is exposed publicly — use SSH tunnel
ssh -L 8744:127.0.0.1:8744 ec2-user@<ec2_public_ip>
# In another terminal:
curl -X POST http://localhost:8744/admin/keys \
  -H "Content-Type: application/json" \
  -d '{"id":"<publisher_key_id>","name":"publisher","role":"publish"}'
```

---

## Day-2 Operations

### Rolling deploy (new image)

```bash
ssh ec2-user@<ec2_public_ip>
cd /opt/forge-registry
docker compose pull
docker compose up -d --remove-orphans
```

CloudFront continues serving cached responses during the container restart
(typically < 30 s).

### View service logs

```bash
# On the instance
docker compose -f /opt/forge-registry/docker-compose.yml logs -f forge-registry

# Via CloudWatch Logs
aws logs tail /forge/registry --follow
```

### Update Terraform (e.g., new AMI or WAF rule)

```bash
terraform plan  -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

If `user_data_replace_on_change = true` triggers an instance replacement,
Terraform will stop the old instance, launch a new one, and reassign the
Elastic IP atomically.

### Invalidate CloudFront cache

```bash
aws cloudfront create-invalidation \
  --distribution-id <cloudfront_id> \
  --paths "/*"
```

### Emergency instance stop (cost saving)

```bash
aws ec2 stop-instances --instance-ids <instance_id>
# EIP is retained; restart with:
aws ec2 start-instances --instance-ids <instance_id>
```

---

## Cost Estimate

| Resource | Estimated monthly cost |
|----------|----------------------|
| EC2 t4g.small (on-demand, us-east-1) | ~$13 |
| EBS gp3 20 GB | ~$1.60 |
| Elastic IP (attached) | $0 |
| S3 storage (10 GB) + requests | ~$1 |
| CloudFront (PriceClass_100, 50 GB egress) | ~$5–10 |
| WAF Web ACL + rules | ~$7 |
| Route 53 hosted zone | ~$0.50 |
| CloudWatch (alarms + logs) | ~$3–5 |
| **Total** | **~$31–38** |

Switch to a t4g.small Reserved Instance (1-year, no upfront) to reduce EC2
cost to ~$8/month.

---

## Teardown

```bash
terraform destroy -var-file=terraform.tfvars
```

The S3 bucket has `prevent_destroy = true`.  To delete it:
1. Remove the `lifecycle` block from `s3.tf`
2. Run `terraform apply -var-file=terraform.tfvars` to update state
3. Run `terraform destroy -var-file=terraform.tfvars`

Or manually empty and delete the bucket:
```bash
aws s3 rm s3://horus-forge-registry --recursive
aws s3api delete-bucket --bucket horus-forge-registry
```

---

## Security Notes

- EC2 metadata service is locked to IMDSv2 (hop limit 1).
- S3 bucket has full public-access block; CloudFront uses OAC (SigV4).
- SSH is restricted to the CIDR in `var.ssh_cidr`.
- Application port (8744) is bound to `127.0.0.1` inside the container;
  external access goes through nginx on 443.
- WAF blocks any IP exceeding 2 000 requests / 5 min.
- AWS Managed Rules (common rule set) block known bad signatures.
- CloudWatch alarms notify via SNS on: high CPU, status check failure,
  high CF request rate, WAF block surge, S3 egress spike.
