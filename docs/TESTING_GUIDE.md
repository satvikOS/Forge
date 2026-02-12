# Complete Testing & Deployment Guide

## 🎯 System Overview

You now have a **fully autonomous CAD generation system** with:

### **Tech Stack**
```
Frontend: React + Vite → CloudFront
    ↓
API Gateway → Lambda (Node.js 18.x)
    ↓
Backend Services:
├── AWS Bedrock Claude Sonnet 4.5 (LLM)
├── Google Gemini 2.5 Pro (Vision)
├── Playwright (Browser Automation)
└── Job Queue (Async Processing)
```

### **Two Autonomous Agents**

1. **Basic Agent** (`/api/mechanical/autonomous`)
   - Pure API-based generation
   - Fast execution (~2-3 min)
   - AWS Bedrock Claude 4.5
   - ~$0.10 per design

2. **UI-Controlled Agent** (`/api/mechanical/autonomous/ui-control`)
   - Browser automation
   - Visual validation with Gemini
   - Full UI control (~5-10 min)
   - ~$0.35 per design

---

## 📋 Pre-Deployment Checklist

### ✅ Required GitHub Secrets

Go to: https://github.com/satvikOS/archdiscv1/settings/secrets/actions

**Verify these secrets exist:**
- [x] `AWS_ACCESS_KEY_ID` (Already configured)
- [x] `AWS_SECRET_ACCESS_KEY` (Already configured)
- [ ] `GOOGLE_API_KEY` ← **ADD THIS NOW**

**Add Google API Key:**
```
Name: GOOGLE_API_KEY
Value: your_google_api_key_here
```

---

## 🚀 Deployment Monitoring

### 1. Check GitHub Actions

Visit: https://github.com/satvikOS/archdiscv1/actions

**Expected workflow:**
```
✓ Checkout code
✓ Setup Node.js 18
✓ Install frontend dependencies
✓ Build frontend (with VITE_API_BASE_URL)
✓ Install backend dependencies
✓ Deploy to AWS with Serverless
✓ Upload frontend to S3
✓ Invalidate CloudFront cache
```

**Estimated time:** 5-10 minutes

### 2. Monitor Logs

Look for these key indicators in the workflow logs:

```bash
# Successful frontend build
✅ Frontend built successfully

# Successful backend deployment
✅ Service deployed to stack archdisc-cad-dev

# Successful S3 upload
✅ Frontend uploaded to S3

# Successful CloudFront invalidation
✅ CloudFront cache invalidated
```

---

## 🧪 Testing Guide

### Phase 1: Infrastructure Tests (After Deployment)

#### Test 1: Health Check
```bash
curl https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/health
```

**Expected Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-01-05T...",
  "environment": "dev",
  "region": "us-east-1",
  "node_version": "v18.20.8",
  "bedrock_configured": true
}
```

**If fails:** Check AWS Lambda logs in CloudWatch

---

#### Test 2: API Test Endpoint
```bash
curl https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/test
```

**Expected Response:**
```json
{
  "success": true,
  "message": "ArchDisc API is working!",
  "version": "2.0.0",
  "features": ["autonomous_ai_agent", "bedrock_integration", "job_queue"],
  "endpoints": [
    "/api/health",
    "/api/test",
    "/api/mechanical/autonomous - FULLY AUTONOMOUS AI AGENT (Bedrock)",
    "/api/mechanical/autonomous/ui-control - UI CONTROLLED (Claude 4.5 + Gemini Vision + Playwright)",
    ...
  ]
}
```

---

#### Test 3: Frontend Access
```bash
# Visit in browser:
https://d3a7j7euh4gge.cloudfront.net
```

**Expected:**
- ✅ Page loads successfully
- ✅ No console errors
- ✅ UI is interactive
- ✅ Buttons and tools visible

**If shows "Access Denied":**
- Wait 5-10 minutes for CloudFront invalidation
- Check S3 bucket has files: `aws s3 ls s3://archdisc-frontend-dev/`

---

### Phase 2: Basic Autonomous Agent Tests

#### Test 4: Simple Design Generation
```bash
curl -X POST https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/autonomous \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Design a simple rectangular bracket with 4 mounting holes",
    "options": {"quality": "standard"}
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "jobId": "job_abc123_xyz",
  "status": "queued",
  "mode": "autonomous",
  "message": "Autonomous AI agent activated - will plan and execute autonomously",
  "pollUrl": "/api/mechanical/generate/job_abc123_xyz",
  "info": "The agent will think, plan, execute, verify, and refine autonomously with minimal intervention"
}
```

**Save the jobId!** You'll need it to poll for results.

---

#### Test 5: Poll Job Status
```bash
# Replace job_abc123_xyz with your actual jobId
curl https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/generate/job_abc123_xyz
```

**While Processing:**
```json
{
  "success": true,
  "jobId": "job_abc123_xyz",
  "status": "processing",
  "progress": 45,
  "stages": {
    "analyzing": {"status": "completed", "progress": 100},
    "generating": {"status": "in_progress", "progress": 45},
    "refining": {"status": "pending", "progress": 0},
    "exporting": {"status": "pending", "progress": 0}
  },
  "mode": "autonomous",
  "agentStatus": "executing autonomously"
}
```

**When Complete:**
```json
{
  "success": true,
  "jobId": "job_abc123_xyz",
  "status": "completed",
  "progress": 100,
  "result": {
    "design": { ... },
    "autonomous": true,
    "agentProcess": {
      "iterations": 12,
      "decisions": [...],
      "selfCorrections": [...],
      "mode": "fully_autonomous"
    },
    "metadata": {
      "prompt": "Design a simple rectangular bracket...",
      "generatedAt": "2026-01-05T..."
    }
  }
}
```

**Poll every 5-10 seconds until status is "completed" or "failed"**

---

### Phase 3: UI-Controlled Agent Tests (Requires GOOGLE_API_KEY)

#### Test 6: UI-Controlled Generation
```bash
curl -X POST https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/autonomous/ui-control \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Design a simple table with 4 legs",
    "options": {"quality": "high"}
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "jobId": "job_def456_uvw",
  "status": "queued",
  "mode": "ui_control",
  "message": "UI-controlled autonomous agent activated",
  "pollUrl": "/api/mechanical/generate/job_def456_uvw",
  "info": "Agent will control browser, click buttons, validate with vision",
  "features": ["claude_sonnet_4.5", "gemini_vision", "playwright_automation"]
}
```

#### Test 7: Monitor UI-Controlled Job
```bash
curl https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/generate/job_def456_uvw
```

**Look for these agent statuses:**
```json
"agentStatus": "initializing browser"
"agentStatus": "analyzing requirements"
"agentStatus": "executing with UI control"
"agentStatus": "validating with vision"
```

**When Complete:**
```json
{
  "result": {
    "design": { ... },
    "validation": {
      "valid": true,
      "issues": [],
      "strengths": ["Good proportions", "Stable structure"]
    },
    "autonomous": true,
    "uiControlled": true,
    "process": {
      "requirements": { ... },
      "plan": {"steps": [...]},
      "actions": [
        {"step": 1, "action": "click_tool", "success": true},
        {"step": 2, "action": "select_sketch_tool", "success": true}
      ],
      "screenshots": 15,
      "errors": []
    },
    "metadata": {
      "llm": "claude-sonnet-4-5",
      "vision": "gemini-2.5-pro",
      "automation": "playwright"
    }
  }
}
```

---

### Phase 4: Additional Endpoints

#### Test 8: Design Variants
```bash
curl -X POST https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/generate/variants \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Modern office chair",
    "options": {"count": 3}
  }'
```

#### Test 9: Materials Search
```bash
curl https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/materials/search?q=steel
```

#### Test 10: Design Analysis
```bash
curl -X POST https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/mechanical/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "design": {"type": "bracket", "material": "aluminum"}
  }'
```

---

## 🐛 Troubleshooting

### Issue 1: "Missing Authentication Token"

**Symptom:**
```json
{"message": "Missing Authentication Token"}
```

**Cause:** Accessing `/dev` instead of `/dev/api/health`

**Fix:** Always include `/api/` in the path
```bash
# ❌ Wrong
https://.../dev

# ✅ Correct
https://.../dev/api/health
```

---

### Issue 2: "Internal server error"

**Symptom:**
```json
{"message": "Internal server error"}
```

**Debug Steps:**
1. Check CloudWatch Logs:
   ```bash
   npx serverless logs -f api --stage dev --tail
   ```

2. Look for error stack traces

3. Common causes:
   - Missing dependencies
   - Syntax errors in code
   - Environment variables not set
   - AWS permissions issues

---

### Issue 3: "Agent not configured"

**Symptom:**
```json
{"error": "Agent not configured - please set ANTHROPIC_API_KEY"}
```

**Fix:** This is outdated error message. Agent uses Bedrock now. If you see this:
1. Redeploy to get latest code
2. Check AWS credentials are configured

---

### Issue 4: Gemini Vision errors

**Symptom:**
```
"Gemini Vision not configured"
```

**Fix:**
1. Add `GOOGLE_API_KEY` to GitHub Secrets
2. Redeploy
3. Verify in health endpoint: `gemini_configured: true`

---

### Issue 5: Job stuck in "processing"

**Symptoms:**
- Progress doesn't increase
- Job runs for >15 minutes

**Debug:**
1. Check CloudWatch logs for Lambda timeout
2. Lambda has 30-second timeout by default
3. For long-running jobs, consider:
   - Breaking into smaller steps
   - Using Step Functions
   - Increasing Lambda timeout

---

## 📊 Expected Performance

### Basic Autonomous Agent
- **Job creation:** < 1 second
- **Execution time:** 2-5 minutes
- **Cost per design:** ~$0.10

### UI-Controlled Agent
- **Browser init:** 5-10 seconds
- **Execution time:** 5-15 minutes
- **Screenshots:** 10-20 per design
- **Cost per design:** ~$0.35

### Frontend
- **Load time:** < 2 seconds (CloudFront cached)
- **First visit:** 3-5 seconds (uncached)
- **API latency:** 200-500ms

---

## 🎉 Success Criteria

Your deployment is successful when:

✅ **Infrastructure:**
- [ ] Health endpoint returns `"status": "healthy"`
- [ ] Test endpoint shows all features
- [ ] Frontend loads at CloudFront URL
- [ ] No console errors in browser

✅ **Basic Agent:**
- [ ] Can create jobs successfully
- [ ] Jobs complete within 5 minutes
- [ ] Returns valid design results
- [ ] Shows iterations and decisions

✅ **UI-Controlled Agent:**
- [ ] Browser initializes successfully
- [ ] Agent analyzes requirements
- [ ] Executes UI actions
- [ ] Gemini validates screenshots
- [ ] Returns design with validation

✅ **End-to-End:**
- [ ] Frontend buttons call backend
- [ ] User can submit prompts
- [ ] Can poll for job status
- [ ] Can view completed designs

---

## 📝 Next Steps After Testing

1. **Add Monitoring:**
   - Set up CloudWatch dashboards
   - Configure alerts for errors
   - Track API usage and costs

2. **Optimize Performance:**
   - Tune Lambda memory/timeout
   - Add caching for common requests
   - Optimize frontend bundle size

3. **Enhance Features:**
   - Add real-time progress updates (WebSocket)
   - Implement design history
   - Add user authentication
   - Create design gallery

4. **Production Readiness:**
   - Add rate limiting
   - Implement proper error handling
   - Set up staging environment
   - Add automated testing

---

## 🔗 Quick Reference

**Endpoints:**
- Frontend: https://d3a7j7euh4gge.cloudfront.net
- API: https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev
- Health: https://qmgj3s9wse.execute-api.us-east-1.amazonaws.com/dev/api/health

**GitHub:**
- Actions: https://github.com/satvikOS/archdiscv1/actions
- Secrets: https://github.com/satvikOS/archdiscv1/settings/secrets/actions

**AWS Console:**
- Lambda: https://console.aws.amazon.com/lambda/
- CloudWatch: https://console.aws.amazon.com/cloudwatch/
- S3: https://console.aws.amazon.com/s3/
- CloudFront: https://console.aws.amazon.com/cloudfront/

---

**Good luck with testing! The autonomous CAD agents are ready to build! 🚀**
