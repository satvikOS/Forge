/**
 * Flaw Simulator - Wear and defect replication
 * Simulates realistic aging, weathering, and damage patterns
 */

class FlawSimulator {
  constructor() {
    this.wearPatterns = this.initializeWearPatterns();
    this.weatheringModels = this.initializeWeatheringModels();
  }

  /**
   * Replicate wear patterns based on age and usage
   */
  async replicateWear(geometry, age = 0) {
    const startTime = Date.now();
    
    // Calculate general wear
    const wear = this.calculateWear(age);
    
    // Generate scratches
    const scratches = this.generateScratches(age);
    
    // Simulate weathering
    const weathering = this.simulateWeathering(age);
    
    // Generate structural damage
    const damage = this.generateDamage(age);
    
    const processingTime = Date.now() - startTime;
    
    return {
      wear,
      scratches,
      weathering,
      damage,
      ageYears: age,
      processingTime
    };
  }

  /**
   * Calculate overall wear severity
   */
  calculateWear(age) {
    const severity = Math.min(age * 0.01, 1.0);
    
    let wearType = 'minimal';
    if (age > 100) wearType = 'heavy';
    else if (age > 50) wearType = 'moderate';
    else if (age > 20) wearType = 'light';
    
    return {
      severity,
      type: wearType,
      areas: this.identifyWearAreas(age),
      progression: this.calculateWearProgression(age),
      factors: this.identifyWearFactors(age)
    };
  }

  /**
   * Identify high-wear areas
   */
  identifyWearAreas(age) {
    const areas = ['exposed-surfaces'];
    
    if (age > 10) areas.push('high-traffic');
    if (age > 30) areas.push('joints');
    if (age > 50) areas.push('load-bearing');
    if (age > 80) areas.push('structural');
    
    return areas;
  }

  /**
   * Calculate wear progression over time
   */
  calculateWearProgression(age) {
    return {
      initial: Math.min(age * 0.005, 0.1),
      current: Math.min(age * 0.01, 1.0),
      projected: Math.min(age * 0.015, 1.2),
      rate: 0.01 // per year
    };
  }

  /**
   * Identify wear factors
   */
  identifyWearFactors(age) {
    const factors = ['time'];
    
    if (age > 5) factors.push('environmental_exposure');
    if (age > 20) factors.push('material_fatigue');
    if (age > 50) factors.push('structural_stress');
    
    return factors;
  }

  /**
   * Generate surface scratches
   */
  generateScratches(age) {
    const scratchCount = Math.min(Math.floor(age * 10), 1000);
    const scratches = [];
    
    for (let i = 0; i < scratchCount; i++) {
      scratches.push({
        id: i,
        depth: Math.random() * 0.5 * (age / 100), // mm, deeper with age
        length: Math.random() * 100 + 10,          // mm
        width: Math.random() * 0.1,                // mm
        location: this.randomLocation(),
        orientation: Math.random() * 360,          // degrees
        severity: age > 50 ? 'deep' : age > 20 ? 'moderate' : 'superficial'
      });
    }
    
    return {
      count: scratchCount,
      scratches: scratches.slice(0, 100), // Return sample for performance
      distribution: 'random_with_hotspots',
      density: scratchCount / 1000 // per m²
    };
  }

  /**
   * Simulate weathering effects
   */
  simulateWeathering(age) {
    return {
      oxidation: this.calculateOxidation(age),
      corrosion: this.calculateCorrosion(age),
      patina: this.calculatePatina(age),
      uvDamage: this.calculateUVDamage(age),
      waterDamage: this.calculateWaterDamage(age),
      biologicalGrowth: this.calculateBiologicalGrowth(age)
    };
  }

  /**
   * Calculate oxidation level
   */
  calculateOxidation(age) {
    if (age > 50) return { level: 'heavy', coverage: 0.8, type: 'rust' };
    if (age > 20) return { level: 'moderate', coverage: 0.5, type: 'rust' };
    if (age > 10) return { level: 'light', coverage: 0.2, type: 'surface_rust' };
    return { level: 'minimal', coverage: 0.05, type: 'oxidation' };
  }

  /**
   * Calculate corrosion level
   */
  calculateCorrosion(age) {
    if (age > 80) return { level: 'advanced', depth: 5, type: 'pitting' };
    if (age > 50) return { level: 'moderate', depth: 2, type: 'uniform' };
    if (age > 30) return { level: 'early', depth: 0.5, type: 'surface' };
    return { level: 'none', depth: 0, type: 'none' };
  }

  /**
   * Calculate patina development
   */
  calculatePatina(age) {
    if (age > 50) return { level: 'mature', color: 'dark_brown', thickness: 0.1 };
    if (age > 20) return { level: 'developed', color: 'brown', thickness: 0.05 };
    if (age > 10) return { level: 'forming', color: 'light_brown', thickness: 0.02 };
    return { level: 'none', color: 'none', thickness: 0 };
  }

  /**
   * Calculate UV damage
   */
  calculateUVDamage(age) {
    if (age > 30) return { level: 'severe', fading: 0.6, brittleness: 0.7 };
    if (age > 15) return { level: 'visible', fading: 0.3, brittleness: 0.4 };
    if (age > 5) return { level: 'minor', fading: 0.1, brittleness: 0.1 };
    return { level: 'none', fading: 0, brittleness: 0 };
  }

  /**
   * Calculate water damage
   */
  calculateWaterDamage(age) {
    if (age > 40) return { level: 'significant', staining: 0.6, erosion: 0.4 };
    if (age > 20) return { level: 'moderate', staining: 0.3, erosion: 0.2 };
    if (age > 10) return { level: 'minor', staining: 0.1, erosion: 0.05 };
    return { level: 'none', staining: 0, erosion: 0 };
  }

  /**
   * Calculate biological growth
   */
  calculateBiologicalGrowth(age) {
    if (age > 50) return { level: 'extensive', types: ['moss', 'lichen', 'algae'], coverage: 0.3 };
    if (age > 30) return { level: 'moderate', types: ['moss', 'algae'], coverage: 0.15 };
    if (age > 15) return { level: 'minor', types: ['algae'], coverage: 0.05 };
    return { level: 'none', types: [], coverage: 0 };
  }

  /**
   * Generate structural damage
   */
  generateDamage(age) {
    const damages = [];
    
    // More damage with age
    if (age > 30) {
      damages.push({
        type: 'crack',
        severity: age > 70 ? 'severe' : 'moderate',
        location: this.randomLocation(),
        length: Math.random() * 500 + 50, // mm
        width: Math.random() * 5 + 1      // mm
      });
    }
    
    if (age > 50) {
      damages.push({
        type: 'deformation',
        severity: age > 90 ? 'severe' : 'moderate',
        location: this.randomLocation(),
        displacement: Math.random() * 50 + 10 // mm
      });
    }
    
    if (age > 80) {
      damages.push({
        type: 'material_loss',
        severity: 'severe',
        location: this.randomLocation(),
        volume: Math.random() * 1000 // mm³
      });
    }
    
    return {
      count: damages.length,
      damages,
      overallCondition: this.assessCondition(age),
      requiresRepair: age > 50
    };
  }

  /**
   * Assess overall structural condition
   */
  assessCondition(age) {
    if (age > 100) return 'critical';
    if (age > 70) return 'poor';
    if (age > 40) return 'fair';
    if (age > 20) return 'good';
    return 'excellent';
  }

  /**
   * Generate random location
   */
  randomLocation() {
    const locations = ['top', 'bottom', 'left', 'right', 'front', 'back', 'corner', 'edge', 'center'];
    return locations[Math.floor(Math.random() * locations.length)];
  }

  /**
   * Initialize wear pattern database
   */
  initializeWearPatterns() {
    return {
      'mechanical': ['abrasion', 'impact', 'fatigue'],
      'environmental': ['corrosion', 'weathering', 'UV'],
      'biological': ['growth', 'staining', 'decay']
    };
  }

  /**
   * Initialize weathering models
   */
  initializeWeatheringModels() {
    return {
      'coastal': { corrosion_factor: 1.5, salt_exposure: true },
      'urban': { pollution_factor: 1.3, acid_rain: true },
      'rural': { biological_factor: 1.2, clean_air: true }
    };
  }
}

module.exports = FlawSimulator;
