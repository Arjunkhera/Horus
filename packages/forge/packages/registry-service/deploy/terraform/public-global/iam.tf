###############################################################################
# iam.tf — IAM role and instance profile for the registry EC2 instance
###############################################################################

# Trust policy — allows EC2 to assume this role.
data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "registry_ec2" {
  name               = "forge-registry-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  description        = "Role used by the Forge Registry EC2 instance"
}

# S3 permissions — read/write to the registry bucket; no other buckets.
data "aws_iam_policy_document" "registry_s3" {
  statement {
    sid    = "BucketLevelAccess"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.registry.arn]
  }

  statement {
    sid    = "ObjectLevelAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.registry.arn}/*"]
  }
}

resource "aws_iam_policy" "registry_s3" {
  name        = "forge-registry-s3-policy"
  description = "Grants registry EC2 access to the forge-registry S3 bucket"
  policy      = data.aws_iam_policy_document.registry_s3.json
}

resource "aws_iam_role_policy_attachment" "registry_s3" {
  role       = aws_iam_role.registry_ec2.name
  policy_arn = aws_iam_policy.registry_s3.arn
}

# CloudWatch agent permissions so the instance can push metrics and logs.
resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  role       = aws_iam_role.registry_ec2.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

# SSM for session-manager-based console access (optional but recommended).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.registry_ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "registry_ec2" {
  name = "forge-registry-ec2-profile"
  role = aws_iam_role.registry_ec2.name
}
