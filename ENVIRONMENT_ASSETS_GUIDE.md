# Environment Assets System Documentation

## Overview

The Environment Assets System provides a comprehensive library of 80+ procedurally generated environmental assets for creating rich, contextual 3D architectural scenes in ArchDisc.

## Architecture

### Core Components

1. **AssetManager** (`src/systems/AssetManager.js`)
   - Central registry for all environment assets
   - Asset loading and caching
   - Search and filtering capabilities
   - Category management

2. **EnvironmentMaterials** (`src/materials/EnvironmentMaterials.js`)
   - 22 realistic material definitions
   - Support for terrain, water, building, organic, and atmospheric materials
   - Material cloning and customization

3. **EnvironmentSystem** (`src/systems/EnvironmentSystem.js`)
   - Unified initialization system
   - Coordinates all generators and managers
   - Registers all assets and tools

### Procedural Generators

#### TerrainGenerator (`src/generators/TerrainGenerator.js`)
Generates landforms and geological features:
- Mountains, Hills, Valleys, Canyons
- Plains, Plateaus, Deserts
- Beaches, Cliffs, Boulders, Rocks
- Volcanoes

**Example:**
```javascript
const terrain = terrainGenerator.generateMountain({
  width: 20,
  depth: 20,
  height: 10,
  segments: 50,
  roughness: 0.7
});
```

#### WaterGenerator (`src/generators/WaterGenerator.js`)
Generates water bodies:
- Oceans, Seas, Rivers, Lakes, Ponds, Streams
- Bays, Glaciers, Wetlands, Waterfalls
- Canals, Reservoirs

**Example:**
```javascript
const water = waterGenerator.generateRiver({
  length: 50,
  width: 5,
  segments: 50,
  curvature: 0.3
});
```

#### VegetationGenerator (`src/generators/VegetationGenerator.js`)
Generates flora:
- Trees: Deciduous (Oak, Maple, Birch, Cherry), Coniferous (Pine, Spruce, Fir), Palm
- Plants: Shrubs, Grass, Flowers (Roses, Daisies, Tulips)
- Crops: Corn, Wheat, Rice
- Fungi: Mushrooms, Toadstools
- Supports instancing for performance

**Example:**
```javascript
const tree = vegetationGenerator.generateDeciduousTree({
  trunkHeight: 3,
  trunkRadius: 0.2,
  canopyRadius: 2,
  species: 'oak'
});
```

#### BuildingGenerator (`src/generators/BuildingGenerator.js`)
Generates buildings parametrically:
- Residential: Houses, Apartments, Huts
- Commercial: Skyscrapers, Shops
- Industrial: Warehouses, Factories
- Institutional: Schools, Hospitals, Churches, Stadiums

**Example:**
```javascript
const building = buildingGenerator.generateHouse({
  width: 8,
  depth: 10,
  height: 6,
  roofHeight: 3
});
```

#### RoadGenerator (`src/generators/RoadGenerator.js`)
Generates roads and paths:
- Highways, Streets, Paths, Sidewalks
- Bridges, Tunnels
- Parking Lots, Roundabouts, Intersections

**Example:**
```javascript
const road = roadGenerator.generateStreet({
  length: 50,
  width: 8
});
```

#### AtmosphericGenerator (`src/generators/AtmosphericGenerator.js`)
Generates atmospheric effects:
- Sky, Clouds, Sun, Moon, Stars
- Weather: Rain, Snow, Fog
- Phenomena: Rainbows, Lightning, Aurora
- Sunrise/Sunset effects

**Example:**
```javascript
const sky = atmosphericGenerator.generateSky({
  radius: 500,
  gradient: true
});
```

## Asset Categories

### 🌍 Abiotic (Non-Living) - 32 Assets

**Landforms:**
Mountain, Hill, Valley, Canyon, Plain, Plateau, Desert, Beach, Cliff, Boulder, Rock, Volcano

**Water Bodies:**
Ocean, Sea, River, Lake, Pond, Stream, Bay, Glacier, Wetland, Waterfall, Canal, Reservoir

**Atmospheric:**
Sky, Cloud, Cloud Layer, Sun, Moon, Stars, Rain, Snow, Fog, Rainbow, Lightning, Sunrise, Aurora

### 🌱 Biotic (Living) - 30 Assets

**Flora:**
- Trees: Oak, Maple, Birch, Cherry, Pine, Spruce, Fir, Palm
- Plants: Shrub, Grass, Grass Field (Instanced)
- Flowers: Rose, Daisy, Tulip
- Other: Moss, Corn, Wheat, Rice, Mushroom, Toadstool

**Fauna:** (Placeholders)
Human, Dog, Cat, Squirrel, Deer, Cattle, Whale, Birds, Insects, Fish, Reptiles, Amphibians

### 🏙️ Built Environment - 21 Assets

**Buildings:**
House, Apartment, Hut, Skyscraper, Shop, Warehouse, Factory, School, Hospital, Church, Stadium

**Roads:**
Highway, Street, Dirt Path, Gravel Path, Sidewalk, Bridge, Tunnel, Parking Lot, Roundabout, Intersection

**Infrastructure:** (Placeholders)
Fence, Streetlight, Traffic Light, Bench, Fountain, Statue, Trash Can, Playground, Dam, Power Lines, Cell Tower

## UI Components

### AssetBrowser (`src/components/AssetBrowser.jsx`)
- Categorized asset browser with tabs
- Search functionality
- Visual asset cards with icons
- Tag filtering
- Click to select and add assets

### EnvironmentPanel (`src/components/EnvironmentPanel.jsx`)
- Environment controls panel
- Asset browser integration
- Environment presets (Urban, Natural, Coastal, Desert, Industrial, Rural)

## Integration

The environment system is automatically initialized in `AdvancedWorkbench.jsx`:

```javascript
import { initializeEnvironmentSystem } from '../systems/EnvironmentSystem';

// In component
const [environmentSystem] = useState(() => {
  return initializeEnvironmentSystem();
});
```

All environment tools are automatically registered with the ToolManager and available through the toolbar.

## Usage Examples

### Adding an Asset

```javascript
// Get asset from manager
const asset = assetManager.getAsset('mountain');

// Generate the asset
const result = await asset.generate({
  width: 20,
  depth: 20,
  height: 10
});

// Result contains geometry and material
const { geometry, material } = result;
```

### Searching Assets

```javascript
// Search by query
const results = assetManager.searchAssets('tree');

// Get by category
const abioticAssets = assetManager.getAssetsByCategory('abiotic');

// Get by subcategory
const landforms = assetManager.getAssetsBySubcategory('abiotic', 'landforms');

// Filter by tags
const waterAssets = assetManager.filterAssetsByTags(['water']);
```

### Using Materials

```javascript
// Get a material
const grassMaterial = materialSystem.getMaterial('grass');

// Clone and customize
const customGrass = materialSystem.cloneMaterial('grass');
customGrass.color.set(0x2a5f1a);

// Update material color
materialSystem.updateMaterialColor('grass', 0x4a7c3e);
```

## Performance Considerations

- **Instancing**: Use instanced meshes for repeated assets (grass, trees, rocks)
- **LOD**: Generators create simplified geometries that can be used for LOD
- **Caching**: AssetManager caches generated assets to avoid regeneration
- **Lazy Loading**: Assets are only generated when requested
- **Material Sharing**: Multiple objects can share the same material instance

## Future Enhancements

1. **3D Model Loading**: Add support for GLTF/GLB/OBJ/FBX models
2. **Advanced Generators**: More sophisticated procedural algorithms (Perlin/Simplex noise)
3. **Texture Support**: Add texture mapping to materials
4. **Animation**: Animated assets (water flow, waving grass, clouds)
5. **Physics**: Integration with physics system for realistic behavior
6. **Environment Presets**: One-click scene generation
7. **Custom Assets**: User-uploadable assets
8. **Asset Variations**: Multiple variations per asset type

## File Structure

```
frontend/src/
├── assets/
│   └── environments/
│       ├── abiotic/index.js          # Abiotic asset definitions
│       ├── biotic/index.js           # Biotic asset definitions
│       └── built/index.js            # Built environment definitions
├── components/
│   ├── AssetBrowser.jsx              # Asset browser UI
│   └── EnvironmentPanel.jsx          # Environment panel UI
├── generators/
│   ├── TerrainGenerator.js           # Landform generation
│   ├── WaterGenerator.js             # Water body generation
│   ├── VegetationGenerator.js        # Plant generation
│   ├── BuildingGenerator.js          # Building generation
│   ├── RoadGenerator.js              # Road/path generation
│   └── AtmosphericGenerator.js       # Sky/weather generation
├── materials/
│   └── EnvironmentMaterials.js       # Material definitions
├── systems/
│   ├── AssetManager.js               # Asset registry
│   └── EnvironmentSystem.js          # System initialization
└── tools/
    └── EnvironmentTools.js           # Environment placement tools
```

## Closes Issues

- #30: Man-Made Environment (Built Environment) Assets
- #31: Natural Environment (Biotic - Living) Assets  
- #32: Natural Environment (Abiotic - Non-Living) Assets
