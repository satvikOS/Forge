/**
 * ArchDisc Forge — AUTO-2D-DRAWING engine (Task #27 + Task #45).
 *
 * The #3 most-hated, least-automated MCAD workflow: a 2D drawing that
 * (a) lays out the standard front / top / right / iso HLR views, (b)
 * auto-dimensions the part from its real geometry, (c) places GD&T from
 * the part's semantic PMI, (d) emits a Y14.5-conformant sheet (title
 * block + border + views + dims + GD&T) as SVG, and — the killer gap —
 * (e) REGENERATES the whole drawing (views + dimension VALUES) when a
 * part parameter changes, because every number is re-derived from the
 * live kernel geometry rather than typed in by hand.
 *
 * Task #45 COMPLETES the engine (extends, does not duplicate #27):
 *   (A) sectionView()   — auto-places a real planar cut + ISO 128-50
 *       hatching (uniform spacing scaled to the sectioned area; distinct
 *       angles 45/135/30… per body in a multi-body section so adjacent
 *       solids are visually separable) + the ASME Y14.2 cutting-plane
 *       chain-line + 'SECTION A-A' label on the parent view.
 *   (B) detailView()    — the dashed focus circle + letter callout on the
 *       source view + an enlarged 'DETAIL B  SCALE 2:1' view (ASME Y14.3).
 *   (C) PMI edge anchors — every FCF/dimension now lands on a SPECIFIC
 *       projected VISIBLE model edge/vertex (anchor id + 2D landing point),
 *       chosen by geometry; an FCF never floats free and never attaches to
 *       a hidden line (ISO 129-1 / ASME Y14.5). Hole position FCFs also get
 *       ISO-128 centre lines (long-short chain).
 *   (D) balloon↔BOM     — each balloon item number maps 1:1 to a BOM table
 *       row (ASME Y14.34) with a real leader to the part instance.
 *   (E) regenerate()    — re-derives views/dims/sections/details/balloons
 *       for an ARBITRARY changed part (a live kernel handle — no recipe
 *       required), so the whole sheet reflows parametrically.
 *
 * Design — REUSE, don't reinvent:
 *   • Standard views come from the kernel HLR primitive
 *     `forge.drawings.projectView(handle, dir)` → V2 view
 *     `{ visibleEdges, hiddenEdges, bbox }` (real visible + hidden line
 *     removal via OCCT TKHLR). No silhouette fallback is needed.
 *   • The rich sheet (title block, border, scaled/placed views, dims,
 *     Y-flip, arrowheads) is the existing `ForgeDrawing` from
 *     `src/kernel/forge/Drawings.js`. We feed it views built from the V2
 *     projection (adapted to the flat-packed shape `DrawingView` reads).
 *   • Auto-dimensioning reuses the `AutoDimPanel` math
 *     (`runAutoDim` / `bboxOfView` / `detectHoles`) — the proven
 *     bbox-W/H/D + per-hole-Ø + hole-pitch heuristics.
 *   • GD&T comes from the semantic PMI registry
 *     (`pmiAnnotations.listAnnotationsForBody` + `annotationToText`).
 *
 * Hard constraints (Task #27 brief):
 *   • NO new npm packages — all writers inline (`ForgeDrawing` SVG +
 *     kernel `emitDXF` for the DXF bonus).
 *   • NO stubs for views / dims. Sections, broken/detail views, balloons
 *     and BOM exist in `Drawings.js` but are NOT auto-placed here — those
 *     are flagged follow-ups, not stubs.
 *
 * Verifiable WITHOUT a viewer: the returned data model + emitted SVG are
 * checkable — view polyline counts, dimension VALUES equal to the real
 * part geometry (an 80 mm-wide part → an 80.0 dimension), GD&T present,
 * and a param change updates the dimension values.
 */

import {
  ForgeDrawing,
  DrawingView,
  SectionView,
  DetailView,
  DimensionLinear,
  DimensionRadial,
  Balloon,
  getSheetMm,
  _setForgeKernel,
} from '../../kernel/forge/Drawings.js';
import { getForge } from '../../kernel/forge/index.js';
import {
  bboxOfView,
  detectHoles,
} from '../autoDimMath.js';
import {
  listAnnotationsForBody,
  annotationToText,
} from '../pmiAnnotations.js';

// ── kernel resolution ───────────────────────────────────────────────
// Mirror the Drawings.js / pmiAnnotations.js injection seam so Node tests
// (and Archie's headless replay) can drive the engine with the prebuilt
// `forge-kernel.node` directly, without the Electron preload bridge.
let _kernelOverride = null;
/** Inject a kernel for headless use; also propagates to `ForgeDrawing`. */
export function setForgeKernel(kernel) {
  _kernelOverride = kernel;
  // ForgeDrawing also resolves a kernel (its emitDXF path); keep them aligned.
  try { _setForgeKernel(kernel); } catch { /* no-op */ }
}
function kernel() {
  if (_kernelOverride) return _kernelOverride;
  // Renderer path: window.forge via the facade.
  return getForge();
}

// ── projection convention (kernel Drawings.hpp:159-163) ─────────────
//   front (look -Y): screenX = worldX (WIDTH),  screenY = worldZ (DEPTH)
//   top   (look -Z): screenX = worldX (WIDTH),  screenY = worldY (HEIGHT)
//   right (look -X): screenX = worldY (HEIGHT), screenY = worldZ (DEPTH)
// → W,H,D are recovered from the 2D bboxes of any two ortho views.
export const ORTHO_DIRS = Object.freeze(['front', 'top', 'right']);
export const ALL_DIRS = Object.freeze(['front', 'top', 'right', 'iso']);

// ── 3D → view-local 2D projection (the EXACT kernel convention) ─────
// Verified against `forge.drawings.projectView` bboxes of a known box:
//   front bbox = {x:[0,80], y:[-12,0]}  → screenX= worldX, screenY=-worldZ
//   top   bbox = {x:[0,80], y:[0,60]}   → screenX= worldX, screenY= worldY
//   right bbox = {x:[0,60], y:[-12,0]}  → screenX= worldY, screenY=-worldZ
// (the right-hand-rule down-Z sign is why front/right minY are negative).
// Used to land PMI leaders + balloon arrows on the SAME 2D coordinates the
// HLR projection produced — so an anchor lands ON a real projected edge,
// never a guessed bbox corner (Task #45 requirement C / ISO 129-1).
export function project3dToView(p3, dir) {
  const x = Number(p3[0]) || 0, y = Number(p3[1]) || 0, z = Number(p3[2]) || 0;
  switch (dir) {
    case 'front': return [x, -z];
    case 'top':   return [x, y];
    case 'right': return [y, -z];
    // iso has no closed-form 2D anchor mapping we rely on here; callers
    // never anchor PMI to the pictorial iso view (it carries no dims).
    default:      return [x, -z];
  }
}

// ── V2 → flat-packed projection adapter ─────────────────────────────
//
// `forge.drawings.projectView` returns the V2 shape
//   { visibleEdges:[[{x,y}…]…], hiddenEdges:[[{x,y}…]…], bbox:{minX..maxY} }
// while `DrawingView` (Drawings.js) reads the legacy flat-packed shape
//   { visible:Float64[], visibleStarts:Int[], visibleCount, hidden…, outline… }
// This converts the former into the latter so we reuse the whole
// `ForgeDrawing` render pipeline unchanged.
export function v2ToFlatProjection(v2) {
  const pack = (buckets) => {
    const flat = [];
    const starts = [0];
    let count = 0;
    for (const pl of (Array.isArray(buckets) ? buckets : [])) {
      if (!Array.isArray(pl) || pl.length < 2) continue;
      for (const p of pl) {
        flat.push(Number(p.x) || 0, Number(p.y) || 0);
      }
      starts.push(flat.length / 2);
      count += 1;
    }
    return { flat, starts, count };
  };
  const vis = pack(v2 && v2.visibleEdges);
  const hid = pack(v2 && v2.hiddenEdges);
  return {
    visible: vis.flat, visibleStarts: vis.starts, visibleCount: vis.count,
    hidden: hid.flat, hiddenStarts: hid.starts, hiddenCount: hid.count,
    // No separate silhouette bucket from projectView (outline is merged
    // into visibleEdges by the kernel) — keep an empty outline bucket.
    outline: [], outlineStarts: [0], outlineCount: 0,
  };
}

// ── HLR projection ──────────────────────────────────────────────────
/** Run `forge.drawings.projectView` for one direction → V2 view or null. */
export function projectView(shape, dir) {
  const k = kernel();
  const drawings = k && k.drawings;
  if (!drawings || typeof drawings.projectView !== 'function' || shape == null) {
    return null;
  }
  return drawings.projectView(shape, dir);
}

/**
 * Place the standard views (front / top / right / iso) as scaled,
 * positioned `DrawingView`s on a fresh `ForgeDrawing`.
 *
 * Layout — THIRD-ANGLE (default, ASME / North-America):
 *     front centre; top ABOVE front; right to the RIGHT of front; iso top-right.
 * FIRST-ANGLE (ISO / Europe): top BELOW front; right to the LEFT of front.
 *
 * Every view is built from the V2 projection adapted to the flat-packed
 * shape so the existing `ForgeDrawing.renderSvg` pipeline draws it. We
 * pick one shared 1:N scale so the whole view group fits the sheet's
 * drawing area, then pin each `view.anchor` (skipping `ForgeDrawing`'s
 * 2-column autoLayout, which is assembly-oriented, not ortho-grid).
 *
 * @returns {{ drawing:ForgeDrawing, views:Object, v2:Object, scale:number,
 *             projection:string }}
 *   `views`/`v2` are keyed by dir ('front'|'top'|'right'|'iso').
 */
export function placeStandardViews(shape, opts = {}) {
  const projection = opts.projection === 'first-angle' ? 'first-angle' : 'third-angle';
  const sheet = opts.sheet || 'A3';
  const orientation = opts.orientation || 'landscape';
  const title = opts.title || 'PART DRAWING';

  const drawing = new ForgeDrawing({
    title,
    titleBlock: {
      scale: '1:1',
      sheet: '1 / 1',
      ...(opts.titleBlock || {}),
    },
  });

  // 1) Run HLR for each standard direction.
  const v2 = {};
  const views = {};
  for (const dir of ALL_DIRS) {
    const view = projectView(shape, dir);
    if (!view) continue;
    v2[dir] = view;
  }
  if (Object.keys(v2).length === 0) {
    return { drawing, views, v2, scale: 1, projection };
  }

  // 2) Choose a fit-to-sheet scale. The view group spans roughly
  //    (front.W + gap + right.W) wide and (top.H + gap + front.H) tall.
  const sheetMm = getSheetMm(sheet, orientation);
  const margin = 20;        // matches ForgeDrawing autoLayout margin
  const titleBlockH = 50;   // reserved at the bottom for the title block
  const gap = 18;           // mm between adjacent views
  const usableW = sheetMm.w - 2 * margin;
  const usableH = sheetMm.h - 2 * margin - titleBlockH;

  const span = (dir, axis) => {
    const bb = bboxOfView(v2[dir]);
    if (!bb) return 0;
    return axis === 'x' ? bb.width : bb.height;
  };
  const frontW = span('front', 'x') || 1;
  const frontH = span('front', 'y') || 1;
  const topH = span('top', 'y') || 0;
  const rightW = span('right', 'x') || 0;
  const isoW = span('iso', 'x') || 0;

  const groupW = frontW + (rightW ? gap + rightW : 0) + (isoW ? gap + isoW : 0);
  const groupH = frontH + (topH ? gap + topH : 0);
  const fit = Math.min(usableW / Math.max(groupW, 1e-6), usableH / Math.max(groupH, 1e-6));
  // Snap to a "nice" engineering scale ≤ fit (1:1, 1:2, 1:5, 1:10, …, and
  // enlargements 2:1 / 5:1 for tiny parts). This keeps the title-block
  // scale field honest.
  const scale = niceScale(fit);
  drawing.titleBlock.scale = formatScale(scale);

  // 3) Build DrawingViews and pin anchors per the projection convention.
  for (const dir of ALL_DIRS) {
    if (!v2[dir]) continue;
    const flat = v2ToFlatProjection(v2[dir]);
    const view = new DrawingView({
      label: dir.toUpperCase(),
      scale,
      projection: flat,
    });
    view.anchor.fixed = true;   // we position manually; skip autoLayout
    view._dir = dir;
    view._v2 = v2[dir];
    views[dir] = view;
    drawing.views.push(view);
  }

  layoutOrthoGrid(views, { projection, gap, margin });

  return { drawing, views, v2, scale, projection };
}

// ── ortho-grid layout ────────────────────────────────────────────────
// Pin each view's sheet anchor (top-left of its scaled bbox) so the
// front/top/right/iso form the conventional projection layout. Anchors
// are in sheet mm; the SVG renderer Y-flips per view internally.
function layoutOrthoGrid(views, { projection, gap, margin }) {
  const front = views.front;
  if (!front) {
    // Degenerate: no front view. Stack whatever we have top-to-bottom.
    let y = margin;
    for (const dir of ALL_DIRS) {
      const v = views[dir];
      if (!v) continue;
      v.anchor.x = margin; v.anchor.y = y;
      y += v.scaledHeight + gap;
    }
    return;
  }

  const fw = front.scaledWidth;
  const fh = front.scaledHeight;
  // Front origin — leave room above for the top view (third-angle).
  const topH = views.top ? views.top.scaledHeight : 0;
  const frontX = margin + 4;
  const frontY = projection === 'third-angle'
    ? margin + (topH ? topH + gap : 0)
    : margin;
  front.anchor.x = frontX;
  front.anchor.y = frontY;

  if (views.top) {
    const t = views.top;
    // Top view shares the front view's X (both look along the world-X
    // axis as the horizontal screen axis), so they are vertically aligned.
    t.anchor.x = frontX;
    t.anchor.y = projection === 'third-angle'
      ? frontY - gap - t.scaledHeight   // ABOVE front
      : frontY + fh + gap;              // BELOW front (first-angle)
  }

  if (views.right) {
    const r = views.right;
    // Right view shares the front view's vertical screen axis (both map
    // worldZ → screenY) so they are horizontally aligned.
    r.anchor.y = frontY;
    r.anchor.x = projection === 'third-angle'
      ? frontX + fw + gap               // RIGHT of front
      : frontX - gap - r.scaledWidth;   // LEFT of front (first-angle)
  }

  if (views.iso) {
    const i = views.iso;
    // Iso always sits top-right (pictorial reference), regardless of angle.
    const rightEdge = views.right
      ? views.right.anchor.x + views.right.scaledWidth
      : frontX + fw;
    i.anchor.x = rightEdge + gap;
    i.anchor.y = margin;
  }
}

// ── nice-scale helpers ───────────────────────────────────────────────
const REDUCTIONS = [1, 1 / 2, 1 / 2.5, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500];
const ENLARGEMENTS = [2, 2.5, 5, 10];
function niceScale(fit) {
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  if (fit >= 1) {
    // Part fits at 1:1 or smaller than the area — enlarge to fill but never
    // exceed the area; pick the largest enlargement ≤ fit, else 1:1.
    let best = 1;
    for (const e of ENLARGEMENTS) { if (e <= fit) best = e; }
    return best;
  }
  // Reduction — pick the largest reduction ratio that still fits.
  let best = REDUCTIONS[REDUCTIONS.length - 1];
  for (const r of REDUCTIONS) { if (r <= fit) { best = r; break; } }
  return best;
}
function formatScale(s) {
  if (s >= 1) {
    // Enlargement n:1.
    const n = Math.round(s * 100) / 100;
    return `${Number.isInteger(n) ? n : n.toFixed(1)}:1`;
  }
  const inv = 1 / s;
  const n = Math.round(inv * 100) / 100;
  return `1:${Number.isInteger(n) ? n : n.toFixed(1)}`;
}

// ── auto-dimensioning ────────────────────────────────────────────────
/**
 * Derive + attach dimensions from the real part geometry.
 *
 * Overall extent:
 *   • WIDTH  (worldX) → linear dim on the FRONT view (or TOP), below it.
 *   • HEIGHT (worldY) → linear dim on the TOP view (or RIGHT), to its side.
 *   • DEPTH  (worldZ) → linear dim on the FRONT view (or RIGHT), to its side.
 * Holes (per view that shows a circular silhouette):
 *   • Ø<d> radial dim per detected hole.
 *   • hole-pitch linear dim between adjacent hole centres (≥2 holes).
 *
 * Witness lines are offset OUTSIDE each view's silhouette and parallel
 * dims are staggered (base + k·step) so nothing overlaps. Every value is
 * read from the projected bbox / detected circle — never typed.
 *
 * @returns {Array} flat list of `{kind, axis?, label, value, view, dim}`
 *   records; `dim` is the `DimensionLinear/Radial` object already pushed
 *   onto the owning `DrawingView`.
 */
export function autoDimension(views) {
  const out = [];
  const DIM_GAP = 10;     // mm — first dim offset outside the silhouette
  const DIM_STEP = 8;     // mm — stagger for parallel dims

  const bbOf = (dir) => (views[dir] ? bboxOfView(views[dir]._v2) : null);

  const front = views.front, top = views.top, right = views.right;
  const fbb = bbOf('front'), tbb = bbOf('top'), rbb = bbOf('right');

  // ----- WIDTH (worldX): front view, dim line BELOW the silhouette.
  if (front && fbb && fbb.width > 1e-6) {
    const y = fbb.minY - DIM_GAP;        // below (model-Y is up; renderer flips)
    const dim = DimensionLinear(
      [fbb.minX, y], [fbb.maxX, y], -DIM_GAP,
      { precision: 1 },
    );
    // The value MUST equal the real span, not the witness-offset length.
    dim.text = fbb.width.toFixed(1);
    front.addDimension(dim);
    out.push({ kind: 'linear', axis: 'X', label: 'width', value: fbb.width, view: 'front', dim });
  } else if (top && tbb && tbb.width > 1e-6) {
    const y = tbb.minY - DIM_GAP;
    const dim = DimensionLinear([tbb.minX, y], [tbb.maxX, y], -DIM_GAP, { precision: 1 });
    dim.text = tbb.width.toFixed(1);
    top.addDimension(dim);
    out.push({ kind: 'linear', axis: 'X', label: 'width', value: tbb.width, view: 'top', dim });
  }

  // ----- HEIGHT (worldY): top view screen-Y span, dim line to the LEFT.
  if (top && tbb && tbb.height > 1e-6) {
    const x = tbb.minX - DIM_GAP;
    const dim = DimensionLinear([x, tbb.minY], [x, tbb.maxY], DIM_GAP, { precision: 1 });
    dim.text = tbb.height.toFixed(1);
    top.addDimension(dim);
    out.push({ kind: 'linear', axis: 'Y', label: 'height', value: tbb.height, view: 'top', dim });
  } else if (right && rbb && rbb.width > 1e-6) {
    // On the right view, worldY is the screen-X span.
    const y = rbb.minY - DIM_GAP;
    const dim = DimensionLinear([rbb.minX, y], [rbb.maxX, y], -DIM_GAP, { precision: 1 });
    dim.text = rbb.width.toFixed(1);
    right.addDimension(dim);
    out.push({ kind: 'linear', axis: 'Y', label: 'height', value: rbb.width, view: 'right', dim });
  }

  // ----- DEPTH (worldZ): front view screen-Y span, dim line to the LEFT.
  if (front && fbb && fbb.height > 1e-6) {
    const x = fbb.minX - DIM_GAP;
    const dim = DimensionLinear([x, fbb.minY], [x, fbb.maxY], DIM_GAP, { precision: 1 });
    dim.text = fbb.height.toFixed(1);
    front.addDimension(dim);
    out.push({ kind: 'linear', axis: 'Z', label: 'depth', value: fbb.height, view: 'front', dim });
  } else if (right && rbb && rbb.height > 1e-6) {
    const x = rbb.minX - DIM_GAP;
    const dim = DimensionLinear([x, rbb.minY], [x, rbb.maxY], DIM_GAP, { precision: 1 });
    dim.text = rbb.height.toFixed(1);
    right.addDimension(dim);
    out.push({ kind: 'linear', axis: 'Z', label: 'depth', value: rbb.height, view: 'right', dim });
  }

  // ----- HOLES: detect on the most face-on ortho views.
  for (const dir of ORTHO_DIRS) {
    const view = views[dir];
    if (!view) continue;
    const holes = detectHoles(view._v2);
    if (!holes.length) continue;
    // sort deterministically (X then Y) for stable pitch pairing.
    const sorted = holes.slice().sort((a, b) => (a.cx - b.cx) || (a.cy - b.cy));
    for (let i = 0; i < sorted.length; i += 1) {
      const h = sorted[i];
      // Radial dim — leader out at 45°; Drawings.DimensionRadial labels "R..";
      // we override the text to the Ø form the part actually has.
      const dim = DimensionRadial([h.cx, h.cy], h.radius, Math.PI / 4, { precision: 1 });
      dim.text = `Ø${h.diameter.toFixed(1)}`;   // Ø20.0
      view.addDimension(dim);
      out.push({ kind: 'radial', label: dim.text, value: h.diameter, view: dir, dim, cx: h.cx, cy: h.cy });
    }
    // hole-pitch between adjacent centres.
    for (let i = 1; i < sorted.length; i += 1) {
      const a = sorted[i - 1], b = sorted[i];
      const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      if (!Number.isFinite(d) || d < 1e-6) continue;
      const dim = DimensionLinear([a.cx, a.cy], [b.cx, b.cy], DIM_GAP + DIM_STEP, { precision: 1 });
      dim.text = d.toFixed(1);
      view.addDimension(dim);
      out.push({ kind: 'linear', axis: 'pitch', label: 'hole-pitch', value: d, view: dir, dim });
    }
  }

  return out;
}

// ── GD&T from semantic PMI ───────────────────────────────────────────
/**
 * Read the part's semantic PMI (GD&T FCFs + datums) from the annotation
 * registry and place feature-control-frames as boxed decorations on the
 * best-matching view.
 *
 * Source: `listAnnotationsForBody(bodyId)` filtered to `kind:'gdt'`. The
 * FCF string is rendered by the canonical `annotationToText(a)` (e.g.
 * `[⊕|⌀0.1|A]`). The referenced datums get datum-flag glyphs.
 *
 * Task #45 (C) — EDGE-ANCHORED PMI (ISO 129-1 / ASME Y14.5):
 *   Every FCF carries an `anchor` to a SPECIFIC projected VISIBLE model
 *   edge or vertex. The annotation's 3D point (`a.anchor3d`/`a.anchor`, or
 *   — for a positional FCF with no explicit anchor — the relevant detected
 *   hole centre) is projected into each candidate view with the EXACT HLR
 *   convention (`project3dToView`); the view + 2D landing point are then
 *   chosen as the nearest VISIBLE-edge point (`nearestVisibleEdgePoint`).
 *   The leader is drawn to THAT point — never a guessed bbox corner, and
 *   never a hidden line (we scan `visibleEdges` only). The chosen view is
 *   decided by the geometry, not hardcoded to 'front'.
 *
 * @returns {Array} `{id, characteristic, fcf, datums, view, anchorEdge,
 *   anchorPoint}` records; each is also pushed onto the view's
 *   `decorations` for SVG emission.
 */
export function placeGdtFromPmi(views, bodyId, opts = {}) {
  const out = [];
  if (bodyId == null) return out;
  let anns = [];
  try { anns = listAnnotationsForBody(bodyId); } catch { anns = []; }
  const gdt = anns.filter((a) => a && a.kind === 'gdt');
  if (!gdt.length) return out;

  // Stack FCFs on the chosen view so multiple frames never overlap.
  const stackY = new Map();
  for (const a of gdt) {
    const p = a.payload || {};
    const datums = (p.datums || []).map((d) => d.ref).filter(Boolean);
    const fcf = annotationToText(a);    // e.g. "[⊕|⌀0.1|A|B]"

    // (C) Resolve a REAL edge anchor by geometry.
    const landing = resolveEdgeAnchor(a, views, opts);
    const dir = landing.dir;
    const view = views[dir] || views.front || firstView(views);
    if (!view) continue;
    const bb = view.bbox || { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const key = dir;
    const idx = stackY.get(key) || 0;
    stackY.set(key, idx + 1);
    // The FCF box sits OUTSIDE the silhouette (below the view), offset and
    // stacked; a real leader connects it to the landed edge point.
    const fx = bb.minX;
    const fy = bb.minY - 14 - idx * 7;   // model coords; renderer flips Y

    view.decorations = view.decorations || [];
    view.decorations.push({
      kind: 'gdt-fcf',
      text: fcf,
      x: fx,
      y: fy,
      datums,
      anchorX: landing.point[0],
      anchorY: landing.point[1],
    });
    out.push({
      id: a.id,
      characteristic: p.characteristic,
      fcf,
      datums,
      view: dir,
      // Edge-anchor provenance — proves the leader is bound to real
      // VISIBLE geometry, not floating (Task #45 (C) contract).
      anchorEdge: landing.edgeIndex,
      anchorKind: landing.kind,          // 'edge' | 'hole-center'
      anchorPoint: [landing.point[0], landing.point[1]],
      anchorOnHidden: false,             // by construction: we scan visibleEdges only
    });
  }
  return out;
}

// (C) Resolve a PMI annotation to a real projected VISIBLE edge/vertex.
//   Priority:
//     1) explicit per-annotation view hint (drawingView/viewId) restricts
//        the candidate view; otherwise all ortho views are candidates.
//     2) a 3D anchor (a.anchor3d, or a.anchor when it is a 3-vector) is
//        projected into each candidate view; the nearest VISIBLE-edge point
//        across all candidates wins.
//     3) a positional/coaxiality FCF with no 3D anchor binds to the nearest
//        detected HOLE CENTRE (its centre line) in a candidate view — a
//        position tolerance references a feature axis, so this is the
//        engineering-correct anchor.
//     4) fallback: the nearest visible-edge point to the view-bbox centre
//        (still a REAL edge, never a bare corner).
function resolveEdgeAnchor(a, views, opts) {
  const hint = (a && typeof a.drawingView === 'string' && views[a.drawingView]) ? a.drawingView
    : (a && typeof a.viewId === 'string' && views[a.viewId]) ? a.viewId
    : null;
  const dirs = hint ? [hint] : ORTHO_DIRS.filter((d) => views[d]);

  // (2) explicit 3D anchor.
  const anchor3d = pick3dAnchor(a);
  if (anchor3d) {
    let best = null;
    for (const dir of dirs) {
      const v2 = views[dir] && views[dir]._v2;
      if (!v2) continue;
      const p2 = project3dToView(anchor3d, dir);
      const hit = nearestVisibleEdgePoint(p2, v2);
      if (hit && (!best || hit.dist < best.dist)) {
        best = { dir, point: hit.point, edgeIndex: hit.edgeIndex, dist: hit.dist, kind: 'edge' };
      }
    }
    if (best) return best;
  }

  // (3) positional family → bind to a detected hole centre (feature axis).
  const ch = a && a.payload && a.payload.characteristic;
  const positional = ch === 'position' || ch === 'concentricity'
    || ch === 'symmetry' || ch === 'coaxiality' || ch === 'circularRunout'
    || ch === 'totalRunout' || ch === 'runout';
  if (positional) {
    for (const dir of dirs) {
      const v2 = views[dir] && views[dir]._v2;
      if (!v2) continue;
      const holes = detectHoles(v2);
      if (holes.length) {
        const h = holes[0];
        return { dir, point: [h.cx, h.cy], edgeIndex: h.edgeIndex, dist: 0, kind: 'hole-center' };
      }
    }
  }

  // (4) fallback — nearest visible edge to the candidate view's bbox centre.
  for (const dir of dirs) {
    const v2 = views[dir] && views[dir]._v2;
    if (!v2) continue;
    const bb = bboxOfView(v2);
    if (!bb) continue;
    const c = [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
    const hit = nearestVisibleEdgePoint(c, v2);
    if (hit) return { dir, point: hit.point, edgeIndex: hit.edgeIndex, dist: hit.dist, kind: 'edge' };
  }
  // Absolute last resort (degenerate view): front bbox min, still a coord.
  const fb = views.front ? bboxOfView(views.front._v2) : null;
  return { dir: views.front ? 'front' : (Object.keys(views)[0] || 'front'),
           point: fb ? [fb.minX, fb.minY] : [0, 0], edgeIndex: -1, dist: Infinity, kind: 'edge' };
}

// Extract a 3D anchor from an annotation if one is present.
//   a.anchor3d = [x,y,z]  — preferred (set by the PMI authoring UI).
//   a.anchor   = [x,y,z]  — accepted when it is a 3-vector (legacy callers
//                 sometimes stored sheet 2D here, so we require length 3).
function pick3dAnchor(a) {
  if (!a) return null;
  if (Array.isArray(a.anchor3d) && a.anchor3d.length >= 3
      && a.anchor3d.every((n) => Number.isFinite(n))) return a.anchor3d;
  if (Array.isArray(a.anchor) && a.anchor.length >= 3
      && a.anchor.every((n) => Number.isFinite(n))) return a.anchor;
  return null;
}

// (C) Find the nearest point ON a VISIBLE projected edge to a 2D query
// point. Returns the closest point (projected onto the nearest segment),
// the owning visible-edge polyline index, and the distance. HIDDEN edges
// are intentionally NOT scanned — a dimension/FCF must never anchor to a
// hidden line (ISO 129-1).
export function nearestVisibleEdgePoint(p2d, v2) {
  const edges = (v2 && Array.isArray(v2.visibleEdges)) ? v2.visibleEdges : [];
  let best = null;
  for (let ei = 0; ei < edges.length; ei += 1) {
    const pl = edges[ei];
    if (!Array.isArray(pl) || pl.length === 0) continue;
    for (let i = 0; i < pl.length; i += 1) {
      const a = pl[i];
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      // Vertex distance.
      const dv = Math.hypot(a.x - p2d[0], a.y - p2d[1]);
      if (!best || dv < best.dist) best = { point: [a.x, a.y], edgeIndex: ei, dist: dv };
      // Segment projection (a→b).
      const b = pl[i + 1];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      const abx = b.x - a.x, aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      if (len2 < 1e-12) continue;
      let t = ((p2d[0] - a.x) * abx + (p2d[1] - a.y) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + t * abx, qy = a.y + t * aby;
      const ds = Math.hypot(qx - p2d[0], qy - p2d[1]);
      if (!best || ds < best.dist) best = { point: [qx, qy], edgeIndex: ei, dist: ds };
    }
  }
  return best;
}

function firstView(views) {
  for (const dir of ALL_DIRS) if (views[dir]) return views[dir];
  return null;
}

// ── ISO 128 centre lines (long-short chain) for detected holes ───────
// A position FCF references a feature AXIS, so the hole gets a centre mark
// (ISO 128-24 long-short-long chain) crossing its centre. We emit it as a
// view decoration so the SVG splicer draws it with the others.
export function placeCenterMarks(views) {
  const out = [];
  for (const dir of ORTHO_DIRS) {
    const view = views[dir];
    if (!view || !view._v2) continue;
    const holes = detectHoles(view._v2);
    if (!holes.length) continue;
    view.decorations = view.decorations || [];
    for (const h of holes) {
      view.decorations.push({ kind: 'center-mark', cx: h.cx, cy: h.cy, r: h.radius });
      out.push({ view: dir, cx: h.cx, cy: h.cy, r: h.radius });
    }
  }
  return out;
}

// ── SVG decoration emission for GD&T (spliced into the sheet SVG) ────
//
// `ForgeDrawing.renderSvg` already renders `view.decorations` of kind
// 'detail-callout' / 'section-line'. Our 'gdt-fcf' decoration is a new
// kind it doesn't know, so we post-process the emitted SVG to inject the
// FCF boxes + datum flags. This keeps Drawings.js untouched (no new deps,
// no edits to shared code) while still producing ONE conformant sheet.
function gdtDecorationsSvg(views) {
  let frames = '';
  let centers = '';
  for (const dir of ALL_DIRS) {
    const view = views[dir];
    if (!view || !Array.isArray(view.decorations)) continue;
    for (const dec of view.decorations) {
      if (dec.kind === 'gdt-fcf') frames += renderFcfBox(dec, view);
      else if (dec.kind === 'center-mark') centers += renderCenterMark(dec, view);
    }
  }
  let out = '';
  if (centers) out += `<g data-label="center-lines">${centers}</g>`;
  if (frames) out += `<g data-label="gdt-pmi">${frames}</g>`;
  return out;
}

// ISO 128-24 centre line — long-short-long chain crossing a hole centre,
// extending one radius + 2 mm beyond the circle on each axis.
function renderCenterMark(dec, view) {
  const ext = dec.r + 2;                 // model mm beyond the circle edge
  const hMin = toSheet([dec.cx - ext, dec.cy], view);
  const hMax = toSheet([dec.cx + ext, dec.cy], view);
  const vMin = toSheet([dec.cx, dec.cy - ext], view);
  const vMax = toSheet([dec.cx, dec.cy + ext], view);
  // long-short chain dash: 4mm long, 1mm gap, 1mm short, 1mm gap (ISO 128).
  const dash = 'stroke-dasharray="4 1 1 1"';
  let s = `<line x1="${hMin[0].toFixed(2)}" y1="${hMin[1].toFixed(2)}" `
        + `x2="${hMax[0].toFixed(2)}" y2="${hMax[1].toFixed(2)}" `
        + `stroke="#000" stroke-width="0.25" ${dash}/>`;
  s += `<line x1="${vMin[0].toFixed(2)}" y1="${vMin[1].toFixed(2)}" `
     + `x2="${vMax[0].toFixed(2)}" y2="${vMax[1].toFixed(2)}" `
     + `stroke="#000" stroke-width="0.25" ${dash}/>`;
  return s;
}

// Transform a view-local model point → sheet SVG coords (mirrors the
// private transformPoint in Drawings.js: anchor + scaled + Y-flip).
function toSheet(p, view) {
  const ax = view.anchor.x, ay = view.anchor.y;
  const { minX, minY, maxY } = view.bbox;
  const flippedH = (maxY - minY) * view.scale;
  const lx = (p[0] - minX) * view.scale;
  const ly = (p[1] - minY) * view.scale;
  return [ax + lx, ay + (flippedH - ly)];
}

function renderFcfBox(dec, view) {
  const [bx, by] = toSheet([dec.x, dec.y], view);
  const text = dec.text || '';
  // Width scales with text length (monospace-ish FCF box).
  const w = Math.max(16, text.length * 1.9);
  const h = 5.5;
  let s = `<rect x="${bx.toFixed(2)}" y="${(by - h + 1).toFixed(2)}" `
        + `width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="#fff" `
        + `stroke="#000" stroke-width="0.4"/>`;
  s += `<text x="${(bx + 1).toFixed(2)}" y="${(by - 1).toFixed(2)}" `
     + `font-family="Helvetica, Arial, sans-serif" font-size="3.2" fill="#000">`
     + `${escapeXml(text)}</text>`;
  // Leader from the FCF box to the annotated feature anchor.
  const [ax, ay] = toSheet([dec.anchorX, dec.anchorY], view);
  s += `<line x1="${bx.toFixed(2)}" y1="${(by - h + 1).toFixed(2)}" `
     + `x2="${ax.toFixed(2)}" y2="${ay.toFixed(2)}" stroke="#000" stroke-width="0.25"/>`;
  // Datum flags for the referenced datums.
  let dy = by + 2;
  for (const ref of (dec.datums || [])) {
    s += `<g data-label="datum-flag">`
       + `<rect x="${bx.toFixed(2)}" y="${dy.toFixed(2)}" width="5" height="5" `
       + `fill="#fff" stroke="#000" stroke-width="0.4"/>`
       + `<text x="${(bx + 2.5).toFixed(2)}" y="${(dy + 3.6).toFixed(2)}" `
       + `font-family="Helvetica, Arial, sans-serif" font-size="3.4" `
       + `fill="#000" text-anchor="middle">${escapeXml(ref)}</text></g>`;
    dy += 6;
  }
  return s;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

// Splice the GD&T <g> into the sheet SVG just before </svg> so it overlays
// the views + dims without disturbing the conformant structure.
function injectGdt(svg, views) {
  const gdt = gdtDecorationsSvg(views);
  if (!gdt) return svg;
  const close = svg.lastIndexOf('</svg>');
  if (close < 0) return svg + gdt;
  return svg.slice(0, close) + gdt + svg.slice(close);
}

// ════════════════════════════════════════════════════════════════════
// Task #45 (A) — SECTION VIEWS  (ASME Y14.2 / ISO 128-50)
// ════════════════════════════════════════════════════════════════════
//
// A section reuses the kernel's REAL planar cut: `projectSection` returns
// `cut` (the heavy section-boundary polylines from solid ∩ plane) and
// `hatch` (thin lines at the requested angle, UNIFORM spacing — verified
// against the native kernel: gapRange min==max==spacing, angle exact).
// We:
//   • scale the hatch SPACING to the sectioned area (ISO 128-50: denser
//     hatch on small cut faces, coarser on large ones),
//   • assign DISTINCT angles per body in a multi-body section so adjacent
//     solids are visually separable (45 / 135 / 30 / 60 / 15 / 120…),
//   • draw the cutting-plane chain-line + 'SECTION A-A' on the parent view
//     (the kernel's `addSectionView` paints the Y14.2 callout),
//   • pin the section view in a free sheet slot (right of the iso column).

// Cycle of hatch angles for multi-body sections (ISO 128-50 "adjacent
// parts at different angles"). 45° is the canonical single-body angle.
export const HATCH_ANGLE_CYCLE = Object.freeze([45, 135, 30, 60, 15, 120, 75, 105]);

// ISO 128-50 area-scaled hatch spacing: spacing = clamp(sqrt(area)/K).
// Small cut faces get tight hatch (≥1.5 mm), large ones coarser (≤6 mm).
export function hatchSpacingForArea(bbox) {
  if (!bbox) return 2.5;
  const w = Math.max(0, (bbox.maxX - bbox.minX));
  const h = Math.max(0, (bbox.maxY - bbox.minY));
  const area = w * h;
  if (!(area > 0)) return 2.5;
  const K = 12;
  const s = Math.sqrt(area) / K;
  return Math.max(1.5, Math.min(6, s));
}

/**
 * (A) Place a section view on a placed-drawing.
 *
 * @param {object} placed   the `placeStandardViews` result `{drawing, views, v2}`
 * @param {object} part     `{ shape }` (single body) OR `{ bodies:[{shape},…] }`
 *                          for a multi-body section (distinct hatch angles).
 * @param {object} cuttingPlane  `{ origin:[x,y,z], normal:[x,y,z] }`
 * @param {object} [opts]
 *   `parentDir`  view the cutting-plane callout is drawn on (default 'front')
 *   `direction`  projection direction of the section (default 'front')
 *   `scale`      section view scale (default the sheet scale)
 *   `hatchSpacing` override the area-scaled spacing
 *   `hatchAngle`   override the base angle (single-body)
 * @returns {{ view:SectionView, letter:string, parentDir:string,
 *             hatch:Array<{angleDeg, spacing, count}>, extraViews:Array }}
 */
export function placeSectionView(placed, part, cuttingPlane, opts = {}) {
  if (!placed || !placed.drawing) throw new Error('placeSectionView: placed drawing required');
  if (!cuttingPlane || !Array.isArray(cuttingPlane.origin) || !Array.isArray(cuttingPlane.normal)) {
    throw new Error('placeSectionView: cuttingPlane {origin:[x,y,z], normal:[x,y,z]} required');
  }
  const { drawing, views } = placed;
  const parentDir = (opts.parentDir && views[opts.parentDir]) ? opts.parentDir : 'front';
  const parentView = views[parentDir] || views.front || firstView(views);
  const direction = opts.direction || 'front';
  const scale = opts.scale || placed.scale || 1;

  // Resolve bodies — single shape or an explicit multi-body list.
  const bodies = Array.isArray(part && part.bodies) && part.bodies.length
    ? part.bodies
    : [{ shape: part.shape }];

  const hatchReport = [];
  const extraViews = [];
  let primary = null;

  for (let bi = 0; bi < bodies.length; bi += 1) {
    const body = bodies[bi];
    if (body == null || body.shape == null) continue;
    // First pass: a probe projection to size the cut bbox so the spacing
    // scales to the actual sectioned area (ISO 128-50).
    const probe = drawingsProjectSection(body.shape, direction, cuttingPlane, {
      spacing: 2.5, angleDeg: HATCH_ANGLE_CYCLE[bi % HATCH_ANGLE_CYCLE.length],
    });
    const cutBbox = cutBboxOf(probe);
    const spacing = opts.hatchSpacing != null ? opts.hatchSpacing : hatchSpacingForArea(cutBbox);
    const angleDeg = bodies.length > 1
      ? HATCH_ANGLE_CYCLE[bi % HATCH_ANGLE_CYCLE.length]
      : (opts.hatchAngle != null ? opts.hatchAngle : 45);

    const sec = drawing.addSectionView({
      shape: body.shape,
      sectionPlane: { origin: cuttingPlane.origin, normal: cuttingPlane.normal },
      hatchSpec: { spacing, angleDeg },
      direction,
      scale,
      parentView: bi === 0 ? parentView : null,   // callout once per section
    });
    sec.anchor.fixed = true;
    hatchReport.push({ body: bi, angleDeg, spacing, count: sec.projection.hatchCount || 0,
                       cutCount: sec.projection.cutCount || 0 });
    if (bi === 0) primary = sec; else extraViews.push(sec);
  }

  if (!primary) throw new Error('placeSectionView: no body produced a section');

  // Pin the section in a free slot: below the iso / right of the views.
  layoutSectionSlot(primary, views, { gap: opts.gap || 18, margin: opts.margin || 20 });
  // Stack any extra-body sections beside the primary so the multi-body cut
  // reads as ONE composite section (same anchor area, layered geometry).
  for (const ev of extraViews) {
    ev.anchor.x = primary.anchor.x;
    ev.anchor.y = primary.anchor.y;
  }

  return {
    view: primary,
    letter: primary.sectionLetter,
    label: primary.label,
    parentDir,
    hatch: hatchReport,
    extraViews,
  };
}

// Project a section through the engine's resolved kernel.
function drawingsProjectSection(shape, direction, plane, hatch) {
  const k = kernel();
  if (!k || !k.drawings || typeof k.drawings.projectSection !== 'function') {
    throw new Error('projectSection unavailable on kernel');
  }
  const dirArg = typeof direction === 'string' ? direction : Float64Array.from(direction);
  return k.drawings.projectSection(shape, dirArg, {
    origin: plane.origin, normal: plane.normal,
  }, { spacing: hatch.spacing ?? 2.5, angleDeg: hatch.angleDeg ?? 45 });
}

// Bbox over a flat-packed section projection's cut + visible buckets.
function cutBboxOf(proj) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (flat) => {
    if (!flat) return;
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i], y = flat[i + 1];
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  };
  eat(proj && proj.cut); eat(proj && proj.visible);
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// Pin a section/detail view in a free sheet slot to the right of the
// existing ortho group (below the iso), so it never overlaps the views.
function layoutSectionSlot(view, views, { gap, margin }) {
  let rightEdge = margin;
  let bottomEdge = margin;
  for (const dir of ALL_DIRS) {
    const v = views[dir];
    if (!v) continue;
    rightEdge = Math.max(rightEdge, v.anchor.x + v.scaledWidth);
    bottomEdge = Math.max(bottomEdge, v.anchor.y + v.scaledHeight);
  }
  // Place below the tallest existing view, left-aligned to the front view.
  const front = views.front;
  view.anchor.x = (front ? front.anchor.x : margin);
  view.anchor.y = bottomEdge + gap + 6;   // +6 leaves room for the label
}

// ════════════════════════════════════════════════════════════════════
// Task #45 (B) — DETAIL VIEWS  (ASME Y14.3)
// ════════════════════════════════════════════════════════════════════
//
// A detail view: the kernel's `addDetailView` draws the dashed focus
// circle + letter on the SOURCE view (a 'detail-callout' decoration the
// kernel renders) and emits the enlarged, pre-scaled detail view labelled
// 'DETAIL <L> (<scale>:1)'. We pin the enlarged view in a free slot.

/**
 * (B) Place a detail view.
 *
 * @param {object} placed   `placeStandardViews` result
 * @param {object} part     `{ shape }`
 * @param {string} sourceDir  the view the detail circle is drawn on
 * @param {object} focusCircle  `{ x, y, r }` in the source view's local
 *                  model coords (same frame as that view's projection)
 * @param {number} [scale=2]  enlargement factor (2:1, 4:1…)
 * @returns {{ view:DetailView, letter:string, label:string, sourceDir, focusCircle }}
 */
export function placeDetailView(placed, part, sourceDir, focusCircle, scale = 2) {
  if (!placed || !placed.drawing) throw new Error('placeDetailView: placed drawing required');
  if (!focusCircle || !Number.isFinite(focusCircle.x) || !Number.isFinite(focusCircle.y)
      || !Number.isFinite(focusCircle.r)) {
    throw new Error('placeDetailView: focusCircle {x,y,r} required');
  }
  const { drawing, views } = placed;
  const src = (sourceDir && views[sourceDir]) ? sourceDir : 'front';
  const parentView = views[src] || views.front || firstView(views);
  const direction = src === 'iso' ? 'front' : src;

  const view = drawing.addDetailView({
    shape: part.shape,
    focusCircle: { x: focusCircle.x, y: focusCircle.y, r: focusCircle.r },
    scale,
    direction,
    parentView,
  });
  view.anchor.fixed = true;
  layoutSectionSlot(view, views, { gap: 18, margin: 20 });
  // Nudge the detail to the right of any section already in that slot.
  view.anchor.x = (parentView ? parentView.anchor.x : 20) + parentView.scaledWidth + 40;

  return {
    view,
    letter: view.detailLetter,
    label: view.label,
    sourceDir: src,
    focusCircle: { x: focusCircle.x, y: focusCircle.y, r: focusCircle.r },
    scale,
  };
}

// ════════════════════════════════════════════════════════════════════
// Task #45 (D) — BALLOONS ↔ BOM  (ASME Y14.34)
// ════════════════════════════════════════════════════════════════════
//
// Each balloon's item number maps 1:1 to a BOM table row. The BOM is built
// from the assembly instance list (deduplicated by partNumber → qty); each
// distinct part is one row + one item number, and a balloon with that
// number leads to ONE representative instance on the chosen view.

/**
 * (D) Build an ordered BOM from an assembly instance list.
 *
 * @param {Array} assembly  `[{ partNumber, name?, description?, qty?,
 *                  anchor?:[x,y,z] | anchor2d?:[x,y], view? }, …]`
 *   Instances sharing a `partNumber` collapse to one row (qty summed).
 * @returns {{ rows:Array<{item, partNumber, description, qty}>,
 *             itemOf:Map<string,number> }}
 */
export function buildBom(assembly) {
  const list = Array.isArray(assembly) ? assembly : [];
  const order = [];
  const byPn = new Map();
  for (const inst of list) {
    if (!inst) continue;
    const pn = String(inst.partNumber ?? inst.name ?? '').trim() || 'UNNAMED';
    if (!byPn.has(pn)) {
      byPn.set(pn, {
        partNumber: pn,
        description: inst.description || inst.name || pn,
        qty: 0,
      });
      order.push(pn);
    }
    const row = byPn.get(pn);
    row.qty += Number.isFinite(inst.qty) ? inst.qty : 1;
  }
  const rows = [];
  const itemOf = new Map();
  order.forEach((pn, i) => {
    const r = byPn.get(pn);
    const item = i + 1;                  // 1..N
    itemOf.set(pn, item);
    rows.push({ item, partNumber: r.partNumber, description: r.description, qty: r.qty });
  });
  return { rows, itemOf };
}

/**
 * (D) Place balloons on a placed-drawing whose numbers are 1:1 with the
 * BOM rows, each with a leader to a representative instance of that part.
 *
 * @param {object} placed
 * @param {Array}  assembly  same as buildBom
 * @param {object} [bom]     a prebuilt buildBom result (else built here)
 * @returns {{ bom, balloons:Array<{item, partNumber, view, anchor2d}> }}
 */
export function placeBomBalloons(placed, assembly, bom = null) {
  const { views } = placed;
  const built = bom || buildBom(assembly);
  const { itemOf } = built;
  const list = Array.isArray(assembly) ? assembly : [];

  // One representative instance per part number → one balloon.
  const repByPn = new Map();
  for (const inst of list) {
    if (!inst) continue;
    const pn = String(inst.partNumber ?? inst.name ?? '').trim() || 'UNNAMED';
    if (!repByPn.has(pn)) repByPn.set(pn, inst);
  }

  const placedBalloons = [];
  // Distribute balloons around the view to avoid overlap (the kernel's
  // renderBalloons additionally nudges any residual collisions).
  let k = 0;
  for (const [pn, inst] of repByPn) {
    const item = itemOf.get(pn);
    if (item == null) continue;
    const dir = (inst.view && views[inst.view]) ? inst.view
      : (views.iso ? 'iso' : (views.front ? 'front' : firstView(views) && firstView(views)._dir));
    const view = views[dir] || views.front || firstView(views);
    if (!view) continue;
    // Anchor: explicit 2D, else projected 3D, else view-bbox centroid.
    let anchor2d = null;
    if (Array.isArray(inst.anchor2d) && inst.anchor2d.length >= 2) {
      anchor2d = [inst.anchor2d[0], inst.anchor2d[1]];
    } else if (Array.isArray(inst.anchor) && inst.anchor.length >= 3) {
      anchor2d = project3dToView(inst.anchor, dir === 'iso' ? 'front' : dir);
    } else {
      const bb = view.bbox || { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      anchor2d = [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
    }
    // Balloon sits offset radially outward; angle spread by index.
    const bb = view.bbox || { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) || 20;
    const ang = (k / Math.max(1, repByPn.size)) * Math.PI * 2;
    const off = span * 0.7 + 8;
    const balloonAt = [anchor2d[0] + Math.cos(ang) * off, anchor2d[1] + Math.sin(ang) * off];
    view.addBalloon(Balloon({ anchor: anchor2d, balloonAt, number: item, radius: 3.2 }));
    placedBalloons.push({ item, partNumber: pn, view: dir, anchor2d, balloonAt });
    k += 1;
  }
  return { bom: built, balloons: placedBalloons };
}

// (D) BOM table SVG — inline (no new deps), spliced near the title block.
// Columns: ITEM | PART NO | DESCRIPTION | QTY (ASME Y14.34 field order).
function bomTableSvg(bom, sheet) {
  const rows = (bom && bom.rows) || [];
  if (!rows.length) return '';
  const colW = [14, 40, 70, 14];          // mm per column
  const tableW = colW.reduce((a, b) => a + b, 0);
  const rowH = 6;
  const headH = 6;
  // Sit the table ABOVE the title block (bottom-right), growing upward.
  const x = sheet.w - 10 - tableW;
  const tbH = 40;                          // title-block height in Drawings.js
  const baseY = sheet.h - 10 - tbH - 4;    // just above the title block
  const totalH = headH + rows.length * rowH;
  const top = baseY - totalH;
  const headers = ['ITEM', 'PART NO', 'DESCRIPTION', 'QTY'];

  let s = `<g data-label="bom-table">`;
  // Outer + header.
  s += `<rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${tableW.toFixed(2)}" `
     + `height="${totalH.toFixed(2)}" fill="#fff" stroke="#000" stroke-width="0.4"/>`;
  // Column separators.
  let cx = x;
  for (let i = 0; i < colW.length - 1; i += 1) {
    cx += colW[i];
    s += `<line x1="${cx.toFixed(2)}" y1="${top.toFixed(2)}" x2="${cx.toFixed(2)}" `
       + `y2="${(top + totalH).toFixed(2)}" stroke="#000" stroke-width="0.3"/>`;
  }
  // Header row text.
  let hx = x;
  for (let i = 0; i < headers.length; i += 1) {
    s += `<text x="${(hx + 2).toFixed(2)}" y="${(top + 4.2).toFixed(2)}" `
       + `font-family="Helvetica, Arial, sans-serif" font-size="3" font-weight="bold" `
       + `fill="#000">${escapeXml(headers[i])}</text>`;
    hx += colW[i];
  }
  s += `<line x1="${x.toFixed(2)}" y1="${(top + headH).toFixed(2)}" `
     + `x2="${(x + tableW).toFixed(2)}" y2="${(top + headH).toFixed(2)}" `
     + `stroke="#000" stroke-width="0.4"/>`;
  // Data rows.
  rows.forEach((r, ri) => {
    const ry = top + headH + ri * rowH;
    if (ri > 0) {
      s += `<line x1="${x.toFixed(2)}" y1="${ry.toFixed(2)}" x2="${(x + tableW).toFixed(2)}" `
         + `y2="${ry.toFixed(2)}" stroke="#000" stroke-width="0.2"/>`;
    }
    const cells = [String(r.item), r.partNumber, r.description, String(r.qty)];
    let dx = x;
    for (let ci = 0; ci < cells.length; ci += 1) {
      s += `<text x="${(dx + 2).toFixed(2)}" y="${(ry + 4.2).toFixed(2)}" `
         + `font-family="Helvetica, Arial, sans-serif" font-size="2.8" fill="#000" `
         + `data-bom-item="${r.item}">${escapeXml(cells[ci])}</text>`;
      dx += colW[ci];
    }
  });
  s += `</g>`;
  return s;
}

function injectBom(svg, bom, sheet) {
  const tbl = bomTableSvg(bom, sheet);
  if (!tbl) return svg;
  const close = svg.lastIndexOf('</svg>');
  if (close < 0) return svg + tbl;
  return svg.slice(0, close) + tbl + svg.slice(close);
}

// ── ASME Y14.3 / ISO 5456 projection-symbol glyph (truncated cone) ───
// Drawn near the title block so the sheet declares its projection method.
function projectionSymbolSvg(projection, sheet) {
  const tbH = 40, tbW = 80;
  // Sit just left of the title block, vertically centred.
  const x = sheet.w - 10 - tbW - 26;
  const y = sheet.h - 10 - tbH / 2;
  // Two concentric circles (the frustum's small/large ends) + the cone
  // outline; third-angle puts the small circle on the LEFT, first-angle on
  // the RIGHT (the standard distinguishing convention).
  const r1 = 3.2, r2 = 5.0;
  const third = projection !== 'first-angle';
  const cxBig = third ? x + 14 : x + 4;
  const cxSm = third ? x + 4 : x + 14;
  let s = `<g data-label="projection-symbol" data-projection="${projection}">`;
  // Cone trapezoid.
  s += `<polygon points="${(cxSm).toFixed(2)},${(y - r1).toFixed(2)} `
     + `${(cxBig).toFixed(2)},${(y - r2).toFixed(2)} ${(cxBig).toFixed(2)},${(y + r2).toFixed(2)} `
     + `${(cxSm).toFixed(2)},${(y + r1).toFixed(2)}" fill="none" stroke="#000" stroke-width="0.35"/>`;
  s += `<circle cx="${cxBig.toFixed(2)}" cy="${y.toFixed(2)}" r="${r2.toFixed(2)}" `
     + `fill="none" stroke="#000" stroke-width="0.35"/>`;
  s += `<circle cx="${cxSm.toFixed(2)}" cy="${y.toFixed(2)}" r="${r1.toFixed(2)}" `
     + `fill="none" stroke="#000" stroke-width="0.35"/>`;
  s += `</g>`;
  return s;
}

function injectProjectionSymbol(svg, projection, sheet) {
  const sym = projectionSymbolSvg(projection, sheet);
  const close = svg.lastIndexOf('</svg>');
  if (close < 0) return svg + sym;
  return svg.slice(0, close) + sym + svg.slice(close);
}

// ── DXF bonus (kernel emitDXF over the V2 views) ─────────────────────
function emitDxf(v2, dims) {
  const k = kernel();
  if (!k || !k.drawings || typeof k.drawings.emitDXF !== 'function') return null;
  const viewObjs = ALL_DIRS.map((d) => v2[d]).filter(Boolean);
  // dim pairs: [[a,b],…] in model coords for the linear dims we placed.
  const dimPairs = [];
  for (const d of (dims || [])) {
    if (d.kind === 'linear' && d.dim && d.dim.geometry) {
      const pls = d.dim.geometry.polylines;
      const line = pls[pls.length - 1];     // dimension line proper
      if (line && line.length >= 2) dimPairs.push([line[0], line[line.length - 1]]);
    }
  }
  try { return k.drawings.emitDXF(viewObjs, dimPairs); }
  catch { return null; }
}

// ── top-level: generate a full drawing ───────────────────────────────
/**
 * Generate a complete Y14.5 drawing for `part`.
 *
 * @param {object} part  `{ shape:<handle>, bodyId?, kind?, params?, title? }`
 * @param {object} [opts]
 *   `projection` 'third-angle' (default) | 'first-angle'
 *   `sheet`      'A4'|'A3'(default)|'A2'|'A1'|'A0'|'A'|'B'|'C'|'D'|'E'
 *   `orientation` 'landscape' (default) | 'portrait'
 *   `pmi`        place GD&T from PMI (default true)
 *   `title`      title-block label
 *   `dxf`        also emit DXF (default false)
 *   `sections`   Array<{ plane:{origin,normal}, parentDir?, direction?,
 *                scale?, hatchSpacing?, hatchAngle?, bodies?:[{shape}] }>
 *                — Task #45 (A) auto-placed section views.
 *   `details`    Array<{ sourceDir, center:[x,y], radius, scale? }>
 *                — Task #45 (B) auto-placed detail views.
 *   `assembly`   Array<{ partNumber, qty?, anchor?/anchor2d?, view?, … }>
 *                — Task #45 (D) BOM + 1:1 balloons.
 * @returns {object} drawing result (see fields below).
 */
export function generateDrawing(part, opts = {}) {
  if (!part || part.shape == null) {
    throw new Error('generateDrawing: part.shape (kernel handle) required');
  }
  const projection = opts.projection === 'first-angle' ? 'first-angle' : 'third-angle';
  const sheet = opts.sheet || 'A3';
  const orientation = opts.orientation || 'landscape';
  const pmi = opts.pmi !== false;
  const title = opts.title || part.title || 'PART DRAWING';

  const placed = placeStandardViews(part.shape, {
    projection, sheet, orientation, title,
    titleBlock: opts.titleBlock,
  });
  const { drawing, views } = placed;

  const dimensions = autoDimension(views);
  // ISO-128 centre marks for detected holes (referenced by position FCFs).
  const centerMarks = placeCenterMarks(views);
  const gdt = pmi ? placeGdtFromPmi(views, part.bodyId, opts) : [];

  // (A) Section views.
  const sections = [];
  for (const spec of (Array.isArray(opts.sections) ? opts.sections : [])) {
    if (!spec || !spec.plane) continue;
    const secPart = spec.bodies ? { bodies: spec.bodies } : { shape: part.shape };
    const sv = placeSectionView(placed, secPart, spec.plane, {
      parentDir: spec.parentDir, direction: spec.direction, scale: spec.scale,
      hatchSpacing: spec.hatchSpacing, hatchAngle: spec.hatchAngle,
    });
    sections.push({
      letter: sv.letter, label: sv.label, parentDir: sv.parentDir,
      hatch: sv.hatch,
    });
  }

  // (B) Detail views.
  const details = [];
  for (const spec of (Array.isArray(opts.details) ? opts.details : [])) {
    if (!spec || !Array.isArray(spec.center)) continue;
    const dv = placeDetailView(placed, { shape: part.shape }, spec.sourceDir,
      { x: spec.center[0], y: spec.center[1], r: spec.radius }, spec.scale || 2);
    details.push({ letter: dv.letter, label: dv.label, sourceDir: dv.sourceDir,
                   focusCircle: dv.focusCircle, scale: dv.scale });
  }

  // (D) BOM + balloons.
  let bomResult = null;
  if (Array.isArray(opts.assembly) && opts.assembly.length) {
    bomResult = placeBomBalloons(placed, opts.assembly);
  }

  // Render the conformant sheet (border + title block + views + dims +
  // sections/details/balloons the kernel already knows), then splice in the
  // GD&T + centre lines + BOM table + projection symbol.
  let svg = drawing.toSvg(sheet, orientation, {
    titleBlock: SHEET_TO_TEMPLATE[sheet] || null,
    titleBlockFields: {
      title,
      ...(opts.titleBlockFields || {}),
    },
  });
  svg = injectGdt(svg, views);
  const sheetMm = getSheetMm(sheet, orientation);
  if (bomResult) svg = injectBom(svg, bomResult.bom, sheetMm);
  svg = injectProjectionSymbol(svg, projection, sheetMm);

  const dxf = opts.dxf ? emitDxf(placed.v2, dimensions) : null;

  // Self-describing recipe so `regenerate` can reflow the SAME sheet
  // composition for an arbitrary changed part (Task #45 (E)).
  const recipe = {
    sections: Array.isArray(opts.sections) ? opts.sections : [],
    details: Array.isArray(opts.details) ? opts.details : [],
    assembly: Array.isArray(opts.assembly) ? opts.assembly : [],
    projection, sheet, orientation, pmi,
  };

  return {
    sheetModel: drawing,
    svg,
    dxf,
    views: ALL_DIRS.filter((d) => views[d]).map((d) => ({
      dir: d,
      label: views[d].label,
      visibleEdges: placed.v2[d].visibleEdges.length,
      hiddenEdges: placed.v2[d].hiddenEdges.length,
      bbox: placed.v2[d].bbox,
    })),
    dimensions: dimensions.map((d) => ({
      kind: d.kind, axis: d.axis, label: d.label, value: d.value, view: d.view,
      text: d.dim ? d.dim.text : undefined,
    })),
    gdt,
    centerMarks,
    sections,
    details,
    bom: bomResult ? bomResult.bom.rows : [],
    balloons: bomResult ? bomResult.balloons : [],
    scale: placed.scale,
    projection,
    recipe,
    placed,
    part: { shape: part.shape, bodyId: part.bodyId ?? null, kind: part.kind ?? null, params: part.params ?? null },
  };
}

// Map sheet size → a TitleBlocks.js template name (they share the A0-E +
// ANSI ids). Unknown → use ForgeDrawing's built-in stub title block.
const SHEET_TO_TEMPLATE = Object.freeze({
  A0: 'A0', A1: 'A1', A2: 'A2', A3: 'A3', A4: 'A4',
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E',
});

// ── parametric regenerate (the killer gap) ───────────────────────────
/**
 * Rebuild a part's kernel handle from its `{kind, params}` recipe with
 * `changes` applied, then regenerate the whole drawing. The dimension
 * VALUES change because they are re-derived from the new geometry — the
 * drawing is never a stale manual artefact.
 *
 * TWO MODES (Task #45 (E) extends the recipe-only #27 path):
 *   1) RECIPE   — `part.kind` + `part.params` → `rebuildShape(kind, params)`
 *                  with `changes` applied (box / cylinder / plate-hole).
 *   2) ARBITRARY — `part.shape` is a LIVE kernel handle of any geometry
 *                  (no recipe). Pass the changed handle directly; the whole
 *                  sheet — views, dims, sections, details, balloons — reflows
 *                  from the new geometry. Use `regenerate()` for this mode
 *                  with the prior drawing result, which carries `recipe`
 *                  (the section/detail/assembly composition) so the SAME
 *                  composition is re-emitted against the new part.
 *
 * @param {object} part   `{ shape, bodyId?, kind, params }`
 * @param {object} changes  param overrides, e.g. `{ dx: 120 }`
 * @param {object} [opts]  same as generateDrawing
 * @returns {object} the generateDrawing result for the rebuilt part.
 */
export function regenerateDrawing(part, changes = {}, opts = {}) {
  if (part && part.kind) {
    const params = { ...(part.params || {}), ...changes };
    const newShape = rebuildShape(part.kind, params);
    const newPart = { ...part, shape: newShape, params };
    return generateDrawing(newPart, opts);
  }
  // Arbitrary-handle mode: a live changed shape, no recipe.
  if (part && part.shape != null) {
    return generateDrawing(part, opts);
  }
  throw new Error('regenerateDrawing: either {kind, params} recipe or a live {shape} handle required');
}

/**
 * (E) Regenerate a drawing for an ARBITRARY changed part.
 *
 * Accepts a prior `generateDrawing` result (which carries `recipe` — the
 * section/detail/assembly composition + sheet opts) and an updated part
 * (a live kernel handle of any geometry — no recipe needed), and re-derives
 * the ENTIRE sheet (views + dims + every recorded section + every recorded
 * detail + PMI edge anchors + BOM balloons) so the drawing tracks the new
 * geometry parametrically. The dimension VALUES change because they are
 * re-projected from the new shape, never edited as text.
 *
 * @param {object} drawing     a prior generateDrawing result (for `recipe`)
 * @param {object} updatedPart `{ shape:<live handle>, bodyId?, title? }`
 * @param {object} [opts]      overrides merged over the recorded recipe
 * @returns {object} the regenerated generateDrawing result.
 */
export function regenerate(drawing, updatedPart, opts = {}) {
  if (!updatedPart || updatedPart.shape == null) {
    throw new Error('regenerate: updatedPart.shape (live kernel handle) required');
  }
  const recipe = (drawing && drawing.recipe) || {};
  const merged = {
    projection: recipe.projection,
    sheet: recipe.sheet,
    orientation: recipe.orientation,
    pmi: recipe.pmi,
    sections: recipe.sections || [],
    details: recipe.details || [],
    assembly: recipe.assembly || [],
    ...opts,                                 // explicit opts win
  };
  const part = {
    shape: updatedPart.shape,
    bodyId: updatedPart.bodyId ?? (drawing && drawing.part && drawing.part.bodyId) ?? null,
    title: updatedPart.title ?? (drawing && drawing.sheetModel && drawing.sheetModel.title),
  };
  return generateDrawing(part, merged);
}

/** Build a kernel handle from a `{kind, params}` recipe. */
export function rebuildShape(kind, params = {}) {
  const k = kernel();
  switch (kind) {
    case 'box': {
      const { dx = 10, dy = 10, dz = 10 } = params;
      return k.makeBox(dx, dy, dz);
    }
    case 'cylinder': {
      const { radius = 5, height = 10 } = params;
      return k.makeCylinder(radius, height);
    }
    case 'plate-hole': {
      const { dx = 80, dy = 60, dz = 12, holeR = 10, holeX = null, holeY = null } = params;
      const box = k.makeBox(dx, dy, dz);
      const cyl = k.makeCylinder(holeR, dz * 3);
      const cx = holeX == null ? dx / 2 : holeX;
      const cy = holeY == null ? dy / 2 : holeY;
      const tcyl = k.translate(cyl, cx, cy, -dz);
      return k.cut(box, tcyl);
    }
    default:
      throw new Error(`rebuildShape: unsupported recipe kind '${kind}'`);
  }
}

export default {
  generateDrawing,
  regenerateDrawing,
  regenerate,
  placeStandardViews,
  autoDimension,
  placeGdtFromPmi,
  placeCenterMarks,
  placeSectionView,
  placeDetailView,
  buildBom,
  placeBomBalloons,
  hatchSpacingForArea,
  nearestVisibleEdgePoint,
  project3dToView,
  rebuildShape,
  projectView,
  v2ToFlatProjection,
  setForgeKernel,
  HATCH_ANGLE_CYCLE,
  ORTHO_DIRS,
  ALL_DIRS,
};
