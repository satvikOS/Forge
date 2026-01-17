# Gemini AI Integration - Implementation Guide

## Overview

This document describes the comprehensive Gemini AI integration implemented in ArchDisc for intelligent 3D scene generation with realistic placement based on real-world data patterns.

## Key Features

### 1. Comprehensive Taxonomy System
- **Complete Classification**: Covers settlements, environments, buildings, infrastructure, transportation, and demographics
- **Hierarchical Structure**: Categories → Subcategories → Detailed specifications
- **Realistic Dimensions**: All elements have authentic scales and proportions
- **Material Specifications**: Accurate material assignments per category

### 2. AI-Powered Prompt Analysis
- **Full Taxonomy Integration**: Gemini receives complete taxonomy in system prompt
- **Structured Extraction**: Returns JSON with categories, scales, elements, and placement data
- **Context-Aware Analysis**: Understands spatial relationships and environmental requirements
- **Fallback Chain**: Multiple analysis methods with graceful degradation

### 3. Real-World Data Integration
Inspired by Google Earth Enterprise patterns and urban planning research:

#### Urban Patterns
- **Manhattan Grid**: High-density CBD with orthogonal streets (80x250m blocks)
- **Tokyo Mixed**: High-density mixed grid/organic pattern (50x100m blocks)
- **European Medieval**: Organic irregular streets with narrow lanes (30x40m blocks)
- **American Suburban**: Low-density curvilinear with cul-de-sacs (150x200m blocks)
- **Coastal Resort**: Linear layout along waterfront
- **Industrial Zone**: Large lots with wide service roads

#### Building Densities (Real-World Data)
- **CBD Core**: 40 buildings/hectare, FAR 15.0, 100-400m heights
- **Urban Residential**: 80 buildings/hectare, FAR 3.5, 15-60m heights
- **Suburban**: 15 buildings/hectare, FAR 0.5, 5-12m heights
- **Industrial**: 8 buildings/hectare, FAR 1.2, 8-25m heights
- **Village**: 5 buildings/hectare, FAR 0.3, 4-10m heights

#### Road Network Patterns
- **Grid Orthogonal**: 100m intersections, 3-tier hierarchy
- **Radial Concentric**: Ring roads + radial spokes (Paris-style)
- **Organic Irregular**: Variable angles, historic patterns
- **Dendritic**: Tree-like suburban layout with cul-de-sacs

#### Vegetation Patterns (from satellite analysis)
- **Urban Park**: 100 trees/hectare, mixed species, 8-15m spacing
- **Street Trees**: 40 trees/hectare, linear placement
- **Forest**: 800 trees/hectare, continuous canopy
- **Coastal**: 60 trees/hectare, palm-dominant

### 4. Realistic Placement Engine
- **Priority-Based Placement**: Primary (buildings) → Secondary (roads) → Tertiary (vegetation)
- **Collision Avoidance**: Ensures proper spacing between objects
- **Context-Aware Positioning**: Buildings on ground, cars on roads, trees in clusters
- **Multiple Layout Strategies**: Grid, organic, linear, clustered, radial, scattered
- **Real-World Spacing**: Uses authentic urban planning standards

### 5. Enhanced 3D Generation
- **Taxonomy-Aware**: Generates geometry based on taxonomy classification
- **Category Mapping**: Maps taxonomy to existing 3D assets
- **Procedural Variations**: Seed-based randomization for unique results
- **Realistic Dimensions**: Converts meters to millimeters accurately
- **Material Assignment**: Applies appropriate materials per category

## Architecture

### Backend Services

```
backend/services/
├── geminiService.js           # AI API integration with taxonomy
├── aiService.js              # Orchestrates AI processing
├── taxonomySystem.js         # Complete taxonomy definitions
├── realWorldDataService.js   # Real-world patterns and metrics
├── placementEngine.js        # Realistic object positioning
├── geometryGenerator.js      # 3D geometry generation
└── materialSystem.js         # Material application
```

### Data Flow

```
User Prompt
    ↓
[Frontend] Scene Composer
    ↓
[API] POST /api/generate
    ↓
[Backend] AI Service
    ├─→ Gemini Service (analyze with taxonomy)
    ├─→ Real-World Data Service (apply patterns)
    ├─→ Placement Engine (calculate positions)
    └─→ Geometry Generator (create 3D data)
    ↓
[Response] Structured scene data
    ↓
[Frontend] Render 3D scene
```

## Usage Examples

### Example 1: Medieval Village

**Input**: "medieval village with church"

**AI Analysis**:
```json
{
  "primaryCategory": "settlement",
  "scale": { "type": "small", "settlement": "village" },
  "style": { "architectural": "medieval", "period": "medieval" },
  "elements": [
    {
      "category": "residential",
      "subcategory": "house",
      "quantity": 15,
      "placement": { "spacing": 20, "clustering": "moderate" }
    },
    {
      "category": "institutional",
      "subcategory": "place_of_worship",
      "quantity": 1,
      "placement": { "priority": "primary" }
    }
  ]
}
```

**Real-World Pattern Applied**: European Medieval
- 30x40m blocks, narrow streets
- 5 buildings/hectare
- Organic irregular road pattern
- 25 trees scattered naturally

### Example 2: Coastal Resort Town

**Input**: "coastal resort town"

**AI Analysis**:
```json
{
  "primaryCategory": "settlement",
  "scale": { "type": "medium", "settlement": "town" },
  "style": { "theme": "coastal" },
  "elements": [
    {
      "category": "commercial",
      "subcategory": "hotel",
      "quantity": 3,
      "dimensions": { "width": 40, "height": 30, "depth": 50 }
    },
    {
      "category": "water_bodies",
      "subcategory": "ocean",
      "quantity": 1
    },
    {
      "category": "landforms",
      "subcategory": "beach",
      "quantity": 1
    }
  ]
}
```

**Real-World Pattern Applied**: Coastal Resort
- Linear layout along waterfront
- 60 palm trees/hectare
- Beach road network
- Medium density spacing

### Example 3: Futuristic City

**Input**: "futuristic city"

**AI Analysis**:
```json
{
  "primaryCategory": "settlement",
  "scale": { "type": "large", "settlement": "city" },
  "style": { "architectural": "futuristic" },
  "elements": [
    {
      "category": "commercial",
      "subcategory": "skyscraper",
      "quantity": 20,
      "dimensions": { "height": 250 }
    }
  ]
}
```

**Real-World Pattern Applied**: Manhattan Grid
- 80x250m blocks
- 40 buildings/hectare
- Orthogonal street grid
- Heights 100-400m

## Configuration

### Environment Variables

```bash
# Required
GEMINI_API_KEY=your_api_key_here

# Optional
GEMINI_MODEL=gemini-2.5-pro  # Default: gemini-2.5-pro
PORT=5000                     # Default: 5000
NODE_ENV=development          # Default: development
```

### AI Service Configuration

The AI service has a fallback chain:
1. **Primary**: Taxonomy-aware analysis with real-world patterns
2. **Secondary**: Basic Gemini analysis
3. **Tertiary**: Design specs generation
4. **Fallback**: Template-based generation (frontend)

## API Reference

### POST /api/generate

Generate 3D scene from natural language prompt.

**Request**:
```json
{
  "prompt": "medieval village with church",
  "options": {
    "keepPrevious": true
  }
}
```

**Response**:
```json
{
  "success": true,
  "jobId": "job_123456",
  "status": "queued"
}
```

### GET /api/generate/:jobId

Check generation status and retrieve results.

**Response** (completed):
```json
{
  "success": true,
  "job": {
    "status": "completed",
    "result": {
      "design": {
        "specifications": {
          "taxonomyData": {
            "primaryCategory": "settlement",
            "elements": [...],
            "realWorldData": {
              "urbanPattern": {...},
              "spatialMetrics": {...}
            }
          }
        }
      }
    }
  }
}
```

## Taxonomy Categories

### Settlements
- Isolated Dwelling, Hamlet, Village, Town, City, Metropolis, Megalopolis, Conurbation

### Built Environment
- **Residential**: House, Apartment, Townhouse, Mansion
- **Commercial**: Office, Skyscraper, Retail, Mall, Restaurant, Hotel, Bank
- **Industrial**: Factory, Warehouse, Power Plant
- **Institutional**: School, Hospital, Library, Museum, Government, Worship, Stadium

### Natural Environment
- **Landforms**: Mountain, Hill, Valley, Canyon, Plain, Plateau, Desert, Beach, etc.
- **Water**: Ocean, Sea, River, Lake, Pond, Stream, Bay, Gulf, etc.
- **Flora**: Trees (Deciduous/Coniferous/Palm), Shrubs, Grass, Flowers

### Infrastructure
- **Roads**: Highway, Street, Road, Avenue, Lane, Sidewalk, Path
- **Structures**: Bridge, Tunnel, Fence, Dam
- **Utilities**: Power Lines, Traffic Lights, Street Lights

### Transportation
- **Land**: Bicycle, Car, Motorcycle, Bus, Train, Construction, Emergency
- **Water**: Boat, Yacht, Sailboat, Ship, Ferry, Submarine
- **Air**: Airplane, Helicopter, Drone, Balloon
- **Space**: Rocket, Spacecraft, Satellite, Rover

## Performance

### Target Metrics
- **Generation Time**: <5 seconds for typical scenes
- **AI Response**: ~2-3 seconds
- **Placement Calculation**: <1 second
- **Geometry Generation**: ~1-2 seconds

### Optimization Strategies
- **Caching**: Gemini responses cached per prompt
- **Instancing**: Repeated objects use GPU instancing
- **LOD**: Level of detail based on object count
- **Lazy Loading**: Assets loaded on demand

## Testing

### Manual Testing Checklist

Test each category with example prompts:

- [ ] **Settlements**: "medieval village", "futuristic city", "small town"
- [ ] **Natural**: "mountain range", "coastal beach", "forest landscape"
- [ ] **Buildings**: "office building", "residential complex", "shopping mall"
- [ ] **Mixed**: "coastal resort town", "industrial park", "urban park"

### Expected Outcomes

Each prompt should:
1. Generate unique scenes (different each time)
2. Apply realistic spacing and placement
3. Use appropriate real-world patterns
4. Include contextually correct elements
5. Have proper scale and proportions

## Troubleshooting

### Issue: AI returns null

**Solution**: Check fallback chain logs, verify API key

### Issue: Objects overlap

**Solution**: Increase spacing in placement engine, check collision detection

### Issue: Wrong building density

**Solution**: Verify real-world data service recommendations match settlement type

### Issue: Performance slow

**Solution**: Reduce object count, enable instancing, check LOD settings

## Future Enhancements

1. **Google Earth Engine API**: Direct integration for satellite imagery
2. **OSM Integration**: Real road network data from OpenStreetMap
3. **3D Tileset Support**: Load actual 3D building models
4. **Climate Data**: Weather patterns affecting vegetation
5. **Traffic Simulation**: Realistic vehicle movement
6. **Population Simulation**: Demographic visualization
7. **Historical Accuracy**: Era-specific architectural details
8. **Cultural Variations**: Regional building styles

## Contributing

When adding new features:
1. Update taxonomy if new categories needed
2. Add real-world patterns to realWorldDataService
3. Update placement engine for new element types
4. Add geometry generation methods
5. Document changes in this guide

## References

- Urban Planning: "The Image of the City" by Kevin Lynch
- Building Densities: Urban density studies from various cities
- Road Patterns: "Street Design: The Secret to Great Cities" by Victor Dover
- Vegetation: Satellite imagery analysis from Landsat/Sentinel
- Google Earth Engine: https://earthengine.google.com/

## License

This implementation follows the project's license.
