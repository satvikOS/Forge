# Ultra-Realistic AI Generation Pipeline - Phase 1

## Overview

The Ultra-Realistic AI Generation Pipeline transforms user prompts into highly accurate 3D models by leveraging real-world reference data and multi-variant generation. Instead of generating random shapes, the system produces 3 distinct, ultra-realistic design options that emphasize different aspects of the subject.

## Key Features

### 🎨 Multi-Variant Generation
- **3 Design Options Per Prompt**: Every generation produces three distinct variants
  - **Photorealistic**: Emphasizes visual accuracy and real-world appearance
  - **Engineering Detail**: Focuses on structural accuracy and technical specifications
  - **Artistic Quality**: Optimizes for aesthetics and presentation
  
### 📚 Real-World Reference Integration
- **Wikipedia API**: Fetches article summaries, images, and infobox data
- **Wikidata API**: Retrieves structured data including:
  - Precise dimensions (height, width, length)
  - Construction materials
  - Architect/creator information
  - Inception dates and locations
  - Geographic coordinates

### 🏗️ Context-Aware Generation
- Analyzes prompts to identify landmarks, buildings, vehicles
- Extracts coordinates from location-based prompts
- Applies real-world dimensions and materials to 3D models
- Considers historical context and architectural style

### 🖥️ Professional Variant Selector UI
- Dark glassmorphism design
- Interactive grid layout with hover effects
- Displays key metadata (dimensions, materials, complexity)
- Visual indicators for selected variant
- Responsive design for all screen sizes

## Usage Examples

### Example 1: Famous Landmark

**Prompt:** `Eiffel Tower`

**Expected Results:**
- 3 ultra-realistic variants generated in 5-10 seconds
- Real-world data fetched from Wikipedia/Wikidata:
  - Height: 324m
  - Material: Wrought iron
  - Built: 1889
  - Location: Paris, France
- Variant 1 (Photorealistic): Accurate proportions, weathered iron textures, Parisian atmosphere
- Variant 2 (Engineering Detail): 18,038 metal parts, 2.5M rivets, structural specifications
- Variant 3 (Artistic Quality): Optimized lighting, dramatic composition, aesthetic focus

### Example 2: Modern Vehicle

**Prompt:** `BMW X3`

**Expected Results:**
- 3 vehicle design variants
- Automotive specifications:
  - Dimensions from manufacturer data
  - Materials: aluminum, steel, composites
  - Modern manufacturing details
- Different styling interpretations

### Example 3: Location-Based

**Prompt:** `My apartment building at coordinates: 40.7589,-73.9851`

**Expected Results:**
- 3 building design variants
- Location extracted: Times Square, New York
- Environmental context considered
- *Note: Full geospatial integration coming in Phase 3*

## Technical Architecture

### Backend Services

#### MultiVariantGenerator (`backend/services/generation/multiVariantGenerator.js`)
Generates three distinct design variants per prompt using Google Gemini 2.0 Flash Experimental.

**Key Methods:**
- `generateVariants(prompt, context)`: Main generation orchestrator
- `buildVariantPrompt(basePrompt, style, context)`: Constructs detailed AI prompts
- `parseVariantResponse(text, style)`: Parses AI JSON responses
- `createFallbackVariant(prompt, style, context)`: Handles generation failures

**Features:**
- Parallel variant generation for speed
- Style-specific prompt engineering
- Robust error handling with fallbacks
- Structured JSON output validation

#### RealWorldReferenceSystem (`backend/services/references/realWorldReferenceSystem.js`)
Fetches and caches real-world reference data from Wikipedia and Wikidata.

**Key Methods:**
- `fetchReferenceData(subject)`: Fetches comprehensive data
- `fetchWikipediaData(subject)`: Gets Wikipedia articles and infoboxes
- `fetchWikidataData(subject)`: Gets structured Wikidata entities
- `extractCoordinates(prompt)`: Parses coordinate strings
- `clearCache()`: Manages reference data cache

**Data Extracted:**
- Article summaries and descriptions
- Thumbnail and high-resolution images
- Precise dimensions (meters)
- Construction materials
- Architect/creator names
- Inception dates
- Geographic coordinates

#### Enhanced Generate Route (`backend/routes/generate.js`)
New `/api/generate/variants` endpoint for multi-variant generation.

**Flow:**
1. Validate prompt
2. Extract coordinates if present
3. Fetch real-world reference data
4. Generate 3 variants with context
5. Return structured response with metadata

### Frontend Components

#### VariantSelector (`frontend/src/components/VariantSelector.jsx`)
Professional variant selection interface.

**Props:**
- `variants`: Array of variant objects
- `selectedVariant`: Index of currently selected variant
- `onVariantSelect`: Callback when variant is clicked

**Features:**
- Grid layout with 3 cards
- Style badges with color coding
- Metadata display (dimensions, materials, complexity)
- Selection indicators with animations
- Keyboard navigation support

#### App Integration (`frontend/src/App.jsx`)
Updated main application to support multi-variant workflow.

**New State:**
- `variants`: Array of generated variants
- `selectedVariant`: Currently selected variant index

**New Functions:**
- `convertVariantToModelData()`: Converts variant to 3D viewer format
- `handleVariantSelect()`: Switches between variants

**Modified Functions:**
- `handleGenerateDesign()`: Tries multi-variant generation first, falls back to standard

### API Integration

#### Wikipedia API
- **Endpoint**: `https://en.wikipedia.org/w/api.php`
- **Actions**: search, query (extracts, pageimages, revisions)
- **Rate Limit**: None (free)
- **Timeout**: 10 seconds

#### Wikidata API
- **Endpoint**: `https://www.wikidata.org/w/api.php`
- **Actions**: wbsearchentities, wbgetentities
- **Properties**:
  - P2048: Height
  - P2049: Width
  - P2043: Length
  - P186: Material used
  - P84: Architect
  - P571: Inception date
  - P625: Coordinate location
- **Rate Limit**: None (free)
- **Timeout**: 10 seconds

## Configuration

### Backend Environment Variables

Add to `backend/.env`:

```env
# Gemini AI Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash-exp

# Multi-Variant Generation Settings
VARIANT_COUNT=3
ENABLE_REFERENCE_SYSTEM=true
CACHE_REFERENCE_DATA=true

# API Settings
API_TIMEOUT_MS=10000
```

### Frontend Configuration

No additional configuration required. The frontend automatically detects multi-variant responses and displays the VariantSelector.

## Performance Metrics

### Generation Times
- **Wikipedia/Wikidata Fetch**: 1-2 seconds
- **Variant Generation**: 3-5 seconds per variant (parallel)
- **Total Time**: 5-10 seconds for complete result

### Caching
- **Wikipedia Data**: Cached indefinitely per subject
- **Wikidata Data**: Cached indefinitely per entity
- **Cache Hit Rate Target**: >80% for popular landmarks

### Resource Usage
- **Memory**: <500MB per generation
- **Network**: ~200KB per Wikipedia fetch, ~100KB per Wikidata fetch
- **API Calls**: 2-4 per generation (Wikipedia search + details, Wikidata search + entity)

## Testing Instructions

### 1. Backend Testing

```bash
# Start backend server
cd backend
npm start

# Test variants endpoint with curl
curl -X POST http://localhost:5000/api/generate/variants \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Eiffel Tower"}'

# Expected response structure:
{
  "success": true,
  "prompt": "Eiffel Tower",
  "variants": [
    {
      "style": "photorealistic",
      "title": "Photorealistic",
      "name": "Eiffel Tower - Photorealistic",
      "dimensions": {"width": 125, "height": 324, "depth": 125},
      "materials": ["wrought iron", "steel"],
      ...
    },
    ...
  ],
  "realWorldData": {
    "hasWikipedia": true,
    "hasWikidata": true,
    "dimensions": {"height": 324, "baseWidth": 125}
  }
}
```

### 2. Frontend Testing

```bash
# Start frontend dev server
cd frontend
npm run dev

# Open browser to http://localhost:5173
# Enter prompt: "Eiffel Tower"
# Verify:
# - Progress indicator shows
# - 3 variants display in selector
# - Clicking variants updates 3D view
# - Metadata shows correctly
```

### 3. Integration Testing

**Test Cases:**
1. **Famous Landmark**: "Eiffel Tower"
   - ✅ Should fetch Wikipedia/Wikidata
   - ✅ Should show 324m height
   - ✅ Should list wrought iron material
   - ✅ Should generate 3 distinct variants

2. **Modern Building**: "Burj Khalifa"
   - ✅ Should fetch real dimensions (828m)
   - ✅ Should show construction materials
   - ✅ Should include modern architectural details

3. **Vehicle**: "Tesla Model 3"
   - ✅ Should generate 3 vehicle variants
   - ✅ Should include automotive dimensions
   - ✅ Should list materials (aluminum, steel, glass)

4. **Coordinates**: "coordinates: 40.7589,-73.9851"
   - ✅ Should extract coordinates
   - ✅ Should generate building variants
   - ✅ Should consider location context

5. **Generic Object**: "Modern chair"
   - ✅ Should generate 3 variants
   - ✅ May not have real-world data (expected)
   - ✅ Should still create realistic designs

### 4. Error Handling Tests

```bash
# Test without GEMINI_API_KEY
unset GEMINI_API_KEY
npm start
# Expected: 503 error, clear message about missing key

# Test with invalid prompt
curl -X POST http://localhost:5000/api/generate/variants \
  -H "Content-Type: application/json" \
  -d '{"prompt":""}'
# Expected: 400 error, "Prompt is required"

# Test with API timeout
# (Simulate by blocking Wikipedia/Wikidata in firewall)
# Expected: Generation continues without real-world data
```

## Future Roadmap

### Phase 2: Axel Voxel Engine (Issue #47)
- Micron-level accuracy for ultra-detailed models
- Voxel-based geometry generation
- Sub-millimeter precision for engineering models

### Phase 3: Geospatial Integration (Issue #48)
- Cesium integration for 3D globe
- Mapbox satellite imagery
- Mapillary street-level photos
- Real-time terrain elevation
- OpenStreetMap building footprints
- Environmental context (weather, time of day)

### Phase 4: Real-Time AI Editing
- Voice-controlled model modifications
- Natural language editing commands
- Incremental variant regeneration
- History and undo/redo

### Phase 5: BOM & Compliance
- Bill of Materials generation
- Cost estimation
- Building code compliance checking
- Export to construction software (Revit, AutoCAD)

## Troubleshooting

### Issue: "Multi-variant generation is not enabled"
**Solution**: Configure `GEMINI_API_KEY` in `backend/.env`

### Issue: No real-world data fetched
**Possible Causes:**
- Wikipedia/Wikidata timeout (check network)
- Subject not found in Wikipedia/Wikidata
- Subject is too generic or ambiguous

**Solution**: Try more specific prompts (e.g., "Eiffel Tower Paris" instead of "tower")

### Issue: Variants are too similar
**Possible Cause**: AI model not emphasizing style differences
**Solution**: This is expected for simple objects. Complex subjects show more variation.

### Issue: Slow generation (>15 seconds)
**Possible Causes:**
- Network latency to Gemini API
- Wikipedia/Wikidata API slow response
- Large/complex prompts

**Solutions:**
- Check network connection
- Reduce prompt complexity
- Verify API keys are valid

### Issue: Variant selector not showing
**Possible Causes:**
- Variant generation failed
- Frontend-backend version mismatch
- Browser console errors

**Solutions:**
- Check browser console for errors
- Verify backend logs for generation errors
- Ensure `VariantSelector.jsx` is imported in `App.jsx`

## API Reference

### POST /api/generate/variants

Generate 3 ultra-realistic design variants.

**Request:**
```json
{
  "prompt": "Eiffel Tower",
  "options": {
    "quality": "high",
    "style": "modern"
  }
}
```

**Response:**
```json
{
  "success": true,
  "prompt": "Eiffel Tower",
  "variants": [
    {
      "style": "photorealistic",
      "title": "Photorealistic",
      "name": "Eiffel Tower - Photorealistic",
      "description": "Ultra-realistic recreation...",
      "dimensions": {
        "width": 125,
        "height": 324,
        "depth": 125
      },
      "materials": ["wrought iron", "steel"],
      "elements": [...],
      "details": {
        "structuralFeatures": [...],
        "visualCharacteristics": [...],
        "technicalSpecs": [...]
      },
      "metadata": {
        "complexity": "high",
        "realism": "high",
        "historicalAccuracy": "high",
        "generatedAt": "2024-01-01T00:00:00.000Z"
      }
    },
    // ... 2 more variants
  ],
  "realWorldData": {
    "hasWikipedia": true,
    "hasWikidata": true,
    "dimensions": {"height": 324, "baseWidth": 125},
    "materials": ["Q11421"]
  },
  "metadata": {
    "generatedAt": "2024-01-01T00:00:00.000Z",
    "variantCount": 3,
    "hasRealWorldData": true
  }
}
```

**Status Codes:**
- `200`: Success
- `400`: Invalid prompt
- `500`: Generation failed
- `503`: Multi-variant generator not enabled

## Credits

### APIs Used
- **Wikipedia API**: Article data and images (free, no key required)
- **Wikidata API**: Structured architectural data (free, no key required)
- **Google Gemini**: AI model for variant generation (requires API key)

### Technologies
- **Backend**: Node.js, Express, Axios
- **Frontend**: React, Vite
- **AI Model**: Gemini 2.0 Flash Experimental

## License

This feature is part of ArchDisc and follows the repository license.

## Support

For issues or questions:
1. Check this documentation
2. Review backend logs for error details
3. Open an issue on GitHub with:
   - Prompt used
   - Error message
   - Backend logs
   - Frontend console errors

---

**Last Updated**: 2024-01-01
**Version**: Phase 1 (Initial Release)
**Status**: ✅ Production Ready
