const geminiService = require('./geminiService');
const geometryGenerator = require('./geometryGenerator');
const materialSystem = require('./materialSystem');

class AIService {
  constructor() {
    this.gemini = geminiService;
    this.isDemoMode = !geminiService.isConfigured();
  }

  /**
   * Process natural language prompt to generate design specifications
   */
  async processPrompt(prompt) {
    // Try Gemini first
    if (!this.isDemoMode) {
      try {
        const aiAnalysis = await this.gemini.analyzePrompt(prompt);
        if (aiAnalysis) {
          return this.convertAIAnalysisToSpecs(aiAnalysis);
        }
      } catch (error) {
        console.error('Error with Gemini analysis:', error);
      }
      
      // Try design specs generation as fallback
      try {
        const designSpecs = await this.gemini.generateDesignSpecs(prompt);
        if (designSpecs) {
          return designSpecs;
        }
      } catch (error) {
        console.error('Error generating design specs:', error);
      }
    }
    
    // Fall back to demo response
    return this.generateDemoResponse(prompt);
  }
  
  /**
   * Convert AI analysis to design specifications
   */
  convertAIAnalysisToSpecs(analysis) {
    const firstElement = analysis.elements?.[0] || {};
    const scene = analysis.scene || {};
    
    return {
      objectType: firstElement.type || scene.type || 'object',
      objectCount: analysis.objectCount || 1,
      name: firstElement.name || 'Generated Object',
      description: `${scene.style || 'Modern'} ${firstElement.type || 'object'}`,
      dimensions: firstElement.dimensions || { width: 1000, height: 1000, depth: 1000 },
      materials: firstElement.materials || analysis.requirements?.materials || ['default'],
      style: scene.style || 'modern',
      features: analysis.requirements?.features || [],
      elements: analysis.elements || [],
      scene: scene,
      complexity: scene.complexity || 'medium',
      detailLevel: analysis.requirements?.detailLevel || 'medium',
    };
  }

  /**
   * Parse AI response into structured format
   */
  parseAIResponse(content) {
    try {
      // Try to parse as JSON
      return JSON.parse(content);
    } catch (e) {
      // If not JSON, extract information from text
      return {
        objectType: this.extractObjectType(content),
        description: content,
        dimensions: { width: 10, height: 10, depth: 10 },
        materials: ['default'],
        style: 'modern',
      };
    }
  }

  /**
   * Generate demo response for testing without API key
   */
  generateDemoResponse(prompt) {
    const objectType = this.extractObjectType(prompt);
    
    const responses = {
      car: {
        objectType: 'car',
        description: 'Modern electric sedan with aerodynamic design',
        dimensions: { length: 4500, width: 1850, height: 1450 },
        materials: ['aluminum', 'carbon fiber', 'glass'],
        style: 'futuristic',
        features: ['electric powertrain', 'autonomous driving', 'panoramic roof'],
      },
      building: {
        objectType: 'building',
        description: 'Contemporary office building with glass facade',
        dimensions: { length: 30000, width: 20000, height: 50000 },
        materials: ['concrete', 'steel', 'glass', 'wood'],
        style: 'contemporary',
        features: ['green roof', 'solar panels', 'open floor plan'],
      },
      furniture: {
        objectType: 'furniture',
        description: 'Ergonomic office chair with modern aesthetics',
        dimensions: { width: 650, height: 1200, depth: 650 },
        materials: ['mesh', 'aluminum', 'foam'],
        style: 'minimalist',
        features: ['adjustable height', 'lumbar support', 'swivel base'],
      },
    };

    return responses[objectType] || responses.furniture;
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
    const { objectType, dimensions, materials, elements, scene, objectCount } = specifications;

    // Create specification object for geometry generator
    const geometrySpec = {
      objectCount: objectCount || 1,
      elements: elements && elements.length > 0 ? elements : [
        {
          type: objectType || 'object',
          name: specifications.name || 'Object',
          dimensions: dimensions || { width: 1000, height: 1000, depth: 1000 },
          materials: materials || ['default'],
          details: specifications.features || [],
        }
      ],
      scene: scene || {},
    };

    // Generate geometry
    const geometry = geometryGenerator.generateFromSpec(geometrySpec);
    
    // Apply materials to geometry parts
    if (geometry.type === 'composite' && geometry.parts) {
      geometry.parts = geometry.parts.map(part => 
        materialSystem.applyMaterial(part, part.material || materials?.[0] || 'default')
      );
    }
    
    return {
      geometry,
      materials: materials || ['default'],
      metadata: specifications,
      stats: this.calculateStats(geometry),
    };
  }
  
  /**
   * Calculate model statistics
   */
  calculateStats(geometry) {
    let partCount = 0;
    let totalVertices = 0;
    
    if (geometry.type === 'scene') {
      partCount = (geometry.meshes?.length || 0);
      if (geometry.instances) {
        geometry.instances.forEach(inst => {
          partCount += inst.count;
        });
      }
    } else if (geometry.type === 'composite') {
      partCount = geometry.parts?.length || 1;
    } else {
      partCount = 1;
    }
    
    // Rough estimate of vertices based on part count
    totalVertices = partCount * 24; // Average vertices per part
    
    return {
      partCount,
      estimatedVertices: totalVertices,
      estimatedFaces: totalVertices / 3,
    };
  }
}

module.exports = new AIService();
