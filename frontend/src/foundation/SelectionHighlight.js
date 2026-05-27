/**
 * SelectionHighlight — drives an emissive rim-style highlight onto
 * every body's material based on BodyRegistry selection. Adds visible
 * affordance for "this body is selected" without depending on a
 * dedicated outline-pass post-process step.
 *
 * Mechanism:
 *   - Subscribes once to BodyRegistry.onChange
 *   - On every change, walks every body's Three.js group, finds every
 *     Mesh, and sets either `selected` emissive (cool blue) or default
 *     (no emissive) based on whether the body's id is in the selected
 *     set
 *   - Caches the original emissive + emissiveIntensity per material on
 *     first touch so deselect restores precisely; never grows the
 *     material's cached state
 *
 * No new geometry, no extra mesh, no shader pass: just emissive +
 * emissiveIntensity flips. Plays cleanly with the WF-07 PBR env
 * lighting (the emissive contribution sits on top of the env
 * reflection).
 */

import * as THREE from 'three';

const SELECTED_EMISSIVE = new THREE.Color(0x3b7be0);  // cool industrial blue
const SELECTED_EMISSIVE_INTENSITY = 0.42;

// Per-material remembered defaults: WeakMap so we never leak when
// materials are disposed.
const ORIGINAL_STATE = new WeakMap();

function rememberOriginal(mat) {
  if (ORIGINAL_STATE.has(mat)) return;
  ORIGINAL_STATE.set(mat, {
    color: mat.emissive ? mat.emissive.clone() : null,
    intensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : 1,
  });
}

function applySelected(mat) {
  if (!mat || !mat.isMaterial) return;
  rememberOriginal(mat);
  if (mat.emissive) mat.emissive.copy(SELECTED_EMISSIVE);
  if ('emissiveIntensity' in mat) mat.emissiveIntensity = SELECTED_EMISSIVE_INTENSITY;
  mat.needsUpdate = true;
}

function applyDeselected(mat) {
  if (!mat || !mat.isMaterial) return;
  const orig = ORIGINAL_STATE.get(mat);
  if (!orig) return;
  if (orig.color && mat.emissive) mat.emissive.copy(orig.color);
  if ('emissiveIntensity' in mat) mat.emissiveIntensity = orig.intensity;
  mat.needsUpdate = true;
}

function syncSelectionToMeshes(reg) {
  if (!reg) return;
  const list = typeof reg.list === 'function' ? reg.list() : (reg.bodies || []);
  const selectedSet = new Set(typeof reg.selectedIds === 'function'
    ? reg.selectedIds()
    : (reg.selectedId ? [reg.selectedId] : []));
  for (const body of list) {
    const isSelected = selectedSet.has(body.id);
    if (!body.group) continue;
    body.group.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (isSelected) applySelected(mat);
        else applyDeselected(mat);
      }
    });
  }
}

let _attached = false;
let _unsubscribe = null;

/**
 * Install the selection-highlight listener on the BodyRegistry exposed
 * on window. Safe to call multiple times — only the first call attaches.
 */
export function attachSelectionHighlight() {
  if (_attached) return;
  if (typeof window === 'undefined') return;
  const reg = window.__archdiscBodies;
  if (!reg || typeof reg.onChange !== 'function') return;
  _unsubscribe = reg.onChange(() => syncSelectionToMeshes(reg));
  // Sync once on attach so any pre-existing selection paints correctly.
  syncSelectionToMeshes(reg);
  _attached = true;
  if (typeof window !== 'undefined') {
    window.__archdiscSelectionHighlightActive = true;
  }
}

export function detachSelectionHighlight() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _attached = false;
  if (typeof window !== 'undefined') {
    window.__archdiscSelectionHighlightActive = false;
  }
}

export default { attachSelectionHighlight, detachSelectionHighlight };
