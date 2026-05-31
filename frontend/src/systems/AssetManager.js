/**
 * Asset Manager - Central registry for all environment assets
 * Handles asset loading, caching, and metadata management
 */

export class Asset {
  constructor(id, name, category, subcategory, metadata = {}) {
    this.id = id;
    this.name = name;
    this.category = category; // 'abiotic', 'biotic', 'built'
    this.subcategory = subcategory;
    this.metadata = {
      tags: [],
      description: '',
      procedural: true,
      modelUrl: null,
      thumbnailUrl: null,
      scale: { x: 1, y: 1, z: 1 },
      defaultMaterial: 'standard',
      ...metadata
    };
    this.generator = null;
    this.loaded = false;
  }

  setGenerator(generator) {
    this.generator = generator;
    return this;
  }

  async generate(options = {}) {
    if (!this.generator) {
      throw new Error(`No generator set for asset ${this.id}`);
    }
    return this.generator(options);
  }
}

export class AssetManager {
  constructor() {
    this.assets = new Map();
    this.categories = new Map();
    this.cache = new Map();
    this.loadedModels = new Map();
    
    this.initializeCategories();
  }

  initializeCategories() {
    // Natural Environment (Abiotic - Non-Living)
    this.categories.set('abiotic', {
      name: 'Natural Environment (Non-Living)',
      subcategories: ['landforms', 'water', 'atmospheric'],
      icon: '🌍'
    });

    // Natural Environment (Biotic - Living)
    this.categories.set('biotic', {
      name: 'Natural Environment (Living)',
      subcategories: ['flora', 'fauna'],
      icon: '🌱'
    });

    // Man-Made Environment (Built Environment)
    this.categories.set('built', {
      name: 'Built Environment',
      subcategories: ['buildings', 'roads', 'infrastructure'],
      icon: '🏙️'
    });
  }

  registerAsset(asset) {
    this.assets.set(asset.id, asset);
    return asset;
  }

  getAsset(assetId) {
    return this.assets.get(assetId);
  }

  getAssetsByCategory(category) {
    return Array.from(this.assets.values()).filter(
      asset => asset.category === category
    );
  }

  getAssetsBySubcategory(category, subcategory) {
    return Array.from(this.assets.values()).filter(
      asset => asset.category === category && asset.subcategory === subcategory
    );
  }

  searchAssets(query) {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.assets.values()).filter(asset => {
      return (
        asset.name.toLowerCase().includes(lowerQuery) ||
        asset.metadata.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
        asset.metadata.description.toLowerCase().includes(lowerQuery)
      );
    });
  }

  filterAssetsByTags(tags) {
    return Array.from(this.assets.values()).filter(asset => {
      return tags.every(tag => 
        asset.metadata.tags.includes(tag)
      );
    });
  }

  async loadModel(url) {
    if (this.loadedModels.has(url)) {
      return this.loadedModels.get(url);
    }

    // Placeholder for actual model loading
    // In a real implementation, this would use GLTFLoader, etc.
    const model = { url, loaded: true };
    this.loadedModels.set(url, model);
    return model;
  }

  getCachedAsset(assetId, options) {
    const cacheKey = `${assetId}_${JSON.stringify(options)}`;
    return this.cache.get(cacheKey);
  }

  setCachedAsset(assetId, options, geometry) {
    const cacheKey = `${assetId}_${JSON.stringify(options)}`;
    this.cache.set(cacheKey, geometry);
  }

  clearCache() {
    this.cache.clear();
  }

  getCategories() {
    return Array.from(this.categories.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
  }

  getSubcategories(category) {
    const cat = this.categories.get(category);
    return cat ? cat.subcategories : [];
  }

  getAllAssets() {
    return Array.from(this.assets.values());
  }
}

export default AssetManager;
