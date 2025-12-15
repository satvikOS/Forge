/**
 * AI Pipeline Integration Tests
 * Tests the complete integration of Wikipedia/Wikidata/Geographic services with Gemini AI
 */

const aiService = require('../services/aiService');
// Wikipedia service removed - using Bedrock knowledge
const geographicCoordinateService = require('../services/geographicCoordinateService');

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds for AI calls

describe('AI Pipeline Integration Tests', () => {
  
  describe('Landmark Detection and Wikipedia Integration', () => {
    
    test('should detect Eiffel Tower landmark', () => {
      const prompt = 'Generate the Eiffel Tower';
      const landmark = aiService.detectLandmark(prompt);
      expect(landmark).toBe('Eiffel Tower');
    });
    
    test('should detect Empire State Building landmark', () => {
      const prompt = 'Create Empire State Building';
      const landmark = aiService.detectLandmark(prompt);
      expect(landmark).toBe('Empire State Building');
    });
    
    test('should return null for non-landmark prompts', () => {
      const prompt = 'Create a modern office building';
      const landmark = aiService.detectLandmark(prompt);
      expect(landmark).toBeNull();
    });
    
    test('should fetch Wikipedia data for Eiffel Tower', async () => {
      // Wikipedia test removed
        console.log('⚠️  Python Wikipedia not enabled, skipping test');
        return;
      }
      
      // Wikipedia test removed
      
      expect(data).toBeTruthy();
      expect(data.title).toBeTruthy();
      expect(data.dimensions).toBeTruthy();
      
      // Check if dimensions were extracted
      if (data.dimensions.height) {
        console.log(`✅ Eiffel Tower height: ${data.dimensions.height}m`);
        expect(data.dimensions.height).toBeGreaterThan(300); // Should be ~324m
      }
    }, TEST_TIMEOUT);
    
  });
  
  describe('Geographic Coordinate Detection and Analysis', () => {
    
    test('should detect decimal coordinates', () => {
      const prompt = 'Generate scene at 40.7128, -74.0060';
      const coords = geographicCoordinateService.detectCoordinates(prompt);
      
      expect(coords).toBeTruthy();
      expect(coords.latitude).toBeCloseTo(40.7128, 3);
      expect(coords.longitude).toBeCloseTo(-74.0060, 3);
    });
    
    test('should detect coordinates with degree symbols', () => {
      const prompt = 'Create environment at 48.8566°N, 2.3522°E';
      const coords = geographicCoordinateService.detectCoordinates(prompt);
      
      expect(coords).toBeTruthy();
      expect(coords.latitude).toBeCloseTo(48.8566, 3);
      expect(coords.longitude).toBeCloseTo(2.3522, 3);
    });
    
    test('should analyze geographic coordinates (if services enabled)', async () => {
      if (!geographicCoordinateService.isEnabled()) {
        console.log('⚠️  Geographic services not enabled, skipping test');
        return;
      }
      
      // Times Square, New York
      const lat = 40.7580;
      const lon = -73.9855;
      
      const analysis = await geographicCoordinateService.analyzeCoordinate(lat, lon, {
        radiusMeters: 200,
        includeStreetView: false // Skip street view for faster test
      });
      
      expect(analysis).toBeTruthy();
      expect(analysis.coordinates).toBeTruthy();
      expect(analysis.analysis).toBeTruthy();
      
      console.log(`✅ Geographic analysis: ${analysis.analysis.environmentType}`);
      console.log(`✅ Characteristics: ${analysis.analysis.characteristics.join(', ')}`);
    }, TEST_TIMEOUT);
    
  });
  
  describe('API Orchestrator Detection', () => {
    
    test('should detect complex scene keywords', () => {
      const prompts = [
        'Recreate downtown Manhattan',
        'Generate entire city block',
        'Create neighborhood with multiple buildings',
        'Show complete urban district'
      ];
      
      prompts.forEach(prompt => {
        const shouldUse = aiService.shouldUseOrchestrator(prompt);
        expect(shouldUse).toBe(true);
      });
    });
    
    test('should not trigger orchestrator for simple prompts', () => {
      const prompts = [
        'Create a modern office building',
        'Generate a residential house',
        'Build a shopping mall'
      ];
      
      prompts.forEach(prompt => {
        const shouldUse = aiService.shouldUseOrchestrator(prompt);
        expect(shouldUse).toBe(false);
      });
    });
    
  });
  
  describe('Complete AI Pipeline', () => {
    
    test('should process landmark prompt with real-world data', async () => {
      if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️  GEMINI_API_KEY not set, skipping integration test');
        return;
      }
      
      const prompt = 'Generate the Eiffel Tower';
      
      console.log('\n🧪 Testing complete pipeline with landmark prompt...');
      const result = await aiService.processPrompt(prompt);
      
      expect(result).toBeTruthy();
      expect(result.taxonomyData).toBeTruthy();
      
      // Check if real-world data was incorporated
      if (result.taxonomyData.realWorldData) {
        console.log('✅ Real-world data was incorporated into the result');
      }
      
      console.log(`✅ Generated design: ${result.name}`);
      console.log(`✅ Primary category: ${result.taxonomyData.primaryCategory}`);
      console.log(`✅ Element count: ${result.elements?.length || 0}`);
    }, TEST_TIMEOUT);
    
    test('should process geographic coordinate prompt', async () => {
      if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️  GEMINI_API_KEY not set, skipping integration test');
        return;
      }
      
      const prompt = 'Generate realistic scene at coordinates 48.8584, 2.2945'; // Near Eiffel Tower
      
      console.log('\n🧪 Testing complete pipeline with coordinate prompt...');
      const result = await aiService.processPrompt(prompt);
      
      expect(result).toBeTruthy();
      expect(result.taxonomyData).toBeTruthy();
      
      // Check if geographic data was incorporated
      if (result.taxonomyData.geographicData) {
        console.log('✅ Geographic data was incorporated into the result');
        console.log(`✅ Environment type: ${result.taxonomyData.geographicData.analysis?.environmentType}`);
      }
      
      console.log(`✅ Generated design: ${result.name}`);
      console.log(`✅ Element count: ${result.elements?.length || 0}`);
    }, TEST_TIMEOUT);
    
    test('should process generic architectural prompt', async () => {
      if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️  GEMINI_API_KEY not set, skipping integration test');
        return;
      }
      
      const prompt = 'Create a modern glass office tower with 30 floors';
      
      console.log('\n🧪 Testing complete pipeline with generic prompt...');
      const result = await aiService.processPrompt(prompt);
      
      expect(result).toBeTruthy();
      expect(result.taxonomyData).toBeTruthy();
      expect(result.elements).toBeTruthy();
      expect(result.elements.length).toBeGreaterThan(0);
      
      console.log(`✅ Generated design: ${result.name}`);
      console.log(`✅ Primary category: ${result.taxonomyData.primaryCategory}`);
      console.log(`✅ Style: ${result.style}`);
    }, TEST_TIMEOUT);
    
  });
  
  describe('Dimension Extraction', () => {
    
    test('should extract height from text', () => {
      const text = 'The tower stands at 324 meters tall';
      const dims = aiService.extractDimensionsFromText(text);
      
      expect(dims.height).toBe(324);
    });
    
    test('should extract floor count from text', () => {
      const text = 'The building has 102 floors';
      const dims = aiService.extractDimensionsFromText(text);
      
      expect(dims.floors).toBe(102);
    });
    
    test('should extract width from text', () => {
      const text = 'The structure has a width of 125 meters';
      const dims = aiService.extractDimensionsFromText(text);
      
      expect(dims.width).toBe(125);
    });
    
  });
  
});

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running AI Pipeline Integration Tests...\n');
  console.log('Note: These tests require API keys to be configured in .env file\n');
  
  // Simple test runner
  const tests = [
    {
      name: 'Landmark Detection',
      fn: () => {
        const result = aiService.detectLandmark('Generate the Eiffel Tower');
        console.assert(result === 'Eiffel Tower', 'Failed: Eiffel Tower detection');
        console.log('✅ Landmark detection works');
      }
    },
    {
      name: 'Coordinate Detection',
      fn: () => {
        const result = geographicCoordinateService.detectCoordinates('Scene at 40.7128, -74.0060');
        console.assert(result !== null, 'Failed: Coordinate detection');
        console.log('✅ Coordinate detection works');
      }
    },
    {
      name: 'Complex Scene Detection',
      fn: () => {
        const result = aiService.shouldUseOrchestrator('Recreate downtown Manhattan');
        console.assert(result === true, 'Failed: Complex scene detection');
        console.log('✅ Complex scene detection works');
      }
    }
  ];
  
  tests.forEach(test => {
    try {
      test.fn();
    } catch (error) {
      console.error(`❌ ${test.name} failed:`, error.message);
    }
  });
  
  console.log('\n✅ Basic tests completed. Run with Jest for full test suite.');
}
