/**
 * Test script to verify environment system initialization
 */

import { initializeEnvironmentSystem } from '../src/systems/EnvironmentSystem.js';

console.log('🧪 Testing Environment System Initialization...\n');

try {
  const system = initializeEnvironmentSystem();
  
  console.log('✅ Environment System initialized successfully');
  console.log(`   - Asset Manager: ${system.assetManager ? '✅' : '❌'}`);
  console.log(`   - Material System: ${system.materialSystem ? '✅' : '❌'}`);
  console.log(`   - Generators: ${system.generators ? '✅' : '❌'}`);
  console.log(`   - Environment Tools: ${system.environmentTools ? '✅' : '❌'}`);
  
  console.log(`\n📊 Asset Statistics:`);
  const allAssets = system.assetManager.getAllAssets();
  console.log(`   - Total Assets: ${allAssets.length}`);
  
  const categories = system.assetManager.getCategories();
  categories.forEach(cat => {
    const assets = system.assetManager.getAssetsByCategory(cat.id);
    console.log(`   - ${cat.icon} ${cat.name}: ${assets.length} assets`);
  });
  
  console.log(`\n🔧 Environment Tools:`);
  console.log(`   - Total Tools: ${system.environmentTools.length}`);
  console.log(`   - Sample Tools: ${system.environmentTools.slice(0, 5).map(t => t.name).join(', ')}...`);
  
  console.log(`\n🎨 Materials:`);
  const materials = system.materialSystem.getAllMaterials();
  console.log(`   - Total Materials: ${materials.length}`);
  console.log(`   - Available: ${materials.map(m => m.name).join(', ')}`);
  
  console.log('\n✅ All tests passed!');
  
} catch (error) {
  console.error('❌ Error during testing:', error);
  process.exit(1);
}
