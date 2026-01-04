/**
 * Abiotic Assets - Natural Environment (Non-Living)
 * Landforms, Water Bodies, and Atmospheric Phenomena
 */

import { Asset } from '../../../systems/AssetManager';

export function registerAbioticAssets(assetManager, generators) {
  const { terrainGenerator, waterGenerator, atmosphericGenerator } = generators;

  // LANDFORMS & GEOLOGICAL FEATURES
  assetManager.registerAsset(
    new Asset('mountain', 'Mountain', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'elevation'],
      description: 'Large natural elevation of the earth\'s surface'
    }).setGenerator((opts) => terrainGenerator.generateMountain(opts))
  );

  assetManager.registerAsset(
    new Asset('hill', 'Hill', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'elevation'],
      description: 'Rounded natural elevation, smaller than a mountain'
    }).setGenerator((opts) => terrainGenerator.generateHill(opts))
  );

  assetManager.registerAsset(
    new Asset('valley', 'Valley', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'depression'],
      description: 'Low area between hills or mountains'
    }).setGenerator((opts) => terrainGenerator.generateValley(opts))
  );

  assetManager.registerAsset(
    new Asset('canyon', 'Canyon', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'erosion'],
      description: 'Deep gorge with steep sides'
    }).setGenerator((opts) => terrainGenerator.generateCanyon(opts))
  );

  assetManager.registerAsset(
    new Asset('plain', 'Plain', 'abiotic', 'landforms', {
      tags: ['terrain', 'flat', 'grassland'],
      description: 'Large area of flat land'
    }).setGenerator((opts) => terrainGenerator.generatePlain(opts))
  );

  assetManager.registerAsset(
    new Asset('plateau', 'Plateau/Mesa', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'flat-top'],
      description: 'Elevated flat-topped landform'
    }).setGenerator((opts) => terrainGenerator.generatePlateau(opts))
  );

  assetManager.registerAsset(
    new Asset('desert', 'Desert', 'abiotic', 'landforms', {
      tags: ['terrain', 'arid', 'sand'],
      description: 'Dry, barren area with little precipitation'
    }).setGenerator((opts) => terrainGenerator.generateDesert(opts))
  );

  assetManager.registerAsset(
    new Asset('beach', 'Beach', 'abiotic', 'landforms', {
      tags: ['terrain', 'coastal', 'sand'],
      description: 'Sandy shore beside a body of water'
    }).setGenerator((opts) => terrainGenerator.generateBeach(opts))
  );

  assetManager.registerAsset(
    new Asset('cliff', 'Cliff', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'steep'],
      description: 'Steep rock face'
    }).setGenerator((opts) => terrainGenerator.generateCliff(opts))
  );

  assetManager.registerAsset(
    new Asset('boulder', 'Boulder', 'abiotic', 'landforms', {
      tags: ['rock', 'geology', 'stone'],
      description: 'Large rock'
    }).setGenerator((opts) => terrainGenerator.generateBoulder(opts))
  );

  assetManager.registerAsset(
    new Asset('rock', 'Rock/Stone', 'abiotic', 'landforms', {
      tags: ['rock', 'geology', 'stone'],
      description: 'Small to medium-sized rock'
    }).setGenerator((opts) => terrainGenerator.generateRock(opts))
  );

  assetManager.registerAsset(
    new Asset('volcano', 'Volcano', 'abiotic', 'landforms', {
      tags: ['terrain', 'geology', 'mountain'],
      description: 'Mountain with a crater or vent'
    }).setGenerator((opts) => terrainGenerator.generateVolcano(opts))
  );

  // BODIES OF WATER
  assetManager.registerAsset(
    new Asset('ocean', 'Ocean', 'abiotic', 'water', {
      tags: ['water', 'large', 'saltwater'],
      description: 'Very large body of saltwater'
    }).setGenerator((opts) => waterGenerator.generateOcean(opts))
  );

  assetManager.registerAsset(
    new Asset('sea', 'Sea', 'abiotic', 'water', {
      tags: ['water', 'large', 'saltwater'],
      description: 'Large body of saltwater, smaller than ocean'
    }).setGenerator((opts) => waterGenerator.generateSea(opts))
  );

  assetManager.registerAsset(
    new Asset('river', 'River', 'abiotic', 'water', {
      tags: ['water', 'flowing', 'freshwater'],
      description: 'Large natural stream of water'
    }).setGenerator((opts) => waterGenerator.generateRiver(opts))
  );

  assetManager.registerAsset(
    new Asset('lake', 'Lake', 'abiotic', 'water', {
      tags: ['water', 'still', 'freshwater'],
      description: 'Large body of freshwater surrounded by land'
    }).setGenerator((opts) => waterGenerator.generateLake(opts))
  );

  assetManager.registerAsset(
    new Asset('pond', 'Pond', 'abiotic', 'water', {
      tags: ['water', 'still', 'freshwater', 'small'],
      description: 'Small body of still water'
    }).setGenerator((opts) => waterGenerator.generatePond(opts))
  );

  assetManager.registerAsset(
    new Asset('stream', 'Stream/Creek', 'abiotic', 'water', {
      tags: ['water', 'flowing', 'freshwater', 'small'],
      description: 'Small natural flowing waterway'
    }).setGenerator((opts) => waterGenerator.generateStream(opts))
  );

  assetManager.registerAsset(
    new Asset('bay', 'Bay/Gulf/Cove', 'abiotic', 'water', {
      tags: ['water', 'coastal', 'inlet'],
      description: 'Body of water partly enclosed by land'
    }).setGenerator((opts) => waterGenerator.generateBay(opts))
  );

  assetManager.registerAsset(
    new Asset('glacier', 'Glacier/Ice Cap', 'abiotic', 'water', {
      tags: ['ice', 'frozen', 'cold'],
      description: 'Large mass of ice'
    }).setGenerator((opts) => waterGenerator.generateGlacier(opts))
  );

  assetManager.registerAsset(
    new Asset('wetland', 'Wetland/Marsh/Swamp', 'abiotic', 'water', {
      tags: ['water', 'vegetation', 'ecosystem'],
      description: 'Land area saturated with water'
    }).setGenerator((opts) => waterGenerator.generateWetland(opts))
  );

  assetManager.registerAsset(
    new Asset('waterfall', 'Waterfall/Cascade', 'abiotic', 'water', {
      tags: ['water', 'flowing', 'dramatic'],
      description: 'Water flowing over a vertical drop'
    }).setGenerator((opts) => waterGenerator.generateWaterfall(opts))
  );

  assetManager.registerAsset(
    new Asset('canal', 'Canal', 'abiotic', 'water', {
      tags: ['water', 'artificial', 'manmade'],
      description: 'Man-made waterway'
    }).setGenerator((opts) => waterGenerator.generateCanal(opts))
  );

  assetManager.registerAsset(
    new Asset('reservoir', 'Reservoir', 'abiotic', 'water', {
      tags: ['water', 'artificial', 'manmade'],
      description: 'Man-made lake for water storage'
    }).setGenerator((opts) => waterGenerator.generateReservoir(opts))
  );

  // ATMOSPHERIC & WEATHER PHENOMENA
  assetManager.registerAsset(
    new Asset('sky', 'Sky', 'abiotic', 'atmospheric', {
      tags: ['atmosphere', 'background', 'environment'],
      description: 'The sky above'
    }).setGenerator((opts) => atmosphericGenerator.generateSky(opts))
  );

  assetManager.registerAsset(
    new Asset('cloud', 'Cloud', 'abiotic', 'atmospheric', {
      tags: ['atmosphere', 'weather', 'vapor'],
      description: 'Visible mass of water droplets in air'
    }).setGenerator((opts) => atmosphericGenerator.generateCloud(opts))
  );

  assetManager.registerAsset(
    new Asset('cloud_layer', 'Cloud Layer', 'abiotic', 'atmospheric', {
      tags: ['atmosphere', 'weather', 'vapor', 'multiple'],
      description: 'Layer of multiple clouds'
    }).setGenerator((opts) => atmosphericGenerator.generateCloudLayer(opts))
  );

  assetManager.registerAsset(
    new Asset('sun', 'Sun', 'abiotic', 'atmospheric', {
      tags: ['celestial', 'light', 'day'],
      description: 'The sun, star at the center of the solar system'
    }).setGenerator((opts) => atmosphericGenerator.generateSun(opts))
  );

  assetManager.registerAsset(
    new Asset('moon', 'Moon', 'abiotic', 'atmospheric', {
      tags: ['celestial', 'night', 'satellite'],
      description: 'Earth\'s natural satellite'
    }).setGenerator((opts) => atmosphericGenerator.generateMoon(opts))
  );

  assetManager.registerAsset(
    new Asset('stars', 'Stars', 'abiotic', 'atmospheric', {
      tags: ['celestial', 'night', 'space'],
      description: 'Starry night sky'
    }).setGenerator((opts) => atmosphericGenerator.generateStars(opts))
  );

  assetManager.registerAsset(
    new Asset('rain', 'Rain', 'abiotic', 'atmospheric', {
      tags: ['weather', 'precipitation', 'water'],
      description: 'Rainfall'
    }).setGenerator((opts) => atmosphericGenerator.generateRain(opts))
  );

  assetManager.registerAsset(
    new Asset('snow', 'Snow', 'abiotic', 'atmospheric', {
      tags: ['weather', 'precipitation', 'cold'],
      description: 'Snowfall'
    }).setGenerator((opts) => atmosphericGenerator.generateSnow(opts))
  );

  assetManager.registerAsset(
    new Asset('fog', 'Fog/Mist', 'abiotic', 'atmospheric', {
      tags: ['weather', 'visibility', 'atmosphere'],
      description: 'Thick cloud of water droplets near ground'
    }).setGenerator((opts) => atmosphericGenerator.generateFog(opts))
  );

  assetManager.registerAsset(
    new Asset('rainbow', 'Rainbow', 'abiotic', 'atmospheric', {
      tags: ['weather', 'optical', 'colorful'],
      description: 'Multicolored arc in the sky'
    }).setGenerator((opts) => atmosphericGenerator.generateRainbow(opts))
  );

  assetManager.registerAsset(
    new Asset('lightning', 'Lightning', 'abiotic', 'atmospheric', {
      tags: ['weather', 'storm', 'electrical'],
      description: 'Electrical discharge during a storm'
    }).setGenerator((opts) => atmosphericGenerator.generateLightning(opts))
  );

  assetManager.registerAsset(
    new Asset('sunrise', 'Sunrise/Sunset', 'abiotic', 'atmospheric', {
      tags: ['celestial', 'sky', 'time'],
      description: 'Sunrise or sunset sky'
    }).setGenerator((opts) => atmosphericGenerator.generateSunrise(opts))
  );

  assetManager.registerAsset(
    new Asset('aurora', 'Aurora', 'abiotic', 'atmospheric', {
      tags: ['celestial', 'phenomenon', 'polar'],
      description: 'Aurora Borealis/Australis'
    }).setGenerator((opts) => atmosphericGenerator.generateAurora(opts))
  );
}
