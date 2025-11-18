/**
 * Material Configuration
 * Defines material type mappings, quality settings, and fallbacks
 */

module.exports = {
  // Material type mappings for common surface types
  materialTypes: {
    // Building materials
    concrete: ['concrete', 'cement', 'plaster'],
    brick: ['brick', 'masonry', 'clay_brick'],
    glass: ['glass', 'window', 'transparent'],
    metal: ['metal', 'steel', 'aluminum', 'iron', 'copper'],
    wood: ['wood', 'timber', 'lumber', 'oak', 'pine'],
    stone: ['stone', 'granite', 'marble', 'limestone', 'sandstone'],
    asphalt: ['asphalt', 'pavement', 'road_surface'],
    
    // Terrain materials
    grass: ['grass', 'lawn', 'turf'],
    dirt: ['dirt', 'soil', 'earth', 'mud'],
    sand: ['sand', 'beach', 'desert'],
    rock: ['rock', 'boulder', 'cliff'],
    gravel: ['gravel', 'pebbles', 'stones'],
    
    // Organic materials
    bark: ['bark', 'tree_bark', 'trunk'],
    foliage: ['foliage', 'leaves', 'vegetation'],
    
    // Special materials
    water: ['water', 'ocean', 'lake', 'river'],
    snow: ['snow', 'ice'],
  },

  // Finish quality mappings
  finishTypes: {
    polished: ['polished', 'smooth', 'glossy', 'shiny', 'reflective'],
    rough: ['rough', 'coarse', 'textured', 'unfinished'],
    weathered: ['weathered', 'aged', 'worn', 'old', 'distressed'],
    new: ['new', 'clean', 'pristine', 'fresh'],
  },

  // Default resolution preferences
  resolutions: {
    high: '4K',
    medium: '2K',
    low: '1K',
  },

  // Default quality settings
  defaultQuality: {
    resolution: '2K',
    finish: 'rough',
    detailLevel: 'high',
  },

  // AmbientCG CSV column mappings
  csvColumns: {
    id: 'assetId',
    name: 'name',
    type: 'category',
    tags: 'tags',
    resolution: 'downloadAttribute',
    downloadUrl: 'downloadLink',
    previewUrl: 'previewImage',
  },

  // Fallback materials for each type
  fallbackMaterials: {
    concrete: {
      type: 'concrete',
      finish: 'rough',
      properties: {
        roughness: 0.9,
        metalness: 0.1,
        normalScale: 1.0,
      },
      maps: null, // Will use flat color if no textures available
    },
    glass: {
      type: 'glass',
      finish: 'polished',
      properties: {
        roughness: 0.05,
        metalness: 0.0,
        normalScale: 0.5,
        transmission: 0.9,
        opacity: 0.3,
      },
      maps: null,
    },
    metal: {
      type: 'metal',
      finish: 'polished',
      properties: {
        roughness: 0.3,
        metalness: 0.9,
        normalScale: 1.0,
      },
      maps: null,
    },
    wood: {
      type: 'wood',
      finish: 'rough',
      properties: {
        roughness: 0.8,
        metalness: 0.0,
        normalScale: 1.0,
      },
      maps: null,
    },
    stone: {
      type: 'stone',
      finish: 'rough',
      properties: {
        roughness: 0.95,
        metalness: 0.1,
        normalScale: 1.0,
      },
      maps: null,
    },
    brick: {
      type: 'brick',
      finish: 'rough',
      properties: {
        roughness: 0.85,
        metalness: 0.0,
        normalScale: 1.0,
      },
      maps: null,
    },
    asphalt: {
      type: 'asphalt',
      finish: 'rough',
      properties: {
        roughness: 0.9,
        metalness: 0.0,
        normalScale: 1.0,
      },
      maps: null,
    },
    grass: {
      type: 'grass',
      finish: 'rough',
      properties: {
        roughness: 0.9,
        metalness: 0.0,
        normalScale: 1.0,
      },
      maps: null,
    },
    default: {
      type: 'default',
      finish: 'rough',
      properties: {
        roughness: 0.7,
        metalness: 0.3,
        normalScale: 1.0,
      },
      maps: null,
    },
  },

  // Polyhaven HDRI categories
  hdriCategories: {
    urban: ['city', 'street', 'alley', 'building', 'downtown'],
    nature: ['forest', 'park', 'field', 'mountain', 'countryside'],
    indoor: ['interior', 'room', 'studio', 'warehouse'],
    coastal: ['beach', 'ocean', 'harbor', 'pier', 'seaside'],
    industrial: ['factory', 'construction', 'industrial'],
    sky: ['sky', 'sunset', 'sunrise', 'clouds', 'night'],
  },

  // HDRI selection by time of day
  hdriTimeOfDay: {
    sunrise: ['sunrise', 'dawn', 'early_morning'],
    morning: ['morning', 'day'],
    noon: ['noon', 'midday', 'day'],
    afternoon: ['afternoon', 'day'],
    sunset: ['sunset', 'dusk', 'evening'],
    dusk: ['dusk', 'twilight'],
    night: ['night', 'moonlight'],
  },

  // Performance limits
  performance: {
    maxTextureMemory: 500 * 1024 * 1024, // 500MB
    textureTimeout: 5 * 60 * 1000, // 5 minutes
    cacheSize: 100, // Max cached materials
    loadingPriority: ['albedo', 'normal', 'roughness', 'metalness', 'ao', 'displacement'],
  },
};
