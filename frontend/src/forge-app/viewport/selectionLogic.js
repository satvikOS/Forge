/**
 * selectionLogic — pure pick-resolution.
 *
 * The picker receives a `THREE.Intersection[]` (sorted by distance)
 * from a Raycaster, asks ForgeBodyMesh.resolveHit to map each one back
 * to a `{ handle, kind }`, then gates by the SelectionFilter. The
 * first kept hit wins.
 *
 * Lives outside the React component so we can headless-test the gate
 * + nearest-hit math with a mocked raycaster.
 */

import { gatePicks } from './viewportState.js';

/**
 * @param {Array} intersections  — `THREE.Intersection[]`, sorted near→far.
 * @param {object} bodyMesh      — ForgeBodyMesh instance (.resolveHit()).
 * @param {object} filter        — SelectionFilter instance.
 * @returns {Array<{handle, kind, intersection}>}
 */
export function resolvePicks(intersections, bodyMesh, filter) {
  const raw = (intersections || [])
    .map((it) => {
      const r = bodyMesh && bodyMesh.resolveHit ? bodyMesh.resolveHit(it) : null;
      return r ? { ...r, intersection: it } : null;
    })
    .filter(Boolean);
  return gatePicks(raw, filter);
}

/**
 * Of the picks that survived the filter, return at most one — the
 * nearest to the camera. The picker treats this as the new selection
 * unless shift is held (caller handles add-to-set logic).
 */
export function nearestPick(picks) {
  if (!picks || picks.length === 0) return null;
  let best = picks[0];
  let bestD = best.intersection && best.intersection.distance !== undefined
              ? best.intersection.distance : Infinity;
  for (let i = 1; i < picks.length; i++) {
    const d = picks[i].intersection && picks[i].intersection.distance !== undefined
              ? picks[i].intersection.distance : Infinity;
    if (d < bestD) { best = picks[i]; bestD = d; }
  }
  return best;
}

/**
 * Compute the next selection set from a click. `mode` is:
 *   'replace' — drop existing selection, use the new pick.
 *   'add'     — toggle the pick into the current set (Shift / Ctrl).
 */
export function nextSelection(current, pick, mode = 'replace') {
  if (!pick) return mode === 'replace' ? [] : current;
  if (mode === 'replace') return [{ handle: pick.handle, kind: pick.kind }];
  const i = current.findIndex((s) => s.handle === pick.handle && s.kind === pick.kind);
  if (i >= 0) {
    return [...current.slice(0, i), ...current.slice(i + 1)];
  }
  return [...current, { handle: pick.handle, kind: pick.kind }];
}
