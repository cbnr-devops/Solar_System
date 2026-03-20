module "dev_cluster" {
  source     = "../../modules/eks-cluster"
  env        = "staging"
  aws_region = var.aws_region
  vpc_cidr   = var.vpc_cidr

  instance_types = var.instance_types

  tags = {
    Owner = "Sai"
    Environment = "staging"
  }
}