/**
 * Environment Tools - Tools for placing and managing environment assets
 */

import { Tool } from '../systems/ToolSystem';
import * as THREE from 'three';

// Base class for environment asset tools
class AddEnvironmentAssetTool extends Tool {
  constructor(id, name, icon, description, assetId, assetManager) {
    super(id, name, icon, description, 'environment', null);
    this.assetId = assetId;
    this.assetManager = assetManager;
  }

  async onActivate(context) {
    super.onActivate(context);
    await this.addAsset(context);
    // Deactivate after adding
    setTimeout(() => {
      if (context.toolManager) {
        context.toolManager.deactivateTool(context);
      }
    }, 100);
  }

  async addAsset(context) {
    const { sceneManager } = context;
    const asset = this.assetManager.getAsset(this.assetId);
    
    if (!asset) {
      console.error(`Asset ${this.assetId} not found`);
      return;
    }

    try {
      // Check if asset has a generator
      if (asset.generator) {
        const result = await asset.generate({});
        
        // Create scene object
        const obj = sceneManager.createObject(
          `${asset.name} ${sceneManager.objectIdCounter}`,
          'environment_asset',
          {
            type: 'environment',
            assetId: this.assetId,
            assetName: asset.name,
            category: asset.category,
            subcategory: asset.subcategory
          }
        );

        // Store the generated geometry and material in userData
        if (result.geometry) {
          obj.userData.geometry = result.geometry;
        }
        if (result.material) {
          obj.userData.material = result.material;
        }
        // For groups (like trees, buildings)
        if (result instanceof THREE.Group) {
          obj.userData.group = result;
        }

        // Select the new object
        sceneManager.deselectAll();
        sceneManager.selectObject(obj.id);
        context.needsRender = true;
      } else {
        console.warn(`Asset ${this.assetId} has no generator`);
      }
    } catch (error) {
      console.error(`Error adding asset ${this.assetId}:`, error);
    }
  }
}

// Factory function to create environment tools from assets
export function createEnvironmentTools(assetManager) {
  const tools = [];
  const assets = assetManager.getAllAssets();

  assets.forEach(asset => {
    // Only create tools for assets with generators
    if (asset.generator || asset.metadata.procedural) {
      const toolId = `add_${asset.id}`;
      const tool = new AddEnvironmentAssetTool(
        toolId,
        `Add ${asset.name}`,
        getIconForAsset(asset),
        asset.metadata.description,
        asset.id,
        assetManager
      );
      tools.push(tool);
    }
  });

  return tools;
}

// Helper to get icon for asset
function getIconForAsset(asset) {
  // Map asset categories to icons
  const iconMap = {
    'mountain': '⛰️',
    'hill': '🏔️',
    'valley': '🏞️',
    'plain': '🌾',
    'desert': '🏜️',
    'beach': '🏖️',
    'ocean': '🌊',
    'river': '〰️',
    'lake': '💧',
    'tree_oak': '🌳',
    'tree_pine': '🌲',
    'tree_palm': '🌴',
    'grass': '🌱',
    'flower_rose': '🌹',
    'building_house': '🏠',
    'building_skyscraper': '🏢',
    'building_factory': '🏭',
    'road_highway': '🛣️',
    'road_bridge': '🌉',
    'sky': '🌤️',
    'cloud': '☁️',
    'sun': '☀️',
    'moon': '🌙',
    'rain': '🌧️',
    'snow': '❄️'
  };

  return iconMap[asset.id] || '📦';
}

export default AddEnvironmentAssetTool;
