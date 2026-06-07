// PUSH-104 (Slice-72) — Draft-Angle Analysis shader for mold / casting QC.
//
// Background
// ──────────
// In mold tooling and sand / die / investment casting, every face of the
// part that runs along the parting direction (the "pull direction") must
// have a positive draft angle relative to that axis, otherwise the part
// will lock into the mold and snap on ejection. A textbook draft check
// shades the model:
//
//   • GREEN  — angle > threshold   (safe pull, e.g. > 1°)
//   • YELLOW — 0 < angle ≤ threshold (borderline, designer review)
//   • RED    — angle ≤ 0           (undercut — manufactured fails)
//   • GREY   — |normal⋅pullDir| ≈ 1 (a plane perpendicular to the pull —
//     neither draft nor undercut; just shows up flat).
//
// The "angle" we report is the *draft angle* — the deviation of the face
// normal from the plane perpendicular to the pull direction. So:
//
//   draft = 90° − acos(|normal · pullDir|)   (treating the side of the
//                                            face by the SIGN of n·p)
//
// In practice we compute:
//
//   cosA  = dot(normal, pullDir)           // signed
//   draft = degrees(asin(cosA))            // positive if normal points
//                                          // along the pull direction
//                                          // (will release), negative if
//                                          // it points AGAINST it
//                                          // (undercut).
//
// Same closed-form as `surfacingDispatch.draftAnalysis`. The shader does
// the per-fragment colour band; the overlay sets the `pullDir` uniform
// to the user-picked axis.
//
// Implementation
// ──────────────
// • Custom ShaderMaterial — three.js is already in frontend/package.json.
// • Two-sided so back-faces shade too.
// • One uniform per knob — `pullDir` and `threshold` (in radians for
//   shader simplicity; the overlay supplies a degree-input and converts).
// • A faint diffuse floor so the form still reads as a 3D solid.
//
// Hard constraints
// ────────────────
// • NO new npm / C++ / external deps. three.js only.
// • Plain GLSL ES — works on the Electron WebGL2 baseline.

import * as THREE from 'three';

// ─── Defaults ────────────────────────────────────────────────────────
// pullDir is +Z by convention (mold opens along the Z axis); threshold
// is 1° — the textbook minimum draft for injection moulding before
// designers flag the wall for review.
export const DRAFT_DEFAULTS = Object.freeze({
  pullDirId:     '+Z',         // picker preset id
  pullDirX:      0,
  pullDirY:      0,
  pullDirZ:      1,
  thresholdDeg:  1.0,          // borderline boundary in degrees, 0..5
  ambient:       0.25,         // diffuse floor
});

// ─── Pull-direction presets ─────────────────────────────────────────
// Standard mold axes plus an "explicit" slot that the overlay can mutate
// from a numeric XYZ input. Mold designers usually pull along one of the
// six cardinal axes, so the +X / +Y / +Z / −X / −Y / −Z preset
// catalogue is the canonical UI.
export const DRAFT_PULL_PRESETS = Object.freeze([
  { id: '+Z', label: '+Z (top open)',     axis: [0,  0,  1] },
  { id: '-Z', label: '−Z (bottom open)',  axis: [0,  0, -1] },
  { id: '+X', label: '+X (right open)',   axis: [1,  0,  0] },
  { id: '-X', label: '−X (left open)',    axis: [-1, 0,  0] },
  { id: '+Y', label: '+Y (front open)',   axis: [0,  1,  0] },
  { id: '-Y', label: '−Y (back open)',    axis: [0, -1,  0] },
]);

// Marks the material so the host's traversal can recognise it on the
// restore path. Also drives the e2e spec's `material.name === ...`
// assertion (mirrors the PUSH-86 zebra convention).
export const DRAFT_MATERIAL_NAME  = 'forge.draftAnalysis';
export const DRAFT_USERDATA_FLAG  = 'archdiscDraftAnalysis';
export const DRAFT_STASH_KEY      = '__draftOriginalMaterial';

// ─── Vertex shader ─────────────────────────────────────────────────
// We forward the world-space normal so the per-fragment colour band
// matches the user's pull-direction picker exactly — picking +Z must
// colour faces pointing up regardless of where the camera is. The
// view-space position is also forwarded for the soft diffuse floor.
const DRAFT_VERTEX_SHADER = /* glsl */`
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vViewPosition;

  void main() {
    // mat3(modelMatrix) lifts the object-space normal into world space
    // ignoring translation. Normalising here keeps the per-fragment dot
    // stable under non-uniform scales.
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

// ─── Fragment shader ───────────────────────────────────────────────
// Compute the SIGNED draft angle vs the pull direction:
//
//   cosA  = dot(N, pullDir)   in [-1, 1]
//   draft = asin(cosA)        in radians
//
// Then bin by `threshold` (already in radians):
//   draft <  0          → red    (undercut)
//   draft <  threshold  → yellow (borderline)
//   else                → green  (safe)
//
// The user-set `threshold` slider goes 0–5°, the shader stores it in
// radians so the comparison maths is one mul-free `if`.
//
// We modulate the base colour by a soft diffuse term keyed off the
// view direction so the form still reads as a 3D solid. Without that,
// a perfectly flat coloured silhouette is illegible (and looks like a
// post-processing pass instead of an analysis overlay on geometry).
const DRAFT_FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vViewPosition;

  uniform vec3  pullDir;      // unit vector, world space
  uniform float threshold;    // band boundary in radians (≈ deg × π/180)
  uniform float ambient;      // diffuse floor

  void main() {
    vec3 N = normalize(vWorldNormal);
    // Two-sided: pull-side and core-side both shade — mold designers
    // need to see both halves of the part at once.
    vec3 V = normalize(-vViewPosition);

    vec3 P = length(pullDir) > 1e-4 ? normalize(pullDir) : vec3(0.0, 0.0, 1.0);

    // Signed draft. asin of dot(N, P) gives the angle of the normal
    // off the perpendicular plane to P. Positive when N points along
    // P (release safe), negative when it points against P (undercut).
    float cosA = clamp(dot(N, P), -1.0, 1.0);
    float draft = asin(cosA);

    // Band selection.
    vec3 GREEN  = vec3(0.20, 0.78, 0.30);
    vec3 YELLOW = vec3(0.95, 0.83, 0.20);
    vec3 RED    = vec3(0.92, 0.20, 0.20);

    vec3 band;
    if (draft < 0.0) {
      band = RED;
    } else if (draft < threshold) {
      band = YELLOW;
    } else {
      band = GREEN;
    }

    // Soft diffuse — uses the view-direction so it falls off toward
    // grazing angles. ambient is the floor; the rest is N·V driven.
    float diff = ambient + (1.0 - ambient) * clamp(dot(N, V), 0.0, 1.0);

    gl_FragColor = vec4(band * diff, 1.0);
  }
`;

// ─── Builder ────────────────────────────────────────────────────────
// Returns a configured ShaderMaterial. The overlay swaps every body
// mesh's material with the SAME instance so a uniform update reflects
// on every body simultaneously.
export function buildDraftMaterial(opts = {}) {
  const x = Number.isFinite(opts.pullDirX) ? opts.pullDirX : DRAFT_DEFAULTS.pullDirX;
  const y = Number.isFinite(opts.pullDirY) ? opts.pullDirY : DRAFT_DEFAULTS.pullDirY;
  const z = Number.isFinite(opts.pullDirZ) ? opts.pullDirZ : DRAFT_DEFAULTS.pullDirZ;
  const thresholdDeg = clampNum(opts.thresholdDeg ?? DRAFT_DEFAULTS.thresholdDeg, 0, 5);
  const ambient      = clampNum(opts.ambient      ?? DRAFT_DEFAULTS.ambient,      0, 1);

  // Normalize the pull direction defensively — a user-supplied
  // (0,0,0) would collapse to NaN in the fragment shader.
  const len = Math.hypot(x, y, z);
  const ux = len > 1e-4 ? x / len : 0;
  const uy = len > 1e-4 ? y / len : 0;
  const uz = len > 1e-4 ? z / len : 1;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      pullDir:   { value: new THREE.Vector3(ux, uy, uz) },
      threshold: { value: thresholdDeg * Math.PI / 180 },
      ambient:   { value: ambient },
    },
    vertexShader:   DRAFT_VERTEX_SHADER,
    fragmentShader: DRAFT_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.name = DRAFT_MATERIAL_NAME;
  material.userData[DRAFT_USERDATA_FLAG] = true;
  material.userData.thresholdDeg = thresholdDeg;
  material.userData.pullDirX = ux;
  material.userData.pullDirY = uy;
  material.userData.pullDirZ = uz;
  return material;
}

// Mutate an already-built material so slider scrubs don't tear down
// and rebuild the shader on every change. Returns the same material.
export function updateDraftUniforms(material, opts = {}) {
  if (!material || !material.userData?.[DRAFT_USERDATA_FLAG]) return material;
  const u = material.uniforms;
  if (opts.pullDirX !== undefined ||
      opts.pullDirY !== undefined ||
      opts.pullDirZ !== undefined) {
    const x = Number.isFinite(opts.pullDirX) ? opts.pullDirX : material.userData.pullDirX;
    const y = Number.isFinite(opts.pullDirY) ? opts.pullDirY : material.userData.pullDirY;
    const z = Number.isFinite(opts.pullDirZ) ? opts.pullDirZ : material.userData.pullDirZ;
    const len = Math.hypot(x, y, z);
    const ux = len > 1e-4 ? x / len : 0;
    const uy = len > 1e-4 ? y / len : 0;
    const uz = len > 1e-4 ? z / len : 1;
    u.pullDir.value.set(ux, uy, uz);
    material.userData.pullDirX = ux;
    material.userData.pullDirY = uy;
    material.userData.pullDirZ = uz;
  }
  if (opts.thresholdDeg !== undefined) {
    const v = clampNum(opts.thresholdDeg, 0, 5);
    u.threshold.value = v * Math.PI / 180;
    material.userData.thresholdDeg = v;
  }
  if (opts.ambient !== undefined) {
    u.ambient.value = clampNum(opts.ambient, 0, 1);
  }
  return material;
}

// ─── Material-swap helpers ─────────────────────────────────────────
// Same shape as PUSH-87 light-line / PUSH-86 zebra — we own a stash key
// (`__draftOriginalMaterial`) so toggling the analysis off restores the
// PBR material that was already on the mesh.

// Cooperate with PUSH-86 zebra and PUSH-87 light-line. If the user
// already has one of those overlays running on the body, we restore
// THEIR stashed original before swapping in the draft material — so
// the user's "Disable Draft" path returns to the underlying PBR, not
// to a stale isophote / zebra material.
const ZEBRA_STASH_KEY     = '_origMaterial';
const ZEBRA_MAT_NAME      = 'forge.zebraStripes';
const LIGHTLINE_STASH_KEY = '__lightLineOriginalMaterial';
const LIGHTLINE_FLAG      = 'archdiscLightLine';

/** Apply the draft material across every body mesh under `root`.
 *  Returns the applied count so the overlay can show "applied N
 *  meshes" feedback in the panel. */
export function applyDraftToObject(root, material) {
  if (!root || !material) return { applied: 0 };
  let applied = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData) return;
    if (!o.userData.body && !o.userData.bodyId) return;
    // Skip the SelectionHighlight overlay's internal meshes.
    if (o.parent && o.parent.name === 'forge-selection-highlight') return;

    // PUSH-86 zebra cooperation: peel zebra off first.
    if (o.material?.name === ZEBRA_MAT_NAME && o.userData?.[ZEBRA_STASH_KEY]) {
      o.material = o.userData[ZEBRA_STASH_KEY];
      delete o.userData[ZEBRA_STASH_KEY];
    }
    // PUSH-87 light-line cooperation: peel light-line off first.
    if (o.material?.userData?.[LIGHTLINE_FLAG] && o.userData?.[LIGHTLINE_STASH_KEY]) {
      const restored = o.userData[LIGHTLINE_STASH_KEY];
      try { o.material.dispose(); } catch {}
      o.material = restored;
      delete o.userData[LIGHTLINE_STASH_KEY];
    }

    // Already wearing a draft material — replace it in-place.
    if (o.material?.userData?.[DRAFT_USERDATA_FLAG]) {
      try { o.material.dispose(); } catch {}
      o.material = material;
      applied += 1;
      return;
    }
    o.userData[DRAFT_STASH_KEY] = o.material;
    o.material = material;
    applied += 1;
  });
  return { applied };
}

/** Restore every mesh's original material that the draft overlay
 *  stashed. Returns the restored count. */
export function clearDraftFromObject(root) {
  if (!root) return { restored: 0 };
  let restored = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData?.[DRAFT_STASH_KEY]) return;
    if (o.material?.userData?.[DRAFT_USERDATA_FLAG]) {
      try { o.material.dispose(); } catch {}
    }
    o.material = o.userData[DRAFT_STASH_KEY];
    delete o.userData[DRAFT_STASH_KEY];
    restored += 1;
  });
  return { restored };
}

// ─── Pure analysis helper for unit tests / Archie tool calls ───────
// Compute the per-vertex draft angle from a normal + pullDir without a
// GPU. The shader does the same calculation per-fragment. Exported so
// the e2e can verify the classification logic without sampling pixels.
export function classifyDraft(normal, pullDir, thresholdDeg) {
  const n = norm3(normal);
  const p = norm3(pullDir);
  if (!n || !p) return { angleDeg: 0, band: 'safe' };
  const cosA = Math.max(-1, Math.min(1, n[0] * p[0] + n[1] * p[1] + n[2] * p[2]));
  const angleDeg = Math.asin(cosA) * 180 / Math.PI;
  const t = clampNum(thresholdDeg ?? 1, 0, 90);
  let band;
  if (angleDeg < 0) band = 'undercut';
  else if (angleDeg < t) band = 'borderline';
  else band = 'safe';
  return { angleDeg, band };
}

// Compute a green/yellow/red ratio over a sample of N random face
// normals on a unit sphere. Used by the e2e to assert the shader's
// classification is plausible (green-ratio > 0 for any non-degenerate
// pull direction). Pure math; no three.js.
export function sampleDraftBands(pullDir, thresholdDeg, samples) {
  const n = Math.max(8, samples | 0);
  let green = 0, yellow = 0, red = 0;
  for (let i = 0; i < n; i++) {
    // Spherical fibonacci — deterministic distribution over the sphere
    // so the ratios are reproducible across test runs.
    const t = i / n;
    const phi = Math.acos(1 - 2 * t);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const theta = golden * i;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.sin(phi) * Math.sin(theta);
    const nz = Math.cos(phi);
    const { band } = classifyDraft([nx, ny, nz], pullDir, thresholdDeg);
    if (band === 'safe') green += 1;
    else if (band === 'borderline') yellow += 1;
    else red += 1;
  }
  return { green, yellow, red, total: n,
           greenRatio: green / n, yellowRatio: yellow / n, redRatio: red / n };
}

// ─── Internals ──────────────────────────────────────────────────────
function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
function norm3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}
