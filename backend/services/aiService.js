const geminiService = require('./geminiService');
const geometryGenerator = require('./geometryGenerator');
const materialSystem = require('./materialSystem');
const taxonomySystem = require('./taxonomySystem');
const realWorldDataService = require('./realWorldDataService');
const apiOrchestrator = require('./apiOrchestrator');
const wikidataService = require('./wikidataService');
const wikipediaService = require('./wikipediaService');
const pythonWikipediaService = require('./pythonWikipediaService');
const geographicCoordinateService = require('./geographicCoordinateService');
const landmarksConfig = require('../config/landmarks');

class AIService {
  constructor() {
    this.gemini = geminiService;
    this.taxonomy = taxonomySystem;
    this.realWorldData = realWorldDataService;
    this.orchestrator = apiOrchestrator;
    this.wikidata = wikidataService;
    this.wikipedia = wikipediaService;
    this.pythonWikipedia = pythonWikipediaService;
    this.geographic = geographicCoordinateService;
  }

  /**
   * Process natural language prompt to generate design specifications
   * Now with COMPLETE integration: Wikipedia/Wikidata for landmarks, Geographic services for coordinates,
   * API Orchestrator for complex scenes, and Gemini for AI analysis
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
    console.log('   ✓ Wikipedia/Wikidata:', this.wikipedia.isEnabled() || this.pythonWikipedia.isEnabled());
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
          
          // Pass to Gemini WITH real-world geographic data
          console.log('🤖 Passing geographic data to Gemini for enhanced analysis...');
          const taxonomyAnalysis = await this.gemini.analyzeTaxonomyPromptWithRealData(
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
    
    // NEW: Step 2 - Check for famous landmarks
    const landmarkName = this.detectLandmark(prompt);
    if (landmarkName) {
      console.log('🏛️  FAMOUS LANDMARK DETECTED:', landmarkName);
      
      try {
        // Try Python Wikipedia first (better data extraction)
        let landmarkData = null;
        if (this.pythonWikipedia.isEnabled()) {
          console.log('📚 Fetching real-world data from Python Wikipedia...');
          landmarkData = await this.pythonWikipedia.getLandmarkData(landmarkName);
        }
        
        // Fallback to regular Wikipedia if Python failed
        if (!landmarkData && this.wikipedia.isEnabled()) {
          console.log('📚 Fetching from Wikipedia REST API...');
          const wikiArticle = await this.wikipedia.searchLandmark(landmarkName);
          if (wikiArticle) {
            landmarkData = {
              title: wikiArticle.title,
              summary: wikiArticle.extract,
              dimensions: this.extractDimensionsFromText(wikiArticle.extract)
            };
          }
        }
        
        // Get structured data from Wikidata
        let wikidataInfo = null;
        if (this.wikidata.isEnabled()) {
          console.log('📊 Fetching structured data from Wikidata...');
          wikidataInfo = await this.wikidata.getBuildingData(landmarkName);
        }
        
        // Merge Wikipedia and Wikidata
        const realWorldData = {
          source: 'wikipedia-wikidata',
          landmark: landmarkName,
          wikipedia: landmarkData,
          wikidata: wikidataInfo,
          dimensions: {
            ...landmarkData?.dimensions,
            ...wikidataInfo?.dimensions
          }
        };
        
        if (realWorldData.dimensions && Object.keys(realWorldData.dimensions).length > 0) {
          console.log('✅ Real-world landmark data retrieved!');
          console.log(`   📏 Height: ${realWorldData.dimensions.height}m`);
          console.log(`   📐 Width: ${realWorldData.dimensions.width}m`);
          console.log(`   🏢 Floors: ${realWorldData.dimensions.floors}`);
          console.log(`   🎨 Style: ${realWorldData.dimensions.style}`);
          
          // Pass to Gemini WITH real-world data
          const taxonomyAnalysis = await this.gemini.analyzeTaxonomyPromptWithRealData(
            prompt,
            realWorldData
          );
          
          if (taxonomyAnalysis && taxonomyAnalysis.primaryCategory) {
            taxonomyAnalysis.realWorldData = realWorldData;
            const specs = this.convertTaxonomyAnalysisToSpecs(taxonomyAnalysis);
            console.log('✅ Landmark generation with real data complete!\n');
            return specs;
          }
        } else {
          console.log('⚠️  No dimensional data found for landmark');
        }
      } catch (error) {
        console.error('❌ Landmark data retrieval failed:', error.message);
        // Continue with other methods
      }
    }
    
    // NEW: Step 3 - Check if API Orchestrator should be used (complex scenes)
    if (this.orchestrator.isEnabled() && this.shouldUseOrchestrator(prompt)) {
      console.log('🎭 COMPLEX SCENE DETECTED - Using API Orchestrator...');
      
      try {
        const orchestratedData = await this.orchestrator.orchestrate(prompt);
        if (orchestratedData && orchestratedData.success) {
          console.log('✅ API Orchestrator completed successfully!');
          
          // Convert orchestrated data to taxonomy format
          const taxonomyAnalysis = await this.gemini.analyzeTaxonomyPromptWithRealData(
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
   * Detect if prompt mentions a famous landmark
   * Uses external configuration file for maintainability
   */
  detectLandmark(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    for (const landmark of landmarksConfig.landmarks) {
      if (landmark.keywords.some(keyword => lowerPrompt.includes(keyword))) {
        return landmark.name;
      }
    }
    
    return null;
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
   * Extract dimensions from Wikipedia text
   */
  extractDimensionsFromText(text) {
    if (!text) return {};
    
    const dimensions = {};
    const lowerText = text.toLowerCase();
    
    // Extract height
    const heightMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:m|meters|metres)(?:\s+tall|\s+high|\s+in height)/);
    if (heightMatch) {
      dimensions.height = parseFloat(heightMatch[1]);
    }
    
    // Extract width
    const widthMatch = lowerText.match(/width.*?(\d+(?:\.\d+)?)\s*(?:m|meters|metres)/);
    if (widthMatch) {
      dimensions.width = parseFloat(widthMatch[1]);
    }
    
    // Extract floors
    const floorsMatch = lowerText.match(/(\d+)\s*(?:floors|stories|storeys)/);
    if (floorsMatch) {
      dimensions.floors = parseInt(floorsMatch[1]);
    }
    
    return dimensions;
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
