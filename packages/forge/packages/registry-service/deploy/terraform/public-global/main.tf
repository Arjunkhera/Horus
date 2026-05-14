###############################################################################
# main.tf — Provider configuration and shared locals
###############################################################################

terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # Remote state — update bucket/key/region for your account before first apply.
  # Uncomment and configure once the bootstrap bucket exists.
  # backend "s3" {
  #   bucket         = "horus-tf-state"
  #   key            = "forge/registry-service/public-global/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "horus-tf-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = "forge-registry"
        Environment = "production"
        ManagedBy   = "terraform"
      },
      var.tags,
    )
  }
}

# ACM certificate for CloudFront *must* be in us-east-1 regardless of the
# primary region chosen for other resources.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = merge(
      {
        Project     = "forge-registry"
        Environment = "production"
        ManagedBy   = "terraform"
      },
      var.tags,
    )
  }
}

###############################################################################
# Locals
###############################################################################

locals {
  fqdn = "${var.registry_subdomain}.${var.domain}"

  common_tags = {
    Project     = "forge-registry"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

###############################################################################
# Data sources — default VPC / public subnet
###############################################################################

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
}
