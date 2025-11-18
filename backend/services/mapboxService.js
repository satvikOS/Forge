const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Mapbox API Service
 * Provides satellite imagery, terrain data, building footprints, and vector tiles
 * Documentation: https://docs.mapbox.com/api/
 */
class MapboxService {
  constructor() {
    this.accessToken = process.env.MAPBOX_ACCESS_TOKEN;
    this.enabled = process.env.MAPBOX_ENABLED === 'true';
    this.baseUrl = 'https://api.mapbox.com';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
    this.maxRetries = 3;
  }

  /**
   * Check if Mapbox is enabled and configured
   */
  isEnabled() {
    return this.enabled && this.accessToken;
  }

  /**
   * Get satellite imagery for a location
   */
  async getSatelliteImagery(longitude, latitude, zoom = 15, width = 1280, height = 1280) {
    if (!this.isEnabled()) {
      console.log('Mapbox is not enabled, skipping satellite imagery');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapbox_satellite', { longitude, latitude, zoom });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const url = `${this.baseUrl}/styles/v1/mapbox/satellite-v9/static/${longitude},${latitude},${zoom}/${width}x${height}`;
      
      const response = await axios.get(url, {
        params: {
          access_token: this.accessToken,
        },
        timeout: this.timeout,
        responseType: 'arraybuffer',
      });

      const data = {
        imageBuffer: response.data,
        contentType: response.headers['content-type'],
        location: { longitude, latitude },
        zoom,
        dimensions: { width, height },
      };

      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, true);

      console.log('✅ Mapbox satellite imagery retrieved successfully');
      return data;
    } catch (error) {
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, false, error);
      console.error('❌ Mapbox satellite imagery error:', error.message);
      return null;
    }
  }

  /**
   * Get terrain elevation data (RGB terrain tiles)
   */
  async getTerrainData(longitude, latitude, zoom = 15) {
    if (!this.isEnabled()) {
      console.log('Mapbox is not enabled, skipping terrain data');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapbox_terrain', { longitude, latitude, zoom });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      // Mapbox Terrain RGB provides elevation data
      const url = `${this.baseUrl}/v4/mapbox.terrain-rgb/${zoom}/${this.long2tile(longitude, zoom)}/${this.lat2tile(latitude, zoom)}.pngraw`;
      
      const response = await axios.get(url, {
        params: {
          access_token: this.accessToken,
        },
        timeout: this.timeout,
      });

      const data = {
        elevation: response.data,
        location: { longitude, latitude },
        zoom,
      };

      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, true);

      console.log('✅ Mapbox terrain data retrieved successfully');
      return data;
    } catch (error) {
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, false, error);
      console.error('❌ Mapbox terrain data error:', error.message);
      return null;
    }
  }

  /**
   * Get building footprints and vector data
   */
  async getBuildingFootprints(longitude, latitude, zoom = 15) {
    if (!this.isEnabled()) {
      console.log('Mapbox is not enabled, skipping building footprints');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapbox_buildings', { longitude, latitude, zoom });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      // Use Mapbox Vector Tiles for building data
      const x = this.long2tile(longitude, zoom);
      const y = this.lat2tile(latitude, zoom);
      const url = `${this.baseUrl}/v4/mapbox.mapbox-streets-v8/${zoom}/${x}/${y}.vector.pbf`;
      
      const response = await axios.get(url, {
        params: {
          access_token: this.accessToken,
        },
        timeout: this.timeout,
        responseType: 'arraybuffer',
      });

      const data = {
        vectorTile: response.data,
        location: { longitude, latitude },
        zoom,
        tileCoords: { x, y },
      };

      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, true);

      console.log('✅ Mapbox building footprints retrieved successfully');
      return data;
    } catch (error) {
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, false, error);
      console.error('❌ Mapbox building footprints error:', error.message);
      return null;
    }
  }

  /**
   * Get geocoding data (convert place name to coordinates)
   */
  async geocode(placeName) {
    if (!this.isEnabled()) {
      console.log('Mapbox is not enabled, skipping geocoding');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapbox_geocode', { placeName });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const url = `${this.baseUrl}/geocoding/v5/mapbox.places/${encodeURIComponent(placeName)}.json`;
      
      const response = await axios.get(url, {
        params: {
          access_token: this.accessToken,
          limit: 1,
        },
        timeout: this.timeout,
      });

      if (!response.data.features || response.data.features.length === 0) {
        console.log('⚠️  Mapbox geocoding: No results found');
        return null;
      }

      const feature = response.data.features[0];
      const data = {
        name: feature.place_name,
        coordinates: {
          longitude: feature.center[0],
          latitude: feature.center[1],
        },
        bbox: feature.bbox,
        placeType: feature.place_type,
        relevance: feature.relevance,
      };

      cacheService.setLongTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, true);

      console.log('✅ Mapbox geocoding successful:', data.name);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, false, error);
      console.error('❌ Mapbox geocoding error:', error.message);
      return null;
    }
  }

  /**
   * Get map style for custom rendering
   */
  async getMapStyle(styleId = 'streets-v12') {
    if (!this.isEnabled()) {
      console.log('Mapbox is not enabled, skipping map style');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapbox_style', { styleId });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const url = `${this.baseUrl}/styles/v1/mapbox/${styleId}`;
      
      const response = await axios.get(url, {
        params: {
          access_token: this.accessToken,
        },
        timeout: this.timeout,
      });

      const data = response.data;
      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, true);

      console.log('✅ Mapbox map style retrieved successfully');
      return data;
    } catch (error) {
      analyticsService.trackAPICall('mapbox', Date.now() - startTime, false, error);
      console.error('❌ Mapbox map style error:', error.message);
      return null;
    }
  }

  /**
   * Convert longitude to tile X coordinate
   */
  long2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  }

  /**
   * Convert latitude to tile Y coordinate
   */
  lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  }

  /**
   * Retry wrapper for API calls
   */
  async retryRequest(requestFn, retries = this.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏸️  Retry attempt ${attempt}/${retries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

// Export singleton instance
module.exports = new MapboxService();
