/**
 * Environment Materials - Material definitions for environment assets
 * Provides realistic materials for terrain, buildings, vegetation, and weather effects
 * Enhanced with PBR texture loading support
 */

import * as THREE from 'three';

export class EnvironmentMaterials {
  constructor() {
    this.materials = new Map();
    this.textureCache = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.loadingQueue = [];
    this.initializeMaterials();
  }

  initializeMaterials() {
    // Terrain Materials
    this.registerMaterial('rock', this.createRockMaterial());
    this.registerMaterial('sand', this.createSandMaterial());
    this.registerMaterial('dirt', this.createDirtMaterial());
    this.registerMaterial('grass', this.createGrassMaterial());
    this.registerMaterial('snow', this.createSnowMaterial());
    this.registerMaterial('ice', this.createIceMaterial());

    // Water Materials
    this.registerMaterial('water', this.createWaterMaterial());
    this.registerMaterial('ocean', this.createOceanMaterial());

    // Building Materials
    this.registerMaterial('concrete', this.createConcreteMaterial());
    this.registerMaterial('brick', this.createBrickMaterial());
    this.registerMaterial('glass', this.createGlassMaterial());
    this.registerMaterial('metal', this.createMetalMaterial());
    this.registerMaterial('asphalt', this.createAsphaltMaterial());

    // Organic Materials
    this.registerMaterial('wood', this.createWoodMaterial());
    this.registerMaterial('bark', this.createBarkMaterial());
    this.registerMaterial('leaves', this.createLeavesMaterial());
    this.registerMaterial('foliage', this.createFoliageMaterial());

    // Atmospheric Materials
    this.registerMaterial('sky', this.createSkyMaterial());
    this.registerMaterial('cloud', this.createCloudMaterial());
  }

  registerMaterial(name, material) {
    this.materials.set(name, material);
  }

  getMaterial(name) {
    return this.materials.get(name) || this.createDefaultMaterial();
  }

  createDefaultMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.7,
      metalness: 0.1
    });
  }

  // Terrain Materials
  createRockMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x6b7280,
      roughness: 0.9,
      metalness: 0.1,
      name: 'rock'
    });
  }

  createSandMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xdcc896,
      roughness: 0.95,
      metalness: 0.0,
      name: 'sand'
    });
  }

  createDirtMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      roughness: 0.95,
      metalness: 0.0,
      name: 'dirt'
    });
  }

  createGrassMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x4a7c3e,
      roughness: 0.9,
      metalness: 0.0,
      name: 'grass'
    });
  }

  createSnowMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.6,
      metalness: 0.0,
      name: 'snow'
    });
  }

  createIceMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xc8f0ff,
      roughness: 0.1,
      metalness: 0.0,
      transparent: true,
      opacity: 0.8,
      transmission: 0.5,
      name: 'ice'
    });
  }

  // Water Materials
  createWaterMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x1e90ff,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.7,
      transmission: 0.3,
      name: 'water'
    });
  }

  createOceanMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x006994,
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
      transmission: 0.2,
      name: 'ocean'
    });
  }

  // Building Materials
  createConcreteMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xa0a0a0,
      roughness: 0.8,
      metalness: 0.1,
      name: 'concrete'
    });
  }

  createBrickMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.85,
      metalness: 0.0,
      name: 'brick'
    });
  }

  createGlassMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 0.3,
      transmission: 0.9,
      name: 'glass'
    });
  }

  createMetalMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xc0c0c0,
      roughness: 0.3,
      metalness: 0.9,
      name: 'metal'
    });
  }

  createAsphaltMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x2c2c2c,
      roughness: 0.9,
      metalness: 0.0,
      name: 'asphalt'
    });
  }

  // Organic Materials
  createWoodMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x8b6f47,
      roughness: 0.8,
      metalness: 0.0,
      name: 'wood'
    });
  }

  createBarkMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.95,
      metalness: 0.0,
      name: 'bark'
    });
  }

  createLeavesMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x2d5016,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
      name: 'leaves'
    });
  }

  createFoliageMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x3a7c2e,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
      name: 'foliage'
    });
  }

  // Atmospheric Materials
  createSkyMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0x87ceeb,
      side: THREE.BackSide,
      name: 'sky'
    });
  }

  createCloudMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      name: 'cloud'
    });
  }

  // Utility methods
  cloneMaterial(materialName) {
    const material = this.getMaterial(materialName);
    return material.clone();
  }

  updateMaterialColor(materialName, color) {
    const material = this.getMaterial(materialName);
    if (material) {
      material.color.set(color);
    }
  }

  getAllMaterials() {
    return Array.from(this.materials.entries()).map(([name, material]) => ({
      name,
      material
    }));
  }

  // ============================================================
  // PBR Material System
  // ============================================================

  /**
   * Create PBR material from material specification
   */
  async createPBRMaterial(materialSpec) {
    if (!materialSpec) {
      console.warn('No material spec provided, using default');
      return this.createDefaultMaterial();
    }

    console.log('🎨 Creating PBR material:', materialSpec.type);

    const { type, finish, maps, properties } = materialSpec;

    // Start with base material
    const material = new THREE.MeshStandardMaterial({
      name: `pbr_${type}_${finish}`,
      roughness: properties?.roughness ?? 0.7,
      metalness: properties?.metalness ?? 0.1,
    });

    // Load textures if available
    if (maps) {
      try {
        const loadedMaps = await this.loadTextureSet(maps);
        this.applyPBRMaps(material, loadedMaps, properties);
      } catch (error) {
        console.warn('Failed to load textures, using fallback:', error);
        // Use fallback color for this material type
        const fallbackMaterial = this.getMaterial(type);
        if (fallbackMaterial) {
          material.color.copy(fallbackMaterial.color);
        }
      }
    } else {
      // No texture maps, use flat color
      const fallbackMaterial = this.getMaterial(type);
      if (fallbackMaterial) {
        material.color.copy(fallbackMaterial.color);
      }
    }

    return material;
  }

  /**
   * Load a single texture with caching
   */
  async loadTexture(url, options = {}) {
    if (!url) return null;

    // Check cache first
    if (this.textureCache.has(url)) {
      console.log('📦 Using cached texture:', url);
      return this.textureCache.get(url);
    }

    console.log('📥 Loading texture:', url);

    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          // Apply options
          if (options.wrapS) texture.wrapS = options.wrapS;
          if (options.wrapT) texture.wrapT = options.wrapT;
          if (options.repeat) {
            texture.repeat.set(options.repeat.x || 1, options.repeat.y || 1);
          }
          
          // Enable anisotropic filtering for better quality
          texture.anisotropy = 16;
          
          // Cache the texture
          this.textureCache.set(url, texture);
          console.log('✅ Texture loaded:', url);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.error('❌ Failed to load texture:', url, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Load all PBR texture maps concurrently
   */
  async loadTextureSet(urls) {
    console.log('📥 Loading PBR texture set...');
    
    const mapPromises = {};
    const wrapSettings = {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      repeat: { x: 1, y: 1 },
    };

    // Load each map type
    if (urls.albedo) {
      mapPromises.albedo = this.loadTexture(urls.albedo, wrapSettings);
    }
    if (urls.normal) {
      mapPromises.normal = this.loadTexture(urls.normal, wrapSettings);
    }
    if (urls.roughness) {
      mapPromises.roughness = this.loadTexture(urls.roughness, wrapSettings);
    }
    if (urls.metalness) {
      mapPromises.metalness = this.loadTexture(urls.metalness, wrapSettings);
    }
    if (urls.ao) {
      mapPromises.ao = this.loadTexture(urls.ao, wrapSettings);
    }
    if (urls.displacement) {
      mapPromises.displacement = this.loadTexture(urls.displacement, wrapSettings);
    }

    // Wait for all textures to load
    const loadedMaps = {};
    for (const [key, promise] of Object.entries(mapPromises)) {
      try {
        loadedMaps[key] = await promise;
      } catch (error) {
        console.warn(`Failed to load ${key} map, continuing without it`);
        loadedMaps[key] = null;
      }
    }

    console.log('✅ Texture set loaded:', Object.keys(loadedMaps));
    return loadedMaps;
  }

  /**
   * Apply PBR texture maps to material
   */
  applyPBRMaps(material, maps, properties = {}) {
    console.log('🎨 Applying PBR maps to material');

    // Albedo (color) map
    if (maps.albedo) {
      material.map = maps.albedo;
      material.map.encoding = THREE.sRGBEncoding;
    }

    // Normal map
    if (maps.normal) {
      material.normalMap = maps.normal;
      material.normalScale = new THREE.Vector2(
        properties.normalScale || 1.0,
        properties.normalScale || 1.0
      );
    }

    // Roughness map
    if (maps.roughness) {
      material.roughnessMap = maps.roughness;
    }

    // Metalness map
    if (maps.metalness) {
      material.metalnessMap = maps.metalness;
    }

    // Ambient Occlusion map
    if (maps.ao) {
      material.aoMap = maps.ao;
      material.aoMapIntensity = properties.aoIntensity || 1.0;
    }

    // Displacement map
    if (maps.displacement) {
      material.displacementMap = maps.displacement;
      material.displacementScale = properties.displacementScale || 0.1;
    }

    // Enable/disable features based on properties
    if (properties.transmission !== undefined) {
      material.transmission = properties.transmission;
    }
    if (properties.opacity !== undefined) {
      material.opacity = properties.opacity;
      material.transparent = properties.opacity < 1.0;
    }

    material.needsUpdate = true;
  }

  /**
   * Dispose material and its textures
   */
  disposeMaterial(materialId) {
    const material = this.materials.get(materialId);
    if (!material) return;

    // Dispose textures
    if (material.map) material.map.dispose();
    if (material.normalMap) material.normalMap.dispose();
    if (material.roughnessMap) material.roughnessMap.dispose();
    if (material.metalnessMap) material.metalnessMap.dispose();
    if (material.aoMap) material.aoMap.dispose();
    if (material.displacementMap) material.displacementMap.dispose();

    // Dispose material
    material.dispose();

    // Remove from materials map
    this.materials.delete(materialId);

    console.log('🗑️  Disposed material:', materialId);
  }

  /**
   * Clear texture cache to free memory
   */
  clearTextureCache() {
    console.log('🗑️  Clearing texture cache');
    
    this.textureCache.forEach((texture, url) => {
      texture.dispose();
    });
    
    this.textureCache.clear();
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage() {
    let totalMemory = 0;
    
    this.textureCache.forEach((texture) => {
      if (texture.image) {
        const width = texture.image.width || 1024;
        const height = texture.image.height || 1024;
        // Estimate: 4 bytes per pixel (RGBA) + mipmaps (~33% more)
        const textureSize = width * height * 4 * 1.33;
        totalMemory += textureSize;
      }
    });

    return {
      bytes: totalMemory,
      megabytes: (totalMemory / (1024 * 1024)).toFixed(2),
      textureCount: this.textureCache.size,
    };
  }
}

export default EnvironmentMaterials;
