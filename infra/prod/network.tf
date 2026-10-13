# DECISION: the region's default VPC and subnets. One instance and one
# database do not justify a VPC of their own in v1; the database is private
# by its security group (5432 from the web group only) and
# `publicly_accessible = false`, not by subnet placement.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

resource "aws_security_group" "web" {
  name        = "${local.name}-web"
  description = "Caddy: HTTP, HTTPS and HTTP/3 from anywhere; nothing else inbound (no SSH)"
  vpc_id      = data.aws_vpc.default.id

  tags = { Name = "${local.name}-web" }
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = {
    http_v4  = { cidr_ipv4 = "0.0.0.0/0", protocol = "tcp", port = 80 }
    http_v6  = { cidr_ipv6 = "::/0", protocol = "tcp", port = 80 }
    https_v4 = { cidr_ipv4 = "0.0.0.0/0", protocol = "tcp", port = 443 }
    https_v6 = { cidr_ipv6 = "::/0", protocol = "tcp", port = 443 }
    http3_v4 = { cidr_ipv4 = "0.0.0.0/0", protocol = "udp", port = 443 }
    http3_v6 = { cidr_ipv6 = "::/0", protocol = "udp", port = 443 }
  }

  security_group_id = aws_security_group.web.id
  description       = each.key
  cidr_ipv4         = lookup(each.value, "cidr_ipv4", null)
  cidr_ipv6         = lookup(each.value, "cidr_ipv6", null)
  ip_protocol       = each.value.protocol
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "web_v4" {
  security_group_id = aws_security_group.web.id
  description       = "everything out (apt, Docker Hub, ECR, S3, SSM, Let's Encrypt, Stripe, Resend)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "web_v6" {
  security_group_id = aws_security_group.web.id
  description       = "everything out"
  cidr_ipv6         = "::/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "PostgreSQL from the web group only"
  vpc_id      = data.aws_vpc.default.id

  tags = { Name = "${local.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_web" {
  security_group_id            = aws_security_group.db.id
  description                  = "5432 from the instance"
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
