###############################################################################
# s3.tf — Registry artifact bucket
###############################################################################

resource "aws_s3_bucket" "registry" {
  bucket = var.s3_bucket_name

  # Prevent accidental destruction of production artifacts.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "registry" {
  bucket = aws_s3_bucket.registry.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "registry" {
  bucket = aws_s3_bucket.registry.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block all public access — CloudFront uses OAC; EC2 uses IAM role.
resource "aws_s3_bucket_public_access_block" "registry" {
  bucket = aws_s3_bucket.registry.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: transition artifacts to Intelligent-Tiering after 30 days.
resource "aws_s3_bucket_lifecycle_configuration" "registry" {
  bucket = aws_s3_bucket.registry.id

  rule {
    id     = "tiering"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "INTELLIGENT_TIERING"
    }
  }
}

# CloudFront Origin Access Control for the S3 bucket.
resource "aws_cloudfront_origin_access_control" "registry" {
  name                              = "forge-registry-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy — allow CloudFront OAC read access.
data "aws_iam_policy_document" "s3_cloudfront" {
  statement {
    sid    = "AllowCloudFrontRead"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.registry.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.registry.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "registry" {
  bucket = aws_s3_bucket.registry.id
  policy = data.aws_iam_policy_document.s3_cloudfront.json

  depends_on = [aws_s3_bucket_public_access_block.registry]
}
