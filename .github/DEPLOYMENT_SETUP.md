# GitHub Actions AWS Deployment Setup

This guide explains how to set up automatic deployment from GitHub to AWS using GitHub Actions.

## 🎯 Overview

Every time you push code to the `main` or `claude/fix-topbar-layout-e5ZKk` branch, GitHub Actions will automatically:
1. Build the frontend
2. Package the backend
3. Deploy to AWS (CloudFront, Lambda, S3, DynamoDB, API Gateway)
4. Comment the deployment URL on your commit

## 📋 Prerequisites

- GitHub repository: `satvikOS/archdiscv1`
- AWS Account with IAM user credentials
- IAM user with deployment permissions (see below)

## 🔐 Step 1: Set Up GitHub Secrets

You need to add your AWS credentials as GitHub Secrets so the workflow can deploy to AWS.

### How to Add Secrets:

1. **Go to your GitHub repository:**
   ```
   https://github.com/satvikOS/archdiscv1
   ```

2. **Navigate to Settings:**
   - Click `Settings` tab (top right)
   - In the left sidebar, click `Secrets and variables` → `Actions`

3. **Add the following secrets:**

   Click `New repository secret` for each:

   **Required Secrets:**

   | Secret Name | Value | Description |
   |-------------|-------|-------------|
   | `AWS_ACCESS_KEY_ID` | `AKIAQJITMSWQQJXLT55Y` | Your AWS Access Key ID |
   | `AWS_SECRET_ACCESS_KEY` | `A0wpLPTwXZLCPUUgoAGkh05x+AO6n84yTrGtTMCp` | Your AWS Secret Access Key |

   **Optional Secrets (for LLM features):**

   | Secret Name | Value | Description |
   |-------------|-------|-------------|
   | `ANTHROPIC_API_KEY` | Your Anthropic key | For Claude AI features |
   | `OPENAI_API_KEY` | Your OpenAI key | For GPT-4 features |
   | `GOOGLE_API_KEY` | Your Google key | For Gemini features (optional) |

4. **Save each secret** by clicking `Add secret`

## ✅ Step 2: Verify IAM Permissions

Your AWS IAM user (`archdisc-deployer`) should have these permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "lambda:*",
                "apigateway:*",
                "cloudfront:*",
                "s3:*",
                "dynamodb:*",
                "cloudformation:*",
                "cloudwatch:*",
                "logs:*",
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRole",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "sqs:*"
            ],
            "Resource": "*"
        }
    ]
}
```

## 🚀 Step 3: Trigger Deployment

Once secrets are configured, deployment happens automatically:

### Automatic Deployment (on push):
```bash
git add .
git commit -m "Your changes"
git push origin claude/fix-topbar-layout-e5ZKk
```

GitHub Actions will automatically:
- Build and deploy
- Post deployment URL as a comment on your commit

### Manual Deployment (workflow_dispatch):
1. Go to `Actions` tab in GitHub
2. Click `Deploy to AWS` workflow
3. Click `Run workflow` button
4. Select branch and click `Run workflow`

## 📊 Step 4: Monitor Deployment

### View Deployment Progress:
1. Go to `Actions` tab in your GitHub repo
2. Click on the running workflow
3. Watch real-time logs

### Deployment takes approximately:
- First deployment: **5-10 minutes** (creating all resources)
- Subsequent deployments: **2-5 minutes** (updating resources)

### Success Indicators:
- ✅ Green checkmark on commit
- 💬 Comment on commit with deployment URL
- 🌐 Application live at CloudFront URL

## 🔍 Step 5: Access Your Deployed Application

After successful deployment:

1. **Check the commit comment** for your CloudFront URL
2. **Or check Actions logs** for the deployment URL
3. **Or check AWS Console:**
   - Go to CloudFormation
   - Find stack: `archdisc-cad-dev`
   - Check Outputs tab for URLs

### Test Your Deployment:
```bash
# Health check
curl https://YOUR_CLOUDFRONT_URL/api/health

# Expected response:
# {"success":true,"status":"healthy","timestamp":"..."}
```

## 🛠️ Troubleshooting

### Deployment Fails with "Forbidden" or "Access Denied"

**Solution:** Check IAM permissions
```bash
# Verify credentials work:
aws sts get-caller-identity

# Should show:
# {
#     "UserId": "...",
#     "Account": "...",
#     "Arn": "arn:aws:iam::...:user/archdisc-deployer"
# }
```

### Deployment Fails with "Stack Already Exists"

**Solution:** Update instead of create
```bash
# This is normal for subsequent deployments
# Serverless will automatically update the existing stack
```

### Secrets Not Working

**Solution:** Double-check secret names (case-sensitive)
- `AWS_ACCESS_KEY_ID` (not `aws_access_key_id`)
- `AWS_SECRET_ACCESS_KEY` (not `aws_secret_access_key`)

### Build Fails

**Solution:** Check the Actions logs
1. Go to Actions tab
2. Click on failed workflow
3. Expand failed step
4. Read error message

## 📱 Notifications

### Get Notified of Deployments:

1. **Email notifications:**
   - Go to GitHub Settings → Notifications
   - Enable "Actions" notifications

2. **Slack/Discord webhooks:**
   - Add webhook URL to GitHub secrets
   - Modify workflow to send notifications

## 🔄 Updating the Deployment

### To deploy changes:
1. Make your code changes
2. Commit and push to the branch
3. GitHub Actions automatically deploys

### To change deployment settings:
- Edit `.github/workflows/deploy-aws.yml`
- Edit `serverless.yml` for AWS resources
- Changes deploy automatically on next push

## 🗑️ Cleaning Up (Destroy Resources)

### To remove all AWS resources:

**Option 1: Via GitHub Actions** (Add this workflow step if needed)
```bash
npx serverless remove --stage dev
```

**Option 2: Via AWS Console**
1. Go to CloudFormation
2. Select `archdisc-cad-dev` stack
3. Click Delete

**Option 3: Locally**
```bash
git clone https://github.com/satvikOS/archdiscv1.git
cd archdiscv1
npm install
npx serverless remove --stage dev
```

## 📈 Cost Monitoring

### Expected Costs:
- **Development** (low traffic): $8-15/month
- **Production** (moderate traffic): $100-500/month
- **Production** (high traffic): $500-2000/month

### Monitor Costs:
1. AWS Console → Billing Dashboard
2. Set up billing alerts
3. CloudWatch metrics for usage

## 🎉 Next Steps

After successful deployment:

1. **Set up custom domain** (optional)
   - Route 53 + ACM certificate
   - Point to CloudFront distribution

2. **Add monitoring** (optional)
   - CloudWatch dashboards
   - AWS X-Ray tracing
   - Error alerting

3. **Set up staging environment** (optional)
   ```yaml
   # In workflow, add:
   branches:
     - main  # production
     - develop  # staging
   ```

4. **Add LLM API keys** for autonomous CAD features
   - Add secrets to GitHub
   - Redeploy automatically

## 📚 Additional Resources

- [Serverless Framework Docs](https://www.serverless.com/framework/docs)
- [AWS Lambda Docs](https://docs.aws.amazon.com/lambda/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [CloudFront Docs](https://docs.aws.amazon.com/cloudfront/)

---

**Questions?** Check the main deployment guide: `docs/AWS_DEPLOYMENT.md`
