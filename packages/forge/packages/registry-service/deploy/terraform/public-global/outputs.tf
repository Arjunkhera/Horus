###############################################################################
# outputs.tf — Key resource attributes surfaced after apply
###############################################################################

output "registry_fqdn" {
  description = "Fully-qualified domain name of the registry."
  value       = local.fqdn
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name (for debug / health checks)."
  value       = aws_cloudfront_distribution.registry.domain_name
}

output "cloudfront_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.registry.id
}

output "ec2_instance_id" {
  description = "Registry EC2 instance ID."
  value       = aws_instance.registry.id
}

output "ec2_public_ip" {
  description = "Elastic IP address of the registry EC2 instance."
  value       = aws_eip.registry.public_ip
}

output "s3_bucket_name" {
  description = "Name of the registry S3 bucket."
  value       = aws_s3_bucket.registry.id
}

output "waf_web_acl_arn" {
  description = "ARN of the WAFv2 Web ACL."
  value       = aws_wafv2_web_acl.registry.arn
}

output "sns_topic_arn" {
  description = "ARN of the CloudWatch alarm SNS topic."
  value       = aws_sns_topic.registry_alarms.arn
}

output "registry_url" {
  description = "Public HTTPS URL of the registry."
  value       = "https://${local.fqdn}"
}

output "health_check_url" {
  description = "Health-check endpoint to verify the deployment."
  value       = "https://${local.fqdn}/health"
}
