#!/bin/bash

# ArchDisc AWS Deployment Script (Simplified)
# This script deploys ArchDisc to AWS using Serverless Framework

set -e

echo "🚀 ArchDisc AWS Deployment"
echo "=========================="
echo ""

# Check if stage is provided
STAGE=${1:-dev}
echo "📍 Deploying to stage: $STAGE"
echo ""

# Load environment variables from .env if it exists
if [ -f .env ]; then
    echo "📋 Loading environment variables from .env..."
    export $(cat .env | grep -v '^#' | xargs)
    echo "✅ Environment variables loaded"
else
    echo "⚠️  No .env file found. API keys will not be set."
    echo "   To add API keys later, create a .env file with:"
    echo "   ANTHROPIC_API_KEY=your_key_here"
    echo "   OPENAI_API_KEY=your_key_here"
    echo "   GOOGLE_API_KEY=your_key_here"
fi
echo ""

# Check if AWS credentials are configured
if [ ! -f ~/.aws/credentials ]; then
    echo "❌ AWS credentials not found!"
    echo ""
    echo "To set up AWS credentials, run:"
    echo "   ./setup-aws-credentials.sh"
    echo ""
    echo "Or manually create ~/.aws/credentials with:"
    echo "[default]"
    echo "aws_access_key_id = YOUR_KEY"
    echo "aws_secret_access_key = YOUR_SECRET"
    echo ""
    exit 1
fi
echo "✅ AWS credentials found"
echo ""

# Build frontend
echo "🏗️  Building frontend..."
if [ -d "frontend" ]; then
    cd frontend

    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing frontend dependencies..."
        npm install
    fi

    echo "🔨 Building React app..."
    npm run build
    cd ..
    echo "✅ Frontend built successfully"
else
    echo "⚠️  Frontend directory not found, skipping build"
fi
echo ""

# Install backend dependencies
echo "📦 Installing backend dependencies..."
if [ -d "backend" ]; then
    cd backend
    if [ ! -d "node_modules" ]; then
        npm install --production
    fi
    cd ..
    echo "✅ Backend dependencies ready"
else
    echo "⚠️  Backend directory not found"
fi
echo ""

# Deploy with Serverless
echo "☁️  Deploying to AWS with Serverless Framework..."
echo "   This may take 5-10 minutes..."
echo ""

# Disable Serverless telemetry
export SLS_TELEMETRY_DISABLED=1

# Run deployment
npx serverless deploy --stage $STAGE --verbose

echo ""
echo "✅ Deployment complete!"
echo ""

# Try to get deployment info
echo "📋 Deployment Information:"
echo "=========================="
npx serverless info --stage $STAGE || echo "Run 'npx serverless info --stage $STAGE' to see deployment details"

echo ""
echo "🌐 Next Steps:"
echo "1. Check the output above for your API Gateway URL"
echo "2. Your CloudFront URL will be displayed above"
echo "3. Test your API: curl https://YOUR_API_URL/api/health"
echo "4. View logs: npx serverless logs -f api --stage $STAGE"
echo ""
echo "🎉 Deployment successful!"
echo ""
