/**
 * Material System - Material library and management
 */

export class Material {
  constructor(id, name, type = 'standard') {
    this.id = id;
    this.name = name;
    this.type = type;
    this.properties = this.getDefaultProperties(type);
  }

  getDefaultProperties(type) {
    const defaults = {
      standard: {
        color: '#ffffff',
        metalness: 0.5,
        roughness: 0.5,
        emissive: '#000000',
        emissiveIntensity: 0,
        transparent: false,
        opacity: 1,
      },
      physical: {
        color: '#ffffff',
        metalness: 0,
        roughness: 0.5,
        clearcoat: 0,
        clearcoatRoughness: 0,
        reflectivity: 0.5,
        transmission: 0,
        thickness: 0,
      },
      basic: {
        color: '#ffffff',
        wireframe: false,
      },
      lambert: {
        color: '#ffffff',
        emissive: '#000000',
        emissiveIntensity: 0,
      },
      phong: {
        color: '#ffffff',
        emissive: '#000000',
        emissiveIntensity: 0,
        specular: '#111111',
        shininess: 30,
      },
      toon: {
        color: '#ffffff',
        gradientMap: null,
      },
      glass: {
        color: '#ffffff',
        metalness: 0,
        roughness: 0,
        transmission: 1,
        thickness: 0.5,
        ior: 1.5,
      },
      metal: {
        color: '#888888',
        metalness: 1,
        roughness: 0.2,
      },
      wood: {
        color: '#8B4513',
        metalness: 0,
        roughness: 0.8,
      },
      plastic: {
        color: '#ffffff',
        metalness: 0,
        roughness: 0.4,
      },
      concrete: {
        color: '#999999',
        metalness: 0,
        roughness: 0.9,
      },
    };
    
    return { ...(defaults[type] || defaults.standard) };
  }

  setProperty(key, value) {
    this.properties[key] = value;
  }

  getProperty(key) {
    return this.properties[key];
  }

  clone() {
    const cloned = new Material(`${this.id}_copy`, `${this.name} (Copy)`, this.type);
    cloned.properties = { ...this.properties };
    return cloned;
  }
}

export class MaterialLibrary {
  constructor() {
    this.materials = new Map();
    this.idCounter = 0;
    this.initializeDefaults();
  }

  initializeDefaults() {
    // Create default materials
    const defaults = [
      { name: 'Default', type: 'standard', color: '#4a90e2' },
      { name: 'Glass', type: 'glass', color: '#ffffff' },
      { name: 'Metal', type: 'metal', color: '#888888' },
      { name: 'Wood', type: 'wood', color: '#8B4513' },
      { name: 'Plastic White', type: 'plastic', color: '#ffffff' },
      { name: 'Plastic Red', type: 'plastic', color: '#ff0000' },
      { name: 'Plastic Blue', type: 'plastic', color: '#0000ff' },
      { name: 'Concrete', type: 'concrete', color: '#999999' },
      { name: 'Brick', type: 'standard', color: '#8B4513', roughness: 0.9 },
      { name: 'Mirror', type: 'standard', color: '#ffffff', metalness: 1, roughness: 0 },
    ];

    defaults.forEach(def => {
      const mat = this.createMaterial(def.name, def.type);
      if (def.color) mat.setProperty('color', def.color);
      if (def.roughness !== undefined) mat.setProperty('roughness', def.roughness);
      if (def.metalness !== undefined) mat.setProperty('metalness', def.metalness);
    });
  }

  createMaterial(name, type = 'standard') {
    const id = `mat_${this.idCounter++}`;
    const material = new Material(id, name, type);
    this.materials.set(id, material);
    return material;
  }

  getMaterial(id) {
    return this.materials.get(id);
  }

  getAllMaterials() {
    return Array.from(this.materials.values());
  }

  getMaterialsByType(type) {
    return this.getAllMaterials().filter(mat => mat.type === type);
  }

  deleteMaterial(id) {
    return this.materials.delete(id);
  }

  duplicateMaterial(id) {
    const original = this.materials.get(id);
    if (!original) return null;
    
    const cloned = original.clone();
    cloned.id = `mat_${this.idCounter++}`;
    this.materials.set(cloned.id, cloned);
    return cloned;
  }

  importMaterial(materialData) {
    const mat = new Material(
      `mat_${this.idCounter++}`,
      materialData.name,
      materialData.type
    );
    mat.properties = { ...materialData.properties };
    this.materials.set(mat.id, mat);
    return mat;
  }

  exportMaterial(id) {
    const material = this.materials.get(id);
    if (!material) return null;
    
    return {
      name: material.name,
      type: material.type,
      properties: { ...material.properties },
    };
  }

  clear() {
    this.materials.clear();
    this.idCounter = 0;
    this.initializeDefaults();
  }
}

// Preset material templates
export const MaterialPresets = {
  architectural: [
    { name: 'Concrete', type: 'concrete', color: '#999999' },
    { name: 'Brick Red', type: 'standard', color: '#8B4513', roughness: 0.9 },
    { name: 'White Paint', type: 'plastic', color: '#f0f0f0' },
    { name: 'Wood Floor', type: 'wood', color: '#8B4513' },
    { name: 'Steel', type: 'metal', color: '#888888' },
    { name: 'Glass Window', type: 'glass', color: '#e6f2ff', transmission: 0.9 },
  ],
  
  automotive: [
    { name: 'Car Paint Red', type: 'physical', color: '#cc0000', metalness: 0.8, clearcoat: 1 },
    { name: 'Car Paint Blue', type: 'physical', color: '#0044cc', metalness: 0.8, clearcoat: 1 },
    { name: 'Chrome', type: 'metal', color: '#ffffff', metalness: 1, roughness: 0.1 },
    { name: 'Tire Rubber', type: 'standard', color: '#1a1a1a', roughness: 0.95 },
    { name: 'Headlight', type: 'glass', color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.5 },
  ],
  
  furniture: [
    { name: 'Oak Wood', type: 'wood', color: '#a87032' },
    { name: 'Walnut Wood', type: 'wood', color: '#5c4033' },
    { name: 'Leather Brown', type: 'standard', color: '#8B4513', roughness: 0.6 },
    { name: 'Fabric Gray', type: 'standard', color: '#888888', roughness: 0.9 },
    { name: 'Stainless Steel', type: 'metal', color: '#cccccc', roughness: 0.3 },
  ],
};

export default {
  Material,
  MaterialLibrary,
  MaterialPresets,
};
