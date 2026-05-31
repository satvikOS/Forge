/**
 * BodyMaterialColor — paints every body's mesh diffuse colour to match
 * the engineering material assigned via the WF-08 Body Properties
 * Inspector. Brings the viewport into visual sync with the Inspector +
 * the WF-22 OBJ/MTL export, so the colour the user sees on screen is
 * the same colour they get when handing off to a DCC tool.
 *
 * Colour table mirrors MeshObjMultiExport's MATERIAL_COLORS table —
 * Munsell-style physical-surface approximations. Bodies with no
 * material assignment revert to their original `color` (cached per-
 * material on first touch via WeakMap).
 *
 * Coordinates with WF-18 selection / WF-21 hover: both of those drive
 * material.emissive, while this drives material.color. The two are
 * orthogonal channels in MeshStandardMaterial, so they layer cleanly.
 */

import * as THREE from 'three';

const MAT_STORAGE_KEY = 'archdisc:body-materials:v1';

// Munsell-style physical-surface RGB (0..1) per engineering material.
// Mirrors MeshObjMultiExport's MATERIAL_COLORS exactly for consistency
// across viewport + OBJ export + future BOM thumbnails.
const MATERIAL_COLORS = {
  'steel-1045':  [0.62, 0.62, 0.64],
  'steel-4140':  [0.58, 0.59, 0.62],
  'stainless':   [0.78, 0.80, 0.82],
  'aluminum':    [0.83, 0.84, 0.86],
  'brass':       [0.85, 0.65, 0.20],
  'cast-iron':   [0.36, 0.36, 0.38],
  'titanium':    [0.68, 0.66, 0.66],
  'pu':          [0.85, 0.55, 0.20],
};

// Per-material cached original color so unsetting a body's material
// restores the kernel's default exactly.
const ORIGINAL_COLOR = new WeakMap();

function rememberOriginal(mat) {
  if (ORIGINAL_COLOR.has(mat)) return;
  if (mat.color) ORIGINAL_COLOR.set(mat, mat.color.clone());
}

function applyMaterialColor(mat, materialKey) {
  if (!mat || !mat.color) return;
  rememberOriginal(mat);
  const rgb = MATERIAL_COLORS[materialKey];
  if (rgb) {
    mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
  } else {
    const orig = ORIGINAL_COLOR.get(mat);
    if (orig) mat.color.copy(orig);
  }
  mat.needsUpdate = true;
}

function loadMaterialMap() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MAT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function syncAllBodies() {
  if (typeof window === 'undefined') return;
  const reg = window.__archdiscBodies;
  if (!reg) return;
  const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
  const map = loadMaterialMap();
  for (const body of list) {
    if (!body?.group) continue;
    const key = map[body.id] || null;
    body.group.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) applyMaterialColor(mat, key);
    });
  }
}

let _attached = false;
let _unsubBody = null;
let _storageHandler = null;

export function attachBodyMaterialColor() {
  if (_attached) return;
  if (typeof window === 'undefined') return;
  const reg = window.__archdiscBodies;
  if (!reg || typeof reg.onChange !== 'function') return;

  // Initial paint for any bodies already present.
  syncAllBodies();

  // Repaint on registry changes (new body added / removed / renamed).
  _unsubBody = reg.onChange(syncAllBodies);

  // Repaint when the WF-08 Inspector mutates the material map. The
  // Inspector writes localStorage on every dropdown change; we tap the
  // `storage` event for cross-tab notifications PLUS poll the map at
  // 4 Hz (storage event fires only across windows, not in the same one).
  _storageHandler = (e) => { if (e.key === MAT_STORAGE_KEY) syncAllBodies(); };
  window.addEventListener('storage', _storageHandler);
  // 4 Hz same-window poll. Cheap (a registry walk over typically
  // tens of bodies); compromise for the lack of a same-window
  // storage event.
  const t = setInterval(syncAllBodies, 250);

  _attached = true;
  if (typeof window !== 'undefined') {
    window.__archdiscBodyMaterialColorActive = true;
    window.__archdiscBodyMaterialColorPoller = t;
    window.__archdiscBodyMaterialColorSync = syncAllBodies;
  }
}

export function detachBodyMaterialColor() {
  if (_unsubBody) { _unsubBody(); _unsubBody = null; }
  if (_storageHandler) {
    window.removeEventListener('storage', _storageHandler);
    _storageHandler = null;
  }
  if (window.__archdiscBodyMaterialColorPoller) {
    clearInterval(window.__archdiscBodyMaterialColorPoller);
    window.__archdiscBodyMaterialColorPoller = null;
  }
  _attached = false;
  if (typeof window !== 'undefined') {
    window.__archdiscBodyMaterialColorActive = false;
  }
}

export default { attachBodyMaterialColor, detachBodyMaterialColor };
