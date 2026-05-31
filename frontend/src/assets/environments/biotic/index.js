/**
 * Biotic Assets - Natural Environment (Living)
 * Flora (Plants) and Fauna (Animals)
 */

import { Asset } from '../../../systems/AssetManager';

export function registerBioticAssets(assetManager, generators) {
  const { vegetationGenerator } = generators;

  // FLORA - TREES
  assetManager.registerAsset(
    new Asset('tree_oak', 'Oak Tree', 'biotic', 'flora', {
      tags: ['tree', 'deciduous', 'plant', 'vegetation'],
      description: 'Deciduous oak tree'
    }).setGenerator((opts) => vegetationGenerator.generateDeciduousTree({ ...opts, species: 'oak' }))
  );

  assetManager.registerAsset(
    new Asset('tree_maple', 'Maple Tree', 'biotic', 'flora', {
      tags: ['tree', 'deciduous', 'plant', 'vegetation'],
      description: 'Deciduous maple tree'
    }).setGenerator((opts) => vegetationGenerator.generateDeciduousTree({ ...opts, species: 'maple' }))
  );

  assetManager.registerAsset(
    new Asset('tree_birch', 'Birch Tree', 'biotic', 'flora', {
      tags: ['tree', 'deciduous', 'plant', 'vegetation'],
      description: 'Deciduous birch tree with white bark'
    }).setGenerator((opts) => vegetationGenerator.generateDeciduousTree({ ...opts, species: 'birch' }))
  );

  assetManager.registerAsset(
    new Asset('tree_cherry', 'Cherry Tree', 'biotic', 'flora', {
      tags: ['tree', 'deciduous', 'plant', 'vegetation', 'flowering'],
      description: 'Deciduous cherry tree'
    }).setGenerator((opts) => vegetationGenerator.generateDeciduousTree({ ...opts, species: 'cherry' }))
  );

  assetManager.registerAsset(
    new Asset('tree_pine', 'Pine Tree', 'biotic', 'flora', {
      tags: ['tree', 'coniferous', 'evergreen', 'plant', 'vegetation'],
      description: 'Coniferous pine tree'
    }).setGenerator((opts) => vegetationGenerator.generateConiferousTree({ ...opts, species: 'pine' }))
  );

  assetManager.registerAsset(
    new Asset('tree_spruce', 'Spruce Tree', 'biotic', 'flora', {
      tags: ['tree', 'coniferous', 'evergreen', 'plant', 'vegetation'],
      description: 'Coniferous spruce tree'
    }).setGenerator((opts) => vegetationGenerator.generateConiferousTree({ ...opts, species: 'spruce' }))
  );

  assetManager.registerAsset(
    new Asset('tree_fir', 'Fir Tree', 'biotic', 'flora', {
      tags: ['tree', 'coniferous', 'evergreen', 'plant', 'vegetation'],
      description: 'Coniferous fir tree'
    }).setGenerator((opts) => vegetationGenerator.generateConiferousTree({ ...opts, species: 'fir' }))
  );

  assetManager.registerAsset(
    new Asset('tree_palm', 'Palm Tree', 'biotic', 'flora', {
      tags: ['tree', 'tropical', 'plant', 'vegetation'],
      description: 'Tropical palm tree'
    }).setGenerator((opts) => vegetationGenerator.generatePalmTree(opts))
  );

  // FLORA - PLANTS
  assetManager.registerAsset(
    new Asset('shrub', 'Shrub/Bush', 'biotic', 'flora', {
      tags: ['plant', 'vegetation', 'foliage'],
      description: 'Small to medium-sized bush'
    }).setGenerator((opts) => vegetationGenerator.generateShrub(opts))
  );

  assetManager.registerAsset(
    new Asset('grass', 'Grass/Lawn', 'biotic', 'flora', {
      tags: ['plant', 'vegetation', 'ground cover'],
      description: 'Grass or lawn area'
    }).setGenerator((opts) => vegetationGenerator.generateGrass(opts))
  );

  assetManager.registerAsset(
    new Asset('grass_instanced', 'Grass Field (Instanced)', 'biotic', 'flora', {
      tags: ['plant', 'vegetation', 'ground cover', 'performance'],
      description: 'High-performance instanced grass field'
    }).setGenerator((opts) => vegetationGenerator.createInstancedGrass(opts))
  );

  assetManager.registerAsset(
    new Asset('flower_rose', 'Rose', 'biotic', 'flora', {
      tags: ['flower', 'plant', 'vegetation', 'decorative'],
      description: 'Rose flower'
    }).setGenerator((opts) => vegetationGenerator.generateFlower({ ...opts, type: 'rose' }))
  );

  assetManager.registerAsset(
    new Asset('flower_daisy', 'Daisy', 'biotic', 'flora', {
      tags: ['flower', 'plant', 'vegetation', 'decorative'],
      description: 'Daisy flower'
    }).setGenerator((opts) => vegetationGenerator.generateFlower({ ...opts, type: 'daisy' }))
  );

  assetManager.registerAsset(
    new Asset('flower_tulip', 'Tulip', 'biotic', 'flora', {
      tags: ['flower', 'plant', 'vegetation', 'decorative'],
      description: 'Tulip flower'
    }).setGenerator((opts) => vegetationGenerator.generateFlower({ ...opts, type: 'tulip' }))
  );

  assetManager.registerAsset(
    new Asset('moss', 'Moss', 'biotic', 'flora', {
      tags: ['plant', 'vegetation', 'ground cover', 'moist'],
      description: 'Moss ground cover'
    }).setGenerator((opts) => vegetationGenerator.generateMoss(opts))
  );

  assetManager.registerAsset(
    new Asset('crop_corn', 'Corn Crop', 'biotic', 'flora', {
      tags: ['crop', 'agriculture', 'plant', 'food'],
      description: 'Corn crop field'
    }).setGenerator((opts) => vegetationGenerator.generateCrop({ ...opts, type: 'corn' }))
  );

  assetManager.registerAsset(
    new Asset('crop_wheat', 'Wheat Crop', 'biotic', 'flora', {
      tags: ['crop', 'agriculture', 'plant', 'food'],
      description: 'Wheat crop field'
    }).setGenerator((opts) => vegetationGenerator.generateCrop({ ...opts, type: 'wheat' }))
  );

  assetManager.registerAsset(
    new Asset('crop_rice', 'Rice Crop', 'biotic', 'flora', {
      tags: ['crop', 'agriculture', 'plant', 'food'],
      description: 'Rice crop field'
    }).setGenerator((opts) => vegetationGenerator.generateCrop({ ...opts, type: 'rice' }))
  );

  assetManager.registerAsset(
    new Asset('mushroom', 'Mushroom', 'biotic', 'flora', {
      tags: ['fungus', 'plant', 'vegetation'],
      description: 'Generic mushroom'
    }).setGenerator((opts) => vegetationGenerator.generateMushroom({ ...opts, type: 'generic' }))
  );

  assetManager.registerAsset(
    new Asset('toadstool', 'Toadstool', 'biotic', 'flora', {
      tags: ['fungus', 'plant', 'vegetation', 'poisonous'],
      description: 'Red toadstool mushroom'
    }).setGenerator((opts) => vegetationGenerator.generateMushroom({ ...opts, type: 'toadstool' }))
  );

  // FAUNA - Note: Fauna are placeholders for now
  // In a full implementation, these would have proper 3D models or more complex procedural generation
  
  assetManager.registerAsset(
    new Asset('fauna_human', 'Human', 'biotic', 'fauna', {
      tags: ['animal', 'mammal', 'person'],
      description: 'Human figure (placeholder)',
      procedural: false,
      modelUrl: null // Would reference an external model
    })
  );

  assetManager.registerAsset(
    new Asset('fauna_dog', 'Dog', 'biotic', 'fauna', {
      tags: ['animal', 'mammal', 'pet', 'domestic'],
      description: 'Dog (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('fauna_cat', 'Cat', 'biotic', 'fauna', {
      tags: ['animal', 'mammal', 'pet', 'domestic'],
      description: 'Cat (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('fauna_bird', 'Bird', 'biotic', 'fauna', {
      tags: ['animal', 'bird', 'flying'],
      description: 'Generic bird (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  assetManager.registerAsset(
    new Asset('fauna_deer', 'Deer', 'biotic', 'fauna', {
      tags: ['animal', 'mammal', 'wildlife'],
      description: 'Deer (placeholder)',
      procedural: false,
      modelUrl: null
    })
  );

  // Additional fauna entries as placeholders
  const faunaPlaceholders = [
    { id: 'fauna_squirrel', name: 'Squirrel', tags: ['animal', 'mammal', 'rodent'] },
    { id: 'fauna_cattle', name: 'Cattle', tags: ['animal', 'mammal', 'livestock'] },
    { id: 'fauna_whale', name: 'Whale', tags: ['animal', 'mammal', 'marine'] },
    { id: 'fauna_pigeon', name: 'Pigeon', tags: ['animal', 'bird', 'urban'] },
    { id: 'fauna_crow', name: 'Crow', tags: ['animal', 'bird'] },
    { id: 'fauna_robin', name: 'Robin', tags: ['animal', 'bird'] },
    { id: 'fauna_eagle', name: 'Eagle', tags: ['animal', 'bird', 'predator'] },
    { id: 'fauna_seagull', name: 'Seagull', tags: ['animal', 'bird', 'coastal'] },
    { id: 'fauna_ant', name: 'Ant', tags: ['animal', 'insect'] },
    { id: 'fauna_beetle', name: 'Beetle', tags: ['animal', 'insect'] },
    { id: 'fauna_butterfly', name: 'Butterfly', tags: ['animal', 'insect', 'flying'] },
    { id: 'fauna_bee', name: 'Bee', tags: ['animal', 'insect', 'pollinator'] },
    { id: 'fauna_fish', name: 'Fish', tags: ['animal', 'fish', 'aquatic'] },
    { id: 'fauna_lizard', name: 'Lizard', tags: ['animal', 'reptile'] },
    { id: 'fauna_snake', name: 'Snake', tags: ['animal', 'reptile'] },
    { id: 'fauna_turtle', name: 'Turtle', tags: ['animal', 'reptile'] },
    { id: 'fauna_frog', name: 'Frog', tags: ['animal', 'amphibian'] },
  ];

  faunaPlaceholders.forEach(({ id, name, tags }) => {
    assetManager.registerAsset(
      new Asset(id, name, 'biotic', 'fauna', {
        tags,
        description: `${name} (placeholder)`,
        procedural: false,
        modelUrl: null
      })
    );
  });
}
