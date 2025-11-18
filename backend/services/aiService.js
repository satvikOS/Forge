const geminiService = require('./geminiService');
const geometryGenerator = require('./geometryGenerator');
const materialSystem = require('./materialSystem');
const taxonomySystem = require('./taxonomySystem');
const realWorldDataService = require('./realWorldDataService');

class AIService {
  constructor() {
    this.gemini = geminiService;
    this.taxonomy = taxonomySystem;
    this.realWorldData = realWorldDataService;
  }

  /**
   * Process natural language prompt to generate design specifications
   * Now with taxonomy-aware analysis and real-world data integration for comprehensive scene generation
   */
  async processPrompt(prompt) {
    console.log('\n=== 🎨 AI Service Processing Prompt ===');
    console.log('📝 Prompt:', prompt?.substring(0, 100) + (prompt?.length > 100 ? '...' : ''));
    
    // CRITICAL: Validate API is configured - NO FALLBACK TO DEMO MODE
    if (!this.gemini.isConfigured()) {
      console.error('❌ GEMINI_API_KEY not configured');
      throw new Error('❌ GEMINI_API_KEY not configured. Cannot generate without API. Please set GEMINI_API_KEY environment variable.');
    }
    
    console.log('✅ Gemini API configured - proceeding with AI generation');
    
    // Try taxonomy-aware AI analysis first (new comprehensive method)
    try {
      console.log('🔍 Attempting taxonomy-aware analysis...');
      const taxonomyAnalysis = await this.gemini.analyzeTaxonomyPrompt(prompt);
      if (taxonomyAnalysis && taxonomyAnalysis.primaryCategory) {
        console.log('✅ Taxonomy analysis successful');
        
        // Apply real-world patterns and data
        console.log('🌍 Enhancing with real-world data...');
        const realWorldRecommendations = this.realWorldData.analyzeForRealWorldPatterns(taxonomyAnalysis);
        
        // Apply real-world patterns to elements
        if (taxonomyAnalysis.elements && realWorldRecommendations) {
          taxonomyAnalysis.elements = this.realWorldData.applyRealWorldPatterns(
            taxonomyAnalysis.elements,
            realWorldRecommendations
          );
          
          // Store real-world recommendations in taxonomy data
          taxonomyAnalysis.realWorldData = realWorldRecommendations;
        }
        
        const specs = this.convertTaxonomyAnalysisToSpecs(taxonomyAnalysis);
        console.log('=== End AI Service Processing ===\n');
        return specs;
      }
      console.log('⚠️  Taxonomy analysis returned null or incomplete, trying fallback...');
    } catch (error) {
      console.error('❌ Error with taxonomy analysis:', {
        message: error.message,
        stack: error.stack,
      });
    }
    
    // Try AI analysis (existing method)
    try {
      console.log('🔍 Attempting Gemini analyzePrompt...');
      const aiAnalysis = await this.gemini.analyzePrompt(prompt);
      if (aiAnalysis) {
        console.log('✅ AI analysis successful:', JSON.stringify(aiAnalysis, null, 2));
        const specs = this.convertAIAnalysisToSpecs(aiAnalysis);
        console.log('=== End AI Service Processing ===\n');
        return specs;
      }
      console.log('⚠️  AI analysis returned null, trying fallback...');
    } catch (error) {
      console.error('❌ Error with Gemini analyzePrompt:', {
        message: error.message,
        stack: error.stack,
      });
    }
    
    // Try design specs generation as fallback
    try {
      console.log('🔄 Falling back to generateDesignSpecs...');
      const designSpecs = await this.gemini.generateDesignSpecs(prompt);
      if (designSpecs) {
        console.log('✅ Design specs generation successful:', JSON.stringify(designSpecs, null, 2));
        console.log('=== End AI Service Processing ===\n');
        return designSpecs;
      }
      console.log('⚠️  Design specs generation returned null');
    } catch (error) {
      console.error('❌ Error with generateDesignSpecs:', {
        message: error.message,
        stack: error.stack,
      });
    }
    
    console.error('=== End AI Service Processing (FAILED) ===\n');
    throw new Error('Failed to generate design from AI. All analysis methods failed. Please check API configuration and try again.');
  }
  
  /**
   * Convert taxonomy-aware AI analysis to design specifications
   * Handles comprehensive scene data with realistic placement
   */
  convertTaxonomyAnalysisToSpecs(analysis) {
    const { primaryCategory, scale, style, elements, spatialComposition, realism, environmentalContext } = analysis;
    
    // Extract primary element for basic compatibility
    const primaryElement = elements?.[0] || {};
    
    return {
      // Original format compatibility
      objectType: primaryElement.category || primaryCategory || 'object',
      objectCount: elements?.reduce((sum, el) => sum + (el.quantity || 1), 0) || 1,
      name: primaryElement.name || 'Generated Scene',
      description: `${style?.architectural || 'Modern'} ${primaryCategory || 'scene'}`,
      dimensions: primaryElement.dimensions ? {
        width: (primaryElement.dimensions.width || 10) * 1000, // Convert to mm
        height: (primaryElement.dimensions.height || 10) * 1000,
        depth: (primaryElement.dimensions.depth || 10) * 1000
      } : { width: 10000, height: 10000, depth: 10000 },
      materials: primaryElement.materials || ['default'],
      style: style?.architectural || style?.theme || 'modern',
      features: primaryElement.features || [],
      
      // Enhanced taxonomy data
      taxonomyData: {
        primaryCategory,
        secondaryCategories: analysis.secondaryCategories || [],
        scale: scale || {},
        style: style || {},
        environmentalContext: environmentalContext || {},
        spatialComposition: spatialComposition || {},
        realism: realism || { detailLevel: 'medium' }
      },
      
      // All elements for multi-object generation
      elements: elements || [],
      
      // Scene metadata
      scene: {
        type: spatialComposition?.layout || 'organic',
        complexity: scale?.type || 'medium',
        style: style?.architectural || 'modern',
        scale: scale?.type || 'medium'
      },
      complexity: scale?.type || 'medium',
      detailLevel: realism?.detailLevel || 'high',
    };
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
   * Emergency fallback only - should rarely be used
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
