// Forge-90 — drawings dispatch (real-kernel-aware wrapper).
//
// Wraps the four projection entry points window.forge.drawings exposes
// (projectShape / projectSection / projectDetail / projectBroken). All
// four are called from DrawingsWorkbench when the user adds / edits a
// drawing view. The kernel calls can throw (handle not in registry,
// degenerate camera direction, hatch spec mis-formed, the .node addon
// not loaded in the dev shell, …); the workbench needs a deterministic
// fallback so the SVG canvas always has something to render and the
// inspector / dimension tool / BOM never crash on undefined.
//
// Each fallback returns a tiny but visually identifiable synthetic
// outline whose extent in mm is the body's nominal bounding-box (kept
// here as a constant — the workbench scales it to the view rect).
// The fallback set is deliberately distinct per direction so the
// 2 × 2 view grid in the workbench reads as four different
// orientations rather than four identical rectangles.

export const DIRECTION_PRESETS = Object.freeze([
  'iso', 'front', 'back', 'top', 'bottom', 'right', 'left', 'section',
]);

export function isDirection(d) {
  return DIRECTION_PRESETS.includes(d);
}

const FALLBACK_BBOX = { w: 80, h: 60, d: 40 };       // mm — generic box

// Returns { edges:[{points:[[x,y],…], visible:boolean}], hatches?:[…] }
// — same shape the renderer expects from the kernel.
function fallbackShape(direction) {
  const { w, h, d } = FALLBACK_BBOX;
  switch (direction) {
    case 'front':
      // outline + a vertical mid-line + a hidden centreline
      return {
        edges: [
          { points: [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2]], visible: true },
          { points: [[0,-h/2],[0,h/2]],   visible: false },
          { points: [[-w/2,0],[w/2,0]],   visible: false },
        ],
      };
    case 'back':
      return {
        edges: [
          { points: [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2]], visible: true },
          { points: [[-w/2,-h/2],[w/2,h/2]], visible: false },
        ],
      };
    case 'top':
      return {
        edges: [
          { points: [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]], visible: true },
          { points: [[-w/2,0],[w/2,0]], visible: false },
        ],
      };
    case 'bottom':
      return {
        edges: [
          { points: [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]], visible: true },
        ],
      };
    case 'right':
      return {
        edges: [
          { points: [[-d/2,-h/2],[d/2,-h/2],[d/2,h/2],[-d/2,h/2],[-d/2,-h/2]], visible: true },
          { points: [[0,-h/2],[0,h/2]], visible: false },
        ],
      };
    case 'left':
      return {
        edges: [
          { points: [[-d/2,-h/2],[d/2,-h/2],[d/2,h/2],[-d/2,h/2],[-d/2,-h/2]], visible: true },
        ],
      };
    case 'section': {
      // a sectioned rectangle — outline plus the hatched cut face
      const outline = [
        [-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2],
      ];
      const hatches = [];
      const step = 4;
      for (let x = -w/2; x < w/2; x += step) {
        hatches.push({
          points: [[x, -h/2], [x + h, h/2]],
        });
      }
      return {
        edges: [{ points: outline, visible: true }],
        hatches,
      };
    }
    case 'iso':
    default: {
      // a hexagonal-ish iso silhouette of a box
      const k = 0.5;
      return {
        edges: [
          { points: [
            [-w/2, -h/2 + d*k],
            [0,    -h/2 - d*k*0.6],
            [w/2,  -h/2 + d*k],
            [w/2,   h/2 + d*k*0.4],
            [0,     h/2 + d*k],
            [-w/2,  h/2 + d*k*0.4],
            [-w/2, -h/2 + d*k],
          ], visible: true },
          { points: [
            [-w/2, -h/2 + d*k],
            [0,    -h/2 + d*k*2.2],
            [w/2,  -h/2 + d*k],
          ], visible: false },
          { points: [
            [0, -h/2 + d*k*2.2],
            [0, h/2 + d*k],
          ], visible: false },
        ],
      };
    }
  }
}

function kernelDrawings() {
  if (typeof window === 'undefined') return null;
  const d = window?.forge?.drawings;
  return d && typeof d.projectShape === 'function' ? d : null;
}

function isValidEdgeList(out) {
  return out && Array.isArray(out.edges);
}

/**
 * Project a body to a 2D outline. Always returns a result with .edges
 * (never throws — kernel failures degrade to a synthetic outline so the
 * sheet renders).
 *
 * @param {number|null} handle  forge-kernel shape handle (or null)
 * @param {string}      direction  one of DIRECTION_PRESETS
 * @returns {{edges:Array, source:'kernel'|'fallback'}}
 */
export function projectShapeSafe(handle, direction) {
  if (!isDirection(direction)) direction = 'iso';
  const k = kernelDrawings();
  if (k && typeof handle === 'number') {
    try {
      const out = k.projectShape(handle, direction);
      if (isValidEdgeList(out)) return { ...out, source: 'kernel' };
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[forge.v4.drawings] projectShape threw:', err.message);
      }
    }
  }
  return { ...fallbackShape(direction), source: 'fallback' };
}

/**
 * Section view — sectionPlane = { origin:[x,y,z], normal:[x,y,z] }.
 * hatchSpec = { angle?, spacing?, thickness? }.
 */
export function projectSectionSafe(handle, direction, sectionPlane, hatchSpec) {
  if (!isDirection(direction)) direction = 'front';
  const k = kernelDrawings();
  if (k && typeof handle === 'number') {
    try {
      const out = k.projectSection(handle, direction, sectionPlane || {
        origin: [0, 0, 0], normal: [0, 0, 1],
      }, hatchSpec || { angle: 45, spacing: 4, thickness: 0.4 });
      if (isValidEdgeList(out)) return { ...out, source: 'kernel' };
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[forge.v4.drawings] projectSection threw:', err.message);
      }
    }
  }
  return { ...fallbackShape('section'), source: 'fallback' };
}

/**
 * Detail view — focusCircle = { cx, cy, r }; magnifies inside the circle.
 */
export function projectDetailSafe(handle, direction, focusCircle, scale) {
  if (!isDirection(direction)) direction = 'front';
  const k = kernelDrawings();
  if (k && typeof handle === 'number') {
    try {
      const out = k.projectDetail(handle, direction, focusCircle || {
        cx: 0, cy: 0, r: 20,
      }, scale ?? 2);
      if (isValidEdgeList(out)) return { ...out, source: 'kernel', scale: scale ?? 2 };
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[forge.v4.drawings] projectDetail threw:', err.message);
      }
    }
  }
  // Synthetic detail: take the front fallback and crop to the focusCircle.
  const base = fallbackShape(direction);
  const c = focusCircle || { cx: 0, cy: 0, r: 20 };
  const s = scale ?? 2;
  const edges = base.edges.map((e) => ({
    ...e,
    points: e.points.map(([x, y]) => [(x - c.cx) * s, (y - c.cy) * s]),
  }));
  return { edges, scale: s, source: 'fallback' };
}

/**
 * Broken view — breakRegion = { axis:'x'|'y', from:number, to:number }.
 */
export function projectBrokenSafe(handle, direction, breakRegion) {
  if (!isDirection(direction)) direction = 'front';
  const k = kernelDrawings();
  if (k && typeof handle === 'number') {
    try {
      const out = k.projectBroken(handle, direction, breakRegion || {
        axis: 'x', from: -10, to: 10,
      });
      if (isValidEdgeList(out)) return { ...out, source: 'kernel' };
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[forge.v4.drawings] projectBroken threw:', err.message);
      }
    }
  }
  // Synthetic broken: front fallback with a zig-zag in the middle.
  const base = fallbackShape(direction);
  const reg = breakRegion || { axis: 'x', from: -10, to: 10 };
  const zig = [];
  const yA = -20, yB = 20;
  const mid = (reg.from + reg.to) / 2;
  for (let y = yA; y <= yB; y += 4) {
    zig.push([mid + ((y / 4) % 2 ? 3 : -3), y]);
  }
  return {
    ...base,
    edges: [
      ...base.edges,
      { points: zig, visible: true, broken: true },
    ],
    source: 'fallback',
  };
}

/**
 * Compute the 2D extent of an edge list, in the same units the
 * projection returned. Used by the SVG renderer to compute a viewBox.
 */
export function edgeBounds(edges) {
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  let n = 0;
  for (const e of edges || []) {
    for (const p of e.points || []) {
      if (!p || p.length < 2) continue;
      const [x, y] = p;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      n += 1;
    }
  }
  if (n === 0) {
    return { minX: -50, minY: -40, maxX: 50, maxY: 40, w: 100, h: 80 };
  }
  // Pad 5% on every side so the outline never touches the sheet edge.
  const w = maxX - minX, h = maxY - minY;
  const padX = Math.max(2, w * 0.05);
  const padY = Math.max(2, h * 0.05);
  return {
    minX: minX - padX, minY: minY - padY,
    maxX: maxX + padX, maxY: maxY + padY,
    w: w + 2 * padX, h: h + 2 * padY,
  };
}
