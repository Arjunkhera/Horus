# forge-registry.yaml.tpl — Terraform-rendered service configuration.
#
# This file is a Terraform templatefile() template; rendered values are
# written to /etc/forge-registry/config.yaml on the EC2 instance.
# Never commit the rendered file — it contains a publisher key ID.

server:
  host: "0.0.0.0"
  port: 8744
  coreVersion: "0.1.0"

storage:
  backend: "s3"
  bucket: "${s3_bucket}"
  region: "${s3_region}"
  prefix: ""

auth:
  strategy: "builtin"
  admins:
    - id: "${publisher_key_id}"
      name: "publisher"

# SQLite database for auth keys and audit log.
dbPath: "/data/forge-registry.db"

logLevel: "info"

typesense:
  host: "typesense"
  port: 8108
  protocol: "http"
  # apiKey injected via FORGE_REGISTRY_TYPESENSE_API_KEY env var
  apiKey: "${typesense_api_key}"
