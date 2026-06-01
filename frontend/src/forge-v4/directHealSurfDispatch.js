// Forge-93 — direct edit / heal / surfacing dispatch wrapper.
//
// Thin shim over window.forge.direct.*, window.forge.heal.*, and
// window.forge.surfacing.*. Each fn:
//   • Guards window.forge availability — returns { ok:false, reason }
//     when the native addon isn't loaded (dev shell / e2e without
//     kernel) so the panel can show a toast instead of throwing.
//   • Wraps every call in try/catch so a bad kernel signature surfaces
//     as a structured result, not an uncaught exception in the
//     renderer.
//   • Normalises every successful return into { ok:true, result }.
//
// Direct edits:
//   pushPullFace(h, faceId, distance)
//   moveFace(h, faceId, translation)
//   rotateFace(h, faceId, axisOrigin, axisDir, angleRad)
//   deleteFaceAndHeal(h, faceIds)
//   replaceFace(h, faceId, spec)
//   inferFeature(h, faceId)
//   faceCount(h)
//
// Healing:
//   sewShape(h, tol)
//   simplifyShape(h, opts)
//   autoFillMissingFaces(h, tol)
//   autoRepairSelfIntersection(h, tol)
//   harmonizeNormals(h)
//   checkValidity(h) → { issues:[] }
//
// Surfacing:
//   buildPatch(grid, uDegree, vDegree, uKnots, vKnots) → faceHandle
//   trim(face, uvFlat)
//   sew(faces, tolerance)
//   refine(face, uTimes, vTimes)
//   eval(face, u, v) → point
//   intersect(faceA, faceB) → curveSegments
//   projectPoint(face, pt) → uvAndPoint
//   classAAnalyse(face, samples) → continuity report
//
// Each entry point is exported so panels (or tests) can call it
// directly. The result object is what panels render in their feedback
// strip — `ok` drives the toast colour.

function ns(name) {
  if (typeof window === 'undefined' || !window.forge) {
    return { ok: false, reason: 'no-window-forge' };
  }
  const grp = window.forge[name];
  if (!grp || typeof grp !== 'object') {
    return { ok: false, reason: `forge.${name}-missing` };
  }
  return { ok: true, grp };
}

function callOp(namespace, op, args) {
  const g = ns(namespace);
  if (!g.ok) return { ok: false, op, namespace, reason: g.reason };
  const fn = g.grp[op];
  if (typeof fn !== 'function') {
    return { ok: false, op, namespace, reason: `op-missing:${op}` };
  }
  try {
    const result = fn.apply(g.grp, args);
    return { ok: true, op, namespace, result };
  } catch (err) {
    return { ok: false, op, namespace,
             reason: 'threw', message: err && err.message ? err.message : String(err) };
  }
}

// ────────────── direct.* ──────────────
export function pushPullFace(handle, faceId, distance) {
  return callOp('direct', 'pushPullFace', [handle, faceId, distance]);
}
export function moveFace(handle, faceId, translation) {
  return callOp('direct', 'moveFace', [handle, faceId, translation]);
}
export function rotateFace(handle, faceId, axisOrigin, axisDir, angleRad) {
  return callOp('direct', 'rotateFace', [handle, faceId, axisOrigin, axisDir, angleRad]);
}
export function deleteFaceAndHeal(handle, faceIds) {
  return callOp('direct', 'deleteFaceAndHeal', [handle, faceIds]);
}
export function replaceFace(handle, faceId, spec) {
  return callOp('direct', 'replaceFace', [handle, faceId, spec]);
}
export function inferFeature(handle, faceId) {
  return callOp('direct', 'inferFeature', [handle, faceId]);
}
export function faceCount(handle) {
  return callOp('direct', 'faceCount', [handle]);
}

// ────────────── heal.* ──────────────
export function sewShape(handle, tolerance) {
  return callOp('heal', 'sewShape', [handle, tolerance]);
}
export function simplifyShape(handle, opts) {
  return callOp('heal', 'simplifyShape', [handle, opts]);
}
export function autoFillMissingFaces(handle, tolerance) {
  return callOp('heal', 'autoFillMissingFaces', [handle, tolerance]);
}
export function autoRepairSelfIntersection(handle, tolerance) {
  return callOp('heal', 'autoRepairSelfIntersection', [handle, tolerance]);
}
export function harmonizeNormals(handle) {
  return callOp('heal', 'harmonizeNormals', [handle]);
}
export function checkValidity(handle) {
  const r = callOp('heal', 'checkValidity', [handle]);
  // Normalise the issues array shape so panels can render without a guard.
  if (r.ok) {
    const issues = (r.result && Array.isArray(r.result.issues)) ? r.result.issues : [];
    return { ok: true, op: 'checkValidity', namespace: 'heal',
             result: { issues } };
  }
  return r;
}

// ────────────── surfacing.* ──────────────
export function buildPatch(grid, uDegree, vDegree, uKnots, vKnots) {
  return callOp('surfacing', 'buildPatch', [grid, uDegree, vDegree, uKnots, vKnots]);
}
export function trim(face, uvFlat) {
  return callOp('surfacing', 'trim', [face, uvFlat]);
}
export function sewFaces(faces, tolerance) {
  return callOp('surfacing', 'sew', [faces, tolerance]);
}
export function refine(face, uTimes, vTimes) {
  return callOp('surfacing', 'refine', [face, uTimes, vTimes]);
}
export function evalSurface(face, u, v) {
  return callOp('surfacing', 'eval', [face, u, v]);
}
export function intersect(faceA, faceB) {
  return callOp('surfacing', 'intersect', [faceA, faceB]);
}
export function projectPoint(face, pt) {
  return callOp('surfacing', 'projectPoint', [face, pt]);
}
export function classAAnalyse(face, samples) {
  return callOp('surfacing', 'classAAnalyse', [face, samples]);
}

// Convenience guard the panels share. When this returns false, the
// caller should showToast({ kind:'warn', text:'window.forge not loaded' })
// instead of calling the op (which would just return a structured
// error anyway).
export function isForgeReady() {
  if (typeof window === 'undefined' || !window.forge) return false;
  if (typeof window.forge.isReady === 'function') {
    try { return !!window.forge.isReady(); } catch { return false; }
  }
  // Looser fallback — the three namespaces have to be present.
  return !!(window.forge.direct && window.forge.heal && window.forge.surfacing);
}

// Single dispatch table used by the panels' button rows and by tests.
// Each entry: { id, label, group, fn, signature, defaults }. The
// signature is a description for the dialog form (id, label, kind,
// default) — panels render the dialog from this. Tests reuse the
// table to introspect button rows without importing a JSX module.
export const DIRECT_OPS = [
  { id: 'pushPullFace', label: 'Push / Pull Face', fn: pushPullFace,
    signature: [
      { id: 'handle',   label: 'Body handle', kind: 'int',    default: 0 },
      { id: 'faceId',   label: 'Face ID',     kind: 'int',    default: 0 },
      { id: 'distance', label: 'Distance',    kind: 'number', default: 5, unit: 'mm' },
    ] },
  { id: 'moveFace', label: 'Move Face', fn: moveFace,
    signature: [
      { id: 'handle',      label: 'Body handle', kind: 'int',  default: 0 },
      { id: 'faceId',      label: 'Face ID',     kind: 'int',  default: 0 },
      { id: 'translation', label: 'Translation', kind: 'vec3', default: [0, 0, 5] },
    ] },
  { id: 'rotateFace', label: 'Rotate Face', fn: rotateFace,
    signature: [
      { id: 'handle',     label: 'Body handle', kind: 'int',    default: 0 },
      { id: 'faceId',     label: 'Face ID',     kind: 'int',    default: 0 },
      { id: 'axisOrigin', label: 'Axis origin', kind: 'vec3',   default: [0, 0, 0] },
      { id: 'axisDir',    label: 'Axis dir',    kind: 'vec3',   default: [0, 0, 1] },
      { id: 'angleRad',   label: 'Angle',       kind: 'number', default: Math.PI / 4, unit: 'rad' },
    ] },
  { id: 'deleteFaceAndHeal', label: 'Delete Face + Heal', fn: deleteFaceAndHeal,
    signature: [
      { id: 'handle',  label: 'Body handle',           kind: 'int',     default: 0 },
      { id: 'faceIds', label: 'Face IDs (comma)',      kind: 'intList', default: [0] },
    ] },
  { id: 'replaceFace', label: 'Replace Face', fn: replaceFace,
    signature: [
      { id: 'handle', label: 'Body handle',     kind: 'int',  default: 0 },
      { id: 'faceId', label: 'Face ID',         kind: 'int',  default: 0 },
      { id: 'spec',   label: 'Spec (JSON)',     kind: 'json', default: { kind: 'plane' } },
    ] },
  { id: 'inferFeature', label: 'Infer Feature', fn: inferFeature,
    signature: [
      { id: 'handle', label: 'Body handle', kind: 'int', default: 0 },
      { id: 'faceId', label: 'Face ID',     kind: 'int', default: 0 },
    ] },
  { id: 'faceCount', label: 'Face Count', fn: faceCount,
    signature: [
      { id: 'handle', label: 'Body handle', kind: 'int', default: 0 },
    ] },
];

export const HEAL_OPS = [
  { id: 'sewShape', label: 'Sew Shape', fn: sewShape,
    signature: [
      { id: 'handle',    label: 'Body handle', kind: 'int',    default: 0 },
      { id: 'tolerance', label: 'Tolerance',   kind: 'slider', default: 0.01, min: 0.0001, max: 1, step: 0.001, unit: 'mm' },
    ] },
  { id: 'simplifyShape', label: 'Simplify Shape', fn: simplifyShape,
    signature: [
      { id: 'handle', label: 'Body handle', kind: 'int',  default: 0 },
      { id: 'opts',   label: 'Options (JSON)', kind: 'json',
        default: { mergeFaces: true, mergeEdges: true, angularTol: 0.001 } },
    ] },
  { id: 'autoFillMissingFaces', label: 'Auto-Fill Missing Faces', fn: autoFillMissingFaces,
    signature: [
      { id: 'handle',    label: 'Body handle', kind: 'int',    default: 0 },
      { id: 'tolerance', label: 'Tolerance',   kind: 'slider', default: 0.05, min: 0.0001, max: 1, step: 0.001, unit: 'mm' },
    ] },
  { id: 'autoRepairSelfIntersection', label: 'Auto-Repair Self-Intersection',
    fn: autoRepairSelfIntersection,
    signature: [
      { id: 'handle',    label: 'Body handle', kind: 'int',    default: 0 },
      { id: 'tolerance', label: 'Tolerance',   kind: 'slider', default: 0.02, min: 0.0001, max: 1, step: 0.001, unit: 'mm' },
    ] },
  { id: 'harmonizeNormals', label: 'Harmonize Normals', fn: harmonizeNormals,
    signature: [
      { id: 'handle', label: 'Body handle', kind: 'int', default: 0 },
    ] },
  { id: 'checkValidity', label: 'Check Validity', fn: checkValidity,
    signature: [
      { id: 'handle', label: 'Body handle', kind: 'int', default: 0 },
    ] },
];

export const SURFACING_OPS = [
  { id: 'buildPatch', label: 'Build NURBS Patch', fn: buildPatch,
    signature: [
      { id: 'grid',    label: 'Control grid (JSON)', kind: 'json',
        default: [
          [[0,0,0], [5,0,0], [10,0,0]],
          [[0,5,2], [5,5,4], [10,5,2]],
          [[0,10,0],[5,10,0],[10,10,0]],
        ] },
      { id: 'uDegree', label: 'U degree', kind: 'int',  default: 2 },
      { id: 'vDegree', label: 'V degree', kind: 'int',  default: 2 },
      { id: 'uKnots',  label: 'U knots (JSON)', kind: 'json', default: [0,0,0,1,1,1] },
      { id: 'vKnots',  label: 'V knots (JSON)', kind: 'json', default: [0,0,0,1,1,1] },
    ] },
  { id: 'trim', label: 'Trim Face', fn: trim,
    signature: [
      { id: 'face',   label: 'Face handle',  kind: 'int',  default: 0 },
      { id: 'uvFlat', label: 'UV loop (JSON)', kind: 'json',
        default: [0,0, 1,0, 1,1, 0,1, 0,0] },
    ] },
  { id: 'sew', label: 'Sew Faces', fn: sewFaces,
    signature: [
      { id: 'faces',     label: 'Face handles (JSON)', kind: 'json',  default: [0, 1] },
      { id: 'tolerance', label: 'Tolerance', kind: 'slider', default: 0.01, min: 0.0001, max: 1, step: 0.001, unit: 'mm' },
    ] },
  { id: 'refine', label: 'Refine Face', fn: refine,
    signature: [
      { id: 'face',   label: 'Face handle', kind: 'int', default: 0 },
      { id: 'uTimes', label: 'U refines',   kind: 'int', default: 1 },
      { id: 'vTimes', label: 'V refines',   kind: 'int', default: 1 },
    ] },
  { id: 'eval', label: 'Evaluate (u,v)', fn: evalSurface,
    signature: [
      { id: 'face', label: 'Face handle', kind: 'int',    default: 0 },
      { id: 'u',    label: 'u',           kind: 'slider', default: 0.5, min: 0, max: 1, step: 0.01 },
      { id: 'v',    label: 'v',           kind: 'slider', default: 0.5, min: 0, max: 1, step: 0.01 },
    ] },
  { id: 'intersect', label: 'Intersect Faces', fn: intersect,
    signature: [
      { id: 'faceA', label: 'Face A handle', kind: 'int', default: 0 },
      { id: 'faceB', label: 'Face B handle', kind: 'int', default: 1 },
    ] },
  { id: 'projectPoint', label: 'Project Point', fn: projectPoint,
    signature: [
      { id: 'face', label: 'Face handle', kind: 'int',  default: 0 },
      { id: 'pt',   label: 'Point',       kind: 'vec3', default: [0, 0, 0] },
    ] },
  { id: 'classAAnalyse', label: 'Class-A Analyse', fn: classAAnalyse,
    signature: [
      { id: 'face',    label: 'Face handle', kind: 'int', default: 0 },
      { id: 'samples', label: 'Samples',     kind: 'int', default: 32 },
    ] },
];

// Lightweight event channel the panels use to render themselves. Used
// in lieu of touching ForgeShellV4.jsx — the App-level host mounts
// each panel and subscribes; menu items / shortcuts / tests
// dispatch a CustomEvent to open one.
export const PANEL_EVENT = 'forge:open-direct-heal-surf-panel';

export function openPanel(which) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { which } }));
}
