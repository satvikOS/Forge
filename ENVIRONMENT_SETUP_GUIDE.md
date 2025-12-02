# ArchDisc Environment Setup Guide

Complete guide for configuring environment variables across all phases of ArchDisc development.

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Phase-by-Phase Setup](#phase-by-phase-setup)
3. [API Key Acquisition](#api-key-acquisition)
4. [Vercel Deployment](#vercel-deployment)
5. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Minimum Configuration (Phase 1 - Multi-Variant Generation)

```env
# Core requirement - Get variants working
GEMINI_API_KEY=your_actual_key_here
```

**Result:** You'll see design variants but no actual 3D models yet.

### Full 3D Generation (Phase 3)

```env
# Core AI
GEMINI_API_KEY=your_actual_key_here

# 3D Generation (need at least ONE of these)
TRIPO_API_KEY=your_actual_key_here
# OR
MESHY_API_KEY=your_actual_key_here
```

**Result:** Complete text-to-3D pipeline operational.

### With Axel Engine (Phase 2 - Maximum Realism)

```env
# Core AI
GEMINI_API_KEY=your_actual_key_here

# 3D Generation
TRIPO_API_KEY=your_actual_key_here

# Axel Voxel Engine
AXEL_ENABLED=true
```

**Result:** Full pipeline with micron-level analysis and unprecedented realism.

---

## 📦 Phase-by-Phase Setup

### **Phase 1: Multi-Variant Generation** ✅

**What it does:** Generates multiple design variants from a single prompt (Photorealistic, Engineering Detail, Artistic Quality).

**Required:**
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

**Where to get:**
- Sign up at [Google AI Studio](https://makersuite.google.com/app/apikey)
- Free tier: 60 requests/minute

**What works:**
- ✅ Text prompt → Design specifications
- ✅ 3 variant descriptions generated
- ✅ Scene composition planning
- ❌ Actual 3D models (need Phase 3)

---

### **Phase 2: Axel 3D Voxel Engine** 🔬

**What it does:** Adds micron-level analysis to 3D models for unprecedented realism.

**Required:**
```env
AXEL_ENABLED=true
AXEL_RESOLUTION=adaptive
```

**Optional Fine-Tuning:**
```env
# Performance
AXEL_MAX_VOXELS=100000000
AXEL_TARGET_TIME=10000

# Disable specific analyzers if needed
AXEL_ENABLE_METROLOGY=true     # Geometry (±0.001mm accuracy)
AXEL_ENABLE_CHEMICAL=true      # Material composition
AXEL_ENABLE_FLAWS=true         # Age-based wear
AXEL_ENABLE_TOOLING=true       # Manufacturing marks
AXEL_ENABLE_ENVIRONMENT=true   # Location/weather
```

**What it adds:**
- ✅ Micron-level geometry analysis
- ✅ Exact material composition (e.g., wrought iron: Fe 99.4%, C 0.08%)
- ✅ Age-based weathering (0-200+ years)
- ✅ Period-correct tooling marks (ancient → contemporary)
- ✅ Environmental composition (lighting, atmosphere, climate)

**Performance:**
- Processing: 1-5 seconds per variant
- Memory: <500MB per variant
- No external API keys needed

---

### **Phase 3: Full 3D Generation** 🎨

**What it does:** Converts text prompts and design specs into actual 3D models.

**Required (at least ONE):**

#### Option A: Tripo AI (Recommended - Faster & Cheaper)
```env
TRIPO_API_KEY=your_tripo_key_here
```

**Get it from:** [https://www.tripo3d.ai/](https://www.tripo3d.ai/)

**Free tier:**
- 300 credits/month
- ~15-30 models/month
- Text-to-3D: 10 credits
- Image-to-3D: 20 credits

**Speed:** 2-5 minutes per model

#### Option B: Meshy AI (Premium - Higher Quality)
```env
MESHY_API_KEY=your_meshy_key_here
```

**Get it from:** [https://www.meshy.ai/](https://www.meshy.ai/)

**Free tier:**
- 200 credits/month
- ~7-10 models/month
- Text-to-3D: 20 credits
- Image-to-3D: 30 credits
- Includes PBR materials

**Speed:** 5-10 minutes per model

#### Option C: Both (Best Results)
```env
TRIPO_API_KEY=your_tripo_key_here
MESHY_API_KEY=your_meshy_key_here
```

System automatically selects best service based on prompt complexity and budget.

---

## 🔑 API Key Acquisition

### 1. Google Gemini (REQUIRED)

**URL:** https://makersuite.google.com/app/apikey

**Steps:**
1. Sign in with Google account
2. Click "Get API Key"
3. Create new project or select existing
4. Copy API key
5. Add to `.env` as `GEMINI_API_KEY`

**Cost:** FREE
- 60 requests/minute
- 1,500 requests/day

---

### 2. Tripo AI (RECOMMENDED for 3D)

**URL:** https://www.tripo3d.ai/

**Steps:**
1. Sign up with email or Google
2. Go to Dashboard → API Keys
3. Click "Create API Key"
4. Copy key
5. Add to `.env` as `TRIPO_API_KEY`

**Cost:** FREE tier then $0.05-$0.20/model
- 300 free credits/month
- Text-to-3D: 10 credits
- Image-to-3D: 20 credits

---

### 3. Meshy AI (OPTIONAL for higher quality)

**URL:** https://www.meshy.ai/

**Steps:**
1. Sign up with email or Google
2. Go to Settings → API
3. Generate new API key
4. Copy key
5. Add to `.env` as `MESHY_API_KEY`

**Cost:** FREE tier then $0.10-$0.30/model
- 200 free credits/month
- Text-to-3D: 20 credits
- Image-to-3D: 30 credits

---

### 4. Optional Enhancements

#### Sketchfab (3D Model References)
**URL:** https://sketchfab.com/settings/password

```env
SKETCHFAB_API_TOKEN=your_token_here
SKETCHFAB_ENABLED=true
```

#### Mapbox (Geographic Data)
**URL:** https://account.mapbox.com/access-tokens/

```env
MAPBOX_ACCESS_TOKEN=your_token_here
MAPBOX_ENABLED=true
```

#### Mapillary (Street-Level Imagery)
**URL:** https://www.mapillary.com/dashboard/developers

```env
MAPILLARY_CLIENT_ID=your_client_id_here
MAPILLARY_ENABLED=true
```

---

## 🚢 Vercel Deployment

### Step 1: Update `.env.example`

Add your frontend domain to ALLOWED_ORIGINS:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://your-app.vercel.app
```

### Step 2: Add Environment Variables in Vercel

1. Go to your Vercel project
2. Navigate to: **Settings** → **Environment Variables**
3. Add each variable:

**Required:**
```
GEMINI_API_KEY = your_actual_key_here
TRIPO_API_KEY = your_actual_key_here (or MESHY_API_KEY)
ALLOWED_ORIGINS = https://your-frontend.vercel.app
```

**Recommended:**
```
AXEL_ENABLED = true
NODE_ENV = production
```

### Step 3: Redeploy

```bash
git push
```

Vercel auto-deploys. Check logs for any errors.

---

## 🔧 Troubleshooting

### Issue: "No 3D models generating, only seeing variants"

**Cause:** Missing TRIPO_API_KEY or MESHY_API_KEY

**Fix:**
```env
# Add at least one:
TRIPO_API_KEY=your_key_here
# OR
MESHY_API_KEY=your_key_here
```

---

### Issue: "403 CORS Error in browser console"

**Cause:** Frontend domain not in ALLOWED_ORIGINS

**Fix:**
```env
# Add your Vercel frontend domain:
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.vercel.app
```

In Vercel, update the environment variable and redeploy.

---

### Issue: "Variants load but page keeps spinning"

**Causes:**
1. CORS blocking API calls (see above)
2. Missing 3D generation keys
3. Frontend polling timeout

**Fix:**
1. Check browser DevTools → Network tab for 403 errors
2. Verify TRIPO_API_KEY or MESHY_API_KEY is set
3. Check backend logs for errors

---

### Issue: "Axel engine not working"

**Cause:** Usually not the issue - check upstream first

**Fix:**
```env
# Temporarily disable to test:
AXEL_ENABLED=false
```

If 3D models still don't generate, problem is TRIPO/MESHY keys, not Axel.

Axel only adds analysis to EXISTING models - it doesn't generate them.

---

### Issue: "API rate limits exceeded"

**Cause:** Free tier limits reached

**Solutions:**
1. **Gemini (60/min):** Add delay between requests
2. **Tripo (300 credits/month):** 
   - Use Image-to-3D less (costs 2x Text-to-3D)
   - Upgrade to paid tier
3. **Meshy (200 credits/month):**
   - Mix with Tripo for better coverage
   - Upgrade to paid tier

---

## 📊 Cost Optimization

### Free Tier Monthly Budget

With free tiers only:
- **Gemini:** Unlimited (rate-limited)
- **Tripo:** 15-30 models
- **Meshy:** 7-10 models
- **Total:** ~25-40 models/month FREE

### Budget-Conscious Strategy

1. **Use Tripo primarily** (cheaper, faster)
2. **Use Meshy for hero models** (better quality)
3. **Enable caching** (avoid regenerating similar models):
   ```env
   ENABLE_MODEL_CACHE=true
   CACHE_SIMILARITY_THRESHOLD=0.85
   ```
4. **Set budget alerts:**
   ```env
   MAX_MONTHLY_BUDGET_USD=5
   ALERT_AT_BUDGET_PERCENT=75
   ```

---

## 🎯 Recommended Configurations

### Development (Local Testing)
```env
GEMINI_API_KEY=your_key
TRIPO_API_KEY=your_key
AXEL_ENABLED=true
NODE_ENV=development
```

### Production (Vercel)
```env
GEMINI_API_KEY=your_key
TRIPO_API_KEY=your_key
MESHY_API_KEY=your_key
AXEL_ENABLED=true
ALLOWED_ORIGINS=https://your-app.vercel.app
NODE_ENV=production
```

### Demo/Testing (No 3D Cost)
```env
GEMINI_API_KEY=your_key
# Don't set TRIPO/MESHY keys
AXEL_ENABLED=false
```

Shows variants only, no 3D generation costs.

---

## ✅ Configuration Validation

### Test Phase 1 (Variants)
```bash
curl -X POST http://localhost:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"modern house"}'
```

**Expected:** 3 variant descriptions returned

### Test Phase 3 (Full 3D)
Same as above, but wait 2-10 minutes.

**Expected:** Actual 3D model URLs in response

### Test Axel (Analysis)
Check response for `axelAnalysis` field:
```json
{
  "axelAnalysis": {
    "geometry": {...},
    "materials": {...},
    "flaws": {...},
    "tooling": {...},
    "environment": {...}
  }
}
```

---

## 📞 Support

If issues persist:
1. Check backend logs: `vercel logs` or local console
2. Check browser console for errors
3. Verify all API keys are valid
4. Ensure CORS is configured correctly

---

**Last Updated:** 2025-12-02
**Version:** Phase 2 (Axel Engine Integrated)
