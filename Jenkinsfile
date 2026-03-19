@Library('my-shared-lib') _

pipeline {

    agent any 

    tools {
        nodejs 'nodejs-18'
    }

    environment {
        AWS_REGION = 'ap-southeast-2'
        AWS_ACCOUNT_ID = '312018064574'
        IMAGE_NAME = 'solar-system'
        IMAGE_TAG = '${BUILD_NUMBER}'
        ECR_REPOSITORY = 'solar-system'
    }

    stages {
        stage('Checkout') {
            steps {
                checkoutCode()
            }
        }

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
            stage {
                dockerBuild(IMAGE_NAME, IMAGE_TAG)
            }
        }

    }
}
