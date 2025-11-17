/**
 * Environment Materials - Material definitions for environment assets
 * Provides realistic materials for terrain, buildings, vegetation, and weather effects
 */

import * as THREE from 'three';

export class EnvironmentMaterials {
  constructor() {
    this.materials = new Map();
    this.initializeMaterials();
  }

  initializeMaterials() {
    // Terrain Materials
    this.registerMaterial('rock', this.createRockMaterial());
    this.registerMaterial('sand', this.createSandMaterial());
    this.registerMaterial('dirt', this.createDirtMaterial());
    this.registerMaterial('grass', this.createGrassMaterial());
    this.registerMaterial('snow', this.createSnowMaterial());
    this.registerMaterial('ice', this.createIceMaterial());

    // Water Materials
    this.registerMaterial('water', this.createWaterMaterial());
    this.registerMaterial('ocean', this.createOceanMaterial());

    // Building Materials
    this.registerMaterial('concrete', this.createConcreteMaterial());
    this.registerMaterial('brick', this.createBrickMaterial());
    this.registerMaterial('glass', this.createGlassMaterial());
    this.registerMaterial('metal', this.createMetalMaterial());
    this.registerMaterial('asphalt', this.createAsphaltMaterial());

    // Organic Materials
    this.registerMaterial('wood', this.createWoodMaterial());
    this.registerMaterial('bark', this.createBarkMaterial());
    this.registerMaterial('leaves', this.createLeavesMaterial());
    this.registerMaterial('foliage', this.createFoliageMaterial());

    // Atmospheric Materials
    this.registerMaterial('sky', this.createSkyMaterial());
    this.registerMaterial('cloud', this.createCloudMaterial());
  }

  registerMaterial(name, material) {
    this.materials.set(name, material);
  }

  getMaterial(name) {
    return this.materials.get(name) || this.createDefaultMaterial();
  }

  createDefaultMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.7,
      metalness: 0.1
    });
  }

  // Terrain Materials
  createRockMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x6b7280,
      roughness: 0.9,
      metalness: 0.1,
      name: 'rock'
    });
  }

  createSandMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xdcc896,
      roughness: 0.95,
      metalness: 0.0,
      name: 'sand'
    });
  }

  createDirtMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      roughness: 0.95,
      metalness: 0.0,
      name: 'dirt'
    });
  }

  createGrassMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x4a7c3e,
      roughness: 0.9,
      metalness: 0.0,
      name: 'grass'
    });
  }

  createSnowMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.6,
      metalness: 0.0,
      name: 'snow'
    });
  }

  createIceMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xc8f0ff,
      roughness: 0.1,
      metalness: 0.0,
      transparent: true,
      opacity: 0.8,
      transmission: 0.5,
      name: 'ice'
    });
  }

  // Water Materials
  createWaterMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x1e90ff,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.7,
      transmission: 0.3,
      name: 'water'
    });
  }

  createOceanMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x006994,
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
      transmission: 0.2,
      name: 'ocean'
    });
  }

  // Building Materials
  createConcreteMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xa0a0a0,
      roughness: 0.8,
      metalness: 0.1,
      name: 'concrete'
    });
  }

  createBrickMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.85,
      metalness: 0.0,
      name: 'brick'
    });
  }

  createGlassMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 0.3,
      transmission: 0.9,
      name: 'glass'
    });
  }

  createMetalMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xc0c0c0,
      roughness: 0.3,
      metalness: 0.9,
      name: 'metal'
    });
  }

  createAsphaltMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x2c2c2c,
      roughness: 0.9,
      metalness: 0.0,
      name: 'asphalt'
    });
  }

  // Organic Materials
  createWoodMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x8b6f47,
      roughness: 0.8,
      metalness: 0.0,
      name: 'wood'
    });
  }

  createBarkMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.95,
      metalness: 0.0,
      name: 'bark'
    });
  }

  createLeavesMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x2d5016,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
      name: 'leaves'
    });
  }

  createFoliageMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x3a7c2e,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
      name: 'foliage'
    });
  }

  // Atmospheric Materials
  createSkyMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0x87ceeb,
      side: THREE.BackSide,
      name: 'sky'
    });
  }

  createCloudMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      name: 'cloud'
    });
  }

  // Utility methods
  cloneMaterial(materialName) {
    const material = this.getMaterial(materialName);
    return material.clone();
  }

  updateMaterialColor(materialName, color) {
    const material = this.getMaterial(materialName);
    if (material) {
      material.color.set(color);
    }
  }

  getAllMaterials() {
    return Array.from(this.materials.entries()).map(([name, material]) => ({
      name,
      material
    }));
  }
}

export default EnvironmentMaterials;
