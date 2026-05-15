###############################################################################
# acm.tf — TLS certificate for registry.horus.dev
#
# CloudFront requires the certificate to be in us-east-1, so we use the
# aliased provider defined in main.tf.
###############################################################################

resource "aws_acm_certificate" "registry" {
  provider          = aws.us_east_1
  domain_name       = local.fqdn
  validation_method = "DNS"

  lifecycle {
    # Create the replacement certificate before destroying the old one so
    # CloudFront is never left without a valid cert.
    create_before_destroy = true
  }

  tags = {
    Name = "forge-registry-cert"
  }
}

# DNS validation record in the horus.dev hosted zone.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.registry.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.horus_dev.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "registry" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.registry.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
