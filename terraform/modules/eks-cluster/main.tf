module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"

  name = "solar-system-${var.env}-vpc"
  cidr = var.vpc_cidr

  azs = [
    "${var.aws_region}a",
    "${var.aws_region}b"
  ]

  private_subnets = [
    cidrsubnet(var.vpc_cidr, 8, 1),
    cidrsubnet(var.vpc_cidr, 8, 2)
  ]

  public_subnets = [
    cidrsubnet(var.vpc_cidr, 8, 101),
    cidrsubnet(var.vpc_cidr, 8, 102)
  ]

  enable_nat_gateway = true
  single_nat_gateway = true

  tags = {
    Environment = var.env
    Project     = "solar-system"
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "19.21.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.29"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  enable_irsa = true

  access_config = {
    authentication_mode = "API_AND_CONFIG_MAP"
  }

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      instance_types = var.instance_types
      min_size       = 2
      max_size       = 3
      desired_size   = 2
    }
  }
}