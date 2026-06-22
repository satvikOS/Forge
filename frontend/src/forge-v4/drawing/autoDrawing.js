/**
 * ArchDisc Forge — AUTO-2D-DRAWING engine (Task #27).
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
  DimensionLinear,
  DimensionRadial,
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
 * HONEST SCOPE: PMI→view-feature binding is anchor/faceTag heuristic
 * (exact subshape↔view-edge binding is a follow-up). We place on the
 * front view when no anchor hint resolves — never fabricate a feature.
 *
 * @returns {Array} `{id, characteristic, fcf, datums, view}` records;
 *   each is also pushed onto the view's `decorations` for SVG emission.
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
    const dir = pickViewForAnnotation(a, views, opts);
    const view = views[dir] || views.front || firstView(views);
    if (!view) continue;
    const fcf = annotationToText(a);    // e.g. "[⊕|⌀0.1|A]"
    const p = a.payload || {};
    const datums = (p.datums || []).map((d) => d.ref).filter(Boolean);

    // Place the FCF box just below-right of the view's bbox, stacked.
    const bb = view.bbox || { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const key = dir;
    const idx = stackY.get(key) || 0;
    stackY.set(key, idx + 1);
    const fx = bb.minX;
    const fy = bb.minY - 14 - idx * 7;   // model coords; renderer flips Y

    view.decorations = view.decorations || [];
    view.decorations.push({
      kind: 'gdt-fcf',
      text: fcf,
      x: fx,
      y: fy,
      datums,
      anchorX: a.anchor && Number.isFinite(a.anchor[0]) ? a.anchor[0] : (bb.minX + bb.maxX) / 2,
      anchorY: a.anchor && Number.isFinite(a.anchor[1]) ? a.anchor[1] : bb.minY,
    });
    out.push({ id: a.id, characteristic: p.characteristic, fcf, datums, view: dir });
  }
  return out;
}

function pickViewForAnnotation(a, views, opts) {
  // Explicit per-annotation hint wins.
  if (a && typeof a.drawingView === 'string' && views[a.drawingView]) return a.drawingView;
  if (a && typeof a.viewId === 'string' && views[a.viewId]) return a.viewId;
  // faceTag/anchor heuristics could map to a specific ortho; until exact
  // subshape↔view binding lands, prefer the front view (most face-on).
  if (views.front) return 'front';
  if (views.top) return 'top';
  if (views.right) return 'right';
  return Object.keys(views)[0];
}

function firstView(views) {
  for (const dir of ALL_DIRS) if (views[dir]) return views[dir];
  return null;
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
  for (const dir of ALL_DIRS) {
    const view = views[dir];
    if (!view || !Array.isArray(view.decorations)) continue;
    for (const dec of view.decorations) {
      if (dec.kind !== 'gdt-fcf') continue;
      frames += renderFcfBox(dec, view);
    }
  }
  if (!frames) return '';
  return `<g data-label="gdt-pmi">${frames}</g>`;
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
 * @returns {{ sheetModel:ForgeDrawing, svg:string, dxf:?string,
 *             views:Array, dimensions:Array, gdt:Array, scale:number,
 *             projection:string, part:object }}
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
  const gdt = pmi ? placeGdtFromPmi(views, part.bodyId, opts) : [];

  // Render the conformant sheet (border + title block + views + dims),
  // then splice in the GD&T decorations.
  let svg = drawing.toSvg(sheet, orientation, {
    titleBlock: SHEET_TO_TEMPLATE[sheet] || null,
    titleBlockFields: {
      title,
      ...(opts.titleBlockFields || {}),
    },
  });
  svg = injectGdt(svg, views);

  const dxf = opts.dxf ? emitDxf(placed.v2, dimensions) : null;

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
    scale: placed.scale,
    projection,
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
 * Supported recipes (primitive + box-with-holes); the same pattern
 * extends to any `{kind, params}` a feature tree can rebuild:
 *   box        { dx, dy, dz }
 *   cylinder   { radius, height }
 *   plate-hole { dx, dy, dz, holeR, holeX, holeY }  (box minus a thru-cyl)
 *
 * @param {object} part   `{ shape, bodyId?, kind, params }`
 * @param {object} changes  param overrides, e.g. `{ dx: 120 }`
 * @param {object} [opts]  same as generateDrawing
 * @returns {object} the generateDrawing result for the rebuilt part.
 */
export function regenerateDrawing(part, changes = {}, opts = {}) {
  if (!part || !part.kind) {
    throw new Error('regenerateDrawing: part.kind + part.params required to rebuild geometry');
  }
  const params = { ...(part.params || {}), ...changes };
  const newShape = rebuildShape(part.kind, params);
  const newPart = { ...part, shape: newShape, params };
  return generateDrawing(newPart, opts);
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
  placeStandardViews,
  autoDimension,
  placeGdtFromPmi,
  rebuildShape,
  projectView,
  v2ToFlatProjection,
  setForgeKernel,
  ORTHO_DIRS,
  ALL_DIRS,
};
