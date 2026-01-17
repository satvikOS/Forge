# Quick Start Guide - Enhanced 3D Architectural Design Generation

## Overview

ArchDisc now generates comprehensive 3D architectural designs from natural language prompts with:
- ✅ Wireframe & rig data
- ✅ LOD for 720p-8K resolutions
- ✅ PBR materials
- ✅ Scene environment with lighting

## Getting Started

### 1. Set Up Your Environment

```bash
# Install dependencies
cd backend
npm install

# Configure API key
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

### 2. Start the Server

```bash
cd backend
npm start
```

The backend runs on http://localhost:5000

### 3. Test the Enhanced Integration

Run the mock test to verify everything works:

```bash
cd backend
node test-mock-integration.js
```

You should see:
```
✅ All Mock Tests Passed Successfully!
```

## Writing Effective Prompts

### ❌ Generic Prompts
```
"Design a building"
"Create a house"
"Make a structure"
```

### ✅ Enhanced Prompts
```
"Design a modern glass office building with 20 floors, featuring a sleek steel frame, floor-to-ceiling windows, and a green roof terrace."

"Create a contemporary single-family house with a minimalist design, concrete walls, large windows, and an open floor plan."

"Design an industrial warehouse with exposed steel beams, corrugated metal panels, and large sliding doors."
```

## Example Prompts & Use Cases

### Office Building
```
Prompt: "Design a modern glass office building with 20 floors"

Expected Output:
- Wireframe with 20 floor levels
- Steel frame structural skeleton
- LOD meshes for all resolutions
- Glass PBR materials (low roughness, high transparency)
- Urban environment with midday lighting
```

### Residential House
```
Prompt: "Create a contemporary house with concrete walls and large windows"

Expected Output:
- Room boundary wireframes
- Concrete PBR materials (high roughness)
- Glass materials for windows
- Suburban lighting setup
- LOD optimized for different viewing distances
```

### Industrial Structure
```
Prompt: "Design an industrial warehouse with exposed steel beams"

Expected Output:
- Exposed beam hierarchy in structural skeleton
- Metal PBR materials with weathered appearance
- Industrial spot lighting
- Detailed corrugated panel geometry
```

## API Usage

### Generate a Design

```javascript
// POST /api/generate
const response = await fetch('http://localhost:5000/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Design a modern glass office building with 20 floors',
    options: {
      targetResolution: '4K',
      renderingQuality: 'high'
    }
  })
});

const { jobId } = await response.json();
```

### Check Job Status

```javascript
// GET /api/generate/:jobId
const status = await fetch(`http://localhost:5000/api/generate/${jobId}`);
const job = await status.json();

if (job.status === 'completed') {
  const design = job.result.design;
  
  // Access enhanced 3D data
  console.log('Wireframe:', design.model.wireframe);
  console.log('LOD levels:', design.model.lod);
  console.log('Environment:', design.model.sceneEnvironment);
  console.log('PBR materials:', design.model.pbr);
}
```

## Understanding the Response

### Enhanced Design Object

```javascript
{
  design: {
    specifications: {
      objectType: "building",
      name: "Modern Glass Office Building",
      dimensions: { width: 30000, height: 40000, depth: 20000 },
      
      // Enhanced 3D data
      wireframe: {
        controlVertices: [...],  // Structural vertices
        edges: [...],            // Structural edges
        structuralSkeleton: [...], // Building skeleton
        pivotPoints: [...],      // Transform pivots
        transformHierarchy: [...] // Parent-child relationships
      },
      
      lod: {
        "720p": { vertexReduction: 0.25, ... },
        "1080p": { vertexReduction: 0.5, ... },
        "4K": { vertexReduction: 0.75, ... },
        "8K": { vertexReduction: 1.0, ... }
      },
      
      pbr: {
        baseColor: "#808080",
        metallic: 0.1,
        roughness: 0.1,
        // ... more material properties
      },
      
      sceneEnvironment: {
        context: "urban",
        lighting: {
          hdri: "midday",
          keyLights: [...],
          ambient: { intensity: 0.5, color: "#87ceeb" }
        }
      }
    },
    
    model: {
      geometry: { /* 3D mesh data */ },
      wireframe: { /* Applied wireframe */ },
      lod: { /* LOD configurations */ },
      environment: { /* Scene setup */ }
    }
  }
}
```

## LOD Selection Guide

Choose the appropriate LOD based on your use case:

| Resolution | Use Case | Vertex Reduction | Detail Level |
|------------|----------|------------------|--------------|
| **720p** | Mobile, low-end devices, distant objects | 25% | Simplified |
| **1080p** | Standard desktop, web applications | 50% | Standard |
| **4K** | High-res displays, detailed inspection | 75% | High |
| **8K** | Professional visualization, marketing | 100% | Maximum |

## Troubleshooting

### "Failed to generate design"

**Solution:**
1. Check `.env` has valid `GEMINI_API_KEY`
2. Verify network connectivity
3. Check API quota in Google AI Studio
4. Try a more specific prompt

### Missing 3D Data

**Solution:**
1. Make prompt more detailed
2. Include materials and structural details
3. Check console logs for validation warnings

### Low Quality Results

**Solution:**
1. Use higher LOD level (4K or 8K)
2. Add more architectural details to prompt
3. Specify materials explicitly

## Best Practices

### 1. Be Specific
Always include:
- Building type
- Style (modern, industrial, etc.)
- Materials (glass, steel, concrete)
- Key features (floors, windows, etc.)

### 2. Optimize LOD
- Use 720p for mobile and preview
- Use 1080p for standard viewing
- Use 4K/8K for final renders

### 3. Material Selection
- **Glass**: metallic: 0.1, roughness: 0.1
- **Metal**: metallic: 0.9, roughness: 0.3-0.5
- **Concrete**: metallic: 0.0, roughness: 0.7-0.9
- **Wood**: metallic: 0.0, roughness: 0.5-0.7

## Next Steps

1. **Explore Examples**: Try the example prompts above
2. **Read Full Documentation**: See [GEMINI_INTEGRATION.md](./GEMINI_INTEGRATION.md)
3. **Customize**: Adjust LOD settings and materials for your needs
4. **Integrate**: Use the API in your application

## Resources

- [Gemini Integration Guide](./GEMINI_INTEGRATION.md) - Complete technical documentation
- [3D Editor Guide](./3D_EDITOR_GUIDE.md) - Manual 3D editing tools
- [Google Gemini API](https://ai.google.dev/docs) - Official API documentation
- [PBR Materials Guide](https://substance3d.adobe.com/tutorials/courses/the-pbr-guide-part-1) - Learn about PBR

## Support

For issues or questions:
1. Check console logs for detailed errors
2. Review validation warnings
3. Verify API configuration
4. Open an issue on GitHub

---

**Ready to start?** Try your first prompt:

```bash
curl -X POST http://localhost:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Design a modern glass office building with 20 floors and steel frame"
  }'
```

**Happy designing! 🏗️✨**
