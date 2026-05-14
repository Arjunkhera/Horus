###############################################################################
# variables.tf — Input variables for the public-global deployment
###############################################################################

variable "aws_region" {
  description = "Primary AWS region for EC2 and supporting resources."
  type        = string
  default     = "us-east-1"
}

variable "domain" {
  description = "Root domain managed in Route 53 (e.g. horus.dev)."
  type        = string
  default     = "horus.dev"
}

variable "registry_subdomain" {
  description = "Subdomain for the registry service."
  type        = string
  default     = "registry"
}

variable "instance_type" {
  description = "EC2 instance type (must be ARM/Graviton for Amazon Linux 2023 ARM)."
  type        = string
  default     = "t4g.small"
}

variable "ami_id" {
  description = <<-EOT
    Amazon Linux 2023 ARM64 AMI ID for the target region.
    Find the latest with:
      aws ec2 describe-images \
        --owners amazon \
        --filters 'Name=name,Values=al2023-ami-2023*' \
                  'Name=architecture,Values=arm64' \
        --query 'sort_by(Images,&CreationDate)[-1].ImageId'
  EOT
  type        = string
  # al2023-ami-2023.6.20250115.0-kernel-6.1-arm64 (us-east-1)
  default = "ami-0a23a4938a8a3f235"
}

variable "key_pair_name" {
  description = "Name of an existing EC2 key pair for SSH access."
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR block allowed for SSH inbound (e.g. your office IP /32)."
  type        = string
}

variable "s3_bucket_name" {
  description = "Globally unique name for the registry S3 bucket."
  type        = string
  default     = "horus-forge-registry"
}

variable "publisher_key_id" {
  description = "ID of the initial publisher/admin API key (stored in the builtin auth config)."
  type        = string
  sensitive   = true
}

variable "typesense_api_key" {
  description = "API key for the Typesense search backend."
  type        = string
  sensitive   = true
}

variable "waf_rate_limit" {
  description = "Maximum requests per 5 minutes per IP enforced by WAF."
  type        = number
  default     = 2000
}

variable "cloudwatch_alarm_email" {
  description = "Email address for CloudWatch alarm SNS notifications."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags applied to all resources."
  type        = map(string)
  default     = {}
}
