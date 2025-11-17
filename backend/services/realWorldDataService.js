/**
 * Real World Data Service - Integrates with geographical data sources
 * Uses Google Earth Engine patterns and real-world urban data to inform 3D generation
 * Provides authentic spatial patterns, building densities, and environmental layouts
 */

const taxonomySystem = require('./taxonomySystem');

class RealWorldDataService {
  constructor() {
    this.taxonomySystem = taxonomySystem;
    
    // Real-world urban planning data based on research and GEE patterns
    this.urbanPatterns = this.initializeUrbanPatterns();
    this.buildingDensities = this.initializeBuildingDensities();
    this.roadNetworks = this.initializeRoadNetworks();
    this.vegetationPatterns = this.initializeVegetationPatterns();
    this.terrainProfiles = this.initializeTerrainProfiles();
  }

  /**
   * Initialize real-world urban patterns from research and GEE data
   */
  initializeUrbanPatterns() {
    return {
      manhattan_grid: {
        name: 'Manhattan Grid',
        blockSize: { width: 80, depth: 250 }, // meters (typical NYC block)
        buildingSpacing: 15,
        roadWidth: { avenue: 30, street: 18 },
        buildingToStreetRatio: 0.85, // 85% lot coverage
        buildingHeights: { min: 30, max: 300, avg: 80 },
        density: 'very_high',
        pattern: 'orthogonal_grid'
      },
      tokyo_mixed: {
        name: 'Tokyo Mixed',
        blockSize: { width: 50, depth: 100 },
        buildingSpacing: 8,
        roadWidth: { main: 20, side: 10 },
        buildingToStreetRatio: 0.75,
        buildingHeights: { min: 15, max: 200, avg: 50 },
        density: 'high',
        pattern: 'mixed_grid_organic'
      },
      european_medieval: {
        name: 'European Medieval',
        blockSize: { width: 30, depth: 40 },
        buildingSpacing: 5,
        roadWidth: { main: 8, alley: 3 },
        buildingToStreetRatio: 0.90,
        buildingHeights: { min: 8, max: 25, avg: 12 },
        density: 'high',
        pattern: 'organic_irregular'
      },
      suburban_american: {
        name: 'American Suburban',
        blockSize: { width: 150, depth: 200 },
        buildingSpacing: 25,
        roadWidth: { main: 12, local: 8 },
        buildingToStreetRatio: 0.35,
        buildingHeights: { min: 5, max: 12, avg: 8 },
        density: 'low',
        pattern: 'curvilinear_suburban'
      },
      coastal_resort: {
        name: 'Coastal Resort',
        blockSize: { width: 100, depth: 120 },
        buildingSpacing: 40,
        roadWidth: { main: 15, beach_road: 10 },
        buildingToStreetRatio: 0.45,
        buildingHeights: { min: 10, max: 50, avg: 25 },
        density: 'medium',
        pattern: 'linear_coastal'
      },
      industrial_zone: {
        name: 'Industrial Zone',
        blockSize: { width: 200, depth: 300 },
        buildingSpacing: 50,
        roadWidth: { main: 25, service: 15 },
        buildingToStreetRatio: 0.60,
        buildingHeights: { min: 8, max: 30, avg: 15 },
        density: 'low',
        pattern: 'orthogonal_large_lots'
      }
    };
  }

  /**
   * Initialize building density patterns from real cities
   */
  initializeBuildingDensities() {
    return {
      cbd_core: { // Central Business District
        buildingsPerHectare: 40,
        floorAreaRatio: 15.0, // FAR (total floor area / lot area)
        heightRange: [100, 400],
        spacing: { min: 10, max: 30 },
        types: ['skyscraper', 'office_building', 'mixed_use']
      },
      urban_residential: {
        buildingsPerHectare: 80,
        floorAreaRatio: 3.5,
        heightRange: [15, 60],
        spacing: { min: 8, max: 20 },
        types: ['apartment', 'townhouse', 'mixed_use']
      },
      suburban_residential: {
        buildingsPerHectare: 15,
        floorAreaRatio: 0.5,
        heightRange: [5, 12],
        spacing: { min: 20, max: 50 },
        types: ['house', 'duplex']
      },
      commercial_strip: {
        buildingsPerHectare: 25,
        floorAreaRatio: 2.0,
        heightRange: [8, 20],
        spacing: { min: 15, max: 40 },
        types: ['retail_store', 'restaurant', 'mall']
      },
      industrial: {
        buildingsPerHectare: 8,
        floorAreaRatio: 1.2,
        heightRange: [8, 25],
        spacing: { min: 30, max: 100 },
        types: ['warehouse', 'factory', 'distribution']
      },
      village_rural: {
        buildingsPerHectare: 5,
        floorAreaRatio: 0.3,
        heightRange: [4, 10],
        spacing: { min: 30, max: 80 },
        types: ['house', 'barn', 'farm_building']
      }
    };
  }

  /**
   * Initialize road network patterns from real-world analysis
   */
  initializeRoadNetworks() {
    return {
      grid_orthogonal: {
        pattern: 'grid',
        intersection_spacing: 100, // meters between intersections
        road_hierarchy: {
          arterial: { width: 30, lanes: 6, spacing: 800 },
          collector: { width: 20, lanes: 4, spacing: 400 },
          local: { width: 12, lanes: 2, spacing: 100 }
        },
        angles: [0, 90], // perpendicular
        characteristics: 'easy_navigation, high_connectivity'
      },
      radial_concentric: {
        pattern: 'radial',
        rings: [200, 500, 1000], // radius of concentric rings
        spokes: 8, // number of radial roads
        road_hierarchy: {
          ring_road: { width: 35, lanes: 8 },
          radial: { width: 25, lanes: 6 },
          local: { width: 12, lanes: 2 }
        },
        characteristics: 'efficient_city_center_access'
      },
      organic_irregular: {
        pattern: 'organic',
        curvature: 'high',
        intersection_spacing: { min: 50, max: 150 },
        road_hierarchy: {
          main: { width: 15, lanes: 3 },
          secondary: { width: 10, lanes: 2 },
          alley: { width: 4, lanes: 1 }
        },
        angles: 'variable', // not perpendicular
        characteristics: 'historic_districts, pedestrian_friendly'
      },
      dendritic_suburban: {
        pattern: 'dendritic',
        trunk_road: { width: 20, lanes: 4 },
        branch_spacing: 200,
        cul_de_sac_length: 100,
        characteristics: 'low_through_traffic, hierarchical'
      }
    };
  }

  /**
   * Initialize vegetation patterns from satellite imagery analysis
   */
  initializeVegetationPatterns() {
    return {
      urban_park: {
        tree_density: 100, // trees per hectare
        tree_spacing: { min: 8, max: 15 },
        species_mix: { deciduous: 0.6, coniferous: 0.2, palm: 0.2 },
        cluster_size: { min: 3, max: 8 },
        ground_cover: { grass: 0.7, paths: 0.2, water: 0.1 }
      },
      street_trees: {
        tree_density: 40,
        tree_spacing: { min: 10, max: 12 }, // along streets
        species_mix: { deciduous: 0.8, coniferous: 0.2 },
        placement: 'linear_along_road',
        offset_from_road: 2 // meters
      },
      forest: {
        tree_density: 800,
        tree_spacing: { min: 3, max: 6 },
        species_mix: { deciduous: 0.4, coniferous: 0.6 },
        cluster_size: 'continuous',
        understory: { shrubs: 0.6, ground_cover: 0.4 }
      },
      savanna: {
        tree_density: 30,
        tree_spacing: { min: 15, max: 30 },
        species_mix: { deciduous: 0.8, palm: 0.2 },
        cluster_size: { min: 1, max: 3 },
        ground_cover: { grass: 0.9, bare: 0.1 }
      },
      coastal_vegetation: {
        tree_density: 60,
        tree_spacing: { min: 8, max: 12 },
        species_mix: { palm: 0.7, deciduous: 0.3 },
        cluster_size: { min: 2, max: 5 },
        placement: 'clusters_near_water'
      }
    };
  }

  /**
   * Initialize terrain profiles from elevation data
   */
  initializeTerrainProfiles() {
    return {
      coastal_plain: {
        elevation_range: [0, 20],
        slope: 'minimal',
        characteristics: 'flat, beach_transition',
        water_proximity: 'high'
      },
      rolling_hills: {
        elevation_range: [50, 200],
        slope: 'moderate',
        characteristics: 'undulating, valleys',
        drainage: 'natural_streams'
      },
      mountain_valley: {
        elevation_range: [100, 1000],
        slope: 'steep',
        characteristics: 'dramatic_relief, peaks',
        settlement_pattern: 'valley_floor_focused'
      },
      river_delta: {
        elevation_range: [0, 10],
        slope: 'minimal',
        characteristics: 'flat, water_channels',
        soil: 'alluvial'
      }
    };
  }

  /**
   * Analyze prompt and get real-world pattern recommendations
   */
  analyzeForRealWorldPatterns(taxonomyData) {
    const { primaryCategory, scale, style, environmentalContext } = taxonomyData;
    
    console.log('🌍 Analyzing with real-world patterns...');
    
    const recommendations = {
      urbanPattern: this.recommendUrbanPattern(primaryCategory, scale, style),
      buildingDensity: this.recommendBuildingDensity(primaryCategory, scale),
      roadNetwork: this.recommendRoadNetwork(primaryCategory, scale, style),
      vegetationPattern: this.recommendVegetationPattern(environmentalContext),
      terrainProfile: this.recommendTerrainProfile(environmentalContext),
      spatialMetrics: this.calculateSpatialMetrics(scale, primaryCategory)
    };
    
    console.log('✅ Real-world pattern recommendations:', recommendations);
    return recommendations;
  }

  /**
   * Recommend urban pattern based on taxonomy
   */
  recommendUrbanPattern(category, scale, style) {
    if (category !== 'settlement') return null;
    
    const settlementType = scale.settlement;
    const architecturalStyle = style.architectural;
    
    // Map settlement type and style to real-world patterns
    if (settlementType === 'megalopolis' || settlementType === 'metropolis') {
      if (architecturalStyle === 'modern' || architecturalStyle === 'contemporary') {
        return this.urbanPatterns.manhattan_grid;
      }
      return this.urbanPatterns.tokyo_mixed;
    } else if (settlementType === 'city') {
      return this.urbanPatterns.tokyo_mixed;
    } else if (settlementType === 'village' || settlementType === 'hamlet') {
      if (architecturalStyle === 'medieval' || architecturalStyle === 'traditional') {
        return this.urbanPatterns.european_medieval;
      }
      return this.urbanPatterns.suburban_american;
    } else if (settlementType === 'town') {
      return this.urbanPatterns.suburban_american;
    }
    
    return this.urbanPatterns.tokyo_mixed; // default
  }

  /**
   * Recommend building density based on real-world data
   */
  recommendBuildingDensity(category, scale) {
    if (category === 'settlement') {
      const settlementType = scale.settlement;
      
      switch (settlementType) {
        case 'megalopolis':
        case 'metropolis':
          return this.buildingDensities.cbd_core;
        case 'city':
          return this.buildingDensities.urban_residential;
        case 'town':
          return this.buildingDensities.commercial_strip;
        case 'village':
        case 'hamlet':
          return this.buildingDensities.village_rural;
        case 'isolated_dwelling':
          return this.buildingDensities.suburban_residential;
      }
    } else if (category === 'industrial') {
      return this.buildingDensities.industrial;
    }
    
    return this.buildingDensities.urban_residential; // default
  }

  /**
   * Recommend road network pattern
   */
  recommendRoadNetwork(category, scale, style) {
    if (category !== 'settlement') return this.roadNetworks.organic_irregular;
    
    const settlementType = scale.settlement;
    const architecturalStyle = style.architectural;
    
    if (settlementType === 'megalopolis' || settlementType === 'metropolis') {
      return this.roadNetworks.grid_orthogonal;
    } else if (architecturalStyle === 'medieval' || architecturalStyle === 'traditional') {
      return this.roadNetworks.organic_irregular;
    } else if (settlementType === 'town' || settlementType === 'village') {
      return this.roadNetworks.dendritic_suburban;
    }
    
    return this.roadNetworks.grid_orthogonal;
  }

  /**
   * Recommend vegetation pattern
   */
  recommendVegetationPattern(environmentalContext) {
    const { vegetation, terrain, climate } = environmentalContext;
    
    if (vegetation === 'forest' || vegetation === 'dense') {
      return this.vegetationPatterns.forest;
    } else if (climate === 'tropical' || terrain === 'coastal') {
      return this.vegetationPatterns.coastal_vegetation;
    } else if (vegetation === 'moderate') {
      return this.vegetationPatterns.urban_park;
    } else if (vegetation === 'sparse') {
      return this.vegetationPatterns.savanna;
    }
    
    return this.vegetationPatterns.urban_park;
  }

  /**
   * Recommend terrain profile
   */
  recommendTerrainProfile(environmentalContext) {
    const { terrain, waterPresence } = environmentalContext;
    
    if (terrain === 'mountainous') {
      return this.terrainProfiles.mountain_valley;
    } else if (terrain === 'hilly') {
      return this.terrainProfiles.rolling_hills;
    } else if (waterPresence === 'ocean' || waterPresence === 'river') {
      if (terrain === 'flat') {
        return this.terrainProfiles.coastal_plain;
      }
      return this.terrainProfiles.river_delta;
    }
    
    return this.terrainProfiles.coastal_plain;
  }

  /**
   * Calculate spatial metrics based on real-world data
   */
  calculateSpatialMetrics(scale, category) {
    const settlementType = scale.settlement || 'town';
    const dimension = parseInt(scale.dimension) || 500;
    
    // Calculate realistic metrics
    const areaHectares = (dimension * dimension) / 10000; // convert m² to hectares
    
    let buildingsPerHectare = 20;
    let averageSpacing = 30;
    
    switch (settlementType) {
      case 'megalopolis':
      case 'metropolis':
        buildingsPerHectare = 40;
        averageSpacing = 15;
        break;
      case 'city':
        buildingsPerHectare = 30;
        averageSpacing = 20;
        break;
      case 'town':
        buildingsPerHectare = 20;
        averageSpacing = 30;
        break;
      case 'village':
        buildingsPerHectare = 10;
        averageSpacing = 40;
        break;
      case 'hamlet':
        buildingsPerHectare = 5;
        averageSpacing = 60;
        break;
    }
    
    const estimatedBuildings = Math.round(areaHectares * buildingsPerHectare);
    const roadLength = dimension * 4; // approximate perimeter + internal roads
    const greenSpace = areaHectares * 0.2; // 20% green space (typical urban planning)
    
    return {
      totalArea: dimension * dimension,
      areaHectares,
      estimatedBuildings,
      buildingsPerHectare,
      averageSpacing,
      roadLength,
      greenSpaceHectares: greenSpace,
      populationDensity: this.estimatePopulationDensity(settlementType),
      walkability: this.calculateWalkability(averageSpacing, roadLength / dimension)
    };
  }

  /**
   * Estimate population density from real-world data
   */
  estimatePopulationDensity(settlementType) {
    const densities = {
      megalopolis: 15000, // people per km²
      metropolis: 10000,
      city: 5000,
      town: 1500,
      village: 300,
      hamlet: 100,
      isolated_dwelling: 10
    };
    
    return densities[settlementType] || 1000;
  }

  /**
   * Calculate walkability score (0-100)
   */
  calculateWalkability(spacing, roadDensity) {
    // Lower spacing = more walkable
    // Higher road density = more walkable
    const spacingScore = Math.max(0, 100 - (spacing - 20) * 2);
    const densityScore = Math.min(100, roadDensity * 10);
    
    return Math.round((spacingScore + densityScore) / 2);
  }

  /**
   * Apply real-world patterns to element positioning
   */
  applyRealWorldPatterns(elements, recommendations) {
    console.log('🗺️ Applying real-world patterns to', elements.length, 'element types');
    
    const { urbanPattern, buildingDensity, roadNetwork, vegetationPattern, spatialMetrics } = recommendations;
    
    // Adjust element quantities based on real-world data
    const enhancedElements = elements.map(element => {
      const enhanced = { ...element };
      
      if (element.category === 'residential' || element.category === 'commercial' || element.category === 'institutional') {
        // Adjust building quantity based on density
        enhanced.quantity = this.calculateBuildingQuantity(
          element,
          buildingDensity,
          spatialMetrics.areaHectares
        );
        
        // Adjust spacing based on urban pattern
        if (urbanPattern) {
          enhanced.placement = {
            ...enhanced.placement,
            spacing: urbanPattern.buildingSpacing,
            clustering: this.determineClusteringFromDensity(buildingDensity.buildingsPerHectare)
          };
        }
        
        // Adjust dimensions based on real-world data
        if (buildingDensity) {
          const [minHeight, maxHeight] = buildingDensity.heightRange;
          enhanced.dimensions = {
            ...enhanced.dimensions,
            height: this.seededRandom(minHeight, maxHeight)
          };
        }
      }
      
      if (element.category === 'flora') {
        // Adjust vegetation based on pattern
        if (vegetationPattern) {
          enhanced.quantity = this.calculateVegetationQuantity(
            vegetationPattern,
            spatialMetrics.greenSpaceHectares
          );
          enhanced.placement = {
            ...enhanced.placement,
            spacing: vegetationPattern.tree_spacing.min,
            clustering: vegetationPattern.cluster_size === 'continuous' ? 'dense' : 'moderate'
          };
        }
      }
      
      if (element.category === 'infrastructure' && element.subcategory?.includes('road')) {
        // Adjust roads based on network pattern
        if (roadNetwork) {
          enhanced.quantity = this.calculateRoadQuantity(roadNetwork, spatialMetrics.areaHectares);
        }
      }
      
      return enhanced;
    });
    
    console.log('✅ Applied real-world patterns');
    return enhancedElements;
  }

  /**
   * Calculate realistic building quantity
   */
  calculateBuildingQuantity(element, density, areaHectares) {
    const baseQuantity = Math.round(areaHectares * density.buildingsPerHectare * 0.3);
    const variation = Math.round(baseQuantity * 0.3);
    return Math.max(1, baseQuantity + this.seededRandom(-variation, variation));
  }

  /**
   * Calculate vegetation quantity based on real-world patterns
   */
  calculateVegetationQuantity(pattern, greenSpaceHectares) {
    const treesPerHectare = pattern.tree_density;
    return Math.max(5, Math.round(greenSpaceHectares * treesPerHectare));
  }

  /**
   * Calculate road quantity based on network pattern
   */
  calculateRoadQuantity(network, areaHectares) {
    // Based on typical road density (km of road per km²)
    const roadDensity = 8; // km per km²
    const areaKm2 = areaHectares / 100;
    const totalRoadLength = areaKm2 * roadDensity;
    const avgRoadSegment = 0.1; // 100m segments
    return Math.max(5, Math.round(totalRoadLength / avgRoadSegment));
  }

  /**
   * Determine clustering from density
   */
  determineClusteringFromDensity(buildingsPerHectare) {
    if (buildingsPerHectare > 50) return 'dense';
    if (buildingsPerHectare > 20) return 'moderate';
    return 'sparse';
  }

  /**
   * Seeded random for consistency
   */
  seededRandom(min, max) {
    return min + Math.random() * (max - min);
  }
}

module.exports = new RealWorldDataService();
