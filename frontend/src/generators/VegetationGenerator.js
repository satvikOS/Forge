/**
 * Vegetation Generator - Procedural generation for flora (plants)
 * Creates trees, shrubs, grass, flowers, crops, etc.
 */

import * as THREE from 'three';

export class VegetationGenerator {
  constructor(materialSystem) {
    this.materialSystem = materialSystem;
  }

  // Tree generators
  generateDeciduousTree(options = {}) {
    const {
      trunkHeight = 3,
      trunkRadius = 0.2,
      canopyRadius = 2,
      species = 'oak' // oak, maple, birch, cherry
    } = options;

    const group = new THREE.Group();

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(
      trunkRadius * 0.8,
      trunkRadius,
      trunkHeight,
      8
    );
    const trunkMaterial = this.materialSystem.getMaterial('bark');
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    group.add(trunk);

    // Canopy
    const canopyGeometry = new THREE.SphereGeometry(canopyRadius, 8, 8);
    const canopyMaterial = this.materialSystem.getMaterial('leaves');
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.y = trunkHeight + canopyRadius * 0.7;
    canopy.scale.set(1, 0.8, 1);
    group.add(canopy);

    return group;
  }

  generateConiferousTree(options = {}) {
    const {
      height = 5,
      baseRadius = 1.5,
      species = 'pine' // pine, spruce, fir
    } = options;

    const group = new THREE.Group();

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, height * 0.8, 8);
    const trunkMaterial = this.materialSystem.getMaterial('bark');
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = height * 0.4;
    group.add(trunk);

    // Conical foliage
    const layers = 4;
    const foliageMaterial = this.materialSystem.getMaterial('leaves');
    
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const radius = baseRadius * (1 - t * 0.7);
      const layerHeight = height * 0.3;
      const layerGeometry = new THREE.ConeGeometry(radius, layerHeight, 8);
      const layer = new THREE.Mesh(layerGeometry, foliageMaterial);
      layer.position.y = height * 0.3 + i * (height * 0.5) / layers;
      group.add(layer);
    }

    return group;
  }

  generatePalmTree(options = {}) {
    const {
      trunkHeight = 4,
      trunkRadius = 0.3
    } = options;

    const group = new THREE.Group();

    // Trunk with segments
    const segments = 8;
    for (let i = 0; i < segments; i++) {
      const segmentGeometry = new THREE.CylinderGeometry(
        trunkRadius * (1 - i * 0.05),
        trunkRadius * (1 - (i + 1) * 0.05),
        trunkHeight / segments,
        6
      );
      const trunkMaterial = this.materialSystem.getMaterial('bark');
      const segment = new THREE.Mesh(segmentGeometry, trunkMaterial);
      segment.position.y = i * (trunkHeight / segments) + trunkHeight / (segments * 2);
      group.add(segment);
    }

    // Palm fronds
    const frondCount = 8;
    const frondMaterial = this.materialSystem.getMaterial('leaves');
    
    for (let i = 0; i < frondCount; i++) {
      const angle = (i / frondCount) * Math.PI * 2;
      const frondGeometry = new THREE.PlaneGeometry(2, 0.5, 1, 4);
      const positions = frondGeometry.attributes.position.array;
      
      // Curve the frond
      for (let j = 0; j < positions.length; j += 3) {
        const y = positions[j + 1];
        positions[j + 2] = (y / 2) * Math.abs(y) * 0.5;
      }
      
      frondGeometry.computeVertexNormals();
      const frond = new THREE.Mesh(frondGeometry, frondMaterial);
      frond.position.y = trunkHeight;
      frond.rotation.z = Math.PI / 6;
      frond.rotation.y = angle;
      group.add(frond);
    }

    return group;
  }

  generateShrub(options = {}) {
    const {
      radius = 0.8,
      height = 1.2
    } = options;

    const geometry = new THREE.SphereGeometry(radius, 8, 6);
    geometry.scale(1, height / radius, 1);
    const material = this.materialSystem.getMaterial('foliage');
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height / 2;
    
    return mesh;
  }

  generateGrass(options = {}) {
    const {
      width = 10,
      depth = 10,
      density = 0.5
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2);
    const material = this.materialSystem.getMaterial('grass');
    
    return new THREE.Mesh(geometry, material);
  }

  generateFlower(options = {}) {
    const {
      type = 'generic', // rose, daisy, tulip
      stemHeight = 0.5
    } = options;

    const group = new THREE.Group();

    // Stem
    const stemGeometry = new THREE.CylinderGeometry(0.02, 0.02, stemHeight, 4);
    const stemMaterial = this.materialSystem.getMaterial('foliage');
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = stemHeight / 2;
    group.add(stem);

    // Flower head
    const petalCount = 6;
    const petalMaterial = new THREE.MeshStandardMaterial({
      color: type === 'rose' ? 0xff0000 : type === 'daisy' ? 0xffffff : 0xff69b4,
      side: THREE.DoubleSide
    });
    
    for (let i = 0; i < petalCount; i++) {
      const angle = (i / petalCount) * Math.PI * 2;
      const petalGeometry = new THREE.CircleGeometry(0.15, 8);
      const petal = new THREE.Mesh(petalGeometry, petalMaterial);
      petal.position.set(
        Math.cos(angle) * 0.15,
        stemHeight,
        Math.sin(angle) * 0.15
      );
      petal.rotation.x = -Math.PI / 3;
      group.add(petal);
    }

    // Center
    const centerGeometry = new THREE.SphereGeometry(0.08, 8, 8);
    const centerMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    center.position.y = stemHeight;
    group.add(center);

    return group;
  }

  generateMoss(options = {}) {
    const {
      width = 2,
      depth = 2
    } = options;

    const geometry = new THREE.PlaneGeometry(width, depth, 4, 4);
    const positions = geometry.attributes.position.array;
    
    // Add some variation
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 2] += (Math.random() - 0.5) * 0.05;
    }
    
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x2d5016,
      roughness: 1
    });
    
    return new THREE.Mesh(geometry, material);
  }

  generateCrop(options = {}) {
    const {
      type = 'corn', // corn, wheat, rice
      rows = 5,
      spacing = 1
    } = options;

    const group = new THREE.Group();
    const plantMaterial = this.materialSystem.getMaterial('foliage');

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < rows; j++) {
        let plantGeometry;
        
        if (type === 'corn') {
          plantGeometry = new THREE.CylinderGeometry(0.1, 0.05, 1.5, 4);
        } else if (type === 'wheat') {
          plantGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4);
        } else {
          plantGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4);
        }
        
        const plant = new THREE.Mesh(plantGeometry, plantMaterial);
        plant.position.set(
          (i - rows / 2) * spacing,
          plantGeometry.parameters.height / 2,
          (j - rows / 2) * spacing
        );
        group.add(plant);
      }
    }

    return group;
  }

  generateMushroom(options = {}) {
    const {
      capRadius = 0.3,
      stemHeight = 0.4,
      type = 'generic' // generic, toadstool
    } = options;

    const group = new THREE.Group();

    // Stem
    const stemGeometry = new THREE.CylinderGeometry(0.05, 0.06, stemHeight, 8);
    const stemMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5dc });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = stemHeight / 2;
    group.add(stem);

    // Cap
    const capGeometry = new THREE.SphereGeometry(capRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const capColor = type === 'toadstool' ? 0xff0000 : 0x8b4513;
    const capMaterial = new THREE.MeshStandardMaterial({ color: capColor });
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.position.y = stemHeight;
    group.add(cap);

    // Spots for toadstool
    if (type === 'toadstool') {
      const spotCount = 5;
      const spotMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
      for (let i = 0; i < spotCount; i++) {
        const spotGeometry = new THREE.SphereGeometry(0.05, 8, 8);
        const spot = new THREE.Mesh(spotGeometry, spotMaterial);
        const angle = (i / spotCount) * Math.PI * 2;
        const dist = capRadius * 0.6;
        spot.position.set(
          Math.cos(angle) * dist,
          stemHeight + capRadius * 0.3,
          Math.sin(angle) * dist
        );
        group.add(spot);
      }
    }

    return group;
  }

  // Helper method to create instanced vegetation (for performance)
  createInstancedGrass(options = {}) {
    const {
      area = 100,
      count = 1000
    } = options;

    const geometry = new THREE.PlaneGeometry(0.1, 0.3);
    const material = this.materialSystem.getMaterial('grass');
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const scale = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      position.set(
        (Math.random() - 0.5) * area,
        0,
        (Math.random() - 0.5) * area
      );
      rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * Math.PI);
      scale.set(1, 1 + Math.random() * 0.5, 1);

      matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
      instancedMesh.setMatrixAt(i, matrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    return instancedMesh;
  }
}

export default VegetationGenerator;
