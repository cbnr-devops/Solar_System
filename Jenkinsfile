@Library('my-shared-lib') _

pipeline {
    agent any 

    tools {
        nodejs 'nodejs-18'
    }

    parameters {
        booleanParam(name: 'INFRA_PROVISION', defaultValue: false, description: 'Provision Infra')
        choice(name: 'ENV', choices: ['dev', 'staging', 'all'], description: 'Environment')
    }

    environment {
        AWS_REGION = 'ap-southeast-2'
        AWS_ACCOUNT_ID = '312018064574'
        IMAGE_NAME = 'solar-system'
        IMAGE_TAG = "${BUILD_NUMBER}"
        ECR_REPO = 'solar-system'
    }

    stages {
        stage('Checkout') {
            steps {
                checkoutCode()
            }
        }

        stage('Terraform Apply') {
            when {
                expression { params.INFRA_PROVISION == true }
            }
            steps {
                script {
                    switch(params.ENV) {
                        case 'dev':
                            terraformApply("terraform/envs/dev")
                            break
                        case 'staging':
                            terraformApply("terraform/envs/staging")
                            break
                        case 'all':
                            terraformApply("terraform/envs/dev")
                            terraformApply("terraform/envs/staging")
                            break
                    }
                }
            }
        }

        stage('CI/CD pipeline') {
            when {
                expression { params.INFRA_PROVISION == false }
            }
            stages {
                stage('Install Dependencies') {
                    steps {
                        installDependencies()
                    }
                }

                stage('OWASP Scan') {
                    steps {
                        owaspScan()
                    }
                }

                stage('Unit Test') {
                    steps {
                        unitTest()
                    }
                }

                stage('SonarQube scan') {
                    steps {
                        sonarScan()
                    }
                }

                stage('Quality Gate') {
                    steps {
                        qualityGate()
                    }
                }

                stage('Build Docker Image') {
                    steps {
                        dockerBuild(IMAGE_NAME, IMAGE_TAG)
                    }
                }

                stage('Trivy image scan') {
                    steps {
                        trivyScan(IMAGE_NAME, IMAGE_TAG)
                    }
                }

                stage('Push Image to ECR') { 
                    steps { 
                        pushToECR(IMAGE_NAME, IMAGE_TAG, AWS_ACCOUNT_ID, AWS_REGION, ECR_REPO) 
                    } 
                }

                stage('Deploy to Dev Environment') {
                    steps {
                        deployEKS(
                            "dev-cluster",
                            AWS_REGION,
                            "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}",
                            "dev"
                        )
                    }
                }

                stage('Approval') { 
                    steps { 
                        timeout(time: 10, unit: 'MINUTES') {
                            input message: "Deploy to STAGING environment?"
                        }
                    } 
                }

                stage('Deploy to Staging Environment') {
                    steps {
                        deployEKS(
                            "staging-cluster",
                            AWS_REGION,
                            "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}", 
                            "staging"
                        )
                    }
                }
            }
        }
    }
}