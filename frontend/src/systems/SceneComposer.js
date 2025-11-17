/**
 * Scene Composer - Generates complete environments from natural language descriptions
 * Interprets prompts and creates coordinated multi-asset scenes
 */

import * as THREE from 'three';

export class SceneComposer {
  constructor(assetManager, generators, sceneManager) {
    this.assetManager = assetManager;
    this.generators = generators;
    this.sceneManager = sceneManager;
    
    // Scene templates and composition rules
    this.sceneTemplates = this.initializeSceneTemplates();
    this.compositionRules = this.initializeCompositionRules();
  }

  initializeSceneTemplates() {
    return {
      'futuristic_city': {
        keywords: ['futuristic', 'future', 'sci-fi', 'modern', 'advanced', 'city'],
        theme: 'futuristic',
        description: 'A futuristic cityscape with tall buildings and advanced infrastructure',
        assets: [
          { type: 'building_skyscraper', count: { min: 8, max: 15 }, scale: { x: 1.2, y: 1.5, z: 1.2 } },
          { type: 'building_apartment', count: { min: 5, max: 10 }, scale: { x: 1.0, y: 1.3, z: 1.0 } },
          { type: 'road_highway', count: { min: 2, max: 4 } },
          { type: 'road_street', count: { min: 5, max: 8 } },
          { type: 'road_intersection', count: { min: 3, max: 6 } },
          { type: 'sky', count: 1, options: { color: 0x4a5f8f } },
          { type: 'cloud_layer', count: 1 },
          { type: 'tree_palm', count: { min: 3, max: 8 }, scale: { x: 0.8, y: 0.8, z: 0.8 } }
        ],
        layout: 'grid',
        spacing: { building: 25, road: 15 }
      },
      'medieval_village': {
        keywords: ['medieval', 'village', 'old', 'historical', 'ancient'],
        theme: 'medieval',
        description: 'A medieval village with houses and natural surroundings',
        assets: [
          { type: 'building_house', count: { min: 8, max: 15 } },
          { type: 'building_hut', count: { min: 3, max: 6 } },
          { type: 'building_church', count: 1, scale: { x: 1.5, y: 1.5, z: 1.5 } },
          { type: 'road_path_dirt', count: { min: 4, max: 7 } },
          { type: 'tree_oak', count: { min: 15, max: 30 } },
          { type: 'shrub', count: { min: 10, max: 20 } },
          { type: 'grass', count: 1, options: { width: 100, depth: 100 } },
          { type: 'mountain', count: { min: 1, max: 3 }, distance: 150 }
        ],
        layout: 'organic',
        spacing: { building: 15, road: 10 }
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
          { type: 'building_house', count: { min: 10, max: 20 } },
          { type: 'building_shop', count: { min: 3, max: 6 } },
          { type: 'beach', count: 1, options: { width: 100, depth: 30 } },
          { type: 'ocean', count: 1, options: { width: 200, depth: 200 } },
          { type: 'tree_palm', count: { min: 15, max: 30 } },
          { type: 'road_street', count: { min: 3, max: 6 } },
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
   * @param {string} prompt - Natural language description
   * @returns {Promise<Object>} Generated scene information
   */
  async generateSceneFromPrompt(prompt) {
    console.log(`🎨 Generating scene from prompt: "${prompt}"`);
    
    // Parse prompt to identify scene type
    const sceneTemplate = this.identifySceneTemplate(prompt);
    
    if (!sceneTemplate) {
      return this.generateGenericScene(prompt);
    }

    // Generate the scene
    const scene = await this.composeScene(sceneTemplate, prompt);
    
    console.log(`✅ Scene generated: ${scene.assets.length} assets created`);
    return scene;
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
  async composeScene(template, originalPrompt) {
    const sceneAssets = [];
    const layoutRule = this.compositionRules[template.layout];
    
    console.log(`📐 Using ${template.layout} layout for ${template.theme} scene`);

    // Generate each asset type
    for (const assetSpec of template.assets) {
      const count = typeof assetSpec.count === 'number' 
        ? assetSpec.count 
        : this.randomInt(assetSpec.count.min, assetSpec.count.max);
      
      for (let i = 0; i < count; i++) {
        try {
          const asset = this.assetManager.getAsset(assetSpec.type);
          if (!asset || !asset.generator) {
            console.warn(`Asset ${assetSpec.type} not found or has no generator`);
            continue;
          }

          // Generate the asset
          const options = { ...assetSpec.options };
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
              templateId: template.id
            }
          );

          // Store generated data
          if (result.geometry) sceneObject.userData.geometry = result.geometry;
          if (result.material) sceneObject.userData.material = result.material;
          if (result instanceof THREE.Group) sceneObject.userData.group = result;

          // Apply scale if specified
          if (assetSpec.scale) {
            sceneObject.scale = { ...assetSpec.scale };
          }

          // Store for positioning
          sceneAssets.push({
            object: sceneObject,
            spec: assetSpec,
            index: i
          });
          
        } catch (error) {
          console.error(`Error generating asset ${assetSpec.type}:`, error);
        }
      }
    }

    // Apply layout positioning
    if (layoutRule) {
      layoutRule.arrange(sceneAssets, template.spacing);
    }

    return {
      template: template.id,
      theme: template.theme,
      description: template.description,
      assets: sceneAssets,
      prompt: originalPrompt
    };
  }

  /**
   * Grid layout arrangement
   */
  arrangeGrid(assets, spacing) {
    const buildingSpacing = spacing.building || 25;
    const roadSpacing = spacing.road || 15;
    const gridSize = Math.ceil(Math.sqrt(assets.length));
    
    let buildingIndex = 0;
    let roadIndex = 0;

    assets.forEach((item) => {
      const assetType = item.spec.type;
      
      if (assetType.includes('building')) {
        const row = Math.floor(buildingIndex / gridSize);
        const col = buildingIndex % gridSize;
        item.object.position.x = (col - gridSize / 2) * buildingSpacing;
        item.object.position.z = (row - gridSize / 2) * buildingSpacing;
        item.object.position.y = 0;
        buildingIndex++;
      } else if (assetType.includes('road')) {
        item.object.position.x = roadIndex * roadSpacing - 50;
        item.object.position.y = 0;
        item.object.position.z = 0;
        roadIndex++;
      } else {
        // Default positioning
        item.object.position.x = (Math.random() - 0.5) * 100;
        item.object.position.z = (Math.random() - 0.5) * 100;
        item.object.position.y = 0;
      }
    });
  }

  /**
   * Organic layout arrangement
   */
  arrangeOrganic(assets, spacing) {
    assets.forEach((item) => {
      const assetType = item.spec.type;
      const distance = item.spec.distance || 50;
      
      // Add natural randomness
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * distance;
      
      item.object.position.x = Math.cos(angle) * radius;
      item.object.position.z = Math.sin(angle) * radius;
      item.object.position.y = 0;
      
      // Add slight rotation variation
      item.object.rotation.y = Math.random() * Math.PI * 2;
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
