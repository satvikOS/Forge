// PUSH-86 (Slice-54) — Zebra stripes Class-A surface analysis shaders.
//
// Class-A surfacing tools (Alias, ICEM, Catia) ship a "Zebra Stripes"
// analyzer: alternating black / white reflection bands projected from a
// virtual chrome environment. The stripe spacing + orientation must stay
// continuous across body boundaries — any G0 / G1 / G2 defect shows up as
// a kink, break, or wobble in the stripes. It is the canonical visual
// continuity test for show-surface design.
//
// We compute the stripes in real-time on the GPU via a tiny custom
// three.js ShaderMaterial. The fragment shader:
//
//   1. Builds the view-direction vector in world space.
//   2. Reflects it off the interpolated world-space normal.
//   3. Projects the reflected vector onto a user-controlled axis (a unit
//      vector — default (0,1,0) for horizontal stripes wrapping the body
//      like rings).
//   4. Maps the scalar projection through fract(value * stripeCount) to
//      get a sawtooth, then a `step()` against `stripeWidth` gives crisp
//      alternating bands.
//
// Uniforms:
//   • stripeCount  — number of stripes wrapping the reflection sphere
//                    (default 24). Higher = thinner stripes = finer
//                    continuity test.
//   • stripeWidth  — duty cycle 0..1 (default 0.5 = even black/white).
//   • axis         — unit vec3 the reflected dir is projected onto
//                    (default (0,1,0)).
//   • stripeColorA — RGB for the dark stripe (default near-black).
//   • stripeColorB — RGB for the light stripe (default near-white).
//
// The shaders are exported as plain GLSL strings so the host component
// can instantiate `new THREE.ShaderMaterial({...})` without us having to
// import three at module-load time (three is heavy, lazy-load).
//
// Hard constraints:
//   • NO new npm / C++ deps. three.js is already in frontend/package.json.
//   • Plain GLSL — no GLSL extensions, works on the Electron baseline
//     (WebGL2 always; the fragment uses fwidth-free math so it also
//     compiles under WebGL1).

// ─── Vertex shader ──────────────────────────────────────────────────
// We forward the world-space position + world-space normal to the
// fragment so the reflection math is consistent across body
// transforms. `modelMatrix` is supplied by three.js automatically.
export const ZEBRA_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    // normalMatrix is the inverse-transpose of the upper 3x3 of
    // modelViewMatrix, so we rebuild a model-space transform that
    // strips translation (using mat3(modelMatrix)) and normalize.
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// ─── Fragment shader ────────────────────────────────────────────────
// Stripe formula:
//   r = reflect(viewDir, normal)
//   t = dot(r, axis) * stripeCount        // sawtooth period maps to 1.0
//   s = step(stripeWidth, fract(t))       // 0 = colorA, 1 = colorB
// We also add a faint Fresnel rim so the silhouette stays readable on
// otherwise-flat black stripes.
export const ZEBRA_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float stripeCount;
  uniform float stripeWidth;
  uniform vec3  axis;
  uniform vec3  stripeColorA;
  uniform vec3  stripeColorB;
  uniform vec3  cameraPosWorld;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosWorld - vWorldPos);
    vec3 R = reflect(-V, N);

    // Normalise axis defensively — a user-supplied (0,0,0) would
    // collapse to NaNs; treat it as Y.
    vec3 ax = length(axis) > 1e-4 ? normalize(axis) : vec3(0.0, 1.0, 0.0);
    float t = dot(R, ax) * stripeCount;
    float band = step(stripeWidth, fract(t));
    vec3 stripeRgb = mix(stripeColorA, stripeColorB, band);

    // Fresnel rim — light fade-in at grazing angles so the
    // silhouette stays visible even where stripes happen to align
    // with view-direction edges.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 rgb = mix(stripeRgb, vec3(0.62, 0.66, 0.74), fres * 0.18);

    gl_FragColor = vec4(rgb, 1.0);
  }
`;

// ─── Default uniform values ─────────────────────────────────────────
export const ZEBRA_DEFAULTS = Object.freeze({
  stripeCount: 24,
  stripeWidth: 0.5,
  axisX: 0,
  axisY: 1,
  axisZ: 0,
  colorA: [0.04, 0.04, 0.05],     // near-black
  colorB: [0.94, 0.95, 0.97],     // near-white
});

// ─── Uniform builder ────────────────────────────────────────────────
// Build the `uniforms` dictionary that three.js's ShaderMaterial
// constructor expects. The host wraps each value in `{ value: x }`
// because three uses that shape internally to drive WebGL uniform
// updates without React diffing every frame.
export function buildZebraUniforms(opts = {}) {
  const stripeCount  = Number.isFinite(opts.stripeCount)  ? opts.stripeCount  : ZEBRA_DEFAULTS.stripeCount;
  const stripeWidth  = Number.isFinite(opts.stripeWidth)  ? opts.stripeWidth  : ZEBRA_DEFAULTS.stripeWidth;
  const axisX        = Number.isFinite(opts.axisX)        ? opts.axisX        : ZEBRA_DEFAULTS.axisX;
  const axisY        = Number.isFinite(opts.axisY)        ? opts.axisY        : ZEBRA_DEFAULTS.axisY;
  const axisZ        = Number.isFinite(opts.axisZ)        ? opts.axisZ        : ZEBRA_DEFAULTS.axisZ;
  const colorA       = Array.isArray(opts.colorA) && opts.colorA.length === 3 ? opts.colorA : ZEBRA_DEFAULTS.colorA;
  const colorB       = Array.isArray(opts.colorB) && opts.colorB.length === 3 ? opts.colorB : ZEBRA_DEFAULTS.colorB;
  return {
    stripeCount:  { value: stripeCount },
    stripeWidth:  { value: stripeWidth },
    axis:         { value: { x: axisX, y: axisY, z: axisZ } },
    stripeColorA: { value: { x: colorA[0], y: colorA[1], z: colorA[2] } },
    stripeColorB: { value: { x: colorB[0], y: colorB[1], z: colorB[2] } },
    cameraPosWorld: { value: { x: 0, y: 0, z: 0 } },
  };
}

// ─── Axis presets ───────────────────────────────────────────────────
// Three canonical zebra orientations. Class-A workflow flips through
// these to triangulate continuity defects: horizontal rings catch G2
// breaks in the longitudinal direction, vertical rings catch them in
// the radial direction, and the diagonal preset is a sanity check that
// the stripes aren't simply aligned with a flat plane's natural axis.
export const ZEBRA_AXIS_PRESETS = Object.freeze([
  { id: 'horizontal', label: 'Horizontal (Y)', axis: [0, 1, 0] },
  { id: 'vertical',   label: 'Vertical (X)',   axis: [1, 0, 0] },
  { id: 'depth',      label: 'Depth (Z)',      axis: [0, 0, 1] },
  { id: 'diagonal',   label: 'Diagonal',       axis: [0.577, 0.577, 0.577] },
]);

// Mark a material so the host's traversal can re-recognise our
// material on a swap-back path (and so tests have a stable
// classification string). Set after material construction.
export const ZEBRA_MATERIAL_NAME = 'forge.zebraStripes';
