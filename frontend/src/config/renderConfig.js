/**
 * Render Configuration
 * Settings for texture quality, memory management, and rendering performance
 */

export const renderConfig = {
  // Texture quality settings based on distance
  textureLOD: {
    levels: [
      { distance: 10, resolution: '4K' },   // Close up
      { distance: 50, resolution: '2K' },   // Medium distance
      { distance: 100, resolution: '1K' },  // Far distance
      { distance: Infinity, resolution: '512' }, // Very far
    ],
    defaultResolution: '2K',
  },

  // Memory management
  memory: {
    maxTextureMemory: 500 * 1024 * 1024, // 500MB limit
    textureTimeout: 5 * 60 * 1000, // 5 minutes before cleanup
    maxCachedTextures: 100,
    lowMemoryThreshold: 400 * 1024 * 1024, // 400MB triggers cleanup
  },

  // Loading priorities
  loadingPriority: {
    maps: ['albedo', 'normal', 'roughness', 'metalness', 'ao', 'displacement'],
    essential: ['albedo', 'normal'], // Must load these first
    optional: ['displacement'], // Can skip if low memory
  },

  // Progressive loading
  progressive: {
    enabled: true,
    placeholderColor: 0x808080, // Gray placeholder
    lowResFirst: true, // Load low-res version first
    fadeInDuration: 300, // ms
  },

  // HDRI settings
  hdri: {
    preferredResolution: '2k',
    fallbackResolution: '1k',
    maxResolution: '4k',
    intensity: 1.0,
    exposure: 1.0,
  },

  // Render quality presets
  qualityPresets: {
    low: {
      textureResolution: '1K',
      hdriResolution: '1k',
      shadowQuality: 'low',
      antialiasing: false,
      maxTextureMemory: 200 * 1024 * 1024,
    },
    medium: {
      textureResolution: '2K',
      hdriResolution: '2k',
      shadowQuality: 'medium',
      antialiasing: true,
      maxTextureMemory: 500 * 1024 * 1024,
    },
    high: {
      textureResolution: '4K',
      hdriResolution: '2k',
      shadowQuality: 'high',
      antialiasing: true,
      maxTextureMemory: 1000 * 1024 * 1024,
    },
    ultra: {
      textureResolution: '4K',
      hdriResolution: '4k',
      shadowQuality: 'ultra',
      antialiasing: true,
      maxTextureMemory: 2000 * 1024 * 1024,
    },
  },

  // Current quality setting (can be changed at runtime)
  currentQuality: 'medium',

  // Performance monitoring
  performance: {
    targetFPS: 60,
    minFPS: 30,
    autoAdjustQuality: true,
    measureInterval: 1000, // ms
  },

  // Texture format preferences
  textureFormats: {
    preferWebP: true,
    preferKTX2: false, // Compressed texture format
    fallbackToJPEG: true,
  },

  // Caching strategy
  cache: {
    enabled: true,
    storageType: 'memory', // 'memory' or 'indexedDB'
    persistAcrossSessions: false,
  },
};

/**
 * Get quality preset by name
 */
export function getQualityPreset(presetName) {
  return renderConfig.qualityPresets[presetName] || renderConfig.qualityPresets.medium;
}

/**
 * Set current quality level
 */
export function setQuality(presetName) {
  if (renderConfig.qualityPresets[presetName]) {
    renderConfig.currentQuality = presetName;
    console.log(`🎨 Render quality set to: ${presetName}`);
  }
}

/**
 * Get texture resolution for given distance
 */
export function getResolutionForDistance(distance) {
  const levels = renderConfig.textureLOD.levels;
  for (const level of levels) {
    if (distance < level.distance) {
      return level.resolution;
    }
  }
  return renderConfig.textureLOD.defaultResolution;
}

/**
 * Estimate texture memory usage
 */
export function estimateTextureMemory(width, height, format = 'RGBA') {
  const bytesPerPixel = format === 'RGBA' ? 4 : format === 'RGB' ? 3 : 1;
  const baseSize = width * height * bytesPerPixel;
  
  // Account for mipmaps (adds ~33% more memory)
  const withMipmaps = baseSize * 1.33;
  
  return Math.ceil(withMipmaps);
}

/**
 * Parse resolution string to dimensions
 */
export function parseResolution(resolutionStr) {
  const resMap = {
    '4K': { width: 4096, height: 4096 },
    '2K': { width: 2048, height: 2048 },
    '1K': { width: 1024, height: 1024 },
    '512': { width: 512, height: 512 },
  };
  
  return resMap[resolutionStr] || resMap['2K'];
}

export default renderConfig;
