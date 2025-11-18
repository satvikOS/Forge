const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * OpenTreeMap API Service
 * Provides urban tree locations, species, and canopy data for ultra-realistic vegetation
 * Note: This is a placeholder for tree data integration
 * Real implementation would use city-specific OpenTreeMap instances or similar services
 */
class TreeMapService {
  constructor() {
    this.enabled = process.env.ENABLE_TREE_MAP !== 'false';
    // OpenTreeMap instances are city-specific, e.g., https://phillytreemap.org
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get tree data for a location (procedural/rule-based for now)
   */
  async getTreesForLocation(latitude, longitude, radiusMeters = 500, climate = 'temperate') {
    if (!this.isEnabled()) {
      console.log('TreeMap is not enabled, skipping tree data');
      return null;
    }

    const cacheKey = cacheService.generateKey('trees', { latitude, longitude, radiusMeters, climate });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    
    // Generate procedural tree data based on climate and urban density
    const trees = this.generateProceduralTrees(latitude, longitude, radiusMeters, climate);
    
    analyticsService.trackCache(false);
    analyticsService.trackAPICall('treemap', Date.now() - startTime, true);

    cacheService.setMediumTerm(cacheKey, trees);
    console.log(`✅ Generated ${trees.length} trees for location`);
    return trees;
  }

  /**
   * Generate procedural tree distribution based on real-world patterns
   */
  generateProceduralTrees(latitude, longitude, radiusMeters, climate) {
    const trees = [];
    const speciesData = this.getSpeciesForClimate(climate);
    
    // Calculate tree density based on climate (trees per hectare)
    const densityMap = {
      tropical: 400,
      subtropical: 250,
      temperate: 150,
      boreal: 100,
      arid: 20,
      tundra: 5,
    };
    
    const density = densityMap[climate] || 100;
    const areaHectares = (Math.PI * radiusMeters * radiusMeters) / 10000;
    const treeCount = Math.floor(density * areaHectares * (0.5 + Math.random() * 0.5));
    
    for (let i = 0; i < treeCount; i++) {
      // Distribute trees with some clustering (natural pattern)
      const cluster = Math.random() < 0.7; // 70% of trees in clusters
      const clusterRadius = cluster ? radiusMeters * 0.3 : radiusMeters;
      
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.sqrt(Math.random()) * clusterRadius;
      
      const species = this.selectSpecies(speciesData);
      const age = Math.floor(Math.random() * 50) + 5; // 5-55 years
      const health = 0.7 + Math.random() * 0.3; // 70-100% healthy
      
      trees.push({
        id: `tree_${i}`,
        species: species.name,
        scientificName: species.scientific,
        position: {
          latitude: latitude + (distance * Math.cos(angle)) / 111320,
          longitude: longitude + (distance * Math.sin(angle)) / (111320 * Math.cos(latitude * Math.PI / 180)),
        },
        height: species.height * (0.8 + Math.random() * 0.4) * Math.min(age / 30, 1),
        crownDiameter: species.crownDiameter * (0.8 + Math.random() * 0.4) * Math.min(age / 30, 1),
        trunkDiameter: species.trunkDiameter * Math.min(age / 40, 1),
        age,
        health,
        leafType: species.leafType,
        seasonalBehavior: species.seasonal,
        canopyDensity: species.canopyDensity * health,
      });
    }
    
    return trees;
  }

  /**
   * Get tree species appropriate for climate
   */
  getSpeciesForClimate(climate) {
    const speciesDatabase = {
      tropical: [
        { name: 'Royal Palm', scientific: 'Roystonea regia', height: 25, crownDiameter: 8, trunkDiameter: 0.6, leafType: 'palm', seasonal: false, canopyDensity: 0.7 },
        { name: 'Mango Tree', scientific: 'Mangifera indica', height: 15, crownDiameter: 12, trunkDiameter: 1.2, leafType: 'broadleaf', seasonal: false, canopyDensity: 0.9 },
        { name: 'Banyan Tree', scientific: 'Ficus benghalensis', height: 20, crownDiameter: 30, trunkDiameter: 2.0, leafType: 'broadleaf', seasonal: false, canopyDensity: 0.95 },
      ],
      subtropical: [
        { name: 'Live Oak', scientific: 'Quercus virginiana', height: 20, crownDiameter: 25, trunkDiameter: 1.5, leafType: 'broadleaf', seasonal: false, canopyDensity: 0.85 },
        { name: 'Magnolia', scientific: 'Magnolia grandiflora', height: 18, crownDiameter: 12, trunkDiameter: 1.0, leafType: 'broadleaf', seasonal: false, canopyDensity: 0.8 },
        { name: 'Cypress', scientific: 'Taxodium distichum', height: 30, crownDiameter: 10, trunkDiameter: 1.5, leafType: 'needle', seasonal: true, canopyDensity: 0.7 },
      ],
      temperate: [
        { name: 'Oak', scientific: 'Quercus robur', height: 25, crownDiameter: 20, trunkDiameter: 1.8, leafType: 'broadleaf', seasonal: true, canopyDensity: 0.85 },
        { name: 'Maple', scientific: 'Acer saccharum', height: 22, crownDiameter: 15, trunkDiameter: 1.2, leafType: 'broadleaf', seasonal: true, canopyDensity: 0.8 },
        { name: 'Birch', scientific: 'Betula pendula', height: 18, crownDiameter: 10, trunkDiameter: 0.6, leafType: 'broadleaf', seasonal: true, canopyDensity: 0.7 },
        { name: 'Elm', scientific: 'Ulmus americana', height: 28, crownDiameter: 22, trunkDiameter: 2.0, leafType: 'broadleaf', seasonal: true, canopyDensity: 0.9 },
      ],
      boreal: [
        { name: 'Norway Spruce', scientific: 'Picea abies', height: 30, crownDiameter: 8, trunkDiameter: 1.2, leafType: 'needle', seasonal: false, canopyDensity: 0.85 },
        { name: 'Scots Pine', scientific: 'Pinus sylvestris', height: 25, crownDiameter: 10, trunkDiameter: 1.0, leafType: 'needle', seasonal: false, canopyDensity: 0.75 },
        { name: 'Larch', scientific: 'Larix decidua', height: 28, crownDiameter: 12, trunkDiameter: 1.5, leafType: 'needle', seasonal: true, canopyDensity: 0.7 },
      ],
      arid: [
        { name: 'Joshua Tree', scientific: 'Yucca brevifolia', height: 8, crownDiameter: 3, trunkDiameter: 0.5, leafType: 'succulent', seasonal: false, canopyDensity: 0.3 },
        { name: 'Mesquite', scientific: 'Prosopis glandulosa', height: 6, crownDiameter: 8, trunkDiameter: 0.4, leafType: 'small_leaf', seasonal: false, canopyDensity: 0.5 },
        { name: 'Palo Verde', scientific: 'Parkinsonia florida', height: 5, crownDiameter: 6, trunkDiameter: 0.3, leafType: 'small_leaf', seasonal: false, canopyDensity: 0.4 },
      ],
      tundra: [
        { name: 'Dwarf Birch', scientific: 'Betula nana', height: 1.5, crownDiameter: 2, trunkDiameter: 0.1, leafType: 'broadleaf', seasonal: true, canopyDensity: 0.3 },
        { name: 'Arctic Willow', scientific: 'Salix arctica', height: 0.5, crownDiameter: 1.5, trunkDiameter: 0.05, leafType: 'small_leaf', seasonal: true, canopyDensity: 0.4 },
      ],
    };
    
    return speciesDatabase[climate] || speciesDatabase.temperate;
  }

  /**
   * Select species with weighted random selection
   */
  selectSpecies(speciesList) {
    return speciesList[Math.floor(Math.random() * speciesList.length)];
  }

  /**
   * Get seasonal foliage state
   */
  getSeasonalState(month, seasonal, leafType) {
    if (!seasonal) {
      return { hasLeaves: true, color: 'green', density: 1.0 };
    }

    // Northern hemisphere seasons
    if (leafType === 'broadleaf') {
      if (month >= 3 && month <= 5) { // Spring
        return { hasLeaves: true, color: 'light_green', density: 0.8 };
      } else if (month >= 6 && month <= 8) { // Summer
        return { hasLeaves: true, color: 'green', density: 1.0 };
      } else if (month >= 9 && month <= 11) { // Autumn
        return { hasLeaves: true, color: 'autumn', density: 0.6 };
      } else { // Winter
        return { hasLeaves: false, color: 'none', density: 0.0 };
      }
    }

    return { hasLeaves: true, color: 'green', density: 1.0 };
  }

  /**
   * Calculate canopy coverage for an area
   */
  calculateCanopyCoverage(trees) {
    if (!trees || trees.length === 0) {
      return 0;
    }

    const totalCanopyArea = trees.reduce((sum, tree) => {
      const radius = tree.crownDiameter / 2;
      return sum + (Math.PI * radius * radius * tree.canopyDensity);
    }, 0);

    return {
      totalTrees: trees.length,
      totalCanopyArea,
      averageHeight: trees.reduce((sum, t) => sum + t.height, 0) / trees.length,
      averageCanopyDiameter: trees.reduce((sum, t) => sum + t.crownDiameter, 0) / trees.length,
      speciesDistribution: this.getSpeciesDistribution(trees),
    };
  }

  /**
   * Get species distribution
   */
  getSpeciesDistribution(trees) {
    const distribution = {};
    trees.forEach(tree => {
      distribution[tree.species] = (distribution[tree.species] || 0) + 1;
    });
    return distribution;
  }

  /**
   * Get tree placement recommendations for rendering
   */
  getPlacementRecommendations(trees, buildingFootprints) {
    // Filter trees that would overlap with buildings
    const validTrees = trees.filter(tree => {
      if (!buildingFootprints || buildingFootprints.length === 0) {
        return true;
      }

      // Check if tree overlaps with any building
      for (const building of buildingFootprints) {
        const distance = this.calculateDistance(
          tree.position.latitude,
          tree.position.longitude,
          building.center.latitude,
          building.center.longitude
        );

        // Buffer: tree crown radius + building buffer
        if (distance < (tree.crownDiameter / 2 + 5)) {
          return false;
        }
      }

      return true;
    });

    return {
      totalTrees: trees.length,
      validTrees: validTrees.length,
      removed: trees.length - validTrees.length,
      trees: validTrees,
    };
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
}

// Export singleton instance
module.exports = new TreeMapService();
