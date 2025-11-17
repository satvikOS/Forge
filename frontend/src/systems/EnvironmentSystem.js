/**
 * Environment System Initialization
 * Sets up and initializes all environment assets, generators, and managers
 */

import AssetManager from '../systems/AssetManager';
import EnvironmentMaterials from '../materials/EnvironmentMaterials';
import TerrainGenerator from '../generators/TerrainGenerator';
import WaterGenerator from '../generators/WaterGenerator';
import VegetationGenerator from '../generators/VegetationGenerator';
import BuildingGenerator from '../generators/BuildingGenerator';
import RoadGenerator from '../generators/RoadGenerator';
import AtmosphericGenerator from '../generators/AtmosphericGenerator';

import { registerAbioticAssets } from '../assets/environments/abiotic/index';
import { registerBioticAssets } from '../assets/environments/biotic/index';
import { registerBuiltAssets } from '../assets/environments/built/index';

import { createEnvironmentTools } from '../tools/EnvironmentTools';

/**
 * Initialize the complete environment system
 * @returns {Object} Initialized systems
 */
export function initializeEnvironmentSystem() {
  // Create material system
  const materialSystem = new EnvironmentMaterials();

  // Create generators
  const terrainGenerator = new TerrainGenerator(materialSystem);
  const waterGenerator = new WaterGenerator(materialSystem);
  const vegetationGenerator = new VegetationGenerator(materialSystem);
  const buildingGenerator = new BuildingGenerator(materialSystem);
  const roadGenerator = new RoadGenerator(materialSystem);
  const atmosphericGenerator = new AtmosphericGenerator(materialSystem);

  const generators = {
    terrainGenerator,
    waterGenerator,
    vegetationGenerator,
    buildingGenerator,
    roadGenerator,
    atmosphericGenerator
  };

  // Create asset manager
  const assetManager = new AssetManager();

  // Register all assets
  registerAbioticAssets(assetManager, generators);
  registerBioticAssets(assetManager, generators);
  registerBuiltAssets(assetManager, generators);

  // Create environment tools from registered assets
  const environmentTools = createEnvironmentTools(assetManager);

  console.log(`✅ Environment system initialized: ${assetManager.getAllAssets().length} assets registered`);

  return {
    assetManager,
    materialSystem,
    generators,
    environmentTools
  };
}

export default initializeEnvironmentSystem;
