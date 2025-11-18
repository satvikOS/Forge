/**
 * Polyhaven Service
 * API client for fetching HDRIs and textures from Polyhaven
 */

const fs = require('fs');
const path = require('path');
const materialConfig = require('../config/materialConfig');

class PolyhavenService {
  constructor() {
    this.baseUrl = 'https://api.polyhaven.com';
    this.cache = new Map();
    this.swaggerSpec = null;
    this.isConfigured = false;
  }

  /**
   * Initialize service and load Swagger spec if available
   */
  async initialize() {
    const swaggerPath = path.join(__dirname, '../data/polyhaven-swagger.json');
    
    if (fs.existsSync(swaggerPath)) {
      try {
        this.swaggerSpec = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
        this.isConfigured = true;
        console.log('✅ Polyhaven service initialized with Swagger spec');
      } catch (error) {
        console.warn('Failed to load Polyhaven Swagger spec:', error.message);
        this.isConfigured = false;
      }
    } else {
      console.warn('⚠️  Polyhaven Swagger spec not found at:', swaggerPath);
      console.warn('   Will use fallback HDRI configuration');
      this.isConfigured = false;
    }
  }

  /**
   * Get list of available HDRIs with optional filters
   */
  async getHDRIList(category = null, filters = {}) {
    // Check cache first
    const cacheKey = `hdri_list_${category}_${JSON.stringify(filters)}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
        return cached.data;
      }
    }

    try {
      // In production, this would make actual API calls
      // For now, return mock data that matches expected structure
      const mockHdris = this.getMockHDRIList(category, filters);
      
      // Cache result
      this.cache.set(cacheKey, {
        data: mockHdris,
        timestamp: Date.now(),
      });

      return mockHdris;
    } catch (error) {
      console.error('Error fetching HDRI list:', error);
      return [];
    }
  }

  /**
   * Smart HDRI selection based on environment context
   */
  async getHDRIForEnvironment(location = 'urban', timeOfDay = 'noon', weather = 'clear') {
    console.log(`🌅 Selecting HDRI for: ${location}, ${timeOfDay}, ${weather}`);

    // Get HDRIs matching the location category
    const categoryMatch = this.matchLocationToCategory(location);
    const hdriList = await this.getHDRIList(categoryMatch);

    if (hdriList.length === 0) {
      return this.getFallbackHDRI(location, timeOfDay);
    }

    // Filter by time of day
    const timeOfDayVariations = materialConfig.hdriTimeOfDay[timeOfDay] || ['day'];
    const timeMatches = hdriList.filter(hdri => 
      timeOfDayVariations.some(tod => 
        hdri.name.toLowerCase().includes(tod) ||
        hdri.tags.some(tag => tag.toLowerCase().includes(tod))
      )
    );

    // Use best match or first available
    const selectedHdri = timeMatches.length > 0 ? timeMatches[0] : hdriList[0];

    // Adjust intensity based on time of day and weather
    const intensity = this.calculateLightIntensity(timeOfDay, weather);
    const blur = weather === 'foggy' ? 0.3 : weather === 'cloudy' ? 0.1 : 0.0;

    return {
      url: selectedHdri.url,
      name: selectedHdri.name,
      intensity,
      blur,
      resolution: selectedHdri.resolution || '2k',
    };
  }

  /**
   * Match location to HDRI category
   */
  matchLocationToCategory(location) {
    const lowerLocation = location.toLowerCase();
    
    for (const [category, keywords] of Object.entries(materialConfig.hdriCategories)) {
      if (keywords.some(kw => lowerLocation.includes(kw))) {
        return category;
      }
    }
    
    return 'urban'; // Default
  }

  /**
   * Calculate light intensity based on time of day and weather
   */
  calculateLightIntensity(timeOfDay, weather) {
    let baseIntensity = 1.0;

    // Adjust for time of day
    switch (timeOfDay) {
      case 'sunrise':
      case 'sunset':
        baseIntensity = 0.7;
        break;
      case 'morning':
      case 'afternoon':
        baseIntensity = 1.2;
        break;
      case 'noon':
        baseIntensity = 1.5;
        break;
      case 'dusk':
        baseIntensity = 0.4;
        break;
      case 'night':
        baseIntensity = 0.2;
        break;
      default:
        baseIntensity = 1.0;
    }

    // Adjust for weather
    switch (weather) {
      case 'cloudy':
      case 'overcast':
        baseIntensity *= 0.7;
        break;
      case 'rainy':
        baseIntensity *= 0.5;
        break;
      case 'foggy':
        baseIntensity *= 0.6;
        break;
      case 'snowy':
        baseIntensity *= 0.8;
        break;
      default:
        // clear weather - no adjustment
        break;
    }

    return baseIntensity;
  }

  /**
   * Get texture asset from Polyhaven
   */
  async getTextureAsset(assetId, resolution = '2k') {
    // In production, this would fetch from the actual API
    // For now, return a structured response
    return {
      id: assetId,
      resolution,
      url: `https://dl.polyhaven.org/file/ph-assets/Textures/${resolution}/${assetId}_${resolution}.jpg`,
      available: true,
    };
  }

  /**
   * Get fallback HDRI configuration
   */
  getFallbackHDRI(location, timeOfDay) {
    // Predefined fallback HDRIs
    const fallbacks = {
      urban: {
        url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/urban_alley_01_2k.hdr',
        name: 'Urban Alley',
        resolution: '2k',
      },
      nature: {
        url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/forest_slope_2k.hdr',
        name: 'Forest Slope',
        resolution: '2k',
      },
      indoor: {
        url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_03_2k.hdr',
        name: 'Studio Small',
        resolution: '2k',
      },
      coastal: {
        url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/beach_parking_2k.hdr',
        name: 'Beach Parking',
        resolution: '2k',
      },
      default: {
        url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/evening_road_01_2k.hdr',
        name: 'Evening Road',
        resolution: '2k',
      },
    };

    const categoryMatch = this.matchLocationToCategory(location);
    const hdri = fallbacks[categoryMatch] || fallbacks.default;
    
    const intensity = this.calculateLightIntensity(timeOfDay, 'clear');

    return {
      ...hdri,
      intensity,
      blur: 0.0,
      isFallback: true,
    };
  }

  /**
   * Mock HDRI list for development/fallback
   */
  getMockHDRIList(category = null, filters = {}) {
    const mockHdris = [
      // Urban
      { name: 'urban_alley_01', category: 'urban', tags: ['city', 'day'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/urban_alley_01_2k.hdr', resolution: '2k' },
      { name: 'city_street_noon', category: 'urban', tags: ['city', 'noon', 'day'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/city_street_noon_2k.hdr', resolution: '2k' },
      { name: 'downtown_sunset', category: 'urban', tags: ['city', 'sunset'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/downtown_sunset_2k.hdr', resolution: '2k' },
      
      // Nature
      { name: 'forest_slope', category: 'nature', tags: ['forest', 'day'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/forest_slope_2k.hdr', resolution: '2k' },
      { name: 'park_sunrise', category: 'nature', tags: ['park', 'sunrise'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/park_sunrise_2k.hdr', resolution: '2k' },
      { name: 'mountain_noon', category: 'nature', tags: ['mountain', 'noon'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/mountain_noon_2k.hdr', resolution: '2k' },
      
      // Indoor
      { name: 'studio_small_03', category: 'indoor', tags: ['studio', 'interior'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_03_2k.hdr', resolution: '2k' },
      { name: 'warehouse_interior', category: 'indoor', tags: ['warehouse', 'industrial'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/warehouse_interior_2k.hdr', resolution: '2k' },
      
      // Coastal
      { name: 'beach_parking', category: 'coastal', tags: ['beach', 'day'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/beach_parking_2k.hdr', resolution: '2k' },
      { name: 'ocean_sunset', category: 'coastal', tags: ['ocean', 'sunset'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/ocean_sunset_2k.hdr', resolution: '2k' },
      
      // Sky
      { name: 'evening_road_01', category: 'sky', tags: ['evening', 'sunset'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/evening_road_01_2k.hdr', resolution: '2k' },
      { name: 'blue_sky_day', category: 'sky', tags: ['sky', 'day', 'clear'], url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/blue_sky_day_2k.hdr', resolution: '2k' },
    ];

    // Filter by category if specified
    let filtered = category ? mockHdris.filter(hdri => hdri.category === category) : mockHdris;

    // Apply additional filters
    if (filters.tags) {
      const filterTags = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
      filtered = filtered.filter(hdri => 
        filterTags.some(tag => hdri.tags.includes(tag))
      );
    }

    return filtered;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      configured: this.isConfigured,
      cacheSize: this.cache.size,
      baseUrl: this.baseUrl,
    };
  }
}

module.exports = new PolyhavenService();
