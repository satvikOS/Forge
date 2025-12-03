# Axel Engine Guide

## Overview

**Axel** is ArchDisc's proprietary 3D Voxel Engine that provides micron-level analysis and unprecedented realism for architectural visualizations. It implements Phase 2 of ArchDisc True Vision, analyzing every minute detail through multiple specialized layers.

## Architecture

### Core Components

#### 1. Voxel Engine (`backend/engines/axel/voxelEngine.js`)
Main coordinating engine that orchestrates all analysis modules.

**Key Features:**
- Adaptive resolution (1mm - 1μm)
- LOD (Level of Detail) support
- Configurable analysis layers
- Performance-optimized processing (3-10s target)

**Configuration:**
```javascript
const axelEngine = new AxelVoxelEngine({
  enabled: true,
  resolution: 'adaptive',
  maxVoxels: 100000000,
  lodLevels: [1000, 100, 10, 1, 0.1, 0.01], // mm to μm
  targetTime: 10000, // ms
  enableMetrology: true,
  enableChemical: true,
  enableFlaws: true,
  enableTooling: true,
  enableEnvironment: true
});
```

#### 2. Metrology Analyzer (`backend/engines/axel/metrologyAnalyzer.js`)
Provides micron-level geometric analysis and shape capture.

**Capabilities:**
- High-density point cloud generation (1M points/m²)
- Deviation measurement (±0.001mm tolerance)
- Surface profile analysis (Ra, Rz, Rq)
- Comparative analysis against references

**Output Example:**
```json
{
  "pointCloud": {
    "count": 100,
    "density": 1000000,
    "format": "XYZ"
  },
  "deviations": {
    "tolerance": 0.001,
    "maxDeviation": 0.0005,
    "averageDeviation": 0.0001
  },
  "surfaceProfile": {
    "roughness": { "ra": 0.0008, "rz": 0.004 }
  }
}
```

#### 3. Chemical Analyzer (`backend/engines/axel/chemicalAnalyzer.js`)
Matches exact material composition including alloys, polymers, and composites.

**Capabilities:**
- Elemental composition analysis
- Physical properties calculation
- Material certification lookup
- Era-appropriate material selection

**Material Types Supported:**
- Wrought iron (19th century)
- Structural steel (modern)
- Reinforced concrete
- Alloys and composites

**Output Example:**
```json
{
  "elements": {
    "iron": 99.4,
    "carbon": 0.08,
    "type": "wrought_iron",
    "era": "19th_century"
  },
  "properties": {
    "density": 7750,
    "tensileStrength": 340,
    "elasticity": 200
  }
}
```

#### 4. Flaw Simulator (`backend/engines/axel/flawSimulator.js`)
Simulates realistic aging, wear, and environmental damage.

**Capabilities:**
- Age-based wear calculation
- Surface scratch generation
- Weathering simulation (oxidation, corrosion, patina)
- Structural damage modeling
- UV and water damage

**Wear Levels:**
- 0-20 years: Light wear
- 20-50 years: Moderate wear
- 50-100 years: Heavy wear
- 100+ years: Critical condition

**Output Example:**
```json
{
  "wear": {
    "severity": 0.5,
    "type": "moderate",
    "areas": ["high-traffic", "exposed-surfaces"]
  },
  "scratches": {
    "count": 500
  },
  "weathering": {
    "oxidation": { "level": "moderate", "coverage": 0.5 },
    "patina": { "level": "developed" }
  }
}
```

#### 5. Tooling Analyzer (`backend/engines/axel/toolingAnalyzer.js`)
Generates period-correct manufacturing marks and surface finishes.

**Capabilities:**
- Era-based manufacturing method detection
- Tool mark pattern generation
- Surface finish quality calculation
- Historical context validation

**Manufacturing Methods:**
- Ancient: Hand-forged, hand-carved
- Medieval: Hand-crafted
- Industrial: Early-machine, mill-made
- Modern: CNC-machined
- Contemporary: 3D-printed, advanced manufacturing

**Output Example:**
```json
{
  "era": "industrial",
  "method": "hand-forged",
  "toolMarks": {
    "type": "hammer-marks",
    "density": "high",
    "depth": 0.5,
    "pattern": "random"
  },
  "surfaceFinish": {
    "roughness": 3.2,
    "quality": "rough",
    "grade": "N7"
  }
}
```

#### 6. Environmental Composer (`backend/engines/axel/environmentalComposer.js`)
Composes realistic environmental context including lighting and atmosphere.

**Capabilities:**
- Location-based climate data
- Time-of-day lighting calculation
- Weather-based atmospheric effects
- Seasonal variation
- Sun position calculation

**Times of Day:**
- Dawn: 3500K, 10,000 lux
- Noon: 5500K, 100,000 lux
- Dusk: 3000K, 5,000 lux
- Night: 4000K, 100 lux

**Output Example:**
```json
{
  "lighting": {
    "sunPosition": { "azimuth": 180, "elevation": 60 },
    "intensity": 100000,
    "colorTemperature": 5500
  },
  "atmosphere": {
    "fog": 0.1,
    "humidity": 0.5,
    "visibility": 20000
  },
  "climate": {
    "zone": "temperate",
    "averageTemperature": 15
  }
}
```

## Integration

### Backend Integration

The Axel engine is integrated into the generation pipeline at Stage 3.5 (after model refinement):

```javascript
// backend/routes/generate.js

const AxelVoxelEngine = require('../engines/axel/voxelEngine');

// Initialize engine
const axelEngine = new AxelVoxelEngine({
  enabled: process.env.AXEL_ENABLED !== 'false',
  resolution: process.env.AXEL_RESOLUTION || 'adaptive'
});

// In processGenerationJob function:
const axelAnalysis = await axelEngine.analyzeAndReplicate(
  aiData,
  realWorldReferences
);

// Include in result
const result = {
  design: {
    specifications,
    model: refined,
    axelAnalysis
  },
  axelAnalysis
};
```

### Frontend Integration

Use the `AxelViewer` component to display analysis results:

```jsx
import AxelViewer from './components/axel/AxelViewer';

function DesignView({ design }) {
  return (
    <div>
      {design.axelAnalysis && (
        <AxelViewer axelData={design.axelAnalysis} />
      )}
    </div>
  );
}
```

## Configuration

### Environment Variables

Add to `.env` file:

```env
# Axel Voxel Engine
AXEL_ENABLED=true
AXEL_RESOLUTION=adaptive
AXEL_MAX_VOXELS=100000000
AXEL_LOD_LEVELS=1000,100,10,1,0.1,0.01
AXEL_TARGET_TIME=10000

# Analysis Layer Controls
AXEL_ENABLE_METROLOGY=true
AXEL_ENABLE_CHEMICAL=true
AXEL_ENABLE_FLAWS=true
AXEL_ENABLE_TOOLING=true
AXEL_ENABLE_ENVIRONMENT=true
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `AXEL_ENABLED` | boolean | true | Enable/disable Axel engine |
| `AXEL_RESOLUTION` | string | 'adaptive' | Voxel resolution mode |
| `AXEL_MAX_VOXELS` | number | 100000000 | Maximum voxel count |
| `AXEL_LOD_LEVELS` | array | [1000...0.01] | LOD resolutions in mm |
| `AXEL_TARGET_TIME` | number | 10000 | Target processing time (ms) |
| `AXEL_ENABLE_METROLOGY` | boolean | true | Enable geometry analysis |
| `AXEL_ENABLE_CHEMICAL` | boolean | true | Enable material analysis |
| `AXEL_ENABLE_FLAWS` | boolean | true | Enable flaw simulation |
| `AXEL_ENABLE_TOOLING` | boolean | true | Enable tooling analysis |
| `AXEL_ENABLE_ENVIRONMENT` | boolean | true | Enable environment composition |

## Usage Examples

### Example 1: Eiffel Tower (Historical Landmark)

**Input:**
```javascript
const aiData = {
  name: 'Eiffel Tower',
  yearBuilt: 1889,
  location: 'Paris, France',
  style: 'industrial',
  weather: 'clear',
  timeOfDay: 'noon'
};

const axelAnalysis = await axelEngine.analyzeAndReplicate(aiData);
```

**Expected Output:**
- **Age:** 136 years
- **Material:** Wrought iron (Fe: 99.4%, C: 0.08%)
- **Wear:** Heavy (136 years of weathering)
- **Tooling:** Hand-forged hammer marks, 1889-era riveting
- **Environment:** Parisian temperate climate, clear noon lighting

### Example 2: Modern Glass Building

**Input:**
```javascript
const aiData = {
  name: 'Modern Office Tower',
  yearBuilt: 2020,
  style: 'contemporary',
  weather: 'cloudy',
  timeOfDay: 'afternoon'
};

const axelAnalysis = await axelEngine.analyzeAndReplicate(aiData);
```

**Expected Output:**
- **Age:** 5 years
- **Material:** Structural steel (A36 grade) + tempered glass
- **Wear:** Minimal
- **Tooling:** CNC-machined components, precision finish
- **Environment:** Urban atmosphere, afternoon overcast lighting

## API Reference

### AxelVoxelEngine Class

#### Constructor

```javascript
new AxelVoxelEngine(options)
```

**Parameters:**
- `options` (Object): Configuration options

#### Methods

##### `analyzeAndReplicate(aiData, realWorldReferences)`

Performs complete voxel analysis pipeline.

**Parameters:**
- `aiData` (Object): AI-generated design data
- `realWorldReferences` (Object|null): Optional real-world reference data

**Returns:** Promise<Object> - Complete voxel analysis

##### `generateVoxelModel(analysis)`

Generates voxel model from analysis data.

**Parameters:**
- `analysis` (Object): Combined analysis from all modules

**Returns:** Object - Voxel model with metadata

##### `isEnabled()`

Checks if engine is enabled.

**Returns:** boolean

##### `getStatus()`

Gets current engine status and configuration.

**Returns:** Object - Status information

## Performance

### Benchmarks

| Analysis Layer | Processing Time | Memory Usage |
|---------------|-----------------|--------------|
| Metrology | 50-200ms | 10-50MB |
| Chemical | 10-50ms | 5-10MB |
| Flaws | 100-500ms | 20-100MB |
| Tooling | 50-150ms | 5-20MB |
| Environment | 50-200ms | 10-30MB |
| **Total** | **3-10s** | **<2GB** |

### Optimization Tips

1. **Disable Unused Layers:** Set specific layer flags to false
2. **Adjust Resolution:** Use lower resolution for previews
3. **LOD Strategy:** Implement distance-based LOD switching
4. **Caching:** Cache analysis results for similar objects
5. **Parallel Processing:** Layers run in parallel by default

## Troubleshooting

### Issue: Analysis Takes Too Long

**Solution:**
- Reduce `AXEL_MAX_VOXELS`
- Disable non-critical layers
- Use 'coarse' resolution instead of 'adaptive'

### Issue: High Memory Usage

**Solution:**
- Lower `AXEL_MAX_VOXELS` limit
- Implement sparse voxel storage (already default)
- Clear voxel data after rendering

### Issue: No Analysis Results

**Solution:**
- Check `AXEL_ENABLED=true` in `.env`
- Verify all analyzers are initialized
- Check console logs for error messages

## Future Enhancements

### Planned Features
- GPU-accelerated voxel processing
- Real-time voxel manipulation
- Advanced weathering simulation with AI
- Material scanning integration
- Export to voxel formats (.vox, .qb)

### Research Areas
- Machine learning for wear pattern prediction
- Physics-based corrosion simulation
- Procedural patina generation
- Environmental impact modeling

## Contributing

When adding new analysis layers:

1. Create analyzer class in `backend/engines/axel/`
2. Implement async analysis method
3. Integrate into `voxelEngine.js`
4. Add configuration variables
5. Update frontend viewer
6. Add tests and documentation

## Support

For issues or questions:
- Check console logs for detailed error messages
- Review this guide thoroughly
- Check environment variable configuration
- Verify all dependencies are installed

## Credits

**Axel Voxel Engine** is part of ArchDisc True Vision Phase 2, implementing unprecedented realism through multi-layer micron-level analysis.

---

**Version:** 1.0.0  
**Last Updated:** 2025-11-23  
**License:** Proprietary
