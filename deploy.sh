#!/bin/bash

# ArchDisc AWS Deployment Script

set -e

echo "🚀 ArchDisc AWS Deployment"
echo "=========================="

# Check if stage is provided
STAGE=${1:-dev}
echo "📍 Deploying to stage: $STAGE"

# Check AWS credentials
echo "🔐 Checking AWS credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured. Run 'aws configure' first."
    exit 1
fi
echo "✅ AWS credentials verified"

# Store API keys in AWS Secrets Manager
echo "🔑 Setting up API keys in Secrets Manager..."

read -p "Enter Anthropic API key (or press Enter to skip): " ANTHROPIC_KEY
if [ ! -z "$ANTHROPIC_KEY" ]; then
    aws ssm put-parameter \
        --name "/archdisc/$STAGE/anthropic-key" \
        --value "$ANTHROPIC_KEY" \
        --type "SecureString" \
        --overwrite \
        || echo "⚠️  Anthropic key already exists or failed to set"
fi

read -p "Enter OpenAI API key (or press Enter to skip): " OPENAI_KEY
if [ ! -z "$OPENAI_KEY" ]; then
    aws ssm put-parameter \
        --name "/archdisc/$STAGE/openai-key" \
        --value "$OPENAI_KEY" \
        --type "SecureString" \
        --overwrite \
        || echo "⚠️  OpenAI key already exists or failed to set"
fi

read -p "Enter Google API key (or press Enter to skip): " GOOGLE_KEY
if [ ! -z "$GOOGLE_KEY" ]; then
    aws ssm put-parameter \
        --name "/archdisc/$STAGE/google-key" \
        --value "$GOOGLE_KEY" \
        --type "SecureString" \
        --overwrite \
        || echo "⚠️  Google key already exists or failed to set"
fi

# Build frontend
echo "🏗️  Building frontend..."
cd frontend
npm install
npm run build
cd ..
echo "✅ Frontend built"

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm install --production
cd ..
echo "✅ Backend dependencies installed"

# Deploy with Serverless
echo "☁️  Deploying to AWS..."
serverless deploy --stage $STAGE --verbose

# Get outputs
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Deployment Information:"
echo "=========================="
serverless info --stage $STAGE

echo ""
echo "🌐 Your application is live at:"
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name archdisc-cad-$STAGE \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontURL`].OutputValue' \
    --output text 2>/dev/null || echo "Check AWS Console")
echo "   https://$CLOUDFRONT_URL"

echo ""
echo "📚 Next steps:"
echo "1. Access your application at the CloudFront URL above"
echo "2. Set up custom domain (optional): docs/CUSTOM_DOMAIN.md"
echo "3. Monitor logs: aws logs tail /aws/lambda/archdisc-cad-$STAGE-api --follow"
echo "4. View metrics: AWS CloudWatch Console"

echo ""
echo "🎉 Deployment successful!"
