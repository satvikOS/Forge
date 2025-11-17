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
import SceneComposer from '../systems/SceneComposer';

import { registerAbioticAssets } from '../assets/environments/abiotic/index';
import { registerBioticAssets } from '../assets/environments/biotic/index';
import { registerBuiltAssets } from '../assets/environments/built/index';

import { createEnvironmentTools } from '../tools/EnvironmentTools';

/**
 * Initialize the complete environment system
 * @param {Object} sceneManager - SceneManager instance for scene composition
 * @returns {Object} Initialized systems
 */
export function initializeEnvironmentSystem(sceneManager = null) {
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

  // Create scene composer if sceneManager is provided
  let sceneComposer = null;
  if (sceneManager) {
    sceneComposer = new SceneComposer(assetManager, generators, sceneManager);
    console.log(`✅ Scene Composer initialized with ${Object.keys(sceneComposer.sceneTemplates).length} templates`);
  }

  console.log(`✅ Environment system initialized: ${assetManager.getAllAssets().length} assets registered`);

  return {
    assetManager,
    materialSystem,
    generators,
    environmentTools,
    sceneComposer
  };
}

export default initializeEnvironmentSystem;
