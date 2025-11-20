# Critical Deployment Configuration - ArchDisc AI Pipeline

> **Last Updated:** 2025-11-19 - All serverless filesystem fixes applied (commit 7371ea6)

## ⚠️ DEFCON 1: Backend API Not Working - Here's Why & How to Fix

### Problem Diagnosis
The 404 errors and "Processing modelData" loop indicate the backend API isn't deployed or responding. Your vercel.json was missing critical configuration for AI generation timeouts.

---

## 🚨 CRITICAL CHANGES MADE TO vercel.json

### What Changed:
```json
{
  "builds": [
    {
      "src": "backend/server.js",
      "use": "@vercel/node",
      "config": {
        "maxDuration": 60  // ⭐ ADDED - AI generation needs time
      }
    }
  ],
  "functions": {
    "backend/server.js": {
      "maxDuration": 60  // ⭐ ADDED - Prevents timeout during Gemini API calls
    }
  }
}
```

### Why This Matters:
- **Default Vercel timeout**: 10 seconds (hobby plan) / 60 seconds (pro)
- **AI generation time**: 15-60 seconds for complex prompts
- **Without maxDuration**: Backend kills the request mid-generation → 404 or empty response

---

## 📋 MANDATORY DEPLOYMENT CHECKLIST

### Step 1: Verify vercel.json (✅ DONE)
- [x] Added `maxDuration: 60` to backend build config
- [x] Added `functions` section for serverless function timeout
- [x] Routes configured: `/api/*` → backend, `/*` → frontend

### Step 2: Deploy to Vercel

**Option A: Vercel CLI (Recommended)**
```bash
# Install Vercel CLI if not installed
npm i -g vercel

# Navigate to project root
cd /path/to/archdiscv1

# Login to Vercel
vercel login

# Deploy to production
vercel --prod

# Follow prompts:
# - Link to existing project or create new
# - Set project name: archdiscv1
# - Framework preset: Other
# - Build command: leave blank (vercel.json handles it)
# - Output directory: leave blank
```

**Option B: GitHub Integration (Automatic)**
1. Push this branch to GitHub
2. Go to vercel.com
3. Import GitHub repository
4. Vercel will auto-deploy on push

### Step 3: Set Environment Variables in Vercel Dashboard

**CRITICAL - Without these, API returns 404 or fails:**

1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add these variables for **Production, Preview, Development**:

```bash
# REQUIRED - Core AI
GEMINI_API_KEY=AIzaSy...your_actual_key_here
GEMINI_MODEL=gemini-2.5-pro

# REQUIRED - CORS
ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app

# OPTIONAL - Enhanced features
MAPBOX_ACCESS_TOKEN=pk.eyJ1...your_token (optional but recommended)
SKETCHFAB_API_TOKEN=your_token (optional)
MAPILLARY_CLIENT_ID=your_id (optional)

# OPTIONAL - Free APIs (enable by default)
ENABLE_ORCHESTRATOR=true
ENABLE_WIKIPEDIA=true
ENABLE_WIKIDATA=true
ENABLE_OVERPASS=true
ENABLE_OPEN_ELEVATION=true
ENABLE_OPEN_METEO=true
ENABLE_TREE_MAP=true
ENABLE_WIKIMEDIA=true

# OPTIONAL - API Configuration
API_TIMEOUT_MS=10000
MAX_PARALLEL_REQUESTS=10
CACHE_TTL_SECONDS=3600
```

5. Click **Save** for each variable
6. **Redeploy** the project (required for env vars to take effect)

### Step 4: Verify Deployment

**Test Backend API:**
```bash
# Replace with your actual Vercel URL
curl https://archdiscv1.vercel.app/api/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2025-11-19T06:20:00.000Z",
  "environment": "production"
}
```

**Test Generate Endpoint:**
```bash
curl -X POST https://archdiscv1.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"red cube"}'

# Expected response:
{
  "success": true,
  "jobId": "job_abc123",
  "status": "queued",
  "message": "Generation job created"
}
```

**Test Job Status:**
```bash
curl https://archdiscv1.vercel.app/api/generate/job_abc123

# Expected response:
{
  "success": true,
  "job": {
    "status": "completed",
    "design": { ... },
    "modelData": { ... }
  }
}
```

---

## 🔍 Troubleshooting

### Issue: Still getting 404 after deployment

**Check 1: Backend deployed correctly?**
```bash
vercel ls
# Should show your project with backend function
```

**Check 2: Routes working?**
- Visit: `https://your-app.vercel.app/api/health`
- If 404: Backend didn't deploy or routes misconfigured
- If 500: Backend deployed but crashing (check logs)

**Check 3: View backend logs**
```bash
vercel logs your-deployment-url
# or go to Vercel dashboard → Deployments → View Function Logs
```

Common errors in logs:
- `GEMINI_API_KEY is not defined` → Set environment variable
- `Module not found` → Dependencies not installed
- `Request timeout` → Increase maxDuration (already done)

### Issue: "Processing modelData" infinite loop

**Root Cause:** Backend returning invalid data structure

**Check backend response:**
```bash
curl https://your-app.vercel.app/api/generate/job_id
```

**Expected structure:**
```json
{
  "success": true,
  "job": {
    "status": "completed",
    "design": {
      "specifications": { ... }
    },
    "modelData": {
      "geometry": { ... },
      "materials": [ ... ]
    }
  }
}
```

**If missing fields:** Backend AI generation failed
- Check `GEMINI_API_KEY` is set correctly
- Check backend logs for Gemini API errors
- Verify API key has necessary permissions

### Issue: Works locally but not on Vercel

**Reason:** Environment variables not set in Vercel

**Fix:**
1. Verify all env vars are set in Vercel dashboard
2. Make sure they're set for **Production** environment
3. **Redeploy** after adding env vars (critical!)

---

## 🎯 Post-Deployment Validation

### Frontend Should Show:
```
Browser Console:
- "Starting generation job with prompt: red cube"
- "Generation job started, jobId: job_xyz"
- "Generation progress: { status: 'analyzing', progress: 0.1 }"
- "Generation progress: { status: 'complete', progress: 1.0 }"
```

### Backend Logs Should Show:
```
Vercel Function Logs:
========================================
🤖 AI SERVICE: PROCESSING PROMPT
========================================
📝 Prompt: red cube
🔧 APIs Available:
   ✓ Gemini: true
========================================
🔍 Attempting taxonomy-aware analysis...
✅ Taxonomy analysis successful
```

### Canvas Should Display:
- 3D red cube rendered in the scene
- NO "Processing modelData" loop
- NO 404 errors in Network tab

---

## 📊 Deployment Status Checklist

After following all steps above, verify:

- [ ] vercel.json updated with maxDuration (✅ done in this commit)
- [ ] Project deployed to Vercel (`vercel --prod`)
- [ ] `GEMINI_API_KEY` set in Vercel environment variables
- [ ] `ALLOWED_ORIGINS` includes your frontend domain
- [ ] Backend `/api/health` endpoint returns 200 OK
- [ ] Backend `/api/generate` endpoint accepts POST requests
- [ ] Frontend successfully creates generation jobs
- [ ] 3D models render on canvas
- [ ] NO 404 errors
- [ ] NO infinite "Processing modelData" loops

---

## 🚀 Next Steps After Deployment

Once backend is working:

1. **Test simple prompt**: "red cube"
   - Should work immediately
   - Verifies basic API pipeline

2. **Test AI prompt**: "modern house"
   - Uses Gemini AI analysis
   - Verifies GEMINI_API_KEY works

3. **Test complex prompt**: "recreate downtown manhattan"
   - Uses full AI pipeline
   - Verifies taxonomy system
   - Should generate detailed urban environment

4. **Monitor logs**: Check Vercel function logs for any errors

5. **Optimize**: Once working, consider:
   - Upgrade to Vercel Pro for longer timeouts
   - Add Redis caching for API responses
   - Enable all optional APIs (Mapbox, Sketchfab)

---

## ⚡ Summary

**Code changes:** ✅ COMPLETE - All prompts route through AI pipeline
**vercel.json:** ✅ UPDATED - Added maxDuration for AI generation
**Deployment:** ⏳ PENDING - You need to deploy and set env vars

**The fix is ready. Deploy now to make it work!**

Deploy command:
```bash
vercel --prod
```

Then set `GEMINI_API_KEY` in Vercel dashboard and redeploy.
