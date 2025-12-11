/**
 * Procedural Generation Engine
 * AI-powered world building and procedural content generation
 * Uses Gemini API to generate terrain, structures, and environmental objects
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class ProceduralGenerationEngine {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-3-pro' });
    }

    /**
     * Generate procedural terrain
     * @param {Object} options - Terrain generation options
     * @returns {Object} Terrain mesh data
     */
    async generateTerrain(options = {}) {
        const {
            type = 'plains',
            size = { width: 100, depth: 100 },
            heightVariation = 'medium',
            features = [],
            biome = 'temperate',
        } = options;

        const prompt = `Generate procedural terrain data for a 3D scene.

Terrain Parameters:
- Type: ${type} (plains, hills, mountains, valleys, plateau, canyon)
- Size: ${size.width}m × ${size.depth}m
- Height Variation: ${heightVariation} (low, medium, high, extreme)
- Features: ${features.join(', ') || 'none'}
- Biome: ${biome}

Generate terrain as a heightmap with:
1. Grid resolution (vertices in X and Z)
2. Height values at each vertex
3. Material zones (grass, rock, sand, etc.)
4. Feature locations (rivers, paths, cliffs)

Return as JSON:
{
  "terrain": {
    "resolution": {"x": 50, "z": 50},
    "heightmap": [
      [0.0, 0.2, 0.5, ...],
      [0.1, 0.3, 0.6, ...],
      ...
    ],
    "materials": [
      {"zone": "base", "type": "grass", "coverage": 0.7},
      {"zone": "peaks", "type": "rock", "coverage": 0.3}
    ],
    "features": [
      {
        "type": "river",
        "path": [{"x": 0, "z": 25}, {"x": 100, "z": 30}],
        "width": 5
      }
    ],
    "bounds": {
      "minHeight": 0,
      "maxHeight": 50
    }
  }
}

Make the heightmap realistic with smooth transitions and natural-looking features.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to extract terrain JSON');
            }

            const terrainData = JSON.parse(jsonMatch[0]);

            console.log(`✅ Generated ${type} terrain: ${size.width}×${size.depth}m`);
            return {
                success: true,
                terrain: terrainData.terrain,
                metadata: {
                    type,
                    size,
                    biome,
                    generatedAt: new Date().toISOString(),
                }
            };

        } catch (error) {
            console.error('❌ Error generating terrain:', error);
            return {
                success: false,
                error: error.message,
                fallback: this.generateFlatTerrain(size),
            };
        }
    }

    /**
     * Generate procedural buildings/structures
     * @param {Object} options - Building generation options
     * @returns {Object} Building geometry data
     */
    async generateBuildings(options = {}) {
        const {
            count = 5,
            area = { width: 100, depth: 100 },
            buildingType = 'mixed',
            density = 'medium',
            style = 'modern',
            maxHeight = 50,
        } = options;

        const prompt = `Generate procedural buildings for an urban scene.

Parameters:
- Number of Buildings: ${count}
- Area: ${area.width}m × ${area.depth}m
- Building Type: ${buildingType} (residential, commercial, industrial, mixed)
- Density: ${density}
- Architectural Style: ${style}
- Max Height: ${maxHeight}m

Generate realistic buildings with:
1. Footprint positions (avoid overlap)
2. Dimensions (width, depth, height)
3. Floor count
4. Architectural details (windows, doors, roof type)
5. Material assignments

Return as JSON array:
{
  "buildings": [
    {
      "id": "building_001",
      "position": {"x": 10, "y": 0, "z": 15},
      "dimensions": {"width": 20, "depth": 15, "height": 30},
      "floors": 10,
      "type": "commercial",
      "architecture": {
        "roofType": "flat",
        "windowPattern": "grid",
        "entrances": [{"side": "front", "width": 3}]
      },
      "materials": {
        "walls": "concrete",
        "windows": "glass",
        "roof": "metal"
      }
    }
  ]
}

Ensure buildings don't overlap and follow urban planning principles.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const buildingData = JSON.parse(jsonMatch[0]);

            console.log(`✅ Generated ${buildingData.buildings.length} buildings`);
            return {
                success: true,
                buildings: buildingData.buildings,
                metadata: {
                    count,
                    style,
                    density,
                    generatedAt: new Date().toISOString(),
                }
            };

        } catch (error) {
            console.error('❌ Error generating buildings:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Generate procedural vegetation
     * @param {Object} options - Vegetation options
     * @returns {Object} Vegetation placement data
     */
    async generateVegetation(options = {}) {
        const {
            area = { width: 100, depth: 100 },
            density = 'medium',
            biome = 'temperate forest',
            types = ['trees', 'bushes', 'grass'],
            terrainData = null,
        } = options;

        const prompt = `Generate procedural vegetation distribution for a ${biome} scene.

Parameters:
- Area: ${area.width}m × ${area.depth}m
- Density: ${density}
- Biome: ${biome}
- Vegetation Types: ${types.join(', ')}

Generate realistic vegetation placement with:
1. Species variety (appropriate for biome)
2. Natural clustering patterns
3. Size variations
4. Density gradients

Return as JSON:
{
  "vegetation": [
    {
      "species": "oak_tree",
      "instances": [
        {
          "position": {"x": 5.2, "y": 0, "z": 8.3},
          "rotation": {"x": 0, "y": 45, "z": 0},
          "scale": {"x": 1.0, "y": 1.2, "z": 1.0},
          "age": "mature"
        }
      ]
    }
  ]
}

Create natural-looking distributions with clustering, avoid perfect grids.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const vegetationData = JSON.parse(jsonMatch[0]);

            const totalInstances = vegetationData.vegetation.reduce(
                (sum, species) => sum + species.instances.length, 0
            );

            console.log(`✅ Generated ${totalInstances} vegetation instances`);
            return {
                success: true,
                vegetation: vegetationData.vegetation,
                metadata: {
                    biome,
                    density,
                    totalInstances,
                    generatedAt: new Date().toISOString(),
                }
            };

        } catch (error) {
            console.error('❌ Error generating vegetation:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Generate complete procedural world
     * @param {Object} options - World generation options
     * @returns {Object} Complete world data
     */
    async generateWorld(options = {}) {
        const {
            worldType = 'natural',
            size = { width: 200, depth: 200 },
            features = ['terrain', 'vegetation', 'water'],
            theme = 'fantasy',
        } = options;

        console.log(`🌍 Generating procedural world: ${worldType} (${size.width}×${size.depth}m)`);

        const worldData = {
            terrain: null,
            buildings: null,
            vegetation: null,
            props: null,
        };

        try {
            // Generate terrain if requested
            if (features.includes('terrain')) {
                const terrainResult = await this.generateTerrain({
                    type: worldType === 'urban' ? 'plains' : 'hills',
                    size,
                    biome: theme,
                });
                if (terrainResult.success) {
                    worldData.terrain = terrainResult.terrain;
                }
            }

            // Generate buildings for urban worlds
            if (worldType === 'urban' && features.includes('buildings')) {
                const buildingsResult = await this.generateBuildings({
                    count: Math.floor((size.width * size.depth) / 1000),
                    area: size,
                    style: theme,
                });
                if (buildingsResult.success) {
                    worldData.buildings = buildingsResult.buildings;
                }
            }

            // Generate vegetation for natural worlds
            if (worldType === 'natural' && features.includes('vegetation')) {
                const vegetationResult = await this.generateVegetation({
                    area: size,
                    biome: theme,
                    terrainData: worldData.terrain,
                });
                if (vegetationResult.success) {
                    worldData.vegetation = vegetationResult.vegetation;
                }
            }

            console.log('✅ Procedural world generation complete');
            return {
                success: true,
                world: worldData,
                metadata: {
                    worldType,
                    size,
                    features,
                    theme,
                    generatedAt: new Date().toISOString(),
                }
            };

        } catch (error) {
            console.error('❌ Error generating world:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Generate environmental props (rocks, debris, furniture, etc.)
     * @param {Object} options - Props options
     * @returns {Object} Props placement data
     */
    async generateEnvironmentalProps(options = {}) {
        const {
            area = { width: 50, depth: 50 },
            propTypes = ['rocks', 'debris'],
            density = 'sparse',
            theme = 'natural',
        } = options;

        const prompt = `Generate environmental props for scene decoration.

Parameters:
- Area: ${area.width}m × ${area.depth}m
- Prop Types: ${propTypes.join(', ')}
- Density: ${density}
- Theme: ${theme}

Generate realistic prop placement with variety and natural distribution.
Return as JSON with prop instances including position, rotation, scale, and type.`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const propsData = JSON.parse(jsonMatch[0]);

            return {
                success: true,
                props: propsData,
            };

        } catch (error) {
            console.error('❌ Error generating props:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Fallback: Generate simple flat terrain
     */
    generateFlatTerrain(size) {
        const resolution = { x: 10, z: 10 };
        const heightmap = Array(resolution.z).fill(null).map(() =>
            Array(resolution.x).fill(0)
        );

        return {
            resolution,
            heightmap,
            materials: [{ zone: 'base', type: 'grass', coverage: 1.0 }],
            features: [],
            bounds: { minHeight: 0, maxHeight: 0 },
        };
    }
}

module.exports = new ProceduralGenerationEngine();
