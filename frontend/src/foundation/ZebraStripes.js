/**
 * ArchDisc Foundation — zebra-stripe continuity shading for class-A surfacing.
 *
 * Zebra (reflection-line) analysis is the other half of the class-A workflow
 * alongside the Gaussian-curvature heatmap (ClassACurvature.js). It simulates
 * the surface reflecting a striped environment — the way a body shop drags a
 * panel under a striped fluorescent ceiling — and the striping reveals
 * surface continuity:
 *
 *   • G0 (position only)   — stripes are BROKEN / mismatched across the join.
 *   • G1 (tangent)         — stripes MEET at the join but KINK sharply.
 *   • G2 (curvature)       — stripes flow SMOOTHLY across the join, no kink.
 *
 * Implementation: a `THREE.ShaderMaterial`. The fragment shader reflects the
 * view direction about the interpolated surface normal, projects the reflected
 * ray onto a stripe axis, and bands that projection with a high-contrast
 * (sharpened) cosine. Because the reflected ray is a continuous function of
 * the normal, the stripe pattern inherits the surface's continuity class
 * exactly — a curvature discontinuity shows as a stripe kink, a tangent break
 * as a stripe jump. This is the standard real-time zebra technique; it needs
 * no environment cube-map and works on arbitrary triangle geometry.
 *
 * The shader keeps a soft diffuse term so the part still reads as a 3D solid
 * under the stripes (a pure black/white mask hides form). Anti-aliasing on
 * the stripe edges uses screen-space derivatives (fwidth) so the bands stay
 * crisp without shimmering at grazing angles.
 *
 * This module MAY import THREE (it returns a configured THREE material). It
 * is otherwise side-effect-free — a builder, not a singleton.
 */

import * as THREE from 'three';

const STRIPE_VERTEX_SHADER = /* glsl */`
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    // Normal and position in VIEW space — zebra reflection is a
    // view-dependent instrument, exactly like a real striped ceiling.
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STRIPE_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  uniform float uFrequency;   // number of stripe bands
  uniform float uSharpness;   // 0 = soft cosine, 1 = hard edges
  uniform vec3  uStripeAxis;  // stripe direction in view space
  uniform vec3  uDarkColor;   // colour of the dark bands
  uniform vec3  uLightColor;  // colour of the light bands
  uniform float uAmbient;     // diffuse floor so the form still reads

  void main() {
    // Two-sided: face the normal toward the camera so back faces stripe too.
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(-vViewPosition);          // surface → camera
    if (dot(N, V) < 0.0) N = -N;

    // Reflect the view ray about the surface normal — the direction the
    // striped environment is sampled from. Continuous in N, so the stripe
    // pattern carries the surface's continuity class.
    vec3 R = reflect(-V, N);

    // Project the reflected ray onto the stripe axis and band it.
    float s = dot(R, normalize(uStripeAxis));
    float phase = s * uFrequency;
    // Cosine band in [0,1]; fwidth gives a screen-space-stable soft edge.
    float c = 0.5 + 0.5 * cos(phase * 6.2831853);
    float aa = max(fwidth(phase) * 1.5, 1e-4);
    // Sharpen toward hard stripes as uSharpness → 1.
    float edge = mix(0.30, 0.012, clamp(uSharpness, 0.0, 1.0));
    float band = smoothstep(0.5 - edge - aa, 0.5 + edge + aa, c);

    vec3 stripe = mix(uDarkColor, uLightColor, band);

    // Soft diffuse so the solid still reads as 3D under the stripes.
    float diff = uAmbient + (1.0 - uAmbient) * clamp(dot(N, V), 0.0, 1.0);
    gl_FragColor = vec4(stripe * diff, 1.0);
  }
`;

/**
 * Build the zebra-stripe `THREE.ShaderMaterial`.
 *
 * @param {object} [opts]
 * @param {number} [opts.stripeFrequency=16]  number of stripe bands (4..64).
 * @param {number} [opts.direction=0]         0 = horizontal stripes,
 *                                            1 = vertical stripes.
 * @param {number} [opts.sharpness=0.85]      0 soft cosine → 1 hard-edged.
 * @param {number} [opts.ambient=0.32]        diffuse floor (keeps the form 3D).
 * @param {number[]} [opts.darkColor]         RGB 0..1 of the dark bands.
 * @param {number[]} [opts.lightColor]        RGB 0..1 of the light bands.
 * @returns {THREE.ShaderMaterial}  a two-sided striped-reflection material.
 */
export function buildZebraMaterial(opts = {}) {
  const stripeFrequency = clampNum(opts.stripeFrequency ?? 16, 1, 256);
  const direction = opts.direction === 1 ? 1 : 0;
  const sharpness = clampNum(opts.sharpness ?? 0.85, 0, 1);
  const ambient = clampNum(opts.ambient ?? 0.32, 0, 1);
  const dark = opts.darkColor ?? [0.03, 0.03, 0.05];
  const light = opts.lightColor ?? [0.97, 0.97, 1.0];

  // Stripe axis in view space: vertical bands run along the camera-up axis
  // (so the stripes are horizontal), horizontal bands along camera-right.
  const axis = direction === 1
    ? new THREE.Vector3(1, 0, 0)   // vertical stripes
    : new THREE.Vector3(0, 1, 0);  // horizontal stripes

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uFrequency: { value: stripeFrequency },
      uSharpness: { value: sharpness },
      uStripeAxis: { value: axis },
      uDarkColor: { value: new THREE.Color(dark[0], dark[1], dark[2]) },
      uLightColor: { value: new THREE.Color(light[0], light[1], light[2]) },
      uAmbient: { value: ambient },
    },
    vertexShader: STRIPE_VERTEX_SHADER,
    fragmentShader: STRIPE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
  // Tag so callers / e2e can recognise (and later remove) a zebra material.
  material.userData.archdiscZebra = true;
  material.userData.stripeFrequency = stripeFrequency;
  material.userData.direction = direction;
  return material;
}

/**
 * Apply the zebra material to every mesh under a Three.js object (a body
 * group), STASHING each mesh's original material so the overlay can be
 * toggled back off. Re-applying with the group already striped instead
 * RESTORES the originals (toggle behaviour).
 *
 * @param {THREE.Object3D} root  the body group (or any object subtree).
 * @param {object} [opts]        forwarded to buildZebraMaterial.
 * @returns {{ applied: boolean, stripeCount: number, meshes: number }}
 *   applied=true when stripes were turned ON, false when toggled back off.
 */
export function applyZebraToObject(root, opts = {}) {
  if (!root) return { applied: false, stripeCount: 0, meshes: 0 };

  // Already striped? → toggle OFF: restore stashed originals.
  let alreadyStriped = false;
  root.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.__zebraOriginalMaterial) {
      alreadyStriped = true;
    }
  });
  if (alreadyStriped) {
    let restored = 0;
    root.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.__zebraOriginalMaterial) {
        if (o.material && o.material.userData && o.material.userData.archdiscZebra) {
          o.material.dispose();
        }
        o.material = o.userData.__zebraOriginalMaterial;
        delete o.userData.__zebraOriginalMaterial;
        restored++;
      }
    });
    return { applied: false, stripeCount: 0, meshes: restored };
  }

  // Toggle ON: build one material and apply it to every mesh in the subtree.
  const mat = buildZebraMaterial(opts);
  let meshes = 0;
  root.traverse((o) => {
    if (o.isMesh) {
      o.userData.__zebraOriginalMaterial = o.material;
      o.material = mat;
      meshes++;
    }
  });
  return {
    applied: true,
    stripeCount: mat.userData.stripeFrequency,
    meshes,
  };
}

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}
