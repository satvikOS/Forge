# API Setup Guide

Complete guide to setting up all API integrations for ArchDisc's ultra-realistic 3D generation system.

## Quick Start (5 Minutes)

Get started with **100% free APIs** - no credit card required:

```bash
cd backend
cp .env.example .env

# Edit .env and set:
GEMINI_API_KEY=your_key_here  # Free tier: 60 requests/minute
ENABLE_ORCHESTRATOR=true
ENABLE_WIKIPEDIA=true
ENABLE_WIKIDATA=true
ENABLE_OVERPASS=true
ENABLE_OPEN_ELEVATION=true
ENABLE_OPEN_METEO=true
ENABLE_TREE_MAP=true
```

That's it! You now have access to:
- ✅ Wikipedia (building information)
- ✅ Wikidata (structured dimensions)
- ✅ OpenStreetMap (real building data)
- ✅ Open-Elevation (terrain data)
- ✅ Open-Meteo (weather & lighting)
- ✅ Tree generation (procedural vegetation)

## API Setup Instructions

### 1. Google Gemini AI (Required)

**Purpose:** Natural language understanding and prompt analysis

**Cost:** Free tier includes 60 requests/minute

**Setup:**

1. Go to https://makersuite.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key

**Configuration:**

```bash
GEMINI_API_KEY=AIzaSyC...your_key_here
GEMINI_MODEL=gemini-2.5-pro  # Recommended for best quality
```

**Models:**
- `gemini-2.5-pro` - Best quality (default)
- `gemini-2.5-flash` - Fast, good quality
- `gemini-2.0-flash` - Fastest, experimental

**Testing:**

```bash
node -e "require('dotenv').config(); require('./services/geminiService').generateContent('test').then(r => console.log('✅ Gemini working!'))"
```

---

### 2. Wikipedia API (Free)

**Purpose:** Landmark information, building history, dimensions

**Cost:** 100% Free, no API key required

**Configuration:**

```bash
ENABLE_WIKIPEDIA=true
```

**No setup needed!** The API is publicly available.

**What it provides:**
- Building names and historical context
- Architectural styles and periods
- Construction dates
- Height and dimension estimates
- Geographic coordinates
- Thumbnail images

**Rate Limits:** None for reasonable use

**Testing:**

```bash
curl "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Eiffel+Tower&format=json"
```

---

### 3. Wikidata API (Free)

**Purpose:** Structured building data with precise dimensions

**Cost:** 100% Free, no API key required

**Configuration:**

```bash
ENABLE_WIKIDATA=true
```

**No setup needed!** Completely open API.

**What it provides:**
- Exact building heights (meters)
- Width and length measurements
- Floor counts
- Construction dates (precise)
- Architect information
- Architectural style IDs
- Geographic coordinates (verified)

**Rate Limits:** None for reasonable use

**Testing:**

```bash
curl "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Eiffel+Tower&language=en&format=json"
```

---

### 4. Wikimedia Commons (Free)

**Purpose:** High-resolution architectural reference images

**Cost:** 100% Free, no API key required

**Configuration:**

```bash
ENABLE_WIKIMEDIA=true
```

**No setup needed!** Open media repository.

**What it provides:**
- High-resolution building photos
- Historical photographs
- Architectural detail images
- Reference images for texturing
- Material close-ups
- Licensed images (most are CC-BY-SA)

**Rate Limits:** None for reasonable use

**Testing:**

```bash
curl "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=architecture&format=json"
```

---

### 5. OpenStreetMap (Overpass API) (Free)

**Purpose:** Real building footprints, road networks, POIs

**Cost:** 100% Free, no API key required

**Configuration:**

```bash
ENABLE_OVERPASS=true
```

**No setup needed!** Community-maintained geographic database.

**What it provides:**
- Actual building footprints (shapes)
- Building dimensions and floor counts
- Road networks with names
- Points of interest (restaurants, shops)
- Architectural style tags
- Construction dates
- Address information

**Rate Limits:** 
- Max 2 requests per second
- Max 25 second query runtime
- Automatically handled by ArchDisc

**Testing:**

```bash
curl -X POST "https://overpass-api.de/api/interpreter" \
  --data "[out:json];node[name=\"Eiffel Tower\"];out;"
```

**Alternative Instances:**
If main server is slow, you can use alternatives:
- https://overpass.kumi.systems/api/interpreter
- https://overpass.nchc.org.tw/api/interpreter

---

### 6. Open-Elevation API (Free)

**Purpose:** Accurate terrain elevation data

**Cost:** 100% Free, no API key required

**Configuration:**

```bash
ENABLE_OPEN_ELEVATION=true
```

**No setup needed!** Free elevation service.

**What it provides:**
- Elevation data in meters
- Multi-point elevation queries
- Terrain profiles
- Elevation grids for areas
- Slope calculations

**Rate Limits:** None for reasonable use

**Testing:**

```bash
curl "https://api.open-elevation.com/api/v1/lookup?locations=48.8566,2.3522"
```

---

### 7. Open-Meteo API (Free)

**Purpose:** Weather conditions and lighting calculations

**Cost:** 100% Free, no API key required

**Configuration:**

```bash
ENABLE_OPEN_METEO=true
```

**No setup needed!** Free weather API.

**What it provides:**
- Current weather conditions
- Temperature, humidity, wind
- Cloud cover percentage
- Precipitation data
- Historical climate patterns
- Seasonal vegetation data
- Sunshine duration

**Plus, ArchDisc calculates:**
- Astronomical sun position
- Shadow strength
- Sky color
- Atmospheric scattering
- Fog density
- Time of day lighting

**Rate Limits:** 10,000 requests/day (plenty!)

**Testing:**

```bash
curl "https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&current_weather=true"
```

---

### 8. Mapbox API (Optional - Paid)

**Purpose:** Satellite imagery, terrain tiles, building footprints

**Cost:** 
- Free tier: 50,000 tile requests/month
- $5 per additional 50,000 tiles
- Typical usage: ~1,000 tiles/month = FREE

**Setup:**

1. Go to https://account.mapbox.com/
2. Sign up for free account
3. Go to Access Tokens page
4. Copy your default public token or create new one

**Configuration:**

```bash
MAPBOX_ACCESS_TOKEN=pk.eyJ1IjoieW91ci11c2VybmFtZSIsImEiOiJ5b3VyLXRva2VuIn0...
MAPBOX_ENABLED=true
```

**What it provides:**
- Satellite imagery (high resolution)
- 3D terrain data (RGB tiles)
- Vector building footprints
- Road network styling
- Map style customization

**Benefits:**
- Professional-grade satellite imagery
- Better quality than free alternatives
- Terrain elevation data

**Testing:**

```bash
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/eiffel+tower.json?access_token=YOUR_TOKEN"
```

**Free Alternative:** Use OpenStreetMap (already enabled) for building data

---

### 9. Mapillary API (Optional - Free)

**Purpose:** Street-level imagery and building facades

**Cost:** Free tier with registration

**Setup:**

1. Go to https://www.mapillary.com/dashboard/developers
2. Sign up for free account
3. Create a new application
4. Copy your Client ID

**Configuration:**

```bash
MAPILLARY_CLIENT_ID=your_client_id_here
MAPILLARY_ENABLED=true
```

**What it provides:**
- Street-level photographs
- Building facade details
- Ground-level context
- Multiple viewing angles
- Environmental context

**Benefits:**
- Free alternative to Google Street View
- Community-contributed images
- Global coverage

**Rate Limits:** 50,000 requests/month (generous!)

**Testing:**

```bash
curl "https://graph.mapillary.com/images?access_token=YOUR_TOKEN&bbox=2.29,48.85,2.30,48.86"
```

**Note:** Mapillary is optional. ArchDisc works great without it.

---

### 10. Sketchfab API (Optional - Free)

**Purpose:** Embed high-quality 3D models

**Cost:** Free for browsing and embedding

**Setup:**

Already integrated! Just set:

```bash
SKETCHFAB_ENABLED=true
```

**Optional OAuth Setup:**

1. Go to https://sketchfab.com/settings/password
2. Get your API token
3. Configure:

```bash
SKETCHFAB_API_TOKEN=your_token_here
```

**What it provides:**
- 3D model search
- Embed URLs for viewer
- Model metadata (face count, views)
- Category filtering
- Architecture-specific models

**Testing:**

```bash
curl "https://api.sketchfab.com/v3/search?type=models&q=architecture"
```

---

## Complete Configuration Example

### Minimal Setup (100% Free)

```bash
# Required
GEMINI_API_KEY=AIzaSy...your_key
GEMINI_MODEL=gemini-2.5-pro

# Free APIs (no keys needed)
ENABLE_ORCHESTRATOR=true
ENABLE_WIKIPEDIA=true
ENABLE_WIKIDATA=true
ENABLE_OVERPASS=true
ENABLE_OPEN_ELEVATION=true
ENABLE_OPEN_METEO=true
ENABLE_TREE_MAP=true
SKETCHFAB_ENABLED=true

# Performance
API_TIMEOUT_MS=5000
MAX_PARALLEL_REQUESTS=10
CACHE_TTL_SECONDS=3600
```

**Result:** Ultra-realistic generation with real building data, weather, lighting, and more - all FREE!

---

### Maximum Realism Setup (Includes Paid APIs)

```bash
# Core AI
GEMINI_API_KEY=AIzaSy...your_key
GEMINI_MODEL=gemini-2.5-pro

# 3D Models
SKETCHFAB_API_TOKEN=your_token
SKETCHFAB_ENABLED=true

# Geographic Services (PAID)
MAPBOX_ACCESS_TOKEN=pk.eyJ...your_token
MAPBOX_ENABLED=true

# Visual Context (FREE)
MAPILLARY_CLIENT_ID=your_client_id
MAPILLARY_ENABLED=true

# Free APIs
ENABLE_ORCHESTRATOR=true
ENABLE_WIKIPEDIA=true
ENABLE_WIKIDATA=true
ENABLE_OVERPASS=true
ENABLE_OPEN_ELEVATION=true
ENABLE_OPEN_METEO=true
ENABLE_TREE_MAP=true

# Performance
API_TIMEOUT_MS=5000
MAX_PARALLEL_REQUESTS=10
CACHE_TTL_SECONDS=3600
```

**Monthly Cost Estimate:** ~$0.75 - $2.00 (based on 1000 generations/month)

---

## Verification

After setup, verify all APIs are working:

```bash
# 1. Check API status
curl http://localhost:5000/api/orchestrate/capabilities

# 2. Run test suite
node backend/test-orchestrator.js

# 3. Generate a test scene
curl -X POST http://localhost:5000/api/orchestrate/preview \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Eiffel Tower"}'
```

Expected output:
```json
{
  "orchestrator": true,
  "apis": {
    "wikipedia": true,
    "wikidata": true,
    "overpass": true,
    "elevation": true,
    "weather": true,
    "mapbox": false,  // Only if you added the key
    "mapillary": false  // Only if you added the key
  }
}
```

---

## Troubleshooting

### Issue: Gemini API Key Invalid

**Error:** `API key not valid`

**Solutions:**
1. Verify key copied correctly (no spaces)
2. Check key is enabled at https://makersuite.google.com
3. Verify API is enabled in Google Cloud Console

---

### Issue: Rate Limit Errors (Overpass)

**Error:** `429 Too Many Requests`

**Solutions:**
1. Reduce `MAX_PARALLEL_REQUESTS` to 5
2. Increase `API_TIMEOUT_MS` to 10000
3. Add delay between requests
4. Use alternative Overpass server (see above)

---

### Issue: Slow API Responses

**Symptoms:** Orchestration takes >30 seconds

**Solutions:**
1. Check your internet connection
2. Test individual APIs directly
3. Enable more parallel requests (if bandwidth allows)
4. Use `/preview` endpoint for testing

---

### Issue: APIs Timing Out

**Error:** `ETIMEDOUT` or `ECONNREFUSED`

**Solutions:**
1. Increase `API_TIMEOUT_MS` to 10000
2. Check firewall settings
3. Verify API endpoints are accessible:
   ```bash
   curl https://en.wikipedia.org/w/api.php
   curl https://overpass-api.de/api/interpreter
   ```

---

## Performance Tuning

### For Development (Fast Iteration)

```bash
API_TIMEOUT_MS=3000
MAX_PARALLEL_REQUESTS=15
CACHE_TTL_SECONDS=7200  # 2 hours
```

### For Production (Reliability)

```bash
API_TIMEOUT_MS=10000
MAX_PARALLEL_REQUESTS=8
CACHE_TTL_SECONDS=3600  # 1 hour
```

### For High Traffic (Aggressive Caching)

```bash
API_TIMEOUT_MS=5000
MAX_PARALLEL_REQUESTS=10
CACHE_TTL_SECONDS=86400  # 24 hours
```

---

## Cost Optimization

### Minimize Costs

1. **Use free APIs first** - They provide 80% of value
2. **Enable aggressive caching** - Reduces API calls by 90%
3. **Use preview endpoint** - For quick checks without heavy APIs
4. **Batch requests** - Generate multiple scenes at once

### Monitor Usage

```bash
# Check API usage
curl http://localhost:5000/api/orchestrate/metrics

# View costs
{
  "summary": {
    "totalCost": "$0.0125"  // Last 24 hours
  }
}
```

---

## Security Best Practices

1. **Never commit API keys** - Use `.env` file (in `.gitignore`)
2. **Rotate keys regularly** - Especially for production
3. **Use environment-specific keys** - Different keys for dev/prod
4. **Enable CORS properly** - Restrict to your domains
5. **Monitor for abuse** - Check metrics regularly

---

## Getting Help

- **Documentation:** See `API_ORCHESTRATOR_GUIDE.md`
- **Issues:** Check GitHub Issues
- **API Status:** https://status.overpass-api.de/
- **Community:** ArchDisc Discord/Discussions

---

## Summary

✅ **5 FREE APIs** provide 80% of ultra-realistic enhancements
✅ **Setup time: 5 minutes** (just Gemini key required)
✅ **Optional paid APIs** for maximum quality
✅ **Monthly cost: $0-2** for typical usage
✅ **100% open source** - modify as needed

**Start with free APIs, add paid ones later for maximum realism!**
