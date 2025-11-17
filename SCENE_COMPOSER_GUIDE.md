# Scene Composer - Natural Language Environment Generation

## Overview

The **Scene Composer** system enables users to generate complete, coordinated 3D environments from natural language descriptions. Instead of placing individual objects one by one, users can describe an entire scene (e.g., "create a futuristic city") and the system will automatically generate and position multiple assets that work together cohesively.

## Features

### 🎨 Natural Language Understanding
- Parses user prompts to identify scene types
- Matches keywords to predefined scene templates
- Generates appropriate assets based on context

### 🏗️ Intelligent Scene Composition
- Automatically selects appropriate assets for each scene type
- Positions assets using intelligent layout algorithms (grid, organic, linear, cluster, floating)
- Applies appropriate scaling and variations
- Creates coordinated environments with multiple asset types

### 📋 Scene Templates

The system includes 8 predefined scene templates:

1. **Futuristic City**
   - Keywords: futuristic, future, sci-fi, modern, advanced, city
   - Assets: Skyscrapers, apartments, highways, streets, intersections, sky, clouds, palm trees
   - Layout: Grid pattern with building spacing

2. **Medieval Village**
   - Keywords: medieval, village, old, historical, ancient
   - Assets: Houses, huts, church, dirt paths, oak trees, shrubs, grass, mountains
   - Layout: Organic arrangement

3. **Industrial Complex**
   - Keywords: industrial, factory, warehouse, manufacturing
   - Assets: Factories, warehouses, highways, parking lots, plain terrain
   - Layout: Grid pattern with wide spacing

4. **Natural Landscape**
   - Keywords: natural, nature, forest, wilderness, landscape
   - Assets: Mountains, hills, pine/oak trees, shrubs, grass, rivers, lakes, boulders, sky, clouds
   - Layout: Organic distribution

5. **Coastal Town**
   - Keywords: coastal, beach, seaside, ocean, harbor
   - Assets: Houses, shops, beach, ocean, palm trees, streets, sky, sun
   - Layout: Linear along coastline

6. **Desert Outpost**
   - Keywords: desert, arid, sand, dunes, outpost
   - Assets: Desert terrain, huts, warehouses, dirt paths, boulders, rocks, sky, sun
   - Layout: Clustered arrangement

7. **Urban Park**
   - Keywords: park, urban park, city park, green space
   - Assets: Grass, oak/maple trees, shrubs, roses, gravel paths, pond, sky
   - Layout: Organic natural arrangement

8. **Space Station**
   - Keywords: space, station, orbital, spacecraft
   - Assets: Large scaled skyscrapers, stars, moon
   - Layout: Floating in 3D space

## Usage

### Basic Usage

```javascript
// Get the scene composer from environment system
const { sceneComposer } = environmentSystem;

// Generate a scene from natural language
const scene = await sceneComposer.generateSceneFromPrompt(
  "Create a futuristic city with tall buildings"
);

// Result contains:
// - scene.template: Template ID used
// - scene.theme: Theme name
// - scene.description: Scene description
// - scene.assets: Array of generated scene objects
// - scene.prompt: Original prompt
```

### Example Prompts

**Urban Environments:**
- "Create a futuristic city"
- "Generate a modern metropolitan area"
- "Build an advanced sci-fi cityscape"

**Historical Settings:**
- "Create a medieval village"
- "Generate an old historical town"
- "Build an ancient settlement"

**Natural Scenes:**
- "Create a natural forest landscape"
- "Generate a wilderness with mountains"
- "Build a nature scene with trees and rivers"

**Specialized Environments:**
- "Create a coastal town with beach"
- "Generate an industrial complex"
- "Build a desert outpost"
- "Create an urban park"

### UI Integration

The Scene Composer is accessible through the Environment Panel:

1. **Open Environment Panel** in the workbench
2. **Select "Scene Composer" tab** (🎨 icon)
3. **Enter your prompt** in the text area
4. **Click "Generate Scene"** button
5. Watch as multiple coordinated assets are created and positioned automatically

The UI also provides:
- Quick template buttons for common scene types
- Example prompts for inspiration
- Real-time generation status
- Summary of generated scenes

## Architecture

### SceneComposer Class

Located at: `frontend/src/systems/SceneComposer.js`

**Key Methods:**
- `generateSceneFromPrompt(prompt)` - Main entry point for scene generation
- `identifySceneTemplate(prompt)` - Matches prompt to template
- `composeScene(template, prompt)` - Generates coordinated assets
- `getAvailableScenes()` - Returns list of available templates

**Layout Algorithms:**
- `arrangeGrid()` - Regular grid pattern for urban scenes
- `arrangeOrganic()` - Natural, irregular distribution
- `arrangeLinear()` - Linear arrangement (for coastal scenes)
- `arrangeCluster()` - Grouped clustering
- `arrangeFloating()` - 3D space positioning (for space scenes)

### Scene Templates

Each template defines:
- **Keywords**: Terms to match in user prompts
- **Theme**: Scene theme identifier
- **Description**: Human-readable description
- **Assets**: List of asset types with counts and options
- **Layout**: Layout algorithm to use
- **Spacing**: Distance parameters for positioning

### Integration

**EnvironmentSystem Integration:**
```javascript
// Initialize with scene manager
const environmentSystem = initializeEnvironmentSystem(sceneManager);

// Scene composer is available
const { sceneComposer } = environmentSystem;
```

**UI Components:**
- `SceneComposerPanel.jsx` - Main UI for scene composition
- `EnvironmentPanel.jsx` - Integrates Scene Composer tab

## Asset Composition Rules

### Count Variation
Assets can have fixed or variable counts:
```javascript
{ type: 'building_house', count: { min: 8, max: 15 } }  // Random between 8-15
{ type: 'sky', count: 1 }  // Exactly 1
```

### Scaling
Assets can be scaled independently:
```javascript
{ 
  type: 'building_skyscraper', 
  scale: { x: 1.2, y: 1.5, z: 1.2 }  // 20% wider, 50% taller
}
```

### Custom Options
Pass options to asset generators:
```javascript
{
  type: 'grass',
  options: { width: 100, depth: 100 }  // Large grass field
}
```

### Distance Positioning
Control distance from center:
```javascript
{
  type: 'mountain',
  distance: 150  // Position far from scene center
}
```

## Performance Considerations

- Assets are generated asynchronously to avoid blocking
- Generation progress is shown in UI
- Scene composition uses existing asset caching
- Large scenes (30+ assets) may take several seconds
- Layout algorithms are optimized for typical scene sizes

## Extending the System

### Adding New Templates

```javascript
sceneComposer.sceneTemplates['my_custom_scene'] = {
  keywords: ['custom', 'special'],
  theme: 'custom',
  description: 'My custom scene type',
  assets: [
    { type: 'building_house', count: 5 },
    { type: 'tree_oak', count: 10 }
  ],
  layout: 'organic',
  spacing: { building: 20 }
};
```

### Adding New Layout Algorithms

```javascript
sceneComposer.compositionRules['spiral'] = {
  arrange: (assets, spacing) => {
    // Custom spiral arrangement logic
    assets.forEach((item, index) => {
      const angle = index * 0.5;
      const radius = index * 2;
      item.object.position.x = Math.cos(angle) * radius;
      item.object.position.z = Math.sin(angle) * radius;
    });
  },
  description: 'Arrange in spiral pattern'
};
```

## Example Workflow

1. **User enters prompt**: "Create a futuristic city"
2. **System identifies template**: Matches "futuristic" and "city" keywords
3. **Asset selection**: Chooses 8-15 skyscrapers, 5-10 apartments, roads, etc.
4. **Generation**: Creates each asset using procedural generators
5. **Positioning**: Applies grid layout with 25-unit building spacing
6. **Scene creation**: All objects added to scene manager
7. **Result**: Complete cityscape with coordinated assets

## Benefits

### For Users
- **Fast scene creation**: Generate complex environments in seconds
- **Consistency**: Assets are coordinated and work together
- **Natural interaction**: Use everyday language to describe scenes
- **Exploration**: Discover scene possibilities through templates

### For Development
- **Extensible**: Easy to add new templates and layouts
- **Modular**: Clean separation of concerns
- **Reusable**: Built on existing asset system
- **Maintainable**: Clear structure and documentation

## Future Enhancements

Potential improvements for the Scene Composer:

1. **AI Integration**: Use LLM for more sophisticated prompt understanding
2. **Style Variations**: Add style modifiers (realistic, cartoon, low-poly)
3. **Time-of-Day**: Automatic lighting and atmosphere based on time
4. **Weather**: Integrate weather effects based on scene type
5. **Terrain Integration**: Auto-generate terrain matching the scene
6. **Custom Templates**: Allow users to save their own templates
7. **Scene Editing**: Modify generated scenes with follow-up prompts
8. **Export/Import**: Save and share scene templates
9. **Preview**: Show scene preview before full generation
10. **Undo/Variations**: Generate multiple variations of same prompt

## Technical Details

**File Locations:**
- Core System: `frontend/src/systems/SceneComposer.js`
- UI Component: `frontend/src/components/SceneComposerPanel.jsx`
- Integration: `frontend/src/systems/EnvironmentSystem.js`

**Dependencies:**
- AssetManager (asset registry)
- Generators (procedural generation)
- SceneManager (object management)
- THREE.js (3D rendering)

**Size Impact:**
- SceneComposer: ~17KB
- SceneComposerPanel: ~8KB
- Total addition: ~25KB to bundle

## Conclusion

The Scene Composer transforms the 3D environment creation workflow from manual asset-by-asset placement to natural language-driven generation of complete, coordinated scenes. It demonstrates the power of combining procedural generation with intelligent composition rules to create rich, contextual 3D environments efficiently.
