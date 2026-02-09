# 🚀 Quick Start: Auto-Deploy to AWS via GitHub

## ⚡ 3-Minute Setup

### Step 1: Add AWS Credentials to GitHub (2 minutes)

1. **Go to:** https://github.com/satvikOS/archdiscv1/settings/secrets/actions

2. **Click:** `New repository secret`

3. **Add these 2 secrets:**

   **Secret 1:**
   ```
   Name:  AWS_ACCESS_KEY_ID
   Value: 
   ```
   Click `Add secret`

   **Secret 2:**
   ```
   Name:  AWS_SECRET_ACCESS_KEY
   Value: 
   ```
   Click `Add secret`

### Step 2: Trigger Deployment (1 minute)

**Option A - Push this branch:**
```bash
# The workflow is already set up!
# Just push the branch you're on:
git push origin claude/fix-topbar-layout-e5ZKk
```

**Option B - Manual trigger:**
1. Go to: https://github.com/satvikOS/archdiscv1/actions
2. Click `Deploy to AWS` workflow
3. Click `Run workflow` → Select branch → `Run workflow`

### Step 3: Watch Deployment (5-10 minutes)

1. **Go to:** https://github.com/satvikOS/archdiscv1/actions
2. **Click** on the running workflow
3. **Watch** the deployment logs in real-time

### Step 4: Get Your URL

After deployment completes:
- Check the **commit comment** for your CloudFront URL
- Or check the **Actions log** output
- Test: `curl https://YOUR_URL/api/health`

---

## 🎯 That's It!

Now every time you push code, it automatically deploys to AWS!

### Optional: Add LLM API Keys

For autonomous CAD features, add these optional secrets:

```
ANTHROPIC_API_KEY  = your_anthropic_key
OPENAI_API_KEY     = your_openai_key
GOOGLE_API_KEY     = your_google_key
```

---

## 📖 Full Documentation

- Detailed setup: `.github/DEPLOYMENT_SETUP.md`
- AWS architecture: `docs/AWS_DEPLOYMENT.md`
- Troubleshooting: `.github/DEPLOYMENT_SETUP.md#troubleshooting`

---

## 💰 Cost

- **Development:** $8-15/month
- **Production:** $100-500/month

---

## ✅ What Gets Deployed

- ✅ React frontend → CloudFront CDN (global)
- ✅ Node.js backend → Lambda functions
- ✅ API Gateway → REST API
- ✅ DynamoDB → Workflow storage
- ✅ S3 → File storage

---

**Questions?** Check `.github/DEPLOYMENT_SETUP.md`

**Ready to deploy?** Add the 2 GitHub secrets above! 🚀
