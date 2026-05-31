/**
 * SectionPlane — real-time clipping plane for the viewport. Lets the
 * user scrub a section through the assembly along one of the world
 * axes, revealing the inside of every body cut by the plane.
 *
 * Three.js wiring:
 *   - Each clipping plane is added to renderer.clippingPlanes (global)
 *     OR to material.clippingPlanes (per material).
 *   - We use the global slot so every existing AND future body picks
 *     up the clip with no per-material plumbing.
 *   - renderer.localClippingEnabled stays false (we don't need
 *     per-material overrides).
 *
 * State (mirrored on window for e2e + UI components):
 *   __archdiscSectionAxis        'x' | 'y' | 'z' | null
 *   __archdiscSectionPosition    number (mm along axis); plane = axis offset
 *   __archdiscSectionPlanes      live THREE.Plane[] (length 0 or 1)
 *
 * The plane normal points along +axis; the constant is -position (mm in
 * world coords, converted to metres for Three's plane.constant which is
 * scene-units = metres). Negative side of the plane is clipped.
 */

import * as THREE from 'three';

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

let _currentPlane = null;
let _currentAxis = null;
let _currentPositionMm = 0;

function getRenderer() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport?.renderer ?? null;
}

function syncToRenderer() {
  const r = getRenderer();
  if (!r) return;
  r.clippingPlanes = _currentPlane ? [_currentPlane] : [];
  if (typeof window !== 'undefined') {
    window.__archdiscSectionPlanes = r.clippingPlanes;
  }
}

export function setSectionAxis(axis) {
  if (axis !== 'x' && axis !== 'y' && axis !== 'z' && axis !== null) {
    throw new Error(`Invalid axis: ${axis}`);
  }
  _currentAxis = axis;
  if (axis === null) {
    _currentPlane = null;
  } else {
    if (!_currentPlane) {
      _currentPlane = new THREE.Plane(AXIS_VECTORS[axis].clone(), 0);
    } else {
      _currentPlane.normal.copy(AXIS_VECTORS[axis]);
    }
    // Plane.constant = -position-in-metres (mm → m).
    _currentPlane.constant = -(_currentPositionMm / 1000);
  }
  syncToRenderer();
  if (typeof window !== 'undefined') {
    window.__archdiscSectionAxis = _currentAxis;
  }
}

export function setSectionPositionMm(positionMm) {
  _currentPositionMm = Number(positionMm) || 0;
  if (_currentPlane) {
    _currentPlane.constant = -(_currentPositionMm / 1000);
  }
  syncToRenderer();
  if (typeof window !== 'undefined') {
    window.__archdiscSectionPosition = _currentPositionMm;
  }
}

export function clearSection() {
  setSectionAxis(null);
  _currentPositionMm = 0;
  if (typeof window !== 'undefined') {
    window.__archdiscSectionPosition = 0;
  }
}

export function getSectionState() {
  return { axis: _currentAxis, positionMm: _currentPositionMm };
}

/**
 * Install the section-plane API on window so headed e2e + future UI
 * components can drive the section without importing this module.
 * Safe to call multiple times.
 */
export function attachSectionPlane() {
  if (typeof window === 'undefined') return;
  window.__archdiscSetSectionAxis = setSectionAxis;
  window.__archdiscSetSectionPositionMm = setSectionPositionMm;
  window.__archdiscClearSection = clearSection;
  window.__archdiscGetSectionState = getSectionState;
  window.__archdiscSectionAxis = _currentAxis;
  window.__archdiscSectionPosition = _currentPositionMm;
  window.__archdiscSectionPlanes = [];
}

export default { setSectionAxis, setSectionPositionMm, clearSection, getSectionState, attachSectionPlane };
