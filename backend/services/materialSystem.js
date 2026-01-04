/**
 * Material System - PBR (Physically Based Rendering) materials
 * Defines realistic materials with proper properties
 */
class MaterialSystem {
  constructor() {
    this.materials = {
      // Metal materials
      metal: {
        type: 'pbr',
        name: 'Brushed Metal',
        baseColor: [0.75, 0.75, 0.75],
        metallic: 0.9,
        roughness: 0.3,
        reflectance: 0.5,
        category: 'metal',
      },
      polished_metal: {
        type: 'pbr',
        name: 'Polished Metal',
        baseColor: [0.85, 0.85, 0.85],
        metallic: 1.0,
        roughness: 0.1,
        reflectance: 0.9,
        category: 'metal',
      },
      aluminum: {
        type: 'pbr',
        name: 'Aluminum',
        baseColor: [0.82, 0.82, 0.82],
        metallic: 0.95,
        roughness: 0.2,
        reflectance: 0.6,
        category: 'metal',
      },
      steel: {
        type: 'pbr',
        name: 'Steel',
        baseColor: [0.7, 0.7, 0.72],
        metallic: 0.9,
        roughness: 0.35,
        reflectance: 0.5,
        category: 'metal',
      },
      'carbon fiber': {
        type: 'pbr',
        name: 'Carbon Fiber',
        baseColor: [0.1, 0.1, 0.12],
        metallic: 0.3,
        roughness: 0.4,
        reflectance: 0.4,
        category: 'composite',
      },
      
      // Concrete and structural
      concrete: {
        type: 'pbr',
        name: 'Concrete',
        baseColor: [0.6, 0.6, 0.58],
        metallic: 0.0,
        roughness: 0.8,
        reflectance: 0.04,
        category: 'structural',
      },
      rough_concrete: {
        type: 'pbr',
        name: 'Rough Concrete',
        baseColor: [0.5, 0.5, 0.48],
        metallic: 0.0,
        roughness: 0.95,
        reflectance: 0.04,
        bumpMap: 'concrete_bump',
        category: 'structural',
      },
      
      // Glass materials
      glass: {
        type: 'pbr',
        name: 'Clear Glass',
        baseColor: [0.95, 0.95, 0.98],
        metallic: 0.0,
        roughness: 0.05,
        reflectance: 0.5,
        transmission: 0.9,
        ior: 1.5,
        category: 'transparent',
      },
      frosted_glass: {
        type: 'pbr',
        name: 'Frosted Glass',
        baseColor: [0.9, 0.9, 0.92],
        metallic: 0.0,
        roughness: 0.5,
        reflectance: 0.4,
        transmission: 0.6,
        ior: 1.5,
        category: 'transparent',
      },
      
      // Plastic materials
      plastic: {
        type: 'pbr',
        name: 'Plastic',
        baseColor: [0.8, 0.8, 0.85],
        metallic: 0.0,
        roughness: 0.4,
        reflectance: 0.5,
        category: 'synthetic',
      },
      glossy_plastic: {
        type: 'pbr',
        name: 'Glossy Plastic',
        baseColor: [0.85, 0.85, 0.9],
        metallic: 0.0,
        roughness: 0.1,
        reflectance: 0.6,
        category: 'synthetic',
      },
      
      // Wood materials
      wood: {
        type: 'pbr',
        name: 'Wood',
        baseColor: [0.55, 0.4, 0.25],
        metallic: 0.0,
        roughness: 0.6,
        reflectance: 0.3,
        category: 'natural',
      },
      polished_wood: {
        type: 'pbr',
        name: 'Polished Wood',
        baseColor: [0.6, 0.45, 0.3],
        metallic: 0.0,
        roughness: 0.2,
        reflectance: 0.5,
        category: 'natural',
      },
      
      // Fabric materials
      fabric: {
        type: 'pbr',
        name: 'Fabric',
        baseColor: [0.5, 0.5, 0.6],
        metallic: 0.0,
        roughness: 0.9,
        reflectance: 0.04,
        category: 'textile',
      },
      mesh: {
        type: 'pbr',
        name: 'Mesh Fabric',
        baseColor: [0.3, 0.3, 0.35],
        metallic: 0.0,
        roughness: 0.85,
        reflectance: 0.04,
        category: 'textile',
      },
      
      // Foam materials
      foam: {
        type: 'pbr',
        name: 'Foam',
        baseColor: [0.9, 0.9, 0.9],
        metallic: 0.0,
        roughness: 0.95,
        reflectance: 0.04,
        category: 'synthetic',
      },
      
      // Default material
      default: {
        type: 'pbr',
        name: 'Default',
        baseColor: [0.7, 0.7, 0.7],
        metallic: 0.0,
        roughness: 0.5,
        reflectance: 0.5,
        category: 'generic',
      },
    };
  }

  /**
   * Get material by name
   */
  getMaterial(name) {
    const materialKey = name?.toLowerCase() || 'default';
    return this.materials[materialKey] || this.materials.default;
  }

  /**
   * Get all materials in a category
   */
  getMaterialsByCategory(category) {
    return Object.entries(this.materials)
      .filter(([_, mat]) => mat.category === category)
      .map(([key, mat]) => ({ key, ...mat }));
  }

  /**
   * Apply material to geometry part
   */
  applyMaterial(part, materialName) {
    const material = this.getMaterial(materialName);
    return {
      ...part,
      material: material,
      materialName: materialName || 'default',
    };
  }

  /**
   * Get material export data for 3D formats
   */
  getExportData(materialName) {
    const material = this.getMaterial(materialName);
    
    return {
      name: material.name,
      type: material.type,
      properties: {
        baseColor: material.baseColor,
        metallic: material.metallic,
        roughness: material.roughness,
        reflectance: material.reflectance,
        transmission: material.transmission,
        ior: material.ior,
      },
      maps: {
        bump: material.bumpMap,
        normal: material.normalMap,
        ao: material.aoMap,
      },
    };
  }

  /**
   * Suggest materials based on object type
   */
  suggestMaterials(objectType) {
    const suggestions = {
      building: ['concrete', 'glass', 'steel', 'aluminum'],
      structure: ['steel', 'aluminum', 'concrete'],
      car: ['metal', 'polished_metal', 'glass', 'plastic', 'carbon fiber'],
      vehicle: ['metal', 'aluminum', 'glass', 'plastic'],
      furniture: ['wood', 'polished_wood', 'metal', 'fabric', 'foam'],
      prop: ['plastic', 'metal', 'wood'],
      terrain: ['concrete', 'rough_concrete'],
    };
    
    return suggestions[objectType?.toLowerCase()] || ['default'];
  }

  /**
   * Create material variations with different colors
   */
  createColorVariation(materialName, color) {
    const baseMaterial = this.getMaterial(materialName);
    
    return {
      ...baseMaterial,
      baseColor: color,
      name: `${baseMaterial.name} (Custom)`,
    };
  }

  /**
   * Get material properties for rendering
   */
  getRenderProperties(materialName) {
    const material = this.getMaterial(materialName);
    
    return {
      diffuse: material.baseColor,
      specular: material.metallic > 0.5 ? [1, 1, 1] : [0.2, 0.2, 0.2],
      shininess: (1 - material.roughness) * 100,
      opacity: material.transmission ? 1 - material.transmission : 1,
      metalness: material.metallic,
      roughness: material.roughness,
    };
  }

  /**
   * List all available materials
   */
  listMaterials() {
    return Object.keys(this.materials);
  }

  /**
   * Get material categories
   */
  getCategories() {
    const categories = new Set();
    Object.values(this.materials).forEach(mat => categories.add(mat.category));
    return Array.from(categories);
  }
}

module.exports = new MaterialSystem();
