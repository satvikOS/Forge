// forgeFlagshipRender.js — PHOTOREAL + CAE-IN-MOTION RUNTIME for flagship parts
// ============================================================================
// Page-side helpers the flagship capture specs (demo-flagship-*.spec.js) import
// at runtime to make the LIVE Forge viewport render a built engine PHOTOREALLY
// and to drive the CAE-in-motion overlays. Everything here operates on the
// window surfaces the viewport already publishes:
//   • window.__forgeScene / __forgeRenderer / __forgeThree  (RendererPublisher)
//   • window.__forgeBodyPBR     Map<handle, preset>  (read by SceneMeshes)
//   • window.__forgeBodyColors  Map<handle, '#rgb'>  (read by colorForBody)
//   • window.__forgeAnimationPose Map<handle, {pos,quat}> (AnimationPoseTicker)
//
// NO new deps, NO bundled binary asset, NO network — the HDRI is the procedural
// equirect from forgeFlagshipMaterials.makeEnvironmentTexture, so the render
// harness is deterministic and offline (feedback-forge-native-no-deps).
//
// The functions are also published on window.__forgeFlagship so a manual e2e or
// the render runner can call them without an import.
// ============================================================================

import {
  MATERIAL_LIBRARY, materialForComponent, tagBodiesWithMaterials,
  materialAssignmentSummary, makeEnvironmentTexture,
} from './forgeFlagshipMaterials.js';

// ── colour helper: lift an sRGB hex by a factor (for selection / heat highlights) ──
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  1. ASSIGN ENGINEER-CORRECT MATERIALS BY COMPONENT TAG
//  Populates window.__forgeBodyPBR (full metal/rough preset) and
//  window.__forgeBodyColors (base albedo) for every body, keyed by kernel
//  handle. SceneMeshes then renders each body with its real reflectance.
// ───────────────────────────────────────────────────────────────────────────
export function applyFlagshipMaterials(bodies = []) {
  if (typeof window === 'undefined') return { count: 0 };
  const tagged = tagBodiesWithMaterials(bodies);
  if (!(window.__forgeBodyPBR instanceof Map)) window.__forgeBodyPBR = new Map();
  if (!(window.__forgeBodyColors instanceof Map)) window.__forgeBodyColors = new Map();
  // Keep a separate record of the photoreal base colour so the CAE stress
  // overlay can RESTORE it after a heat-map pass.
  window.__forgeFlagshipBaseColors = window.__forgeFlagshipBaseColors || new Map();
  for (const b of tagged) {
    if (typeof b.handle !== 'number') continue;
    const preset = MATERIAL_LIBRARY[b.material] || b.materialPreset;
    if (preset) {
      window.__forgeBodyPBR.set(b.handle, preset);
      window.__forgeBodyColors.set(b.handle, preset.color);
      window.__forgeFlagshipBaseColors.set(b.handle, preset.color);
    }
  }
  // Nudge the renderer to repaint (colorForBody / SceneMeshes pick up on render).
  try { window.dispatchEvent(new CustomEvent('forge:body-colors-changed')); } catch {}
  const summary = materialAssignmentSummary(tagged);
  return { count: tagged.length, byMaterial: summary.byMaterial, counts: summary.counts };
}

// ───────────────────────────────────────────────────────────────────────────
//  2. MOUNT THE HDRI STUDIO/HANGAR ENVIRONMENT + ACES TONE MAPPING
//  Sets scene.environment (drives every metallic reflection) and the renderer's
//  ACES tone mapping + exposure — the single biggest lever turning flat clay
//  into photoreal metal. Optionally also paints the background.
// ───────────────────────────────────────────────────────────────────────────
export function mountStudioEnvironment(opts = {}) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const THREE = window.__forgeThree;
  const scene = window.__forgeScene;
  const gl = window.__forgeRenderer;
  if (!THREE || !scene || !gl) {
    return { ok: false, error: 'viewport scene/renderer/three not published yet' };
  }
  const name = opts.environment || 'studio';
  const size = opts.size || 512;
  const tex = makeEnvironmentTexture(THREE, name, size);
  scene.environment = tex;
  if (opts.background) scene.background = tex;
  // ACES filmic + exposure: bridge the HDRI's >1 values into display range.
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = typeof opts.exposure === 'number' ? opts.exposure : 1.05;
  if ('outputColorSpace' in gl) gl.outputColorSpace = THREE.SRGBColorSpace;
  else if ('outputEncoding' in gl) gl.outputEncoding = THREE.sRGBEncoding;
  // Stash so a later call can dispose / restore.
  window.__forgeFlagshipEnv = { name, tex };
  return { ok: true, environment: name, exposure: gl.toneMappingExposure };
}

/** Full photoreal setup in one call: env + ACES + per-body materials. */
export function setupPhotoreal(bodies = [], opts = {}) {
  const env = mountStudioEnvironment(opts);
  const mats = applyFlagshipMaterials(bodies);
  return { env, materials: mats };
}

// ───────────────────────────────────────────────────────────────────────────
//  2b. RENDER THE FULL ASSEMBLY — one THREE.InstancedMesh per unique prototype
//  body, placed at every one of its world transforms (the ~20k instances).
//
//  The flagship builders model a few dozen UNIQUE B-rep prototypes (one blade,
//  one bolt, one cooling-hole, …) and reach the full component count by
//  INSTANCING each prototype around its ring / bolt-circle. The React
//  SceneMeshes path only renders the unique prototypes (all stacked at the
//  origin), so the viewport showed ~30 overlapping bodies instead of the
//  assembled engine. This helper reads the per-body transform list returned by
//  the builder (result.assemblyInstances) and renders the REAL placed engine.
//
//  Each transform is a row-major 4×4 (the assembly.add-instance transform). We
//  tessellate the unique body once through window.forge.tessellate, build a
//  THREE.InstancedMesh sized to that body's instance count, and set each
//  instance matrix from the transform. The body's photoreal PBR preset
//  (window.__forgeBodyPBR, populated by setupPhotoreal) drives material so the
//  instanced engine reads as machined aerospace hardware, not flat clay.
//
//  All instanced meshes go under one group tagged userData.forgeAssembly so a
//  later call can clear them, and each carries userData.body.handle +
//  userData.engineAxis so setRotorSpin can spin whole rotating rings about the
//  engine axis (an InstancedMesh can't pose its members individually, but a
//  polar blade ring IS rigid about +X, so a group rotation is exactly right).
// ───────────────────────────────────────────────────────────────────────────
function rowMajorToMatrix4(THREE, t) {
  const m = new THREE.Matrix4();
  // THREE.Matrix4.set takes row-major args; our transforms are row-major 4×4.
  m.set(
    t[0],  t[1],  t[2],  t[3],
    t[4],  t[5],  t[6],  t[7],
    t[8],  t[9],  t[10], t[11],
    t[12], t[13], t[14], t[15],
  );
  return m;
}

export function renderAssemblyInstances(instances = [], opts = {}) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const THREE = window.__forgeThree;
  const scene = window.__forgeScene;
  const forge = window.forge;
  if (!THREE || !scene) return { ok: false, error: 'viewport scene/three not published yet' };
  if (!forge || !forge.tessellate) return { ok: false, error: 'kernel tessellate unavailable' };

  clearAssemblyInstances();
  const group = new THREE.Group();
  group.userData.forgeAssembly = 'instances';

  const pbrMap = (window.__forgeBodyPBR instanceof Map) ? window.__forgeBodyPBR : null;
  const colorMap = (window.__forgeBodyColors instanceof Map) ? window.__forgeBodyColors : null;
  const linDefl = typeof opts.tessLinear === 'number' ? opts.tessLinear : 1.2;
  const angDefl = typeof opts.tessAngular === 'number' ? opts.tessAngular : 0.8;

  let totalInstances = 0, builtBodies = 0, skipped = 0;
  const worldBox = new THREE.Box3();
  const mat4 = new THREE.Matrix4();

  for (const inst of instances) {
    const handle = inst.handle;
    const xforms = inst.transforms || [];
    if (typeof handle !== 'number' || xforms.length === 0) { skipped++; continue; }
    let mesh;
    try { mesh = forge.tessellate(handle, linDefl, angDefl); }
    catch (e) { skipped++; continue; }
    const pos = toF32(mesh.positions);
    if (!pos || pos.length === 0) { skipped++; continue; }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const nrm = toF32(mesh.normals);
    if (nrm) geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const idx = toU32(mesh.indices);
    if (idx) geom.setIndex(new THREE.BufferAttribute(idx, 1));
    if (!nrm) geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    // Material from the body's photoreal preset (falls back to neutral metal).
    const preset = pbrMap?.get(handle) || null;
    const baseColor = (colorMap?.get(handle)) || preset?.color || '#c4ccd6';
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(baseColor),
      metalness: preset?.metalness ?? 0.9,
      roughness: preset?.roughness ?? 0.45,
      envMapIntensity: (preset?.envMapIntensity ?? 1.0) * 1.35,
      clearcoat: preset?.clearcoat ?? 0,
      clearcoatRoughness: preset?.clearcoatRoughness ?? 0,
      sheen: preset?.sheen ?? 0,
    });

    const im = new THREE.InstancedMesh(geom, material, xforms.length);
    im.userData.body = { handle, name: inst.name, role: inst.role };
    im.userData.forgeAssemblyBody = true;
    im.userData.rotating = isRotatingName(inst.name);
    for (let i = 0; i < xforms.length; i++) {
      const m4 = rowMajorToMatrix4(THREE, xforms[i]);
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;          // 20k engine: keep it always-drawn
    // Expand the world box by every instance (so __forgeFitToBounds frames it).
    if (geom.boundingBox) {
      for (let i = 0; i < xforms.length; i++) {
        im.getMatrixAt(i, mat4);
        const b = geom.boundingBox.clone().applyMatrix4(mat4);
        worldBox.union(b);
      }
    }
    group.add(im);
    totalInstances += xforms.length;
    builtBodies++;
  }

  scene.add(group);
  window.__forgeAssemblyGroup = group;
  if (!worldBox.isEmpty()) window.__forgeAssemblyBox = worldBox;

  // Drive a fit so the engine fills the frame, if the helper is mounted.
  try {
    if (!worldBox.isEmpty() && typeof window.__forgeFitToBounds === 'function') {
      window.__forgeFitToBounds(worldBox, { dir: opts.dir || [1.4, 0.6, 1.0], margin: opts.margin ?? 1.8 });
    }
  } catch { /* fit is best-effort */ }

  return { ok: builtBodies > 0, builtBodies, totalInstances, skipped,
           box: worldBox.isEmpty() ? null
             : { min: worldBox.min.toArray(), max: worldBox.max.toArray() } };
}

/** Remove the rendered assembly InstancedMesh group from the scene. */
export function clearAssemblyInstances() {
  if (typeof window === 'undefined') return;
  const scene = window.__forgeScene;
  const g = window.__forgeAssemblyGroup;
  if (scene && g) {
    try {
      scene.remove(g);
      g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    } catch {}
  }
  window.__forgeAssemblyGroup = null;
  window.__forgeAssemblyBox = null;
}

/** True for body names that rotate about the engine axis (blades/disks/shaft). */
function isRotatingName(name = '') {
  return /blade|disk|disc|rotor|spinner|hub|impeller|inducer|shaft|ball/i.test(String(name))
    && !/casing|nacelle|containment|housing|stator|nozzle|vane|liner|panel|seal|bypass|duct/i.test(String(name));
}

// True for the OUTER skin bodies that, when opaque, hide the engine internals
// and make the whole thing read as a smooth cylinder ("soda can"): the nacelle,
// the bypass duct, the core casing, and the fan containment case. These are the
// bodies we hide / make transparent for the CUTAWAY hero so the fan face,
// compressor/turbine stages, combustor and shafts become visible.
function isOuterSkinName(name = '') {
  return /nacelle|cowl|bypass[_-]?duct|core[_-]?casing|containment|fan[_-]?containment|outer[_-]?casing/i
    .test(String(name));
}

// ───────────────────────────────────────────────────────────────────────────
//  2c. CUTAWAY / COWL-REVEAL — hide (or set transparent) the outer skin bodies
//  on the rendered assembly InstancedMeshes so the FAN FACE (swept fan blades +
//  spinner), the LPC/HPC compressor stages, the combustor, and the HPT/LPT
//  turbine stages are VISIBLE — the iconic bladed turbofan internals, NOT a
//  smooth can. Operates on the live __forgeAssemblyGroup; reversible.
// ───────────────────────────────────────────────────────────────────────────
export function revealEngineCutaway(opts = {}) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const group = window.__forgeAssemblyGroup;
  if (!group) return { ok: false, error: 'no assembly group mounted' };
  const mode = opts.mode || 'hide';              // 'hide' | 'transparent'
  const opacity = typeof opts.opacity === 'number' ? opts.opacity : 0.12;
  let affected = 0, kept = 0;
  group.traverse((o) => {
    const nm = o?.userData?.body?.name;
    if (!nm || !o.isInstancedMesh) return;
    if (isOuterSkinName(nm)) {
      if (mode === 'transparent') {
        o.visible = true;
        if (o.material) {
          o.material.transparent = true;
          o.material.opacity = opacity;
          o.material.depthWrite = false;
          o.material.needsUpdate = true;
        }
      } else {
        o.visible = false;
      }
      affected++;
    } else {
      kept++;
    }
  });
  window.__forgeCutawayActive = true;
  return { ok: affected > 0, hidden: affected, visible: kept, mode };
}

/** Undo revealEngineCutaway — restore the outer skin to opaque + visible. */
export function restoreEngineSkin() {
  if (typeof window === 'undefined') return;
  const group = window.__forgeAssemblyGroup;
  if (!group) return;
  group.traverse((o) => {
    const nm = o?.userData?.body?.name;
    if (!nm || !o.isInstancedMesh || !isOuterSkinName(nm)) return;
    o.visible = true;
    if (o.material) {
      o.material.transparent = false;
      o.material.opacity = 1;
      o.material.depthWrite = true;
      o.material.needsUpdate = true;
    }
  });
  window.__forgeCutawayActive = false;
}

// Gather the kernel handles of the ROTATING InstancedMesh bodies actually in the
// rendered assembly group (blades / disks / rotor / spinner / shafts), so the
// caller can hand them straight to setRotorSpin. Reading the live group is more
// reliable than re-deriving from the builder's body list.
export function gatherRotorHandles() {
  if (typeof window === 'undefined') return [];
  const group = window.__forgeAssemblyGroup;
  if (!group) return [];
  const handles = [];
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const nm = o?.userData?.body?.name;
    const h = o?.userData?.body?.handle;
    if (typeof h === 'number' && nm && isRotatingName(nm)) handles.push(h);
  });
  return handles;
}

// Re-marshal kernel arrays (contextBridge may clone typed arrays lossily — same
// concern as Viewport.toTypedArray) into plain TypedArrays for BufferAttribute.
function toF32(a) {
  if (a == null) return null;
  if (a instanceof Float32Array) return a;
  if (ArrayBuffer.isView(a)) return new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  if (a instanceof ArrayBuffer) return new Float32Array(a);
  if (Array.isArray(a) || typeof a.length === 'number') return Float32Array.from(a);
  if (typeof a === 'object') {
    const keys = Object.keys(a);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return Float32Array.from({ length: keys.length }, (_, i) => a[i]);
    }
  }
  return null;
}
function toU32(a) {
  if (a == null) return null;
  if (a instanceof Uint32Array) return a;
  if (ArrayBuffer.isView(a)) return new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  if (a instanceof ArrayBuffer) return new Uint32Array(a);
  if (Array.isArray(a) || typeof a.length === 'number') return Uint32Array.from(a);
  if (typeof a === 'object') {
    const keys = Object.keys(a);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      return Uint32Array.from({ length: keys.length }, (_, i) => a[i]);
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
//  3. CAE-IN-MOTION OVERLAYS
// ───────────────────────────────────────────────────────────────────────────

// 3a. FEA STRESS COLORMAP — tint bodies by a normalised stress value using a
//     turbo/jet-style colormap (blue → cyan → green → yellow → red). Writes
//     into __forgeBodyColors so the real body paints; restore() puts the
//     photoreal albedo back.
const TURBO_STOPS = [
  [0.00, [48, 18, 59]],   // deep indigo
  [0.25, [33, 144, 255]], // blue
  [0.50, [38, 224, 142]], // green
  [0.70, [241, 229, 60]], // yellow
  [0.85, [255, 132, 40]], // orange
  [1.00, [220, 36, 32]],  // red
];
export function stressColor(t01) {
  const t = Math.max(0, Math.min(1, t01));
  for (let i = 1; i < TURBO_STOPS.length; i++) {
    if (t <= TURBO_STOPS[i][0]) {
      const [t0, c0] = TURBO_STOPS[i - 1], [t1, c1] = TURBO_STOPS[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return rgbToHex(c0[0] + (c1[0] - c0[0]) * f,
                      c0[1] + (c1[1] - c0[1]) * f,
                      c0[2] + (c1[2] - c0[2]) * f);
    }
  }
  return rgbToHex(...TURBO_STOPS[TURBO_STOPS.length - 1][1]);
}

/**
 * Paint a set of body handles with a stress colormap.
 * @param {Array<{handle:number, value:number}>} samples  per-body stress value
 * @param {object} [opts]  { min, max } range (auto from samples if absent)
 */
export function applyStressColormap(samples = [], opts = {}) {
  if (typeof window === 'undefined') return { painted: 0 };
  if (!(window.__forgeBodyColors instanceof Map)) window.__forgeBodyColors = new Map();
  const vals = samples.map((s) => s.value).filter((v) => Number.isFinite(v));
  const min = opts.min ?? Math.min(...vals, 0);
  const max = opts.max ?? Math.max(...vals, 1);
  const span = (max - min) || 1;
  let painted = 0;
  const heat = new Map();
  for (const s of samples) {
    if (typeof s.handle !== 'number') continue;
    const c = stressColor((s.value - min) / span);
    window.__forgeBodyColors.set(s.handle, c);
    heat.set(s.handle, c);
    painted++;
  }
  // Also repaint any assembly InstancedMesh whose handle matches (its material
  // colour was baked at render time and is NOT React-driven, so a colormap pass
  // would otherwise leave the instanced engine unchanged).
  paintAssemblyInstanceColors(heat);
  try { window.dispatchEvent(new CustomEvent('forge:body-colors-changed')); } catch {}
  return { painted, min, max };
}

/** Restore the photoreal base albedo after a colormap pass. */
export function restorePhotorealColors() {
  if (typeof window === 'undefined') return;
  const base = window.__forgeFlagshipBaseColors;
  if (!(base instanceof Map) || !(window.__forgeBodyColors instanceof Map)) return;
  for (const [h, c] of base.entries()) window.__forgeBodyColors.set(h, c);
  // Restore the instanced engine's per-body material colours too.
  paintAssemblyInstanceColors(base);
  try { window.dispatchEvent(new CustomEvent('forge:body-colors-changed')); } catch {}
}

// Recolour the live assembly InstancedMeshes (rendered by
// renderAssemblyInstances) by body handle. A no-op when no assembly group is
// mounted (e.g. the gearbox, which renders through the React SceneMeshes path).
function paintAssemblyInstanceColors(colorByHandle) {
  if (typeof window === 'undefined') return;
  const THREE = window.__forgeThree;
  const group = window.__forgeAssemblyGroup;
  if (!THREE || !group || !(colorByHandle instanceof Map)) return;
  group.traverse((o) => {
    const h = o?.userData?.body?.handle;
    if (typeof h !== 'number') return;
    const c = colorByHandle.get(h);
    if (c && o.material && o.material.color) {
      o.material.color.set(c);
      o.material.needsUpdate = true;
    }
  });
}

// 3b. ROTOR SPIN — drive window.__forgeAnimationPose (read by AnimationPoseTicker
//     in Viewport.jsx) so the rotating bodies spin about the engine axis at a
//     given angle. Static bodies (casings/housings) are left untouched.
//     axis: 'x' (GE9X / turbopump engine axis) or 'z' (gearbox stack).
export function setRotorSpin(rotatingHandles = [], angleRad = 0, axis = 'x') {
  if (typeof window === 'undefined') return;
  const THREE = window.__forgeThree;
  if (!(window.__forgeAnimationPose instanceof Map)) window.__forgeAnimationPose = new Map();
  const pose = window.__forgeAnimationPose;
  const ax = axis === 'z' ? [0, 0, 1] : axis === 'y' ? [0, 1, 0] : [1, 0, 0];
  for (const h of rotatingHandles) {
    if (typeof h !== 'number') continue;
    let quat = null;
    if (THREE) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax), angleRad);
      quat = [q.x, q.y, q.z, q.w];
    }
    // AnimationPoseTicker applies pos (and quat if the ticker supports it).
    pose.set(h, { pos: [0, 0, 0], quat, angle: angleRad, axis: ax });
  }
  return { spun: rotatingHandles.length, angleRad, axis };
}

/** Clear any rotor-spin pose (return to the assembled at-rest orientation). */
export function clearRotorSpin() {
  if (typeof window === 'undefined') return;
  window.__forgeAnimationPose = new Map();
}

// 3c. CFD STREAMLINES — add a set of polyline streamlines as THREE.Line objects
//     into the live scene (tagged userData.forgeCae so they're easy to clear).
//     Points are world-space [[x,y,z],…] arrays; colour by speed if provided.
export function addCfdStreamlines(lines = [], opts = {}) {
  if (typeof window === 'undefined') return { added: 0 };
  const THREE = window.__forgeThree;
  const scene = window.__forgeScene;
  if (!THREE || !scene) return { added: 0, error: 'scene not ready' };
  clearCfdStreamlines();
  const group = new THREE.Group();
  group.userData.forgeCae = 'cfd-streamlines';
  for (const ln of lines) {
    const pts = (ln.points || ln).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if (pts.length < 2) continue;
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const speed01 = Number.isFinite(ln.speed01) ? ln.speed01 : 0.6;
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(stressColor(speed01)) });
    group.add(new THREE.Line(geom, mat));
  }
  scene.add(group);
  window.__forgeCaeStreamlines = group;
  return { added: group.children.length };
}

export function clearCfdStreamlines() {
  if (typeof window === 'undefined') return;
  const scene = window.__forgeScene;
  const g = window.__forgeCaeStreamlines;
  if (scene && g) { try { scene.remove(g); } catch {} }
  window.__forgeCaeStreamlines = null;
}

/**
 * Generate helical core-flow streamlines for a turbomachine envelope — a quick,
 * deterministic visualization of swirl through the flow path (front→aft along
 * `axisLen`, swirling at `radius`). Real CFD peak-velocity (from simulate.cfd)
 * can scale `speed01` so colour tracks the solver.
 */
export function helicalStreamlines({ axisLen = 5000, radius = 800, count = 24,
                                     turns = 1.5, axis = 'x', speed01 = 0.7,
                                     steps = 60, x0 = 0 } = {}) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const phase = (2 * Math.PI * i) / count;
    const r = radius * (0.4 + 0.6 * (i % 4) / 3);  // a few radial shells
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const ang = phase + turns * 2 * Math.PI * f;
      const along = x0 + axisLen * f;
      const a = r * Math.cos(ang), b = r * Math.sin(ang);
      if (axis === 'z') pts.push([a, b, along]);
      else if (axis === 'y') pts.push([a, along, b]);
      else pts.push([along, a, b]);
    }
    lines.push({ points: pts, speed01 });
  }
  return lines;
}

// ── publish on window for import-free use by manual e2e / the render runner ──
if (typeof window !== 'undefined') {
  window.__forgeFlagship = {
    applyFlagshipMaterials, mountStudioEnvironment, setupPhotoreal,
    renderAssemblyInstances, clearAssemblyInstances,
    revealEngineCutaway, restoreEngineSkin, gatherRotorHandles,
    applyStressColormap, restorePhotorealColors, stressColor,
    setRotorSpin, clearRotorSpin,
    addCfdStreamlines, clearCfdStreamlines, helicalStreamlines,
  };
}

export default {
  applyFlagshipMaterials, mountStudioEnvironment, setupPhotoreal,
  renderAssemblyInstances, clearAssemblyInstances,
  revealEngineCutaway, restoreEngineSkin, gatherRotorHandles,
  applyStressColormap, restorePhotorealColors, stressColor,
  setRotorSpin, clearRotorSpin,
  addCfdStreamlines, clearCfdStreamlines, helicalStreamlines,
};
