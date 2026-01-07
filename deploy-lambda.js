#!/usr/bin/env node
/**
 * Direct Lambda deployment script
 * Bypasses serverless framework to update Lambda functions directly
 */

const { LambdaClient, UpdateFunctionCodeCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

// AWS Configuration
const REGION = 'us-east-1';
const STAGE = 'dev';

// Lambda function names (from serverless.yml)
const FUNCTIONS = [
    `archdisc-cad-${STAGE}-api`,
    `archdisc-cad-${STAGE}-orchestrate`
];

const lambdaClient = new LambdaClient({ region: REGION });

async function createDeploymentPackage() {
    console.log('📦 Creating deployment package...');

    const output = fs.createWriteStream('lambda-update.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            console.log(`✅ Package created: ${archive.pointer()} bytes`);
            resolve('lambda-update.zip');
        });

        archive.on('error', reject);
        archive.pipe(output);

        // Add backend directory
        archive.directory('backend/', false);

        archive.finalize();
    });
}

async function updateLambdaFunction(functionName, zipFile) {
    console.log(`\n🔄 Updating Lambda function: ${functionName}`);

    try {
        // Check if function exists
        const getCommand = new GetFunctionCommand({ FunctionName: functionName });
        await lambdaClient.send(getCommand);

        // Update function code
        const zipBuffer = fs.readFileSync(zipFile);
        const updateCommand = new UpdateFunctionCodeCommand({
            FunctionName: functionName,
            ZipFile: zipBuffer
        });

        const response = await lambdaClient.send(updateCommand);
        console.log(`✅ Updated ${functionName}`);
        console.log(`   Version: ${response.Version}`);
        console.log(`   Last Modified: ${response.LastModified}`);
        console.log(`   Code Size: ${response.CodeSize} bytes`);

        return true;
    } catch (error) {
        console.error(`❌ Failed to update ${functionName}:`, error.message);
        return false;
    }
}

async function main() {
    console.log('🚀 Direct Lambda Deployment');
    console.log('===========================\n');

    try {
        // Create deployment package
        const zipFile = await createDeploymentPackage();

        // Update each Lambda function
        let successCount = 0;
        for (const functionName of FUNCTIONS) {
            const success = await updateLambdaFunction(functionName, zipFile);
            if (success) successCount++;
        }

        // Cleanup
        fs.unlinkSync(zipFile);
        console.log(`\n✅ Deployment complete: ${successCount}/${FUNCTIONS.length} functions updated`);

        if (successCount === 0) {
            console.log('\n⚠️  No functions were updated. Check AWS credentials and permissions.');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

main();
