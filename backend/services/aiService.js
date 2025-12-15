const bedrockService = require('./bedrockService');
const geometryGenerator = require('./geometryGenerator');
const materialSystem = require('./materialSystem');
const taxonomySystem = require('./taxonomySystem');
const realWorldDataService = require('./realWorldDataService');
const apiOrchestrator = require('./apiOrchestrator');
const geographicCoordinateService = require('./geographicCoordinateService');
const designMemoryService = require('./designMemoryService');
const landmarksConfig = require('../config/landmarks');

class AIService {
  constructor() {
    this.bedrock = bedrockService;
    this.taxonomy = taxonomySystem;
    this.realWorldData = realWorldDataService;
    this.orchestrator = apiOrchestrator;
    this.geographic = geographicCoordinateService;
    this.designMemory = designMemoryService;
  }

  /**
   * Process natural language prompt to generate design specifications
   * Now with COMPLETE integration: Wikipedia/Wikidata for landmarks, Geographic services for coordinates,
   * API Orchestrator for complex scenes, and AWS Bedrock for AI analysis
   */
  async processPrompt(prompt) {
    console.log('\n========================================');
    console.log('🤖 AI SERVICE: PROCESSING PROMPT');
    console.log('========================================');
    console.log('📝 Prompt:', prompt);
    console.log('🔧 APIs Available:');
    console.log('   ✓ AWS Bedrock:', !!process.env.AWS_ACCESS_KEY_ID);
    console.log('   ✓ Mapbox:', !!process.env.MAPBOX_ACCESS_TOKEN);
    console.log('   ✓ Sketchfab:', !!process.env.SKETCHFAB_API_TOKEN);
    console.log('   ✓ Geographic Services:', this.geographic.isEnabled());
    console.log('   ✓ API Orchestrator:', this.orchestrator.isEnabled());
    console.log('========================================\n');

    // NEW: Step 1 - Check for geographic coordinates in prompt
    const coordinateData = this.geographic.detectCoordinates(prompt);
    if (coordinateData && coordinateData.latitude !== undefined) {
      console.log('🗺️  GEOGRAPHIC COORDINATES DETECTED!');
      console.log(`   📍 Location: ${coordinateData.latitude}°, ${coordinateData.longitude}°`);

      try {
        // Analyze the coordinate using all map services
        const geographicAnalysis = await this.geographic.analyzeCoordinate(
          coordinateData.latitude,
          coordinateData.longitude,
          { radiusMeters: 500, includeStreetView: true }
        );

        if (geographicAnalysis && geographicAnalysis.analysis) {
          console.log('✅ Geographic analysis complete!');
          console.log(`   🏗️  Environment: ${geographicAnalysis.analysis.environmentType}`);
          console.log(`   📊 Characteristics: ${geographicAnalysis.analysis.characteristics.join(', ')}`);

          // Convert geographic data to scene elements
          const geographicElements = this.geographic.convertToSceneElements(geographicAnalysis);

          // Pass to Bedrock WITH real-world geographic data
          console.log('🤖 Passing geographic data to Bedrock for enhanced analysis...');
          const taxonomyAnalysis = await this.bedrock.analyzeTaxonomyPromptWithRealData(
            prompt,
            {
              source: 'geographic-coordinate',
              coordinates: coordinateData,
              elements: geographicElements,
              analysis: geographicAnalysis.analysis,
              buildings: geographicAnalysis.buildings || [],
              roads: geographicAnalysis.roads || [],
              trees: geographicAnalysis.trees || [],
              elevation: geographicAnalysis.elevation,
              weather: geographicAnalysis.weather
            }
          );

          if (taxonomyAnalysis && taxonomyAnalysis.primaryCategory) {
            // Merge geographic elements with AI-generated elements
            if (!taxonomyAnalysis.elements) taxonomyAnalysis.elements = [];
            taxonomyAnalysis.elements = [...geographicElements, ...taxonomyAnalysis.elements];
            taxonomyAnalysis.geographicData = geographicAnalysis;

            const specs = this.convertTaxonomyAnalysisToSpecs(taxonomyAnalysis);
            console.log('✅ Geographic coordinate scene generation complete!\n');
            return specs;
          }
        }
      } catch (error) {
        console.error('❌ Geographic analysis failed:', error.message);
        // Continue with other methods
      }
    }


    // NOTE: Landmark detection removed - AWS Bedrock Claude 3.5 has comprehensive
    // built-in knowledge of famous landmarks (Eiffel Tower, Burj Khalifa, etc.)
    // No need for external Wikipedia/Wikidata API calls

    // NEW: Step 2 - Check if API Orchestrator should be used (complex scenes)
    if (this.orchestrator.isEnabled() && this.shouldUseOrchestrator(prompt)) {
      console.log('🎭 COMPLEX SCENE DETECTED - Using API Orchestrator...');

      try {
        const orchestratedData = await this.orchestrator.orchestrate(prompt);
        if (orchestratedData && orchestratedData.success) {
          console.log('✅ API Orchestrator completed successfully!');

          // Convert orchestrated data to taxonomy format
          const taxonomyAnalysis = await this.bedrock.analyzeTaxonomyPromptWithRealData(
            prompt,
            orchestratedData
          );

          if (taxonomyAnalysis && taxonomyAnalysis.primaryCategory) {
            taxonomyAnalysis.orchestratedData = orchestratedData;
            const specs = this.convertTaxonomyAnalysisToSpecs(taxonomyAnalysis);
            console.log('✅ Orchestrated scene generation complete!\n');
            return specs;
          }
        }
      } catch (error) {
        console.error('❌ API Orchestrator failed:', error.message);
        // Continue with standard methods
      }
    }

    // Step 4: Standard taxonomy-aware AI analysis (existing code)
    try {
      console.log('🔍 Attempting taxonomy-aware analysis...');
      const taxonomyAnalysis = await this.bedrock.analyzeTaxonomyPrompt(prompt);
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
      console.log('🔍 Attempting Bedrock analyzePrompt...');
      const aiAnalysis = await this.bedrock.analyzePrompt(prompt);
      if (aiAnalysis) {
        console.log('✅ AI analysis successful:', JSON.stringify(aiAnalysis, null, 2));
        const specs = this.convertAIAnalysisToSpecs(aiAnalysis);
        console.log('=== End AI Service Processing ===\n');
        return specs;
      }
      console.log('⚠️  AI analysis returned null, trying fallback...');
    } catch (error) {
      console.error('❌ Error with Bedrock analyzePrompt:', {
        message: error.message,
        stack: error.stack,
      });
    }

    // Try design specs generation as fallback
    try {
      console.log('🔄 Falling back to generateDesignSpecs...');
      const designSpecs = await this.bedrock.generateContent(prompt);
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
   * Determine if API Orchestrator should be used for complex scenes
   */
  shouldUseOrchestrator(prompt) {
    const complexSceneKeywords = [
      'downtown', 'cityscape', 'city block', 'urban area', 'neighborhood',
      'street scene', 'plaza', 'square', 'district', 'complex',
      'multiple buildings', 'several buildings', 'many buildings',
      'entire', 'whole', 'complete', 'full scene', 'environment'
    ];

    const lowerPrompt = prompt.toLowerCase();
    return complexSceneKeywords.some(keyword => lowerPrompt.includes(keyword));
  }

  /**
   * Convert taxonomy-aware AI analysis to design specifications
   * Handles comprehensive scene data with realistic placement
   */
  convertTaxonomyAnalysisToSpecs(analysis) {
    const { primaryCategory, scale, style, elements, spatialComposition, realism, environmentalContext, realWorldDataSource } = analysis;

    // Extract primary element for basic compatibility
    const primaryElement = elements?.[0] || {};

    // If this analysis came from real-world data (landmarks), mark elements with metadata
    const processedElements = elements?.map(element => {
      const processedElement = { ...element };

      // Add realWorld metadata if this came from Wikipedia/Wikidata
      if (realWorldDataSource && (realWorldDataSource === 'wikipedia-wikidata' || realWorldDataSource === 'geographic-coordinate')) {
        if (!processedElement.metadata) {
          processedElement.metadata = {};
        }
        processedElement.metadata.realWorld = true;
        processedElement.metadata.source = realWorldDataSource;

        console.log(`✅ Marked element "${element.name}" as real-world landmark from ${realWorldDataSource}`);
      }

      return processedElement;
    }) || [];

    return {
      // Original format compatibility
      objectType: primaryElement.category || primaryCategory || 'object',
      objectCount: processedElements.reduce((sum, el) => sum + (el.quantity || 1), 0) || 1,
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
        realism: realism || { detailLevel: 'medium' },
        realWorldDataSource: realWorldDataSource // Preserve the source
      },

      // All elements for multi-object generation (with metadata)
      elements: processedElements,

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
        objectType: 'building',
        description: content + ' (Generated with enhanced fallback)',
        dimensions: { width: 15000, height: 40000, depth: 15000 },
        materials: ['concrete', 'glass', 'steel'],
        style: 'modern',
        elements: [
          {
            name: 'Base Foundation',
            type: 'box',
            dimensions: { width: 15000, height: 10000, depth: 15000 },
            material: 'concrete',
            position: { x: 0, y: 5000, z: 0 }
          },
          {
            name: 'Main Tower',
            type: 'box',
            dimensions: { width: 10000, height: 40000, depth: 10000 },
            material: 'glass',
            position: { x: 0, y: 30000, z: 0 }
          },
          {
            name: 'Upper Tier',
            type: 'cylinder',
            dimensions: { width: 8000, height: 15000, depth: 8000 },
            material: 'steel',
            position: { x: 0, y: 57500, z: 0 }
          },
          {
            name: 'Spire',
            type: 'cone',
            dimensions: { width: 1000, height: 10000, depth: 1000 },
            material: 'gold',
            position: { x: 0, y: 70000, z: 0 }
          }
        ]
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
    const { objectType, dimensions, materials, elements, scene, objectCount, taxonomyData } = specifications;

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
      taxonomyData: taxonomyData || null, // CRITICAL: Pass taxonomyData to geometry generator
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
