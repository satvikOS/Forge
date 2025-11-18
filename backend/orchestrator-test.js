#!/usr/bin/env node

/**
 * API Orchestrator Test Script
 * Tests the orchestration system with various prompts
 * Run with: node backend/test-orchestrator.js
 */

require('dotenv').config();
const apiOrchestrator = require('./services/apiOrchestrator');
const analyticsService = require('./services/analyticsService');

// Test prompts covering different scenarios
const testPrompts = [
  {
    name: 'Real Landmark',
    prompt: 'Recreate the Eiffel Tower in Paris',
    expectedFeatures: ['knowledge', 'geographic', 'real'],
  },
  {
    name: 'Fantasy Structure',
    prompt: 'Create a magical floating castle with waterfalls',
    expectedFeatures: ['fantasy', 'environmental'],
  },
  {
    name: 'Gothic Cathedral',
    prompt: 'Gothic cathedral in a medieval European town',
    expectedFeatures: ['knowledge', 'style'],
  },
  {
    name: 'Modern City',
    prompt: 'Times Square at night with neon lights',
    expectedFeatures: ['real', 'geographic', 'lighting'],
  },
  {
    name: 'Natural Environment',
    prompt: 'Coastal resort with palm trees and sandy beach',
    expectedFeatures: ['environmental', 'vegetation'],
  },
];

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n' + colors.bright + colors.cyan + '═══════════════════════════════════════════════════════════');
  console.log('🧪 API ORCHESTRATOR TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════' + colors.reset + '\n');

  // Check if orchestrator is enabled
  if (!apiOrchestrator.isEnabled()) {
    console.error(colors.red + '❌ API Orchestrator is DISABLED' + colors.reset);
    console.log('   Set ENABLE_ORCHESTRATOR=true in .env file\n');
    process.exit(1);
  }

  console.log(colors.green + '✅ API Orchestrator is ENABLED' + colors.reset);
  console.log('');

  // Display API status
  displayAPIStatus();
  console.log('');

  // Run tests
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testPrompts.length; i++) {
    const test = testPrompts[i];
    console.log(colors.bright + `\n📋 Test ${i + 1}/${testPrompts.length}: ${test.name}` + colors.reset);
    console.log(colors.dim + `   Prompt: "${test.prompt}"` + colors.reset);

    try {
      const result = await runSingleTest(test);
      if (result.success) {
        passed++;
        console.log(colors.green + '   ✅ PASSED' + colors.reset);
      } else {
        failed++;
        console.log(colors.red + '   ❌ FAILED' + colors.reset);
      }
    } catch (error) {
      failed++;
      console.log(colors.red + `   ❌ ERROR: ${error.message}` + colors.reset);
    }
  }

  // Display results
  console.log('\n' + colors.bright + colors.cyan + '═══════════════════════════════════════════════════════════');
  console.log('📊 TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════' + colors.reset + '\n');

  console.log(`${colors.green}✅ Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}❌ Failed: ${failed}${colors.reset}`);
  console.log(`📈 Total: ${passed + failed}`);
  console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

  // Display analytics
  displayAnalytics();

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Display API status
 */
function displayAPIStatus() {
  console.log(colors.bright + '🔧 API Status:' + colors.reset);

  const services = [
    { name: 'Mapbox', module: './services/mapboxService' },
    { name: 'Overpass (OSM)', module: './services/overpassService' },
    { name: 'Open-Elevation', module: './services/elevationService' },
    { name: 'Wikipedia', module: './services/wikipediaService' },
    { name: 'Wikidata', module: './services/wikidataService' },
    { name: 'Wikimedia', module: './services/wikimediaService' },
    { name: 'Open-Meteo', module: './services/weatherService' },
    { name: 'TreeMap', module: './services/treeMapService' },
    { name: 'Mapillary', module: './services/mapillaryService' },
    { name: 'Sketchfab', module: './services/sketchfabService' },
  ];

  services.forEach(service => {
    try {
      const svc = require(service.module);
      const enabled = svc.isEnabled();
      const status = enabled ? colors.green + '✓' : colors.dim + '○';
      const label = enabled ? 'enabled' : 'disabled';
      console.log(`   ${status} ${service.name.padEnd(20)} [${label}]${colors.reset}`);
    } catch (error) {
      console.log(`   ${colors.red}✗ ${service.name.padEnd(20)} [error]${colors.reset}`);
    }
  });
}

/**
 * Run a single test
 */
async function runSingleTest(test) {
  const startTime = Date.now();
  
  try {
    // Run orchestration
    const result = await apiOrchestrator.orchestrate(test.prompt, {});
    const duration = Date.now() - startTime;

    if (!result || result.error) {
      return {
        success: false,
        error: result?.error || 'No result returned',
        duration,
      };
    }

    // Validate result structure
    const validation = validateResult(result, test.expectedFeatures);

    // Display results
    console.log(colors.dim + `   Duration: ${duration}ms` + colors.reset);
    console.log(colors.dim + `   Confidence: ${(result.confidence * 100).toFixed(1)}%` + colors.reset);
    console.log(colors.dim + `   Data Quality: ${result.dataQuality}` + colors.reset);
    console.log(colors.dim + `   Data Sources: ${result.phases?.sceneGeneration?.sceneData?.realWorldData?.dataSourceCount || 0}` + colors.reset);

    if (validation.warnings.length > 0) {
      console.log(colors.yellow + '   ⚠️  Warnings:' + colors.reset);
      validation.warnings.forEach(w => console.log(colors.dim + `      - ${w}` + colors.reset));
    }

    return {
      success: validation.valid,
      duration,
      result,
      validation,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Validate orchestration result
 */
function validateResult(result, expectedFeatures) {
  const validation = {
    valid: true,
    warnings: [],
    errors: [],
  };

  // Check basic structure
  if (!result.phases) {
    validation.errors.push('Missing phases in result');
    validation.valid = false;
  }

  // Check intent understanding
  if (!result.phases?.intentUnderstanding?.success) {
    validation.errors.push('Intent understanding failed');
    validation.valid = false;
  }

  // Check expected features
  if (expectedFeatures.includes('knowledge') && !result.phases?.knowledgeGathering) {
    validation.warnings.push('Expected knowledge data but none found');
  }

  if (expectedFeatures.includes('geographic') && !result.phases?.geographicData) {
    validation.warnings.push('Expected geographic data but none found');
  }

  if (expectedFeatures.includes('environmental') && !result.phases?.environmentalContext) {
    validation.warnings.push('Expected environmental data but none found');
  }

  // Check confidence
  if (result.confidence < 0.3) {
    validation.warnings.push('Low confidence score');
  }

  return validation;
}

/**
 * Display analytics summary
 */
function displayAnalytics() {
  console.log(colors.bright + '📈 Analytics Summary:' + colors.reset);

  const report = analyticsService.generateReport();

  console.log(`\n   ${colors.cyan}API Calls:${colors.reset}`);
  for (const [api, stats] of Object.entries(report.apis)) {
    console.log(`      ${api.padEnd(20)} ${stats.calls} calls, ${stats.avgResponseTime}, ${stats.successRate} success`);
  }

  console.log(`\n   ${colors.cyan}Cache Performance:${colors.reset}`);
  console.log(`      Hit Rate: ${report.summary.cacheHitRate}`);

  console.log(`\n   ${colors.cyan}Total Cost:${colors.reset} ${report.summary.totalCost}`);

  if (report.topErrors && report.topErrors.length > 0) {
    console.log(`\n   ${colors.yellow}Top Errors:${colors.reset}`);
    report.topErrors.forEach(err => {
      console.log(`      ${err.api}: ${err.errorType} (${err.count}x)`);
    });
  }

  console.log('');
}

/**
 * Test individual services
 */
async function testIndividualServices() {
  console.log(colors.bright + '\n🔬 Individual Service Tests:\n' + colors.reset);

  // Test Wikipedia
  try {
    const wikipedia = require('./services/wikipediaService');
    if (wikipedia.isEnabled()) {
      console.log('   Testing Wikipedia...');
      const result = await wikipedia.search('Eiffel Tower', 1);
      console.log(colors.green + '   ✓ Wikipedia working' + colors.reset);
    }
  } catch (error) {
    console.log(colors.red + `   ✗ Wikipedia failed: ${error.message}` + colors.reset);
  }

  // Test Weather
  try {
    const weather = require('./services/weatherService');
    if (weather.isEnabled()) {
      console.log('   Testing Open-Meteo...');
      const result = await weather.getCurrentWeather(48.8566, 2.3522); // Paris
      console.log(colors.green + '   ✓ Open-Meteo working' + colors.reset);
    }
  } catch (error) {
    console.log(colors.red + `   ✗ Open-Meteo failed: ${error.message}` + colors.reset);
  }

  console.log('');
}

// Run tests
if (require.main === module) {
  console.log('\n');
  runTests().catch(error => {
    console.error(colors.red + '\n❌ Test suite failed:' + colors.reset, error);
    process.exit(1);
  });
}

module.exports = { runTests, runSingleTest };
