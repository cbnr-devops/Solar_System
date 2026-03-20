terraform {
  backend "s3" {
    bucket         = "solarsystem-tf-state"
    key            = "dev/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "solar-system-tf-lock"
    encrypt        = true
  }
}
