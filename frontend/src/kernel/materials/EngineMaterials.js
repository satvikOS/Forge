/**
 * ArchDisc — Engine Materials
 *
 * Maps material names to physically-based rendering parameters so
 * components look like the materials they're made of: titanium glints,
 * Inconel has a warm grey lustre, ceramic-matrix composite looks like
 * fired ceramic, carbon-epoxy shows the woven darkness with a clearcoat.
 *
 * Each entry has:
 *   color       base albedo (0xRRGGBB)
 *   metalness   0..1   (1 = metal, 0 = dielectric)
 *   roughness   0..1   (0 = mirror, 1 = matte)
 *   emissive    0xRRGGBB  for hot/glowing parts (turbine blades at temp)
 *   emissiveIntensity 0..N
 *   clearcoat   0..1   for composite/painted finishes
 *   clearcoatRoughness 0..1
 *   sheen       0..1   for woven materials
 *   ior         dielectric IOR
 *
 * Usage:
 *   const params = EngineMaterials.lookup('Inconel 718');
 *   const mat = EngineMaterials.makeMaterial(THREE, 'Inconel 718');
 */

const MATERIALS = {
  // --- Metals ---
  'Aluminum 6061-T6': {
    color: 0xc8c8d0, metalness: 1.0, roughness: 0.32,
  },
  'Steel AISI 1020': {
    color: 0x7a7a7a, metalness: 1.0, roughness: 0.45,
  },
  'Steel AISI 4340': {
    color: 0x6a6a6a, metalness: 1.0, roughness: 0.30,
  },
  'Stainless Steel 316': {
    color: 0xb8b8c0, metalness: 1.0, roughness: 0.20,
  },
  'Titanium Ti-6Al-4V': {
    // titanium has a slight bluish-grey cast
    color: 0xa8aab0, metalness: 1.0, roughness: 0.35,
  },
  'Inconel 718': {
    // nickel superalloy — warm grey with slight gold cast
    color: 0xa89a86, metalness: 1.0, roughness: 0.28,
  },
  'Single-Crystal Nickel CMSX-4': {
    // turbine blade with TBC at temperature — emissive when hot
    color: 0x9a8870, metalness: 1.0, roughness: 0.26,
    emissive: 0x441100, emissiveIntensity: 0.0, // set by hot/cold mode
  },
  'Copper C11000': {
    color: 0xb86d3a, metalness: 1.0, roughness: 0.24,
  },
  'Cast Iron': {
    color: 0x3a3a3a, metalness: 1.0, roughness: 0.6,
  },

  // --- Ceramics & CMC ---
  'CMC SiC/SiC': {
    // Silicon-Carbide ceramic matrix composite — pale tan ceramic look
    color: 0xd9c8a4, metalness: 0.0, roughness: 0.65,
    sheen: 0.2,
  },
  'TBC YSZ': {
    // Yttria-stabilized zirconia thermal barrier coating — pale beige
    color: 0xeae0c4, metalness: 0.0, roughness: 0.85,
  },

  // --- Composites ---
  'Composite Carbon-Epoxy': {
    // 4th-gen woven — deep dark with clearcoat to suggest gloss
    color: 0x14141a, metalness: 0.0, roughness: 0.55,
    clearcoat: 0.85, clearcoatRoughness: 0.18,
    sheen: 0.4,
  },
  'Carbon Fiber Composite': {
    color: 0x1a1a1f, metalness: 0.0, roughness: 0.55,
    clearcoat: 0.7, clearcoatRoughness: 0.20,
  },

  // --- Plastics & rubbers ---
  'ABS Plastic': {
    color: 0xd9bf80, metalness: 0.0, roughness: 0.7,
  },
  'Nylon 6/6': {
    color: 0xefefe5, metalness: 0.0, roughness: 0.5,
  },

  // --- Pseudo-materials ---
  'Air': {
    color: 0x000000, metalness: 0.0, roughness: 1.0, emissive: 0x000000,
    transparent: true, opacity: 0.0,
  },
};

const _aliases = new Map([
  ['titanium', 'Titanium Ti-6Al-4V'],
  ['steel', 'Steel AISI 4340'],
  ['inconel', 'Inconel 718'],
  ['cmc', 'CMC SiC/SiC'],
  ['composite', 'Composite Carbon-Epoxy'],
  ['aluminum', 'Aluminum 6061-T6'],
  ['stainless', 'Stainless Steel 316'],
]);

const DEFAULT = {
  color: 0x808088, metalness: 0.5, roughness: 0.5,
};

export default class EngineMaterials {

  /** Look up parameters by material name (case-insensitive, alias-aware). */
  static lookup(name) {
    if (!name) return DEFAULT;
    if (MATERIALS[name]) return MATERIALS[name];
    const lower = name.toLowerCase();
    for (const [key, full] of _aliases) {
      if (lower.includes(key)) return MATERIALS[full] || DEFAULT;
    }
    return DEFAULT;
  }

  /** All known material names. */
  static list() { return Object.keys(MATERIALS); }

  /**
   * Create a Three.js MeshPhysicalMaterial for a material name.
   * Pass the THREE module (avoids hard-import in kernel).
   */
  static makeMaterial(THREE, name, options = {}) {
    const p = EngineMaterials.lookup(name);
    const mat = new THREE.MeshPhysicalMaterial({
      color: options.color != null ? options.color : p.color,
      metalness: p.metalness ?? 0.5,
      roughness: p.roughness ?? 0.5,
      emissive: p.emissive ?? 0x000000,
      emissiveIntensity: p.emissiveIntensity ?? 0,
      clearcoat: p.clearcoat ?? 0,
      clearcoatRoughness: p.clearcoatRoughness ?? 0,
      sheen: p.sheen ?? 0,
      transparent: p.transparent ?? false,
      opacity: p.opacity != null ? p.opacity : 1.0,
    });
    return mat;
  }

  /**
   * Apply material parameters to an existing material in-place.
   */
  static applyToMaterial(mat, name, options = {}) {
    const p = EngineMaterials.lookup(name);
    if (options.color != null) {
      mat.color.setHex(options.color);
    } else if (p.color != null) {
      mat.color.setHex(p.color);
    }
    if (mat.metalness !== undefined) mat.metalness = p.metalness ?? mat.metalness;
    if (mat.roughness !== undefined) mat.roughness = p.roughness ?? mat.roughness;
    if (mat.emissive && p.emissive != null) mat.emissive.setHex(p.emissive);
    if (mat.emissiveIntensity !== undefined && p.emissiveIntensity != null) {
      mat.emissiveIntensity = p.emissiveIntensity;
    }
    if ('clearcoat' in mat && p.clearcoat != null) mat.clearcoat = p.clearcoat;
    if ('clearcoatRoughness' in mat && p.clearcoatRoughness != null) mat.clearcoatRoughness = p.clearcoatRoughness;
    if ('sheen' in mat && p.sheen != null) mat.sheen = p.sheen;
    mat.needsUpdate = true;
    return mat;
  }

  /**
   * Set "hot mode" — turbine blades glow yellow/orange.
   * Applies emissive parameters to materials that are turbine alloys.
   */
  static setHotMode(THREE, scene, intensity = 1.0) {
    scene.traverse(obj => {
      if (!obj.material) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      // Heuristic: parts in HPT/COMB get the glow
      const partID = obj.userData?.partID || (obj.userData?.partIDs?.[0]);
      if (!partID) return;
      if (partID.includes('HPT') || partID.includes('COMB')) {
        if (mat.emissive) {
          // Cherry-orange glow
          mat.emissive.setHex(0xcc4400);
          mat.emissiveIntensity = intensity;
          mat.needsUpdate = true;
        }
      }
    });
  }

  static clearHotMode(scene) {
    scene.traverse(obj => {
      if (!obj.material) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (mat.emissive) {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mat.needsUpdate = true;
      }
    });
  }
}

export { MATERIALS as ENGINE_MATERIAL_PARAMS };
