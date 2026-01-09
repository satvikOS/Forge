#!/usr/bin/env node
/**
 * Force Lambda Update via AWS SDK
 * Bypasses serverless and directly updates Lambda function code
 */

const { LambdaClient, UpdateFunctionCodeCommand, GetFunctionCommand, PublishVersionCommand } = require('@aws-sdk/client-lambda');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const { execSync } = require('child_process');

const REGION = 'us-east-1';
const FUNCTIONS = [
    'archdisc-cad-dev-api',
    'archdisc-cad-dev-orchestrate'
];

const lambdaClient = new LambdaClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

async function createZip() {
    console.log('\n📦 Creating deployment package...');

    // Remove old zip if exists
    try { fs.unlinkSync('lambda-update.zip'); } catch(e) {}

    // Create new zip
    execSync('zip -r lambda-update.zip backend/ -x "backend/node_modules/@types/*" "backend/node_modules/*/test/*" "*.md" "*.map" > /dev/null 2>&1');

    const stats = fs.statSync('lambda-update.zip');
    console.log(`✅ Package created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    return 'lambda-update.zip';
}

async function updateFunction(functionName, zipFile) {
    console.log(`\n🚀 Updating ${functionName}...`);

    try {
        // Get current function info
        const getCommand = new GetFunctionCommand({ FunctionName: functionName });
        const currentFunc = await lambdaClient.send(getCommand);
        console.log(`   Current version: ${currentFunc.Configuration.Version}`);
        console.log(`   Last modified: ${currentFunc.Configuration.LastModified}`);

        // Read zip file
        const zipBuffer = fs.readFileSync(zipFile);

        // Update function code
        const updateCommand = new UpdateFunctionCodeCommand({
            FunctionName: functionName,
            ZipFile: zipBuffer,
            Publish: true  // Publish new version immediately
        });

        const result = await lambdaClient.send(updateCommand);

        console.log(`✅ Updated successfully!`);
        console.log(`   New version: ${result.Version}`);
        console.log(`   Code SHA256: ${result.CodeSha256.substring(0, 16)}...`);
        console.log(`   Code size: ${(result.CodeSize / 1024).toFixed(2)} KB`);

        return true;
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return false;
    }
}

async function verifyDeployment() {
    console.log('\n🔍 Verifying deployment...');

    // Wait for Lambda to settle
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
        const response = await fetch('https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/test');
        const data = await response.json();

        console.log(`   API Version: ${data.version}`);
        console.log(`   Features: ${data.features?.join(', ')}`);

        if (data.version === '2.1.0-json-fix') {
            console.log('✅ Verification PASSED - New code is deployed!');
            return true;
        } else {
            console.log('⚠️  Verification WARNING - API may not have updated');
            return false;
        }
    } catch (error) {
        console.error(`⚠️  Verification failed: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║   FORCE LAMBDA UPDATE - DIRECT DEPLOY    ║');
    console.log('╚═══════════════════════════════════════════╝');

    try {
        // Create deployment package
        const zipFile = await createZip();

        // Update all functions
        let successCount = 0;
        for (const functionName of FUNCTIONS) {
            const success = await updateFunction(functionName, zipFile);
            if (success) successCount++;
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`📊 Update Results: ${successCount}/${FUNCTIONS.length} functions updated`);

        if (successCount > 0) {
            // Verify deployment
            await verifyDeployment();
        }

        // Cleanup
        fs.unlinkSync(zipFile);

        if (successCount === FUNCTIONS.length) {
            console.log('\n✅ ALL FUNCTIONS UPDATED SUCCESSFULLY!');
            process.exit(0);
        } else {
            console.log('\n⚠️  Some functions failed to update');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n💥 Fatal error:', error);
        process.exit(1);
    }
}

main();
