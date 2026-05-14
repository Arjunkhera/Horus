###############################################################################
# ec2.tf — Registry EC2 instance, security group, and user-data
###############################################################################

###############################################################################
# Security group
###############################################################################

resource "aws_security_group" "registry" {
  name        = "forge-registry-sg"
  description = "Security group for the Forge Registry EC2 instance"
  vpc_id      = data.aws_vpc.default.id

  # HTTPS — open to the internet (CloudFront accesses the instance here)
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP — open for ACM certificate validation and redirect to HTTPS
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Application port — restricted to CloudFront prefix list for tighter
  # security (optional; remove if CloudFront reaches via 443).
  ingress {
    description = "Registry app port"
    from_port   = 8744
    to_port     = 8744
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH — restricted to operator IP only
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "forge-registry-sg"
  }
}

###############################################################################
# User-data — rendered from the shell script template
###############################################################################

# The forge-registry.yaml config is rendered from a Terraform template and
# injected into the instance via user-data.
data "local_file" "user_data_script" {
  filename = "${path.module}/../../scripts/user-data.sh"
}

locals {
  # Render the service config inline; it will be written to disk by user-data.
  registry_config_yaml = templatefile(
    "${path.module}/../../templates/forge-registry.yaml.tpl",
    {
      s3_bucket         = aws_s3_bucket.registry.id
      s3_region         = var.aws_region
      publisher_key_id  = var.publisher_key_id
      typesense_api_key = var.typesense_api_key
    },
  )

  # Combine the static user-data script with the rendered config embedded
  # as a here-doc so user-data remains a single document.
  user_data = <<-USERDATA
    #!/bin/bash
    set -euo pipefail

    # ── Write service config ────────────────────────────────────────────────
    mkdir -p /etc/forge-registry
    cat > /etc/forge-registry/config.yaml <<'CONFIG_EOF'
    ${local.registry_config_yaml}
    CONFIG_EOF

    # ── Write docker-compose ────────────────────────────────────────────────
    mkdir -p /opt/forge-registry
    cat > /opt/forge-registry/docker-compose.yml <<'COMPOSE_EOF'
    ${file("${path.module}/../../templates/docker-compose.prod.yml")}
    COMPOSE_EOF

    # ── Run bootstrap script ────────────────────────────────────────────────
    ${data.local_file.user_data_script.content}
  USERDATA
}

###############################################################################
# EC2 instance
###############################################################################

resource "aws_instance" "registry" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = tolist(data.aws_subnets.public.ids)[0]
  vpc_security_group_ids = [aws_security_group.registry.id]
  iam_instance_profile   = aws_iam_instance_profile.registry_ec2.name
  key_name               = var.key_pair_name

  # user_data hash triggers replacement when the script changes.
  user_data                   = local.user_data
  user_data_replace_on_change = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    delete_on_termination = true
    encrypted             = true
  }

  metadata_options {
    http_tokens = "required" # IMDSv2
  }

  monitoring = true

  tags = {
    Name = "forge-registry"
  }
}

# Elastic IP — keeps the DNS target stable across stop/start cycles.
resource "aws_eip" "registry" {
  instance = aws_instance.registry.id
  domain   = "vpc"

  tags = {
    Name = "forge-registry-eip"
  }
}
