/**
 * Terrain Generator - Procedural generation for landforms and geological features
 * Creates mountains, hills, valleys, canyons, plains, plateaus, etc.
 */

import * as THREE from 'three';

export class TerrainGenerator {
  constructor(materialSystem) {
    this.materialSystem = materialSystem;
  }

  // Helper: Generate height map noise
  generateHeightMap(width, depth, scale = 1, octaves = 4) {
    const size = width * depth;
    const data = new Float32Array(size);
    
    for (let i = 0; i < size; i++) {
      const x = (i % width) / width;
      const z = Math.floor(i / width) / depth;
      
      let height = 0;
      let amplitude = 1;
      let frequency = 1;
      
      for (let o = 0; o < octaves; o++) {
        height += this.noise2D(x * frequency * scale, z * frequency * scale) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      
      data[i] = height;
    }
    
    return data;
  }

  // Simple 2D noise function (placeholder - could use simplex noise library)
  noise2D(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
    return (n - Math.floor(n)) * 2 - 1;
  }

  generateMountain(options = {}) {
    const {
      width = 20,
      depth = 20,
      height = 10,
      segments = 50,
      roughness = 0.7
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    const heightMap = this.generateHeightMap(segments + 1, segments + 1, 5, 6);
    
    for (let i = 0; i < positions.length; i += 3) {
      const heightIndex = Math.floor((i / 3) % (segments + 1)) + 
                         Math.floor((i / 3) / (segments + 1)) * (segments + 1);
      positions[i + 2] = heightMap[heightIndex] * height * roughness;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('rock');
    return { geometry, material };
  }

  generateHill(options = {}) {
    const {
      radius = 5,
      height = 3,
      segments = 32
    } = options;

    const geometry = new THREE.SphereGeometry(radius, segments, segments, 0, Math.PI * 2, 0, Math.PI / 2);
    const positions = geometry.attributes.position.array;
    
    // Add some variation to make it more natural
    for (let i = 0; i < positions.length; i += 3) {
      const variance = this.noise2D(positions[i], positions[i + 1]) * 0.3;
      positions[i + 2] = Math.max(0, positions[i + 2] + variance);
    }
    
    geometry.computeVertexNormals();
    
    const material = this.materialSystem.getMaterial('grass');
    return { geometry, material };
  }

  generateValley(options = {}) {
    const {
      width = 15,
      depth = 30,
      depth_amount = 5,
      segments = 40
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const distFromCenter = Math.abs(x) / (width / 2);
      const valleyDepth = Math.pow(distFromCenter, 2) * depth_amount;
      positions[i + 2] = -valleyDepth;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('dirt');
    return { geometry, material };
  }

  generateCanyon(options = {}) {
    const {
      width = 20,
      depth = 40,
      height = 15,
      segments = 50
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const distFromCenter = Math.abs(x) / (width / 2);
      
      // Create steep canyon walls
      if (distFromCenter > 0.3) {
        positions[i + 2] = Math.pow((distFromCenter - 0.3) * 2, 1.5) * height;
      } else {
        positions[i + 2] = this.noise2D(x, y) * 0.5;
      }
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('rock');
    return { geometry, material };
  }

  generatePlain(options = {}) {
    const {
      width = 50,
      depth = 50,
      variation = 0.2
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, 20, 20);
    const positions = geometry.attributes.position.array;
    
    // Add subtle variation
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 2] = this.noise2D(positions[i], positions[i + 1]) * variation;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('grass');
    return { geometry, material };
  }

  generatePlateau(options = {}) {
    const {
      width = 15,
      depth = 15,
      height = 8,
      segments = 20
    } = options;

    const geometry = new THREE.BoxGeometry(width, height, depth, segments, 1, segments);
    const positions = geometry.attributes.position.array;
    
    // Add erosion effects on top
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 1] > height / 2 - 0.1) {
        positions[i + 1] += this.noise2D(positions[i], positions[i + 2]) * 0.5;
      }
    }
    
    geometry.computeVertexNormals();
    
    const material = this.materialSystem.getMaterial('rock');
    return { geometry, material };
  }

  generateDesert(options = {}) {
    const {
      width = 40,
      depth = 40,
      duneHeight = 3,
      segments = 40
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    // Create sand dunes
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      positions[i + 2] = Math.sin(x * 0.3) * Math.cos(y * 0.2) * duneHeight + 
                         this.noise2D(x * 0.1, y * 0.1) * duneHeight * 0.5;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('sand');
    return { geometry, material };
  }

  generateBeach(options = {}) {
    const {
      width = 30,
      depth = 10,
      slope = 0.3
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, 30, 10);
    const positions = geometry.attributes.position.array;
    
    // Create gentle slope toward water
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      positions[i + 2] = (y / depth) * slope * depth + this.noise2D(positions[i], y) * 0.1;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('sand');
    return { geometry, material };
  }

  generateCliff(options = {}) {
    const {
      width = 10,
      height = 15,
      depth = 3
    } = options;

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = this.materialSystem.getMaterial('rock');
    return { geometry, material };
  }

  generateBoulder(options = {}) {
    const {
      radius = 2,
      detail = 1
    } = options;

    const geometry = new THREE.IcosahedronGeometry(radius, detail);
    const positions = geometry.attributes.position.array;
    
    // Add irregularity
    for (let i = 0; i < positions.length; i += 3) {
      const variance = this.noise2D(positions[i], positions[i + 1]) * 0.3;
      positions[i] *= (1 + variance);
      positions[i + 1] *= (1 + variance);
      positions[i + 2] *= (1 + variance);
    }
    
    geometry.computeVertexNormals();
    
    const material = this.materialSystem.getMaterial('rock');
    return { geometry, material };
  }

  generateRock(options = {}) {
    const {
      size = 0.5,
      detail = 0
    } = options;

    return this.generateBoulder({ radius: size, detail });
  }

  generateVolcano(options = {}) {
    const {
      radius = 10,
      height = 15,
      craterRadius = 3
    } = options;

    const geometry = new THREE.ConeGeometry(radius, height, 32);
    
    // Create crater at top by modifying vertices
    const positions = geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i + 1] > height * 0.4) {
        const distFromCenter = Math.sqrt(positions[i] * positions[i] + positions[i + 2] * positions[i + 2]);
        if (distFromCenter < craterRadius) {
          positions[i + 1] *= 0.6;
        }
      }
    }
    
    geometry.computeVertexNormals();
    
    const material = this.materialSystem.getMaterial('rock');
    return { geometry, material };
  }
}

export default TerrainGenerator;
