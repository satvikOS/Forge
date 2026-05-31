/**
 * SelectionEdges — feature-edge wireframe overlay on selected bodies.
 *
 * When a body is selected, a `THREE.LineSegments` mesh built from
 * `THREE.EdgesGeometry` (threshold 30°) is added as a child of the
 * body's group. The overlay traces every feature edge in white at
 * partial opacity, so silhouette lines stay readable even after the
 * WF-18 emissive paint, the WF-21 hover paint, and the WF-24
 * material-colour paint all stack on the surface.
 *
 * Generated lazily on first selection per body, cached as
 * `group.userData.__archdiscEdgesLine`. Removed (and its geometry
 * disposed) on deselection.
 *
 * Plays cleanly with all the other selection-/hover-driven systems:
 *   - SelectionHighlight     emissive paint  (this module)  edges paint
 *   - QuickMeasureOverlay     centroid HUD    independent
 *   - SectionPlane            clipping plane  edges respect clipping
 *     because LineSegments inherit material.clippingPlanes via
 *     the renderer's global clipping list.
 */

import * as THREE from 'three';

const EDGE_COLOR = 0xffffff;
const EDGE_OPACITY = 0.65;
const EDGE_THRESHOLD_DEG = 30;

let _attached = false;
let _unsub = null;

function ensureEdgesOverlay(body) {
  if (!body?.group) return;
  if (body.group.userData.__archdiscEdgesLine) return;
  const segments = [];
  body.group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const edges = new THREE.EdgesGeometry(obj.geometry, EDGE_THRESHOLD_DEG);
    const mat = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: EDGE_OPACITY,
      depthTest: true,
      // Slight polygon-offset hack: push lines toward the camera so
      // they stay visible against the surface without z-fighting.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const line = new THREE.LineSegments(edges, mat);
    line.renderOrder = 10;
    // Mount as a child of the mesh so the line inherits matrixWorld
    // exactly (no need to compose group + mesh transforms ourselves).
    obj.add(line);
    segments.push(line);
  });
  body.group.userData.__archdiscEdgesLine = segments;
}

function removeEdgesOverlay(body) {
  const segs = body?.group?.userData?.__archdiscEdgesLine;
  if (!segs) return;
  for (const line of segs) {
    if (line.parent) line.parent.remove(line);
    if (line.geometry) line.geometry.dispose();
    if (line.material) line.material.dispose();
  }
  delete body.group.userData.__archdiscEdgesLine;
}

function sync(reg) {
  if (!reg) return;
  const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
  const selected = new Set(typeof reg.selectedIds === 'function'
    ? reg.selectedIds()
    : (reg.selectedId ? [reg.selectedId] : []));
  for (const body of list) {
    if (selected.has(body.id)) ensureEdgesOverlay(body);
    else removeEdgesOverlay(body);
  }
}

export function attachSelectionEdges() {
  if (_attached) return;
  if (typeof window === 'undefined') return;
  const reg = window.__archdiscBodies;
  if (!reg || typeof reg.onChange !== 'function') return;
  _unsub = reg.onChange(() => sync(reg));
  sync(reg);
  _attached = true;
  if (typeof window !== 'undefined') {
    window.__archdiscSelectionEdgesActive = true;
  }
}

export function detachSelectionEdges() {
  if (_unsub) { _unsub(); _unsub = null; }
  _attached = false;
  if (typeof window !== 'undefined') {
    window.__archdiscSelectionEdgesActive = false;
  }
}

export default { attachSelectionEdges, detachSelectionEdges };
