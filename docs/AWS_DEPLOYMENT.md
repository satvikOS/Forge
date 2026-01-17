# AWS Deployment Guide - ArchDisc CAD Platform

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         User Request                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              CloudFront CDN (Global Distribution)             │
│  • HTTPS only                                                 │
│  • Gzip compression                                           │
│  • Edge caching                                               │
└─────────────────────────────────────────────────────────────┘
                    ↙                           ↘
┌─────────────────────────┐         ┌─────────────────────────┐
│    S3 Static Hosting    │         │      API Gateway        │
│  • React Frontend       │         │  • REST API             │
│  • HTML/CSS/JS          │         │  • CORS enabled         │
│  • Images/Assets        │         │  • Rate limiting        │
└─────────────────────────┘         └─────────────────────────┘
                                                ↓
                              ┌─────────────────────────────────┐
                              │      Lambda Functions           │
                              │  • API Handler (30s timeout)    │
                              │  • Orchestrator (15min timeout) │
                              │  • Job Processor                │
                              └─────────────────────────────────┘
                                      ↓       ↓        ↓
                    ┌─────────────────┼───────┼────────┼─────┐
                    ↓                 ↓       ↓        ↓     ↓
        ┌───────────────┐  ┌──────────────┐  │  ┌─────────────────┐
        │   DynamoDB    │  │   S3 Bucket  │  │  │ Secrets Manager │
        │  • Workflows  │  │  • Renders   │  │  │  • API Keys     │
        │  • Sessions   │  │  • CAD Files │  │  │  • Credentials  │
        └───────────────┘  └──────────────┘  │  └─────────────────┘
                                              ↓
                                    ┌────────────────┐
                                    │  CloudWatch    │
                                    │  • Logs        │
                                    │  • Metrics     │
                                    │  • Alarms      │
                                    └────────────────┘
```

## Prerequisites

### 1. AWS Account Setup

```bash
# Create AWS account
# Visit: https://aws.amazon.com/

# Enable billing alerts
# Visit: AWS Console > Billing > Preferences > Enable billing alerts

# Set up MFA for root account (IMPORTANT!)
# Visit: AWS Console > IAM > Users > root > Security credentials
```

### 2. Install AWS CLI

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Windows
msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi

# Verify installation
aws --version
```

### 3. Configure AWS Credentials

```bash
# Create IAM user with permissions
# Visit: AWS Console > IAM > Users > Add user
# Permissions: AdministratorAccess (for deployment)

# Configure credentials
aws configure

# Enter:
# AWS Access Key ID: YOUR_ACCESS_KEY
# AWS Secret Access Key: YOUR_SECRET_KEY
# Default region: us-east-1
# Default output format: json

# Test credentials
aws sts get-caller-identity
```

### 4. Install Serverless Framework

```bash
npm install -g serverless

# Verify installation
serverless --version
```

### 5. Install Dependencies

```bash
cd /home/user/archdiscv1

# Backend dependencies
cd backend
npm install

# Frontend dependencies
cd ../frontend
npm install

# Return to root
cd ..
```

## Deployment Steps

### Step 1: Store API Keys Securely

```bash
# Store LLM API keys in AWS Systems Manager Parameter Store
# These are encrypted and securely accessed by Lambda

# Anthropic (Claude)
aws ssm put-parameter \
  --name "/archdisc/dev/anthropic-key" \
  --value "sk-ant-api03-xxxxx" \
  --type "SecureString" \
  --description "Anthropic API key for Claude"

# OpenAI
aws ssm put-parameter \
  --name "/archdisc/dev/openai-key" \
  --value "sk-xxxxx" \
  --type "SecureString" \
  --description "OpenAI API key"

# Google Gemini
aws ssm put-parameter \
  --name "/archdisc/dev/google-key" \
  --value "xxxxx" \
  --type "SecureString" \
  --description "Google Gemini API key"

# Verify
aws ssm get-parameter --name "/archdisc/dev/anthropic-key" --with-decryption
```

### Step 2: Build Frontend

```bash
cd frontend

# Install dependencies
npm install

# Build for production
npm run build

# Verify build
ls -la build/

cd ..
```

### Step 3: Deploy to AWS

```bash
# Deploy everything with one command
./deploy.sh dev

# Or manually:
serverless deploy --stage dev --verbose

# For production:
./deploy.sh prod
```

### Step 4: Sync Frontend to S3

```bash
# Serverless automatically syncs frontend
# Or manually:
aws s3 sync frontend/build/ s3://archdisc-frontend-dev/ --delete

# Invalidate CloudFront cache
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name archdisc-cad-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"
```

### Step 5: Verify Deployment

```bash
# Get CloudFront URL
serverless info --stage dev

# Test health endpoint
curl https://YOUR_CLOUDFRONT_URL/api/health

# Expected response:
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-01-05T...",
  "environment": "dev"
}

# Test LLM integration
curl -X POST https://YOUR_CLOUDFRONT_URL/api/mechanical/llm/test \
  -H "Content-Type: application/json" \
  -d '{"provider": "claude", "prompt": "Hello"}'
```

## Cost Estimation

### Development Environment (Low Traffic)

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Lambda | 1M requests, 512MB, 1s avg | $0.20 |
| API Gateway | 1M requests | $3.50 |
| CloudFront | 10GB transfer | $0.85 |
| S3 (Frontend) | 1GB storage, 10K requests | $0.05 |
| S3 (Renders) | 10GB storage, 100K requests | $0.30 |
| DynamoDB | On-demand, 100K writes | $1.25 |
| CloudWatch | 5GB logs | $2.50 |
| **Total** | | **~$8.65/month** |

### Production Environment (Medium Traffic)

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Lambda | 100M requests, 1GB, 2s avg | $400 |
| API Gateway | 100M requests | $350 |
| CloudFront | 1TB transfer | $85 |
| S3 (Frontend) | 10GB storage, 1M requests | $0.50 |
| S3 (Renders) | 100GB storage, 10M requests | $30 |
| DynamoDB | On-demand, 10M writes | $125 |
| CloudWatch | 50GB logs | $25 |
| **Total** | | **~$1,015/month** |

### High Traffic / Enterprise

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Lambda | 1B requests, 2GB, 3s avg | $8,000 |
| API Gateway | 1B requests | $3,500 |
| CloudFront | 10TB transfer | $850 |
| S3 | 1TB storage, 100M requests | $300 |
| DynamoDB | Provisioned, 100M writes | $1,250 |
| RDS (if using) | db.r5.xlarge | $800 |
| ElastiCache | cache.r5.large | $300 |
| **Total** | | **~$15,000/month** |

## Cost Optimization Tips

### 1. Lambda Optimization

```javascript
// Use Lambda layers for dependencies
// Reduce cold starts
// Optimize memory allocation

// Example: Use arm64 architecture (20% cheaper)
// In serverless.yml:
provider:
  architecture: arm64  // vs x86_64
```

### 2. CloudFront Caching

```yaml
# Aggressive caching for static assets
DefaultCacheBehavior:
  MinTTL: 0
  DefaultTTL: 86400    # 24 hours
  MaxTTL: 31536000     # 1 year
```

### 3. S3 Lifecycle Policies

```bash
# Auto-delete old renders after 30 days
aws s3api put-bucket-lifecycle-configuration \
  --bucket archdisc-renders-dev \
  --lifecycle-configuration '{
    "Rules": [{
      "Id": "DeleteOldRenders",
      "Status": "Enabled",
      "Expiration": {"Days": 30}
    }]
  }'
```

### 4. DynamoDB Auto-Scaling

```yaml
# In serverless.yml
resources:
  Resources:
    WorkflowsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        BillingMode: PAY_PER_REQUEST  # Auto-scales, pay per request
```

## Monitoring & Logging

### View Logs

```bash
# API logs
aws logs tail /aws/lambda/archdisc-cad-dev-api --follow

# Orchestration logs
aws logs tail /aws/lambda/archdisc-cad-dev-orchestrate --follow

# All logs
serverless logs -f api --tail --stage dev
```

### CloudWatch Metrics

```bash
# View in AWS Console
# CloudWatch > Dashboards > Create dashboard

# Key metrics to monitor:
# - Lambda Invocations
# - Lambda Duration
# - Lambda Errors
# - API Gateway 4xx/5xx errors
# - DynamoDB Read/Write Capacity
```

### Set Up Alarms

```bash
# Example: Alert on high error rate
aws cloudwatch put-metric-alarm \
  --alarm-name archdisc-high-errors \
  --alarm-description "Alert on high Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=archdisc-cad-dev-api
```

## Custom Domain Setup

### 1. Register Domain (Optional)

```bash
# Use Route 53 or external registrar
# Example: archdisc.com

# Create hosted zone in Route 53
aws route53 create-hosted-zone --name archdisc.com --caller-reference $(date +%s)
```

### 2. Request SSL Certificate

```bash
# Must be in us-east-1 for CloudFront
aws acm request-certificate \
  --domain-name archdisc.com \
  --subject-alternative-names *.archdisc.com \
  --validation-method DNS \
  --region us-east-1

# Follow email/DNS validation steps
```

### 3. Update CloudFront

```yaml
# In serverless.yml
CloudFrontDistribution:
  Properties:
    DistributionConfig:
      Aliases:
        - archdisc.com
        - www.archdisc.com
      ViewerCertificate:
        AcmCertificateArn: arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID
        MinimumProtocolVersion: TLSv1.2_2021
        SslSupportMethod: sni-only
```

### 4. Create DNS Records

```bash
# Point domain to CloudFront
aws route53 change-resource-record-sets \
  --hosted-zone-id ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "archdisc.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z2FDTNDATAQYW2",
          "DNSName": "d123456.cloudfront.net",
          "EvaluateTargetHealth": false
        }
      }
    }]
  }'
```

## CI/CD Setup

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Install dependencies
        run: |
          npm install
          cd frontend && npm install
          cd ../backend && npm install

      - name: Build frontend
        run: cd frontend && npm run build

      - name: Deploy to AWS
        run: serverless deploy --stage prod
```

## Rollback

```bash
# List deployments
serverless deploy list --stage dev

# Rollback to previous version
serverless rollback --timestamp TIMESTAMP --stage dev

# Or rollback functions individually
serverless rollback function --function api --stage dev
```

## Troubleshooting

### Lambda Timeout

```yaml
# Increase timeout in serverless.yml
functions:
  orchestrate:
    timeout: 900  # 15 minutes max
```

### Out of Memory

```yaml
# Increase memory
functions:
  api:
    memorySize: 2048  # MB
```

### CORS Issues

```javascript
// Ensure all responses have CORS headers
headers: {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true
}
```

### Cold Starts

```yaml
# Use provisioned concurrency
functions:
  api:
    provisionedConcurrency: 2  # Keep 2 instances warm
```

## Security Best Practices

1. **Enable WAF** on CloudFront
2. **Use VPC** for sensitive operations
3. **Rotate API keys** regularly
4. **Enable CloudTrail** for audit logs
5. **Use least privilege** IAM roles
6. **Enable encryption** at rest and in transit
7. **Set up** security scanning (GuardDuty)
8. **Implement** rate limiting

## Migration from Vercel

```bash
# 1. Export Vercel environment variables
vercel env pull .env.vercel

# 2. Import to AWS SSM
# (manual process, see Step 1 above)

# 3. Update DNS
# Point domain from Vercel to CloudFront

# 4. Test thoroughly
# Parallel run both for safety

# 5. Switch traffic
# Update DNS A record

# 6. Monitor
# Check CloudWatch for errors

# 7. Decommission Vercel
# Cancel Vercel subscription
```

## Conclusion

AWS deployment provides:
- ✅ More control and flexibility
- ✅ Better scalability
- ✅ Cost optimization at scale
- ✅ Enterprise-grade security
- ✅ Global CDN with CloudFront
- ✅ Serverless architecture (pay per use)

For production, recommended architecture:
- CloudFront + S3 for frontend
- Lambda + API Gateway for backend
- DynamoDB for data
- S3 for file storage
- Secrets Manager for credentials
- CloudWatch for monitoring

Estimated cost: $8-15/month for dev, $1000-15000/month for production depending on traffic.
