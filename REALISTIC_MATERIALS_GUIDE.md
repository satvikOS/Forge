# Realistic Materials Integration Guide

## Overview

This document describes the integration of AAA-level realistic materials using AmbientCG PBR textures and Polyhaven HDRI environments in ArchDisc.

## Architecture

### Backend Services

#### 1. Material Library Service (`backend/services/materialLibraryService.js`)

**Purpose**: Manages the AmbientCG material database with fast search and smart matching.

**Key Features**:
- Parses CSV file from AmbientCG
- Builds indexed database for fast lookup
- Smart material matching by surface type and finish
- Caching for frequently used materials

**Usage**:
```javascript
const materialLibraryService = require('./services/materialLibraryService');

// Initialize (loads CSV)
await materialLibraryService.loadDatabase();

// Get material for surface
const material = materialLibraryService.getMaterialForSurface(
  'concrete',  // surface type
  'rough',     // finish
  '2K'         // resolution
);

// Search materials
const results = materialLibraryService.searchMaterials('wood', {
  finish: 'polished',
  resolution: '4K'
});
```

#### 2. Polyhaven Service (`backend/services/polyhavenService.js`)

**Purpose**: Fetches HDRIs from Polyhaven based on environmental context.

**Key Features**:
- API client for Polyhaven
- Smart HDRI selection by location, time, and weather
- Response caching
- Fallback HDRIs

**Usage**:
```javascript
const polyhavenService = require('./services/polyhavenService');

await polyhavenService.initialize();

const hdri = await polyhavenService.getHDRIForEnvironment(
  'urban',   // location
  'noon',    // time of day
  'clear'    // weather
);
```

#### 3. Environment Context Service (`backend/services/environmentContextService.js`)

**Purpose**: Analyzes specifications to extract environmental context.

**Key Features**:
- Detects location, time of day, weather, season
- Keyword-based analysis
- Context-aware lighting calculations

**Usage**:
```javascript
const environmentContextService = require('./services/environmentContextService');

const context = environmentContextService.analyzeContext(specifications);
// Returns: { location: 'urban', timeOfDay: 'noon', weather: 'clear', season: 'summer' }

const config = environmentContextService.getEnvironmentConfig(context);
// Returns full environment configuration with lighting parameters
```

#### 4. Material Mapping Service (`backend/services/materialMappingService.js`)

**Purpose**: Main integration service that enhances geometry with PBR materials.

**Key Features**:
- Integrates all services
- Enhances model parts with PBR specifications
- Assigns materials based on context

**Usage**:
```javascript
const materialMappingService = require('./services/materialMappingService');

await materialMappingService.initialize();

const { modelData, environmentConfig } = await materialMappingService.assignRealisticMaterials(
  modelData,
  specifications
);
```

### Frontend Systems

#### 1. Environment Materials (`frontend/src/materials/EnvironmentMaterials.js`)

**Enhanced Features**:
- PBR material creation
- Texture loading with caching
- Concurrent texture loading
- Memory management

**Usage**:
```javascript
import { EnvironmentMaterials } from './materials/EnvironmentMaterials';

const materials = new EnvironmentMaterials();

// Create PBR material
const material = await materials.createPBRMaterial({
  type: 'concrete',
  finish: 'rough',
  maps: {
    albedo: 'url...',
    normal: 'url...',
    roughness: 'url...',
    metalness: 'url...',
    ao: 'url...'
  },
  properties: {
    roughness: 0.9,
    metalness: 0.1,
    normalScale: 1.0
  }
});
```

#### 2. Texture Streaming System (`frontend/src/systems/TextureStreamingSystem.js`)

**Features**:
- Progressive texture loading
- LOD-based quality adjustment
- Memory management
- Automatic cleanup

**Usage**:
```javascript
import TextureStreamingSystem from './systems/TextureStreamingSystem';

const streaming = new TextureStreamingSystem();

// Load texture with priority
const texture = await streaming.loadTextureProgressive(url, 'high');

// Update LOD based on camera distance
streaming.updateTextureLOD(camera, objects);

// Get memory usage
const usage = streaming.getMemoryUsage();
console.log(`Using ${usage.currentMB} MB of ${usage.maxMB} MB`);
```

#### 3. Environment Lighting System (`frontend/src/systems/EnvironmentLightingSystem.js`)

**Features**:
- HDRI environment map loading
- Dynamic lighting by time of day
- Weather effects (fog, lighting adjustments)
- PMREMGenerator integration

**Usage**:
```javascript
import EnvironmentLightingSystem from './systems/EnvironmentLightingSystem';

const lighting = new EnvironmentLightingSystem(scene, renderer);

// Setup HDRI
await lighting.setupEnvironment(hdriUrl, intensity, blur);

// Update time of day
lighting.updateTimeOfDay('sunset');

// Apply weather
lighting.setWeatherEffects('foggy');
```

## Setup Instructions

### 1. Add Data Files

The system requires two data files that should be uploaded by users:

#### AmbientCG Materials CSV
**Location**: `backend/data/ambientcg-materials.csv`

**Format**:
```csv
assetId,name,category,tags,downloadAttribute,downloadLink,previewImage
Concrete034,Concrete 034,concrete,"concrete;rough;weathered",2K-JPG,https://ambientcg.com/get?file=Concrete034_2K-JPG,https://ambientcg.com/preview/Concrete034
```

**Download**: Visit [ambientcg.com](https://ambientcg.com) and export materials as CSV.

#### Polyhaven Swagger Spec (Optional)
**Location**: `backend/data/polyhaven-swagger.json`

**Purpose**: API specification for Polyhaven (optional, system has fallbacks)

**Download**: Visit [polyhaven.com/api](https://polyhaven.com/api) to get the Swagger JSON.

### 2. Configure Material Settings

Edit `backend/config/materialConfig.js` to customize:
- Material type mappings
- Finish types
- Resolution preferences
- Fallback materials
- Performance limits

### 3. Configure Render Settings

Edit `frontend/src/config/renderConfig.js` to adjust:
- Texture quality LOD levels
- Memory limits
- Loading priorities
- HDRI preferences

## Material Matching Logic

### Surface Type Detection

The system maps common material names to standard types:

| Standard Type | Variations |
|--------------|-----------|
| concrete | concrete, cement, plaster |
| brick | brick, masonry, clay_brick |
| glass | glass, window, transparent |
| metal | metal, steel, aluminum, iron |
| wood | wood, timber, lumber, oak, pine |
| stone | stone, granite, marble, limestone |

### Finish Detection

Finishes are automatically detected from material names and tags:

| Finish | Keywords |
|--------|----------|
| polished | polished, smooth, glossy, shiny |
| rough | rough, coarse, textured |
| weathered | weathered, aged, worn, old |
| new | new, clean, pristine, fresh |

### Context-Aware Selection

Materials are selected based on:
1. **Surface Type**: Matches the geometric part's material
2. **Finish**: Determined by context (exterior/interior, modern/old)
3. **Resolution**: Based on part importance and detail level
4. **Context**: Indoor materials are cleaner, outdoor are weathered

## Environment Context Detection

### Location Detection

Keywords trigger different environments:

| Location | Keywords |
|----------|----------|
| urban | city, urban, downtown, street, building |
| nature | forest, park, woods, nature, mountain |
| coastal | beach, coastal, ocean, sea, harbor |
| indoor | indoor, interior, inside, room, hall |

### Time of Day

Affects lighting intensity and color:

| Time | Sun Intensity | Color Tint |
|------|--------------|------------|
| sunrise | 0.8 | Orange (#FF9966) |
| noon | 1.5 | White (#FFFFFF) |
| sunset | 0.8 | Red-Orange (#FF8844) |
| night | 0.1 | Blue (#4444FF) |

### Weather Effects

Modifies lighting and adds atmospheric effects:

| Weather | Light Multiplier | Fog Density |
|---------|-----------------|-------------|
| clear | 1.0 | None |
| cloudy | 0.7 | 0.001 |
| rainy | 0.5 | 0.002 |
| foggy | 0.6 | 0.02 |

## Performance Optimization

### Memory Management

**Texture Memory Limits**:
- Default: 500MB
- Low memory threshold: 400MB (triggers cleanup)
- Automatic cleanup: Textures unused for 5 minutes

**Monitoring**:
```javascript
const usage = textureStreamingSystem.getMemoryUsage();
console.log(`Memory: ${usage.percentage.toFixed(1)}%`);
```

### LOD (Level of Detail)

Textures automatically adjust based on camera distance:

| Distance | Resolution |
|----------|-----------|
| < 10m | 4K |
| 10-50m | 2K |
| 50-100m | 1K |
| > 100m | 512 |

### Caching

- Material lookups are cached (max 100 materials)
- Textures are cached per URL
- HDRI responses cached for 1 hour

## Troubleshooting

### No Textures Loading

**Issue**: Materials appear as flat colors

**Solutions**:
1. Check if CSV file exists at `backend/data/ambientcg-materials.csv`
2. Check console for loading errors
3. Verify texture URLs are accessible (check CORS)
4. Check memory limits haven't been exceeded

**Fallback**: System automatically uses flat colors when textures fail

### High Memory Usage

**Issue**: Browser becomes slow or crashes

**Solutions**:
1. Reduce texture resolution in `renderConfig.js`
2. Lower memory limits
3. Enable more aggressive cleanup
4. Use lower quality preset

**Check memory**:
```javascript
const usage = textureStreamingSystem.getMemoryUsage();
if (usage.percentage > 80) {
  textureStreamingSystem.clearUnusedTextures();
}
```

### Wrong HDRI Selection

**Issue**: Scene has inappropriate lighting

**Solutions**:
1. Check environment context detection keywords
2. Verify Polyhaven service initialization
3. Check fallback HDRI configuration
4. Override with custom HDRI URL

**Manual override**:
```javascript
await environmentLighting.setupEnvironment(
  'https://custom-hdri-url.hdr',
  1.0,  // intensity
  0.0   // blur
);
```

### Slow Texture Loading

**Issue**: Textures take too long to load

**Solutions**:
1. Use lower resolution (1K instead of 4K)
2. Enable progressive loading
3. Reduce concurrent loading
4. Check network speed

**Configuration**:
```javascript
renderConfig.progressive.enabled = true;
renderConfig.progressive.lowResFirst = true;
```

## API Reference

### Backend

#### Material Library Service

```javascript
// Load database
await materialLibraryService.loadDatabase()

// Get material
const material = materialLibraryService.getMaterialForSurface(type, finish, resolution)

// Search
const results = materialLibraryService.searchMaterials(query, filters)

// Get by ID
const material = materialLibraryService.getMaterialById(id)

// Stats
const stats = materialLibraryService.getStats()
```

#### Polyhaven Service

```javascript
// Initialize
await polyhavenService.initialize()

// Get HDRI list
const hdris = await polyhavenService.getHDRIList(category, filters)

// Get HDRI for environment
const hdri = await polyhavenService.getHDRIForEnvironment(location, timeOfDay, weather)

// Get texture asset
const asset = await polyhavenService.getTextureAsset(assetId, resolution)
```

### Frontend

#### Environment Materials

```javascript
// Create PBR material
const material = await materials.createPBRMaterial(materialSpec)

// Load texture
const texture = await materials.loadTexture(url, options)

// Load texture set
const maps = await materials.loadTextureSet(urls)

// Dispose material
materials.disposeMaterial(materialId)

// Get memory usage
const usage = materials.getMemoryUsage()
```

#### Texture Streaming

```javascript
// Load progressively
const texture = await streaming.loadTextureProgressive(url, priority)

// Update LOD
streaming.updateTextureLOD(camera, objects)

// Clear unused
streaming.clearUnusedTextures()

// Get stats
const stats = streaming.getStats()
```

#### Environment Lighting

```javascript
// Setup environment
await lighting.setupEnvironment(hdriUrl, intensity, blur)

// Update time of day
lighting.updateTimeOfDay(timeOfDay)

// Set weather effects
lighting.setWeatherEffects(weatherType)

// Dispose
lighting.dispose()
```

## Best Practices

1. **Always initialize services**: Call `loadDatabase()` and `initialize()` on server startup
2. **Use caching**: Don't disable caching unless necessary
3. **Monitor memory**: Check usage regularly and clean up when needed
4. **Progressive loading**: Enable for better user experience
5. **Fallbacks**: Always provide fallback materials and HDRIs
6. **Error handling**: Catch errors and degrade gracefully
7. **Performance**: Use LOD and limit texture resolution for large scenes
8. **Testing**: Test with various material types and environments

## Examples

### Complete Flow

```javascript
// Backend: Generate model with materials
const specifications = await geminiService.analyzeTaxonomyPrompt(prompt);
const modelData = await aiService.generateModelData(specifications);
const { modelData: enhanced, environmentConfig } = await materialMappingService.assignRealisticMaterials(
  modelData,
  specifications
);

// Frontend: Apply materials and lighting
const materials = new EnvironmentMaterials();
const lighting = new EnvironmentLightingSystem(scene, renderer);

// Apply HDRI
await lighting.setupEnvironment(
  environmentConfig.hdri.url,
  environmentConfig.hdri.intensity,
  environmentConfig.hdri.blur
);

// Apply time and weather
lighting.updateTimeOfDay(environmentConfig.timeOfDay);
lighting.setWeatherEffects(environmentConfig.weather);

// Create material for each part
for (const part of enhanced.parts) {
  if (part.pbrMaterial) {
    const material = await materials.createPBRMaterial(part.pbrMaterial);
    mesh.material = material;
  }
}
```

## Contributing

When adding new features:

1. Update relevant service files
2. Add configuration options
3. Update this documentation
4. Add error handling and fallbacks
5. Test with various scenarios
6. Check performance impact

## License

This integration uses:
- **AmbientCG**: CC0 License (Public Domain)
- **Polyhaven**: CC0 License (Public Domain)
- All textures and HDRIs are freely usable for any purpose
