/**
 * Taxonomy System - Comprehensive classification system for 3D scene elements
 * Provides structured categories for settlements, environments, buildings, infrastructure, 
 * transportation, and demographics
 */

class TaxonomySystem {
  constructor() {
    this.taxonomy = this.initializeTaxonomy();
  }

  initializeTaxonomy() {
    return {
      // Settlement Types
      settlements: {
        isolated_dwelling: {
          name: 'Isolated Dwelling',
          scale: 'micro',
          population: '1-5',
          elements: ['single_house', 'garden', 'path'],
          spacing: { min: 100, max: 500 }
        },
        hamlet: {
          name: 'Hamlet',
          scale: 'tiny',
          population: '5-50',
          elements: ['houses', 'dirt_roads', 'small_farm'],
          spacing: { min: 50, max: 200 }
        },
        village: {
          name: 'Village',
          scale: 'small',
          population: '50-1000',
          elements: ['houses', 'shops', 'church', 'school', 'roads', 'farms'],
          spacing: { min: 20, max: 100 }
        },
        town: {
          name: 'Town',
          scale: 'medium',
          population: '1000-20000',
          elements: ['buildings', 'commercial', 'residential', 'streets', 'parks'],
          spacing: { min: 10, max: 50 }
        },
        city: {
          name: 'City',
          scale: 'large',
          population: '20000-500000',
          elements: ['skyscrapers', 'apartments', 'commercial', 'highways', 'infrastructure'],
          spacing: { min: 5, max: 30 }
        },
        metropolis: {
          name: 'Metropolis',
          scale: 'very_large',
          population: '500000-5000000',
          elements: ['high_rises', 'mixed_use', 'transit', 'dense_infrastructure'],
          spacing: { min: 3, max: 20 }
        },
        megalopolis: {
          name: 'Megalopolis',
          scale: 'massive',
          population: '5000000+',
          elements: ['mega_structures', 'interconnected_cities', 'advanced_transit'],
          spacing: { min: 2, max: 15 }
        },
        conurbation: {
          name: 'Conurbation',
          scale: 'merged',
          population: 'variable',
          elements: ['merged_cities', 'continuous_urban', 'regional_infrastructure'],
          spacing: { min: 2, max: 25 }
        }
      },

      // Social Zones
      social_zones: {
        urban_core: { density: 'very_high', building_height: 'tall', mixed_use: true },
        suburban: { density: 'medium', building_height: 'low', residential_focus: true },
        exurban: { density: 'low', building_height: 'very_low', rural_transition: true },
        rural: { density: 'very_low', building_height: 'minimal', agricultural: true },
        gated_community: { density: 'controlled', building_height: 'low', exclusive: true },
        hinterland: { density: 'sparse', building_height: 'rare', undeveloped: true }
      },

      // Functional Areas
      functional_areas: {
        cbd: { name: 'Central Business District', buildings: ['office', 'skyscraper'], density: 'very_high' },
        industrial_park: { name: 'Industrial Park', buildings: ['factory', 'warehouse'], spacing: 'wide' },
        business_park: { name: 'Business Park', buildings: ['office', 'tech'], landscaping: 'high' },
        sez: { name: 'Special Economic Zone', buildings: ['manufacturing', 'logistics'], infrastructure: 'heavy' },
        agricultural_zone: { name: 'Agricultural Zone', structures: ['barn', 'silo', 'farmhouse'], open_space: true },
        port_authority: { name: 'Port Authority', structures: ['dock', 'warehouse', 'crane'], water_access: true }
      },

      // Natural Environments - Landforms
      landforms: {
        mountain: { height: 'very_high', slope: 'steep', terrain: 'rocky', scale: { height: [500, 2000], spread: [100, 500] } },
        hill: { height: 'medium', slope: 'moderate', terrain: 'varied', scale: { height: [20, 200], spread: [50, 200] } },
        valley: { height: 'low', slope: 'gentle', terrain: 'flat_center', scale: { depth: [50, 300], width: [100, 500] } },
        canyon: { height: 'deep', slope: 'vertical', terrain: 'rocky', scale: { depth: [100, 500], width: [50, 200] } },
        plain: { height: 'flat', slope: 'minimal', terrain: 'grass', scale: { area: [200, 1000] } },
        plateau: { height: 'elevated', slope: 'flat_top', terrain: 'mixed', scale: { height: [100, 500], area: [100, 500] } },
        desert: { height: 'varied', slope: 'dunes', terrain: 'sand', scale: { area: [200, 1000] } },
        beach: { height: 'flat', slope: 'gentle', terrain: 'sand', scale: { length: [100, 500], width: [20, 50] } },
        coastline: { height: 'varied', slope: 'moderate', terrain: 'rocky', scale: { length: [200, 1000] } },
        cliff: { height: 'high', slope: 'vertical', terrain: 'rock', scale: { height: [50, 300], length: [50, 200] } },
        cave: { height: 'enclosed', slope: 'interior', terrain: 'rock', scale: { depth: [10, 100], width: [5, 50] } },
        volcano: { height: 'very_high', slope: 'steep', terrain: 'volcanic', scale: { height: [300, 1500], crater: [50, 200] } },
        island: { height: 'varied', slope: 'coastal', terrain: 'mixed', scale: { area: [50, 500] } },
        peninsula: { height: 'varied', slope: 'coastal', terrain: 'mixed', scale: { length: [100, 500], width: [50, 200] } }
      },

      // Water Bodies
      water_bodies: {
        ocean: { size: 'massive', depth: 'very_deep', movement: 'waves', scale: { area: [500, 2000] } },
        sea: { size: 'large', depth: 'deep', movement: 'waves', scale: { area: [300, 1000] } },
        river: { size: 'linear', depth: 'varied', movement: 'flow', scale: { length: [200, 1000], width: [5, 50] } },
        lake: { size: 'medium', depth: 'moderate', movement: 'calm', scale: { area: [50, 300] } },
        pond: { size: 'small', depth: 'shallow', movement: 'still', scale: { area: [5, 30] } },
        stream: { size: 'tiny', depth: 'shallow', movement: 'flow', scale: { length: [50, 300], width: [1, 5] } },
        bay: { size: 'medium', depth: 'varied', movement: 'moderate', scale: { area: [100, 500] } },
        gulf: { size: 'large', depth: 'deep', movement: 'waves', scale: { area: [200, 800] } },
        glacier: { size: 'large', depth: 'solid', movement: 'slow', scale: { area: [100, 500] } },
        wetland: { size: 'varied', depth: 'shallow', movement: 'still', scale: { area: [20, 200] } },
        waterfall: { size: 'vertical', depth: 'drop', movement: 'cascade', scale: { height: [10, 200], width: [5, 100] } }
      },

      // Flora
      flora: {
        trees: {
          deciduous: { height: [8, 25], spread: [5, 15], seasons: true, examples: ['oak', 'maple', 'birch'] },
          coniferous: { height: [10, 40], spread: [3, 8], evergreen: true, examples: ['pine', 'fir', 'spruce'] },
          palm: { height: [8, 30], spread: [2, 5], tropical: true, examples: ['coconut', 'date', 'royal'] }
        },
        shrubs: { height: [0.5, 3], spread: [0.5, 2], density: 'medium' },
        grass: { height: [0.05, 0.5], spread: 'ground_cover', density: 'high' },
        flowers: { height: [0.1, 1], spread: [0.1, 0.5], seasonal: true },
        moss: { height: [0.01, 0.05], spread: 'surface_cover', moisture: true }
      },

      // Fauna (for scene context, not actual models)
      fauna: {
        mammals: { scale: 'varied', habitat: ['land', 'water'], movement: 'walk' },
        birds: { scale: 'small_to_medium', habitat: ['air', 'trees'], movement: 'fly' },
        insects: { scale: 'tiny', habitat: 'varied', movement: 'fly' },
        fish: { scale: 'varied', habitat: 'water', movement: 'swim' },
        reptiles: { scale: 'small_to_large', habitat: ['land', 'water'], movement: 'crawl' },
        amphibians: { scale: 'small', habitat: ['land', 'water'], movement: 'hop' }
      },

      // Built Environment - Residential
      residential: {
        house: { 
          stories: [1, 2], 
          footprint: { width: [8, 15], depth: [10, 20] }, 
          height_per_floor: 3,
          features: ['windows', 'doors', 'roof', 'chimney'],
          materials: ['wood', 'brick', 'concrete']
        },
        apartment: { 
          stories: [3, 8], 
          footprint: { width: [15, 30], depth: [20, 40] }, 
          height_per_floor: 3,
          features: ['balconies', 'windows', 'entrance_lobby'],
          materials: ['concrete', 'brick', 'glass']
        },
        townhouse: { 
          stories: [2, 4], 
          footprint: { width: [5, 8], depth: [12, 20] }, 
          height_per_floor: 3,
          features: ['row_housing', 'individual_entrance', 'small_yard'],
          materials: ['brick', 'wood', 'stone']
        },
        mansion: { 
          stories: [2, 4], 
          footprint: { width: [20, 50], depth: [25, 60] }, 
          height_per_floor: 4,
          features: ['columns', 'grand_entrance', 'wings', 'gardens'],
          materials: ['stone', 'marble', 'high_end']
        }
      },

      // Built Environment - Commercial
      commercial: {
        office_building: { 
          stories: [3, 20], 
          footprint: { width: [20, 50], depth: [25, 60] }, 
          height_per_floor: 3.5,
          features: ['curtain_walls', 'lobby', 'elevator_core'],
          materials: ['glass', 'steel', 'concrete']
        },
        skyscraper: { 
          stories: [20, 100], 
          footprint: { width: [30, 60], depth: [30, 70] }, 
          height_per_floor: 3.5,
          features: ['high_rise', 'modern_facade', 'observation_deck'],
          materials: ['glass', 'steel', 'aluminum']
        },
        retail_store: { 
          stories: [1, 2], 
          footprint: { width: [10, 25], depth: [15, 40] }, 
          height_per_floor: 4,
          features: ['storefront', 'display_windows', 'signage'],
          materials: ['glass', 'metal', 'concrete']
        },
        mall: { 
          stories: [1, 3], 
          footprint: { width: [80, 200], depth: [100, 250] }, 
          height_per_floor: 5,
          features: ['multiple_stores', 'atrium', 'parking'],
          materials: ['steel', 'glass', 'concrete']
        },
        restaurant: { 
          stories: [1, 2], 
          footprint: { width: [8, 20], depth: [10, 25] }, 
          height_per_floor: 3.5,
          features: ['dining_area', 'kitchen', 'outdoor_seating'],
          materials: ['varied']
        },
        hotel: { 
          stories: [3, 30], 
          footprint: { width: [25, 60], depth: [30, 80] }, 
          height_per_floor: 3,
          features: ['rooms', 'lobby', 'amenities'],
          materials: ['glass', 'concrete', 'stone']
        },
        bank: { 
          stories: [1, 10], 
          footprint: { width: [15, 40], depth: [20, 50] }, 
          height_per_floor: 4,
          features: ['vault', 'teller_area', 'secure_entrance'],
          materials: ['stone', 'concrete', 'glass']
        }
      },

      // Built Environment - Industrial
      industrial: {
        factory: { 
          stories: [1, 3], 
          footprint: { width: [40, 100], depth: [50, 150] }, 
          height_per_floor: 6,
          features: ['production_lines', 'loading_docks', 'smokestacks'],
          materials: ['steel', 'concrete', 'corrugated_metal']
        },
        warehouse: { 
          stories: [1, 2], 
          footprint: { width: [30, 80], depth: [40, 120] }, 
          height_per_floor: 8,
          features: ['large_doors', 'loading_bays', 'storage_racks'],
          materials: ['steel', 'concrete', 'metal_siding']
        },
        power_plant: { 
          stories: [1, 5], 
          footprint: { width: [50, 150], depth: [60, 200] }, 
          height_per_floor: 10,
          features: ['cooling_towers', 'turbines', 'control_room'],
          materials: ['concrete', 'steel', 'industrial']
        }
      },

      // Built Environment - Institutional
      institutional: {
        school: { 
          stories: [1, 4], 
          footprint: { width: [40, 100], depth: [50, 120] }, 
          height_per_floor: 3.5,
          features: ['classrooms', 'playground', 'gymnasium'],
          materials: ['brick', 'concrete', 'glass']
        },
        hospital: { 
          stories: [3, 15], 
          footprint: { width: [50, 120], depth: [60, 150] }, 
          height_per_floor: 4,
          features: ['emergency', 'patient_rooms', 'operating_rooms'],
          materials: ['concrete', 'glass', 'medical_grade']
        },
        library: { 
          stories: [1, 5], 
          footprint: { width: [20, 60], depth: [25, 80] }, 
          height_per_floor: 4,
          features: ['reading_rooms', 'stacks', 'study_areas'],
          materials: ['brick', 'stone', 'glass']
        },
        museum: { 
          stories: [1, 4], 
          footprint: { width: [30, 100], depth: [40, 120] }, 
          height_per_floor: 5,
          features: ['galleries', 'atrium', 'exhibition_halls'],
          materials: ['stone', 'glass', 'concrete']
        },
        government_building: { 
          stories: [2, 10], 
          footprint: { width: [40, 100], depth: [50, 120] }, 
          height_per_floor: 4.5,
          features: ['offices', 'chambers', 'security'],
          materials: ['stone', 'marble', 'concrete']
        },
        place_of_worship: { 
          stories: [1, 3], 
          footprint: { width: [15, 50], depth: [20, 80] }, 
          height_per_floor: 6,
          features: ['sanctuary', 'tower', 'dome'],
          materials: ['stone', 'wood', 'traditional']
        },
        stadium: { 
          stories: [1, 5], 
          footprint: { width: [100, 250], depth: [120, 300] }, 
          height_per_floor: 8,
          features: ['seating', 'field', 'concessions'],
          materials: ['concrete', 'steel', 'fabric']
        },
        airport: { 
          stories: [1, 3], 
          footprint: { width: [200, 500], depth: [150, 400] }, 
          height_per_floor: 10,
          features: ['terminals', 'runways', 'control_tower'],
          materials: ['steel', 'glass', 'concrete']
        },
        train_station: { 
          stories: [1, 3], 
          footprint: { width: [50, 150], depth: [80, 250] }, 
          height_per_floor: 8,
          features: ['platforms', 'concourse', 'tracks'],
          materials: ['steel', 'glass', 'brick']
        }
      },

      // Infrastructure
      infrastructure: {
        roads: {
          highway: { width: [20, 40], lanes: [4, 8], speed: 'high', surface: 'asphalt' },
          street: { width: [8, 15], lanes: [2, 4], speed: 'medium', surface: 'asphalt' },
          road: { width: [6, 12], lanes: [2, 3], speed: 'medium', surface: 'asphalt' },
          avenue: { width: [12, 20], lanes: [3, 6], speed: 'medium', surface: 'asphalt', landscaping: true },
          lane: { width: [3, 6], lanes: [1, 2], speed: 'low', surface: 'asphalt' },
          sidewalk: { width: [1.5, 3], pedestrian: true, surface: 'concrete' },
          path: { width: [1, 2], pedestrian: true, surface: 'gravel' }
        },
        structures: {
          bridge: { span: [10, 500], types: ['arch', 'suspension', 'beam'], materials: ['steel', 'concrete'] },
          tunnel: { length: [50, 5000], diameter: [5, 20], materials: ['concrete', 'steel'] },
          fence: { height: [1, 3], length: 'variable', materials: ['wood', 'metal', 'chain_link'] },
          dam: { height: [10, 200], length: [50, 500], materials: ['concrete', 'earth'] }
        },
        utilities: {
          power_lines: { height: [5, 50], span: [50, 500] },
          traffic_lights: { height: [4, 6], placement: 'intersection' },
          street_lights: { height: [5, 12], spacing: [20, 50] }
        },
        public_spaces: {
          park: { size: [20, 200], features: ['grass', 'trees', 'paths'] },
          playground: { size: [10, 50], features: ['equipment', 'safety_surface'] }
        }
      },

      // Transportation - Land
      land_vehicles: {
        bicycle: { length: 1.8, width: 0.6, height: 1.1, passengers: 1 },
        car: {
          sedan: { length: [4.5, 5.0], width: [1.7, 1.9], height: [1.4, 1.5], passengers: 5 },
          suv: { length: [4.6, 5.2], width: [1.8, 2.0], height: [1.6, 1.8], passengers: 7 },
          coupe: { length: [4.3, 4.8], width: [1.7, 1.9], height: [1.3, 1.4], passengers: 4 },
          convertible: { length: [4.2, 4.7], width: [1.7, 1.9], height: [1.3, 1.4], passengers: 4 },
          pickup: { length: [5.0, 6.0], width: [1.9, 2.1], height: [1.7, 1.9], passengers: 5 }
        },
        motorcycle: { length: 2.2, width: 0.8, height: 1.2, passengers: 2 },
        bus: { length: [10, 15], width: [2.5, 2.6], height: [3.0, 3.5], passengers: 50 },
        taxi: { length: [4.5, 5.0], width: [1.7, 1.9], height: [1.4, 1.5], passengers: 5 },
        train: {
          high_speed: { length: [200, 400], width: 3.0, height: 4.0, passengers: 500 },
          commuter: { length: [100, 200], width: 2.8, height: 3.8, passengers: 300 },
          subway: { length: [50, 150], width: 2.6, height: 3.2, passengers: 200 },
          tram: { length: [20, 40], width: 2.4, height: 3.0, passengers: 100 }
        },
        construction: {
          excavator: { length: 8, width: 3, height: 4 },
          bulldozer: { length: 6, width: 4, height: 3.5 },
          crane: { base: [5, 5], height: [20, 100] }
        },
        emergency: {
          ambulance: { length: 5.5, width: 2.3, height: 2.8 },
          fire_truck: { length: 9, width: 2.5, height: 3.5 },
          police_car: { length: 5.0, width: 1.9, height: 1.5 }
        },
        military: {
          tank: { length: 8, width: 3.5, height: 2.5 },
          apc: { length: 6, width: 2.8, height: 2.2 }
        }
      },

      // Transportation - Water
      water_vehicles: {
        boat: { length: [5, 10], width: [2, 4], draft: [0.5, 1] },
        yacht: { length: [15, 50], width: [4, 10], draft: [1, 3] },
        sailboat: { length: [8, 20], width: [3, 6], draft: [1, 2.5] },
        cargo_ship: { length: [100, 400], width: [20, 60], draft: [8, 15] },
        cruise_ship: { length: [200, 350], width: [30, 50], height: [50, 70] },
        ferry: { length: [50, 150], width: [15, 30], draft: [3, 6] },
        tugboat: { length: [15, 30], width: [8, 12], draft: [3, 5] },
        submarine: { length: [50, 150], width: [10, 15], depth_capability: [200, 600] }
      },

      // Transportation - Air
      air_vehicles: {
        airplane: {
          small: { length: 8, wingspan: 10, height: 3 },
          commercial: { length: [35, 75], wingspan: [35, 80], height: [10, 20] },
          jumbo: { length: [70, 80], wingspan: [60, 80], height: [20, 25] }
        },
        helicopter: { length: [12, 20], rotor_diameter: [10, 20], height: [4, 6] },
        drone: { size: [0.3, 2], rotor_count: [4, 8] },
        hot_air_balloon: { diameter: [15, 30], height_with_basket: [20, 40] }
      },

      // Transportation - Space
      space_vehicles: {
        rocket: { length: [50, 120], diameter: [5, 10], stages: [2, 3] },
        spacecraft: { length: [10, 50], width: [5, 20], modules: 'variable' },
        satellite: { size: [1, 10], solar_panels: true },
        rover: { length: [2, 5], width: [1.5, 3], height: [1, 2] }
      },

      // Demographics (for scene context)
      demographics: {
        diversity: {
          gender: ['male', 'female', 'non_binary'],
          age: ['child', 'teen', 'adult', 'elderly'],
          ability: ['able_bodied', 'wheelchair', 'mobility_aids'],
          representation: 'inclusive'
        }
      }
    };
  }

  /**
   * Find taxonomy category from keywords
   */
  findCategory(keywords) {
    const results = [];
    
    for (const [category, items] of Object.entries(this.taxonomy)) {
      for (const [key, value] of Object.entries(items)) {
        if (keywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()) || 
                              (value.name && value.name.toLowerCase().includes(kw.toLowerCase())))) {
          results.push({
            category,
            subcategory: key,
            data: value
          });
        }
      }
    }
    
    return results;
  }

  /**
   * Get complete taxonomy as JSON for AI prompts
   */
  getTaxonomyForAI() {
    return JSON.stringify(this.taxonomy, null, 2);
  }

  /**
   * Get category definition
   */
  getCategory(category) {
    return this.taxonomy[category] || null;
  }

  /**
   * Get subcategory definition
   */
  getSubcategory(category, subcategory) {
    return this.taxonomy[category]?.[subcategory] || null;
  }

  /**
   * Extract scale information for placement
   */
  getScale(category, subcategory) {
    const data = this.getSubcategory(category, subcategory);
    if (!data) return null;

    // Extract scale information from various formats
    if (data.scale) return data.scale;
    if (data.footprint) return data.footprint;
    if (data.length) return { length: data.length, width: data.width, height: data.height };
    if (data.size) return { size: data.size };
    
    return null;
  }
}

module.exports = new TaxonomySystem();
