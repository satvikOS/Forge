# AI 3D Generation Pipeline Guide

## Overview

The AI 3D Generation Pipeline is an ultra-budget-optimized system that integrates multiple AI 3D generation providers (Tripo AI, Meshy AI, Vertex AI Imagen) with aggressive cost optimization to stay under $5/month (target: $0-2/month).

## Key Features

### 🎯 Smart Provider Selection
- **Free Tier First**: Automatically uses free tier credits before paid generation
- **Multi-Provider Support**: Tripo AI, Meshy AI, Vertex AI Imagen
- **Intelligent Routing**: Selects best provider based on availability and cost

### 💰 Cost Optimization
- **Monthly Budget**: $0-5/month target (95% free tier usage)
- **Cache-First Strategy**: 30-day TTL, 85% similarity threshold
- **Budget Alerts**: Automatic alerts at 75%, 90%, 95%
- **Hard Limits**: Stops generation at 95% of monthly budget

### 🌍 Real-World Data Integration (NEW)
The system now intelligently analyzes prompts to detect real-world requests:
- **Automatic Detection**: Uses Gemini AI to identify landmarks, cities, infrastructure
- **Data Gathering**: Leverages existing API Orchestrator (Mapbox, OSM, Wikipedia, Wikidata, Mapillary)
- **Enhanced Accuracy**: Real-world data enhances generation with accurate details
- **Exact Replication**: When requested, provides precise real-world dimensions and context

### 🎨 Three Generation Modes

#### 1. Preview (Ultra Cheap) - **FREE**
- **Cost**: $0.002 (using free tier)
- **Time**: ~30 seconds
- **Quality**: Good for iteration
- **Pipeline**: Imagen concept art → Tripo preview

#### 2. Balanced - **$0.02-0.20**
- **Cost**: $0.02-0.20
- **Time**: ~45 seconds
- **Quality**: Production-ready
- **Pipeline**: Multi-view Imagen → Tripo/Meshy standard

#### 3. High Quality - **$0.40**
- **Cost**: $0.40
- **Time**: ~60 seconds
- **Quality**: AAA-grade with PBR materials
- **Pipeline**: Meshy text-to-3D with PBR

## Architecture

### Core Services

#### 1. Credit Manager (`creditManager.js`)
Tracks API credit usage across all providers:
- Monitors free tier limits (300 Tripo, 200 Meshy, 1000 Imagen/month)
- Records usage history
- Provides budget alerts
- Monthly automatic reset

#### 2. Model Cache (`modelCache.js`)
Aggressive caching system:
- **TTL**: 30 days
- **Similarity Matching**: 85% threshold using Jaccard similarity
- **Storage**: Disk-based persistent storage
- **Eviction**: LRU strategy
- **Target Hit Rate**: >90%

#### 3. AI 3D Orchestrator (`ai3DOrchestrator.js`)
Main orchestration service:
- Analyzes prompt intent (real-world vs fantasy)
- Gathers real-world data when needed
- Selects generation strategy
- Executes generation pipeline
- Caches results

#### 4. Provider Services
- **Tripo Service** (`tripoService.js`): Text/Image-to-3D, multi-image support
- **Meshy Service** (`meshyService.js`): High-quality 3D with PBR materials
- **Vertex Image Service** (`vertexImageService.js`): Imagen for concept art and textures

## API Endpoints

### Generation Endpoints

#### Preview Generation (FREE)
```bash
POST /api/generate/preview
Content-Type: application/json

{
  "prompt": "modern office building in downtown Chicago",
  "options": {}
}
```

#### Batch Generation
```bash
POST /api/generate/batch
Content-Type: application/json

{
  "prompts": ["prompt1", "prompt2", "prompt3"],
  "mode": "ultra_cheap"
}
```

#### Cost Estimation
```bash
POST /api/generate/estimate
Content-Type: application/json

{
  "prompt": "futuristic skyscraper",
  "mode": "balanced"
}
```

### Credit Management Endpoints

#### Get Credit Status
```bash
GET /api/credits/status
```

Response:
```json
{
  "success": true,
  "status": {
    "tripo": {
      "free": 300,
      "used": 45,
      "remaining": 255,
      "percentUsed": 15
    },
    "meshy": {
      "free": 200,
      "used": 10,
      "remaining": 190,
      "percentUsed": 5
    },
    "vertexImagen": {
      "free": 1000,
      "used": 250,
      "remaining": 750,
      "percentUsed": 25
    },
    "budget": {
      "max": 5,
      "used": 0.5,
      "remaining": 4.5,
      "percentUsed": 10
    }
  }
}
```

#### Get Usage Statistics
```bash
GET /api/credits/usage
```

#### Get Cost Forecast
```bash
GET /api/credits/forecast
```

## Configuration

### Environment Variables

```bash
# AI 3D Generation
ENABLE_AI_3D_GENERATION=true
DEFAULT_GENERATION_MODE=ultra_cheap
USE_FREE_TIER_FIRST=true

# API Keys
TRIPO_API_KEY=your_tripo_key
MESHY_API_KEY=your_meshy_key
GOOGLE_CLOUD_PROJECT_ID=your_project_id
VERTEX_AI_LOCATION=us-central1

# Free Tier Limits
TRIPO_FREE_CREDITS_MONTHLY=300
MESHY_FREE_CREDITS_MONTHLY=200
VERTEX_IMAGEN_FREE_MONTHLY=1000

# Budget Controls
MAX_MONTHLY_BUDGET_USD=5
ALERT_AT_BUDGET_PERCENT=75
STOP_GENERATION_AT_BUDGET_PERCENT=95

# Cache Configuration
ENABLE_MODEL_CACHE=true
MODEL_CACHE_TTL_DAYS=30
CACHE_SIMILARITY_THRESHOLD=0.85
```

## Frontend Integration

### Using the Quality Selector Component

```jsx
import QualitySelector from './components/QualitySelector';

function GenerationPanel() {
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState('preview');

  return (
    <div>
      <QualitySelector
        prompt={prompt}
        onQualitySelect={setQuality}
        disabled={loading}
      />
      <button onClick={() => generate(prompt, quality)}>
        Generate
      </button>
    </div>
  );
}
```

### API Service Methods

```javascript
import api from './services/api';

// Generate with quality selection
const result = await api.generateDesignWithQuality(prompt, 'preview');

// Batch generation
const batch = await api.batchGenerate([prompt1, prompt2], 'balanced');

// Get credit status
const credits = await api.getCreditStatus();

// Estimate cost
const estimate = await api.estimateGenerationCost(prompt, 'high_quality');
```

## Real-World Data Pipeline

### How It Works

1. **Intent Analysis**: Gemini AI analyzes the prompt
   ```javascript
   const intent = await analyzePromptIntent(prompt);
   // Returns: { needsRealWorldData: true, landmark: "Eiffel Tower", location: "Paris" }
   ```

2. **Data Gathering**: If real-world data is needed, orchestrator gathers:
   - Building data from OpenStreetMap
   - Satellite imagery from Mapbox
   - Elevation data from Open-Elevation
   - Weather and lighting from Open-Meteo
   - Reference images from Wikimedia Commons
   - Street-level photos from Mapillary

3. **Prompt Enhancement**: Original prompt is enhanced with real-world context
   ```
   Original: "Create the Eiffel Tower"
   Enhanced: "Create the Eiffel Tower. Real-world context: Location: Paris, France, 
             Style: Iron lattice, Scale: large, 324m height, 125m base width"
   ```

4. **Generation**: Enhanced prompt is sent to AI 3D provider

### Examples

#### Example 1: Real-World Landmark
```
Prompt: "Generate exact replica of Golden Gate Bridge"
→ Detects: Real-world landmark
→ Gathers: OSM data, satellite imagery, dimensions from Wikidata
→ Generates: Accurate 3D model with real dimensions
```

#### Example 2: Fantasy/Generic
```
Prompt: "Create a futuristic floating city"
→ Detects: Fantasy/imaginary
→ Skips: Real-world data gathering
→ Generates: Creative AI generation
```

## Cost Optimization Strategies

### 1. Cache Aggressively
- Models cached for 30 days
- 85% similarity matching (avoids exact duplicates)
- Target: >90% cache hit rate after warmup

### 2. Free Tier Prioritization
- Always check free tier availability first
- Rotate between providers to maximize free credits
- Fall back to paid only when necessary

### 3. Quality Tiering
- Start with preview (FREE) for iteration
- Upgrade to balanced only when needed
- Use high quality sparingly for final outputs

### 4. Batch Processing
- Group similar prompts
- Process in parallel to maximize efficiency
- Share credits across batch

## Budget Monitoring

### Automatic Alerts

- **75% Budget Used**: Warning notification
- **90% Budget Used**: Critical alert
- **95% Budget Used**: Generation blocked until next month

### Monthly Reports

The system tracks:
- Total generations
- Cost per generation
- Cache hit rate
- Provider usage distribution
- Projected monthly cost

## Best Practices

### For Users

1. **Start with Preview**: Always try preview mode first
2. **Use Cache**: Similar prompts will hit cache
3. **Be Specific**: More detail = better results
4. **Batch Similar Requests**: Use batch endpoint for multiple similar generations

### For Developers

1. **Monitor Credits**: Check credit status regularly
2. **Implement Alerts**: Set up notifications for budget warnings
3. **Optimize Prompts**: Test prompt enhancement for better results
4. **Cache Maintenance**: Run cleanup periodically

## Troubleshooting

### Issue: "No free tier credits available"
**Solution**: Wait for monthly reset or increase budget

### Issue: "Generation would exceed monthly budget"
**Solution**: Budget limit reached, wait for next month or adjust `MAX_MONTHLY_BUDGET_USD`

### Issue: "AI 3D generation is not enabled"
**Solution**: Set `ENABLE_AI_3D_GENERATION=true` and configure API keys

### Issue: Cache not working
**Solution**: 
- Check `ENABLE_MODEL_CACHE=true`
- Verify cache directory exists: `backend/db/cache/`
- Check disk space

## Performance Metrics

### Target KPIs
- **Monthly Cost**: $0-5 (target: $0-2)
- **Cache Hit Rate**: >85%
- **Free Tier Usage**: >95% of generations
- **Average Generation Time**: <60 seconds
- **Budget Overruns**: 0

### Monitoring

Check current performance:
```bash
GET /api/credits/usage
```

## Future Enhancements

- [ ] Quality upgrade feature (regenerate with higher quality)
- [ ] Progressive generation (preview → high quality on demand)
- [ ] Multi-region support for Vertex AI
- [ ] Advanced caching strategies (semantic embeddings)
- [ ] Usage analytics dashboard
- [ ] Automatic provider failover
- [ ] Custom quality presets

## Support

For issues or questions:
1. Check this documentation
2. Review `.env.example` for configuration
3. Check server logs for error details
4. Verify API keys are valid and have credits

## License

Part of ArchDisc platform.
