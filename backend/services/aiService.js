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
    console.log('\n========================================');
    console.log('🤖 AI SERVICE: PROCESSING PROMPT');
    console.log('========================================');
    console.log('📝 Prompt:', prompt);
    console.log('🔧 APIs Available:');
    console.log('   ✓ Gemini:', !!process.env.GEMINI_API_KEY);
    console.log('   ✓ Mapbox:', !!process.env.MAPBOX_ACCESS_TOKEN);
    console.log('   ✓ Sketchfab:', !!process.env.SKETCHFAB_API_TOKEN);
    console.log('========================================\n');
    
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
    const { objectType, dimensions, materials, elements, scene, objectCount, realWorldData, realBuildings, realDimensions } = specifications;

    // PRIORITY 0: Check if AI 3D generation is enabled for highly realistic models
    const enableAI3D = process.env.ENABLE_AI_3D_GENERATION === 'true';
    const hasTripoKey = !!process.env.TRIPO_API_KEY;
    const hasMeshyKey = !!process.env.MESHY_API_KEY;
    const hasVertexKey = !!process.env.GOOGLE_CLOUD_PROJECT_ID;
    
    if (enableAI3D && (hasTripoKey || hasMeshyKey || hasVertexKey)) {
      console.log('🤖 AI 3D Generation enabled - attempting to use AI APIs for photorealistic model');
      console.log('   Available APIs:', {
        tripo: hasTripoKey,
        meshy: hasMeshyKey,
        vertexImagen: hasVertexKey
      });
      
      try {
        const ai3DOrchestrator = require('./ai3DOrchestrator');
        
        // Create prompt from specifications
        const generationPrompt = specifications.description || 
                                specifications.name || 
                                (realDimensions ? `${realDimensions.name || 'landmark'} with height ${realDimensions.height}m` : null) ||
                                'architectural structure';
        
        // Create options object
        const generationOptions = {
          mode: process.env.DEFAULT_GENERATION_MODE || 'ultra_cheap',
          specifications: specifications,
          realWorldData: realWorldData,
          realDimensions: realDimensions,
          realBuildings: realBuildings
        };
        
        console.log('📤 Sending request to AI 3D orchestrator...');
        console.log('   Prompt:', generationPrompt);
        console.log('   Mode:', generationOptions.mode);
        
        const ai3DResult = await ai3DOrchestrator.generate(generationPrompt, generationOptions);
        
        if (ai3DResult && ai3DResult.success && ai3DResult.model) {
          console.log('✅ AI 3D generation successful!');
          console.log('   Source:', ai3DResult.source);
          console.log('   Provider:', ai3DResult.provider || ai3DResult.model.provider);
          console.log('   Quality:', ai3DResult.model.quality || 'standard');
          console.log('   Duration:', ai3DResult.duration, 'ms');
          if (ai3DResult.cost !== undefined) {
            console.log('   Cost:', '$' + ai3DResult.cost.toFixed(4));
          }
          
          return {
            geometry: {
              type: 'ai_generated',
              modelUrl: ai3DResult.model.modelUrl || ai3DResult.model.url,
              format: ai3DResult.model.format || 'glb',
              provider: ai3DResult.provider || ai3DResult.model.provider,
              quality: ai3DResult.model.quality || 'standard',
              source: ai3DResult.source
            },
            materials: materials || ['pbr_auto'],
            metadata: { 
              ...specifications, 
              aiGenerated: true,
              photorealistic: true,
              provider: ai3DResult.provider || ai3DResult.model.provider,
              source: ai3DResult.source,
              cost: ai3DResult.cost,
              duration: ai3DResult.duration
            },
            stats: { 
              vertices: 'high-detail',
              faces: 'high-detail',
              photorealistic: true
            },
          };
        } else {
          console.warn('⚠️  AI 3D generation returned no model, falling back to procedural');
        }
      } catch (error) {
        console.warn('⚠️  AI 3D generation failed, falling back to procedural:', error.message);
        if (process.env.NODE_ENV === 'development') {
          console.error('   Error details:', error);
        }
      }
    } else if (enableAI3D) {
      console.log('ℹ️  AI 3D Generation enabled but no API keys configured');
      console.log('   Add TRIPO_API_KEY, MESHY_API_KEY, or GOOGLE_CLOUD_PROJECT_ID to .env for photorealistic models');
    }
    
    console.log('🎨 Using procedural geometry generation');

    // PRIORITY 1: If we have real dimensions from Wikidata (specific landmark), create a single accurate building
    if (realDimensions && realDimensions.height) {
      console.log('📏 Using real dimensions for landmark generation');
      console.log('   Height:', realDimensions.height, 'm');
      console.log('   Width:', realDimensions.width || realDimensions.baseWidth || 'auto', 'm');
      
      const buildingElement = {
        type: 'building',
        name: specifications.name || 'Landmark',
        dimensions: {
          width: (realDimensions.width || realDimensions.baseWidth || realDimensions.height * 0.4) * 1000,
          height: realDimensions.height * 1000,
          depth: (realDimensions.depth || realDimensions.length || realDimensions.width || realDimensions.baseWidth || realDimensions.height * 0.4) * 1000,
        },
        materials: materials || ['steel', 'glass'],
        details: {
          buildingType: 'landmark',
          architecturalStyle: specifications.style || 'iconic',
          realWorldData: true,
          levels: Math.floor(realDimensions.height / 3), // Estimate levels from height
        },
      };

      const geometrySpec = {
        objectCount: 1,
        elements: [buildingElement],
        scene: {
          type: 'landmark_replica',
          isRealWorld: true,
          ...scene,
        },
        taxonomyData: specifications.taxonomyData,
        realWorldData: true,
      };

      const geometry = geometryGenerator.generateFromSpec(geometrySpec);
      
      return {
        geometry,
        materials: materials || ['steel', 'glass'],
        metadata: { ...specifications, usedRealWorldData: true, landmarkMode: true },
        stats: this.calculateStats(geometry),
      };
    }

    // PRIORITY 2: If we have real-world buildings from OSM (city scene), use them
    if (realBuildings && realBuildings.length > 0) {
      console.log('🏛️  Using real-world building data from OSM');
      console.log('   Building count:', realBuildings.length);
      
      // Convert OSM buildings to elements
      const buildingElements = realBuildings.map((building, index) => {
        // Use real dimensions if available
        const buildingHeight = building.height || building.levels * 3 || 15;
        const buildingDimensions = {
          width: building.geometry?.bbox?.width * 1000 || 20000,
          height: buildingHeight * 1000, // Convert to mm
          depth: building.geometry?.bbox?.depth * 1000 || 20000,
        };

        return {
          type: 'building',
          name: building.name || `Building_${index + 1}`,
          dimensions: buildingDimensions,
          materials: [building.material || 'concrete'],
          details: {
            buildingType: building.buildingType || 'commercial',
            architecturalStyle: building.architectural_style || 'modern',
            levels: building.levels || Math.floor(buildingHeight / 3),
            realWorldData: true,
            osmId: building.id,
          },
          position: building.center || { x: index * 25000, y: 0, z: 0 },
        };
      });

      const geometrySpec = {
        objectCount: buildingElements.length,
        elements: buildingElements,
        scene: {
          type: 'real_world_replica',
          isRealWorld: true,
          ...scene,
        },
        taxonomyData: specifications.taxonomyData,
        realWorldData: true,
      };

      const geometry = geometryGenerator.generateFromSpec(geometrySpec);
      
      return {
        geometry,
        materials: materials || ['concrete', 'glass', 'steel'],
        metadata: { ...specifications, usedRealWorldData: true, citySceneMode: true },
        stats: this.calculateStats(geometry),
      };
    }

    // PRIORITY 3: Standard generation (no real-world data)
    console.log('🎨 Using standard procedural generation');
    
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
