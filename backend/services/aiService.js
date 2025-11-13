const { GoogleGenerativeAI } = require('@google/generative-ai');
const geometryGenerator = require('./geometryGenerator');
const sceneComposer = require('./sceneComposer');

class AIService {
  constructor() {
    this.isDemoMode = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'demo-mode';
    
    if (!this.isDemoMode) {
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
    }
  }

  /**
   * Process natural language prompt to generate design specifications
   */
  async processPrompt(prompt) {
    if (this.isDemoMode) {
      return this.generateDemoResponse(prompt);
    }

    try {
      const systemPrompt = `You are an expert architectural 3D design AI assistant for ArchDisc. 
Your task is to interpret user prompts and generate detailed structured design specifications.

For architectural scenes, respond with JSON containing:
- objectType: 'building', 'room', 'cityscape', 'furniture', 'car', or specific architectural element
- description: detailed description of the design
- sceneType: 'single' (one object) or 'multi' (complex scene with multiple objects)
- objects: array of objects in the scene (for multi-object scenes)
- dimensions: measurements in millimeters
- materials: array of materials to use
- style: architectural/design style
- detailLevel: 'low', 'medium', or 'high' (affects polygon count)
- lighting: lighting specifications
- environment: environment settings

For single objects, provide:
{
  "objectType": "type",
  "description": "description",
  "sceneType": "single",
  "dimensions": { "width": 1000, "height": 1000, "depth": 1000 },
  "materials": ["material1", "material2"],
  "style": "modern",
  "detailLevel": "medium"
}

For complex scenes (like "office building interior" or "cityscape"), provide:
{
  "objectType": "scene_type",
  "description": "description",
  "sceneType": "multi",
  "objects": [
    { "type": "wall", "dimensions": {...}, "position": {...}, "material": "..." },
    { "type": "window", "dimensions": {...}, "position": {...}, "material": "..." },
    ...
  ],
  "style": "modern",
  "detailLevel": "medium",
  "lighting": { "ambient": {...}, "directional": [...] },
  "environment": { "fog": {...}, "background": {...} }
}

Respond ONLY with valid JSON.`;

      const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}\n\nRespond with JSON:`;
      
      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();
      
      return this.parseAIResponse(text, prompt);
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return this.generateDemoResponse(prompt);
    }
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content, prompt = '') {
    try {
      // Remove markdown code blocks if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }
      
      // Try to parse as JSON
      const parsed = JSON.parse(jsonStr);
      
      // Ensure required fields exist
      if (!parsed.sceneType) {
        parsed.sceneType = parsed.objects && parsed.objects.length > 1 ? 'multi' : 'single';
      }
      
      return parsed;
    } catch (e) {
      console.error('Error parsing AI response:', e);
      // If not JSON, extract information from text and generate demo response
      return this.generateDemoResponse(prompt || content);
    }
  }

  /**
   * Generate demo response for testing without API key
   */
  generateDemoResponse(prompt) {
    const objectType = this.extractObjectType(prompt);
    const lower = prompt.toLowerCase();
    
    // Check for complex scene requests
    if (lower.includes('office') || lower.includes('interior') || lower.includes('room')) {
      return {
        objectType: 'room',
        description: 'Modern office interior with furniture and windows',
        sceneType: 'multi',
        style: 'modern',
        detailLevel: 'medium',
        objects: [
          { type: 'floor', dimensions: { width: 8000, depth: 6000, thickness: 100 }, material: 'wood' },
          { type: 'wall', dimensions: { width: 8000, height: 3000, thickness: 200 }, position: { x: 0, y: 0, z: -3000 }, material: 'concrete' },
          { type: 'wall', dimensions: { width: 6000, height: 3000, thickness: 200 }, position: { x: -4000, y: 0, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, material: 'concrete' },
          { type: 'wall', dimensions: { width: 6000, height: 3000, thickness: 200 }, position: { x: 4000, y: 0, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, material: 'concrete' },
          { type: 'window', dimensions: { width: 1500, height: 2000, depth: 100 }, position: { x: -2000, y: 1500, z: -3000 }, material: 'glass' },
          { type: 'window', dimensions: { width: 1500, height: 2000, depth: 100 }, position: { x: 2000, y: 1500, z: -3000 }, material: 'glass' },
          { type: 'door', dimensions: { width: 900, height: 2100, depth: 50 }, position: { x: 3500, y: 1050, z: 0 }, material: 'wood' }
        ],
        lighting: {
          ambient: { enabled: true, color: 0xffffff, intensity: 0.6 },
          directional: [{ enabled: true, color: 0xffffff, intensity: 0.8, position: { x: 5000, y: 10000, z: 5000 } }]
        }
      };
    }

    if (lower.includes('building') && (lower.includes('exterior') || lower.includes('cityscape') || lower.includes('tower'))) {
      return {
        objectType: 'building',
        description: 'Contemporary office building with glass facade',
        sceneType: 'multi',
        style: 'contemporary',
        detailLevel: 'medium',
        objects: [
          { type: 'building', dimensions: { width: 20000, height: 30000, depth: 15000 }, details: { numFloors: 10, windowsPerFloor: 8, doorsPerFloor: 2 }, material: 'concrete' },
          { type: 'stairs', dimensions: { width: 3000, totalHeight: 500, depth: 2000 }, details: { numSteps: 5 }, position: { x: 0, y: 0, z: 8500 }, material: 'marble' },
          { type: 'column', dimensions: { height: 3000, radius: 300 }, position: { x: -1500, y: 0, z: 8000 }, material: 'marble' },
          { type: 'column', dimensions: { height: 3000, radius: 300 }, position: { x: 1500, y: 0, z: 8000 }, material: 'marble' }
        ],
        lighting: {
          ambient: { enabled: true, color: 0xffffff, intensity: 0.5 },
          directional: [{ enabled: true, color: 0xffffff, intensity: 1.0, position: { x: 10000, y: 20000, z: 10000 } }]
        }
      };
    }

    if (lower.includes('cityscape') || lower.includes('city')) {
      return {
        objectType: 'cityscape',
        description: 'Modern cityscape with multiple buildings',
        sceneType: 'multi',
        style: 'modern',
        detailLevel: 'medium',
        objects: this.generateCityscapeObjects(),
        lighting: {
          ambient: { enabled: true, color: 0xffffff, intensity: 0.4 },
          directional: [{ enabled: true, color: 0xffffff, intensity: 0.9, position: { x: 20000, y: 30000, z: 20000 } }]
        }
      };
    }
    
    // Single object responses
    const responses = {
      car: {
        objectType: 'car',
        description: 'Modern electric sedan with aerodynamic design',
        sceneType: 'single',
        dimensions: { length: 4500, width: 1850, height: 1450 },
        materials: ['aluminum', 'carbon fiber', 'glass'],
        style: 'futuristic',
        detailLevel: 'medium',
        features: ['electric powertrain', 'autonomous driving', 'panoramic roof'],
      },
      building: {
        objectType: 'building',
        description: 'Contemporary office building with glass facade',
        sceneType: 'single',
        dimensions: { length: 30000, width: 20000, height: 50000 },
        materials: ['concrete', 'steel', 'glass', 'wood'],
        style: 'contemporary',
        detailLevel: 'medium',
        features: ['green roof', 'solar panels', 'open floor plan'],
      },
      furniture: {
        objectType: 'furniture',
        description: 'Ergonomic office chair with modern aesthetics',
        sceneType: 'single',
        dimensions: { width: 650, height: 1200, depth: 650 },
        materials: ['mesh', 'aluminum', 'foam'],
        style: 'minimalist',
        detailLevel: 'medium',
        features: ['adjustable height', 'lumbar support', 'swivel base'],
      },
    };

    return responses[objectType] || responses.furniture;
  }

  /**
   * Generate cityscape objects
   */
  generateCityscapeObjects() {
    const objects = [];
    const gridSize = 3;
    const spacing = 30000;

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        if (x % 2 === 1 && z % 2 === 1) {
          const height = 15000 + Math.random() * 25000;
          const width = 8000 + Math.random() * 8000;
          const depth = 8000 + Math.random() * 8000;

          objects.push({
            type: 'building',
            dimensions: { width, height, depth },
            details: {
              numFloors: Math.floor(height / 3000),
              windowsPerFloor: Math.floor(width / 1500)
            },
            position: {
              x: (x - gridSize / 2) * spacing,
              y: 0,
              z: (z - gridSize / 2) * spacing
            },
            material: 'concrete'
          });
        }
      }
    }

    // Ground plane
    objects.push({
      type: 'floor',
      dimensions: {
        width: gridSize * spacing * 1.5,
        depth: gridSize * spacing * 1.5,
        thickness: 100
      },
      position: { x: 0, y: -100, z: 0 },
      material: 'asphalt'
    });

    return objects;
  }

  /**
   * Extract object type from prompt
   */
  extractObjectType(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.includes('car') || lower.includes('vehicle') || lower.includes('automobile')) {
      return 'car';
    }
    if (lower.includes('building') || lower.includes('house') || lower.includes('structure')) {
      return 'building';
    }
    if (lower.includes('chair') || lower.includes('desk') || lower.includes('furniture')) {
      return 'furniture';
    }
    return 'object';
  }

  /**
   * Generate 3D model data from specifications
   */
  async generateModelData(specifications) {
    const { objectType, sceneType, objects, dimensions, materials, detailLevel } = specifications;

    // Handle multi-object scenes
    if (sceneType === 'multi' && objects && objects.length > 0) {
      const scene = await sceneComposer.generateScene({
        objects,
        environment: specifications.environment || {},
        lighting: specifications.lighting || {},
        camera: specifications.camera || {}
      });

      return {
        sceneType: 'multi',
        scene,
        metadata: specifications,
      };
    }

    // Handle single objects with advanced geometry
    const geometry = await this.generateGeometry(objectType, dimensions, detailLevel);
    
    return {
      sceneType: 'single',
      geometry,
      materials: materials || ['default'],
      metadata: specifications,
    };
  }

  /**
   * Generate geometry for different object types using advanced generator
   */
  async generateGeometry(objectType, dimensions, detailLevel = 'medium') {
    // Use the advanced geometry generator for architectural components
    const architecturalTypes = ['wall', 'window', 'door', 'stairs', 'railing', 'column', 'floor', 'roof', 'building'];
    
    if (architecturalTypes.includes(objectType)) {
      return await geometryGenerator.generate({
        type: objectType,
        dimensions,
        details: { detailLevel }
      });
    }

    // Fallback to basic geometry for non-architectural objects
    switch (objectType) {
      case 'car':
        return {
          type: 'composite',
          parts: [
            { type: 'box', dimensions: { x: dimensions.length * 0.8, y: dimensions.height * 0.5, z: dimensions.width }, position: { x: 0, y: 0, z: 0 } },
            { type: 'box', dimensions: { x: dimensions.length * 0.4, y: dimensions.height * 0.3, z: dimensions.width * 0.9 }, position: { x: dimensions.length * 0.1, y: dimensions.height * 0.5, z: 0 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: dimensions.length * 0.3, y: -dimensions.height * 0.3, z: dimensions.width * 0.4 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: dimensions.length * 0.3, y: -dimensions.height * 0.3, z: -dimensions.width * 0.4 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: -dimensions.length * 0.3, y: -dimensions.height * 0.3, z: dimensions.width * 0.4 } },
            { type: 'sphere', radius: dimensions.height * 0.3, position: { x: -dimensions.length * 0.3, y: -dimensions.height * 0.3, z: -dimensions.width * 0.4 } },
          ],
        };
      case 'furniture':
        return {
          type: 'composite',
          parts: [
            { type: 'box', dimensions: { x: dimensions.width, y: dimensions.height * 0.1, z: dimensions.depth }, position: { x: 0, y: dimensions.height * 0.5, z: 0 } },
            { type: 'cylinder', radius: dimensions.width * 0.05, height: dimensions.height * 0.4, position: { x: 0, y: 0, z: 0 } },
          ],
        };
      default:
        return {
          type: 'box',
          dimensions: { x: dimensions.width || 10, y: dimensions.height || 10, z: dimensions.depth || dimensions.length || 10 },
        };
    }
  }
}

module.exports = new AIService();
