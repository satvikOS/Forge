/**
 * Built Environment Assets - Man-Made/Built Environment
 * Buildings, Roads & Paths, and Other Infrastructure
 */

import { Asset } from '../../../systems/AssetManager';

export function registerBuiltAssets(assetManager, generators) {
  const { buildingGenerator, roadGenerator } = generators;

  // BUILDINGS - RESIDENTIAL
  assetManager.registerAsset(
    new Asset('building_house', 'House', 'built', 'buildings', {
      tags: ['building', 'residential', 'home'],
      description: 'Single-family residential house'
    }).setGenerator((opts) => buildingGenerator.generateHouse(opts))
  );

  assetManager.registerAsset(
    new Asset('building_apartment', 'Apartment Building', 'built', 'buildings', {
      tags: ['building', 'residential', 'multi-family'],
      description: 'Multi-story apartment building'
    }).setGenerator((opts) => buildingGenerator.generateApartmentBuilding(opts))
  );

  assetManager.registerAsset(
    new Asset('building_hut', 'Hut/Shack', 'built', 'buildings', {
      tags: ['building', 'residential', 'simple', 'rural'],
      description: 'Simple hut or shack'
    }).setGenerator((opts) => buildingGenerator.generateHut(opts))
  );

  // BUILDINGS - COMMERCIAL
  assetManager.registerAsset(
    new Asset('building_skyscraper', 'Skyscraper', 'built', 'buildings', {
      tags: ['building', 'commercial', 'office', 'tall'],
      description: 'Tall office building or skyscraper'
    }).setGenerator((opts) => buildingGenerator.generateSkyscraper(opts))
  );

  assetManager.registerAsset(
    new Asset('building_shop', 'Shop/Store', 'built', 'buildings', {
      tags: ['building', 'commercial', 'retail'],
      description: 'Retail store or shop'
    }).setGenerator((opts) => buildingGenerator.generateShop(opts))
  );

  // BUILDINGS - INDUSTRIAL
  assetManager.registerAsset(
    new Asset('building_warehouse', 'Warehouse', 'built', 'buildings', {
      tags: ['building', 'industrial', 'storage'],
      description: 'Industrial warehouse'
    }).setGenerator((opts) => buildingGenerator.generateWarehouse(opts))
  );

  assetManager.registerAsset(
    new Asset('building_factory', 'Factory/Plant', 'built', 'buildings', {
      tags: ['building', 'industrial', 'manufacturing'],
      description: 'Industrial factory or plant'
    }).setGenerator((opts) => buildingGenerator.generateFactory(opts))
  );

  // BUILDINGS - INSTITUTIONAL/PUBLIC
  assetManager.registerAsset(
    new Asset('building_school', 'School', 'built', 'buildings', {
      tags: ['building', 'institutional', 'education'],
      description: 'School building'
    }).setGenerator((opts) => buildingGenerator.generateSchool(opts))
  );

  assetManager.registerAsset(
    new Asset('building_hospital', 'Hospital', 'built', 'buildings', {
      tags: ['building', 'institutional', 'healthcare'],
      description: 'Hospital building'
    }).setGenerator((opts) => buildingGenerator.generateHospital(opts))
  );

  assetManager.registerAsset(
    new Asset('building_church', 'Church/Place of Worship', 'built', 'buildings', {
      tags: ['building', 'institutional', 'religious'],
      description: 'Church or place of worship'
    }).setGenerator((opts) => buildingGenerator.generateChurch(opts))
  );

  assetManager.registerAsset(
    new Asset('building_stadium', 'Stadium', 'built', 'buildings', {
      tags: ['building', 'institutional', 'sports', 'entertainment'],
      description: 'Sports stadium'
    }).setGenerator((opts) => buildingGenerator.generateStadium(opts))
  );

  // ROADS & PATHS
  assetManager.registerAsset(
    new Asset('road_highway', 'Highway/Motorway', 'built', 'roads', {
      tags: ['road', 'infrastructure', 'transport', 'major'],
      description: 'Multi-lane highway'
    }).setGenerator((opts) => roadGenerator.generateHighway(opts))
  );

  assetManager.registerAsset(
    new Asset('road_street', 'Street/Road', 'built', 'roads', {
      tags: ['road', 'infrastructure', 'transport', 'urban'],
      description: 'City street with sidewalks'
    }).setGenerator((opts) => roadGenerator.generateStreet(opts))
  );

  assetManager.registerAsset(
    new Asset('road_path_dirt', 'Dirt Path', 'built', 'roads', {
      tags: ['path', 'infrastructure', 'rural', 'unpaved'],
      description: 'Unpaved dirt path'
    }).setGenerator((opts) => roadGenerator.generatePath({ ...opts, material: 'dirt' }))
  );

  assetManager.registerAsset(
    new Asset('road_path_gravel', 'Gravel Path', 'built', 'roads', {
      tags: ['path', 'infrastructure', 'unpaved'],
      description: 'Gravel path'
    }).setGenerator((opts) => roadGenerator.generatePath({ ...opts, material: 'sand' }))
  );

  assetManager.registerAsset(
    new Asset('road_sidewalk', 'Sidewalk/Pavement', 'built', 'roads', {
      tags: ['path', 'infrastructure', 'pedestrian'],
      description: 'Pedestrian sidewalk'
    }).setGenerator((opts) => roadGenerator.generateSidewalk(opts))
  );

  assetManager.registerAsset(
    new Asset('road_bridge', 'Bridge', 'built', 'roads', {
      tags: ['infrastructure', 'transport', 'crossing'],
      description: 'Road bridge'
    }).setGenerator((opts) => roadGenerator.generateBridge(opts))
  );

  assetManager.registerAsset(
    new Asset('road_tunnel', 'Tunnel', 'built', 'roads', {
      tags: ['infrastructure', 'transport', 'underground'],
      description: 'Road tunnel'
    }).setGenerator((opts) => roadGenerator.generateTunnel(opts))
  );

  assetManager.registerAsset(
    new Asset('road_parking', 'Parking Lot', 'built', 'roads', {
      tags: ['infrastructure', 'parking', 'vehicle'],
      description: 'Parking lot'
    }).setGenerator((opts) => roadGenerator.generateParkingLot(opts))
  );

  assetManager.registerAsset(
    new Asset('road_roundabout', 'Roundabout', 'built', 'roads', {
      tags: ['infrastructure', 'transport', 'intersection'],
      description: 'Traffic roundabout'
    }).setGenerator((opts) => roadGenerator.generateRoundabout(opts))
  );

  assetManager.registerAsset(
    new Asset('road_intersection', 'Intersection', 'built', 'roads', {
      tags: ['infrastructure', 'transport', 'crossing'],
      description: 'Road intersection with crosswalks'
    }).setGenerator((opts) => roadGenerator.generateIntersection(opts))
  );

  // INFRASTRUCTURE - Placeholders for simple objects
  // These would need more complex generators or models in a full implementation

  assetManager.registerAsset(
    new Asset('infra_fence', 'Fence/Wall', 'built', 'infrastructure', {
      tags: ['infrastructure', 'boundary', 'barrier'],
      description: 'Fence or wall (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_streetlight', 'Streetlight', 'built', 'infrastructure', {
      tags: ['infrastructure', 'lighting', 'urban'],
      description: 'Street lamp post (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_traffic_light', 'Traffic Light', 'built', 'infrastructure', {
      tags: ['infrastructure', 'traffic', 'signal'],
      description: 'Traffic light (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_bench', 'Bench', 'built', 'infrastructure', {
      tags: ['infrastructure', 'furniture', 'seating'],
      description: 'Park bench (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_fountain', 'Fountain', 'built', 'infrastructure', {
      tags: ['infrastructure', 'water', 'decorative'],
      description: 'Fountain (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_statue', 'Statue/Monument', 'built', 'infrastructure', {
      tags: ['infrastructure', 'art', 'memorial'],
      description: 'Statue or monument (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_trash_can', 'Trash Can', 'built', 'infrastructure', {
      tags: ['infrastructure', 'waste', 'urban'],
      description: 'Trash can (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_playground', 'Playground', 'built', 'infrastructure', {
      tags: ['infrastructure', 'recreation', 'children'],
      description: 'Playground equipment (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_dam', 'Dam', 'built', 'infrastructure', {
      tags: ['infrastructure', 'water', 'barrier'],
      description: 'Dam structure (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_power_lines', 'Power Lines', 'built', 'infrastructure', {
      tags: ['infrastructure', 'utility', 'electrical'],
      description: 'Power lines and utility poles (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('infra_cell_tower', 'Cell Tower', 'built', 'infrastructure', {
      tags: ['infrastructure', 'communication', 'tower'],
      description: 'Cell tower (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );
}
