#!/bin/bash
# user-data.sh — EC2 bootstrap script for the Forge Registry service.
#
# Executed once at first boot by cloud-init (Amazon Linux 2023, ARM64).
# The Terraform local in ec2.tf prepends config and compose file creation
# before sourcing the body of this script.
#
# Expected environment by the time this runs:
#   /etc/forge-registry/config.yaml   — service config (written by Terraform)
#   /opt/forge-registry/docker-compose.yml — prod compose (written by Terraform)
#
# Design decisions:
#   - All output goes to /var/log/forge-registry-init.log for post-boot audit.
#   - Docker Compose runs as a systemd service for auto-restart on reboot.
#   - Self-signed cert is used for the nginx→CloudFront origin; the edge
#     certificate (ACM) handles the public TLS face.

set -euo pipefail
exec > >(tee /var/log/forge-registry-init.log | logger -t forge-registry-init) 2>&1

echo "=== Forge Registry bootstrap started at $(date -u) ==="

###############################################################################
# 1. System packages
###############################################################################

dnf update -y

# AL2023 ships curl-minimal which conflicts with full curl.
# Use --allowerasing to swap curl-minimal for full curl (needed by nginx, healthchecks).
dnf install -y --allowerasing \
  docker \
  nginx \
  openssl \
  curl \
  jq \
  awscli

# Install docker-compose v2 plugin
DOCKER_COMPOSE_VERSION="2.27.1"
ARCH="$(uname -m)"        # aarch64 on t4g
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL \
  "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

###############################################################################
# 2. Start Docker daemon
###############################################################################

systemctl enable docker
systemctl start docker

###############################################################################
# 3. Self-signed TLS certificate for nginx (CloudFront uses this as origin)
###############################################################################

mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/server.key \
  -out    /etc/nginx/ssl/server.crt \
  -subj   "/CN=registry.horus.dev/O=Horus/C=US"

###############################################################################
# 4. nginx configuration — reverse proxy to the registry container
###############################################################################

cat > /etc/nginx/conf.d/forge-registry.conf <<'NGINX_EOF'
# Redirect HTTP → HTTPS
server {
    listen 80 default_server;
    server_name _;
    return 301 https://$host$request_uri;
}

# HTTPS origin for CloudFront
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Proxy to the registry container
    location / {
        proxy_pass         http://127.0.0.1:8744;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }

    # Health check bypass (no auth required)
    location /health {
        proxy_pass http://127.0.0.1:8744/health;
    }
}
NGINX_EOF

# Remove the default server block shipped with AL2023.
rm -f /etc/nginx/conf.d/default.conf
nginx -t
systemctl enable nginx
systemctl start nginx

###############################################################################
# 5. Pull Docker images
###############################################################################

docker pull ghcr.io/arjunkhera/forge-registry:latest
docker pull typesense/typesense:0.25.2

###############################################################################
# 6. Systemd service for docker-compose
###############################################################################

cat > /etc/systemd/system/forge-registry.service <<'SYSTEMD_EOF'
[Unit]
Description=Forge Registry (docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/forge-registry
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
Restart=on-failure

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

systemctl daemon-reload
systemctl enable forge-registry
systemctl start forge-registry

###############################################################################
# 7. Wait for service health
###############################################################################

echo "Waiting for forge-registry to become healthy..."
ATTEMPTS=0
until curl -sf http://127.0.0.1:8744/health > /dev/null || [ $ATTEMPTS -ge 30 ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  echo "  attempt $ATTEMPTS/30 — sleeping 10s"
  sleep 10
done

if curl -sf http://127.0.0.1:8744/health > /dev/null; then
  echo "=== forge-registry is healthy ==="
else
  echo "=== WARNING: forge-registry did not become healthy within 5 min ==="
  docker compose -f /opt/forge-registry/docker-compose.yml logs --tail=50
fi

###############################################################################
# 8. Install CloudWatch agent
###############################################################################

dnf install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'CWA_EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/forge-registry-init.log",
            "log_group_name": "/forge/registry",
            "log_stream_name": "{instance_id}/init"
          },
          {
            "file_path": "/var/log/nginx/access.log",
            "log_group_name": "/forge/registry",
            "log_stream_name": "{instance_id}/nginx-access"
          },
          {
            "file_path": "/var/log/nginx/error.log",
            "log_group_name": "/forge/registry",
            "log_stream_name": "{instance_id}/nginx-error"
          }
        ]
      }
    }
  },
  "metrics": {
    "metrics_collected": {
      "cpu": { "measurement": ["cpu_usage_idle", "cpu_usage_user"] },
      "disk": { "measurement": ["used_percent"], "resources": ["/"] },
      "mem": { "measurement": ["mem_used_percent"] }
    },
    "append_dimensions": {
      "InstanceId": "${aws:InstanceId}"
    }
  }
}
CWA_EOF

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo "=== Forge Registry bootstrap complete at $(date -u) ==="
