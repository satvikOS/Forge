const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Open-Elevation API Service
 * Provides accurate terrain elevation data with multi-point queries
 * Documentation: https://open-elevation.com/
 */
class ElevationService {
  constructor() {
    this.enabled = process.env.ENABLE_OPEN_ELEVATION !== 'false';
    this.baseUrl = 'https://api.open-elevation.com/api/v1';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
    this.maxRetries = 3;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get elevation for a single point
   */
  async getElevation(latitude, longitude) {
    if (!this.isEnabled()) {
      console.log('Open-Elevation is not enabled, skipping elevation query');
      return null;
    }

    const cacheKey = cacheService.generateKey('elevation_point', { latitude, longitude });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(`${this.baseUrl}/lookup`, {
        params: {
          locations: `${latitude},${longitude}`,
        },
        timeout: this.timeout,
      });

      if (!response.data.results || response.data.results.length === 0) {
        console.log('⚠️  Open-Elevation: No results found');
        return null;
      }

      const data = {
        latitude,
        longitude,
        elevation: response.data.results[0].elevation,
        unit: 'meters',
      };

      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('open-elevation', Date.now() - startTime, true);

      console.log(`✅ Elevation retrieved: ${data.elevation}m at (${latitude}, ${longitude})`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('open-elevation', Date.now() - startTime, false, error);
      console.error('❌ Open-Elevation error:', error.message);
      return null;
    }
  }

  /**
   * Get elevations for multiple points
   */
  async getElevationBatch(locations) {
    if (!this.isEnabled()) {
      console.log('Open-Elevation is not enabled, skipping batch elevation query');
      return null;
    }

    // Convert locations array to cache key
    const cacheKey = cacheService.generateKey('elevation_batch', { locations: JSON.stringify(locations) });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      // Format: [{latitude: lat, longitude: lon}, ...]
      const response = await axios.post(`${this.baseUrl}/lookup`, {
        locations: locations.map(loc => ({
          latitude: loc.latitude,
          longitude: loc.longitude,
        })),
      }, {
        timeout: this.timeout * 2, // Longer timeout for batch requests
      });

      if (!response.data.results) {
        console.log('⚠️  Open-Elevation: No results found');
        return null;
      }

      const data = response.data.results.map(result => ({
        latitude: result.latitude,
        longitude: result.longitude,
        elevation: result.elevation,
        unit: 'meters',
      }));

      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('open-elevation', Date.now() - startTime, true);

      console.log(`✅ Batch elevation retrieved: ${data.length} points`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('open-elevation', Date.now() - startTime, false, error);
      console.error('❌ Open-Elevation batch error:', error.message);
      return null;
    }
  }

  /**
   * Generate terrain profile along a path
   */
  async getTerrainProfile(startLat, startLon, endLat, endLon, numPoints = 20) {
    if (!this.isEnabled()) {
      console.log('Open-Elevation is not enabled, skipping terrain profile');
      return null;
    }

    const locations = this.interpolatePoints(startLat, startLon, endLat, endLon, numPoints);
    const elevations = await this.getElevationBatch(locations);

    if (!elevations) {
      return null;
    }

    return {
      start: { latitude: startLat, longitude: startLon, elevation: elevations[0].elevation },
      end: { latitude: endLat, longitude: endLon, elevation: elevations[elevations.length - 1].elevation },
      profile: elevations,
      distance: this.calculateDistance(startLat, startLon, endLat, endLon),
      elevationGain: this.calculateElevationGain(elevations),
      minElevation: Math.min(...elevations.map(e => e.elevation)),
      maxElevation: Math.max(...elevations.map(e => e.elevation)),
    };
  }

  /**
   * Get elevation grid for an area
   */
  async getElevationGrid(centerLat, centerLon, radiusMeters = 500, gridSize = 10) {
    if (!this.isEnabled()) {
      console.log('Open-Elevation is not enabled, skipping elevation grid');
      return null;
    }

    const locations = this.generateGridPoints(centerLat, centerLon, radiusMeters, gridSize);
    const elevations = await this.getElevationBatch(locations);

    if (!elevations) {
      return null;
    }

    return {
      center: { latitude: centerLat, longitude: centerLon },
      radius: radiusMeters,
      gridSize,
      elevations,
      statistics: {
        min: Math.min(...elevations.map(e => e.elevation)),
        max: Math.max(...elevations.map(e => e.elevation)),
        avg: elevations.reduce((sum, e) => sum + e.elevation, 0) / elevations.length,
        range: Math.max(...elevations.map(e => e.elevation)) - Math.min(...elevations.map(e => e.elevation)),
      },
    };
  }

  /**
   * Interpolate points between two coordinates
   */
  interpolatePoints(startLat, startLon, endLat, endLon, numPoints) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1);
      points.push({
        latitude: startLat + (endLat - startLat) * t,
        longitude: startLon + (endLon - startLon) * t,
      });
    }
    return points;
  }

  /**
   * Generate grid of points around a center
   */
  generateGridPoints(centerLat, centerLon, radiusMeters, gridSize) {
    const points = [];
    const latDelta = radiusMeters / 111320 / (gridSize / 2);
    const lonDelta = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180)) / (gridSize / 2);

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        points.push({
          latitude: centerLat + (i - gridSize / 2) * latDelta,
          longitude: centerLon + (j - gridSize / 2) * lonDelta,
        });
      }
    }

    return points;
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Calculate total elevation gain
   */
  calculateElevationGain(elevations) {
    let gain = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i].elevation - elevations[i - 1].elevation;
      if (diff > 0) {
        gain += diff;
      }
    }
    return gain;
  }

  /**
   * Get terrain slope for an area
   */
  async getTerrainSlope(centerLat, centerLon, radiusMeters = 100) {
    const grid = await this.getElevationGrid(centerLat, centerLon, radiusMeters, 5);
    
    if (!grid) {
      return null;
    }

    const range = grid.statistics.range;
    const distance = radiusMeters * 2;
    const slope = (range / distance) * 100; // Percentage

    return {
      slope: slope.toFixed(2),
      slopeAngle: Math.atan(range / distance) * 180 / Math.PI,
      category: this.categorizeSslope(slope),
      elevationRange: range,
      ...grid.statistics,
    };
  }

  /**
   * Categorize slope steepness
   */
  categorizeSlope(slopePercent) {
    if (slopePercent < 5) return 'flat';
    if (slopePercent < 15) return 'gentle';
    if (slopePercent < 30) return 'moderate';
    if (slopePercent < 50) return 'steep';
    return 'very_steep';
  }
}

// Export singleton instance
module.exports = new ElevationService();
