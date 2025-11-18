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
   * Direct AI-only approach - NO FALLBACKS
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
    console.log('🔍 Starting taxonomy-aware AI analysis...');
    
    // Use only taxonomy-aware analysis - fastest and most comprehensive
    try {
      const taxonomyAnalysis = await this.gemini.analyzeTaxonomyPrompt(prompt);
      
      if (!taxonomyAnalysis || !taxonomyAnalysis.primaryCategory) {
        throw new Error('Taxonomy analysis returned incomplete data');
      }
      
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
      
    } catch (error) {
      console.error('❌ Taxonomy AI analysis failed:', {
        message: error.message,
        stack: error.stack,
      });
      console.error('=== End AI Service Processing (FAILED) ===\n');
      throw new Error(`AI generation failed: ${error.message}. Please try again or check your API configuration.`);
    }
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
   * Now includes taxonomyData for consistent handling
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
      
      // Include taxonomy data even for non-taxonomy responses
      // This ensures consistent handling in the frontend
      taxonomyData: {
        primaryCategory: firstElement.type || scene.type || 'object',
        scale: { type: scene.complexity || 'medium' },
        style: { architectural: scene.style || 'modern' },
        elements: analysis.elements || [],
        spatialComposition: { layout: scene.layout || 'organic' },
        realism: { detailLevel: analysis.requirements?.detailLevel || 'medium' }
      }
    };
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
