###############################################################################
# cdn.tf — CloudFront distribution
#
# Two origins:
#   1. S3 bucket (artifacts — served via OAC, cached aggressively)
#   2. EC2 instance (API — pass-through caching, WAF attached)
###############################################################################

locals {
  s3_origin_id  = "forge-registry-s3"
  ec2_origin_id = "forge-registry-ec2"
}

resource "aws_cloudfront_distribution" "registry" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Forge Registry CDN — ${local.fqdn}"
  aliases             = [local.fqdn]
  default_root_object = ""
  price_class         = "PriceClass_100" # US, Canada, Europe only — cheapest

  web_acl_id = aws_wafv2_web_acl.registry.arn

  # ── S3 origin (artifact downloads) ──────────────────────────────────────
  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.registry.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.registry.id
  }

  # ── EC2 origin (API endpoints) ──────────────────────────────────────────
  origin {
    origin_id   = local.ec2_origin_id
    domain_name = aws_eip.registry.public_dns

    custom_origin_config {
      http_port              = 8744
      https_port             = 443
      origin_protocol_policy = "http-only" # nginx on EC2 handles TLS at edge
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # ── Default behaviour → EC2 API (no caching) ───────────────────────────
  default_cache_behavior {
    target_origin_id       = local.ec2_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Host", "X-Api-Key"]

      cookies {
        forward = "none"
      }
    }

    # Short TTL for API responses.
    default_ttl = 0
    min_ttl     = 0
    max_ttl     = 30
  }

  # ── /artifacts/* → S3 (long-lived, content-addressed) ──────────────────
  ordered_cache_behavior {
    path_pattern           = "/artifacts/*"
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    default_ttl = 86400    # 1 day
    min_ttl     = 3600     # 1 hour
    max_ttl     = 31536000 # 1 year
  }

  # ── TLS certificate ─────────────────────────────────────────────────────
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.registry.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name = "forge-registry-cdn"
  }

  depends_on = [aws_acm_certificate_validation.registry]
}
