// forgeFlagshipMaterials.js — ENGINEER-CORRECT PHOTOREAL PBR FOR FLAGSHIP PARTS
// ============================================================================
// The Forge demo's strongest pillar is real OCCT B-rep parts rendered
// photoreally. The kernel already produces the solids (ge9xBuilder /
// planetaryGearboxBuilder / turbopumpBuilder); this module supplies the
// PHYSICALLY-CORRECT material per COMPONENT CLASS and a deterministic tagger
// that maps every flagship body NAME → its real engineering material.
//
// WHY THIS EXISTS (the gap it closes)
//   The live viewport (Viewport.jsx · SceneMeshes) historically painted every
//   native body with ONE flat `meshStandardMaterial color={colorForBody(...)}
//   roughness=0.42 metalness=0.18` — a hue-hashed clay look, no per-component
//   metalness, no HDRI-correct reflectance. A GE9X fan blade (Ti-6Al-4V) and an
//   HPT blade (CMSX nickel superalloy) and a CFRP nacelle all looked identical.
//   This module gives each component its REAL reflectance so the render reads as
//   machined aerospace hardware, not a candy bowl.
//
// THE PBR MODEL (metal/rough workflow, three.js MeshPhysicalMaterial)
//   Every preset below carries the four fields a metal/rough BRDF needs —
//   baseColor (sRGB), metalness, roughness, envMapIntensity — plus the right
//   extras per family (clearcoat for painted/anodised shells, sheen +
//   anisotropy for brushed metals, the CFRP weave tint). Values are grounded in
//   measured reflectance for each alloy/finish (see per-preset notes), tuned
//   against a 5500 K studio environment. Spectral metal tints (Ti slightly
//   warm-grey, nickel superalloy cool steel-grey, copper salmon, brass gold)
//   come from the alloys' real complex IOR — NOT arbitrary hues.
//
// TEXTURE MAPS (optional, graceful)
//   If real PBR texture maps are present under frontend/src/assets/pbr/<key>/
//   (basecolor/roughness/normal/metalness, e.g. ambientCG CC0 sets a user can
//   drop in), `resolveMaterialMaps()` will wire them; when absent the analytic
//   metal/rough values render a clean, correct result with zero asset/network
//   dependency (matches feedback-forge-native-no-deps + the offline render
//   harness). NO npm package, NO bundled binary asset is required for the
//   baseline photoreal look.
//
// USAGE
//   import { materialForComponent, MATERIAL_LIBRARY, makeThreeMaterial,
//            tagBodiesWithMaterials } from './forgeFlagshipMaterials.js';
//   const key = materialForComponent('hpt_blade');        // 'nickelSuperalloy'
//   const m   = makeThreeMaterial(THREE, key);            // MeshPhysicalMaterial
//   // or, for a built flagship result:
//   const tagged = tagBodiesWithMaterials(res.bodies);    // [{...b, material}]
// ============================================================================

// ───────────────────────────────────────────────────────────────────────────
//  MATERIAL LIBRARY — one entry per engineering material CLASS.
//  Linear-workflow note: `color` is the sRGB base/albedo; three.js converts to
//  linear for the BRDF. metalness/roughness are the metal-rough channels.
// ───────────────────────────────────────────────────────────────────────────
export const MATERIAL_LIBRARY = Object.freeze({
  // ── Titanium (Ti-6Al-4V) — fan disk, fan blades, fan platforms, inducer,
  //    light rotating structure. Real Ti is a cool-neutral grey with a faint
  //    warm cast and a satin (not mirror) finish from shot-peen / machining. ──
  titanium: {
    label: 'Titanium Ti-6Al-4V',
    family: 'metal',
    color: '#8d9094',          // cool satin grey, faint warm cast
    metalness: 1.0,
    roughness: 0.38,           // satin machined / shot-peened
    envMapIntensity: 1.0,
    anisotropy: 0.25,          // faint machining grain
    density_kg_m3: 4430,
  },

  // ── Nickel-base superalloy (CMSX-4 / René / Inconel) — HPT blades, HPT
  //    nozzles, turbine disks, combustor metal. Single-crystal/cast Ni alloys
  //    read as a cool dark steel-grey, slightly darker + glossier than Ti when
  //    polished, duller (oxidised) on hot-section surfaces. ──
  nickelSuperalloy: {
    label: 'Nickel Superalloy (CMSX-4/Inconel)',
    family: 'metal',
    color: '#7e8186',          // cool dark steel-grey
    metalness: 1.0,
    roughness: 0.34,
    envMapIntensity: 1.05,
    density_kg_m3: 8400,
  },

  // ── Hot-section / oxidised superalloy (combustor liner, HPT shrouds that
  //    run blue-grey from heat tint). Darker, rougher, faint thermal-blue. ──
  superalloyHot: {
    label: 'Hot-Section Superalloy (heat-tinted)',
    family: 'metal',
    color: '#5b5f68',          // heat-tinted blue-grey
    metalness: 0.95,
    roughness: 0.55,
    envMapIntensity: 0.85,
    density_kg_m3: 8400,
  },

  // ── CFRP — carbon-fibre composite (4th-gen woven fan blades + nacelle/cowl
  //    skins). Near-black with a deep gloss clearcoat over a visible 2×2-twill
  //    weave; metalness 0 (dielectric resin) with a high clearcoat for the
  //    lacquered carbon look. ──
  carbonFiber: {
    label: 'Carbon-Fibre Composite (CFRP)',
    family: 'composite',
    color: '#15171b',          // near-black resin/weave
    metalness: 0.0,
    roughness: 0.32,
    clearcoat: 1.0,            // lacquered carbon
    clearcoatRoughness: 0.12,
    sheen: 0.25,               // subtle weave sheen
    sheenColor: '#2b2f38',
    envMapIntensity: 1.0,
    density_kg_m3: 1600,
    weave: '2x2-twill',        // hint for a procedural weave normal if no map
  },

  // ── Polished steel (shafts, bearing balls, precision races) — bright,
  //    near-mirror chrome-ish steel. ──
  polishedSteel: {
    label: 'Polished Steel',
    family: 'metal',
    color: '#cdd1d6',
    metalness: 1.0,
    roughness: 0.12,           // near-mirror
    envMapIntensity: 1.2,
    density_kg_m3: 7850,
  },

  // ── Brushed steel / stainless (housings, casings, structural rings) —
  //    satin directional finish. Anisotropic. ──
  brushedSteel: {
    label: 'Brushed Stainless',
    family: 'metal',
    color: '#b9bdc3',
    metalness: 1.0,
    roughness: 0.30,
    envMapIntensity: 1.1,
    anisotropy: 0.7,           // directional brush
    anisotropyRotation: 0.0,
    density_kg_m3: 7850,
  },

  // ── Anodised aluminium (casings / cowl rings / accessory housings). Hard
  //    anodise reads as a semi-matte coating over aluminium — part metal, part
  //    coating, with a thin clearcoat. Two common colourways below. ──
  anodisedGrey: {
    label: 'Hard-Anodised Aluminium (grey)',
    family: 'coating',
    color: '#6c7177',
    metalness: 0.65,
    roughness: 0.5,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.85,
    density_kg_m3: 2700,
  },
  anodisedBlack: {
    label: 'Black Anodised Aluminium',
    family: 'coating',
    color: '#1c1e22',
    metalness: 0.6,
    roughness: 0.6,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.8,
    density_kg_m3: 2700,
  },

  // ── Copper (fuel manifolds, electrical bus, cooling galleries / nozzles
  //    where copper is used). Warm salmon, polished. ──
  copper: {
    label: 'Copper',
    family: 'metal',
    color: '#c08a64',
    metalness: 1.0,
    roughness: 0.24,
    envMapIntensity: 1.15,
    density_kg_m3: 8960,
  },

  // ── Brass / bronze (bushings, gearbox blanks, accessory gears). ──
  brass: {
    label: 'Polished Brass',
    family: 'metal',
    color: '#cba467',
    metalness: 1.0,
    roughness: 0.2,
    envMapIntensity: 1.2,
    density_kg_m3: 8500,
  },

  // ── Case-hardened gear steel (gears, gear teeth) — slightly bluer/harder
  //    than mild steel, fine-ground flanks. ──
  gearSteel: {
    label: 'Case-Hardened Gear Steel',
    family: 'metal',
    color: '#a9adb4',
    metalness: 1.0,
    roughness: 0.22,
    envMapIntensity: 1.1,
    density_kg_m3: 7850,
  },

  // ── Cast iron / structural (housing castings, mounts). Dull, dark, slightly
  //    rough as-cast. ──
  castIron: {
    label: 'Cast Iron',
    family: 'metal',
    color: '#5d6066',
    metalness: 0.9,
    roughness: 0.62,
    envMapIntensity: 0.8,
    density_kg_m3: 7200,
  },

  // ── Elastomer / seal (mechanical-seal faces, labyrinth seal carbon, O-rings).
  //    Matte black dielectric. ──
  elastomer: {
    label: 'Seal Elastomer / Carbon',
    family: 'polymer',
    color: '#16171a',
    metalness: 0.0,
    roughness: 0.9,
    envMapIntensity: 0.35,
    density_kg_m3: 1300,
  },
});

export const MATERIAL_KEYS = Object.freeze(Object.keys(MATERIAL_LIBRARY));

// ───────────────────────────────────────────────────────────────────────────
//  COMPONENT → MATERIAL TAGGER
//  Maps a flagship body NAME (the names ge9xBuilder / planetaryGearboxBuilder /
//  turbopumpBuilder emit) to its engineering material class. The rule list is
//  ordered most-specific → most-general; the FIRST matching rule wins, so e.g.
//  'hpt_blade' resolves to nickelSuperalloy before the generic 'blade' rule and
//  'fan_blade' resolves to carbonFiber (real GE9X 4th-gen composite fan blade).
//  Pure-function + deterministic so a render is reproducible.
// ───────────────────────────────────────────────────────────────────────────
const TAG_RULES = [
  // ── GE9X turbofan ─────────────────────────────────────────────────────────
  // Cold section / fan module — composite fan blades, Ti disk & structure.
  [/fan[_-]?blade/i,            'carbonFiber'],      // 4th-gen CFRP fan blade
  [/nacelle|cowl|bypass[_-]?duct/i, 'carbonFiber'],  // composite nacelle skins
  [/fan[_-]?disk|spinner|fan[_-]?platform/i, 'titanium'],
  [/containment/i,              'titanium'],
  [/ogv|outlet[_-]?guide/i,     'titanium'],
  // Compressor — Ti front stages.
  [/lpc.*(blade|vane)|booster/i, 'titanium'],
  [/hpc.*(blade|vane)/i,        'titanium'],
  // Combustor — hot-section nickel/CMC.
  [/comb.*(liner|panel)|liner[_-]?panel/i, 'superalloyHot'],
  [/swirler|fuel[_-]?nozzle|nozzle.*fuel/i, 'nickelSuperalloy'],
  // Exhaust hot-end — LEAP chevron core nozzle + tail-cone plug (nickel sheet).
  [/chevron|exhaust[_-]?nozzle|tail[_-]?cone|exhaust[_-]?plug/i, 'nickelSuperalloy'],
  // HP turbine — single-crystal nickel superalloy (cooled), hottest part.
  [/hpt.*(blade|nozzle)|cooling[_-]?hole/i, 'nickelSuperalloy'],
  // LP turbine — nickel/Ti.
  [/lpt.*(blade|vane)/i,        'nickelSuperalloy'],
  // Rotating hardware / structure.
  [/shaft/i,                    'polishedSteel'],
  [/bearing[_-]?ball|^bearing.*ball/i, 'polishedSteel'],
  [/seal|labyrinth/i,           'elastomer'],
  [/disc|disk|rotor[_-]?disc/i, 'nickelSuperalloy'],
  [/core[_-]?casing|casing/i,   'anodisedGrey'],
  [/gearbox|gear/i,             'gearSteel'],

  // ── Planetary gearbox ─────────────────────────────────────────────────────
  [/sun[_-]?gear|planet[_-]?gear|ring[_-]?gear|gear$/i, 'gearSteel'],
  [/carrier/i,                  'brushedSteel'],
  [/input[_-]?shaft|output[_-]?shaft/i, 'polishedSteel'],
  [/bearing.*(front|back|inner|outer|race)|bearing\d/i, 'polishedSteel'],
  [/housing.*cap|housing[_-]?shell|housing/i, 'anodisedGrey'],

  // ── Turbopump ─────────────────────────────────────────────────────────────
  [/impeller.*(blade|splitter)/i, 'titanium'],     // pump impeller blades (Ti)
  [/impeller.*shroud|impeller/i, 'titanium'],
  [/inducer/i,                  'titanium'],
  [/turbine[_-]?blade/i,        'nickelSuperalloy'],// hot-gas turbine blades
  [/turbine[_-]?disk|turbine[_-]?disc/i, 'nickelSuperalloy'],
  [/volute|diffuser/i,          'castIron'],        // cast collector / scroll
  [/runner|seat/i,              'elastomer'],        // mechanical-seal faces
  [/pump[_-]?housing|turbine[_-]?housing|center[_-]?housing/i, 'castIron'],
  [/race/i,                     'polishedSteel'],

  // ── Generic fallbacks (least specific) ──────────────────────────────────────
  [/blade|vane|airfoil/i,       'titanium'],
  [/bolt|nut|fastener/i,        'brushedSteel'],
  [/copper|bus[_-]?bar|manifold/i, 'copper'],
  [/brass|bush/i,               'brass'],
  [/shaft/i,                    'polishedSteel'],
  [/housing|casing|case|shell/i, 'anodisedGrey'],
];

/**
 * Resolve the engineering material KEY for a flagship component name.
 * @param {string} name   the body name (e.g. 'hpt_blade', 'sun_gear', 'volute')
 * @param {string} [fallback='brushedSteel']
 * @returns {string} a key in MATERIAL_LIBRARY
 */
export function materialForComponent(name, fallback = 'brushedSteel') {
  const n = String(name || '').trim();
  if (!n) return fallback;
  for (const [re, key] of TAG_RULES) {
    if (re.test(n)) return key;
  }
  return fallback;
}

/**
 * Tag an array of built flagship bodies ({name, handle, role, ...}) with their
 * engineering material key + the resolved preset. Returns NEW objects; does not
 * mutate the input. Use the result to drive per-body material assignment in the
 * viewport / path tracer.
 * @param {Array<{name:string, handle?:number}>} bodies
 * @returns {Array<{...body, material:string, materialPreset:object}>}
 */
export function tagBodiesWithMaterials(bodies = []) {
  return bodies.map((b) => {
    const material = materialForComponent(b.name);
    return { ...b, material, materialPreset: MATERIAL_LIBRARY[material] };
  });
}

/**
 * Summarise the material distribution over a tagged body list — useful for the
 * spec to log "what got assigned what" and for the deck.
 * @returns {{ byMaterial: Record<string,string[]>, counts: Record<string,number> }}
 */
export function materialAssignmentSummary(bodies = []) {
  const byMaterial = {};
  for (const b of bodies) {
    const key = b.material || materialForComponent(b.name);
    (byMaterial[key] ||= []).push(b.name);
  }
  const counts = Object.fromEntries(
    Object.entries(byMaterial).map(([k, v]) => [k, v.length]));
  return { byMaterial, counts };
}

// ───────────────────────────────────────────────────────────────────────────
//  TEXTURE-MAP RESOLUTION (optional, graceful)
//  Looks for real PBR texture sets the user has dropped into
//  frontend/src/assets/pbr/<key>/ (or a custom baseDir). Map naming follows the
//  common ambientCG / Poly Haven CC0 convention. When a set is missing the
//  analytic metal/rough values stand alone — the baseline render needs NO maps.
// ───────────────────────────────────────────────────────────────────────────
const MAP_FILES = {
  map:              ['basecolor', 'albedo', 'col', 'diffuse'],
  roughnessMap:     ['roughness', 'rough', 'rgh'],
  metalnessMap:     ['metalness', 'metallic', 'metal'],
  normalMap:        ['normal', 'nor', 'nrm'],
  aoMap:            ['ao', 'ambientocclusion', 'occlusion'],
  clearcoatNormalMap: ['clearcoatnormal'],
};

/**
 * Build a map-spec for a material key by probing `<baseDir>/<key>/`.
 * @param {string} key            material key
 * @param {(path:string)=>boolean} fileExists  predicate (fs.existsSync wrapper)
 * @param {string} [baseDir]
 * @param {string[]} [exts]
 * @returns {Record<string,string>}  { map:'/abs/path', roughnessMap:'…', … }
 */
export function resolveMaterialMaps(key, fileExists,
                                    baseDir = 'frontend/src/assets/pbr',
                                    exts = ['.jpg', '.png', '.webp']) {
  const out = {};
  if (typeof fileExists !== 'function') return out;
  const dir = `${baseDir}/${key}`;
  for (const [slot, stems] of Object.entries(MAP_FILES)) {
    for (const stem of stems) {
      for (const ext of exts) {
        const p = `${dir}/${stem}${ext}`;
        if (fileExists(p)) { out[slot] = p; break; }
      }
      if (out[slot]) break;
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  THREE.MeshPhysicalMaterial FACTORY
//  Builds a ready material from a library key. Pass an optional `maps` object
//  (from resolveMaterialMaps + a loaded THREE.Texture per slot) to wire real
//  PBR maps; without it the analytic metal/rough preset is used as-is.
// ───────────────────────────────────────────────────────────────────────────

/** Fields that are NOT three.js material properties (metadata only). */
const META_FIELDS = new Set(['label', 'family', 'density_kg_m3', 'weave']);

/**
 * @param {object} THREE   the three module
 * @param {string} key     material key in MATERIAL_LIBRARY
 * @param {object} [opts]
 * @param {Record<string,object>} [opts.textures]  slot → loaded THREE.Texture
 * @param {object} [opts.overrides]  extra material props to merge last
 * @returns {object} THREE.MeshPhysicalMaterial
 */
export function makeThreeMaterial(THREE, key, opts = {}) {
  const preset = MATERIAL_LIBRARY[key] || MATERIAL_LIBRARY.brushedSteel;
  const params = {};
  for (const [k, v] of Object.entries(preset)) {
    if (META_FIELDS.has(k)) continue;
    if (k === 'color' || k === 'sheenColor') { params[k] = new THREE.Color(v); continue; }
    params[k] = v;
  }
  // Wire any supplied textures. sRGB on the colour map; linear on data maps.
  const tex = opts.textures || {};
  for (const [slot, t] of Object.entries(tex)) {
    if (!t) continue;
    if (slot === 'map' && 'colorSpace' in t) { try { t.colorSpace = THREE.SRGBColorSpace; } catch {} }
    params[slot] = t;
  }
  if (opts.overrides) Object.assign(params, opts.overrides);
  return new THREE.MeshPhysicalMaterial(params);
}

/**
 * Build a {handle → THREE.MeshPhysicalMaterial} map for a tagged body list,
 * caching one material instance per UNIQUE key (so a 20k-instance engine shares
 * ~13 materials, not 20k). Returns { byHandle, byKey }.
 */
export function buildMaterialMap(THREE, taggedBodies = [], opts = {}) {
  const byKey = {};
  const byHandle = {};
  for (const b of taggedBodies) {
    const key = b.material || materialForComponent(b.name);
    if (!byKey[key]) byKey[key] = makeThreeMaterial(THREE, key, opts);
    if (b.handle != null) byHandle[b.handle] = byKey[key];
  }
  return { byHandle, byKey };
}

// ───────────────────────────────────────────────────────────────────────────
//  PROCEDURAL STUDIO / HANGAR ENVIRONMENT (offline-safe, NO file/network deps)
//  A real HDRI lights every metallic reflection. drei's <Environment preset>
//  pulls from a CDN (unreliable headless) and @pmndrs/assets is not installed,
//  so for the deterministic render harness we synthesise an equirect HDR
//  texture procedurally: a bright soft overhead key (the studio softbox / hangar
//  skylight), warm fill, cool rim, and a darker floor — the multi-zone luminance
//  a product/hangar shot needs to make Ti / nickel / CFRP read correctly.
//  Returns a THREE.DataTexture (EquirectangularReflectionMapping) usable as both
//  scene.environment and (optionally) scene.background.
// ───────────────────────────────────────────────────────────────────────────
export const ENVIRONMENTS = Object.freeze({
  studio: {
    label: 'Studio Softbox (5500K)',
    // [elevation0..1 from horizon→zenith] keyed luminance + tint
    zenith: [1.35, 1.35, 1.30],   // bright neutral skylight
    horizon: [0.55, 0.57, 0.62],  // cool-grey wall sweep
    floor: [0.10, 0.10, 0.12],    // dark studio floor
    key:   { az: 0.15, el: 0.78, size: 0.16, intensity: 4.2, tint: [1.0, 0.98, 0.94] },
    fill:  { az: 0.62, el: 0.35, size: 0.34, intensity: 1.1, tint: [0.92, 0.95, 1.0] },
    rim:   { az: 0.88, el: 0.55, size: 0.12, intensity: 2.4, tint: [0.85, 0.9, 1.0] },
  },
  hangar: {
    label: 'Aircraft Hangar',
    zenith: [1.05, 1.06, 1.08],
    horizon: [0.42, 0.44, 0.48],
    floor: [0.14, 0.14, 0.15],    // concrete floor bounce
    key:   { az: 0.25, el: 0.7, size: 0.1, intensity: 5.0, tint: [1.0, 0.97, 0.9] },  // skylight strip
    fill:  { az: 0.55, el: 0.3, size: 0.4, intensity: 0.9, tint: [0.9, 0.93, 0.98] },
    rim:   { az: 0.8, el: 0.5, size: 0.14, intensity: 2.0, tint: [0.8, 0.85, 0.95] },
  },
});

/**
 * Build a procedural equirect HDR environment texture.
 * @param {object} THREE   the three module
 * @param {string} [name='studio']  key in ENVIRONMENTS
 * @param {number} [size=512]  equirect width (height = size/2)
 * @returns {object} THREE.DataTexture (float, equirectangular reflection)
 */
export function makeEnvironmentTexture(THREE, name = 'studio', size = 512) {
  const env = ENVIRONMENTS[name] || ENVIRONMENTS.studio;
  const W = size, H = size >> 1;
  const data = new Float32Array(W * H * 4);
  const lights = [env.key, env.fill, env.rim].filter(Boolean);

  for (let y = 0; y < H; y++) {
    // v: 0 (top/zenith) → 1 (bottom/floor); elevation el01: 1 zenith → 0 horizon → <0 floor
    const v = y / (H - 1);
    const el01 = 1 - 2 * v;          // +1 zenith, 0 horizon, -1 nadir
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);          // azimuth 0..1
      let r, g, b;
      if (el01 >= 0) {
        // sky gradient: horizon → zenith
        const t = el01;               // 0 horizon, 1 zenith
        r = env.horizon[0] + (env.zenith[0] - env.horizon[0]) * t;
        g = env.horizon[1] + (env.zenith[1] - env.horizon[1]) * t;
        b = env.horizon[2] + (env.zenith[2] - env.horizon[2]) * t;
      } else {
        // floor gradient: horizon → floor
        const t = -el01;              // 0 horizon, 1 nadir
        r = env.horizon[0] + (env.floor[0] - env.horizon[0]) * t;
        g = env.horizon[1] + (env.floor[1] - env.horizon[1]) * t;
        b = env.horizon[2] + (env.floor[2] - env.horizon[2]) * t;
      }
      // additive soft light discs (key / fill / rim) — Gaussian falloff in
      // (azimuth, elevation) so metals catch a real highlight + a soft sweep.
      const elNorm = (el01 + 1) / 2;  // 0..1 for the disc elevation field
      for (const L of lights) {
        let daz = Math.abs(u - L.az); if (daz > 0.5) daz = 1 - daz;  // wrap azimuth
        const del = elNorm - L.el;
        const d2 = (daz * daz + del * del) / (L.size * L.size);
        const w = Math.exp(-d2) * L.intensity;
        if (w > 1e-3) {
          r += w * (L.tint?.[0] ?? 1);
          g += w * (L.tint?.[1] ?? 1);
          b += w * (L.tint?.[2] ?? 1);
        }
      }
      const i = (y * W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  if ('colorSpace' in tex) tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export default {
  MATERIAL_LIBRARY, MATERIAL_KEYS,
  materialForComponent, tagBodiesWithMaterials, materialAssignmentSummary,
  resolveMaterialMaps, makeThreeMaterial, buildMaterialMap,
  ENVIRONMENTS, makeEnvironmentTexture,
};
