/**
 * Tooling Analyzer - Period-correct tooling marks
 * Analyzes and generates era-appropriate manufacturing signatures
 */

class ToolingAnalyzer {
  constructor() {
    this.manufacturingMethods = this.initializeManufacturingMethods();
    this.toolingDatabase = this.initializeToolingDatabase();
  }

  /**
   * Analyze and generate period-correct tooling marks
   */
  async analyzeToolingMarks(references, era = 'modern') {
    const startTime = Date.now();
    
    // Determine manufacturing method based on era
    const method = this.determineManufacturingMethod(era);
    
    // Generate appropriate tool marks
    const toolMarks = this.generateToolMarks(era, method);
    
    // Calculate surface finish
    const surfaceFinish = this.calculateSurfaceFinish(method);
    
    // Get historical context
    const historicalContext = this.getHistoricalContext(era);
    
    const processingTime = Date.now() - startTime;
    
    return {
      era,
      method,
      toolMarks,
      surfaceFinish,
      historicalContext,
      processingTime
    };
  }

  /**
   * Determine manufacturing method based on era
   */
  determineManufacturingMethod(era) {
    const methods = {
      'prehistoric': 'hand-carved',
      'ancient': 'hand-forged',
      'medieval': 'hand-crafted',
      'renaissance': 'artisan-crafted',
      'industrial_revolution': 'early-machine',
      'industrial': 'machine-made',
      'modern': 'cnc-machined',
      'contemporary': 'advanced-manufacturing',
      '3d-printed': '3d-printed'
    };
    
    // Normalize era string
    const normalizedEra = era.toLowerCase().replace(/\s+/g, '_');
    
    return methods[normalizedEra] || methods['modern'];
  }

  /**
   * Generate tool marks based on era and method
   */
  generateToolMarks(era, method) {
    const patterns = {
      'hand-forged': {
        type: 'hammer-marks',
        density: 'high',
        irregularity: 'significant',
        pattern: 'random',
        depth: 0.5, // mm
        spacing: 20, // mm
        characteristics: ['uneven', 'textured', 'organic']
      },
      'hand-crafted': {
        type: 'chisel-marks',
        density: 'medium',
        irregularity: 'moderate',
        pattern: 'directional',
        depth: 0.3,
        spacing: 10,
        characteristics: ['linear', 'deliberate', 'skilled']
      },
      'early-machine': {
        type: 'mill-marks',
        density: 'medium',
        irregularity: 'low',
        pattern: 'parallel',
        depth: 0.1,
        spacing: 5,
        characteristics: ['regular', 'linear', 'mechanical']
      },
      'cnc-machined': {
        type: 'tool-paths',
        density: 'uniform',
        irregularity: 'minimal',
        pattern: 'programmed',
        depth: 0.01,
        spacing: 0.5,
        characteristics: ['precise', 'uniform', 'calculated']
      },
      '3d-printed': {
        type: 'layer-lines',
        density: 'regular',
        irregularity: 'layer-based',
        pattern: 'horizontal',
        depth: 0.2,
        spacing: 0.2,
        characteristics: ['layered', 'stepped', 'digital']
      },
      'hand-carved': {
        type: 'carving-marks',
        density: 'high',
        irregularity: 'very_high',
        pattern: 'artistic',
        depth: 1.0,
        spacing: 15,
        characteristics: ['artistic', 'irregular', 'primitive']
      }
    };
    
    const pattern = patterns[method] || patterns['cnc-machined'];
    
    // Add era-specific details
    pattern.era = era;
    pattern.authenticity = this.calculateAuthenticity(era, method);
    
    return pattern;
  }

  /**
   * Calculate surface finish quality
   */
  calculateSurfaceFinish(method) {
    const finishQuality = {
      'hand-carved': {
        roughness: 6.3, // Ra in micrometers
        quality: 'rough',
        grade: 'N8',
        description: 'Rough carved surface'
      },
      'hand-forged': {
        roughness: 3.2,
        quality: 'rough',
        grade: 'N7',
        description: 'Forged with visible hammer marks'
      },
      'hand-crafted': {
        roughness: 1.6,
        quality: 'medium',
        grade: 'N6',
        description: 'Hand-finished with visible tool marks'
      },
      'early-machine': {
        roughness: 0.8,
        quality: 'good',
        grade: 'N5',
        description: 'Machine-made with visible mill marks'
      },
      'cnc-machined': {
        roughness: 0.4,
        quality: 'fine',
        grade: 'N4',
        description: 'CNC machined with minimal tool marks'
      },
      '3d-printed': {
        roughness: 0.8,
        quality: 'good',
        grade: 'N5',
        description: 'Additive manufactured with layer lines'
      },
      'advanced-manufacturing': {
        roughness: 0.2,
        quality: 'very_fine',
        grade: 'N3',
        description: 'Advanced manufacturing with polished finish'
      }
    };
    
    return finishQuality[method] || finishQuality['cnc-machined'];
  }

  /**
   * Calculate authenticity score
   */
  calculateAuthenticity(era, method) {
    // Check if method matches era
    const expectedMethods = this.getExpectedMethodsForEra(era);
    const matches = expectedMethods.includes(method);
    
    return {
      score: matches ? 0.95 : 0.7,
      matches: matches,
      confidence: matches ? 'high' : 'medium',
      notes: matches ? 'Method matches era' : 'Method anachronistic for era'
    };
  }

  /**
   * Get expected manufacturing methods for an era
   */
  getExpectedMethodsForEra(era) {
    const eraMethodMap = {
      'ancient': ['hand-carved', 'hand-forged'],
      'medieval': ['hand-crafted', 'hand-forged'],
      'industrial': ['early-machine', 'machine-made'],
      'modern': ['cnc-machined', 'machine-made'],
      'contemporary': ['cnc-machined', 'advanced-manufacturing', '3d-printed']
    };
    
    const normalizedEra = era.toLowerCase().replace(/\s+/g, '_');
    return eraMethodMap[normalizedEra] || ['cnc-machined'];
  }

  /**
   * Get historical manufacturing context
   */
  getHistoricalContext(era) {
    const contexts = {
      'ancient': {
        period: '3000 BCE - 500 CE',
        technologies: ['hand_tools', 'simple_machines', 'manual_labor'],
        materials: ['bronze', 'iron', 'stone', 'wood'],
        craftsmen: 'artisans',
        production_scale: 'individual'
      },
      'medieval': {
        period: '500 - 1500 CE',
        technologies: ['blacksmithing', 'carpentry', 'masonry'],
        materials: ['wrought_iron', 'wood', 'stone'],
        craftsmen: 'guild_members',
        production_scale: 'workshop'
      },
      'industrial': {
        period: '1760 - 1900',
        technologies: ['steam_power', 'machine_tools', 'mass_production'],
        materials: ['cast_iron', 'steel', 'brass'],
        craftsmen: 'factory_workers',
        production_scale: 'factory'
      },
      'modern': {
        period: '1900 - 2000',
        technologies: ['cnc_machining', 'welding', 'casting'],
        materials: ['steel', 'aluminum', 'concrete'],
        craftsmen: 'machinists',
        production_scale: 'industrial'
      },
      'contemporary': {
        period: '2000 - present',
        technologies: ['cnc', '3d_printing', 'robotics', 'laser_cutting'],
        materials: ['composites', 'alloys', 'polymers'],
        craftsmen: 'engineers',
        production_scale: 'automated'
      }
    };
    
    return contexts[era] || contexts['modern'];
  }

  /**
   * Initialize manufacturing methods database
   */
  initializeManufacturingMethods() {
    return {
      'hand': ['forging', 'carving', 'casting', 'joining'],
      'machine': ['milling', 'turning', 'grinding', 'drilling'],
      'advanced': ['cnc', '3d-printing', 'laser-cutting', 'water-jet']
    };
  }

  /**
   * Initialize tooling database
   */
  initializeToolingDatabase() {
    return {
      'hammer': { era: 'ancient', mark_type: 'impact', irregularity: 'high' },
      'chisel': { era: 'ancient', mark_type: 'cutting', irregularity: 'medium' },
      'mill': { era: 'industrial', mark_type: 'cutting', irregularity: 'low' },
      'cnc': { era: 'modern', mark_type: 'precision', irregularity: 'minimal' },
      '3d_printer': { era: 'contemporary', mark_type: 'additive', irregularity: 'layered' }
    };
  }
}

module.exports = ToolingAnalyzer;
