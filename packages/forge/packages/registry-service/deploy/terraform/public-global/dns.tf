###############################################################################
# dns.tf — Route 53 records for registry.horus.dev
###############################################################################

# Look up the existing horus.dev hosted zone (created outside Terraform).
data "aws_route53_zone" "horus_dev" {
  name         = "${var.domain}."
  private_zone = false
}

# registry.horus.dev → CloudFront distribution (ALIAS record).
resource "aws_route53_record" "registry" {
  zone_id = data.aws_route53_zone.horus_dev.zone_id
  name    = local.fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.registry.domain_name
    zone_id                = aws_cloudfront_distribution.registry.hosted_zone_id
    evaluate_target_health = false
  }
}

# IPv6 alias record.
resource "aws_route53_record" "registry_aaaa" {
  zone_id = data.aws_route53_zone.horus_dev.zone_id
  name    = local.fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.registry.domain_name
    zone_id                = aws_cloudfront_distribution.registry.hosted_zone_id
    evaluate_target_health = false
  }
}
