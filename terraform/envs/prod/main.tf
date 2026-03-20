module "prod_cluster" {
  source         = "../../modules/eks-cluster"
  env            = "dev"
  aws_region     = var.aws_region
  vpc_cidr       = "10.2.0.0/16"
  aws_account_id = var.aws_account_id
}
