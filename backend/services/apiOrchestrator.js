const geminiService = require('./geminiService');
const mapboxService = require('./mapboxService');
const overpassService = require('./overpassService');
const elevationService = require('./elevationService');
const wikipediaService = require('./wikipediaService');
const wikidataService = require('./wikidataService');
const wikimediaService = require('./wikimediaService');
const weatherService = require('./weatherService');
const treeMapService = require('./treeMapService');
const mapillaryService = require('./mapillaryService');
const sketchfabService = require('./sketchfabService');
const dataValidator = require('./dataValidator');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * API Orchestrator - The Core Brain
 * Coordinates ALL APIs in intelligent sequence for ultra-realistic 3D generation
 * Implements parallel processing, fallback chains, caching, and validation
 * 
 * This orchestrator enables ArchDisc to surpass Blender, Maya, D5 Render, and Unreal Engine
 * by combining real-world data, AI intelligence, and procedural generation
 */
class APIOrchestrator {
  constructor() {
    this.enabled = process.env.ENABLE_ORCHESTRATOR !== 'false';
    this.maxParallelRequests = parseInt(process.env.MAX_PARALLEL_REQUESTS) || 10;
    
    // Phase configurations for orchestration
    this.phases = {
      intentUnderstanding: { name: 'Intent Understanding', priority: 1 },
      knowledgeGathering: { name: 'Knowledge Gathering', priority: 2, parallel: true },
      geographicData: { name: 'Geographic Data', priority: 3, parallel: true },
      environmentalContext: { name: 'Environmental Context', priority: 4, parallel: true },
      assets3D: { name: '3D Assets', priority: 5, parallel: true },
      dataFusion: { name: 'Data Fusion & Validation', priority: 6 },
      sceneGeneration: { name: 'Scene Generation', priority: 7 },
    };
  }

  /**
   * Check if orchestrator is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Main orchestration method - coordinates all APIs for ultra-realistic generation
   */
  async orchestrate(prompt, options = {}) {
    if (!this.isEnabled()) {
      console.log('⚠️  API Orchestrator is disabled, falling back to basic generation');
      return null;
    }

    console.log('\n🎭 ═══════════════════════════════════════════════════════════');
    console.log('🎭 API ORCHESTRATOR: ULTRA-REALISTIC 3D GENERATION STARTED');
    console.log('🎭 ═══════════════════════════════════════════════════════════\n');
    console.log(`📝 Prompt: "${prompt}"`);
    console.log(`⚙️  Options:`, options);

    const startTime = Date.now();
    const orchestrationResult = {
      prompt,
      timestamp: new Date().toISOString(),
      phases: {},
      validations: [],
      confidence: 0,
      dataQuality: 'unknown',
      realisticEnhancement: {},
    };

    try {
      // PHASE 1: Intent Understanding (Gemini AI Analysis)
      orchestrationResult.phases.intentUnderstanding = await this.phaseIntentUnderstanding(prompt, options);

      // PHASE 2: Knowledge Gathering (Parallel)
      if (orchestrationResult.phases.intentUnderstanding.requiresKnowledge) {
        orchestrationResult.phases.knowledgeGathering = await this.phaseKnowledgeGathering(
          orchestrationResult.phases.intentUnderstanding
        );
      }

      // PHASE 3: Geographic Data (Parallel)
      if (orchestrationResult.phases.intentUnderstanding.hasLocation) {
        orchestrationResult.phases.geographicData = await this.phaseGeographicData(
          orchestrationResult.phases.intentUnderstanding
        );
      }

      // PHASE 4: Environmental Context (Parallel)
      orchestrationResult.phases.environmentalContext = await this.phaseEnvironmentalContext(
        orchestrationResult.phases.intentUnderstanding,
        orchestrationResult.phases.geographicData
      );

      // PHASE 5: 3D Assets (Parallel)
      orchestrationResult.phases.assets3D = await this.phase3DAssets(
        orchestrationResult.phases.intentUnderstanding
      );

      // PHASE 6: Data Fusion & Validation
      orchestrationResult.phases.dataFusion = await this.phaseDataFusion(orchestrationResult.phases);

      // PHASE 7: Scene Generation Data (Unified Structure)
      orchestrationResult.phases.sceneGeneration = await this.phaseSceneGeneration(
        orchestrationResult.phases
      );

      // Calculate overall confidence and quality
      orchestrationResult.confidence = this.calculateOverallConfidence(orchestrationResult.phases);
      orchestrationResult.dataQuality = this.determineDataQuality(orchestrationResult.confidence);
      orchestrationResult.realisticEnhancement = this.generateRealisticEnhancements(orchestrationResult.phases);

      const duration = Date.now() - startTime;
      console.log(`\n✅ Orchestration completed in ${duration}ms`);
      console.log(`📊 Overall Confidence: ${(orchestrationResult.confidence * 100).toFixed(1)}%`);
      console.log(`🎨 Data Quality: ${orchestrationResult.dataQuality}`);
      console.log('🎭 ═══════════════════════════════════════════════════════════\n');

      return orchestrationResult;

    } catch (error) {
      console.error('❌ Orchestration failed:', error);
      orchestrationResult.error = error.message;
      orchestrationResult.confidence = 0;
      return orchestrationResult;
    }
  }

  /**
   * PHASE 1: Intent Understanding - Parse prompt with Gemini AI
   */
  async phaseIntentUnderstanding(prompt, options) {
    console.log('\n🧠 PHASE 1: Intent Understanding (Gemini AI)');
    const startTime = Date.now();

    try {
      const analysisPrompt = this.buildIntentAnalysisPrompt(prompt);
      const response = await geminiService.generateContent(analysisPrompt);
      
      // Parse Gemini's response
      const intent = this.parseIntentResponse(response);
      
      console.log(`✅ Phase 1 completed in ${Date.now() - startTime}ms`);
      console.log(`   🎯 Type: ${intent.type}`);
      console.log(`   🏷️  Category: ${intent.category}`);
      console.log(`   📍 Location: ${intent.location || 'N/A'}`);
      console.log(`   🎨 Style: ${intent.style || 'N/A'}`);
      console.log(`   🔧 Complexity: ${intent.complexity}`);
      
      return {
        success: true,
        duration: Date.now() - startTime,
        ...intent,
      };

    } catch (error) {
      console.error(`❌ Phase 1 failed:`, error.message);
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message,
        type: 'unknown',
        isReal: false,
        isFantasy: true,
        requiresKnowledge: false,
        hasLocation: false,
      };
    }
  }

  /**
   * Build comprehensive intent analysis prompt for Gemini
   */
  buildIntentAnalysisPrompt(prompt) {
    return `Analyze this architectural/3D design prompt for ultra-realistic generation.

PROMPT: "${prompt}"

Provide a comprehensive JSON analysis with these fields:
{
  "type": "real_building|fantasy_structure|scene|environment|object",
  "category": "architecture|interior|landscape|urban|industrial|residential|commercial|cultural",
  "isReal": true/false (is this a real-world location/building?),
  "isFantasy": true/false (is this fantasy/imaginary?),
  "landmark": "name of landmark if recognized, or null",
  "location": "city/country if mentioned, or null",
  "coordinates": {"latitude": X, "longitude": Y} or null,
  "style": "architectural style (Gothic, Modern, Art Deco, etc.) or null",
  "era": "time period (Medieval, Victorian, Contemporary, etc.) or null",
  "scale": "small|medium|large|massive",
  "complexity": "simple|moderate|complex|very_complex",
  "elements": ["list", "of", "key", "architectural", "elements"],
  "materials": ["primary", "materials", "mentioned"],
  "environment": "urban|suburban|rural|coastal|mountain|desert|forest",
  "timeOfDay": "dawn|morning|noon|afternoon|evening|dusk|night|null",
  "weather": "clear|cloudy|rainy|snowy|foggy|null",
  "vegetation": "none|sparse|moderate|dense",
  "requiresKnowledge": true/false (needs Wikipedia/Wikidata),
  "hasLocation": true/false (has specific geographic location),
  "needsRealData": true/false (benefits from OSM/Mapbox data),
  "suggestedAPIs": ["list", "of", "recommended", "APIs"],
  "realismLevel": "photorealistic|realistic|stylized|abstract",
  "detailLevel": "low|medium|high|ultra_high"
}

Return ONLY valid JSON, no additional text.`;
  }

  /**
   * Parse Gemini's intent response
   */
  parseIntentResponse(response) {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const intent = JSON.parse(jsonMatch[0]);
      
      // Ensure all required fields exist
      return {
        type: intent.type || 'unknown',
        category: intent.category || 'architecture',
        isReal: intent.isReal || false,
        isFantasy: intent.isFantasy || true,
        landmark: intent.landmark || null,
        location: intent.location || null,
        coordinates: intent.coordinates || null,
        style: intent.style || null,
        era: intent.era || null,
        scale: intent.scale || 'medium',
        complexity: intent.complexity || 'moderate',
        elements: intent.elements || [],
        materials: intent.materials || [],
        environment: intent.environment || 'urban',
        timeOfDay: intent.timeOfDay || null,
        weather: intent.weather || null,
        vegetation: intent.vegetation || 'moderate',
        requiresKnowledge: intent.requiresKnowledge || false,
        hasLocation: intent.hasLocation || false,
        needsRealData: intent.needsRealData || false,
        suggestedAPIs: intent.suggestedAPIs || [],
        realismLevel: intent.realismLevel || 'realistic',
        detailLevel: intent.detailLevel || 'high',
      };

    } catch (error) {
      console.warn('Failed to parse intent response, using defaults:', error.message);
      return {
        type: 'unknown',
        isReal: false,
        isFantasy: true,
        requiresKnowledge: false,
        hasLocation: false,
        needsRealData: false,
        complexity: 'moderate',
      };
    }
  }

  /**
   * PHASE 2: Knowledge Gathering (Parallel Wikipedia, Wikidata, Wikimedia)
   */
  async phaseKnowledgeGathering(intent) {
    console.log('\n📚 PHASE 2: Knowledge Gathering (Parallel)');
    const startTime = Date.now();

    const tasks = [];
    const results = {};

    // Wikipedia search for landmark/building
    if (intent.landmark) {
      tasks.push(
        this.executeWithFallback(
          () => wikipediaService.searchLandmark(intent.landmark),
          'wikipedia',
          results
        )
      );
    }

    // Wikidata search for structured data
    if (intent.landmark) {
      tasks.push(
        this.executeWithFallback(
          () => wikidataService.getBuildingData(intent.landmark),
          'wikidata',
          results
        )
      );
    }

    // Wikimedia Commons images
    if (intent.landmark || intent.style) {
      const query = intent.landmark || intent.style;
      tasks.push(
        this.executeWithFallback(
          () => wikimediaService.getBuildingImages(query, 5),
          'wikimedia',
          results
        )
      );
    }

    // Execute all knowledge gathering tasks in parallel
    await Promise.allSettled(tasks);

    console.log(`✅ Phase 2 completed in ${Date.now() - startTime}ms`);
    console.log(`   📖 Wikipedia: ${results.wikipedia ? '✓' : '✗'}`);
    console.log(`   🗄️  Wikidata: ${results.wikidata ? '✓' : '✗'}`);
    console.log(`   🖼️  Wikimedia: ${results.wikimedia ? '✓' : '✗'}`);

    return {
      success: true,
      duration: Date.now() - startTime,
      ...results,
    };
  }

  /**
   * PHASE 3: Geographic Data (Parallel Mapbox, Overpass, Elevation)
   */
  async phaseGeographicData(intent) {
    console.log('\n🌍 PHASE 3: Geographic Data (Parallel)');
    const startTime = Date.now();

    const tasks = [];
    const results = {};

    // Get coordinates if we have a location name
    let coords = intent.coordinates;
    if (!coords && intent.location && mapboxService.isEnabled()) {
      const geocoded = await mapboxService.geocode(intent.location);
      if (geocoded) {
        coords = geocoded.coordinates;
        results.geocoded = geocoded;
      }
    }

    if (coords) {
      const { latitude, longitude } = coords;

      // Mapbox satellite imagery
      if (mapboxService.isEnabled()) {
        tasks.push(
          this.executeWithFallback(
            () => mapboxService.getSatelliteImagery(longitude, latitude, 15),
            'mapbox_satellite',
            results
          )
        );

        // Building footprints
        tasks.push(
          this.executeWithFallback(
            () => mapboxService.getBuildingFootprints(longitude, latitude, 16),
            'mapbox_buildings',
            results
          )
        );
      }

      // Overpass (OpenStreetMap) building data
      if (overpassService.isEnabled()) {
        tasks.push(
          this.executeWithFallback(
            () => overpassService.getBuildings(latitude, longitude, 500),
            'osm_buildings',
            results
          )
        );

        // Road network
        tasks.push(
          this.executeWithFallback(
            () => overpassService.getRoadNetwork(latitude, longitude, 500),
            'osm_roads',
            results
          )
        );

        // POIs
        tasks.push(
          this.executeWithFallback(
            () => overpassService.getPOIs(latitude, longitude, 500),
            'osm_pois',
            results
          )
        );
      }

      // Elevation data
      if (elevationService.isEnabled()) {
        tasks.push(
          this.executeWithFallback(
            () => elevationService.getElevationGrid(latitude, longitude, 500, 10),
            'elevation',
            results
          )
        );
      }

      // Execute all geographic tasks in parallel
      await Promise.allSettled(tasks);
    }

    console.log(`✅ Phase 3 completed in ${Date.now() - startTime}ms`);
    console.log(`   🛰️  Satellite: ${results.mapbox_satellite ? '✓' : '✗'}`);
    console.log(`   🏢 Buildings: ${results.osm_buildings?.length || 0} found`);
    console.log(`   🛣️  Roads: ${results.osm_roads?.length || 0} found`);
    console.log(`   📍 POIs: ${results.osm_pois?.length || 0} found`);
    console.log(`   ⛰️  Elevation: ${results.elevation ? '✓' : '✗'}`);

    return {
      success: true,
      duration: Date.now() - startTime,
      coordinates: coords,
      ...results,
    };
  }

  /**
   * PHASE 4: Environmental Context (Parallel Weather, Trees, Street-level)
   */
  async phaseEnvironmentalContext(intent, geoData) {
    console.log('\n🌦️  PHASE 4: Environmental Context (Parallel)');
    const startTime = Date.now();

    const tasks = [];
    const results = {};

    const coords = geoData?.coordinates || intent.coordinates;

    if (coords) {
      const { latitude, longitude } = coords;

      // Weather and lighting
      if (weatherService.isEnabled()) {
        tasks.push(
          this.executeWithFallback(
            () => weatherService.getCurrentWeather(latitude, longitude),
            'weather',
            results
          )
        );

        tasks.push(
          this.executeWithFallback(
            () => weatherService.getLightingConditions(latitude, longitude),
            'lighting',
            results
          )
        );

        // Historical climate for vegetation
        const currentMonth = new Date().getMonth() + 1;
        tasks.push(
          this.executeWithFallback(
            () => weatherService.getHistoricalClimate(latitude, longitude, currentMonth),
            'climate',
            results
          )
        );
      }

      // Tree/vegetation data
      if (treeMapService.isEnabled()) {
        const climate = results.climate?.climate || intent.environment || 'temperate';
        tasks.push(
          this.executeWithFallback(
            () => treeMapService.getTreesForLocation(latitude, longitude, 500, climate),
            'trees',
            results
          )
        );
      }

      // Street-level imagery (Mapillary)
      if (mapillaryService.isEnabled()) {
        tasks.push(
          this.executeWithFallback(
            () => mapillaryService.searchImages(longitude, latitude, 100, 10),
            'streetLevel',
            results
          )
        );
      }

      // Execute all environmental tasks in parallel
      await Promise.allSettled(tasks);
    }

    console.log(`✅ Phase 4 completed in ${Date.now() - startTime}ms`);
    console.log(`   🌤️  Weather: ${results.weather?.conditions || 'N/A'}`);
    console.log(`   ☀️  Lighting: ${results.lighting?.sun?.timeOfDay || 'N/A'}`);
    console.log(`   🌲 Trees: ${results.trees?.length || 0} generated`);
    console.log(`   📸 Street-level: ${results.streetLevel?.length || 0} images`);

    return {
      success: true,
      duration: Date.now() - startTime,
      ...results,
    };
  }

  /**
   * PHASE 5: 3D Assets (Sketchfab Search)
   */
  async phase3DAssets(intent) {
    console.log('\n🎨 PHASE 5: 3D Assets (Sketchfab)');
    const startTime = Date.now();

    const results = {};

    if (sketchfabService.isEnabled()) {
      try {
        // Build search query from intent
        const searchQuery = this.build3DAssetSearchQuery(intent);
        console.log(`   🔍 Searching: "${searchQuery}"`);

        const models = await sketchfabService.searchModels({
          q: searchQuery,
          categories: 'architecture,cultural-heritage-history',
          sort_by: 'relevance',
          count: 10,
        });

        results.models = models;
        console.log(`   ✅ Found ${models?.results?.length || 0} 3D models`);

      } catch (error) {
        console.error(`   ❌ Sketchfab search failed:`, error.message);
      }
    } else {
      console.log(`   ⚠️  Sketchfab is disabled`);
    }

    console.log(`✅ Phase 5 completed in ${Date.now() - startTime}ms`);

    return {
      success: true,
      duration: Date.now() - startTime,
      ...results,
    };
  }

  /**
   * Build 3D asset search query
   */
  build3DAssetSearchQuery(intent) {
    const parts = [];

    if (intent.landmark) {
      parts.push(intent.landmark);
    } else {
      if (intent.style) parts.push(intent.style);
      if (intent.category) parts.push(intent.category);
      if (intent.type === 'real_building') parts.push('building');
    }

    return parts.join(' ') || 'architecture';
  }

  /**
   * PHASE 6: Data Fusion & Validation
   */
  async phaseDataFusion(phases) {
    console.log('\n🔬 PHASE 6: Data Fusion & Validation');
    const startTime = Date.now();

    const validations = [];
    const fusedData = {};

    // Validate and fuse knowledge data
    if (phases.knowledgeGathering) {
      const sources = [];
      
      if (phases.knowledgeGathering.wikipedia) {
        sources.push({
          name: 'wikipedia',
          data: phases.knowledgeGathering.wikipedia,
        });
      }
      
      if (phases.knowledgeGathering.wikidata) {
        sources.push({
          name: 'wikidata',
          data: phases.knowledgeGathering.wikidata.dimensions || {},
        });
      }

      if (sources.length > 0) {
        const crossRef = dataValidator.crossReference(sources);
        fusedData.knowledge = crossRef.resolved;
        fusedData.knowledgeConflicts = crossRef.conflicts;
        validations.push({ source: 'knowledge', ...crossRef });
      }
    }

    // Validate geographic data
    if (phases.geographicData?.osm_buildings) {
      const validation = dataValidator.validateResponse(
        'overpass',
        phases.geographicData.osm_buildings,
        null
      );
      validations.push({ source: 'geographic', ...validation });
    }

    // Validate environmental data
    if (phases.environmentalContext?.weather) {
      const validation = dataValidator.validateWeather(phases.environmentalContext.weather);
      validations.push({ source: 'weather', ...validation });
    }

    // Calculate overall confidence
    const confidence = dataValidator.calculateConfidence(validations);

    console.log(`✅ Phase 6 completed in ${Date.now() - startTime}ms`);
    console.log(`   📊 Overall Confidence: ${(confidence * 100).toFixed(1)}%`);
    console.log(`   ✔️  Validations passed: ${validations.filter(v => v.valid).length}/${validations.length}`);

    return {
      success: true,
      duration: Date.now() - startTime,
      fusedData,
      validations,
      confidence,
    };
  }

  /**
   * PHASE 7: Scene Generation (Unified Data Structure)
   */
  async phaseSceneGeneration(phases) {
    console.log('\n🎬 PHASE 7: Scene Generation Data');
    const startTime = Date.now();

    const sceneData = {
      metadata: this.generateMetadata(phases),
      geometry: this.generateGeometryData(phases),
      materials: this.generateMaterialData(phases),
      environment: this.generateEnvironmentData(phases),
      lighting: this.generateLightingData(phases),
      vegetation: this.generateVegetationData(phases),
      assets: this.generate3DAssetData(phases),
      realWorldData: this.generateRealWorldData(phases),
    };

    console.log(`✅ Phase 7 completed in ${Date.now() - startTime}ms`);
    console.log(`   📦 Scene data structure ready for rendering`);

    return {
      success: true,
      duration: Date.now() - startTime,
      sceneData,
    };
  }

  /**
   * Generate metadata for scene
   */
  generateMetadata(phases) {
    const intent = phases.intentUnderstanding;
    return {
      title: intent.landmark || 'Generated Scene',
      type: intent.type,
      category: intent.category,
      style: intent.style,
      era: intent.era,
      scale: intent.scale,
      complexity: intent.complexity,
      realismLevel: intent.realismLevel,
      detailLevel: intent.detailLevel,
      isReal: intent.isReal,
      isFantasy: intent.isFantasy,
      location: intent.location,
      coordinates: phases.geographicData?.coordinates,
    };
  }

  /**
   * Generate geometry data from all sources
   */
  generateGeometryData(phases) {
    const geometry = {
      buildings: [],
      roads: [],
      terrain: null,
      pois: [],
    };

    // OSM Buildings with real dimensions
    if (phases.geographicData?.osm_buildings) {
      geometry.buildings = phases.geographicData.osm_buildings.map(b => ({
        id: b.id,
        name: b.name,
        type: b.buildingType,
        height: b.height || 10,
        position: b.center,
        geometry: b.geometry,
        style: b.architectural_style,
        realWorldData: true,
      }));
    }

    // Roads
    if (phases.geographicData?.osm_roads) {
      geometry.roads = phases.geographicData.osm_roads;
    }

    // Terrain elevation
    if (phases.geographicData?.elevation) {
      geometry.terrain = phases.geographicData.elevation;
    }

    // POIs
    if (phases.geographicData?.osm_pois) {
      geometry.pois = phases.geographicData.osm_pois;
    }

    return geometry;
  }

  /**
   * Generate material data with reference images
   */
  generateMaterialData(phases) {
    const materials = {
      primary: phases.intentUnderstanding.materials || [],
      referenceImages: phases.knowledgeGathering?.wikimedia || [],
      style: phases.intentUnderstanding.style,
      era: phases.intentUnderstanding.era,
      pbrSuggestions: this.generatePBRSuggestions(phases.intentUnderstanding),
    };

    return materials;
  }

  /**
   * Generate environment data
   */
  generateEnvironmentData(phases) {
    return {
      type: phases.intentUnderstanding.environment,
      weather: phases.environmentalContext?.weather,
      climate: phases.environmentalContext?.climate,
      timeOfDay: phases.intentUnderstanding.timeOfDay,
      season: this.determineSeason(),
      skybox: this.generateSkyboxData(phases.environmentalContext),
      fog: phases.environmentalContext?.lighting?.fogDensity || 0,
      atmosphericScattering: phases.environmentalContext?.lighting?.atmosphericScattering || 0,
    };
  }

  /**
   * Generate lighting data for ultra-realism
   */
  generateLightingData(phases) {
    const lighting = phases.environmentalContext?.lighting;
    
    if (!lighting) {
      // Default lighting
      return {
        sunPosition: { altitude: 45, azimuth: 135 },
        intensity: 1.0,
        shadowStrength: 0.7,
        ambientIntensity: 0.3,
        skyColor: { r: 0.53, g: 0.81, b: 0.92 },
      };
    }

    return {
      sunPosition: lighting.sun,
      intensity: lighting.directIntensity,
      shadowStrength: lighting.shadowStrength,
      ambientIntensity: lighting.ambientIntensity,
      skyColor: lighting.skyColor,
      cloudCover: lighting.cloudCover,
      weather: lighting.weather,
    };
  }

  /**
   * Generate vegetation data
   */
  generateVegetationData(phases) {
    const trees = phases.environmentalContext?.trees || [];
    const climate = phases.environmentalContext?.climate;

    return {
      trees,
      totalCount: trees.length,
      canopyCoverage: treeMapService.calculateCanopyCoverage(trees),
      climate: climate?.climate,
      vegetation: climate?.vegetation,
      density: phases.intentUnderstanding.vegetation,
    };
  }

  /**
   * Generate 3D asset data
   */
  generate3DAssetData(phases) {
    const models = phases.assets3D?.models?.results || [];
    
    return {
      available: models.length > 0,
      count: models.length,
      models: models.slice(0, 5).map(m => ({
        uid: m.uid,
        name: m.name,
        embedUrl: `https://sketchfab.com/models/${m.uid}/embed`,
        thumbnailUrl: m.thumbnails?.images?.[0]?.url,
        faceCount: m.faceCount,
        viewCount: m.viewCount,
      })),
    };
  }

  /**
   * Generate real-world data summary
   */
  generateRealWorldData(phases) {
    return {
      hasRealBuildings: phases.geographicData?.osm_buildings?.length > 0,
      hasRealRoads: phases.geographicData?.osm_roads?.length > 0,
      hasElevation: !!phases.geographicData?.elevation,
      hasWeatherData: !!phases.environmentalContext?.weather,
      hasStreetLevel: phases.environmentalContext?.streetLevel?.length > 0,
      hasKnowledge: !!phases.knowledgeGathering?.wikipedia,
      dataSourceCount: this.countDataSources(phases),
    };
  }

  /**
   * Generate PBR material suggestions
   */
  generatePBRSuggestions(intent) {
    const materials = intent.materials || [];
    const style = intent.style || '';
    const era = intent.era || '';

    // Material presets based on style and era
    const suggestions = [];

    materials.forEach(material => {
      suggestions.push({
        name: material,
        baseColor: this.suggestBaseColor(material, style),
        roughness: this.suggestRoughness(material, era),
        metallic: this.suggestMetallic(material),
        normal: this.suggestNormalMap(material),
      });
    });

    return suggestions;
  }

  /**
   * Helper: Suggest base color
   */
  suggestBaseColor(material, style) {
    const colors = {
      brick: '#8B4513',
      stone: '#808080',
      concrete: '#C0C0C0',
      wood: '#8B4513',
      glass: '#E0F0FF',
      metal: '#808080',
    };
    return colors[material.toLowerCase()] || '#CCCCCC';
  }

  /**
   * Helper: Suggest roughness
   */
  suggestRoughness(material, era) {
    // Older materials tend to be rougher
    const baseRoughness = {
      brick: 0.9,
      stone: 0.8,
      concrete: 0.7,
      wood: 0.6,
      glass: 0.1,
      metal: 0.3,
    };
    
    const rough = baseRoughness[material.toLowerCase()] || 0.5;
    
    // Increase roughness for older eras
    if (era && (era.includes('Medieval') || era.includes('Ancient'))) {
      return Math.min(1.0, rough + 0.2);
    }
    
    return rough;
  }

  /**
   * Helper: Suggest metallic
   */
  suggestMetallic(material) {
    const metallic = {
      metal: 1.0,
      glass: 0.0,
      brick: 0.0,
      stone: 0.0,
      concrete: 0.0,
      wood: 0.0,
    };
    return metallic[material.toLowerCase()] || 0.0;
  }

  /**
   * Helper: Suggest normal map
   */
  suggestNormalMap(material) {
    return {
      brick: 'brick_normal',
      stone: 'stone_normal',
      wood: 'wood_normal',
      concrete: 'concrete_normal',
    }[material.toLowerCase()] || 'default_normal';
  }

  /**
   * Generate skybox data
   */
  generateSkyboxData(envContext) {
    const lighting = envContext?.lighting;
    const weather = envContext?.weather;

    if (!lighting) {
      return { type: 'clear_day', color: '#87CEEB' };
    }

    const timeOfDay = lighting.sun?.timeOfDay || 'day';
    const conditions = weather?.conditions || 'clear';

    return {
      type: `${conditions}_${timeOfDay}`,
      color: lighting.skyColor,
      cloudCover: lighting.cloudCover,
      sunPosition: lighting.sun,
    };
  }

  /**
   * Determine current season
   */
  determineSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  }

  /**
   * Count active data sources
   */
  countDataSources(phases) {
    let count = 0;
    
    if (phases.knowledgeGathering) {
      if (phases.knowledgeGathering.wikipedia) count++;
      if (phases.knowledgeGathering.wikidata) count++;
      if (phases.knowledgeGathering.wikimedia) count++;
    }
    
    if (phases.geographicData) {
      if (phases.geographicData.osm_buildings) count++;
      if (phases.geographicData.osm_roads) count++;
      if (phases.geographicData.elevation) count++;
    }
    
    if (phases.environmentalContext) {
      if (phases.environmentalContext.weather) count++;
      if (phases.environmentalContext.trees) count++;
      if (phases.environmentalContext.streetLevel) count++;
    }
    
    if (phases.assets3D?.models) count++;
    
    return count;
  }

  /**
   * Calculate overall confidence
   */
  calculateOverallConfidence(phases) {
    let totalConfidence = 0;
    let phaseCount = 0;

    // Phase 1: Intent always succeeds if we got here
    if (phases.intentUnderstanding?.success) {
      totalConfidence += 1.0;
      phaseCount++;
    }

    // Phase 2: Knowledge gathering
    if (phases.knowledgeGathering) {
      let knowledgeScore = 0;
      let knowledgeCount = 0;
      if (phases.knowledgeGathering.wikipedia) { knowledgeScore++; knowledgeCount++; }
      if (phases.knowledgeGathering.wikidata) { knowledgeScore++; knowledgeCount++; }
      if (phases.knowledgeGathering.wikimedia) { knowledgeScore++; knowledgeCount++; }
      if (knowledgeCount > 0) {
        totalConfidence += (knowledgeScore / knowledgeCount);
        phaseCount++;
      }
    }

    // Phase 3: Geographic data
    if (phases.geographicData) {
      let geoScore = 0;
      let geoCount = 0;
      if (phases.geographicData.osm_buildings?.length > 0) { geoScore++; geoCount++; }
      if (phases.geographicData.osm_roads?.length > 0) { geoScore++; geoCount++; }
      if (phases.geographicData.elevation) { geoScore++; geoCount++; }
      if (geoCount > 0) {
        totalConfidence += (geoScore / geoCount);
        phaseCount++;
      }
    }

    // Phase 4: Environmental
    if (phases.environmentalContext) {
      let envScore = 0;
      let envCount = 0;
      if (phases.environmentalContext.weather) { envScore++; envCount++; }
      if (phases.environmentalContext.lighting) { envScore++; envCount++; }
      if (phases.environmentalContext.trees) { envScore++; envCount++; }
      if (envCount > 0) {
        totalConfidence += (envScore / envCount);
        phaseCount++;
      }
    }

    // Phase 5: 3D Assets
    if (phases.assets3D?.models?.results?.length > 0) {
      totalConfidence += 0.8; // Assets are helpful but not critical
      phaseCount++;
    }

    // Phase 6: Data fusion confidence
    if (phases.dataFusion?.confidence) {
      totalConfidence += phases.dataFusion.confidence;
      phaseCount++;
    }

    return phaseCount > 0 ? totalConfidence / phaseCount : 0;
  }

  /**
   * Determine data quality level
   */
  determineDataQuality(confidence) {
    if (confidence >= 0.9) return 'ultra_high';
    if (confidence >= 0.75) return 'high';
    if (confidence >= 0.5) return 'medium';
    if (confidence >= 0.25) return 'low';
    return 'minimal';
  }

  /**
   * Generate realistic enhancements summary
   */
  generateRealisticEnhancements(phases) {
    return {
      hasRealDimensions: !!phases.knowledgeGathering?.wikidata?.dimensions,
      hasRealLocation: !!phases.geographicData?.coordinates,
      hasRealWeather: !!phases.environmentalContext?.weather,
      hasRealLighting: !!phases.environmentalContext?.lighting,
      hasRealVegetation: !!phases.environmentalContext?.trees,
      hasReferenceImages: phases.knowledgeGathering?.wikimedia?.length > 0,
      has3DAssets: phases.assets3D?.models?.results?.length > 0,
      hasStreetView: phases.environmentalContext?.streetLevel?.length > 0,
      enhancementLevel: this.calculateEnhancementLevel(phases),
    };
  }

  /**
   * Calculate enhancement level
   */
  calculateEnhancementLevel(phases) {
    let score = 0;
    
    if (phases.knowledgeGathering?.wikidata?.dimensions) score += 15;
    if (phases.geographicData?.osm_buildings) score += 20;
    if (phases.geographicData?.elevation) score += 10;
    if (phases.environmentalContext?.weather) score += 15;
    if (phases.environmentalContext?.lighting) score += 15;
    if (phases.environmentalContext?.trees) score += 10;
    if (phases.knowledgeGathering?.wikimedia) score += 10;
    if (phases.assets3D?.models) score += 5;
    
    if (score >= 80) return 'maximum';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'minimal';
  }

  /**
   * Execute API call with fallback and error handling
   */
  async executeWithFallback(apiCall, name, results) {
    try {
      const result = await apiCall();
      if (result) {
        results[name] = result;
      }
      return result;
    } catch (error) {
      console.error(`   ⚠️  ${name} failed:`, error.message);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new APIOrchestrator();
