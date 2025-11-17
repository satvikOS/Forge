/**
 * Building Generator - Procedural generation for buildings and structures
 * Creates residential, commercial, industrial, and institutional buildings
 */

import * as THREE from 'three';

export class BuildingGenerator {
  constructor(materialSystem) {
    this.materialSystem = materialSystem;
  }

  generateHouse(options = {}) {
    const {
      width = 8,
      depth = 10,
      height = 6,
      roofHeight = 3
    } = options;

    const group = new THREE.Group();

    // Main structure
    const wallGeometry = new THREE.BoxGeometry(width, height, depth);
    const wallMaterial = this.materialSystem.getMaterial('brick');
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.position.y = height / 2;
    group.add(walls);

    // Roof
    const roofGeometry = new THREE.ConeGeometry(
      Math.sqrt(width * width + depth * depth) / 1.5,
      roofHeight,
      4
    );
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = height + roofHeight / 2;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);

    // Windows
    const windowMaterial = this.materialSystem.getMaterial('glass');
    const windowGeometry = new THREE.BoxGeometry(1, 1.5, 0.1);
    
    // Front windows
    for (let i = 0; i < 2; i++) {
      const window = new THREE.Mesh(windowGeometry, windowMaterial);
      window.position.set((i - 0.5) * 3, height * 0.4, depth / 2 + 0.05);
      group.add(window);
    }

    // Door
    const doorGeometry = new THREE.BoxGeometry(1.2, 2, 0.1);
    const doorMaterial = this.materialSystem.getMaterial('wood');
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, height * 0.16, depth / 2 + 0.05);
    group.add(door);

    return group;
  }

  generateApartmentBuilding(options = {}) {
    const {
      width = 15,
      depth = 12,
      floors = 6,
      floorHeight = 3
    } = options;

    const group = new THREE.Group();
    const totalHeight = floors * floorHeight;

    // Main structure
    const buildingGeometry = new THREE.BoxGeometry(width, totalHeight, depth);
    const buildingMaterial = this.materialSystem.getMaterial('concrete');
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.y = totalHeight / 2;
    group.add(building);

    // Windows
    const windowMaterial = this.materialSystem.getMaterial('glass');
    const windowGeometry = new THREE.BoxGeometry(1, 1.5, 0.1);
    
    const windowsPerFloor = 4;
    const windowSpacing = width / (windowsPerFloor + 1);
    
    for (let floor = 0; floor < floors; floor++) {
      for (let i = 0; i < windowsPerFloor; i++) {
        const window = new THREE.Mesh(windowGeometry, windowMaterial);
        window.position.set(
          (i - windowsPerFloor / 2 + 0.5) * windowSpacing,
          floor * floorHeight + floorHeight / 2,
          depth / 2 + 0.05
        );
        group.add(window);
      }
    }

    return group;
  }

  generateSkyscraper(options = {}) {
    const {
      width = 20,
      depth = 20,
      floors = 30,
      floorHeight = 3
    } = options;

    const group = new THREE.Group();
    const totalHeight = floors * floorHeight;

    // Main tower
    const towerGeometry = new THREE.BoxGeometry(width, totalHeight, depth);
    const towerMaterial = this.materialSystem.getMaterial('concrete');
    const tower = new THREE.Mesh(towerGeometry, towerMaterial);
    tower.position.y = totalHeight / 2;
    group.add(tower);

    // Glass facade
    const glassGeometry = new THREE.BoxGeometry(width * 0.95, totalHeight * 0.95, depth * 0.95);
    const glassMaterial = this.materialSystem.getMaterial('glass');
    const glassFacade = new THREE.Mesh(glassGeometry, glassMaterial);
    glassFacade.position.y = totalHeight / 2;
    group.add(glassFacade);

    return group;
  }

  generateWarehouse(options = {}) {
    const {
      width = 30,
      depth = 40,
      height = 10
    } = options;

    const group = new THREE.Group();

    // Main structure
    const wallGeometry = new THREE.BoxGeometry(width, height, depth);
    const wallMaterial = this.materialSystem.getMaterial('metal');
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.position.y = height / 2;
    group.add(walls);

    // Flat roof
    const roofGeometry = new THREE.BoxGeometry(width + 0.5, 0.5, depth + 0.5);
    const roofMaterial = this.materialSystem.getMaterial('metal');
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = height;
    group.add(roof);

    // Large door
    const doorGeometry = new THREE.BoxGeometry(6, 5, 0.2);
    const doorMaterial = this.materialSystem.getMaterial('metal');
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, 2.5, depth / 2 + 0.1);
    group.add(door);

    return group;
  }

  generateFactory(options = {}) {
    const {
      width = 35,
      depth = 45,
      height = 12
    } = options;

    const group = new THREE.Group();

    // Main building
    const warehouse = this.generateWarehouse({ width, depth, height });
    group.add(warehouse);

    // Chimney
    const chimneyGeometry = new THREE.CylinderGeometry(2, 2.5, 20, 8);
    const chimneyMaterial = this.materialSystem.getMaterial('brick');
    const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
    chimney.position.set(width / 3, 10, -depth / 4);
    group.add(chimney);

    return group;
  }

  generateShop(options = {}) {
    const {
      width = 10,
      depth = 8,
      height = 5
    } = options;

    const group = new THREE.Group();

    // Main structure
    const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
    const buildingMaterial = this.materialSystem.getMaterial('concrete');
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.y = height / 2;
    group.add(building);

    // Large storefront window
    const windowGeometry = new THREE.BoxGeometry(width * 0.8, height * 0.6, 0.1);
    const windowMaterial = this.materialSystem.getMaterial('glass');
    const window = new THREE.Mesh(windowGeometry, windowMaterial);
    window.position.set(0, height * 0.35, depth / 2 + 0.05);
    group.add(window);

    // Awning
    const awningGeometry = new THREE.BoxGeometry(width, 0.2, 2);
    const awningMaterial = new THREE.MeshStandardMaterial({ color: 0xff6347 });
    const awning = new THREE.Mesh(awningGeometry, awningMaterial);
    awning.position.set(0, height * 0.7, depth / 2 + 1);
    group.add(awning);

    return group;
  }

  generateHospital(options = {}) {
    const {
      width = 40,
      depth = 35,
      floors = 5,
      floorHeight = 4
    } = options;

    const group = new THREE.Group();
    const totalHeight = floors * floorHeight;

    // Main building
    const buildingGeometry = new THREE.BoxGeometry(width, totalHeight, depth);
    const buildingMaterial = this.materialSystem.getMaterial('concrete');
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.y = totalHeight / 2;
    group.add(building);

    // Red cross on roof
    const crossMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    
    const crossVertical = new THREE.BoxGeometry(2, 0.2, 6);
    const crossVert = new THREE.Mesh(crossVertical, crossMaterial);
    crossVert.position.y = totalHeight + 0.1;
    group.add(crossVert);
    
    const crossHorizontal = new THREE.BoxGeometry(6, 0.2, 2);
    const crossHoriz = new THREE.Mesh(crossHorizontal, crossMaterial);
    crossHoriz.position.y = totalHeight + 0.1;
    group.add(crossHoriz);

    return group;
  }

  generateSchool(options = {}) {
    const {
      width = 50,
      depth = 30,
      height = 8
    } = options;

    const group = new THREE.Group();

    // Main building
    const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
    const buildingMaterial = this.materialSystem.getMaterial('brick');
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.y = height / 2;
    group.add(building);

    // Multiple windows
    const windowMaterial = this.materialSystem.getMaterial('glass');
    const windowGeometry = new THREE.BoxGeometry(2, 2, 0.1);
    
    for (let i = 0; i < 8; i++) {
      const window = new THREE.Mesh(windowGeometry, windowMaterial);
      window.position.set(
        (i - 3.5) * 6,
        height / 2,
        depth / 2 + 0.05
      );
      group.add(window);
    }

    return group;
  }

  generateStadium(options = {}) {
    const {
      radius = 40,
      height = 15,
      segments = 32
    } = options;

    const group = new THREE.Group();

    // Outer ring
    const outerGeometry = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
    const outerMaterial = this.materialSystem.getMaterial('concrete');
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.position.y = height / 2;
    group.add(outer);

    // Inner field
    const fieldGeometry = new THREE.CircleGeometry(radius * 0.7, segments);
    const fieldMaterial = this.materialSystem.getMaterial('grass');
    const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
    field.rotation.x = -Math.PI / 2;
    field.position.y = 0.1;
    group.add(field);

    return group;
  }

  generateChurch(options = {}) {
    const {
      width = 12,
      depth = 20,
      height = 10,
      steepleHeight = 15
    } = options;

    const group = new THREE.Group();

    // Main building
    const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
    const buildingMaterial = this.materialSystem.getMaterial('brick');
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.y = height / 2;
    group.add(building);

    // Steeple
    const steepleBase = new THREE.BoxGeometry(4, steepleHeight * 0.6, 4);
    const steepleBaseMesh = new THREE.Mesh(steepleBase, buildingMaterial);
    steepleBaseMesh.position.set(0, height + steepleHeight * 0.3, -depth / 3);
    group.add(steepleBaseMesh);

    const steepleTop = new THREE.ConeGeometry(2.5, steepleHeight * 0.4, 4);
    const steepleTopMesh = new THREE.Mesh(steepleTop, buildingMaterial);
    steepleTopMesh.position.set(0, height + steepleHeight * 0.8, -depth / 3);
    group.add(steepleTopMesh);

    return group;
  }

  generateHut(options = {}) {
    const {
      radius = 3,
      height = 3
    } = options;

    const group = new THREE.Group();

    // Circular walls
    const wallGeometry = new THREE.CylinderGeometry(radius, radius, height, 8);
    const wallMaterial = this.materialSystem.getMaterial('wood');
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.position.y = height / 2;
    group.add(walls);

    // Conical roof
    const roofGeometry = new THREE.ConeGeometry(radius * 1.2, height * 0.8, 8);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7355 });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = height + height * 0.4;
    group.add(roof);

    return group;
  }
}

export default BuildingGenerator;
