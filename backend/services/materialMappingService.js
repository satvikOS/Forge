/**
 * Material Mapping Service
 * Integrates Material Library and Polyhaven services to enhance geometry with PBR materials
 */

const materialLibraryService = require('./materialLibraryService');
const polyhavenService = require('./polyhavenService');
const environmentContextService = require('./environmentContextService');

class MaterialMappingService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize all dependent services with timeout
   */
  async initialize() {
    if (this.initialized) return;

    try {
      console.log('🎨 Initializing Material Mapping Service...');
      
      // Add timeout to prevent hanging
      const initPromise = Promise.race([
        (async () => {
          await materialLibraryService.loadDatabase();
          await polyhavenService.initialize();
        })(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Initialization timeout after 10 seconds')), 10000)
        )
      ]);
      
      await initPromise;
      
      this.initialized = true;
      console.log('✅ Material Mapping Service initialized');
    } catch (error) {
      console.error('⚠️  Failed to initialize Material Mapping Service:', error.message);
      console.log('   Continuing without material mapping...');
      this.initialized = false;
      // Don't throw - allow generation to continue without materials
    }
  }

  /**
   * Main entry point: Assign realistic materials to generated model
   */
  async assignRealisticMaterials(modelData, specifications) {
    await this.initialize();
    
    // If initialization failed, return model as-is
    if (!this.initialized) {
      console.log('⚠️  Skipping material mapping (service not initialized)');
      return {
        modelData,
        environmentConfig: {
          location: 'unknown',
          timeOfDay: 'noon',
          weather: 'clear',
          hdri: null
        }
      };
    }

    console.log('🎨 Assigning realistic PBR materials to model...');

    // Extract environment context
    const environmentContext = environmentContextService.analyzeContext(specifications);
    const environmentConfig = environmentContextService.getEnvironmentConfig(environmentContext);

    // Get HDRI for the environment
    const hdri = await polyhavenService.getHDRIForEnvironment(
      environmentContext.location,
      environmentContext.timeOfDay,
      environmentContext.weather
    );
    environmentConfig.hdri = hdri;

    // Enhance model parts with materials
    const enhancedModel = await this.enhanceModelWithMaterials(modelData, specifications, environmentContext);

    return {
      modelData: enhancedModel,
      environmentConfig,
    };
  }

  /**
   * Enhance model data with PBR material specifications
   */
  async enhanceModelWithMaterials(modelData, specifications, environmentContext) {
    if (!modelData) return modelData;

    const enhanced = { ...modelData };

    // Handle different model data structures
    if (modelData.type === 'composite' && modelData.parts) {
      enhanced.parts = await Promise.all(
        modelData.parts.map(part => this.enhancePartWithMaterials(part, specifications, environmentContext))
      );
    } else if (modelData.type === 'object' && modelData.mesh) {
      if (modelData.mesh.type === 'composite' && modelData.mesh.parts) {
        enhanced.mesh = {
          ...modelData.mesh,
          parts: await Promise.all(
            modelData.mesh.parts.map(part => this.enhancePartWithMaterials(part, specifications, environmentContext))
          ),
        };
      } else {
        enhanced.mesh = await this.enhancePartWithMaterials(modelData.mesh, specifications, environmentContext);
      }
    } else if (modelData.type === 'scene') {
      if (modelData.meshes) {
        enhanced.meshes = await Promise.all(
          modelData.meshes.map(mesh => this.enhancePartWithMaterials(mesh, specifications, environmentContext))
        );
      }
      if (modelData.instances) {
        enhanced.instances = await Promise.all(
          modelData.instances.map(async instance => ({
            ...instance,
            mesh: await this.enhancePartWithMaterials(instance.mesh, specifications, environmentContext),
          }))
        );
      }
    } else if (modelData.type === 'taxonomy_scene' && modelData.meshes) {
      enhanced.meshes = await Promise.all(
        modelData.meshes.map(mesh => this.enhancePartWithMaterials(mesh, specifications, environmentContext))
      );
    }

    return enhanced;
  }

  /**
   * Enhance a single part with PBR material
   */
  async enhancePartWithMaterials(part, specifications, environmentContext) {
    if (!part) return part;

    // Handle nested composite parts
    if (part.type === 'composite' && part.parts) {
      return {
        ...part,
        parts: await Promise.all(
          part.parts.map(p => this.enhancePartWithMaterials(p, specifications, environmentContext))
        ),
      };
    }

    // Extract material specification for this part
    const materialSpec = this.extractMaterialSpec(part, specifications, environmentContext);

    // Get PBR material from library
    const pbrMaterial = await this.getPBRMaterial(materialSpec);

    // Enhance part with PBR data
    return {
      ...part,
      material: part.material, // Keep original material name
      pbrMaterial, // Add PBR material specification
      materialSpec, // Add extracted specification for reference
    };
  }

  /**
   * Extract material specification from part and context
   */
  extractMaterialSpec(part, specifications, environmentContext) {
    const materialName = part.material || part.componentType || 'default';
    
    // Determine finish based on context
    let finish = 'rough';
    
    // Building exteriors are often weathered
    if (part.componentType && part.componentType.includes('building')) {
      finish = 'weathered';
    }
    
    // Glass is always polished
    if (materialName.toLowerCase().includes('glass')) {
      finish = 'polished';
    }
    
    // Metal can be polished in modern buildings
    if (materialName.toLowerCase().includes('metal') && 
        specifications.scene?.style === 'modern') {
      finish = 'polished';
    }

    // Indoor materials are typically cleaner
    if (environmentContext.location === 'indoor') {
      finish = 'new';
    }

    // Determine context
    const context = this.determineContext(part, environmentContext);

    // Determine resolution based on part importance
    const resolution = this.determineResolution(part, specifications);

    return {
      surfaceType: materialName,
      finish,
      resolution,
      context,
      detail: part.detail,
      componentType: part.componentType,
    };
  }

  /**
   * Determine context (exterior/interior/etc)
   */
  determineContext(part, environmentContext) {
    if (environmentContext.location === 'indoor') {
      return 'interior';
    }

    // Check if part is at ground level
    if (part.position && part.position.y <= 0) {
      return 'ground-level';
    }

    return 'exterior';
  }

  /**
   * Determine appropriate resolution based on part importance
   */
  determineResolution(part, specifications) {
    // High detail level or close-up views need higher resolution
    if (specifications.requirements?.detailLevel === 'very_high') {
      return '4K';
    }

    // Main structures get medium resolution
    if (part.componentType && part.componentType.includes('building_structure')) {
      return '2K';
    }

    // Secondary elements can use lower resolution
    if (part.detail && (part.detail.includes('secondary') || part.detail.includes('tertiary'))) {
      return '1K';
    }

    return '2K'; // Default
  }

  /**
   * Get PBR material from library
   */
  async getPBRMaterial(materialSpec) {
    const { surfaceType, finish, resolution } = materialSpec;

    // Get material from library
    const material = materialLibraryService.getMaterialForSurface(
      surfaceType,
      finish,
      resolution
    );

    if (!material) {
      console.warn(`No material found for ${surfaceType}, using fallback`);
      return materialLibraryService.getFallbackMaterial(surfaceType);
    }

    return material;
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      materialLibrary: materialLibraryService.getStats(),
      polyhaven: polyhavenService.getStatus(),
    };
  }
}

module.exports = new MaterialMappingService();
