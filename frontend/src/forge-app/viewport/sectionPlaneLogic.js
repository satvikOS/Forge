/**
 * sectionPlaneLogic — pure math for the cutting-plane tool.
 *
 * The cutting plane is stored in AppState as
 *   { enabled, normal:[x,y,z], offset:number }
 * where the plane equation is `n · p = offset` (n unit-length).
 * Three.js clipping planes use the form `n · p + constant = 0`, so the
 * renderer maps `constant = -offset`.
 *
 * `slidePlane(state, deltaAlongNormal)` advances the offset along the
 * normal — the UI's 2D drag handle calls this with the world-space
 * projection of the drag vector onto the plane's normal.
 *
 * `worldToPlaneOffset(point, state)` converts a world-space point into
 * the corresponding offset so the user can drop the plane on a picked
 * face.
 */

export const DEFAULT_SECTION_NORMAL = Object.freeze([1, 0, 0]);

export function makeSectionState({ enabled = false, normal = DEFAULT_SECTION_NORMAL,
                                    offset = 0 } = {}) {
  const n = normalise(normal);
  return { enabled, normal: n, offset };
}

function normalise(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (m < 1e-12) return [1, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

export function slidePlane(state, delta) {
  return { ...state, offset: state.offset + delta };
}

export function worldToPlaneOffset(point, state) {
  return point[0] * state.normal[0] +
         point[1] * state.normal[1] +
         point[2] * state.normal[2];
}

/**
 * Returns the three.js `clippingPlanes` value for the renderer:
 * a single `Plane`-like object `{ normal:[x,y,z], constant:number }`
 * when enabled, null otherwise. The real `THREE.Plane` constructor is
 * fed this in the React layer.
 */
export function clippingDescriptor(state) {
  if (!state || !state.enabled) return null;
  return {
    normal:   [...state.normal],
    constant: -state.offset,
  };
}

/**
 * Reorient the plane to a new normal while keeping it touching the
 * same world-space point (used when the user picks a face to align
 * the section to).
 */
export function reorientPlane(state, newNormal, anchorPoint) {
  const n = normalise(newNormal);
  const offset = anchorPoint
    ? anchorPoint[0] * n[0] + anchorPoint[1] * n[1] + anchorPoint[2] * n[2]
    : state.offset;
  return { ...state, normal: n, offset };
}
