// PUSH-87 (Slice-55) — Light-line / Isophote shader for Class-A surfacing QC.
//
// An *isophote* is a curve on a surface where the dot product between the
// surface normal and a fixed light direction is constant. The classic
// automotive Class-A bench drags a panel under a single tube light and
// looks for kinks in the highlight line — that highlight IS an isophote,
// and a kink in the highlight is a visible discontinuity (G1 break /
// curvature jump) at the corresponding light value.
//
// Compared to the existing zebra (multiple stripes from a reflected ray,
// foundation/ZebraStripes.js) the light-line view is sharper and quieter
// for a single-band inspection: you see ONE highlight contour at the
// chosen light angle so kinks pop. Designers use both views in tandem.
//
// Implementation:
//   • Per-fragment view-space normal + view-space light direction.
//   • Compute c = dot(normal, lightDir), clamped to [-1, 1].
//   • Mod the value into `lineDensity` repeating bands and pick the
//     distance to the band centre. Where that distance is below
//     `threshold` we emit a dark "light line"; elsewhere we keep the
//     surface colour (lit by a soft diffuse so the form still reads).
//   • Curvature-based dimming: the magnitude of the screen-space
//     derivative of `c` tells us how fast the normal is changing across
//     the pixel. SOFT transitions (low |∇c|) produce faint lines (line
//     gets dimmed to grey); SHARP G1 kinks (high |∇c|) produce bold
//     black lines. This is the standard isophote-strength trick from
//     CAD class-A workflows — without it the lines all read identical
//     and you can't tell a creep from a real break.
//
// This module MAY import three.js (it returns a configured ShaderMaterial).
// It is otherwise side-effect-free — a builder, not a singleton.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Defaults — chosen so a textbook curved bonnet on iso shows ~6 visible
// highlight bands across the surface, each ~2 px wide on a 1080 viewport.
// `lightDir` defaults to az 45° / el 30° (three-quarter studio key,
// matching LightingPanel's defaults).

export const ISOPHOTE_DEFAULTS = Object.freeze({
  lineDensity: 12,    // number of repeating bands across the surface
  threshold:   0.04,  // half-width of the dark line in band-fraction space
  azimuth:     45,    // degrees, 0–360, CCW from +X around +Y
  elevation:   30,    // degrees, -90–90, + up
  surfaceColor: '#bfc6d1', // a muted brushed-aluminium tint
  ambient:     0.30,  // diffuse floor so the form reads under the lines
  curvatureGain: 8.0, // how fast bold black ramps in vs soft grey
});

// Convert (az°, el°) to a unit XYZ vector. Y-up, matching LightingPanel
// and the three.js convention in the Viewport.
export function dirFromAzEl(azDeg, elDeg) {
  const az = (Number(azDeg) || 0) * Math.PI / 180;
  const el = (Number(elDeg) || 0) * Math.PI / 180;
  const x = Math.cos(el) * Math.cos(az);
  const z = Math.cos(el) * Math.sin(az);
  const y = Math.sin(el);
  return { x, y, z };
}

// Convert an `#rrggbb` colour into a THREE.Color (with `#rgb` shorthand
// expanded). Falls back to the default surface tint on any parse error.
function colorFromHex(hex) {
  if (typeof hex !== 'string') return new THREE.Color(ISOPHOTE_DEFAULTS.surfaceColor);
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (m6) return new THREE.Color(`#${m6[1].toLowerCase()}`);
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(hex.trim());
  if (m3) {
    const [r, g, b] = m3[1];
    return new THREE.Color(`#${r}${r}${g}${g}${b}${b}`.toLowerCase());
  }
  return new THREE.Color(ISOPHOTE_DEFAULTS.surfaceColor);
}

// ---------------------------------------------------------------------------
// Vertex shader — pass through view-space normal + position so the
// fragment shader can do the lighting maths in a frame the user can
// reason about ("normal points toward the camera at iso").

const ISOPHOTE_VERTEX_SHADER = /* glsl */`
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    vViewNormal   = normalize(normalMatrix * normal);
    vec4 mvPos    = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPos.xyz;
    gl_Position   = projectionMatrix * mvPos;
  }
`;

// Fragment shader — the isophote contour pass + curvature-based dimming.
// The light direction is supplied in *view space* so panning the camera
// updates the highlight bands the way a real panel under a real tube
// light would. We also two-side the normal so back-faces stripe too.

const ISOPHOTE_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  uniform vec3  lightDir;       // unit vector, view-space
  uniform float lineDensity;    // bands across the dot-product range
  uniform float threshold;      // half-width of a dark line (in band units)
  uniform vec3  surfaceColor;   // RGB 0..1 base surface tint
  uniform float ambient;        // diffuse floor (keeps the form 3D)
  uniform float curvatureGain;  // 0..∞, controls soft→bold ramp

  void main() {
    // Two-sided: face the normal toward the camera so back faces light up
    // the same way the front does. This matches ZebraStripes' policy.
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(-vViewPosition);
    if (dot(N, V) < 0.0) N = -N;

    // The isophote scalar: dot(normal, light). Continuous in N → the
    // band pattern inherits the surface's continuity class exactly.
    float c = clamp(dot(N, normalize(lightDir)), -1.0, 1.0);

    // Repeating bands of width 1/lineDensity. We compute the distance
    // from the band centre (0.5 in fract space) and call anything
    // closer than threshold a light-line.
    float phase = c * lineDensity;
    float d     = abs(fract(phase) - 0.5);

    // Screen-space derivative of the band phase. Bigger derivative ⇒
    // sharper change in normal across the pixel ⇒ this is a kink,
    // not a smooth roll. We use it to gate the line's blackness:
    // soft transitions stay faint grey, sharp G1 breaks go bold black.
    float dPhase = max(fwidth(phase), 1e-5);
    // Map [0, dPhase * curvatureGain] → [0, 1] then square it so the
    // dim-→-bold ramp is perceptually steep without an explicit pow.
    float kink = clamp(dPhase * curvatureGain, 0.0, 1.0);
    kink = kink * kink;

    // Anti-aliased line mask using fwidth on 'd' itself.
    float aa     = max(fwidth(d), 1e-5);
    float mask   = 1.0 - smoothstep(threshold - aa, threshold + aa, d);

    // Soft diffuse so the base surface still reads as a 3D solid.
    float diff   = ambient + (1.0 - ambient) * clamp(dot(N, V), 0.0, 1.0);
    vec3 surface = surfaceColor * diff;

    // Line tint: a dim grey for soft transitions, full black for kinks.
    // Mix surface ⇄ line by the mask.
    vec3 lineCol = mix(vec3(0.42), vec3(0.0), kink);
    vec3 outCol  = mix(surface, lineCol, mask);

    gl_FragColor = vec4(outCol, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Public builder. Returns a configured THREE.ShaderMaterial whose
// uniforms can be poked at runtime — the LightLineAnalysisOverlay does
// exactly that so the sliders update the live material without rebuilding.

/**
 * Build the light-line / isophote shader material.
 *
 * @param {object} [opts]
 * @param {number} [opts.lineDensity=12]   bands across the dot-product range.
 * @param {number} [opts.threshold=0.04]   half-width of the dark line.
 * @param {number} [opts.azimuth=45]       light direction azimuth (deg).
 * @param {number} [opts.elevation=30]     light direction elevation (deg).
 * @param {string} [opts.surfaceColor]     base hex colour (e.g. '#bfc6d1').
 * @param {number} [opts.ambient=0.30]     diffuse floor.
 * @param {number} [opts.curvatureGain=8]  soft→bold ramp factor.
 * @returns {THREE.ShaderMaterial}         two-sided isophote material.
 */
export function buildIsophoteMaterial(opts = {}) {
  const lineDensity   = clampNum(opts.lineDensity   ?? ISOPHOTE_DEFAULTS.lineDensity,
                                 1, 256);
  const threshold     = clampNum(opts.threshold     ?? ISOPHOTE_DEFAULTS.threshold,
                                 0.001, 0.5);
  const azimuth       = clampNum(opts.azimuth       ?? ISOPHOTE_DEFAULTS.azimuth,
                                 0, 360);
  const elevation     = clampNum(opts.elevation     ?? ISOPHOTE_DEFAULTS.elevation,
                                 -90, 90);
  const ambient       = clampNum(opts.ambient       ?? ISOPHOTE_DEFAULTS.ambient,
                                 0, 1);
  const curvatureGain = clampNum(opts.curvatureGain ?? ISOPHOTE_DEFAULTS.curvatureGain,
                                 0, 128);
  const surfaceColor  = colorFromHex(opts.surfaceColor ?? ISOPHOTE_DEFAULTS.surfaceColor);

  const d = dirFromAzEl(azimuth, elevation);
  const lightDir = new THREE.Vector3(d.x, d.y, d.z).normalize();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      lightDir:      { value: lightDir },
      lineDensity:   { value: lineDensity },
      threshold:     { value: threshold },
      surfaceColor:  { value: surfaceColor },
      ambient:       { value: ambient },
      curvatureGain: { value: curvatureGain },
    },
    vertexShader:   ISOPHOTE_VERTEX_SHADER,
    fragmentShader: ISOPHOTE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });

  // Tags so the overlay can recognise + restore its own materials, AND
  // can defensively skip swapping over a zebra material left behind by
  // foundation/ZebraStripes.js (we cooperate — both overlays use the
  // same `__lightLineOriginalMaterial` / `__zebraOriginalMaterial`
  // stash keys so toggling either one back off cleanly restores the
  // underlying PBR).
  material.userData.archdiscLightLine = true;
  material.userData.lineDensity = lineDensity;
  material.userData.threshold   = threshold;
  material.userData.azimuth     = azimuth;
  material.userData.elevation   = elevation;
  material.userData.surfaceColor = opts.surfaceColor ?? ISOPHOTE_DEFAULTS.surfaceColor;
  return material;
}

/**
 * Mutate an already-built isophote material so a slider scrub doesn't
 * tear down and rebuild the shader on every change. Returns the same
 * material for convenience.
 */
export function updateIsophoteUniforms(material, opts = {}) {
  if (!material || !material.userData?.archdiscLightLine) return material;
  const u = material.uniforms;
  if (opts.lineDensity !== undefined) {
    const v = clampNum(opts.lineDensity, 1, 256);
    u.lineDensity.value = v;
    material.userData.lineDensity = v;
  }
  if (opts.threshold !== undefined) {
    const v = clampNum(opts.threshold, 0.001, 0.5);
    u.threshold.value = v;
    material.userData.threshold = v;
  }
  if (opts.azimuth !== undefined || opts.elevation !== undefined) {
    const az = opts.azimuth !== undefined
      ? clampNum(opts.azimuth, 0, 360) : material.userData.azimuth;
    const el = opts.elevation !== undefined
      ? clampNum(opts.elevation, -90, 90) : material.userData.elevation;
    const d = dirFromAzEl(az, el);
    u.lightDir.value.set(d.x, d.y, d.z).normalize();
    material.userData.azimuth   = az;
    material.userData.elevation = el;
  }
  if (opts.surfaceColor !== undefined) {
    u.surfaceColor.value.copy(colorFromHex(opts.surfaceColor));
    material.userData.surfaceColor = opts.surfaceColor;
  }
  if (opts.ambient !== undefined) {
    u.ambient.value = clampNum(opts.ambient, 0, 1);
  }
  if (opts.curvatureGain !== undefined) {
    u.curvatureGain.value = clampNum(opts.curvatureGain, 0, 128);
  }
  return material;
}

// PUSH-86 zebra (./ZebraStripesOverlay.jsx) parks the original material on
// `mesh.userData._origMaterial` and gives its swapped material the name
// `forge.zebraStripes`. We cooperate explicitly: if a zebra material is
// in place when we enable, we peel it off and route its stashed PBR
// material into our own `__lightLineOriginalMaterial` stash so disabling
// either overlay always returns to the underlying PBR. We also recognise
// foundation/ZebraStripes.js' older `__zebraOriginalMaterial` /
// `material.userData.archdiscZebra` pair as a defensive fallback for the
// legacy tool-engine path.
const ZEBRA_OVERLAY_STASH_KEY = '_origMaterial';
const ZEBRA_OVERLAY_MAT_NAME  = 'forge.zebraStripes';
const ZEBRA_FOUNDATION_STASH_KEY = '__zebraOriginalMaterial';

/**
 * Apply (or toggle off) the isophote material across every mesh under a
 * scene subtree. Each mesh's original material is stashed in
 * `userData.__lightLineOriginalMaterial` so a subsequent disable
 * restores it cleanly. Co-operates with PUSH-86 zebra
 * (./ZebraStripesOverlay.jsx) AND the legacy foundation/ZebraStripes.js —
 * if the mesh is currently striped, we restore the zebra-stashed
 * original FIRST so the two overlays never collide.
 *
 * @param {THREE.Object3D} root   scene / group / mesh to walk.
 * @param {THREE.ShaderMaterial} material  the isophote material to assign.
 * @returns {{ applied: number }}  count of meshes the material was applied to.
 */
export function applyIsophoteToObject(root, material) {
  if (!root || !material) return { applied: 0 };
  let applied = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    // Skip the SelectionHighlight overlay's internal meshes — they have
    // their own materials and live under a named group.
    if (o.parent && o.parent.name === 'forge-selection-highlight') return;
    // Only target real body meshes. Viewport.jsx tags every body mesh's
    // userData with `body` (the parent body record) and `bodyId` (the
    // handle / id). Helper meshes (floor, gizmo, selection highlight,
    // section plane, …) lack both keys so they're left untouched.
    if (!o.userData || (!o.userData.body && !o.userData.bodyId)) return;
    // PUSH-86 zebra cooperation: if a zebra-stripes material is in place,
    // restore its stashed original BEFORE we swap. We never leave a
    // zebra material live on a body the user has light-line analysed.
    if (o.material?.name === ZEBRA_OVERLAY_MAT_NAME &&
        o.userData?.[ZEBRA_OVERLAY_STASH_KEY]) {
      o.material = o.userData[ZEBRA_OVERLAY_STASH_KEY];
      delete o.userData[ZEBRA_OVERLAY_STASH_KEY];
    }
    // Legacy foundation/ZebraStripes.js path (used by the older tool
    // engine, kept for defence in depth).
    if (o.userData?.[ZEBRA_FOUNDATION_STASH_KEY] &&
        o.material?.userData?.archdiscZebra) {
      const restored = o.userData[ZEBRA_FOUNDATION_STASH_KEY];
      try { o.material.dispose(); } catch {}
      o.material = restored;
      delete o.userData[ZEBRA_FOUNDATION_STASH_KEY];
    }
    // Already wearing a light-line material — replace it in-place; the
    // previous one is disposed below.
    if (o.material?.userData?.archdiscLightLine) {
      // Keep the original stash; just swap the analysis material.
      try { o.material.dispose(); } catch {}
      o.material = material;
      applied += 1;
      return;
    }
    // Fresh subject — stash the existing material, then swap.
    o.userData.__lightLineOriginalMaterial = o.material;
    o.material = material;
    applied += 1;
  });
  return { applied };
}

/**
 * Restore every mesh's original material that the isophote overlay
 * stashed. Returns the number of meshes restored.
 */
export function clearIsophoteFromObject(root) {
  if (!root) return { restored: 0 };
  let restored = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData?.__lightLineOriginalMaterial) return;
    if (o.material?.userData?.archdiscLightLine) {
      try { o.material.dispose(); } catch {}
    }
    o.material = o.userData.__lightLineOriginalMaterial;
    delete o.userData.__lightLineOriginalMaterial;
    restored += 1;
  });
  return { restored };
}

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
