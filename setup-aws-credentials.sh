#!/bin/bash

# AWS Credentials Setup Script for ArchDisc
# This script will help you configure AWS credentials for deployment

echo "================================================"
echo "   ArchDisc AWS Credentials Setup"
echo "================================================"
echo ""
echo "To deploy to AWS, you'll need to provide your AWS credentials."
echo "You can find these in your AWS Console under:"
echo "IAM → Users → [Your User] → Security Credentials → Access Keys"
echo ""
echo "If you don't have an Access Key yet:"
echo "1. Go to AWS Console → IAM → Users → [Your User]"
echo "2. Click 'Security credentials' tab"
echo "3. Click 'Create access key'"
echo "4. Choose 'CLI' as the use case"
echo "5. Copy the Access Key ID and Secret Access Key"
echo ""

# Get AWS credentials
read -p "Enter your AWS Access Key ID: " AWS_ACCESS_KEY_ID
read -s -p "Enter your AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
echo ""
read -p "Enter your preferred AWS Region (default: us-east-1): " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

# Create AWS credentials directory
mkdir -p ~/.aws

# Write credentials file
cat > ~/.aws/credentials <<EOF
[default]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
EOF

# Write config file
cat > ~/.aws/config <<EOF
[default]
region = $AWS_REGION
output = json
EOF

# Set permissions
chmod 600 ~/.aws/credentials
chmod 600 ~/.aws/config

echo ""
echo "✓ AWS credentials configured successfully!"
echo ""
echo "Region: $AWS_REGION"
echo "Credentials saved to: ~/.aws/credentials"
echo ""

# Get API keys for LLM services
echo "================================================"
echo "   LLM API Keys Setup (Optional but Recommended)"
echo "================================================"
echo ""
echo "For the autonomous CAD generation features, you'll need:"
echo "1. Anthropic API Key (for Claude)"
echo "2. OpenAI API Key (for GPT-4)"
echo "3. Google API Key (for Gemini - optional)"
echo ""

read -p "Do you want to set up LLM API keys now? (y/n): " SETUP_LLMS
echo ""

if [ "$SETUP_LLMS" = "y" ] || [ "$SETUP_LLMS" = "Y" ]; then
    read -p "Enter your Anthropic API Key (or press Enter to skip): " ANTHROPIC_KEY
    read -p "Enter your OpenAI API Key (or press Enter to skip): " OPENAI_KEY
    read -p "Enter your Google API Key (or press Enter to skip): " GOOGLE_KEY

    # Create .env file
    cat > .env <<EOF
# AWS Configuration (already set in ~/.aws/)
AWS_REGION=$AWS_REGION

# LLM API Keys
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
OPENAI_API_KEY=$OPENAI_KEY
GOOGLE_API_KEY=$GOOGLE_KEY

# Application Configuration
NODE_ENV=development
STAGE=dev
EOF

    chmod 600 .env

    echo ""
    echo "✓ API keys saved to .env file"
    echo ""
fi

echo "================================================"
echo "   Setup Complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Review serverless.yml configuration"
echo "2. Run deployment: npx serverless deploy --stage dev"
echo "3. Or use the automated script: ./deploy.sh dev"
echo ""
echo "Your AWS credentials are configured and ready!"
echo ""
