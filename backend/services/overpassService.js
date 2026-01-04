const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Overpass API Service (OpenStreetMap)
 * Provides real building data, dimensions, road networks, and POIs
 * Documentation: https://wiki.openstreetmap.org/wiki/Overpass_API
 */
class OverpassService {
  constructor() {
    this.enabled = process.env.ENABLE_OVERPASS !== 'false';
    this.baseUrl = 'https://overpass-api.de/api/interpreter';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 10000;
    this.maxRetries = 3;
  }

  /**
   * Check if Overpass is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Build Overpass QL query
   */
  buildQuery(elements, bbox, filters = {}) {
    const [south, west, north, east] = bbox;
    let query = '[out:json][timeout:25];\n';
    query += '(\n';

    for (const element of elements) {
      const filterStr = Object.entries(filters)
        .map(([key, value]) => `["${key}"="${value}"]`)
        .join('');
      query += `  ${element}${filterStr}(${south},${west},${north},${east});\n`;
    }

    query += ');\nout body;\n>;\nout skel qt;';
    return query;
  }

  /**
   * Execute Overpass query
   */
  async executeQuery(query) {
    if (!this.isEnabled()) {
      console.log('Overpass API is not enabled, skipping query');
      return null;
    }

    const cacheKey = cacheService.generateKey('overpass_query', { query });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.post(this.baseUrl, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: this.timeout,
      });

      const data = response.data;
      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('openstreetmap', Date.now() - startTime, true);

      console.log(`✅ Overpass query successful: ${data.elements?.length || 0} elements`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('openstreetmap', Date.now() - startTime, false, error);
      console.error('❌ Overpass query error:', error.message);
      return null;
    }
  }

  /**
   * Get buildings in an area with their properties
   */
  async getBuildings(latitude, longitude, radiusMeters = 500) {
    const bbox = this.calculateBBox(latitude, longitude, radiusMeters);
    const query = this.buildQuery(['way', 'relation'], bbox, { building: '*' });
    
    const result = await this.executeQuery(query);
    if (!result || !result.elements) {
      return [];
    }

    return result.elements.map(element => this.parseBuilding(element)).filter(b => b);
  }

  /**
   * Parse building data from OSM element
   */
  parseBuilding(element) {
    if (!element.tags) {
      return null;
    }

    return {
      id: element.id,
      type: element.type,
      name: element.tags.name || 'Unknown Building',
      buildingType: element.tags.building,
      height: this.parseHeight(element.tags['height'] || element.tags['building:levels']),
      levels: parseInt(element.tags['building:levels']) || null,
      address: this.parseAddress(element.tags),
      amenity: element.tags.amenity,
      historic: element.tags.historic,
      architectural_style: element.tags['architectural:style'] || element.tags.architecture,
      year_built: element.tags['start_date'] || element.tags['building:year'],
      geometry: element.geometry || element.nodes,
      center: element.center || this.calculateCenter(element),
      tags: element.tags,
    };
  }

  /**
   * Parse height from OSM tags
   */
  parseHeight(heightStr) {
    if (!heightStr) return null;

    // If it's building levels, estimate height
    if (typeof heightStr === 'number' || !isNaN(heightStr)) {
      const levels = parseInt(heightStr);
      return levels * 3.5; // Average 3.5m per floor
    }

    // Parse height with units
    const match = heightStr.match(/^([\d.]+)\s*(m|ft)?$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2] || 'm';
      return unit === 'ft' ? value * 0.3048 : value;
    }

    return null;
  }

  /**
   * Parse address from OSM tags
   */
  parseAddress(tags) {
    return {
      street: tags['addr:street'],
      housenumber: tags['addr:housenumber'],
      postcode: tags['addr:postcode'],
      city: tags['addr:city'],
      country: tags['addr:country'],
    };
  }

  /**
   * Get road network in an area
   */
  async getRoadNetwork(latitude, longitude, radiusMeters = 500) {
    const bbox = this.calculateBBox(latitude, longitude, radiusMeters);
    const query = this.buildQuery(['way'], bbox, { highway: '*' });
    
    const result = await this.executeQuery(query);
    if (!result || !result.elements) {
      return [];
    }

    return result.elements.map(element => ({
      id: element.id,
      type: element.tags?.highway,
      name: element.tags?.name || 'Unnamed Road',
      surface: element.tags?.surface,
      lanes: parseInt(element.tags?.lanes) || 1,
      maxspeed: element.tags?.maxspeed,
      oneway: element.tags?.oneway === 'yes',
      geometry: element.geometry || element.nodes,
      tags: element.tags,
    }));
  }

  /**
   * Get points of interest (POIs)
   */
  async getPOIs(latitude, longitude, radiusMeters = 500) {
    const bbox = this.calculateBBox(latitude, longitude, radiusMeters);
    const query = this.buildQuery(['node', 'way', 'relation'], bbox, { amenity: '*' });
    
    const result = await this.executeQuery(query);
    if (!result || !result.elements) {
      return [];
    }

    return result.elements.map(element => ({
      id: element.id,
      name: element.tags?.name || 'Unknown POI',
      type: element.tags?.amenity,
      location: element.lat && element.lon ? { latitude: element.lat, longitude: element.lon } : null,
      tags: element.tags,
    })).filter(poi => poi.location);
  }

  /**
   * Get landmarks and famous buildings
   */
  async getLandmarks(latitude, longitude, radiusMeters = 1000) {
    const bbox = this.calculateBBox(latitude, longitude, radiusMeters);
    
    // Query for historic, tourist, and notable buildings
    let query = '[out:json][timeout:25];\n(\n';
    query += `  way["historic"](${bbox.join(',')});\n`;
    query += `  way["tourism"](${bbox.join(',')});\n`;
    query += `  way["building"]["name"](${bbox.join(',')});\n`;
    query += ');\nout body;\n>;\nout skel qt;';
    
    const result = await this.executeQuery(query);
    if (!result || !result.elements) {
      return [];
    }

    return result.elements
      .filter(e => e.tags && (e.tags.historic || e.tags.tourism || e.tags.name))
      .map(element => this.parseBuilding(element))
      .filter(b => b);
  }

  /**
   * Search for buildings by name
   */
  async searchBuildings(name, latitude, longitude, radiusMeters = 5000) {
    const bbox = this.calculateBBox(latitude, longitude, radiusMeters);
    
    let query = '[out:json][timeout:25];\n(\n';
    query += `  way["building"]["name"~"${name}",i](${bbox.join(',')});\n`;
    query += `  relation["building"]["name"~"${name}",i](${bbox.join(',')});\n`;
    query += ');\nout body;\n>;\nout skel qt;';
    
    const result = await this.executeQuery(query);
    if (!result || !result.elements) {
      return [];
    }

    return result.elements.map(element => this.parseBuilding(element)).filter(b => b);
  }

  /**
   * Calculate bounding box from center point and radius
   */
  calculateBBox(latitude, longitude, radiusMeters) {
    const latDelta = radiusMeters / 111320; // 1 degree latitude ≈ 111,320 meters
    const lonDelta = radiusMeters / (111320 * Math.cos(latitude * Math.PI / 180));

    return [
      latitude - latDelta,  // south
      longitude - lonDelta, // west
      latitude + latDelta,  // north
      longitude + lonDelta, // east
    ];
  }

  /**
   * Calculate center point from geometry
   */
  calculateCenter(element) {
    if (element.lat && element.lon) {
      return { latitude: element.lat, longitude: element.lon };
    }

    if (element.center) {
      return { latitude: element.center.lat, longitude: element.center.lon };
    }

    // Calculate from geometry if available
    if (element.geometry && element.geometry.length > 0) {
      const avgLat = element.geometry.reduce((sum, p) => sum + p.lat, 0) / element.geometry.length;
      const avgLon = element.geometry.reduce((sum, p) => sum + p.lon, 0) / element.geometry.length;
      return { latitude: avgLat, longitude: avgLon };
    }

    return null;
  }

  /**
   * Get area statistics
   */
  async getAreaStatistics(latitude, longitude, radiusMeters = 500) {
    const buildings = await this.getBuildings(latitude, longitude, radiusMeters);
    const roads = await this.getRoadNetwork(latitude, longitude, radiusMeters);
    const pois = await this.getPOIs(latitude, longitude, radiusMeters);

    return {
      buildingCount: buildings.length,
      averageHeight: buildings
        .filter(b => b.height)
        .reduce((sum, b) => sum + b.height, 0) / buildings.filter(b => b.height).length || 0,
      roadCount: roads.length,
      poiCount: pois.length,
      buildingTypes: this.countTypes(buildings, 'buildingType'),
      roadTypes: this.countTypes(roads, 'type'),
    };
  }

  /**
   * Count types for statistics
   */
  countTypes(items, typeField) {
    const counts = {};
    for (const item of items) {
      const type = item[typeField] || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get roads in an area (alias for getRoadNetwork for consistency)
   */
  async getRoads(latitude, longitude, radiusMeters = 500) {
    return this.getRoadNetwork(latitude, longitude, radiusMeters);
  }

  /**
   * Get natural features (parks, forests, water bodies, etc.)
   */
  async getNaturalFeatures(latitude, longitude, radiusMeters = 500) {
    const bbox = this.calculateBBox(latitude, longitude, radiusMeters);
    
    // Query for natural features
    const query = this.buildQuery(
      ['way', 'relation'], 
      bbox, 
      {}
    );
    
    // Build custom query for natural features
    const [south, west, north, east] = bbox;
    const naturalQuery = `[out:json][timeout:25];
(
  way["natural"](${south},${west},${north},${east});
  way["landuse"~"forest|grass|meadow"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  relation["natural"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;

    const result = await this.executeQuery(naturalQuery);
    if (!result || !result.elements) {
      return [];
    }

    return result.elements.map(element => this.parseNaturalFeature(element)).filter(f => f);
  }

  /**
   * Parse natural feature from OSM element
   */
  parseNaturalFeature(element) {
    if (!element || !element.tags) return null;

    const tags = element.tags;
    return {
      id: element.id,
      type: tags.natural || tags.landuse || tags.leisure || 'unknown',
      name: tags.name || 'Unnamed Natural Feature',
      subtype: tags.natural || tags.landuse,
      area: this.calculateArea(element),
      tags: tags
    };
  }

  /**
   * Calculate approximate area of a feature (simplified)
   */
  calculateArea(element) {
    // Simplified area calculation - would need proper polygon area calculation
    // For now, return null as placeholder
    return null;
  }
}

// Export singleton instance
module.exports = new OverpassService();
