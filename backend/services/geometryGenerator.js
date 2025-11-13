/**
 * Advanced Geometry Generator
 * Generates complex procedural meshes for architectural components
 */

class GeometryGenerator {
  /**
   * Generate complex geometry based on specifications
   */
  async generate(specs) {
    const { type, dimensions, details } = specs;

    switch (type) {
      case 'wall':
        return this.generateWall(dimensions, details);
      case 'window':
        return this.generateWindow(dimensions, details);
      case 'door':
        return this.generateDoor(dimensions, details);
      case 'stairs':
        return this.generateStairs(dimensions, details);
      case 'railing':
        return this.generateRailing(dimensions, details);
      case 'column':
        return this.generateColumn(dimensions, details);
      case 'floor':
        return this.generateFloor(dimensions, details);
      case 'roof':
        return this.generateRoof(dimensions, details);
      case 'building':
        return this.generateBuilding(dimensions, details);
      default:
        return this.generateBox(dimensions);
    }
  }

  /**
   * Generate a wall with optional openings
   */
  generateWall(dimensions, details = {}) {
    const { width = 5000, height = 3000, thickness = 200 } = dimensions;
    const { openings = [] } = details;

    const vertices = [];
    const indices = [];
    const normals = [];
    const uvs = [];

    // Main wall plane
    this.addPlane(vertices, indices, normals, uvs, {
      width,
      height,
      position: [0, height / 2, 0],
      rotation: [0, 0, 0]
    });

    return {
      type: 'BufferGeometry',
      attributes: {
        position: { array: vertices, itemSize: 3 },
        normal: { array: normals, itemSize: 3 },
        uv: { array: uvs, itemSize: 2 }
      },
      index: indices
    };
  }

  /**
   * Generate a window with frame
   */
  generateWindow(dimensions, details = {}) {
    const { width = 1200, height = 1500, depth = 100 } = dimensions;
    const { frameThickness = 50, panes = 2 } = details;

    const parts = [];

    // Frame
    parts.push({
      type: 'box',
      dimensions: { x: width, y: frameThickness, z: depth },
      position: { x: 0, y: height / 2, z: 0 }
    });
    parts.push({
      type: 'box',
      dimensions: { x: width, y: frameThickness, z: depth },
      position: { x: 0, y: -height / 2, z: 0 }
    });
    parts.push({
      type: 'box',
      dimensions: { x: frameThickness, y: height, z: depth },
      position: { x: -width / 2, y: 0, z: 0 }
    });
    parts.push({
      type: 'box',
      dimensions: { x: frameThickness, y: height, z: depth },
      position: { x: width / 2, y: 0, z: 0 }
    });

    // Glass pane
    parts.push({
      type: 'box',
      dimensions: { x: width - frameThickness * 2, y: height - frameThickness * 2, z: 10 },
      position: { x: 0, y: 0, z: 0 },
      material: 'glass'
    });

    return { type: 'composite', parts };
  }

  /**
   * Generate a door with frame
   */
  generateDoor(dimensions, details = {}) {
    const { width = 900, height = 2100, depth = 50 } = dimensions;
    const { frameThickness = 80, handleHeight = 1000 } = details;

    const parts = [];

    // Door panel
    parts.push({
      type: 'box',
      dimensions: { x: width - frameThickness * 2, y: height - frameThickness, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'wood'
    });

    // Frame
    parts.push({
      type: 'box',
      dimensions: { x: width, y: frameThickness, z: depth + 20 },
      position: { x: 0, y: height - frameThickness / 2, z: 0 }
    });
    parts.push({
      type: 'box',
      dimensions: { x: frameThickness, y: height, z: depth + 20 },
      position: { x: -width / 2 + frameThickness / 2, y: height / 2, z: 0 }
    });
    parts.push({
      type: 'box',
      dimensions: { x: frameThickness, y: height, z: depth + 20 },
      position: { x: width / 2 - frameThickness / 2, y: height / 2, z: 0 }
    });

    // Handle
    parts.push({
      type: 'cylinder',
      radius: 15,
      height: 150,
      position: { x: width / 2 - 100, y: handleHeight, z: depth / 2 + 10 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      material: 'metal'
    });

    return { type: 'composite', parts };
  }

  /**
   * Generate stairs with steps
   */
  generateStairs(dimensions, details = {}) {
    const { width = 1200, totalHeight = 3000, depth = 3000 } = dimensions;
    const { numSteps = 15, stepHeight = 200 } = details;

    const parts = [];
    const stepDepth = depth / numSteps;

    for (let i = 0; i < numSteps; i++) {
      parts.push({
        type: 'box',
        dimensions: {
          x: width,
          y: stepHeight,
          z: stepDepth
        },
        position: {
          x: 0,
          y: i * stepHeight + stepHeight / 2,
          z: i * stepDepth + stepDepth / 2
        },
        material: 'concrete'
      });
    }

    return { type: 'composite', parts };
  }

  /**
   * Generate a railing with posts and rails
   */
  generateRailing(dimensions, details = {}) {
    const { length = 5000, height = 1000 } = dimensions;
    const { postSpacing = 1000, postRadius = 25, railRadius = 15 } = details;

    const parts = [];
    const numPosts = Math.ceil(length / postSpacing) + 1;

    // Posts
    for (let i = 0; i < numPosts; i++) {
      parts.push({
        type: 'cylinder',
        radius: postRadius,
        height: height,
        position: {
          x: i * postSpacing - length / 2,
          y: height / 2,
          z: 0
        },
        material: 'metal'
      });
    }

    // Top rail
    parts.push({
      type: 'cylinder',
      radius: railRadius,
      height: length,
      position: { x: 0, y: height, z: 0 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      material: 'metal'
    });

    // Middle rail
    parts.push({
      type: 'cylinder',
      radius: railRadius,
      height: length,
      position: { x: 0, y: height / 2, z: 0 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      material: 'metal'
    });

    return { type: 'composite', parts };
  }

  /**
   * Generate a column
   */
  generateColumn(dimensions, details = {}) {
    const { height = 3000, radius = 200 } = dimensions;
    const { segments = 32, hasBase = true, hasCapital = true } = details;

    const parts = [];

    // Main shaft
    parts.push({
      type: 'cylinder',
      radius: radius,
      height: height * 0.8,
      position: { x: 0, y: height * 0.4, z: 0 },
      segments,
      material: 'marble'
    });

    // Base
    if (hasBase) {
      parts.push({
        type: 'cylinder',
        radius: radius * 1.3,
        height: height * 0.1,
        position: { x: 0, y: height * 0.05, z: 0 },
        segments,
        material: 'marble'
      });
    }

    // Capital
    if (hasCapital) {
      parts.push({
        type: 'cylinder',
        radius: radius * 1.3,
        height: height * 0.1,
        position: { x: 0, y: height * 0.9, z: 0 },
        segments,
        material: 'marble'
      });
    }

    return { type: 'composite', parts };
  }

  /**
   * Generate a floor plane
   */
  generateFloor(dimensions, details = {}) {
    const { width = 10000, depth = 10000, thickness = 100 } = dimensions;

    return {
      type: 'box',
      dimensions: { x: width, y: thickness, z: depth },
      position: { x: 0, y: -thickness / 2, z: 0 },
      material: 'concrete'
    };
  }

  /**
   * Generate a roof
   */
  generateRoof(dimensions, details = {}) {
    const { width = 10000, depth = 10000, height = 2000 } = dimensions;
    const { style = 'flat', overhang = 500 } = details;

    if (style === 'flat') {
      return {
        type: 'box',
        dimensions: { x: width + overhang * 2, y: 100, z: depth + overhang * 2 },
        position: { x: 0, y: height, z: 0 },
        material: 'roofing'
      };
    } else if (style === 'gabled') {
      // Gabled roof (simplified as two sloped planes)
      return {
        type: 'composite',
        parts: [
          {
            type: 'box',
            dimensions: { x: width + overhang * 2, y: 100, z: depth / 2 + overhang },
            position: { x: 0, y: height + height * 0.2, z: -depth / 4 },
            rotation: { x: Math.PI / 6, y: 0, z: 0 },
            material: 'roofing'
          },
          {
            type: 'box',
            dimensions: { x: width + overhang * 2, y: 100, z: depth / 2 + overhang },
            position: { x: 0, y: height + height * 0.2, z: depth / 4 },
            rotation: { x: -Math.PI / 6, y: 0, z: 0 },
            material: 'roofing'
          }
        ]
      };
    }

    return this.generateBox({ width, height: 100, depth });
  }

  /**
   * Generate a complete building
   */
  generateBuilding(dimensions, details = {}) {
    const { width = 10000, height = 15000, depth = 10000 } = dimensions;
    const { numFloors = 5, windowsPerFloor = 10, doorsPerFloor = 2 } = details;

    const parts = [];
    const floorHeight = height / numFloors;

    // Main structure
    parts.push({
      type: 'box',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 },
      material: 'concrete'
    });

    // Add floors
    for (let floor = 0; floor < numFloors; floor++) {
      const floorY = floor * floorHeight;

      // Windows on front face
      const windowWidth = width / (windowsPerFloor + 1);
      for (let w = 0; w < windowsPerFloor; w++) {
        parts.push({
          type: 'box',
          dimensions: { x: windowWidth * 0.7, y: floorHeight * 0.6, z: 50 },
          position: {
            x: (w - windowsPerFloor / 2) * windowWidth,
            y: floorY + floorHeight / 2,
            z: depth / 2 + 25
          },
          material: 'glass'
        });
      }
    }

    // Ground floor doors
    const doorWidth = width / (doorsPerFloor + 1);
    for (let d = 0; d < doorsPerFloor; d++) {
      parts.push({
        type: 'box',
        dimensions: { x: doorWidth * 0.4, y: floorHeight * 0.8, z: 50 },
        position: {
          x: (d - doorsPerFloor / 2 + 0.5) * doorWidth,
          y: floorHeight * 0.4,
          z: depth / 2 + 25
        },
        material: 'wood'
      });
    }

    return { type: 'composite', parts };
  }

  /**
   * Generate a basic box
   */
  generateBox(dimensions) {
    const { width = 1000, height = 1000, depth = 1000 } = dimensions;
    return {
      type: 'box',
      dimensions: { x: width, y: height, z: depth },
      position: { x: 0, y: height / 2, z: 0 }
    };
  }

  /**
   * Helper: Add a plane to vertex arrays
   */
  addPlane(vertices, indices, normals, uvs, config) {
    const { width, height, position = [0, 0, 0], rotation = [0, 0, 0] } = config;
    
    const startIndex = vertices.length / 3;

    // Add vertices for a quad
    vertices.push(
      -width / 2, -height / 2, 0,
      width / 2, -height / 2, 0,
      width / 2, height / 2, 0,
      -width / 2, height / 2, 0
    );

    // Add normals
    for (let i = 0; i < 4; i++) {
      normals.push(0, 0, 1);
    }

    // Add UVs
    uvs.push(
      0, 0,
      1, 0,
      1, 1,
      0, 1
    );

    // Add indices (two triangles)
    indices.push(
      startIndex, startIndex + 1, startIndex + 2,
      startIndex, startIndex + 2, startIndex + 3
    );
  }

  /**
   * Combine multiple geometries into one
   */
  combineGeometry(geometries) {
    if (geometries.length === 1) {
      return geometries[0];
    }

    return {
      type: 'composite',
      parts: geometries
    };
  }

  /**
   * Generate instanced geometry for repeated elements
   */
  generateInstanced(baseGeometry, instances) {
    return {
      type: 'instanced',
      baseGeometry,
      instances: instances.map(inst => ({
        position: inst.position || [0, 0, 0],
        rotation: inst.rotation || [0, 0, 0],
        scale: inst.scale || [1, 1, 1]
      }))
    };
  }
}

module.exports = new GeometryGenerator();
