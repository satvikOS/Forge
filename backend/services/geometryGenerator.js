/**
 * Geometry Generator - Procedural 3D geometry generation
 * Handles generation of architectural elements, props, details, and environments
 */
class GeometryGenerator {
  /**
   * Generate geometry based on specifications
   */
  generateFromSpec(spec) {
    const { objectCount = 1, elements = [], scene = {} } = spec;
    
    // Determine if this is a complex scene or single object
    if (objectCount > 1 || elements.length > 1) {
      return this.generateComplexScene(elements, scene);
    } else {
      const element = elements[0] || { type: 'object', name: 'Object' };
      return this.generateSingleObject(element);
    }
  }

  /**
   * Generate complex scene with multiple objects
   */
  generateComplexScene(elements, sceneConfig) {
    const meshes = [];
    const instances = [];
    
    elements.forEach((element, index) => {
      const quantity = element.quantity || 1;
      
      if (quantity > 1) {
        // Use instancing for repeated elements
        const baseMesh = this.generateElement(element);
        const positions = this.calculateInstancePositions(quantity, element, index);
        instances.push({
          mesh: baseMesh,
          positions,
          count: quantity,
        });
      } else {
        // Generate individual mesh
        const mesh = this.generateElement(element);
        const position = this.calculatePosition(index, elements.length);
        meshes.push({
          ...mesh,
          position,
          name: element.name || `Object_${index}`,
        });
      }
    });
    
    return {
      type: 'scene',
      meshes,
      instances,
      bounds: this.calculateSceneBounds(meshes, instances),
      metadata: sceneConfig,
    };
  }

  /**
   * Generate single object with high detail
   */
  generateSingleObject(element) {
    const geometry = this.generateElement(element);
    
    return {
      type: 'object',
      mesh: geometry,
      name: element.name || 'Object',
      metadata: element,
    };
  }

  /**
   * Generate geometry for a specific element type
   */
  generateElement(element) {
    const type = element.type?.toLowerCase() || 'object';
    
    switch (type) {
      case 'building':
        return this.generateBuilding(element);
      case 'structure':
        return this.generateStructure(element);
      case 'vehicle':
      case 'car':
        return this.generateVehicle(element);
      case 'furniture':
        return this.generateFurniture(element);
      case 'prop':
        return this.generateProp(element);
      case 'terrain':
        return this.generateTerrain(element);
      default:
        return this.generateGenericObject(element);
    }
  }

  /**
   * Generate building geometry
   */
  generateBuilding(element) {
    const { dimensions = {}, details = [] } = element;
    const width = dimensions.width || 20000;
    const height = dimensions.height || 30000;
    const depth = dimensions.depth || 15000;
    
    const parts = [];
    
    // Main structure
    parts.push({
      type: 'box',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'concrete',
      detail: 'main_structure',
    });
    
    // Add floors (horizontal panels)
    const floors = Math.floor(height / 3000);
    for (let i = 1; i < floors; i++) {
      parts.push({
        type: 'box',
        dimensions: { x: width, y: 200, z: depth },
        position: { x: 0, y: i * 3000, z: 0 },
        material: 'concrete',
        detail: 'floor_slab',
      });
    }
    
    // Add facade panels
    parts.push(...this.generateFacadePanels(width, height, depth));
    
    // Add details if specified
    if (details.includes('windows') || details.length === 0) {
      parts.push(...this.generateWindows(width, height, depth, floors));
    }
    
    if (details.includes('railings')) {
      parts.push(...this.generateRailings(width, height, depth));
    }
    
    if (details.includes('pipes') || details.includes('details')) {
      parts.push(...this.generatePipes(width, height, depth));
    }
    
    return {
      type: 'composite',
      parts,
      subdivisions: 1,
      beveling: 0.05,
    };
  }

  /**
   * Generate structure (platform, framework, etc.)
   */
  generateStructure(element) {
    const { dimensions = {}, details = [] } = element;
    const width = dimensions.width || 10000;
    const height = dimensions.height || 5000;
    const depth = dimensions.depth || 10000;
    
    const parts = [];
    
    // Main platform
    parts.push({
      type: 'box',
      dimensions: { x: width, y: 500, z: depth },
      position: { x: 0, y: 0, z: 0 },
      material: 'metal',
      detail: 'platform',
    });
    
    // Support columns
    const columns = 4;
    for (let i = 0; i < columns; i++) {
      for (let j = 0; j < columns; j++) {
        const x = (i - columns / 2 + 0.5) * (width / columns);
        const z = (j - columns / 2 + 0.5) * (depth / columns);
        parts.push({
          type: 'cylinder',
          radius: 200,
          height: height,
          position: { x, y: -height / 2, z },
          material: 'metal',
          detail: 'column',
        });
      }
    }
    
    // Add beams
    parts.push(...this.generateBeams(width, height, depth));
    
    return {
      type: 'composite',
      parts,
      subdivisions: 0,
      beveling: 0.02,
    };
  }

  /**
   * Generate vehicle geometry
   */
  generateVehicle(element) {
    const { dimensions = {} } = element;
    const length = dimensions.width || dimensions.length || 4500;
    const width = dimensions.depth || dimensions.width || 1850;
    const height = dimensions.height || 1450;
    
    const parts = [];
    
    // Main body
    parts.push({
      type: 'box',
      dimensions: { x: length * 0.8, y: height * 0.5, z: width },
      position: { x: 0, y: height * 0.25, z: 0 },
      material: 'metal',
      detail: 'body',
      subdivisions: 2,
    });
    
    // Cabin/roof
    parts.push({
      type: 'box',
      dimensions: { x: length * 0.4, y: height * 0.3, z: width * 0.9 },
      position: { x: length * 0.1, y: height * 0.65, z: 0 },
      material: 'glass',
      detail: 'cabin',
      subdivisions: 1,
    });
    
    // Wheels
    const wheelRadius = height * 0.3;
    const wheelPositions = [
      { x: length * 0.3, z: width * 0.4 },
      { x: length * 0.3, z: -width * 0.4 },
      { x: -length * 0.3, z: width * 0.4 },
      { x: -length * 0.3, z: -width * 0.4 },
    ];
    
    wheelPositions.forEach((pos, i) => {
      parts.push({
        type: 'cylinder',
        radius: wheelRadius,
        height: 200,
        position: { x: pos.x, y: 0, z: pos.z },
        rotation: { x: 0, y: 0, z: Math.PI / 2 },
        material: 'plastic',
        detail: `wheel_${i}`,
      });
    });
    
    return {
      type: 'composite',
      parts,
      subdivisions: 2,
      beveling: 0.08,
    };
  }

  /**
   * Generate furniture geometry
   */
  generateFurniture(element) {
    const { dimensions = {}, name = '' } = element;
    const width = dimensions.width || 800;
    const height = dimensions.height || 1000;
    const depth = dimensions.depth || 800;
    
    const parts = [];
    
    if (name.toLowerCase().includes('chair')) {
      // Chair seat
      parts.push({
        type: 'box',
        dimensions: { x: width, y: 50, z: depth },
        position: { x: 0, y: height * 0.45, z: 0 },
        material: 'plastic',
        detail: 'seat',
      });
      
      // Chair back
      parts.push({
        type: 'box',
        dimensions: { x: width, y: height * 0.5, z: 50 },
        position: { x: 0, y: height * 0.7, z: -depth * 0.45 },
        material: 'plastic',
        detail: 'back',
      });
      
      // Chair legs
      for (let i = 0; i < 4; i++) {
        const x = (i % 2 - 0.5) * width * 0.8;
        const z = (Math.floor(i / 2) - 0.5) * depth * 0.8;
        parts.push({
          type: 'cylinder',
          radius: 25,
          height: height * 0.45,
          position: { x, y: height * 0.225, z },
          material: 'metal',
          detail: `leg_${i}`,
        });
      }
    } else if (name.toLowerCase().includes('desk') || name.toLowerCase().includes('table')) {
      // Desk top
      parts.push({
        type: 'box',
        dimensions: { x: width, y: 50, z: depth },
        position: { x: 0, y: height * 0.7, z: 0 },
        material: 'wood',
        detail: 'top',
      });
      
      // Desk legs
      for (let i = 0; i < 4; i++) {
        const x = (i % 2 - 0.5) * width * 0.9;
        const z = (Math.floor(i / 2) - 0.5) * depth * 0.9;
        parts.push({
          type: 'box',
          dimensions: { x: 80, y: height * 0.7, z: 80 },
          position: { x, y: height * 0.35, z },
          material: 'metal',
          detail: `leg_${i}`,
        });
      }
    } else {
      // Generic furniture
      parts.push({
        type: 'box',
        dimensions: { x: width, y: height, z: depth },
        position: { x: 0, y: height / 2, z: 0 },
        material: 'wood',
        detail: 'main',
      });
    }
    
    return {
      type: 'composite',
      parts,
      subdivisions: 1,
      beveling: 0.05,
    };
  }

  /**
   * Generate prop geometry
   */
  generateProp(element) {
    const { dimensions = {} } = element;
    const width = dimensions.width || 1000;
    const height = dimensions.height || 1000;
    const depth = dimensions.depth || 1000;
    
    return {
      type: 'composite',
      parts: [
        {
          type: 'box',
          dimensions: { x: width, y: height, z: depth },
          position: { x: 0, y: height / 2, z: 0 },
          material: 'default',
          detail: 'main',
        },
      ],
      subdivisions: 1,
      beveling: 0.05,
    };
  }

  /**
   * Generate terrain geometry
   */
  generateTerrain(element) {
    const { dimensions = {} } = element;
    const width = dimensions.width || 50000;
    const depth = dimensions.depth || 50000;
    
    return {
      type: 'plane',
      dimensions: { x: width, z: depth },
      position: { x: 0, y: 0, z: 0 },
      material: 'concrete',
      detail: 'terrain',
      subdivisions: 10,
    };
  }

  /**
   * Generate generic object
   */
  generateGenericObject(element) {
    const { dimensions = {} } = element;
    const width = dimensions.width || 1000;
    const height = dimensions.height || 1000;
    const depth = dimensions.depth || 1000;
    
    return {
      type: 'box',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'default',
    };
  }

  /**
   * Generate facade panels for buildings
   */
  generateFacadePanels(width, height, depth) {
    const panels = [];
    const panelHeight = 3000;
    const panelWidth = 2000;
    const floors = Math.floor(height / panelHeight);
    
    // Front facade
    for (let floor = 0; floor < floors; floor++) {
      for (let i = 0; i < Math.floor(width / panelWidth); i++) {
        panels.push({
          type: 'box',
          dimensions: { x: panelWidth, y: panelHeight, z: 50 },
          position: {
            x: (i - Math.floor(width / panelWidth) / 2 + 0.5) * panelWidth,
            y: floor * panelHeight + panelHeight / 2,
            z: depth / 2 + 25,
          },
          material: 'glass',
          detail: 'facade_panel',
        });
      }
    }
    
    return panels;
  }

  /**
   * Generate windows for buildings
   */
  generateWindows(width, height, depth, floors) {
    const windows = [];
    const windowWidth = 1500;
    const windowHeight = 2000;
    const windowsPerFloor = Math.floor(width / 2500);
    
    for (let floor = 1; floor < floors; floor++) {
      for (let i = 0; i < windowsPerFloor; i++) {
        // Front windows
        windows.push({
          type: 'box',
          dimensions: { x: windowWidth, y: windowHeight, z: 100 },
          position: {
            x: (i - windowsPerFloor / 2 + 0.5) * 2500,
            y: floor * 3000 + 1500,
            z: depth / 2 + 100,
          },
          material: 'glass',
          detail: 'window',
        });
      }
    }
    
    return windows;
  }

  /**
   * Generate railings
   */
  generateRailings(width, height, depth) {
    const railings = [];
    const railHeight = 1000;
    const railRadius = 30;
    
    // Roof railing
    const posts = Math.floor(width / 2000);
    for (let i = 0; i <= posts; i++) {
      railings.push({
        type: 'cylinder',
        radius: railRadius,
        height: railHeight,
        position: {
          x: (i - posts / 2) * 2000,
          y: height + railHeight / 2,
          z: depth / 2,
        },
        material: 'metal',
        detail: 'railing_post',
      });
    }
    
    return railings;
  }

  /**
   * Generate pipes and cables
   */
  generatePipes(width, height, depth) {
    const pipes = [];
    const pipeRadius = 100;
    const pipeCount = 3;
    
    for (let i = 0; i < pipeCount; i++) {
      pipes.push({
        type: 'cylinder',
        radius: pipeRadius,
        height: height,
        position: {
          x: width / 2 + 200,
          y: height / 2,
          z: (i - pipeCount / 2) * 500,
        },
        material: 'metal',
        detail: 'pipe',
      });
    }
    
    return pipes;
  }

  /**
   * Generate structural beams
   */
  generateBeams(width, height, depth) {
    const beams = [];
    const beamWidth = 200;
    const beamHeight = 300;
    
    // Horizontal beams along width
    const beamCount = 3;
    for (let i = 0; i < beamCount; i++) {
      beams.push({
        type: 'box',
        dimensions: { x: width, y: beamHeight, z: beamWidth },
        position: {
          x: 0,
          y: 0,
          z: (i - beamCount / 2) * (depth / beamCount),
        },
        material: 'metal',
        detail: 'beam',
      });
    }
    
    return beams;
  }

  /**
   * Calculate instance positions for repeated elements
   */
  calculateInstancePositions(count, element, index) {
    const positions = [];
    const gridSize = Math.ceil(Math.sqrt(count));
    const spacing = 3000;
    
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      positions.push({
        x: (col - gridSize / 2) * spacing,
        y: 0,
        z: (row - gridSize / 2) * spacing + index * 5000,
      });
    }
    
    return positions;
  }

  /**
   * Calculate position for object in scene
   */
  calculatePosition(index, total) {
    const spacing = 5000;
    return {
      x: (index - total / 2) * spacing,
      y: 0,
      z: 0,
    };
  }

  /**
   * Calculate scene bounds
   */
  calculateSceneBounds(meshes, instances) {
    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
    
    meshes.forEach(mesh => {
      const pos = mesh.position || { x: 0, y: 0, z: 0 };
      const dim = mesh.dimensions || { x: 1000, y: 1000, z: 1000 };
      minX = Math.min(minX, pos.x - dim.x / 2);
      maxX = Math.max(maxX, pos.x + dim.x / 2);
      minY = Math.min(minY, pos.y - dim.y / 2);
      maxY = Math.max(maxY, pos.y + dim.y / 2);
      minZ = Math.min(minZ, pos.z - dim.z / 2);
      maxZ = Math.max(maxZ, pos.z + dim.z / 2);
    });
    
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      center: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2,
      },
    };
  }
}

module.exports = new GeometryGenerator();
