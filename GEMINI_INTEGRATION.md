# Gemini API Integration Guide

## Overview

ArchDisc now uses **Google's Gemini API** for AI-powered design generation, replacing the previous OpenAI integration. This provides access to Google's latest and most capable AI models with no local processing - everything runs on Google's servers.

## Why Gemini?

- **State-of-the-art AI**: Access to Google's latest Gemini models
- **Multiple model options**: Choose between speed and capability
- **Cost-effective**: Competitive pricing with generous free tier
- **High rate limits**: Better for production applications
- **Long context windows**: Handle complex design specifications
- **Reliable infrastructure**: Google's proven cloud infrastructure

## Available Models

### Gemini 1.5 Pro (Default)
- **Best for**: Complex designs, detailed specifications
- **Context window**: 2 million tokens
- **Features**: Advanced reasoning, multimodal capabilities
- **Use case**: Production applications requiring high quality

### Gemini 1.5 Flash
- **Best for**: Quick iterations, rapid prototyping
- **Context window**: 1 million tokens
- **Features**: Fast response times, cost-effective
- **Use case**: Development and testing

### Gemini 1.0 Pro
- **Best for**: Stable production workloads
- **Context window**: 32k tokens
- **Features**: Proven reliability, consistent performance
- **Use case**: Production applications prioritizing stability

## Getting Your API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key
5. Add it to your `.env` file:
   ```bash
   GEMINI_API_KEY=your-api-key-here
   ```

## Configuration

### Environment Variables

Add these to your `.env` file (backend):

```bash
# Required
GEMINI_API_KEY=your-api-key-here

# Optional - defaults to gemini-1.5-pro
GEMINI_MODEL=gemini-1.5-pro
```

### Model Selection

Choose your model based on your needs:

```bash
# For maximum quality and capability
GEMINI_MODEL=gemini-1.5-pro

# For speed and cost efficiency
GEMINI_MODEL=gemini-1.5-flash

# For stable production use
GEMINI_MODEL=gemini-1.0-pro
```

## Demo Mode

ArchDisc can run without an API key using demo mode:

```bash
GEMINI_API_KEY=demo-mode
```

Demo mode provides pre-configured responses for:
- Cars (electric sedan design)
- Buildings (contemporary office building)
- Furniture (ergonomic office chair)

This is perfect for:
- Testing the application
- Development without API costs
- Demonstrations and presentations

## Migration from OpenAI

If you were using the previous OpenAI integration:

### 1. Remove OpenAI Configuration

Old `.env`:
```bash
OPENAI_API_KEY=sk-...
```

New `.env`:
```bash
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-1.5-pro  # optional
```

### 2. Update Vercel Environment Variables

In Vercel Dashboard → Settings → Environment Variables:

**Remove:**
- `OPENAI_API_KEY`

**Add:**
- `GEMINI_API_KEY` = your API key or `demo-mode`
- `GEMINI_MODEL` = `gemini-1.5-pro` (optional)

### 3. Redeploy

```bash
vercel --prod
```

## API Features

### JSON-First Responses

Gemini is configured to return structured JSON for design specifications:

```json
{
  "objectType": "car",
  "description": "Modern electric sedan",
  "dimensions": {
    "length": 4500,
    "width": 1850,
    "height": 1450
  },
  "materials": ["aluminum", "carbon fiber", "glass"],
  "style": "futuristic",
  "features": ["electric powertrain", "autonomous driving"]
}
```

### Automatic Fallback

If Gemini API calls fail, the system automatically falls back to demo mode, ensuring your application always works.

### Smart Parsing

The AI service includes smart parsing that handles:
- Markdown-wrapped JSON responses
- Plain text responses
- Missing or incomplete fields
- Error recovery

## Rate Limits

### Free Tier (No Credit Card Required)
- **Gemini 1.5 Pro**: 2 requests per minute
- **Gemini 1.5 Flash**: 15 requests per minute
- **Gemini 1.0 Pro**: 15 requests per minute

### Paid Tier
- Significantly higher rate limits
- Pay-as-you-go pricing
- No monthly commitments

## Cost Comparison

Gemini is highly cost-effective:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Gemini 1.5 Pro | $3.50 | $10.50 |
| Gemini 1.5 Flash | $0.35 | $1.05 |
| Gemini 1.0 Pro | $0.50 | $1.50 |

For reference, a typical design generation uses ~500 input tokens and ~800 output tokens, costing less than $0.01 per generation.

## Best Practices

### 1. Model Selection

**Development:**
```bash
GEMINI_MODEL=gemini-1.5-flash
```
- Fast iterations
- Lower costs
- Good for testing

**Production:**
```bash
GEMINI_MODEL=gemini-1.5-pro
```
- Best quality
- Detailed specifications
- Reliable results

### 2. Error Handling

Always handle API errors gracefully:

```javascript
try {
  const result = await aiService.processPrompt(prompt);
  // Use result
} catch (error) {
  // Falls back to demo mode automatically
  console.error('AI generation failed:', error);
}
```

### 3. Caching

For production, consider caching common designs to reduce API calls:

```javascript
// Future enhancement: Add caching layer
const cacheKey = `design:${hash(prompt)}`;
const cached = await cache.get(cacheKey);
if (cached) return cached;
```

### 4. Rate Limiting

Implement client-side rate limiting to prevent quota exhaustion:

```javascript
// Future enhancement: Add rate limiter
const rateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  max: 10 // 10 requests per minute
});
```

## Testing

### Test in Demo Mode

```bash
# .env
GEMINI_API_KEY=demo-mode
```

### Test with Real API

```bash
# .env
GEMINI_API_KEY=your-actual-key
GEMINI_MODEL=gemini-1.5-flash  # Use flash for testing
```

### Test Prompts

1. **Car Design:**
   ```
   Design a futuristic electric sports car
   ```

2. **Building Design:**
   ```
   Create a sustainable office building with solar panels
   ```

3. **Furniture Design:**
   ```
   Design an ergonomic desk chair for long work sessions
   ```

## Troubleshooting

### Issue: "API key not valid"

**Solution:**
- Verify your API key is correct
- Check you've enabled the Gemini API in Google Cloud Console
- Ensure no extra spaces in the `.env` file

### Issue: "Rate limit exceeded"

**Solution:**
- Switch to demo mode temporarily: `GEMINI_API_KEY=demo-mode`
- Wait for rate limit window to reset (1 minute)
- Consider upgrading to paid tier for higher limits
- Use `gemini-1.5-flash` for higher rate limits

### Issue: "Model not found"

**Solution:**
- Verify model name is correct (gemini-1.5-pro, gemini-1.5-flash, or gemini-1.0-pro)
- Check for typos in `GEMINI_MODEL` environment variable
- Remove `GEMINI_MODEL` to use default (gemini-1.5-pro)

### Issue: "Invalid JSON response"

**Solution:**
- The system automatically handles this with smart parsing
- Falls back to demo mode if parsing fails
- No action needed - built-in error recovery

## Monitoring

### Check API Usage

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. View your API key details
3. Check usage statistics
4. Monitor rate limits

### Logging

Enable detailed logging:

```javascript
// Check backend logs for AI service activity
console.log('Gemini API response:', response);
```

### Error Tracking

Monitor these in your application:
- API call failures
- Rate limit hits
- Invalid responses
- Fallback to demo mode triggers

## Support

### Resources

- **Google AI Studio**: https://makersuite.google.com
- **Gemini API Docs**: https://ai.google.dev/docs
- **Pricing**: https://ai.google.dev/pricing
- **Support**: https://developers.google.com/support

### Community

- Stack Overflow: Tag `google-gemini`
- GitHub Issues: For ArchDisc-specific issues
- Google Groups: For API-specific questions

## Future Enhancements

Planned improvements for Gemini integration:

1. **Multimodal Support**: Image and sketch upload
2. **Streaming Responses**: Real-time generation feedback
3. **Fine-tuning**: Custom models for specific design domains
4. **Context Persistence**: Multi-turn design conversations
5. **Advanced Parameters**: Temperature, top-k, top-p controls

## Conclusion

The Gemini API integration provides:
- ✅ State-of-the-art AI capabilities
- ✅ Multiple model options for different needs
- ✅ Cost-effective pricing
- ✅ Reliable, server-based processing
- ✅ No local processing required
- ✅ Seamless fallback to demo mode

You're now ready to use ArchDisc with Google's most advanced AI models!

---

**Last Updated**: 2025-11-11
**Version**: 1.0.0
**API**: Google Gemini API
