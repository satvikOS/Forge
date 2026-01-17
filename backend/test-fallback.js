#!/usr/bin/env node

/**
 * Test fallback behavior when AI provides minimal data
 */

const aiService = require('./services/aiService');

console.log('\n========================================');
console.log('🧪 Testing Fallback 3D Data Generation');
console.log('========================================\n');

// Mock minimal analysis (like what current AI might return)
const minimalAnalysis = {
  objectCount: 1,
  objectTypes: ['building'],
  scene: {
    type: 'building',
    complexity: 'medium',
    style: 'modern'
  },
  elements: [
    {
      type: 'building',
      name: 'Office Building',
      quantity: 1,
      dimensions: { width: 20000, height: 30000, depth: 15000 },
      materials: ['glass', 'steel'],
      details: ['windows', 'facade']
    }
  ],
  requirements: {
    detailLevel: 'high',
    materials: ['glass', 'steel'],
    features: ['modern_design']
  }
};

async function testFallback() {
  try {
    console.log('--- Test 1: Minimal AI Response ---');
    console.log('✓ Input has NO enhanced 3D data (wireframe, LOD, PBR, etc.)');
    console.log('✓ This simulates what current Gemini API returns\n');

    console.log('--- Test 2: Convert to Specs ---');
    const specs = aiService.convertAIAnalysisToSpecs(minimalAnalysis);
    
    console.log('✓ Conversion completed');
    console.log('  - Has 3D data:', specs.has3DData ? '✅ YES' : '❌ NO');
    console.log('  - Wireframe:', specs.wireframe ? '✅ Generated' : '❌ Missing');
    console.log('  - LOD:', specs.lod ? '✅ Generated' : '❌ Missing');
    console.log('  - PBR:', specs.pbr ? '✅ Generated' : '❌ Missing');
    console.log('  - Environment:', specs.sceneEnvironment ? '✅ Generated' : '❌ Missing');
    console.log('  - Geometry:', specs.geometry ? '✅ Generated' : '❌ Missing');
    
    if (!specs.has3DData) {
      throw new Error('Enhanced 3D data was not generated!');
    }
    console.log('✅ Test 2 passed\n');

    console.log('--- Test 3: Verify Generated Data ---');
    
    // Check wireframe
    if (!specs.wireframe || !specs.wireframe.controlVertices || specs.wireframe.controlVertices.length === 0) {
      throw new Error('Wireframe data invalid');
    }
    console.log('✓ Wireframe:', specs.wireframe.controlVertices.length, 'vertices,', specs.wireframe.edges.length, 'edges');
    
    // Check LOD
    const lodResolutions = ['720p', '1080p', '4K', '8K'];
    const hasAllLODs = lodResolutions.every(res => specs.lod[res]);
    if (!hasAllLODs) {
      throw new Error('LOD data incomplete');
    }
    console.log('✓ LOD levels:', Object.keys(specs.lod).join(', '));
    
    // Check PBR
    if (!specs.pbr || !specs.pbr.baseColor || specs.pbr.metallic === undefined) {
      throw new Error('PBR data invalid');
    }
    console.log('✓ PBR material:', specs.pbr.baseColor, '(metallic:', specs.pbr.metallic, ', roughness:', specs.pbr.roughness + ')');
    
    // Check Environment
    if (!specs.sceneEnvironment || !specs.sceneEnvironment.lighting) {
      throw new Error('Scene environment invalid');
    }
    console.log('✓ Environment:', specs.sceneEnvironment.context, 'with', specs.sceneEnvironment.lighting.hdri, 'lighting');
    
    console.log('✅ Test 3 passed\n');

    console.log('--- Test 4: Generate Full Model ---');
    const modelData = await aiService.generateModelData(specs);
    
    console.log('✓ Model generated successfully');
    console.log('  - Geometry type:', modelData.geometry.type);
    console.log('  - Stats:', JSON.stringify(modelData.stats));
    console.log('✅ Test 4 passed\n');

    console.log('========================================');
    console.log('✅ All Fallback Tests Passed!');
    console.log('========================================');
    console.log('\n🎯 KEY FINDING:');
    console.log('Even when AI returns minimal data (current behavior),');
    console.log('the system now generates complete 3D specifications automatically!');
    console.log('\nThis means designs will NO LONGER FAIL. 🎉\n');

  } catch (error) {
    console.error('\n========================================');
    console.error('❌ Test Failed');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testFallback().then(() => {
  console.log('Fallback test completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('Fallback test failed:', error);
  process.exit(1);
});
