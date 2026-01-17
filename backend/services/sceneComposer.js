/**
 * Scene Composition System
 * Handles multi-object environment generation and spatial placement
 */

const geometryGenerator = require('./geometryGenerator');

class SceneComposer {
  /**
   * Generate a complete scene from specifications
   */
  async generateScene(sceneSpecs) {
    const { objects = [], environment = {}, lighting = {}, camera = {} } = sceneSpecs;

    const sceneObjects = [];
    const placedPositions = [];

    // Process each object in the scene
    for (const objSpec of objects) {
      const position = await this.findValidPosition(
        objSpec,
        placedPositions,
        environment
      );

      const geometry = await geometryGenerator.generate(objSpec);

      const sceneObject = {
        id: objSpec.id || this.generateId(),
        geometry,
        position: position || objSpec.position || { x: 0, y: 0, z: 0 },
        rotation: objSpec.rotation || { x: 0, y: 0, z: 0 },
        scale: objSpec.scale || { x: 1, y: 1, z: 1 },
        material: objSpec.material || this.getDefaultMaterial(objSpec.type),
        metadata: {
          type: objSpec.type,
          name: objSpec.name || objSpec.type,
          tags: objSpec.tags || []
        }
      };

      sceneObjects.push(sceneObject);
      
      if (position) {
        placedPositions.push({
          position,
          bounds: this.calculateBounds(objSpec.dimensions, position)
        });
      }
    }

    return {
      objects: sceneObjects,
      environment: this.setupEnvironment(environment),
      lighting: this.setupLighting(lighting),
      camera: this.setupCamera(camera, sceneObjects),
      metadata: {
        objectCount: sceneObjects.length,
        bounds: this.calculateSceneBounds(sceneObjects),
        created: new Date().toISOString()
      }
    };
  }

  /**
   * Generate a room/interior environment
   */
  async generateRoom(specs) {
    const {
      width = 8000,
      height = 3000,
      depth = 6000,
      style = 'modern',
      furniture = true
    } = specs;

    const objects = [];

    // Floor
    objects.push({
      type: 'floor',
      dimensions: { width, depth, thickness: 100 },
      position: { x: 0, y: 0, z: 0 },
      material: 'wood_floor'
    });

    // Walls
    objects.push({
      type: 'wall',
      dimensions: { width, height, thickness: 200 },
      position: { x: 0, y: 0, z: -depth / 2 },
      material: 'wall_paint'
    });
    objects.push({
      type: 'wall',
      dimensions: { width: depth, height, thickness: 200 },
      position: { x: -width / 2, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      material: 'wall_paint'
    });
    objects.push({
      type: 'wall',
      dimensions: { width: depth, height, thickness: 200 },
      position: { x: width / 2, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      material: 'wall_paint'
    });
    objects.push({
      type: 'wall',
      dimensions: { width, height, thickness: 200 },
      position: { x: 0, y: 0, z: depth / 2 },
      material: 'wall_paint'
    });

    // Ceiling
    objects.push({
      type: 'floor',
      dimensions: { width, depth, thickness: 100 },
      position: { x: 0, y: height, z: 0 },
      material: 'ceiling'
    });

    // Windows
    objects.push({
      type: 'window',
      dimensions: { width: 1500, height: 2000, depth: 100 },
      position: { x: -width / 4, y: height / 2, z: -depth / 2 },
      material: 'glass'
    });
    objects.push({
      type: 'window',
      dimensions: { width: 1500, height: 2000, depth: 100 },
      position: { x: width / 4, y: height / 2, z: -depth / 2 },
      material: 'glass'
    });

    // Door
    objects.push({
      type: 'door',
      dimensions: { width: 900, height: 2100, depth: 50 },
      position: { x: width / 2 - 600, y: 0, z: depth / 2 },
      material: 'wood'
    });

    return objects;
  }

  /**
   * Generate a building exterior
   */
  async generateBuilding(specs) {
    const {
      width = 20000,
      height = 30000,
      depth = 15000,
      numFloors = 10,
      style = 'modern'
    } = specs;

    const objects = [];

    // Main building structure
    objects.push({
      type: 'building',
      dimensions: { width, height, depth },
      details: { numFloors, windowsPerFloor: 8, doorsPerFloor: 2 },
      position: { x: 0, y: 0, z: 0 },
      material: 'concrete'
    });

    // Entrance stairs
    objects.push({
      type: 'stairs',
      dimensions: { width: 3000, totalHeight: 500, depth: 2000 },
      details: { numSteps: 5 },
      position: { x: 0, y: 0, z: depth / 2 + 1000 },
      material: 'marble'
    });

    // Entrance columns
    objects.push({
      type: 'column',
      dimensions: { height: height / numFloors, radius: 300 },
      position: { x: -1500, y: 0, z: depth / 2 + 500 },
      material: 'marble'
    });
    objects.push({
      type: 'column',
      dimensions: { height: height / numFloors, radius: 300 },
      position: { x: 1500, y: 0, z: depth / 2 + 500 },
      material: 'marble'
    });

    return objects;
  }

  /**
   * Generate a cityscape with multiple buildings
   */
  async generateCityscape(specs) {
    const {
      gridSize = 5,
      spacing = 30000,
      minHeight = 10000,
      maxHeight = 50000,
      style = 'modern'
    } = specs;

    const objects = [];

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        // Skip some positions for roads
        if (x % 2 === 1 && z % 2 === 1) {
          const buildingHeight = minHeight + Math.random() * (maxHeight - minHeight);
          const buildingWidth = 8000 + Math.random() * 8000;
          const buildingDepth = 8000 + Math.random() * 8000;

          objects.push({
            type: 'building',
            dimensions: {
              width: buildingWidth,
              height: buildingHeight,
              depth: buildingDepth
            },
            details: {
              numFloors: Math.floor(buildingHeight / 3000),
              windowsPerFloor: Math.floor(buildingWidth / 1500)
            },
            position: {
              x: (x - gridSize / 2) * spacing,
              y: 0,
              z: (z - gridSize / 2) * spacing
            },
            material: 'concrete'
          });
        }
      }
    }

    // Add ground plane
    objects.push({
      type: 'floor',
      dimensions: {
        width: gridSize * spacing * 1.5,
        depth: gridSize * spacing * 1.5,
        thickness: 100
      },
      position: { x: 0, y: -100, z: 0 },
      material: 'asphalt'
    });

    return objects;
  }

  /**
   * Find a valid position for an object without overlaps
   */
  async findValidPosition(objSpec, placedPositions, environment) {
    if (objSpec.position) {
      return objSpec.position;
    }

    const bounds = this.calculateBounds(objSpec.dimensions, { x: 0, y: 0, z: 0 });
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const testPosition = this.generateRandomPosition(environment);
      const testBounds = this.calculateBounds(objSpec.dimensions, testPosition);

      let hasCollision = false;
      for (const placed of placedPositions) {
        if (this.checkCollision(testBounds, placed.bounds)) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        return testPosition;
      }
    }

    // If no valid position found, return a default position
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * Generate a random position within environment bounds
   */
  generateRandomPosition(environment) {
    const { width = 10000, depth = 10000 } = environment;
    return {
      x: (Math.random() - 0.5) * width,
      y: 0,
      z: (Math.random() - 0.5) * depth
    };
  }

  /**
   * Calculate bounding box for an object
   */
  calculateBounds(dimensions, position) {
    const { width = 1000, height = 1000, depth = 1000 } = dimensions;
    return {
      min: {
        x: position.x - width / 2,
        y: position.y,
        z: position.z - depth / 2
      },
      max: {
        x: position.x + width / 2,
        y: position.y + height,
        z: position.z + depth / 2
      }
    };
  }

  /**
   * Check collision between two bounding boxes
   */
  checkCollision(bounds1, bounds2) {
    return !(
      bounds1.max.x < bounds2.min.x ||
      bounds1.min.x > bounds2.max.x ||
      bounds1.max.y < bounds2.min.y ||
      bounds1.min.y > bounds2.max.y ||
      bounds1.max.z < bounds2.min.z ||
      bounds1.min.z > bounds2.max.z
    );
  }

  /**
   * Calculate bounds for entire scene
   */
  calculateSceneBounds(objects) {
    if (objects.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const obj of objects) {
      const pos = obj.position;
      // Rough estimation based on position
      minX = Math.min(minX, pos.x - 1000);
      minY = Math.min(minY, pos.y);
      minZ = Math.min(minZ, pos.z - 1000);
      maxX = Math.max(maxX, pos.x + 1000);
      maxY = Math.max(maxY, pos.y + 3000);
      maxZ = Math.max(maxZ, pos.z + 1000);
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }

  /**
   * Setup environment settings
   */
  setupEnvironment(environment) {
    return {
      fog: environment.fog || { enabled: true, color: 0xcccccc, near: 10000, far: 50000 },
      background: environment.background || { color: 0x87ceeb },
      ground: environment.ground || { enabled: true, color: 0x7cba65 }
    };
  }

  /**
   * Setup lighting configuration
   */
  setupLighting(lighting) {
    return {
      ambient: lighting.ambient || {
        enabled: true,
        color: 0xffffff,
        intensity: 0.5
      },
      directional: lighting.directional || [
        {
          enabled: true,
          color: 0xffffff,
          intensity: 0.8,
          position: { x: 10000, y: 20000, z: 10000 },
          castShadow: true
        }
      ],
      point: lighting.point || [],
      spot: lighting.spot || []
    };
  }

  /**
   * Setup camera configuration
   */
  setupCamera(camera, objects) {
    const sceneBounds = this.calculateSceneBounds(objects);
    const centerX = (sceneBounds.min.x + sceneBounds.max.x) / 2;
    const centerY = (sceneBounds.min.y + sceneBounds.max.y) / 2;
    const centerZ = (sceneBounds.min.z + sceneBounds.max.z) / 2;

    const sizeX = sceneBounds.max.x - sceneBounds.min.x;
    const sizeY = sceneBounds.max.y - sceneBounds.min.y;
    const sizeZ = sceneBounds.max.z - sceneBounds.min.z;
    const maxSize = Math.max(sizeX, sizeY, sizeZ);

    return {
      type: camera.type || 'perspective',
      position: camera.position || {
        x: centerX + maxSize * 1.5,
        y: centerY + maxSize * 0.5,
        z: centerZ + maxSize * 1.5
      },
      target: camera.target || {
        x: centerX,
        y: centerY,
        z: centerZ
      },
      fov: camera.fov || 60,
      near: camera.near || 0.1,
      far: camera.far || maxSize * 10
    };
  }

  /**
   * Get default material for object type
   */
  getDefaultMaterial(type) {
    const materials = {
      wall: 'concrete',
      floor: 'wood',
      window: 'glass',
      door: 'wood',
      stairs: 'concrete',
      railing: 'metal',
      column: 'marble',
      roof: 'roofing',
      building: 'concrete'
    };

    return materials[type] || 'default';
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create instanced objects for performance
   */
  createInstances(baseObject, count, distribution = 'grid') {
    const instances = [];
    
    if (distribution === 'grid') {
      const gridSize = Math.ceil(Math.sqrt(count));
      const spacing = 2000;
      
      for (let i = 0; i < count; i++) {
        const x = (i % gridSize - gridSize / 2) * spacing;
        const z = (Math.floor(i / gridSize) - gridSize / 2) * spacing;
        
        instances.push({
          ...baseObject,
          id: this.generateId(),
          position: { x, y: 0, z }
        });
      }
    } else if (distribution === 'random') {
      for (let i = 0; i < count; i++) {
        instances.push({
          ...baseObject,
          id: this.generateId(),
          position: this.generateRandomPosition({ width: 10000, depth: 10000 })
        });
      }
    }

    return instances;
  }
}

module.exports = new SceneComposer();
