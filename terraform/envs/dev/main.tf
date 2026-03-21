module "dev_cluster" {
  source     = "../../modules/eks-cluster"
  env        = "dev"
  aws_region = var.aws_region
  vpc_cidr   = var.vpc_cidr

  instance_types = var.instance_types
  
  cluster_name = "dev-cluster"
}