###############################################################################
# monitoring.tf — CloudWatch alarms and SNS topic
###############################################################################

###############################################################################
# SNS topic (optional — requires alarm_email to be set)
###############################################################################

resource "aws_sns_topic" "registry_alarms" {
  name = "forge-registry-alarms"
}

resource "aws_sns_topic_subscription" "registry_email" {
  count     = var.cloudwatch_alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.registry_alarms.arn
  protocol  = "email"
  endpoint  = var.cloudwatch_alarm_email
}

###############################################################################
# CloudWatch Log Group — registry application logs
###############################################################################

resource "aws_cloudwatch_log_group" "registry" {
  name              = "/forge/registry"
  retention_in_days = 30

  tags = {
    Name = "forge-registry-logs"
  }
}

###############################################################################
# Alarm: high request rate at CloudFront
###############################################################################

resource "aws_cloudwatch_metric_alarm" "cf_requests_high" {
  alarm_name          = "forge-registry-cf-requests-high"
  alarm_description   = "CloudFront request rate exceeds 10 000 requests/min — possible abuse"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Requests"
  namespace           = "AWS/CloudFront"
  period              = 60
  statistic           = "Sum"
  threshold           = 10000
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = aws_cloudfront_distribution.registry.id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.registry_alarms.arn]
  ok_actions    = [aws_sns_topic.registry_alarms.arn]
}

###############################################################################
# Alarm: WAF blocked requests surge
###############################################################################

resource "aws_cloudwatch_metric_alarm" "waf_blocks_high" {
  provider            = aws.us_east_1
  alarm_name          = "forge-registry-waf-blocks-high"
  alarm_description   = "WAF blocking rate exceeds 500 requests/min — rate-limit or attack"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  period              = 60
  statistic           = "Sum"
  threshold           = 500
  treat_missing_data  = "notBreaching"

  dimensions = {
    WebACL = aws_wafv2_web_acl.registry.name
    Region = "us-east-1"
    Rule   = "ALL"
  }

  alarm_actions = [aws_sns_topic.registry_alarms.arn]
  ok_actions    = [aws_sns_topic.registry_alarms.arn]
}

###############################################################################
# Alarm: S3 bytes downloaded (egress cost proxy)
###############################################################################

resource "aws_cloudwatch_metric_alarm" "s3_egress_high" {
  alarm_name          = "forge-registry-s3-egress-high"
  alarm_description   = "S3 GetObject egress exceeds 50 GB in 24 h — check for abuse"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BytesDownloaded"
  namespace           = "AWS/S3"
  period              = 86400 # 24 hours
  statistic           = "Sum"
  threshold           = 53687091200 # 50 GiB in bytes
  treat_missing_data  = "notBreaching"

  dimensions = {
    BucketName  = aws_s3_bucket.registry.id
    StorageType = "AllStorageTypes"
  }

  alarm_actions = [aws_sns_topic.registry_alarms.arn]
  ok_actions    = [aws_sns_topic.registry_alarms.arn]
}

###############################################################################
# Alarm: EC2 CPU utilisation
###############################################################################

resource "aws_cloudwatch_metric_alarm" "ec2_cpu_high" {
  alarm_name          = "forge-registry-ec2-cpu-high"
  alarm_description   = "EC2 CPU > 80% for 10 min — instance may be under pressure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.registry.id
  }

  alarm_actions = [aws_sns_topic.registry_alarms.arn]
  ok_actions    = [aws_sns_topic.registry_alarms.arn]
}

###############################################################################
# Alarm: EC2 status check failure
###############################################################################

resource "aws_cloudwatch_metric_alarm" "ec2_status_check" {
  alarm_name          = "forge-registry-ec2-status-check"
  alarm_description   = "EC2 instance status check failing — possible hardware or OS issue"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "breaching"

  dimensions = {
    InstanceId = aws_instance.registry.id
  }

  alarm_actions = [aws_sns_topic.registry_alarms.arn]
  ok_actions    = [aws_sns_topic.registry_alarms.arn]
}

###############################################################################
# CloudWatch Dashboard
###############################################################################

resource "aws_cloudwatch_dashboard" "registry" {
  dashboard_name = "forge-registry"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "CloudFront Requests"
          period = 60
          stat   = "Sum"
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.registry.id, "Region", "Global"]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "WAF Blocked Requests"
          period = 60
          stat   = "Sum"
          metrics = [
            ["AWS/WAFV2", "BlockedRequests", "WebACL", aws_wafv2_web_acl.registry.name, "Region", "us-east-1", "Rule", "ALL"]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "EC2 CPU Utilisation"
          period = 60
          stat   = "Average"
          metrics = [
            ["AWS/EC2", "CPUUtilization", "InstanceId", aws_instance.registry.id]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "S3 Bytes Downloaded (24h)"
          period = 86400
          stat   = "Sum"
          metrics = [
            ["AWS/S3", "BytesDownloaded", "BucketName", aws_s3_bucket.registry.id, "StorageType", "AllStorageTypes"]
          ]
        }
      }
    ]
  })
}
