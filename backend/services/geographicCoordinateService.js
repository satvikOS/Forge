const mapboxService = require('./mapboxService');
const mapillaryService = require('./mapillaryService');
const overpassService = require('./overpassService');
const elevationService = require('./elevationService');
const treeMapService = require('./treeMapService');
const weatherService = require('./weatherService');

/**
 * Geographic Coordinate Service
 * Analyzes ANY coordinate on Earth and extracts comprehensive environmental data
 * Integrates: Mapbox, Mapillary, OpenStreetMap (Overpass), Elevation, Trees, Weather
 * 
 * This service enables ArchDisc to generate realistic 3D scenes for any location on Earth
 * by combining multiple data sources for complete environmental context
 */
class GeographicCoordinateService {
  constructor() {
    this.enabled = process.env.ENABLE_GEOGRAPHIC_ANALYSIS !== 'false';
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Detect if prompt contains geographic coordinates or location
   */
  detectCoordinates(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Pattern 1: Decimal degrees with explicit N/S/E/W (e.g., "40.7128°N, 74.0060°W")
    const explicitDirectionPattern = /(\d+\.?\d*)[°]?\s*([NS])\s*,?\s*(\d+\.?\d*)[°]?\s*([EW])/i;
    const explicitMatch = prompt.match(explicitDirectionPattern);
    if (explicitMatch) {
      let lat = parseFloat(explicitMatch[1]);
      let lon = parseFloat(explicitMatch[3]);
      
      // Handle S/W indicators
      if (explicitMatch[2].toUpperCase() === 'S') lat = -lat;
      if (explicitMatch[4].toUpperCase() === 'W') lon = -lon;
      
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { latitude: lat, longitude: lon, source: 'explicit' };
      }
    }
    
    // Pattern 2: Decimal degrees without direction (e.g., "40.7128, -74.0060")
    // Coordinates already include positive/negative signs indicating direction
    const decimalPattern = /(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/;
    const decimalMatch = prompt.match(decimalPattern);
    if (decimalMatch) {
      const lat = parseFloat(decimalMatch[1]);
      const lon = parseFloat(decimalMatch[2]);
      
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { latitude: lat, longitude: lon, source: 'explicit' };
      }
    }
    
    // Pattern 3: Named locations (will return null, caller should use geocoding)
    const locationKeywords = [
      'at ', 'in ', 'near ', 'around ',
      'location:', 'coordinates:', 'coord:', 'lat:', 'lon:',
      'city of', 'town of', 'area of'
    ];
    
    for (const keyword of locationKeywords) {
      if (lowerPrompt.includes(keyword)) {
        // Extract location name after keyword
        const parts = lowerPrompt.split(keyword);
        if (parts.length > 1) {
          const locationPart = parts[1].trim().split(/[,\n]/)[0];
          return { locationName: locationPart, source: 'named' };
        }
      }
    }
    
    return null;
  }

  /**
   * Analyze a geographic coordinate and extract ALL environmental data
   * This is the main method that orchestrates all geographic services
   */
  async analyzeCoordinate(latitude, longitude, options = {}) {
    if (!this.isEnabled()) {
      console.log('Geographic Coordinate Service is not enabled');
      return null;
    }

    console.log('\n🌍 ═════════════════════════════════════════════════════════');
    console.log('🌍 GEOGRAPHIC COORDINATE ANALYSIS STARTED');
    console.log('🌍 ═════════════════════════════════════════════════════════');
    console.log(`📍 Analyzing: ${latitude}°N, ${longitude}°E`);
    
    const radiusMeters = options.radiusMeters || 500; // Default 500m radius
    const includeStreetView = options.includeStreetView !== false; // Default true
    
    const startTime = Date.now();
    const results = {
      coordinates: { latitude, longitude },
      radius: radiusMeters,
      timestamp: new Date().toISOString()
    };
    
    // Phase 1: Parallel data gathering - Geographic and Environmental
    console.log('\n📊 Phase 1: Geographic & Environmental Data...');
    
    const phase1Promises = [];
    
    // 1. Elevation data
    if (elevationService.isEnabled()) {
      console.log('  🏔️  Fetching elevation data...');
      phase1Promises.push(
        elevationService.getElevation(latitude, longitude)
          .then(data => ({ type: 'elevation', data }))
          .catch(err => {
            console.warn('  ⚠️  Elevation fetch failed:', err.message);
            return { type: 'elevation', data: null };
          })
      );
    }
    
    // 2. Weather data
    if (weatherService.isEnabled()) {
      console.log('  🌤️  Fetching weather data...');
      phase1Promises.push(
        weatherService.getWeather(latitude, longitude)
          .then(data => ({ type: 'weather', data }))
          .catch(err => {
            console.warn('  ⚠️  Weather fetch failed:', err.message);
            return { type: 'weather', data: null };
          })
      );
    }
    
    // 3. Mapbox satellite imagery
    if (mapboxService.isEnabled()) {
      console.log('  🛰️  Fetching satellite imagery...');
      phase1Promises.push(
        mapboxService.getSatelliteImagery(longitude, latitude)
          .then(data => ({ type: 'satellite', data }))
          .catch(err => {
            console.warn('  ⚠️  Satellite imagery fetch failed:', err.message);
            return { type: 'satellite', data: null };
          })
      );
    }
    
    const phase1Results = await Promise.all(phase1Promises);
    phase1Results.forEach(result => {
      if (result.data) {
        results[result.type] = result.data;
        console.log(`  ✅ ${result.type} data retrieved`);
      }
    });
    
    // Phase 2: Parallel data gathering - Built Environment
    console.log('\n🏗️  Phase 2: Built Environment Data...');
    
    const phase2Promises = [];
    
    // 4. OpenStreetMap buildings
    if (overpassService.isEnabled()) {
      console.log('  🏢 Fetching buildings from OpenStreetMap...');
      phase2Promises.push(
        overpassService.getBuildings(latitude, longitude, radiusMeters)
          .then(data => ({ type: 'buildings', data }))
          .catch(err => {
            console.warn('  ⚠️  Buildings fetch failed:', err.message);
            return { type: 'buildings', data: [] };
          })
      );
      
      console.log('  🛣️  Fetching roads from OpenStreetMap...');
      phase2Promises.push(
        overpassService.getRoads(latitude, longitude, radiusMeters)
          .then(data => ({ type: 'roads', data }))
          .catch(err => {
            console.warn('  ⚠️  Roads fetch failed:', err.message);
            return { type: 'roads', data: [] };
          })
      );
      
      console.log('  🌳 Fetching natural features from OpenStreetMap...');
      phase2Promises.push(
        overpassService.getNaturalFeatures(latitude, longitude, radiusMeters)
          .then(data => ({ type: 'naturalFeatures', data }))
          .catch(err => {
            console.warn('  ⚠️  Natural features fetch failed:', err.message);
            return { type: 'naturalFeatures', data: [] };
          })
      );
    }
    
    // 5. Tree data
    if (treeMapService.isEnabled()) {
      console.log('  🌲 Generating tree distribution...');
      const climate = this.detectClimate(latitude);
      phase2Promises.push(
        treeMapService.getTreesForLocation(latitude, longitude, radiusMeters, climate)
          .then(data => ({ type: 'trees', data }))
          .catch(err => {
            console.warn('  ⚠️  Tree data failed:', err.message);
            return { type: 'trees', data: [] };
          })
      );
    }
    
    const phase2Results = await Promise.all(phase2Promises);
    phase2Results.forEach(result => {
      results[result.type] = result.data;
      const count = Array.isArray(result.data) ? result.data.length : 'N/A';
      console.log(`  ✅ ${result.type}: ${count} items`);
    });
    
    // Phase 3: Street-level imagery (optional, can be slower)
    if (includeStreetView && mapillaryService.isEnabled()) {
      console.log('\n📸 Phase 3: Street-Level Imagery...');
      try {
        console.log('  📷 Fetching Mapillary street-level images...');
        const streetImages = await mapillaryService.searchImages(longitude, latitude, radiusMeters);
        results.streetLevelImagery = streetImages || [];
        console.log(`  ✅ streetLevelImagery: ${results.streetLevelImagery.length} images`);
      } catch (err) {
        console.warn('  ⚠️  Street-level imagery failed:', err.message);
        results.streetLevelImagery = [];
      }
    }
    
    // Phase 4: Data synthesis and analysis
    console.log('\n🧠 Phase 4: Data Synthesis...');
    results.analysis = this.synthesizeEnvironmentalData(results);
    
    const elapsedTime = Date.now() - startTime;
    console.log(`\n✅ Geographic analysis completed in ${elapsedTime}ms`);
    console.log('🌍 ═════════════════════════════════════════════════════════\n');
    
    return results;
  }

  /**
   * Detect climate zone from latitude
   */
  detectClimate(latitude) {
    const absLat = Math.abs(latitude);
    if (absLat < 23.5) return 'tropical';
    if (absLat < 35) return 'subtropical';
    if (absLat < 50) return 'temperate';
    if (absLat < 66.5) return 'boreal';
    return 'tundra';
  }

  /**
   * Synthesize all environmental data into a comprehensive analysis
   */
  synthesizeEnvironmentalData(data) {
    const analysis = {
      environmentType: 'unknown',
      density: 'unknown',
      characteristics: [],
      recommendations: {}
    };
    
    // Determine environment type
    const buildingCount = data.buildings?.length || 0;
    const roadCount = data.roads?.length || 0;
    const treeCount = data.trees?.length || 0;
    const naturalCount = data.naturalFeatures?.length || 0;
    
    if (buildingCount > 20) {
      analysis.environmentType = 'urban-dense';
      analysis.density = 'high';
    } else if (buildingCount > 5) {
      analysis.environmentType = 'urban';
      analysis.density = 'medium';
    } else if (buildingCount > 0) {
      analysis.environmentType = 'suburban';
      analysis.density = 'low';
    } else if (naturalCount > 10 || treeCount > 50) {
      analysis.environmentType = 'natural';
      analysis.density = 'sparse';
    } else {
      analysis.environmentType = 'rural';
      analysis.density = 'low';
    }
    
    // Add characteristics
    if (buildingCount > 0) {
      analysis.characteristics.push(`${buildingCount} buildings`);
    }
    if (roadCount > 0) {
      analysis.characteristics.push(`${roadCount} roads`);
    }
    if (treeCount > 0) {
      analysis.characteristics.push(`${treeCount} trees`);
    }
    if (naturalCount > 0) {
      analysis.characteristics.push(`${naturalCount} natural features`);
    }
    
    // Elevation info
    if (data.elevation) {
      analysis.characteristics.push(`${data.elevation.elevation}m elevation`);
      analysis.terrain = {
        elevation: data.elevation.elevation,
        elevationType: this.categorizeElevation(data.elevation.elevation)
      };
    }
    
    // Weather info
    if (data.weather) {
      analysis.characteristics.push(`${data.weather.description}`);
      analysis.climate = {
        temperature: data.weather.temperature,
        conditions: data.weather.description,
        humidity: data.weather.humidity
      };
    }
    
    // Generation recommendations
    analysis.recommendations = {
      scaleType: buildingCount > 10 ? 'large' : buildingCount > 0 ? 'medium' : 'small',
      detailLevel: buildingCount > 20 ? 'high' : 'medium',
      vegetationDensity: treeCount > 100 ? 'dense' : treeCount > 20 ? 'medium' : 'sparse',
      includeRoads: roadCount > 0,
      includeBuildings: buildingCount > 0,
      includeTrees: treeCount > 0,
      includeNature: naturalCount > 0
    };
    
    return analysis;
  }

  /**
   * Categorize elevation
   */
  categorizeElevation(elevation) {
    if (elevation < 100) return 'lowland';
    if (elevation < 500) return 'highland';
    if (elevation < 1500) return 'mountain';
    return 'high-mountain';
  }

  /**
   * Convert geographic data to 3D scene elements
   * This method transforms real-world data into format expected by geometry generator
   */
  convertToSceneElements(geographicData) {
    const elements = [];
    
    // Convert buildings
    if (geographicData.buildings) {
      geographicData.buildings.forEach((building, index) => {
        elements.push({
          type: 'building',
          category: 'architecture',
          subcategory: building.type || 'building',
          name: building.name || `Building ${index + 1}`,
          dimensions: {
            width: building.dimensions?.width || 10,
            height: building.dimensions?.height || 15,
            depth: building.dimensions?.depth || 10
          },
          position: {
            x: building.position?.x || 0,
            y: 0,
            z: building.position?.z || 0
          },
          materials: building.materials || ['concrete', 'glass'],
          metadata: {
            source: 'openstreetmap',
            osmId: building.id,
            floors: building.floors,
            realWorld: true
          }
        });
      });
    }
    
    // Convert roads
    if (geographicData.roads) {
      geographicData.roads.forEach((road, index) => {
        elements.push({
          type: 'road',
          category: 'infrastructure',
          subcategory: road.type || 'road',
          name: road.name || `Road ${index + 1}`,
          path: road.path || [],
          width: road.width || 5,
          materials: ['asphalt'],
          metadata: {
            source: 'openstreetmap',
            osmId: road.id,
            lanes: road.lanes,
            realWorld: true
          }
        });
      });
    }
    
    // Convert trees
    if (geographicData.trees) {
      // Group trees for instancing
      const treeGroups = {};
      geographicData.trees.forEach(tree => {
        const species = tree.species || 'generic';
        if (!treeGroups[species]) {
          treeGroups[species] = [];
        }
        treeGroups[species].push(tree);
      });
      
      // Create element for each species with instancing data
      Object.entries(treeGroups).forEach(([species, trees]) => {
        elements.push({
          type: 'tree',
          category: 'vegetation',
          subcategory: 'tree',
          name: species,
          quantity: trees.length,
          instances: trees.map(tree => ({
            position: tree.position,
            scale: {
              x: tree.crownDiameter / 5,
              y: tree.height / 10,
              z: tree.crownDiameter / 5
            },
            rotation: { x: 0, y: Math.random() * Math.PI * 2, z: 0 }
          })),
          dimensions: {
            height: trees[0].height || 10,
            crownDiameter: trees[0].crownDiameter || 5
          },
          metadata: {
            source: 'treemap',
            species: species,
            scientificName: trees[0].scientificName,
            realWorld: true
          }
        });
      });
    }
    
    // Add terrain/ground plane
    if (geographicData.elevation) {
      elements.push({
        type: 'terrain',
        category: 'landscape',
        subcategory: 'ground',
        name: 'Terrain',
        dimensions: {
          width: geographicData.radius * 2,
          depth: geographicData.radius * 2,
          height: 0.1
        },
        elevation: geographicData.elevation.elevation,
        materials: this.detectGroundMaterial(geographicData),
        metadata: {
          source: 'elevation-api',
          realWorld: true
        }
      });
    }
    
    return elements;
  }

  /**
   * Detect appropriate ground material based on environment
   */
  detectGroundMaterial(geographicData) {
    const analysis = geographicData.analysis;
    
    if (!analysis) return ['grass'];
    
    if (analysis.environmentType.includes('urban')) {
      return ['concrete', 'asphalt'];
    } else if (analysis.environmentType === 'natural') {
      return ['grass', 'dirt', 'vegetation'];
    } else if (analysis.environmentType === 'rural') {
      return ['grass', 'dirt'];
    }
    
    return ['grass'];
  }
}

module.exports = new GeographicCoordinateService();
