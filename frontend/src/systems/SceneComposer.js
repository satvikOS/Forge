/**
 * Scene Composer - Generates complete environments from natural language descriptions
 * Interprets prompts and creates coordinated multi-asset scenes
 * Enhanced with AI-powered analysis for intelligent scene generation
 */

import * as THREE from 'three';
import apiService from '../services/api';

export class SceneComposer {
  constructor(assetManager, generators, sceneManager) {
    this.assetManager = assetManager;
    this.generators = generators;
    this.sceneManager = sceneManager;
    this.apiService = apiService;
    
    // Scene templates and composition rules
    this.sceneTemplates = this.initializeSceneTemplates();
    this.compositionRules = this.initializeCompositionRules();
    
    // Randomization seed for unique scenes
    this.seed = Date.now();
    
    // AI-powered mode flag
    this.useAI = true; // Can be toggled for fallback to templates
  }
  
  /**
   * Set a new random seed for unique scene generation
   */
  setRandomSeed() {
    this.seed = Date.now() + Math.random() * 1000000;
  }
  
  /**
   * Seeded random number generator for consistent but varied results
   */
  seededRandom(min = 0, max = 1) {
    const x = Math.sin(this.seed++) * 10000;
    const rand = x - Math.floor(x);
    return min + rand * (max - min);
  }

  initializeSceneTemplates() {
    return {
      'futuristic_city': {
        keywords: ['futuristic', 'future', 'sci-fi', 'modern', 'advanced', 'city'],
        theme: 'futuristic',
        description: 'A futuristic cityscape with tall buildings and advanced infrastructure',
        assets: [
          { type: 'building_skyscraper', count: { min: 12, max: 25 }, scale: { min: { x: 1.0, y: 1.2, z: 1.0 }, max: { x: 1.8, y: 2.5, z: 1.8 } }, randomize: true },
          { type: 'building_apartment', count: { min: 8, max: 18 }, scale: { min: { x: 0.8, y: 1.0, z: 0.8 }, max: { x: 1.4, y: 1.8, z: 1.4 } }, randomize: true },
          { type: 'building_shop', count: { min: 5, max: 12 }, scale: { min: { x: 0.6, y: 0.7, z: 0.6 }, max: { x: 1.0, y: 1.0, z: 1.0 } }, randomize: true },
          { type: 'road_highway', count: { min: 2, max: 5 } },
          { type: 'road_street', count: { min: 8, max: 15 } },
          { type: 'road_intersection', count: { min: 4, max: 10 } },
          { type: 'sky', count: 1, options: { color: 0x4a5f8f, randomize: true } },
          { type: 'cloud_layer', count: 1 },
          { type: 'tree_palm', count: { min: 8, max: 20 }, scale: { min: { x: 0.6, y: 0.6, z: 0.6 }, max: { x: 1.2, y: 1.2, z: 1.2 } }, randomize: true }
        ],
        layout: 'grid',
        spacing: { building: 60, road: 40, grid: 8 },
        scale: 'city'
      },
      'medieval_village': {
        keywords: ['medieval', 'village', 'old', 'historical', 'ancient'],
        theme: 'medieval',
        description: 'A medieval village with houses and natural surroundings',
        assets: [
          { type: 'building_house', count: { min: 10, max: 20 }, randomize: true },
          { type: 'building_hut', count: { min: 4, max: 10 }, randomize: true },
          { type: 'building_church', count: 1, scale: { min: { x: 1.3, y: 1.3, z: 1.3 }, max: { x: 1.8, y: 1.8, z: 1.8 } } },
          { type: 'road_path_dirt', count: { min: 5, max: 10 } },
          { type: 'tree_oak', count: { min: 20, max: 40 }, randomize: true },
          { type: 'shrub', count: { min: 15, max: 30 }, randomize: true },
          { type: 'grass', count: 1, options: { width: 150, depth: 150 } },
          { type: 'mountain', count: { min: 1, max: 3 }, distance: 200 }
        ],
        layout: 'organic',
        spacing: { building: 25, road: 15, spread: 80 },
        scale: 'village'
      },
      'industrial_complex': {
        keywords: ['industrial', 'factory', 'warehouse', 'manufacturing'],
        theme: 'industrial',
        description: 'An industrial area with factories and warehouses',
        assets: [
          { type: 'building_factory', count: { min: 3, max: 6 } },
          { type: 'building_warehouse', count: { min: 4, max: 8 } },
          { type: 'road_highway', count: { min: 1, max: 2 } },
          { type: 'road_parking', count: { min: 2, max: 4 } },
          { type: 'sky', count: 1, options: { color: 0x808080 } },
          { type: 'plain', count: 1 }
        ],
        layout: 'grid',
        spacing: { building: 40, road: 20 }
      },
      'natural_landscape': {
        keywords: ['natural', 'nature', 'forest', 'wilderness', 'landscape'],
        theme: 'natural',
        description: 'A natural landscape with terrain and vegetation',
        assets: [
          { type: 'mountain', count: { min: 2, max: 4 } },
          { type: 'hill', count: { min: 3, max: 6 } },
          { type: 'tree_pine', count: { min: 30, max: 60 } },
          { type: 'tree_oak', count: { min: 20, max: 40 } },
          { type: 'shrub', count: { min: 20, max: 40 } },
          { type: 'grass', count: 1, options: { width: 150, depth: 150 } },
          { type: 'river', count: { min: 1, max: 2 } },
          { type: 'lake', count: { min: 1, max: 2 } },
          { type: 'boulder', count: { min: 10, max: 20 } },
          { type: 'sky', count: 1, options: { gradient: true } },
          { type: 'cloud_layer', count: 1 }
        ],
        layout: 'organic',
        spacing: { tree: 8, rock: 5 }
      },
      'coastal_town': {
        keywords: ['coastal', 'beach', 'seaside', 'ocean', 'harbor'],
        theme: 'coastal',
        description: 'A coastal town with beach and ocean',
        assets: [
          { type: 'building_house', count: { min: 12, max: 25 }, randomize: true },
          { type: 'building_shop', count: { min: 4, max: 10 }, randomize: true },
          { type: 'beach', count: 1, options: { width: 150, depth: 40 } },
          { type: 'ocean', count: 1, options: { width: 300, depth: 300 } },
          { type: 'tree_palm', count: { min: 20, max: 40 }, randomize: true },
          { type: 'road_street', count: { min: 5, max: 10 } },
          { type: 'sky', count: 1, options: { color: 0x87ceeb } },
          { type: 'sun', count: 1 }
        ],
        layout: 'linear',
        spacing: { building: 18, road: 12 }
      },
      'desert_outpost': {
        keywords: ['desert', 'arid', 'sand', 'dunes', 'outpost'],
        theme: 'desert',
        description: 'A desert outpost with minimal vegetation',
        assets: [
          { type: 'desert', count: 1, options: { width: 150, depth: 150 } },
          { type: 'building_hut', count: { min: 3, max: 7 } },
          { type: 'building_warehouse', count: { min: 1, max: 2 } },
          { type: 'road_path_dirt', count: { min: 2, max: 4 } },
          { type: 'boulder', count: { min: 5, max: 15 } },
          { type: 'rock', count: { min: 20, max: 40 } },
          { type: 'sky', count: 1, options: { color: 0xffa500 } },
          { type: 'sun', count: 1 }
        ],
        layout: 'cluster',
        spacing: { building: 20, rock: 3 }
      },
      'urban_park': {
        keywords: ['park', 'urban park', 'city park', 'green space'],
        theme: 'park',
        description: 'An urban park with paths and greenery',
        assets: [
          { type: 'grass', count: 1, options: { width: 80, depth: 80 } },
          { type: 'tree_oak', count: { min: 15, max: 30 } },
          { type: 'tree_maple', count: { min: 10, max: 20 } },
          { type: 'shrub', count: { min: 20, max: 40 } },
          { type: 'flower_rose', count: { min: 30, max: 60 } },
          { type: 'road_path_gravel', count: { min: 4, max: 8 } },
          { type: 'pond', count: { min: 1, max: 2 } },
          { type: 'sky', count: 1, options: { gradient: true } }
        ],
        layout: 'organic',
        spacing: { tree: 8, path: 10 }
      },
      'space_station': {
        keywords: ['space', 'station', 'orbital', 'spacecraft'],
        theme: 'space',
        description: 'A futuristic space environment',
        assets: [
          { type: 'building_skyscraper', count: { min: 2, max: 4 }, scale: { x: 2, y: 3, z: 2 } },
          { type: 'stars', count: 1 },
          { type: 'moon', count: 1 }
        ],
        layout: 'floating',
        spacing: { building: 50 }
      }
    };
  }

  initializeCompositionRules() {
    return {
      grid: {
        arrange: (assets, spacing) => this.arrangeGrid(assets, spacing),
        description: 'Arrange assets in a regular grid pattern'
      },
      organic: {
        arrange: (assets, spacing) => this.arrangeOrganic(assets, spacing),
        description: 'Arrange assets in a natural, irregular pattern'
      },
      linear: {
        arrange: (assets, spacing) => this.arrangeLinear(assets, spacing),
        description: 'Arrange assets along a line'
      },
      cluster: {
        arrange: (assets, spacing) => this.arrangeCluster(assets, spacing),
        description: 'Arrange assets in clustered groups'
      },
      floating: {
        arrange: (assets, spacing) => this.arrangeFloating(assets, spacing),
        description: 'Arrange assets in 3D space (for space scenes)'
      }
    };
  }

  /**
   * Parse natural language prompt and generate scene
   * Now with AI-powered analysis for intelligent generation
   * @param {string} prompt - Natural language description
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Object>} Generated scene information
   */
  async generateSceneFromPrompt(prompt, progressCallback = null) {
    console.log(`🎨 Generating scene from prompt: "${prompt}"`);
    console.log('🎯 SCENE GENERATION ROUTING:');
    console.log('  AI Mode Enabled:', this.useAI);
    console.log('  Using Templates:', false);  // Should always be false!
    
    // Set new random seed for unique generation
    this.setRandomSeed();
    
    if (progressCallback) {
      progressCallback({ stage: 'Analyzing prompt with AI...', progress: 0.1 });
    }
    
    // FORCE AI-powered generation - NO TEMPLATE FALLBACK
    if (!this.useAI) {
      throw new Error('❌ AI mode is disabled. Scene generation requires AI analysis.');
    }
    
    console.log('🤖 Calling AI scene generation (NO template fallback)...');
    
    try {
      const aiScene = await this.generateAIScene(prompt, progressCallback);
      if (aiScene) {
        console.log(`✅ AI scene generated successfully: ${aiScene.assets?.length || 0} assets created`);
        console.log('✅ NO templates were used - all content is AI-generated and unique');
        return aiScene;
      }
      
      // If AI returns null/undefined, throw error instead of falling back
      throw new Error('AI generation returned no scene data');
      
    } catch (error) {
      console.error('❌ AI generation failed:', error.message);
      console.error('❌ NOT falling back to templates - throwing error');
      throw new Error(`Scene generation failed: ${error.message}. Please check API configuration.`);
    }
  }
  
  /**
   * Generate scene using AI analysis (NEW)
   * This method sends the prompt to the backend for AI processing
   */
  async generateAIScene(prompt, progressCallback = null) {
    console.log('🤖 Requesting AI scene analysis...');
    console.log('🎯 API Endpoint: /api/generate (with AI processing)');
    
    try {
      // Note: We're using the existing generate endpoint which now has taxonomy support
      // The backend will analyze the prompt and return enriched data
      if (progressCallback) {
        progressCallback({ stage: 'AI analyzing prompt...', progress: 0.15 });
      }
      
      console.log('📡 Calling backend API service...');
      
      // Generate design using API (this goes through backend AI service)
      const result = await this.apiService.generateDesign(prompt, (progress) => {
        console.log('📊 Generation progress:', progress);
        if (progressCallback && progress.status === 'analyzing') {
          progressCallback({ stage: 'AI extracting scene elements...', progress: 0.2 });
        } else if (progressCallback && progress.status === 'generating') {
          progressCallback({ stage: 'Building 3D scene...', progress: 0.4 });
        }
      });
      
      console.log('📦 API Response received:', {
        success: result.success,
        hasDesign: !!result.design,
        hasTaxonomyData: !!result.design?.specifications?.taxonomyData,
        taxonomyElements: result.design?.specifications?.taxonomyData?.elements?.length || 0,
        specElements: result.design?.specifications?.elements?.length || 0
      });
      
      if (!result.success || !result.design) {
        console.error('❌ AI generation returned no design');
        throw new Error('AI generation failed: No design data received');
      }
      
      if (progressCallback) {
        progressCallback({ stage: 'Creating scene assets...', progress: 0.5 });
      }
      
      // Extract taxonomy data if available
      const taxonomyData = result.design.specifications?.taxonomyData;
      
      if (taxonomyData && taxonomyData.elements && taxonomyData.elements.length > 0) {
        console.log('✅ Using taxonomy-based generation with', taxonomyData.elements.length, 'elements');
        // Use taxonomy-based generation
        return await this.composeAIScene(taxonomyData, prompt, progressCallback);
      } else {
        console.log('✅ Using standard AI-enhanced generation (composeFromSpecs)');
        console.log('   Specifications:', {
          elements: result.design.specifications?.elements?.length || 0,
          objectType: result.design.specifications?.objectType
        });
        // Use standard generation with AI-enhanced specs
        return await this.composeFromSpecs(result.design.specifications, prompt, progressCallback);
      }
      
    } catch (error) {
      console.error('❌ Error in AI scene generation:', error);
      return null;
    }
  }
  
  /**
   * Compose scene from AI taxonomy analysis
   */
  async composeAIScene(taxonomyData, originalPrompt, progressCallback = null) {
    const { elements, spatialComposition, environmentalContext, realism } = taxonomyData;
    
    console.log(`🏗️ Composing AI scene with ${elements.length} element types`);
    
    const sceneAssets = [];
    let progressIncrement = 0.4 / elements.length;
    let currentProgress = 0.5;
    
    // Generate each element type from taxonomy
    for (const element of elements) {
      const quantity = element.quantity || 1;
      
      if (progressCallback) {
        progressCallback({ 
          stage: `Creating ${element.name || element.subcategory}...`, 
          progress: currentProgress 
        });
      }
      
      // Map taxonomy category to asset type
      const assetType = this.mapTaxonomyToAssetType(element);
      
      if (assetType) {
        for (let i = 0; i < quantity; i++) {
          try {
            const asset = this.assetManager.getAsset(assetType);
            if (asset && asset.generator) {
              // Generate asset with variation and dimensions from taxonomy
              // Scale dimensions appropriately for Three.js scene
              // Taxonomy gives dimensions in meters, but scene needs larger units for visibility
              const SCALE_FACTOR = 100; // 1 meter = 100 scene units for proper visibility
              
              const options = {
                seed: this.seed + i,
                variation: this.seededRandom(0, 1),
                ...element.placement,
                // Scale dimensions for proper Three.js visibility
                width: element.dimensions?.width ? element.dimensions.width * SCALE_FACTOR : undefined,
                depth: element.dimensions?.depth ? element.dimensions.depth * SCALE_FACTOR : undefined,
                height: element.dimensions?.height ? element.dimensions.height * SCALE_FACTOR : undefined
              };
              
              const result = await asset.generate(options);
              
              // Create scene object with proper geometry type
              const sceneObject = this.sceneManager.createObject(
                `${element.name} ${i + 1}`,
                'environment_asset',
                {
                  type: 'environment', // This must match the check in SceneObject renderer
                  assetId: assetType,
                  assetName: asset.name,
                  category: element.category,
                  subcategory: element.subcategory,
                  aiGenerated: true,
                  seed: this.seed + i
                }
              );
              
              // Store generated Three.js data
              if (result.geometry) sceneObject.userData.geometry = result.geometry;
              if (result.material) sceneObject.userData.material = result.material;
              if (result instanceof THREE.Group) sceneObject.userData.group = result;
              
              // No additional scaling needed - dimensions are passed to generator directly
              
              // Store for positioning
              sceneAssets.push({
                object: sceneObject,
                element: element,
                index: i
              });
              
              await this.delay(30);
            }
          } catch (error) {
            console.error(`Error generating ${element.name}:`, error);
          }
        }
      }
      
      currentProgress += progressIncrement;
    }
    
    if (progressCallback) {
      progressCallback({ stage: 'Arranging scene layout...', progress: 0.9 });
    }
    
    await this.delay(200);
    
    // Apply realistic positioning based on spatial composition
    const layout = spatialComposition?.layout || 'organic';
    this.applyAILayout(sceneAssets, spatialComposition, environmentalContext);
    
    if (progressCallback) {
      progressCallback({ stage: 'Complete!', progress: 1.0 });
    }
    
    return {
      template: 'ai_generated',
      theme: taxonomyData.style?.theme || 'custom',
      description: `AI-generated ${taxonomyData.primaryCategory} scene`,
      assets: sceneAssets,
      prompt: originalPrompt,
      seed: this.seed,
      aiGenerated: true,
      taxonomyData
    };
  }
  
  /**
   * Map taxonomy category to existing asset type
   */
  mapTaxonomyToAssetType(element) {
    const { category, subcategory } = element;
    
    // Map taxonomy categories to asset types
    const mapping = {
      residential: {
        house: 'building_house',
        apartment: 'building_apartment',
        townhouse: 'building_house',
        mansion: 'building_house'
      },
      commercial: {
        office_building: 'building_apartment',
        skyscraper: 'building_skyscraper',
        retail_store: 'building_shop',
        mall: 'building_shop',
        hotel: 'building_apartment'
      },
      institutional: {
        school: 'building_apartment',
        hospital: 'building_apartment',
        place_of_worship: 'building_church',
        stadium: 'building_apartment'
      },
      industrial: {
        factory: 'building_factory',
        warehouse: 'building_warehouse'
      },
      flora: {
        trees: 'tree_oak',
        deciduous: 'tree_oak',
        coniferous: 'tree_pine',
        palm: 'tree_palm'
      },
      landforms: {
        mountain: 'mountain',
        hill: 'hill',
        beach: 'beach',
        plain: 'plain'
      },
      water_bodies: {
        ocean: 'ocean',
        sea: 'ocean',
        river: 'river',
        lake: 'lake',
        pond: 'pond'
      },
      infrastructure: {
        highway: 'road_highway',
        street: 'road_street',
        road: 'road_street',
        bridge: 'road_street'
      }
    };
    
    // Look up asset type
    if (mapping[category] && mapping[category][subcategory]) {
      return mapping[category][subcategory];
    }
    
    // Try subcategory directly
    const directMapping = {
      'tree_oak': 'tree_oak',
      'tree_pine': 'tree_pine',
      'tree_palm': 'tree_palm',
      'grass': 'grass',
      'shrub': 'shrub',
      'building_house': 'building_house',
      'building_apartment': 'building_apartment',
      'building_skyscraper': 'building_skyscraper'
    };
    
    return directMapping[subcategory] || null;
  }
  
  /**
   * Apply AI-based layout with realistic placement
   */
  applyAILayout(assets, spatialComposition, environmentalContext) {
    const layout = spatialComposition?.layout || 'organic';
    const zones = spatialComposition?.zones || [];
    
    // Separate by priority if available
    const priorityGroups = {
      primary: assets.filter(a => a.element.placement?.priority === 'primary'),
      secondary: assets.filter(a => a.element.placement?.priority === 'secondary'),
      tertiary: assets.filter(a => a.element.placement?.priority === 'tertiary')
    };
    
    // Place primary elements first
    if (priorityGroups.primary.length > 0) {
      this.placeElementGroup(priorityGroups.primary, layout, 'primary');
    }
    
    // Then secondary
    if (priorityGroups.secondary.length > 0) {
      this.placeElementGroup(priorityGroups.secondary, layout, 'secondary');
    }
    
    // Finally tertiary
    if (priorityGroups.tertiary.length > 0) {
      this.placeElementGroup(priorityGroups.tertiary, layout, 'tertiary');
    }
    
    // Place any uncategorized assets
    const uncategorized = assets.filter(a => !a.element.placement?.priority);
    if (uncategorized.length > 0) {
      this.placeElementGroup(uncategorized, layout, 'default');
    }
  }
  
  /**
   * Place a group of elements based on layout and priority
   */
  placeElementGroup(assets, layout, priority) {
    // Scale spacing to match 100x dimension scaling (1 meter = 100 scene units)
    const SCALE_FACTOR = 100;
    const spacing = priority === 'primary' ? 50 * SCALE_FACTOR : priority === 'secondary' ? 30 * SCALE_FACTOR : 10 * SCALE_FACTOR;
    const spread = priority === 'primary' ? 150 * SCALE_FACTOR : 100 * SCALE_FACTOR;
    
    assets.forEach((asset, idx) => {
      const position = this.calculateSmartPosition(idx, assets.length, layout, spacing, spread, assets);
      asset.object.position = position;
      
      // Add rotation variation
      asset.object.rotation = {
        x: 0,
        y: this.seededRandom(0, Math.PI * 2),
        z: 0
      };
    });
  }
  
  /**
   * Calculate smart position that avoids collisions
   */
  calculateSmartPosition(index, total, layout, spacing, spread, existingAssets) {
    const maxAttempts = 50;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let position;
      
      switch (layout) {
        case 'grid':
          const gridSize = Math.ceil(Math.sqrt(total));
          const row = Math.floor(index / gridSize);
          const col = index % gridSize;
          position = {
            x: (col - gridSize / 2) * spacing + this.seededRandom(-spacing * 0.1, spacing * 0.1),
            y: 0,
            z: (row - gridSize / 2) * spacing + this.seededRandom(-spacing * 0.1, spacing * 0.1)
          };
          break;
          
        case 'linear':
          position = {
            x: (index - total / 2) * spacing,
            y: 0,
            z: this.seededRandom(-spacing * 0.3, spacing * 0.3)
          };
          break;
          
        case 'organic':
        default:
          position = {
            x: this.seededRandom(-spread, spread),
            y: 0,
            z: this.seededRandom(-spread, spread)
          };
          break;
      }
      
      // Check if position is valid
      const isValid = existingAssets
        .slice(0, index)
        .every(existing => {
          if (!existing.object.position) return true;
          const dx = position.x - existing.object.position.x;
          const dz = position.z - existing.object.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          return dist >= spacing * 0.8;
        });
      
      if (isValid) return position;
    }
    
    // Fallback position if no valid position found
    return {
      x: this.seededRandom(-spread, spread),
      y: 0,
      z: this.seededRandom(-spread, spread)
    };
  }
  
  /**
   * Compose scene from AI specifications (NO template fallback)
   * Generates scene elements directly from AI specifications
   */
  async composeFromSpecs(specifications, originalPrompt, progressCallback = null) {
    console.log('🏗️ Composing scene from AI specifications (NO templates)');
    console.log('📋 Specifications:', {
      objectType: specifications.objectType,
      objectCount: specifications.objectCount,
      elements: specifications.elements?.length || 0
    });
    
    // Extract elements from specifications
    const elements = specifications.elements || [];
    
    if (elements.length === 0) {
      console.warn('⚠️ No elements in AI specifications, creating single object');
      // Create a single element from the specifications
      elements.push({
        category: specifications.objectType || 'object',
        subcategory: specifications.objectType || 'object',
        name: specifications.name || 'Generated Object',
        quantity: specifications.objectCount || 1,
        dimensions: {
          width: (specifications.dimensions?.width || 10000) / 1000, // Convert mm to meters
          height: (specifications.dimensions?.height || 10000) / 1000,
          depth: (specifications.dimensions?.depth || 10000) / 1000
        },
        materials: specifications.materials || ['default'],
        placement: {
          priority: 'primary'
        }
      });
    }
    
    // Create scene assets from elements
    const sceneAssets = [];
    let progressIncrement = 0.4 / elements.length;
    let currentProgress = 0.5;
    
    if (progressCallback) {
      progressCallback({ stage: 'Creating scene elements...', progress: currentProgress });
    }
    
    for (const element of elements) {
      const quantity = element.quantity || 1;
      
      if (progressCallback) {
        progressCallback({ 
          stage: `Creating ${element.name || element.subcategory}...`, 
          progress: currentProgress 
        });
      }
      
      // Map element to asset type
      const assetType = this.mapTaxonomyToAssetType(element);
      
      if (assetType) {
        for (let i = 0; i < quantity; i++) {
          try {
            const asset = this.assetManager.getAsset(assetType);
            if (asset && asset.generator) {
              const SCALE_FACTOR = 100;
              
              const options = {
                seed: this.seed + i,
                variation: this.seededRandom(0, 1),
                width: element.dimensions?.width ? element.dimensions.width * SCALE_FACTOR : undefined,
                depth: element.dimensions?.depth ? element.dimensions.depth * SCALE_FACTOR : undefined,
                height: element.dimensions?.height ? element.dimensions.height * SCALE_FACTOR : undefined
              };
              
              const result = await asset.generate(options);
              
              const sceneObject = this.sceneManager.createObject(
                `${element.name || element.subcategory} ${i + 1}`,
                'environment_asset',
                {
                  type: 'environment',
                  assetId: assetType,
                  assetName: asset.name,
                  category: element.category,
                  subcategory: element.subcategory,
                  aiGenerated: true,
                  seed: this.seed + i
                }
              );
              
              if (result.geometry) sceneObject.userData.geometry = result.geometry;
              if (result.material) sceneObject.userData.material = result.material;
              if (result instanceof THREE.Group) sceneObject.userData.group = result;
              
              sceneAssets.push({
                object: sceneObject,
                element: element,
                index: i
              });
              
              await this.delay(30);
            }
          } catch (error) {
            console.error(`Error generating ${element.name}:`, error);
          }
        }
      }
      
      currentProgress += progressIncrement;
    }
    
    if (progressCallback) {
      progressCallback({ stage: 'Arranging scene layout...', progress: 0.9 });
    }
    
    await this.delay(200);
    
    // Apply intelligent positioning
    this.applyAILayout(sceneAssets, { layout: 'organic' }, {});
    
    if (progressCallback) {
      progressCallback({ stage: 'Complete!', progress: 1.0 });
    }
    
    return {
      template: 'ai_generated',
      theme: specifications.style || 'custom',
      description: specifications.description || 'AI-generated scene',
      assets: sceneAssets,
      prompt: originalPrompt,
      seed: this.seed,
      aiGenerated: true
    };
  }
  
  /**
   * Delay helper for progressive generation
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Identify which scene template matches the prompt
   */
  identifySceneTemplate(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Find best matching template
    for (const [templateId, template] of Object.entries(this.sceneTemplates)) {
      const matchScore = template.keywords.reduce((score, keyword) => {
        return score + (lowerPrompt.includes(keyword) ? 1 : 0);
      }, 0);
      
      if (matchScore > 0) {
        return { id: templateId, ...template, matchScore };
      }
    }
    
    return null;
  }

  /**
   * Compose a complete scene from template
   */
  async composeScene(template, originalPrompt, progressCallback = null) {
    const sceneAssets = [];
    const layoutRule = this.compositionRules[template.layout];
    
    console.log(`📐 Using ${template.layout} layout for ${template.theme} scene`);

    // Calculate total assets for progress tracking
    let totalAssets = 0;
    let processedAssets = 0;
    template.assets.forEach(spec => {
      const count = typeof spec.count === 'number' 
        ? spec.count 
        : this.randomInt(spec.count.min, spec.count.max);
      totalAssets += count;
    });

    // Generate each asset type
    for (const assetSpec of template.assets) {
      const count = typeof assetSpec.count === 'number' 
        ? assetSpec.count 
        : this.randomInt(assetSpec.count.min, assetSpec.count.max);
      
      if (progressCallback) {
        progressCallback({ 
          stage: `Creating ${assetSpec.type.replace('_', ' ')}...`, 
          progress: 0.3 + (processedAssets / totalAssets) * 0.6 
        });
      }
      
      for (let i = 0; i < count; i++) {
        try {
          const asset = this.assetManager.getAsset(assetSpec.type);
          if (!asset || !asset.generator) {
            console.warn(`Asset ${assetSpec.type} not found or has no generator`);
            continue;
          }

          // Generate the asset with randomized options if specified
          const options = { ...assetSpec.options };
          if (assetSpec.randomize) {
            // Add variation seed for each asset
            options.seed = this.seed + i;
            options.variation = this.seededRandom(0, 1);
          }
          
          const result = await asset.generate(options);
          
          // Create scene object
          const sceneObject = this.sceneManager.createObject(
            `${asset.name} ${i + 1}`,
            'environment_asset',
            {
              type: 'environment',
              assetId: asset.id,
              assetName: asset.name,
              category: asset.category,
              subcategory: asset.subcategory,
              sceneComposed: true,
              templateId: template.id,
              seed: this.seed + i
            }
          );

          // Store generated data
          if (result.geometry) sceneObject.userData.geometry = result.geometry;
          if (result.material) sceneObject.userData.material = result.material;
          if (result instanceof THREE.Group) sceneObject.userData.group = result;

          // Apply scale with randomization if specified
          if (assetSpec.scale) {
            if (assetSpec.scale.min && assetSpec.scale.max && assetSpec.randomize) {
              // Random scale within range
              sceneObject.scale = {
                x: this.seededRandom(assetSpec.scale.min.x, assetSpec.scale.max.x),
                y: this.seededRandom(assetSpec.scale.min.y, assetSpec.scale.max.y),
                z: this.seededRandom(assetSpec.scale.min.z, assetSpec.scale.max.z)
              };
            } else if (assetSpec.scale.x !== undefined) {
              sceneObject.scale = { ...assetSpec.scale };
            }
          }

          // Store for positioning
          sceneAssets.push({
            object: sceneObject,
            spec: assetSpec,
            index: i
          });
          
          processedAssets++;
          
          // Add small delay every few assets for progressive feel
          if (i % 5 === 0 && i > 0) {
            await this.delay(50);
          }
          
        } catch (error) {
          console.error(`Error generating asset ${assetSpec.type}:`, error);
        }
      }
    }

    if (progressCallback) {
      progressCallback({ stage: 'Arranging scene layout...', progress: 0.9 });
    }
    
    await this.delay(200);

    // Apply layout positioning
    if (layoutRule) {
      layoutRule.arrange(sceneAssets, template.spacing, template.scale);
    }

    if (progressCallback) {
      progressCallback({ stage: 'Complete!', progress: 1.0 });
    }

    return {
      template: template.id,
      theme: template.theme,
      description: template.description,
      assets: sceneAssets,
      prompt: originalPrompt,
      seed: this.seed
    };
  }

  /**
   * Grid layout arrangement - for cities and organized environments
   */
  arrangeGrid(assets, spacing, scale = 'normal') {
    const buildingSpacing = spacing.building || 60;
    const roadSpacing = spacing.road || 40;
    const gridSizeOverride = spacing.grid || null;
    
    // Calculate grid size based on scale
    let baseArea = 100;
    if (scale === 'city') {
      baseArea = 300; // Much larger area for city-scale
    } else if (scale === 'town') {
      baseArea = 180;
    } else if (scale === 'village') {
      baseArea = 120;
    }
    
    // Separate buildings and roads
    const buildings = assets.filter(item => item.spec.type.includes('building'));
    const roads = assets.filter(item => item.spec.type.includes('road'));
    const other = assets.filter(item => !item.spec.type.includes('building') && !item.spec.type.includes('road'));
    
    // Arrange buildings in a varied grid
    const gridSize = gridSizeOverride || Math.ceil(Math.sqrt(buildings.length));
    buildings.forEach((item, idx) => {
      const row = Math.floor(idx / gridSize);
      const col = idx % gridSize;
      
      // Add random offset for more organic city feel
      const offsetX = this.seededRandom(-buildingSpacing * 0.15, buildingSpacing * 0.15);
      const offsetZ = this.seededRandom(-buildingSpacing * 0.15, buildingSpacing * 0.15);
      
      item.object.position.x = (col - gridSize / 2) * buildingSpacing + offsetX;
      item.object.position.z = (row - gridSize / 2) * buildingSpacing + offsetZ;
      item.object.position.y = 0;
      
      // Random rotation for variety
      item.object.rotation.y = this.seededRandom(0, Math.PI * 2);
    });
    
    // Arrange roads between buildings
    roads.forEach((item, idx) => {
      const roadType = item.spec.type;
      
      if (roadType.includes('highway')) {
        // Highways run across the scene
        item.object.position.x = idx * roadSpacing - baseArea/4;
        item.object.position.z = this.seededRandom(-baseArea/3, baseArea/3);
        item.object.rotation.y = 0;
      } else if (roadType.includes('street')) {
        // Streets between buildings
        const row = Math.floor(idx / 2);
        item.object.position.x = (idx % 2 === 0) ? -baseArea/3 : baseArea/3;
        item.object.position.z = (row - 2) * roadSpacing;
        item.object.rotation.y = Math.PI / 2;
      } else if (roadType.includes('intersection')) {
        // Intersections at key points
        const row = Math.floor(idx / 2);
        const col = idx % 2;
        item.object.position.x = (col - 0.5) * baseArea/2;
        item.object.position.z = (row - 1) * baseArea/3;
      } else {
        // Default road positioning
        item.object.position.x = idx * roadSpacing - baseArea/4;
        item.object.position.z = 0;
      }
      
      item.object.position.y = 0;
    });
    
    // Scatter other elements (trees, etc.)
    other.forEach((item) => {
      const assetType = item.spec.type;
      
      if (assetType.includes('sky') || assetType.includes('cloud')) {
        // Sky elements centered above
        item.object.position.x = 0;
        item.object.position.y = assetType.includes('sky') ? 0 : 50;
        item.object.position.z = 0;
      } else {
        // Random placement for trees, decorations
        item.object.position.x = this.seededRandom(-baseArea/2, baseArea/2);
        item.object.position.z = this.seededRandom(-baseArea/2, baseArea/2);
        item.object.position.y = 0;
      }
    });
  }

  /**
   * Organic layout arrangement - for natural and village scenes
   */
  arrangeOrganic(assets, spacing, scale = 'normal') {
    // Determine spread based on scale
    const spread = spacing.spread || 80;
    const actualSpread = scale === 'village' ? spread * 1.5 : spread;
    
    assets.forEach((item) => {
      const assetType = item.spec.type;
      const distance = item.spec.distance || actualSpread;
      
      // Add natural randomness with clustering
      const angle = this.seededRandom(0, Math.PI * 2);
      const radius = this.seededRandom(0, distance);
      
      // Create clusters for certain asset types
      if (assetType.includes('building')) {
        // Buildings cluster near center
        const clusterRadius = radius * 0.6;
        item.object.position.x = Math.cos(angle) * clusterRadius;
        item.object.position.z = Math.sin(angle) * clusterRadius;
        item.object.rotation.y = this.seededRandom(0, Math.PI * 2);
      } else if (assetType.includes('tree') || assetType.includes('shrub')) {
        // Vegetation spreads wider
        item.object.position.x = Math.cos(angle) * radius;
        item.object.position.z = Math.sin(angle) * radius;
        item.object.rotation.y = this.seededRandom(0, Math.PI * 2);
      } else if (assetType.includes('mountain') || assetType.includes('hill')) {
        // Terrain at edges
        const terrainAngle = this.seededRandom(0, Math.PI * 2);
        const terrainDistance = distance * 1.2;
        item.object.position.x = Math.cos(terrainAngle) * terrainDistance;
        item.object.position.z = Math.sin(terrainAngle) * terrainDistance;
      } else {
        // Default organic spread
        item.object.position.x = Math.cos(angle) * radius;
        item.object.position.z = Math.sin(angle) * radius;
      }
      
      item.object.position.y = 0;
    });
  }

  /**
   * Linear layout arrangement (for coastal scenes)
   */
  arrangeLinear(assets, spacing) {
    let position = -100;
    const buildingSpacing = spacing.building || 20;
    
    assets.forEach((item) => {
      const assetType = item.spec.type;
      
      if (assetType.includes('building')) {
        item.object.position.x = position;
        item.object.position.z = Math.random() * 20 - 10;
        item.object.position.y = 0;
        position += buildingSpacing;
      } else if (assetType === 'ocean' || assetType === 'beach') {
        item.object.position.x = 0;
        item.object.position.z = -60;
        item.object.position.y = 0;
      } else {
        item.object.position.x = (Math.random() - 0.5) * 150;
        item.object.position.z = (Math.random() - 0.5) * 60;
        item.object.position.y = 0;
      }
    });
  }

  /**
   * Cluster layout arrangement
   */
  arrangeCluster(assets, spacing) {
    const clusterCenters = [
      { x: -30, z: -30 },
      { x: 30, z: -30 },
      { x: 0, z: 30 }
    ];
    
    assets.forEach((item, index) => {
      const cluster = clusterCenters[index % clusterCenters.length];
      const offset = 15;
      
      item.object.position.x = cluster.x + (Math.random() - 0.5) * offset;
      item.object.position.z = cluster.z + (Math.random() - 0.5) * offset;
      item.object.position.y = 0;
    });
  }

  /**
   * Floating layout arrangement (for space scenes)
   */
  arrangeFloating(assets, spacing) {
    assets.forEach((item) => {
      item.object.position.x = (Math.random() - 0.5) * 200;
      item.object.position.y = (Math.random() - 0.5) * 100;
      item.object.position.z = (Math.random() - 0.5) * 200;
      
      // Random rotation for floating objects
      item.object.rotation.x = Math.random() * Math.PI;
      item.object.rotation.y = Math.random() * Math.PI;
      item.object.rotation.z = Math.random() * Math.PI;
    });
  }

  /**
   * Generate a generic scene when no template matches
   */
  async generateGenericScene(prompt) {
    console.log('📦 Generating generic scene');
    
    // Extract key objects from prompt
    const keywords = this.extractKeywords(prompt);
    const sceneAssets = [];
    
    for (const keyword of keywords) {
      const assets = this.assetManager.searchAssets(keyword);
      if (assets.length > 0) {
        const asset = assets[0];
        if (asset.generator) {
          try {
            const result = await asset.generate({});
            const sceneObject = this.sceneManager.createObject(
              asset.name,
              'environment_asset',
              {
                type: 'environment',
                assetId: asset.id,
                assetName: asset.name
              }
            );
            
            if (result.geometry) sceneObject.userData.geometry = result.geometry;
            if (result.material) sceneObject.userData.material = result.material;
            if (result instanceof THREE.Group) sceneObject.userData.group = result;
            
            sceneAssets.push({ object: sceneObject, spec: { type: asset.id } });
          } catch (error) {
            console.error(`Error generating ${asset.id}:`, error);
          }
        }
      }
    }
    
    // Simple random positioning
    sceneAssets.forEach((item, index) => {
      item.object.position.x = (index - sceneAssets.length / 2) * 20;
      item.object.position.z = 0;
      item.object.position.y = 0;
    });
    
    return {
      template: 'generic',
      theme: 'custom',
      description: 'Custom scene from prompt',
      assets: sceneAssets,
      prompt
    };
  }

  /**
   * Extract keywords from prompt for generic scene generation
   */
  extractKeywords(prompt) {
    const words = prompt.toLowerCase().split(/\s+/);
    const commonWords = ['a', 'an', 'the', 'with', 'and', 'or', 'create', 'generate', 'make', 'build'];
    return words.filter(word => !commonWords.includes(word) && word.length > 3);
  }

  /**
   * Utility function for random integer
   */
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Get list of available scene templates
   */
  getAvailableScenes() {
    return Object.entries(this.sceneTemplates).map(([id, template]) => ({
      id,
      theme: template.theme,
      description: template.description,
      keywords: template.keywords
    }));
  }
}

export default SceneComposer;
