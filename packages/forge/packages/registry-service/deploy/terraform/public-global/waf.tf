###############################################################################
# waf.tf — WAFv2 Web ACL attached to CloudFront
#
# CloudFront WAF ACLs must be created in us-east-1.
###############################################################################

resource "aws_wafv2_web_acl" "registry" {
  provider    = aws.us_east_1
  name        = "forge-registry-waf"
  description = "Rate-limiting WAF for the Forge Registry CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Rate-based rule — 2000 requests per 5 minutes per IP.
  rule {
    name     = "RateLimitPerIP"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ForgeRegistryRateLimit"
      sampled_requests_enabled   = true
    }
  }

  # AWS managed rule group — common threats (SQLi, XSS, etc.)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ForgeRegistryCommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "ForgeRegistryWAF"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "forge-registry-waf"
  }
}
