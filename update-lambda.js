#!/usr/bin/env node
/**
 * Update Lambda functions with new code
 */

const { LambdaClient, UpdateFunctionCodeCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const fs = require('fs');

const REGION = 'us-east-1';
const STAGE = 'dev';
const ZIP_FILE = 'lambda-deployment.zip';

// Lambda functions to update
const FUNCTIONS = [
    `archdisc-cad-${STAGE}-api`,
    `archdisc-cad-${STAGE}-orchestrate`,
];

const client = new LambdaClient({ region: REGION });

async function updateFunction(functionName) {
    try {
        console.log(`\n📤 Updating ${functionName}...`);

        // Read zip file
        const zipBuffer = fs.readFileSync(ZIP_FILE);
        console.log(`   Package size: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Update function code
        const command = new UpdateFunctionCodeCommand({
            FunctionName: functionName,
            ZipFile: zipBuffer,
            Publish: true
        });

        const response = await client.send(command);

        console.log(`✅ Successfully updated ${functionName}`);
        console.log(`   Version: ${response.Version}`);
        console.log(`   Code Size: ${(response.CodeSize / 1024).toFixed(2)} KB`);
        console.log(`   Runtime: ${response.Runtime}`);
        console.log(`   Last Modified: ${response.LastModified}`);

        return true;
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.error(`❌ Function ${functionName} not found`);
        } else {
            console.error(`❌ Error updating ${functionName}:`, error.message);
        }
        return false;
    }
}

async function main() {
    console.log('🚀 Lambda Function Update Script');
    console.log('==================================');

    // Check if zip file exists
    if (!fs.existsSync(ZIP_FILE)) {
        console.error(`❌ Deployment package not found: ${ZIP_FILE}`);
        process.exit(1);
    }

    const stats = fs.statSync(ZIP_FILE);
    console.log(`📦 Package: ${ZIP_FILE} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    // Update all functions
    let successCount = 0;
    for (const functionName of FUNCTIONS) {
        const success = await updateFunction(functionName);
        if (success) successCount++;
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Deployment complete: ${successCount}/${FUNCTIONS.length} functions updated`);

    if (successCount < FUNCTIONS.length) {
        console.log('\n⚠️  Some functions failed to update. Check AWS credentials and permissions.');
        process.exit(1);
    }
}

// Run
main().catch(error => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
});
