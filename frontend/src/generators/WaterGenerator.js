/**
 * Water Generator - Procedural generation for water bodies
 * Creates oceans, seas, rivers, lakes, ponds, streams, waterfalls, etc.
 */

import * as THREE from 'three';

export class WaterGenerator {
  constructor(materialSystem) {
    this.materialSystem = materialSystem;
  }

  generateOcean(options = {}) {
    const {
      width = 200,
      depth = 200,
      waveHeight = 0.5,
      segments = 100
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    // Create waves
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      positions[i + 2] = Math.sin(x * 0.1) * Math.cos(y * 0.1) * waveHeight;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('ocean');
    return { geometry, material };
  }

  generateSea(options = {}) {
    const {
      width = 100,
      depth = 100,
      waveHeight = 0.3
    } = options;

    return this.generateOcean({ width, depth, waveHeight, segments: 60 });
  }

  generateRiver(options = {}) {
    const {
      length = 50,
      width = 5,
      segments = 50,
      curvature = 0.3
    } = options;

    const points = [];
    const widthVariation = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = Math.sin(t * Math.PI * 2 * curvature) * 3;
      const z = t * length - length / 2;
      const w = width * (1 + Math.sin(t * Math.PI) * 0.3);
      points.push(new THREE.Vector3(x, 0, z));
      widthVariation.push(w);
    }

    // Create river bed using custom geometry
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];
    
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const w = widthVariation[i];
      const perpendicular = new THREE.Vector3(-1, 0, 0).normalize();
      
      vertices.push(
        point.x - perpendicular.x * w / 2,
        point.y - 0.1,
        point.z - perpendicular.z * w / 2
      );
      
      vertices.push(
        point.x + perpendicular.x * w / 2,
        point.y - 0.1,
        point.z + perpendicular.z * w / 2
      );
      
      if (i < points.length - 1) {
        const idx = i * 2;
        indices.push(idx, idx + 1, idx + 2);
        indices.push(idx + 1, idx + 3, idx + 2);
      }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    
    const material = this.materialSystem.getMaterial('water');
    return { geometry, material };
  }

  generateLake(options = {}) {
    const {
      radius = 15,
      irregularity = 0.3,
      segments = 32
    } = options;

    const geometry = new THREE.CircleGeometry(radius, segments);
    const positions = geometry.attributes.position.array;
    
    // Make the shoreline irregular
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const dist = Math.sqrt(x * x + y * y);
      
      if (dist > radius * 0.7) {
        const noise = Math.sin(x * 2) * Math.cos(y * 2) * irregularity;
        const scale = 1 + noise;
        positions[i] *= scale;
        positions[i + 1] *= scale;
      }
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.05, 0);
    
    const material = this.materialSystem.getMaterial('water');
    return { geometry, material };
  }

  generatePond(options = {}) {
    const {
      radius = 5,
      irregularity = 0.4
    } = options;

    return this.generateLake({ radius, irregularity, segments: 24 });
  }

  generateStream(options = {}) {
    const {
      length = 30,
      width = 2,
      segments = 30,
      curvature = 0.5
    } = options;

    return this.generateRiver({ length, width, segments, curvature });
  }

  generateWaterfall(options = {}) {
    const {
      width = 5,
      height = 8,
      depth = 1
    } = options;

    const geometry = new THREE.PlaneGeometry(width, height, 1, 20);
    const positions = geometry.attributes.position.array;
    
    // Add some flow variation
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      const variance = Math.sin(positions[i] * 2) * 0.2;
      positions[i + 2] = variance * (1 - (y / height + 0.5));
    }
    
    geometry.computeVertexNormals();
    
    const material = this.materialSystem.getMaterial('water');
    return { geometry, material };
  }

  generateBay(options = {}) {
    const {
      radius = 20,
      opening = 0.6,
      segments = 32
    } = options;

    const shape = new THREE.Shape();
    
    // Create bay shape
    for (let i = 0; i <= segments; i++) {
      const angle = (Math.PI * opening) + (i / segments) * (Math.PI * (2 - opening * 2));
      const r = radius * (1 + Math.sin(angle * 2) * 0.2);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      
      if (i === 0) {
        shape.moveTo(x, y);
      } else {
        shape.lineTo(x, y);
      }
    }
    
    shape.closePath();
    
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.05, 0);
    
    const material = this.materialSystem.getMaterial('water');
    return { geometry, material };
  }

  generateGlacier(options = {}) {
    const {
      width = 15,
      depth = 25,
      height = 5,
      segments = 30
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    // Create glacier flow pattern
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const flowPattern = Math.sin(x * 0.5) * Math.cos(y * 0.3);
      positions[i + 2] = flowPattern * height * 0.3 + Math.abs(y / depth) * height;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('ice');
    return { geometry, material };
  }

  generateWetland(options = {}) {
    const {
      width = 25,
      depth = 25,
      segments = 30
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    const positions = geometry.attributes.position.array;
    
    // Create shallow pools and mounds
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const pattern = Math.sin(x * 0.5) * Math.cos(y * 0.5);
      positions[i + 2] = pattern * 0.3;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = this.materialSystem.getMaterial('water');
    material.opacity = 0.5;
    return { geometry, material };
  }

  generateCanal(options = {}) {
    const {
      length = 40,
      width = 4,
      depth = 1
    } = options;

    const geometry = new THREE.BoxGeometry(width, depth, length);
    geometry.translate(0, -depth / 2, 0);
    
    const material = this.materialSystem.getMaterial('water');
    return { geometry, material };
  }

  generateReservoir(options = {}) {
    const {
      radius = 20,
      segments = 32
    } = options;

    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.1, 0);
    
    const material = this.materialSystem.getMaterial('water');
    return { geometry, material };
  }
}

export default WaterGenerator;
