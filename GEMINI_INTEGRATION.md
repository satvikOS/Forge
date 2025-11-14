# Gemini API Integration Guide - Enhanced 3D Architectural Design Generation

## Overview

ArchDisc uses Google's Gemini API to generate comprehensive 3D architectural designs from natural language prompts. The enhanced integration now supports wireframe/rig data, detailed geometry specifications, multi-resolution LOD (Level of Detail), PBR materials, scene environment, and lighting configurations.

## Architecture

### Service Layer Structure

```
┌─────────────────────────────────────────┐
│         User Prompt                     │
│  "Design a modern glass office         │
│   building with 20 floors"             │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│      geminiService.js                   │
│  - analyzePrompt()                      │
│  - generateDesignSpecs()                │
│  - validate3DGeometryData()             │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│       aiService.js                      │
│  - processPrompt()                      │
│  - convertAIAnalysisToSpecs()           │
│  - applyWireframeData()                 │
│  - applyLODSpecs()                      │
│  - applySceneEnvironment()              │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│    geometryGenerator.js                 │
│  - generateFromSpec()                   │
│  - generateLODMesh()                    │
│  - wireframeToMesh()                    │
│  - applyRigToMesh()                     │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│      3D Model with:                     │
│  ✓ Wireframe & Rig                      │
│  ✓ Detailed Geometry                    │
│  ✓ LOD (720p-8K)                        │
│  ✓ PBR Materials                        │
│  ✓ Scene Environment                    │
│  ✓ Lighting Setup                       │
└─────────────────────────────────────────┘
```

## Enhanced Data Structures

### 1. Wireframe & Rig Data

The AI generates structural wireframe data that defines the skeleton of the 3D model:

```json
{
  "wireframe": {
    "controlVertices": [
      {
        "id": 0,
        "position": [0, 0, 0],
        "type": "corner"
      }
    ],
    "edges": [
      {
        "from": 0,
        "to": 1,
        "type": "structural"
      }
    ],
    "structuralSkeleton": [
      {
        "name": "main_frame",
        "vertices": [0, 1, 2, 3],
        "purpose": "support"
      }
    ],
    "pivotPoints": [
      {
        "name": "base_pivot",
        "position": [0, 0, 0],
        "parent": null
      }
    ],
    "transformHierarchy": [
      {
        "name": "root",
        "parent": null,
        "children": ["floor_1", "floor_2"]
      }
    ]
  }
}
```

**Purpose**: Provides pre-render structure for animation, transformation, and hierarchical modeling.

### 2. Detailed Geometry Specifications

```json
{
  "geometry": {
    "meshTopology": {
      "vertices": 10000,
      "faces": 8000,
      "normals": "smooth",
      "complexity": "high"
    },
    "uvMapping": {
      "channels": 2,
      "projection": "box",
      "tiling": [1, 1]
    },
    "subdivisionSurface": {
      "levels": 2,
      "algorithm": "catmull-clark"
    }
  }
}
```

**Purpose**: Defines mesh structure, UV mapping for textures, and subdivision settings for detail control.

### 3. Scene Environment & Lighting

```json
{
  "sceneEnvironment": {
    "context": "urban",
    "lighting": {
      "hdri": "midday",
      "keyLights": [
        {
          "type": "sun",
          "intensity": 5,
          "color": "#ffffff",
          "position": [100, 200, 100],
          "target": [0, 0, 0],
          "castShadow": true
        }
      ],
      "ambient": {
        "intensity": 0.5,
        "color": "#87ceeb"
      }
    },
    "atmosphere": "clear",
    "renderingContext": "architectural_visualization"
  }
}
```

**Purpose**: Sets up realistic lighting and environment for proper visualization.

### 4. LOD (Level of Detail) Specifications

```json
{
  "lod": {
    "720p": {
      "vertexReduction": 0.25,
      "simplifyGeometry": true,
      "subdivisionLevel": 0,
      "textureResolution": 1024
    },
    "1080p": {
      "vertexReduction": 0.5,
      "simplifyGeometry": false,
      "subdivisionLevel": 1,
      "textureResolution": 2048
    },
    "4K": {
      "vertexReduction": 0.75,
      "simplifyGeometry": false,
      "subdivisionLevel": 2,
      "textureResolution": 4096
    },
    "8K": {
      "vertexReduction": 1.0,
      "simplifyGeometry": false,
      "subdivisionLevel": 3,
      "textureResolution": 8192
    }
  }
}
```

**Purpose**: Enables multi-resolution rendering for optimal performance across different display resolutions.

### 5. PBR Materials & Rendering

```json
{
  "pbr": {
    "baseColor": "#808080",
    "metallic": 0.8,
    "roughness": 0.2,
    "normalMap": "concrete_normal.png",
    "aoMap": "concrete_ao.png",
    "displacementMap": null,
    "emissive": "#000000",
    "emissiveIntensity": 0,
    "opacity": 1.0,
    "clearcoat": 0.5,
    "clearcoatRoughness": 0.1
  },
  "shaderParameters": {
    "renderMode": "realistic",
    "materialType": "architectural",
    "detailLevel": "high"
  }
}
```

**Purpose**: Physically-based rendering materials for realistic visualization.

## Example Prompts & Expected Results

### Example 1: Modern Office Building

**Prompt:**
```
Design a modern glass office building with 20 floors, featuring a sleek steel frame, floor-to-ceiling windows, and a green roof terrace.
```

**Expected AI Response Includes:**
- Wireframe with 20 floor levels
- Structural skeleton for steel frame
- LOD meshes optimized for 720p-8K
- Glass PBR materials with high transparency and low roughness
- Urban environment with midday HDRI lighting
- UV mapping for facade panels

### Example 2: Contemporary House

**Prompt:**
```
Create a contemporary single-family house with a minimalist design, concrete walls, large windows, and an open floor plan.
```

**Expected AI Response Includes:**
- Wireframe defining room boundaries and structural walls
- Concrete PBR materials with high roughness
- Glass materials for windows
- Suburban environment with natural lighting
- LOD meshes for different viewing distances

### Example 3: Industrial Warehouse

**Prompt:**
```
Design an industrial warehouse with exposed steel beams, corrugated metal panels, and large sliding doors.
```

**Expected AI Response Includes:**
- Structural skeleton with exposed beam hierarchy
- Metal PBR materials with weathered appearance
- Industrial environment with spot lighting
- Detailed geometry for corrugated panels
- Multiple LOD levels for optimization

## API Methods

### geminiService.js

#### `analyzePrompt(prompt)`

Analyzes a design prompt and extracts comprehensive 3D architectural information.

**Input:** User prompt string  
**Output:** JSON object with scene, elements, wireframe, geometry, LOD, PBR, and environment data

**Features:**
- Extracts wireframe control vertices and edges
- Defines structural skeleton and pivot points
- Specifies LOD levels for multiple resolutions
- Sets up scene environment and lighting
- Defines PBR material properties

#### `generateDesignSpecs(prompt)`

Generates detailed design specifications including all 3D data structures.

**Input:** User prompt string  
**Output:** Comprehensive design specifications JSON

**Features:**
- All features of `analyzePrompt()` plus:
- Transform hierarchy for animations
- Shader parameters for rendering
- UV mapping specifications
- Subdivision surface settings

#### `validate3DGeometryData(data)`

Validates the structure and completeness of 3D geometry data returned by Gemini.

**Validation Checks:**
- Wireframe has control vertices and edges
- Geometry has mesh topology and UV mapping
- LOD includes all required resolutions (720p, 1080p, 4K, 8K)
- PBR materials have required fields (baseColor, metallic, roughness)
- Scene environment has lighting setup

### aiService.js

#### `convertAIAnalysisToSpecs(analysis)`

Converts AI analysis to design specifications, extracting enhanced 3D data.

**Extracts:**
- Wireframe data
- Geometry specifications
- LOD configurations
- PBR material properties
- Scene environment
- Shader parameters

#### `applyWireframeData(geometry, wireframe)`

Applies wireframe data to generated geometry for structural definition.

#### `applyLODSpecs(geometry, lod)`

Applies LOD specifications to enable multi-resolution rendering.

#### `applySceneEnvironment(geometry, environment)`

Applies scene environment including lighting and atmosphere.

### geometryGenerator.js

#### `generateLODMesh(baseMesh, resolution, lodSpec)`

Generates a mesh optimized for a specific resolution.

**Resolutions:** 720p, 1080p, 4K, 8K  
**Features:**
- Vertex reduction for lower resolutions
- Subdivision for higher resolutions
- Texture resolution adjustment

#### `wireframeToMesh(wireframe)`

Converts wireframe data (vertices, edges, skeleton) to a mesh structure.

#### `applyRigToMesh(mesh, rigData)`

Applies rig data (pivot points, transform hierarchy) to a mesh for animation support.

#### `generateAllLODLevels(baseMesh, lodSpecs)`

Generates all LOD levels (720p-8K) for a base mesh.

## Usage Flow

1. **User enters prompt** → e.g., "Design a modern glass office building"

2. **Backend processes request:**
   ```javascript
   // In routes/generate.js
   const specifications = await aiService.processPrompt(prompt);
   ```

3. **AI analyzes prompt:**
   ```javascript
   // In aiService.js
   const aiAnalysis = await gemini.analyzePrompt(prompt);
   const specs = this.convertAIAnalysisToSpecs(aiAnalysis);
   ```

4. **Enhanced specs include:**
   - Wireframe & rig data
   - Geometry specifications
   - LOD configurations
   - PBR materials
   - Scene environment

5. **Geometry generation:**
   ```javascript
   // In aiService.js
   const modelData = await aiService.generateModelData(specifications);
   ```

6. **Apply enhancements:**
   ```javascript
   this.applyWireframeData(geometry, wireframe);
   this.applyLODSpecs(geometry, lod);
   this.applySceneEnvironment(geometry, environment);
   ```

7. **Return complete 3D model** with all enhancements ready for rendering at any resolution

## Error Handling

### Gemini API Failures

The service includes comprehensive error handling:

1. **Retry Logic**: Up to 3 retries with exponential backoff
2. **Validation**: Checks for required 3D data fields
3. **Fallback**: Uses `generateDesignSpecs()` if `analyzePrompt()` fails
4. **Logging**: Detailed console logs for debugging

### Missing Data Handling

If AI doesn't provide complete 3D data:

- **Wireframe**: System uses default geometry generation
- **LOD**: Falls back to standard LOD levels
- **PBR**: Uses default material properties
- **Environment**: Uses studio lighting setup

### Validation Warnings

The `validate3DGeometryData()` method logs warnings for:
- Missing wireframe vertices or edges
- Incomplete LOD specifications
- Missing PBR fields
- Absent lighting data

These warnings help identify areas where the AI response may be incomplete.

## Configuration

### Environment Variables

```bash
GEMINI_API_KEY=your_api_key_here
```

Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

### Model Configuration

The service uses `gemini-pro` model for optimal performance with 3D design generation.

## Best Practices

### Writing Effective Prompts

1. **Be Specific:**
   ```
   ❌ "Design a building"
   ✅ "Design a modern glass office building with 20 floors and steel frame"
   ```

2. **Include Details:**
   ```
   ❌ "Create a house"
   ✅ "Create a contemporary house with concrete walls, large windows, minimalist design, and open floor plan"
   ```

3. **Specify Materials:**
   ```
   ❌ "Make a structure"
   ✅ "Make a structure with exposed steel beams, corrugated metal panels, and glass curtain walls"
   ```

4. **Mention Environment:**
   ```
   ❌ "Design a car showroom"
   ✅ "Design a car showroom with dramatic studio lighting and reflective polished concrete floors"
   ```

### Optimizing LOD Usage

- Use **720p** for: Mobile devices, low-end hardware, distant objects
- Use **1080p** for: Standard desktop viewing, web applications
- Use **4K** for: High-resolution displays, detailed inspection
- Use **8K** for: Professional visualization, marketing materials, close-ups

### Material Selection

- **Glass**: High metallic (0.1), low roughness (0.1), high opacity
- **Metal**: High metallic (0.9), medium roughness (0.3-0.5)
- **Concrete**: Low metallic (0.0), high roughness (0.7-0.9)
- **Wood**: Low metallic (0.0), medium roughness (0.5-0.7)

## Troubleshooting

### "Failed to generate design"

**Possible causes:**
1. Missing or invalid `GEMINI_API_KEY`
2. API quota exceeded
3. Network connectivity issues
4. Invalid prompt format

**Solutions:**
1. Check `.env` file has valid API key
2. Monitor API usage in Google AI Studio
3. Check network connection
4. Simplify prompt and try again

### Incomplete 3D data

**Symptoms:**
- Warnings in console logs
- Missing wireframe or LOD data

**Solutions:**
1. Make prompt more specific
2. Include material and structural details
3. Check validation warnings in logs
4. Try alternative phrasing

### Low-quality geometry

**Possible causes:**
1. Insufficient detail in prompt
2. LOD level too low
3. Vertex reduction too aggressive

**Solutions:**
1. Add more architectural details to prompt
2. Use higher LOD level (4K/8K)
3. Adjust vertex reduction factor

## Future Enhancements

- [ ] Support for custom LOD configurations
- [ ] Advanced rig animation parameters
- [ ] Procedural texture generation
- [ ] Real-time lighting adjustment
- [ ] Multi-material assignment per element
- [ ] Advanced subdivision algorithms
- [ ] Export to industry-standard formats (FBX, USD)

## Resources

- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [PBR Material Guide](https://substance3d.adobe.com/tutorials/courses/the-pbr-guide-part-1)
- [LOD Optimization Best Practices](https://docs.unity3d.com/Manual/LevelOfDetail.html)
- [ArchDisc 3D Editor Guide](./3D_EDITOR_GUIDE.md)

## Support

For issues or questions:
1. Check console logs for detailed error messages
2. Review validation warnings
3. Verify API key configuration
4. Open an issue on GitHub with relevant logs

---

**Last Updated:** 2025-11-14  
**Version:** 2.0.0 - Enhanced 3D Integration
