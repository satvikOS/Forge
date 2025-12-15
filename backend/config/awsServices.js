/**
 * AWS Services Configuration
 * Centralized configuration for all AWS services (Bedrock, S3, Lambda, etc.)
 */

const { S3Client } = require('@aws-sdk/client-s3');
const { LambdaClient } = require('@aws-sdk/client-lambda');

class AWSServicesConfig {
    constructor() {
        this.region = process.env.AWS_REGION || 'us-east-1';
        this.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        this.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

        // S3 Configuration for model storage
        this.s3BucketName = process.env.AWS_S3_BUCKET || 'archdisc-models';

        // Lambda Configuration for AI agents
        this.lambdaFunctionPrefix = process.env.AWS_LAMBDA_PREFIX || 'archdisc-agent';

        this.initializeClients();
    }

    initializeClients() {
        const credentials = {
            accessKeyId: this.accessKeyId,
            secretAccessKey: this.secretAccessKey
        };

        // S3 Client for model storage
        this.s3Client = new S3Client({
            region: this.region,
            credentials
        });

        // Lambda Client for AI agents
        this.lambdaClient = new LambdaClient({
            region: this.region,
            credentials
        });

        console.log('✅ AWS Services initialized:', {
            region: this.region,
            s3Bucket: this.s3BucketName,
            lambdaPrefix: this.lambdaFunctionPrefix
        });
    }

    getS3Client() {
        return this.s3Client;
    }

    getLambdaClient() {
        return this.lambdaClient;
    }

    getS3BucketName() {
        return this.s3BucketName;
    }
}

module.exports = new AWSServicesConfig();
