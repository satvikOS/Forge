#!/bin/bash
set -e

echo "🚀 Force Deploy Lambda Functions"
echo "================================="

# Disable all serverless telemetry and update checks
export SLS_TELEMETRY_DISABLED=1
export SLS_DEPRECATION_DISABLE="*"
export SLS_NOTIFICATIONS_MODE=off
export SERVERLESS_ACCESS_KEY=""

# Create serverless config to disable tracking
mkdir -p ~/.serverless
cat > ~/.serverless/config.json <<EOF
{
  "trackingDisabled": true,
  "enterpriseDisabled": true,
  "frameworkVersion": "3"
}
EOF

echo "📦 Packaging Lambda functions..."

# Use serverless programmatically via Node
node <<'NODESCRIPT'
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Monkey-patch the update check
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  // Block serverless update checker
  if (id.includes('update-notifier') || id.includes('@serverless/dashboard-plugin/lib/check-version')) {
    return () => {};
  }
  return originalRequire.apply(this, arguments);
};

// Try to load and run serverless
try {
  const serverlessPath = path.join(__dirname, 'node_modules', 'serverless', 'lib', 'Serverless.js');
  const Serverless = require(serverlessPath);

  const serverless = new Serverless({
    commands: ['deploy'],
    options: {
      stage: 'dev',
      region: 'us-east-1'
    }
  });

  serverless.init().then(() => {
    return serverless.run();
  }).then(() => {
    console.log('✅ Deployment successful!');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Deployment failed:', err.message);
    process.exit(1);
  });

} catch (error) {
  console.error('Error loading serverless:', error.message);
  process.exit(1);
}
NODESCRIPT

echo "✅ Deploy script completed"
