# AI 3D Generation - Quick Start Guide

## Setup (5 minutes)

### 1. Get API Keys (Choose at least one)

#### Option A: Tripo AI (Recommended for beginners)
1. Sign up at https://www.tripo3d.ai/
2. Get 300 free credits/month
3. Copy API key

#### Option B: Meshy AI (Best quality)
1. Sign up at https://www.meshy.ai/
2. Get 200 free credits/month
3. Copy API key

#### Option C: Vertex AI Imagen (For concept art)
1. Create Google Cloud project
2. Enable Vertex AI API
3. Create service account key
4. Download JSON credentials

### 2. Configure Environment

Edit `backend/.env`:

```bash
# Required: Core AI
GEMINI_API_KEY=your_gemini_key_here

# Optional but recommended: Choose at least one
TRIPO_API_KEY=your_tripo_key_here
MESHY_API_KEY=your_meshy_key_here
GOOGLE_CLOUD_PROJECT_ID=your_project_id

# Enable the feature
ENABLE_AI_3D_GENERATION=true
```

### 3. Start Server

```bash
cd backend
npm install
npm start
```

## Usage

### Generate with Preview (FREE)

```bash
curl -X POST http://localhost:5000/api/generate/preview \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "modern office building in New York City"
  }'
```

### Check Credits

```bash
curl http://localhost:5000/api/credits/status
```

### Estimate Cost

```bash
curl -X POST http://localhost:5000/api/generate/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "futuristic skyscraper",
    "mode": "balanced"
  }'
```

## Generation Modes

| Mode | Cost | Time | Use Case |
|------|------|------|----------|
| **Preview** | $0.00 (FREE) | 30s | Iteration, testing |
| **Balanced** | $0.02-0.20 | 45s | Production-ready |
| **High Quality** | $0.40 | 60s | Final outputs, AAA-grade |

## Real-World Data

The system automatically detects and uses real-world data:

### Triggers Real-World Data:
✅ "Generate the Eiffel Tower"
✅ "Create Times Square in New York"
✅ "Exact replica of Golden Gate Bridge"
✅ "Downtown Chicago with real buildings"

### Uses AI Generation Only:
❌ "Create a futuristic city"
❌ "Design a fantasy castle"
❌ "Modern building concept"

## Budget Management

### Default Limits
- **Monthly Budget**: $5
- **Alert at**: 75% ($3.75)
- **Stop at**: 95% ($4.75)

### Change Limits

Edit `backend/.env`:
```bash
MAX_MONTHLY_BUDGET_USD=10
ALERT_AT_BUDGET_PERCENT=80
STOP_GENERATION_AT_BUDGET_PERCENT=90
```

## Troubleshooting

### "AI 3D generation is not enabled"
```bash
# In .env file:
ENABLE_AI_3D_GENERATION=true
TRIPO_API_KEY=your_key_here  # Add at least one API key
```

### "No free tier credits available"
- Wait for monthly reset (1st of month)
- Or increase budget in `.env`

### "Budget limit reached"
```bash
# Option 1: Increase budget
MAX_MONTHLY_BUDGET_USD=10

# Option 2: Wait for next month
# Credits reset automatically on 1st
```

## Cost Optimization Tips

1. **Use Preview First**: Always start with preview mode (FREE)
2. **Cache Works**: Similar prompts return cached results instantly
3. **Batch Similar Requests**: Use `/api/generate/batch` endpoint
4. **Monitor Usage**: Check `/api/credits/status` regularly

## Frontend Integration

Add to your component:

```jsx
import QualitySelector from './components/QualitySelector';
import api from './services/api';

function MyComponent() {
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState('preview');

  const handleGenerate = async () => {
    const result = await api.generateDesignWithQuality(prompt, quality);
    console.log(result);
  };

  return (
    <div>
      <input 
        value={prompt} 
        onChange={e => setPrompt(e.target.value)}
        placeholder="Enter your prompt..."
      />
      
      <QualitySelector
        prompt={prompt}
        onQualitySelect={setQuality}
      />
      
      <button onClick={handleGenerate}>
        Generate 3D Model
      </button>
    </div>
  );
}
```

## Expected Performance

### After Warmup (1 week):
- **Cache Hit Rate**: >85%
- **Monthly Cost**: $0-2
- **Free Tier Usage**: >95%
- **Avg Response Time**: <1s (cached), <60s (new)

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate/preview` | POST | FREE preview generation |
| `/api/generate/batch` | POST | Batch generation |
| `/api/generate/estimate` | POST | Cost estimation |
| `/api/credits/status` | GET | Credit status |
| `/api/credits/usage` | GET | Usage statistics |
| `/api/credits/forecast` | GET | Cost forecast |

## Support

- **Documentation**: See `AI_3D_GENERATION_GUIDE.md`
- **Configuration**: See `backend/.env.example`
- **Issues**: Check server logs for details

## Success Checklist

- [ ] API keys configured
- [ ] Server starts without errors
- [ ] `/api/credits/status` returns data
- [ ] Preview generation works
- [ ] Cache directory created
- [ ] Budget alerts configured

## Next Steps

1. Test with a simple prompt
2. Monitor credit usage
3. Adjust budget as needed
4. Integrate with frontend
5. Set up production environment

---

**Ready to generate? Start with:**
```bash
curl -X POST http://localhost:5000/api/generate/preview \
  -H "Content-Type: application/json" \
  -d '{"prompt": "modern sports car"}'
```
