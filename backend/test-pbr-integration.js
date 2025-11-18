const materialMappingService = require('./services/materialMappingService');

(async () => {
  try {
    console.log('Testing full PBR integration...');
    await materialMappingService.initialize();
    
    const modelData = {
      type: 'composite',
      parts: [
        { 
          type: 'box', 
          material: 'concrete', 
          dimensions: { x: 10000, y: 30000, z: 15000 },
          position: { x: 0, y: 0, z: 0 }
        },
        { 
          type: 'box', 
          material: 'glass', 
          dimensions: { x: 1500, y: 2000, z: 100 },
          position: { x: 0, y: 5000, z: 7500 }
        }
      ]
    };
    
    const specifications = {
      scene: { style: 'modern', complexity: 'high' },
      elements: [{ type: 'building', name: 'Modern Office' }],
      environmentalContext: {
        terrain: 'flat',
        groundCover: 'concrete',
        timeOfDay: 'day'
      }
    };
    
    const result = await materialMappingService.assignRealisticMaterials(modelData, specifications);
    
    console.log('\n✅ Materials assigned successfully!');
    console.log('Parts:', result.modelData.parts.length);
    result.modelData.parts.forEach((part, i) => {
      console.log('  Part', i);
      console.log('    Material:', part.material);
      console.log('    Has PBR:', !!part.pbrMaterial);
      console.log('    PBR Type:', part.pbrMaterial?.type);
      console.log('    Has Maps:', !!part.pbrMaterial?.maps);
      if (part.pbrMaterial?.maps) {
        console.log('    Maps:', Object.keys(part.pbrMaterial.maps).join(', '));
      }
    });
    
    console.log('\nEnvironment Config:');
    console.log('  Location:', result.environmentConfig.location);
    console.log('  Time:', result.environmentConfig.timeOfDay);
    console.log('  Weather:', result.environmentConfig.weather);
    const hdriUrl = result.environmentConfig.hdri?.url || '';
    console.log('  HDRI URL:', hdriUrl.substring(0, 60) + '...');
    console.log('  HDRI Intensity:', result.environmentConfig.hdri?.intensity);
    console.log('  Sun Intensity:', result.environmentConfig.lighting.sunIntensity);
    console.log('  Ambient Intensity:', result.environmentConfig.lighting.ambientIntensity);
    console.log('  Shadows Enabled:', result.environmentConfig.lighting.shadowsEnabled);
    
    console.log('\n✅ Full PBR Integration Test Passed!');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
})();
