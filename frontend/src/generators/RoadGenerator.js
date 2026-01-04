/**
 * Road Generator - Procedural generation for roads and paths
 * Creates highways, streets, paths, bridges, tunnels, etc.
 */

import * as THREE from 'three';

export class RoadGenerator {
  constructor(materialSystem) {
    this.materialSystem = materialSystem;
  }

  generateHighway(options = {}) {
    const {
      length = 100,
      width = 12,
      lanes = 4
    } = options;

    const group = new THREE.Group();

    // Road surface
    const roadGeometry = new THREE.PlaneGeometry(width, length, 1, 20);
    const roadMaterial = this.materialSystem.getMaterial('asphalt');
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    group.add(road);

    // Lane markings
    const markingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const markingGeometry = new THREE.PlaneGeometry(0.2, 3);
    
    for (let i = 1; i < lanes; i++) {
      const laneX = -width / 2 + (i * width / lanes);
      for (let j = 0; j < 10; j++) {
        const marking = new THREE.Mesh(markingGeometry, markingMaterial);
        marking.rotation.x = -Math.PI / 2;
        marking.position.set(laneX, 0.01, (j - 5) * 10);
        group.add(marking);
      }
    }

    return group;
  }

  generateStreet(options = {}) {
    const {
      length = 50,
      width = 8
    } = options;

    const group = new THREE.Group();

    // Road
    const roadGeometry = new THREE.PlaneGeometry(width, length);
    const roadMaterial = this.materialSystem.getMaterial('asphalt');
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    group.add(road);

    // Center line
    const lineGeometry = new THREE.PlaneGeometry(0.15, length);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.01;
    group.add(line);

    // Sidewalks
    const sidewalkWidth = 2;
    const sidewalkGeometry = new THREE.PlaneGeometry(sidewalkWidth, length);
    const sidewalkMaterial = this.materialSystem.getMaterial('concrete');
    
    const leftSidewalk = new THREE.Mesh(sidewalkGeometry, sidewalkMaterial);
    leftSidewalk.rotation.x = -Math.PI / 2;
    leftSidewalk.position.set(-width / 2 - sidewalkWidth / 2, 0.1, 0);
    group.add(leftSidewalk);
    
    const rightSidewalk = new THREE.Mesh(sidewalkGeometry, sidewalkMaterial);
    rightSidewalk.rotation.x = -Math.PI / 2;
    rightSidewalk.position.set(width / 2 + sidewalkWidth / 2, 0.1, 0);
    group.add(rightSidewalk);

    return group;
  }

  generatePath(options = {}) {
    const {
      length = 30,
      width = 2,
      material = 'dirt'
    } = options;

    const geometry = new THREE.PlaneGeometry(width, length, 1, 10);
    const positions = geometry.attributes.position.array;
    
    // Add slight irregularity
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 2] += (Math.random() - 0.5) * 0.1;
    }
    
    geometry.computeVertexNormals();
    geometry.rotation.x = -Math.PI / 2;
    
    const pathMaterial = this.materialSystem.getMaterial(material);
    return new THREE.Mesh(geometry, pathMaterial);
  }

  generateSidewalk(options = {}) {
    const {
      length = 50,
      width = 1.5
    } = options;

    const geometry = new THREE.PlaneGeometry(width, length);
    geometry.rotation.x = -Math.PI / 2;
    
    const material = this.materialSystem.getMaterial('concrete');
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.05;
    
    return mesh;
  }

  generateBridge(options = {}) {
    const {
      length = 40,
      width = 10,
      height = 5,
      supports = 3
    } = options;

    const group = new THREE.Group();

    // Deck
    const deckGeometry = new THREE.BoxGeometry(width, 0.5, length);
    const deckMaterial = this.materialSystem.getMaterial('concrete');
    const deck = new THREE.Mesh(deckGeometry, deckMaterial);
    deck.position.y = height;
    group.add(deck);

    // Support pillars
    const pillarGeometry = new THREE.CylinderGeometry(0.8, 1, height, 8);
    const pillarMaterial = this.materialSystem.getMaterial('concrete');
    
    for (let i = 0; i < supports; i++) {
      const z = (i - (supports - 1) / 2) * (length / (supports + 1));
      
      const leftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      leftPillar.position.set(-width / 3, height / 2, z);
      group.add(leftPillar);
      
      const rightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      rightPillar.position.set(width / 3, height / 2, z);
      group.add(rightPillar);
    }

    // Railings
    const railingGeometry = new THREE.BoxGeometry(0.1, 1, length);
    const railingMaterial = this.materialSystem.getMaterial('metal');
    
    const leftRailing = new THREE.Mesh(railingGeometry, railingMaterial);
    leftRailing.position.set(-width / 2, height + 0.75, 0);
    group.add(leftRailing);
    
    const rightRailing = new THREE.Mesh(railingGeometry, railingMaterial);
    rightRailing.position.set(width / 2, height + 0.75, 0);
    group.add(rightRailing);

    return group;
  }

  generateTunnel(options = {}) {
    const {
      length = 30,
      radius = 5
    } = options;

    const group = new THREE.Group();

    // Tunnel tube
    const tunnelGeometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1, true);
    const tunnelMaterial = this.materialSystem.getMaterial('concrete');
    const tunnel = new THREE.Mesh(tunnelGeometry, tunnelMaterial);
    tunnel.rotation.z = Math.PI / 2;
    group.add(tunnel);

    // Road inside
    const roadGeometry = new THREE.PlaneGeometry(radius * 1.5, length);
    const roadMaterial = this.materialSystem.getMaterial('asphalt');
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.y = -radius + 0.1;
    group.add(road);

    return group;
  }

  generateParkingLot(options = {}) {
    const {
      width = 30,
      depth = 40,
      spaces = 20
    } = options;

    const group = new THREE.Group();

    // Lot surface
    const lotGeometry = new THREE.PlaneGeometry(width, depth);
    const lotMaterial = this.materialSystem.getMaterial('asphalt');
    const lot = new THREE.Mesh(lotGeometry, lotMaterial);
    lot.rotation.x = -Math.PI / 2;
    group.add(lot);

    // Parking space lines
    const lineGeometry = new THREE.PlaneGeometry(0.1, 5);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    const spacesPerRow = Math.ceil(Math.sqrt(spaces));
    const spaceWidth = width / spacesPerRow;
    const spaceDepth = depth / spacesPerRow;
    
    for (let i = 0; i <= spacesPerRow; i++) {
      for (let j = 0; j <= spacesPerRow; j++) {
        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        line.rotation.x = -Math.PI / 2;
        line.position.set(
          i * spaceWidth - width / 2,
          0.01,
          j * spaceDepth - depth / 2
        );
        group.add(line);
      }
    }

    return group;
  }

  generateRoundabout(options = {}) {
    const {
      radius = 10,
      roadWidth = 4
    } = options;

    const group = new THREE.Group();

    // Outer ring
    const outerGeometry = new THREE.RingGeometry(radius - roadWidth / 2, radius + roadWidth / 2, 32);
    const roadMaterial = this.materialSystem.getMaterial('asphalt');
    const road = new THREE.Mesh(outerGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    group.add(road);

    // Center island
    const islandGeometry = new THREE.CircleGeometry(radius - roadWidth / 2, 32);
    const islandMaterial = this.materialSystem.getMaterial('grass');
    const island = new THREE.Mesh(islandGeometry, islandMaterial);
    island.rotation.x = -Math.PI / 2;
    island.position.y = 0.1;
    group.add(island);

    return group;
  }

  generateIntersection(options = {}) {
    const {
      size = 15
    } = options;

    const group = new THREE.Group();

    // Intersection surface
    const intersectionGeometry = new THREE.PlaneGeometry(size, size);
    const roadMaterial = this.materialSystem.getMaterial('asphalt');
    const intersection = new THREE.Mesh(intersectionGeometry, roadMaterial);
    intersection.rotation.x = -Math.PI / 2;
    group.add(intersection);

    // Crosswalk lines
    const lineGeometry = new THREE.PlaneGeometry(size * 0.8, 0.3);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = (i % 2) * Math.PI / 2;
      line.position.set(
        (i === 1) ? size * 0.4 : (i === 3) ? -size * 0.4 : 0,
        0.01,
        (i === 0) ? size * 0.4 : (i === 2) ? -size * 0.4 : 0
      );
      group.add(line);
    }

    return group;
  }
}

export default RoadGenerator;
