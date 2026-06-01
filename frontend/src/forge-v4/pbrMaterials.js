// Forge-97 — PBR material presets.
//
// Real engineering-grade material props that map 1:1 onto three.js
// MeshPhysicalMaterial. Each preset is a plain JS object so it can be
// spread into a JSX <meshPhysicalMaterial {...preset} /> or passed to
// `Object.assign(material, preset)` for an imperative path.
//
// All values are physical: roughness/metalness sweep a real BRDF;
// transmission/ior parameterise dielectric refraction; sheen + clearcoat
// are reserved for special finishes (brushed metals + painted shells).
//
// Colour values are sRGB hex chosen against a 5500K studio HDRI; if a
// scene uses a different environment, expect the perceived tone to drift
// slightly — that's correct PBR behaviour, not a bug.
//
// Anisotropy on brushed aluminium is parameterised; three.js >= r158
// supports `anisotropy` directly on MeshPhysicalMaterial and we pass it
// through. On older builds the renderer ignores the field silently.

export const MATERIAL_PRESETS = {
  // ---------------- Ferrous metals ----------------
  steel: {
    label: 'Steel',
    family: 'metal',
    color: '#b8babe',
    roughness: 0.45,
    metalness: 1.0,
    envMapIntensity: 1.0,
  },
  stainless: {
    label: 'Stainless Steel',
    family: 'metal',
    color: '#cdd0d4',
    roughness: 0.25,
    metalness: 1.0,
    envMapIntensity: 1.15,
  },

  // ---------------- Non-ferrous metals ----------------
  aluminium: {
    label: 'Brushed Aluminium',
    family: 'metal',
    color: '#c8ccd1',
    roughness: 0.55,
    metalness: 1.0,
    envMapIntensity: 1.0,
    // r158+ anisotropy: 0..1 strength + rotation in radians (0 = horizontal)
    anisotropy: 0.7,
    anisotropyRotation: 0.0,
  },
  brass: {
    label: 'Polished Brass',
    family: 'metal',
    color: '#d0a878',
    roughness: 0.18,
    metalness: 1.0,
    envMapIntensity: 1.2,
  },
  copper: {
    label: 'Copper',
    family: 'metal',
    color: '#c08866',
    roughness: 0.30,
    metalness: 1.0,
    envMapIntensity: 1.1,
  },
  titanium: {
    label: 'Titanium',
    family: 'metal',
    color: '#9ea0a4',
    roughness: 0.40,
    metalness: 1.0,
    envMapIntensity: 1.0,
  },

  // ---------------- Coated / painted ----------------
  anodisedBlack: {
    label: 'Black Anodised',
    family: 'coating',
    color: '#1a1c20',
    roughness: 0.65,
    metalness: 0.6,
    envMapIntensity: 0.75,
  },
  painted: {
    label: 'Painted',
    family: 'coating',
    color: '#c84c3c',
    roughness: 0.7,
    metalness: 0.0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.85,
  },

  // ---------------- Transparent ----------------
  glass: {
    label: 'Glass',
    family: 'dielectric',
    color: '#ffffff',
    roughness: 0.05,
    metalness: 0.0,
    transmission: 0.95,
    ior: 1.52,
    thickness: 2.0,
    transparent: true,
    opacity: 1.0,
    envMapIntensity: 1.0,
  },

  // ---------------- Polymers / rubber ----------------
  rubber: {
    label: 'Rubber',
    family: 'polymer',
    color: '#1a1a1a',
    roughness: 0.95,
    metalness: 0.0,
    envMapIntensity: 0.4,
  },
  abs: {
    label: 'ABS Plastic',
    family: 'polymer',
    color: '#2a2c30',
    roughness: 0.55,
    metalness: 0.0,
    envMapIntensity: 0.7,
  },
};

/**
 * Apply a preset by key to a THREE.MeshPhysicalMaterial instance.
 * Returns true if applied; false if the key is unknown.
 */
export function applyPreset(material, key) {
  const preset = MATERIAL_PRESETS[key];
  if (!material || !preset) return false;
  for (const [k, v] of Object.entries(preset)) {
    if (k === 'label' || k === 'family') continue;
    if (k === 'color' && material.color?.set) {
      try { material.color.set(v); } catch { /* ignore bad hex */ }
      continue;
    }
    if (k in material) material[k] = v;
  }
  material.needsUpdate = true;
  return true;
}

/** Ordered preset keys for menu rendering. */
export const PRESET_ORDER = [
  'steel', 'stainless', 'aluminium', 'brass', 'copper', 'titanium',
  'anodisedBlack', 'painted', 'glass', 'rubber', 'abs',
];

/** Group presets by family for the material picker. */
export function presetsByFamily() {
  const groups = { metal: [], coating: [], dielectric: [], polymer: [] };
  for (const key of PRESET_ORDER) {
    const p = MATERIAL_PRESETS[key];
    if (!p) continue;
    (groups[p.family] || (groups[p.family] = [])).push({ key, ...p });
  }
  return groups;
}
