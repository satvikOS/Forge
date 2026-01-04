/**
 * Axel Voxel Engine Tests
 * Tests for all analyzer modules and the main voxel engine
 */

const AxelVoxelEngine = require('../engines/axel/voxelEngine');
const MetrologyAnalyzer = require('../engines/axel/metrologyAnalyzer');
const ChemicalAnalyzer = require('../engines/axel/chemicalAnalyzer');
const FlawSimulator = require('../engines/axel/flawSimulator');
const ToolingAnalyzer = require('../engines/axel/toolingAnalyzer');
const EnvironmentalComposer = require('../engines/axel/environmentalComposer');

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds

describe('Axel Voxel Engine Tests', () => {
  
  describe('Metrology Analyzer', () => {
    let analyzer;
    
    beforeEach(() => {
      analyzer = new MetrologyAnalyzer();
    });
    
    test('should capture actual shape', async () => {
      const result = await analyzer.captureActualShape(null);
      
      expect(result).toBeDefined();
      expect(result.accuracy).toBe('micron-level');
      expect(result.resolution).toBe(0.001);
      expect(result.pointCloud).toBeDefined();
      expect(result.pointCloud.count).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
    
    test('should generate point cloud', async () => {
      const pointCloud = await analyzer.generatePointCloud(null);
      
      expect(pointCloud.points).toBeDefined();
      expect(Array.isArray(pointCloud.points)).toBe(true);
      expect(pointCloud.format).toBe('XYZ');
      expect(pointCloud.density).toBe(1000000);
    }, TEST_TIMEOUT);
    
    test('should measure deviations', async () => {
      const deviations = await analyzer.measureDeviations(null);
      
      expect(deviations.tolerance).toBe(0.001);
      expect(deviations.maxDeviation).toBeDefined();
      expect(deviations.unit).toBe('mm');
    }, TEST_TIMEOUT);
  });
  
  describe('Chemical Analyzer', () => {
    let analyzer;
    
    beforeEach(() => {
      analyzer = new ChemicalAnalyzer();
    });
    
    test('should match composition', async () => {
      const result = await analyzer.matchComposition(null);
      
      expect(result).toBeDefined();
      expect(result.elements).toBeDefined();
      expect(result.properties).toBeDefined();
      expect(result.certifications).toBeDefined();
    }, TEST_TIMEOUT);
    
    test('should analyze wrought iron for historical structures', async () => {
      const references = { era: 1889, material: 'wrought iron' };
      const result = await analyzer.matchComposition(references);
      
      expect(result.elements.type).toBe('wrought_iron');
      expect(result.elements.iron).toBeGreaterThan(99);
      expect(result.elements.carbon).toBeLessThan(0.1);
    }, TEST_TIMEOUT);
    
    test('should get physical properties', async () => {
      const composition = { type: 'structural_steel' };
      const properties = await analyzer.getPhysicalProperties(composition);
      
      expect(properties.density).toBeDefined();
      expect(properties.tensileStrength).toBeDefined();
      expect(properties.elasticity).toBeDefined();
    }, TEST_TIMEOUT);
  });
  
  describe('Flaw Simulator', () => {
    let simulator;
    
    beforeEach(() => {
      simulator = new FlawSimulator();
    });
    
    test('should replicate wear patterns', async () => {
      const age = 50;
      const result = await simulator.replicateWear({}, age);
      
      expect(result).toBeDefined();
      expect(result.ageYears).toBe(age);
      expect(result.wear).toBeDefined();
      expect(result.scratches).toBeDefined();
      expect(result.weathering).toBeDefined();
    }, TEST_TIMEOUT);
    
    test('should calculate appropriate wear for age', () => {
      const youngWear = simulator.calculateWear(10);
      const oldWear = simulator.calculateWear(100);
      
      expect(youngWear.type).toBe('minimal');
      expect(oldWear.type).toBe('heavy');
      expect(oldWear.severity).toBeGreaterThan(youngWear.severity);
    });
    
    test('should generate more scratches for older structures', () => {
      const youngScratches = simulator.generateScratches(5);
      const oldScratches = simulator.generateScratches(100);
      
      expect(oldScratches.count).toBeGreaterThan(youngScratches.count);
    });
    
    test('should simulate weathering', async () => {
      const weathering = simulator.simulateWeathering(60);
      
      expect(weathering.oxidation).toBeDefined();
      expect(weathering.corrosion).toBeDefined();
      expect(weathering.patina).toBeDefined();
    });
  });
  
  describe('Tooling Analyzer', () => {
    let analyzer;
    
    beforeEach(() => {
      analyzer = new ToolingAnalyzer();
    });
    
    test('should analyze tooling marks', async () => {
      const result = await analyzer.analyzeToolingMarks(null, 'modern');
      
      expect(result).toBeDefined();
      expect(result.era).toBe('modern');
      expect(result.method).toBeDefined();
      expect(result.toolMarks).toBeDefined();
      expect(result.surfaceFinish).toBeDefined();
    }, TEST_TIMEOUT);
    
    test('should determine correct manufacturing method for era', () => {
      expect(analyzer.determineManufacturingMethod('ancient')).toBe('hand-forged');
      expect(analyzer.determineManufacturingMethod('industrial')).toBe('machine-made');
      expect(analyzer.determineManufacturingMethod('modern')).toBe('cnc-machined');
    });
    
    test('should generate era-appropriate tool marks', () => {
      const ancientMarks = analyzer.generateToolMarks('ancient', 'hand-forged');
      const modernMarks = analyzer.generateToolMarks('modern', 'cnc-machined');
      
      expect(ancientMarks.type).toBe('hammer-marks');
      expect(ancientMarks.irregularity).toBe('significant');
      expect(modernMarks.type).toBe('tool-paths');
      expect(modernMarks.irregularity).toBe('minimal');
    });
    
    test('should calculate surface finish quality', () => {
      const handForgedFinish = analyzer.calculateSurfaceFinish('hand-forged');
      const cncFinish = analyzer.calculateSurfaceFinish('cnc-machined');
      
      expect(handForgedFinish.quality).toBe('rough');
      expect(cncFinish.quality).toBe('fine');
      expect(cncFinish.roughness).toBeLessThan(handForgedFinish.roughness);
    });
  });
  
  describe('Environmental Composer', () => {
    let composer;
    
    beforeEach(() => {
      composer = new EnvironmentalComposer();
    });
    
    test('should compose environment', async () => {
      const result = await composer.composeEnvironment('Paris', 'clear', 'noon');
      
      expect(result).toBeDefined();
      expect(result.location).toBe('Paris');
      expect(result.weather).toBe('clear');
      expect(result.timeOfDay).toBe('noon');
      expect(result.lighting).toBeDefined();
      expect(result.atmosphere).toBeDefined();
      expect(result.climate).toBeDefined();
    }, TEST_TIMEOUT);
    
    test('should calculate lighting for different times', async () => {
      const noonLighting = await composer.calculateLighting(null, 'noon');
      const nightLighting = await composer.calculateLighting(null, 'night');
      
      expect(noonLighting.intensity).toBeGreaterThan(nightLighting.intensity);
      expect(noonLighting.colorTemperature).toBeGreaterThan(nightLighting.colorTemperature);
    }, TEST_TIMEOUT);
    
    test('should generate atmosphere for different weather', async () => {
      const clearAtmosphere = await composer.generateAtmosphere('clear', null);
      const foggyAtmosphere = await composer.generateAtmosphere('foggy', null);
      
      expect(foggyAtmosphere.fog).toBeGreaterThan(clearAtmosphere.fog);
      expect(foggyAtmosphere.visibility).toBeLessThan(clearAtmosphere.visibility);
    }, TEST_TIMEOUT);
    
    test('should get climate data', async () => {
      const climate = await composer.getClimateData('Paris');
      
      expect(climate.zone).toBeDefined();
      expect(climate.averageTemperature).toBeDefined();
      expect(climate.precipitation).toBeDefined();
    }, TEST_TIMEOUT);
  });
  
  describe('Axel Voxel Engine Integration', () => {
    let engine;
    
    beforeEach(() => {
      engine = new AxelVoxelEngine({
        enabled: true,
        resolution: 'adaptive',
        maxVoxels: 100000000
      });
    });
    
    test('should initialize correctly', () => {
      expect(engine).toBeDefined();
      expect(engine.isEnabled()).toBe(true);
      expect(engine.resolution).toBe('adaptive');
    });
    
    test('should have all analyzers initialized', () => {
      expect(engine.metrologyAnalyzer).toBeDefined();
      expect(engine.chemicalAnalyzer).toBeDefined();
      expect(engine.flawSimulator).toBeDefined();
      expect(engine.toolingAnalyzer).toBeDefined();
      expect(engine.environmentalComposer).toBeDefined();
    });
    
    test('should count active layers', () => {
      const count = engine.countActiveLayers();
      expect(count).toBe(5); // All layers enabled by default
    });
    
    test('should analyze and replicate', async () => {
      const aiData = {
        name: 'Test Structure',
        yearBuilt: 1900,
        style: 'industrial',
        location: 'Test Location'
      };
      
      const result = await engine.analyzeAndReplicate(aiData, null);
      
      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.voxelGrid).toBeDefined();
      expect(result.renderData).toBeDefined();
      expect(result.metadata.engine).toBe('Axel');
    }, TEST_TIMEOUT);
    
    test('should extract age correctly', () => {
      const aiData1 = { age: 50 };
      const aiData2 = { yearBuilt: 1900 };
      
      const age1 = engine.extractAge(aiData1);
      const age2 = engine.extractAge(aiData2);
      
      expect(age1).toBe(50);
      expect(age2).toBeGreaterThan(100); // Current year - 1900
    });
    
    test('should extract era correctly', () => {
      const ancient = engine.extractEra({ yearBuilt: 1000 });
      const modern = engine.extractEra({ yearBuilt: 1970 });
      const contemporary = engine.extractEra({ yearBuilt: 2020 });
      
      expect(ancient).toBe('ancient');
      expect(modern).toBe('modern');
      expect(contemporary).toBe('contemporary');
    });
    
    test('should generate voxel model', () => {
      const analysis = {
        geometry: { accuracy: 'micron-level' },
        materials: { elements: { type: 'steel' } },
        flaws: { wear: { type: 'moderate' } },
        tooling: { method: 'cnc-machined' },
        environment: { location: 'test' }
      };
      
      const voxelModel = engine.generateVoxelModel(analysis);
      
      expect(voxelModel).toBeDefined();
      expect(voxelModel.voxelGrid).toBeDefined();
      expect(voxelModel.metadata).toBeDefined();
      expect(voxelModel.renderData).toBeDefined();
      expect(voxelModel.lodLevels).toBeDefined();
    });
    
    test('should get engine status', () => {
      const status = engine.getStatus();
      
      expect(status.enabled).toBe(true);
      expect(status.resolution).toBe('adaptive');
      expect(status.activeLayers).toBe(5);
      expect(status.features).toBeDefined();
    });
    
    test('should handle disabled state', async () => {
      const disabledEngine = new AxelVoxelEngine({ enabled: false });
      const result = await disabledEngine.analyzeAndReplicate({}, null);
      
      expect(result).toBeNull();
    }, TEST_TIMEOUT);
  });
  
  describe('Performance Tests', () => {
    let engine;
    
    beforeEach(() => {
      engine = new AxelVoxelEngine();
    });
    
    test('should complete analysis within target time', async () => {
      const startTime = Date.now();
      
      const aiData = {
        name: 'Performance Test',
        yearBuilt: 2000,
        location: 'Test'
      };
      
      await engine.analyzeAndReplicate(aiData, null);
      
      const processingTime = Date.now() - startTime;
      
      // Should complete within 15 seconds (allowing some overhead)
      expect(processingTime).toBeLessThan(15000);
    }, TEST_TIMEOUT);
  });
});

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running Axel Voxel Engine Tests...\n');
  
  // Simple test runner for manual execution
  const runSimpleTests = async () => {
    console.log('1. Testing Metrology Analyzer...');
    const metrology = new MetrologyAnalyzer();
    const metrologyResult = await metrology.captureActualShape(null);
    console.assert(metrologyResult.accuracy === 'micron-level', 'Failed: Metrology accuracy');
    console.log('✅ Metrology Analyzer works\n');
    
    console.log('2. Testing Chemical Analyzer...');
    const chemical = new ChemicalAnalyzer();
    const chemicalResult = await chemical.matchComposition(null);
    console.assert(chemicalResult.elements !== undefined, 'Failed: Chemical analysis');
    console.log('✅ Chemical Analyzer works\n');
    
    console.log('3. Testing Flaw Simulator...');
    const flaw = new FlawSimulator();
    const flawResult = await flaw.replicateWear({}, 50);
    console.assert(flawResult.ageYears === 50, 'Failed: Flaw simulation');
    console.log('✅ Flaw Simulator works\n');
    
    console.log('4. Testing Tooling Analyzer...');
    const tooling = new ToolingAnalyzer();
    const toolingResult = await tooling.analyzeToolingMarks(null, 'modern');
    console.assert(toolingResult.method !== undefined, 'Failed: Tooling analysis');
    console.log('✅ Tooling Analyzer works\n');
    
    console.log('5. Testing Environmental Composer...');
    const environment = new EnvironmentalComposer();
    const envResult = await environment.composeEnvironment('Paris', 'clear', 'noon');
    console.assert(envResult.lighting !== undefined, 'Failed: Environment composition');
    console.log('✅ Environmental Composer works\n');
    
    console.log('6. Testing Axel Voxel Engine...');
    const engine = new AxelVoxelEngine();
    const engineResult = await engine.analyzeAndReplicate({ name: 'Test', yearBuilt: 2000 }, null);
    console.assert(engineResult !== null, 'Failed: Axel engine');
    console.log('✅ Axel Voxel Engine works\n');
    
    console.log('✅ All basic tests passed!');
  };
  
  runSimpleTests().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}
