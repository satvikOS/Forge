// Forge-130 — drawings view alignment engine.
//
// When a view is dragged on the sheet, it should snap to the centre-line
// of any other view whose horizontal or vertical centre lies within the
// snap tolerance. This is the standard SolidWorks / Inventor / Creo
// behaviour: child views auto-align to their parent, but a drop in
// "free" (no snap candidate within tolerance) breaks the alignment so
// the user can drag freely afterwards.
//
// The engine here is pure / referentially transparent — no React, no
// kernel calls — so the workbench can use it in render and in pointer
// handlers, and the test spec can import it directly to assert the
// snap math without driving the UI.
//
// View record shape (only the fields the engine reads):
//   {
//     id,
//     x, y, w, h,                  // sheet-space top-left + size, mm
//     parentId?,                   // last alignment parent (or null)
//     align?: 'h' | 'v' | null,    // axis of current alignment
//     alignOffset?: number,        // axial offset preserved from parent
//   }

export const DEFAULT_SNAP_TOLERANCE_MM = 4;
export const ALIGNMENT_AXIS = Object.freeze({
  horizontal: 'h',   // share Y centre (views in a horizontal row)
  vertical:   'v',   // share X centre (views in a vertical column)
});

/** Centre point of a rect in sheet coords. */
export function viewCentre(view) {
  if (!view) return { cx: 0, cy: 0 };
  const cx = (view.x ?? 0) + (view.w ?? 0) / 2;
  const cy = (view.y ?? 0) + (view.h ?? 0) / 2;
  return { cx, cy };
}

/**
 * For each candidate view, compute the snap offset that would bring the
 * proposed centre into alignment with that view, and return the best
 * (smallest |offset|) snap that is within `tolerance` mm.
 *
 * @param {{cx:number,cy:number}} proposed
 * @param {Array<object>}        candidates  views to align against
 * @param {number}               tolerance   max distance in mm
 * @returns {{candidateId:string, axis:'h'|'v', dx:number, dy:number}|null}
 */
export function findBestSnap(proposed, candidates, tolerance = DEFAULT_SNAP_TOLERANCE_MM) {
  if (!proposed || !candidates?.length) return null;
  let best = null;
  for (const cand of candidates) {
    if (!cand) continue;
    const { cx, cy } = viewCentre(cand);
    // Horizontal alignment: y centres match → snap dy = cy - proposed.cy
    const dyH = cy - proposed.cy;
    if (Math.abs(dyH) <= tolerance) {
      if (!best || Math.abs(dyH) < Math.abs(best.dy ?? best.dx ?? Infinity)) {
        best = { candidateId: cand.id, axis: ALIGNMENT_AXIS.horizontal, dx: 0, dy: dyH };
      }
    }
    // Vertical alignment: x centres match → snap dx = cx - proposed.cx
    const dxV = cx - proposed.cx;
    if (Math.abs(dxV) <= tolerance) {
      if (!best || Math.abs(dxV) < Math.abs(best.dy ?? best.dx ?? Infinity)) {
        best = { candidateId: cand.id, axis: ALIGNMENT_AXIS.vertical, dx: dxV, dy: 0 };
      }
    }
  }
  return best;
}

/**
 * Apply a snap result to a proposed top-left position, returning the
 * snapped top-left + alignment metadata.
 *
 * @param {object} proposedRect   {x, y, w, h}
 * @param {object|null} snap      result of findBestSnap (centre-relative)
 * @returns {{x:number, y:number, parentId:string|null, align:'h'|'v'|null,
 *            alignOffset:number}}
 */
export function applySnap(proposedRect, snap) {
  if (!snap) {
    return {
      x: proposedRect.x,
      y: proposedRect.y,
      parentId: null,
      align: null,
      alignOffset: 0,
    };
  }
  return {
    x: proposedRect.x + snap.dx,
    y: proposedRect.y + snap.dy,
    parentId: snap.candidateId,
    align: snap.axis,
    alignOffset: snap.axis === 'h' ? proposedRect.x : proposedRect.y,
  };
}

/**
 * Convenience wrapper used by the workbench on a drag release. Returns
 * the final view rect + alignment metadata, snapping to other views
 * (excluding the view being dragged itself).
 *
 * If `proposedRect` lands outside snap tolerance of every other view,
 * the alignment is broken (parentId=null, align=null).
 */
export function resolveDrop(proposedRect, allViews, {
  draggedId = null,
  tolerance = DEFAULT_SNAP_TOLERANCE_MM,
} = {}) {
  const candidates = (allViews || []).filter((v) => v && v.id !== draggedId);
  const centre = viewCentre(proposedRect);
  const snap = findBestSnap(centre, candidates, tolerance);
  return applySnap(proposedRect, snap);
}

/**
 * Build a list of guide-lines (centre lines) used to render snap
 * feedback during a drag. Each line is {x1,y1,x2,y2,axis}; the workbench
 * draws dashed indigo lines for each match.
 */
export function alignmentGuides(proposed, candidates, tolerance = DEFAULT_SNAP_TOLERANCE_MM, sheetW = 297, sheetH = 210) {
  const guides = [];
  if (!proposed || !candidates?.length) return guides;
  for (const cand of candidates) {
    if (!cand) continue;
    const { cx, cy } = viewCentre(cand);
    if (Math.abs(cy - proposed.cy) <= tolerance) {
      guides.push({
        candidateId: cand.id,
        axis: ALIGNMENT_AXIS.horizontal,
        x1: 0, y1: cy, x2: sheetW, y2: cy,
      });
    }
    if (Math.abs(cx - proposed.cx) <= tolerance) {
      guides.push({
        candidateId: cand.id,
        axis: ALIGNMENT_AXIS.vertical,
        x1: cx, y1: 0, x2: cx, y2: sheetH,
      });
    }
  }
  return guides;
}

/**
 * When the parent view is moved, slide every child (a view whose parentId
 * is the dragged view's id) along its alignment axis so the alignment is
 * preserved. Returns a new array (immutably patched).
 */
export function propagateParentMove(views, draggedId, delta) {
  if (!views?.length || !draggedId) return views || [];
  const dx = delta?.dx || 0, dy = delta?.dy || 0;
  return views.map((v) => {
    if (v.parentId !== draggedId || !v.align) return v;
    if (v.align === ALIGNMENT_AXIS.horizontal) {
      // share Y with parent → only Y follows
      return { ...v, y: (v.y || 0) + dy };
    }
    if (v.align === ALIGNMENT_AXIS.vertical) {
      return { ...v, x: (v.x || 0) + dx };
    }
    return v;
  });
}

/** True if `view` is currently aligned to another view. */
export function isAligned(view) {
  return !!(view && view.parentId && view.align);
}

/** Human-readable summary for the inspector. */
export function describeAlignment(view) {
  if (!isAligned(view)) return 'free';
  const axis = view.align === ALIGNMENT_AXIS.horizontal ? 'horizontal' : 'vertical';
  return `aligned ${axis} → ${view.parentId}`;
}
