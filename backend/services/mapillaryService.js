const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Mapillary API Service
 * Provides street-level imagery for ground-level architectural context
 * Documentation: https://www.mapillary.com/developer/api-documentation
 */
class MapillaryService {
  constructor() {
    this.clientId = process.env.MAPILLARY_CLIENT_ID;
    this.enabled = process.env.MAPILLARY_ENABLED === 'true';
    this.baseUrl = 'https://graph.mapillary.com';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
  }

  /**
   * Check if Mapillary is enabled
   */
  isEnabled() {
    return this.enabled && this.clientId;
  }

  /**
   * Search for images near a location
   */
  async searchImages(longitude, latitude, radius = 100, limit = 20) {
    if (!this.isEnabled()) {
      console.log('Mapillary is not enabled, skipping street-level imagery');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapillary_search', { longitude, latitude, radius, limit });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      // Create bounding box
      const bbox = this.createBBox(latitude, longitude, radius);
      
      const response = await axios.get(`${this.baseUrl}/images`, {
        params: {
          access_token: this.clientId,
          bbox: bbox.join(','),
          limit,
          fields: 'id,altitude,atomic_scale,camera_parameters,camera_type,captured_at,compass_angle,computed_altitude,computed_compass_angle,computed_geometry,computed_rotation,exif_orientation,geometry,height,is_pano,sequence,width,thumb_256_url,thumb_1024_url,thumb_2048_url',
        },
        timeout: this.timeout,
      });

      const images = response.data.data || [];
      const processed = images.map(img => this.processImage(img));

      cacheService.setMediumTerm(cacheKey, processed);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapillary', Date.now() - startTime, true);

      console.log(`✅ Mapillary: Found ${processed.length} street-level images`);
      return processed;
    } catch (error) {
      analyticsService.trackAPICall('mapillary', Date.now() - startTime, false, error);
      console.error('❌ Mapillary search error:', error.message);
      return null;
    }
  }

  /**
   * Get image details
   */
  async getImageDetails(imageId) {
    if (!this.isEnabled()) {
      console.log('Mapillary is not enabled, skipping image details');
      return null;
    }

    const cacheKey = cacheService.generateKey('mapillary_image', { imageId });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(`${this.baseUrl}/${imageId}`, {
        params: {
          access_token: this.clientId,
          fields: 'id,altitude,atomic_scale,camera_parameters,camera_type,captured_at,compass_angle,computed_altitude,computed_compass_angle,computed_geometry,computed_rotation,exif_orientation,geometry,height,is_pano,sequence,width,thumb_256_url,thumb_1024_url,thumb_2048_url',
        },
        timeout: this.timeout,
      });

      const data = this.processImage(response.data);
      cacheService.setLongTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('mapillary', Date.now() - startTime, true);

      console.log(`✅ Mapillary image details retrieved: ${imageId}`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('mapillary', Date.now() - startTime, false, error);
      console.error('❌ Mapillary image details error:', error.message);
      return null;
    }
  }

  /**
   * Get images for a specific building
   */
  async getBuildingImages(buildingLocation, radius = 50) {
    const images = await this.searchImages(
      buildingLocation.longitude,
      buildingLocation.latitude,
      radius,
      10
    );

    if (!images) {
      return null;
    }

    // Sort by proximity to building
    const sorted = images.sort((a, b) => {
      const distA = this.calculateDistance(
        a.location.latitude,
        a.location.longitude,
        buildingLocation.latitude,
        buildingLocation.longitude
      );
      const distB = this.calculateDistance(
        b.location.latitude,
        b.location.longitude,
        buildingLocation.latitude,
        buildingLocation.longitude
      );
      return distA - distB;
    });

    return sorted;
  }

  /**
   * Get facade details from street-level imagery
   */
  async getFacadeContext(longitude, latitude, direction = null) {
    const images = await this.searchImages(longitude, latitude, 30, 20);

    if (!images || images.length === 0) {
      return null;
    }

    // Filter images facing the right direction if specified
    let filtered = images;
    if (direction !== null) {
      filtered = images.filter(img => {
        const angleDiff = Math.abs(img.compassAngle - direction);
        return angleDiff < 45 || angleDiff > 315;
      });
    }

    // Analyze facade features from available images
    return {
      totalImages: images.length,
      facadeImages: filtered.length,
      images: filtered.slice(0, 5), // Top 5 relevant images
      averageHeight: this.estimateAverageHeight(filtered),
      viewAngles: filtered.map(img => img.compassAngle),
    };
  }

  /**
   * Process image data
   */
  processImage(img) {
    return {
      id: img.id,
      location: {
        latitude: img.geometry?.coordinates?.[1] || img.computed_geometry?.coordinates?.[1],
        longitude: img.geometry?.coordinates?.[0] || img.computed_geometry?.coordinates?.[0],
      },
      altitude: img.computed_altitude || img.altitude,
      compassAngle: img.computed_compass_angle || img.compass_angle,
      capturedAt: img.captured_at,
      isPanorama: img.is_pano,
      dimensions: {
        width: img.width,
        height: img.height,
      },
      thumbnails: {
        small: img.thumb_256_url,
        medium: img.thumb_1024_url,
        large: img.thumb_2048_url,
      },
      cameraType: img.camera_type,
      sequenceId: img.sequence,
    };
  }

  /**
   * Create bounding box from center point and radius
   */
  createBBox(latitude, longitude, radiusMeters) {
    const latDelta = radiusMeters / 111320;
    const lonDelta = radiusMeters / (111320 * Math.cos(latitude * Math.PI / 180));

    return [
      longitude - lonDelta, // west
      latitude - latDelta,  // south
      longitude + lonDelta, // east
      latitude + latDelta,  // north
    ];
  }

  /**
   * Calculate distance between two points
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

    return R * c;
  }

  /**
   * Estimate average building height from images
   */
  estimateAverageHeight(images) {
    if (!images || images.length === 0) return null;

    const heights = images
      .filter(img => img.altitude)
      .map(img => img.altitude);

    if (heights.length === 0) return null;

    return heights.reduce((sum, h) => sum + h, 0) / heights.length;
  }

  /**
   * Analyze environmental context from street-level imagery
   */
  async analyzeEnvironmentalContext(longitude, latitude) {
    const images = await this.searchImages(longitude, latitude, 100, 50);

    if (!images || images.length === 0) {
      return null;
    }

    // Analyze image metadata for environmental insights
    const analysis = {
      totalImages: images.length,
      imageDensity: images.length > 30 ? 'high' : images.length > 10 ? 'medium' : 'low',
      coverageAngles: this.analyzeCoverageAngles(images),
      temporalCoverage: this.analyzeTemporalCoverage(images),
      averageAltitude: images
        .filter(img => img.altitude)
        .reduce((sum, img) => sum + img.altitude, 0) / images.length,
      panoramas: images.filter(img => img.isPanorama).length,
    };

    return analysis;
  }

  /**
   * Analyze coverage angles
   */
  analyzeCoverageAngles(images) {
    const angles = images.map(img => img.compassAngle).filter(a => a !== null);
    if (angles.length === 0) return null;

    // Group into 8 cardinal directions
    const directions = {
      N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0,
    };

    angles.forEach(angle => {
      if (angle >= 337.5 || angle < 22.5) directions.N++;
      else if (angle < 67.5) directions.NE++;
      else if (angle < 112.5) directions.E++;
      else if (angle < 157.5) directions.SE++;
      else if (angle < 202.5) directions.S++;
      else if (angle < 247.5) directions.SW++;
      else if (angle < 292.5) directions.W++;
      else directions.NW++;
    });

    return directions;
  }

  /**
   * Analyze temporal coverage
   */
  analyzeTemporalCoverage(images) {
    const dates = images
      .map(img => img.capturedAt)
      .filter(d => d)
      .sort();

    if (dates.length === 0) return null;

    return {
      earliest: dates[0],
      latest: dates[dates.length - 1],
      totalCaptures: dates.length,
    };
  }
}

// Export singleton instance
module.exports = new MapillaryService();
