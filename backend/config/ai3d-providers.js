/**
 * AI 3D Generation Providers Configuration
 * Defines endpoints, costs, and free tier limits for all AI 3D generation services
 */

module.exports = {
  // Tripo AI - Image-to-3D and Text-to-3D
  tripo: {
    name: 'Tripo AI',
    baseURL: 'https://api.tripo3d.ai/v1',
    endpoints: {
      textTo3D: '/text-to-3d',
      imageTo3D: '/image-to-3d',
      multiImageTo3D: '/multi-image-to-3d',
      status: '/task/status',
    },
    costs: {
      preview: 10,      // credits per preview generation
      standard: 15,     // credits per standard generation
      high: 20,         // credits per high quality generation
    },
    freeTier: {
      monthly: parseInt(process.env.TRIPO_FREE_CREDITS_MONTHLY) || 300,
      resetDay: 1, // First day of month
    },
    formats: ['glb', 'fbx', 'obj'],
    timeout: 60000, // 60 seconds
  },

  // Meshy AI - Text-to-3D and Image-to-3D with PBR textures
  meshy: {
    name: 'Meshy AI',
    baseURL: 'https://api.meshy.ai/v1',
    endpoints: {
      textTo3D: '/text-to-3d',
      imageTo3D: '/image-to-3d',
      status: '/task/status',
    },
    costs: {
      standard: 20,     // credits per standard generation
      high: 30,         // credits per high quality generation with PBR
    },
    freeTier: {
      monthly: parseInt(process.env.MESHY_FREE_CREDITS_MONTHLY) || 200,
      resetDay: 1,
    },
    formats: ['glb'],
    timeout: 60000,
  },

  // Vertex AI Imagen - Image generation for concept art and textures
  vertexImagen: {
    name: 'Vertex AI Imagen',
    model: process.env.VERTEX_IMAGEN_MODEL || 'imagegeneration@006',
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    endpoints: {
      predict: '/predict',
    },
    costs: {
      perImage: parseFloat(process.env.VERTEX_IMAGEN_COST) || 0.002, // USD per image
    },
    freeTier: {
      monthly: parseInt(process.env.VERTEX_IMAGEN_FREE_MONTHLY) || 1000,
      resetDay: 1,
    },
    formats: ['png', 'jpeg'],
    timeout: 30000,
  },

  // Generation modes with cost profiles
  generationModes: {
    ultra_cheap: {
      name: 'Ultra Cheap (FREE)',
      description: 'Preview quality using free tier only',
      pipeline: ['vertexImagen', 'tripo'],
      estimatedCost: 0.002,
      estimatedTime: 30, // seconds
      quality: 'preview',
      useFreeTierOnly: true,
    },
    balanced: {
      name: 'Balanced',
      description: 'Good quality with multi-view generation',
      pipeline: ['vertexImagen', 'tripo', 'meshy'],
      estimatedCost: 0.20,
      estimatedTime: 45,
      quality: 'standard',
      useFreeTierOnly: false,
    },
    high_quality: {
      name: 'High Quality',
      description: 'AAA-grade with PBR materials',
      pipeline: ['meshy'],
      estimatedCost: 0.40,
      estimatedTime: 60,
      quality: 'high',
      useFreeTierOnly: false,
    },
  },

  // Budget configuration
  budget: {
    maxMonthlyUSD: parseFloat(process.env.MAX_MONTHLY_BUDGET_USD) || 5,
    alertAtPercent: parseInt(process.env.ALERT_AT_BUDGET_PERCENT) || 75,
    stopAtPercent: parseInt(process.env.STOP_GENERATION_AT_BUDGET_PERCENT) || 95,
  },

  // Cache configuration
  cache: {
    enabled: process.env.ENABLE_MODEL_CACHE !== 'false',
    ttlDays: parseInt(process.env.MODEL_CACHE_TTL_DAYS) || 30,
    similarityThreshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD) || 0.85,
    maxSizeMB: 1000, // 1GB cache limit
  },

  // Feature flags
  features: {
    ai3DGeneration: process.env.ENABLE_AI_3D_GENERATION !== 'false',
    imageTo3D: process.env.ENABLE_IMAGE_TO_3D_PIPELINE !== 'false',
    useFreeTierFirst: process.env.USE_FREE_TIER_FIRST !== 'false',
    autoUpgrade: false, // Don't auto-upgrade quality
  },

  // Default generation mode
  defaultMode: process.env.DEFAULT_GENERATION_MODE || 'ultra_cheap',
};
