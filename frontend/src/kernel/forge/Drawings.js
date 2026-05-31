/**
 * ArchDisc Forge — Drawings (Forge-10)
 *
 * Engineering-drawing system on top of the native HLR projection. The
 * native kernel hands us flat-packed polylines in the projector's local
 * (X, Y) frame; this module composes them into a `ForgeDrawing` with
 * scaled views, dimensions, balloons, and finally an SVG export onto
 * a standard sheet (A4/A3/A2/A1/A0 or ANSI A/B/C/D/E).
 *
 * No React UI this slice — only the rendering API plus SVG output. The
 * downstream view component (Forge-11+) will consume `drawing.toSvg()`
 * via a sandboxed <img> or inject the produced DOM into an editable
 * SVG canvas.
 */

import { getForge } from './index.js';
import {
  TEMPLATES as TITLE_BLOCK_TEMPLATES,
  applyTitleBlock,
  TITLE_BLOCK_FIELDS,
} from './drawings/TitleBlocks.js';

// Allow tests / Node smoke runners to inject a kernel without going through
// the Electron preload bridge. When set, the drawing layer uses this
// instead of `getForge()`.
let _kernelOverride = null;
export function _setForgeKernel(kernel) { _kernelOverride = kernel; }
function _kernel() {
  return _kernelOverride || getForge();
}

// ---------------------------------------------------------- sheet sizes
//
// Dimensions in millimetres (ISO A-series) or millimetres-converted-from
// -inches (ANSI). Width × height of the *portrait* sheet; landscape
// transposes them at render time.
export const SHEET_SIZES = Object.freeze({
  // ISO 216 A-series
  A0: { w:  841, h: 1189 },
  A1: { w:  594, h:  841 },
  A2: { w:  420, h:  594 },
  A3: { w:  297, h:  420 },
  A4: { w:  210, h:  297 },
  // ANSI Y14.1 (1 in = 25.4 mm)
  A:  { w:  215.9, h:  279.4 },   //  8.5 × 11
  B:  { w:  279.4, h:  431.8 },   //   11 × 17
  C:  { w:  431.8, h:  558.8 },   //   17 × 22
  D:  { w:  558.8, h:  863.6 },   //   22 × 34
  E:  { w:  863.6, h: 1117.6 },   //   34 × 44
});

export function getSheetMm(name, orientation = 'landscape') {
  const base = SHEET_SIZES[name];
  if (!base) throw new Error(`[forge.drawings] unknown sheet size '${name}'`);
  return orientation === 'portrait'
    ? { w: base.w, h: base.h }
    : { w: base.h, h: base.w };
}

// ---------------------------------------------------------- preset map
const PRESETS = new Set(['front', 'top', 'right', 'iso', 'isometric']);

// ---------------------------------------------------------- view object
//
// A DrawingView is the result of one HLR projection plus a screen-space
// placement on a sheet. Polylines are stored in *model mm*, not yet
// translated to a sheet anchor — the SVG export does that.
export class DrawingView {
  /**
   * @param {object} cfg
   * @param {string} cfg.label       human label (e.g. "FRONT")
   * @param {number} cfg.scale       drawing scale, e.g. 1.0 = 1:1, 0.5 = 1:2
   * @param {object} cfg.projection  raw kernel output (visible/hidden/outline + starts)
   * @param {object} [cfg.anchor]    screen-space anchor in sheet mm (top-left of bbox)
   */
  constructor({ label, scale, projection, anchor = { x: 0, y: 0 } }) {
    this.label = label;
    this.scale = scale;
    this.projection = projection;
    this.anchor = { ...anchor };
    this.dimensions = [];      // child Dimensions placed in view-local coords
    this.balloons = [];

    // Pre-compute the view's local bbox so the SVG layout knows how much
    // space it needs.
    this.bbox = computeBbox(projection);
  }

  /** Unscaled mm width / height of the projected geometry's bbox. */
  get width()  { return (this.bbox.maxX - this.bbox.minX); }
  get height() { return (this.bbox.maxY - this.bbox.minY); }

  /** Scaled (sheet-space) width / height. */
  get scaledWidth()  { return this.width  * this.scale; }
  get scaledHeight() { return this.height * this.scale; }

  /** Attach a Dimension whose points are in *view-local model coords*. */
  addDimension(dim) { this.dimensions.push(dim); return dim; }
  addBalloon(b)     { this.balloons.push(b);   return b; }

  /**
   * Iterate every visible/hidden/outline polyline in view-local model
   * coordinates (i.e. straight out of HLR). Callback receives
   *   (kind, polylineIndex, vertsArrayOfXY)
   * where vertsArrayOfXY is an array of [x, y] pairs.
   */
  forEachPolyline(callback) {
    iteratePolylines(this.projection.visible, this.projection.visibleStarts, this.projection.visibleCount,
      (i, verts) => callback('visible', i, verts));
    iteratePolylines(this.projection.hidden, this.projection.hiddenStarts, this.projection.hiddenCount,
      (i, verts) => callback('hidden', i, verts));
    iteratePolylines(this.projection.outline, this.projection.outlineStarts, this.projection.outlineCount,
      (i, verts) => callback('outline', i, verts));
    // Optional Forge-32 buckets — only present on SectionView projections.
    if (this.projection.cut) {
      iteratePolylines(this.projection.cut, this.projection.cutStarts, this.projection.cutCount || 0,
        (i, verts) => callback('cut', i, verts));
    }
    if (this.projection.hatch) {
      iteratePolylines(this.projection.hatch, this.projection.hatchStarts, this.projection.hatchCount || 0,
        (i, verts) => callback('hatch', i, verts));
    }
  }
}

// ---------------------------------------------------------- Forge-32 views
//
// SectionView, DetailView and BrokenView all extend DrawingView; they
// reuse the same projection format and rendering pipeline but populate
// extra geometry buckets (cut/hatch for sections), decorations (the
// circle-callout for details) or break-symbol overlays.

let _detailLetterCounter = 0;
function nextDetailLetter() {
  // A, B, C, ... Z, AA, AB ...
  const i = _detailLetterCounter++;
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

let _sectionLetterCounter = 0;
function nextSectionLetter() {
  const i = _sectionLetterCounter++;
  return String.fromCharCode(65 + (i % 26));
}

/**
 * SectionView — HLR projection extended with a cut-plane intersection.
 * The kernel returns extra `cut` (heavy outline) and `hatch` (45°
 * gray lines) buckets which the SVG renderer paints in the usual way.
 *
 * @param {object} cfg
 * @param {number} cfg.shape         kernel ShapeHandle
 * @param {object} cfg.sectionPlane  { origin:[x,y,z], normal:[x,y,z] }
 * @param {object} [cfg.hatchSpec]   { spacing, angleDeg }  defaults: 2.5 mm @ 45°
 * @param {string|number[]} [cfg.direction='front']  projection direction
 * @param {number} [cfg.scale=1]
 * @param {string} [cfg.label]       defaults to "SECTION A-A" etc
 */
export class SectionView extends DrawingView {
  constructor({ shape, sectionPlane, hatchSpec = {}, direction = 'front',
                scale = 1, label = null }) {
    const kernel = _kernel();
    const dirArg = typeof direction === 'string' ? direction : Float64Array.from(direction);
    const projection = kernel.drawings.projectSection(shape, dirArg, {
      origin: sectionPlane.origin,
      normal: sectionPlane.normal,
    }, {
      spacing:  hatchSpec.spacing  ?? 2.5,
      angleDeg: hatchSpec.angleDeg ?? 45,
    });
    const letter = nextSectionLetter();
    super({
      label: label || `SECTION ${letter}-${letter}`,
      scale,
      projection,
    });
    this.sectionPlane = sectionPlane;
    this.sectionLetter = letter;
    this.decorations = [];
  }
}

/**
 * DetailView — HLR projection clipped to a circular focus region and
 * scaled up by `scale` (typically 2-4×) for legibility. Optionally
 * draws a matching focus-circle callout on a parent view.
 */
export class DetailView extends DrawingView {
  constructor({ shape, focusCircle, scale = 2, direction = 'front',
                parentView = null, label = null }) {
    const kernel = _kernel();
    const dirArg = typeof direction === 'string' ? direction : Float64Array.from(direction);
    const projection = kernel.drawings.projectDetail(shape, dirArg, {
      x: focusCircle.x,
      y: focusCircle.y,
      r: focusCircle.r,
    }, scale);
    const letter = nextDetailLetter();
    super({
      label: label || `DETAIL ${letter} (${scale}:1)`,
      scale: 1,   // already pre-scaled by the kernel — render 1:1
      projection,
    });
    this.detailLetter = letter;
    this.focusCircle = focusCircle;
    this.decorations = [];
    if (parentView) {
      // Decorate the parent view with a dashed circle + letter.
      parentView.decorations = parentView.decorations || [];
      parentView.decorations.push({
        kind: 'detail-callout',
        cx: focusCircle.x,
        cy: focusCircle.y,
        r:  focusCircle.r,
        letter,
      });
    }
  }
}

/**
 * BrokenView — HLR projection with a horizontal/vertical break region
 * removed and the right (or top) half slid back to compact the view.
 * Adds a `breakSymbol` overlay (zigzag or wavy) at the seam.
 */
export class BrokenView extends DrawingView {
  constructor({ shape, breakRegion, breakSymbol = 'zigzag', direction = 'front',
                scale = 1, label = null }) {
    const kernel = _kernel();
    const dirArg = typeof direction === 'string' ? direction : Float64Array.from(direction);
    const projection = kernel.drawings.projectBroken(shape, dirArg, {
      axis:  breakRegion.axis,
      start: breakRegion.start,
      end:   breakRegion.end,
    });
    super({
      label: label || 'BROKEN',
      scale,
      projection,
    });
    this.breakRegion = breakRegion;
    // Place the break symbol at the seam X (or Y if axis='y') in the
    // view-local model coords AFTER the kernel has compacted the geometry.
    const seam = breakRegion.start;
    this.breakSymbols = [];
    if (this.bbox && isFinite(this.bbox.minY)) {
      const yMin = this.bbox.minY - 1;
      const yMax = this.bbox.maxY + 1;
      this.breakSymbols.push({
        kind: breakSymbol === 'wavy' ? 'wavy' : 'zigzag',
        x: seam,
        yMin, yMax,
      });
    }
  }
}

// Helper to walk a flat-packed polyline list. starts has count+1 entries.
function iteratePolylines(flat, starts, count, cb) {
  if (!flat || !starts || !count) return;
  for (let i = 0; i < count; i++) {
    const s = starts[i] * 2;
    const e = starts[i + 1] * 2;
    const verts = [];
    for (let k = s; k < e; k += 2) verts.push([flat[k], flat[k + 1]]);
    cb(i, verts);
  }
}

function computeBbox(projection) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consume = (flat) => {
    if (!flat) return;
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i], y = flat[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  consume(projection.visible);
  consume(projection.hidden);
  consume(projection.outline);
  if (projection.cut)   consume(projection.cut);
  if (projection.hatch) consume(projection.hatch);
  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------- dimensions
//
// Each dimension constructor returns a plain `Dimension` object with:
//   kind:      'linear' | 'radial' | 'angular'
//   geometry:  { polylines: [[x,y]...], arrowheads: [{ tip, angle }] }
//   text:      formatted value, e.g. "50.00"
//   anchor:    where the text sits in view-local coords
//
// All coordinates are *view-local model mm*; the SVG layer will multiply
// by view.scale before rendering.

function formatNumber(v) { return Number(v).toFixed(2); }

// formatMeasurement — render a length in the caller's preferred units.
// Forge stores all coordinates in mm so we convert to inches when
// `units === 'in'`. The output is always 2 decimal places + unit
// suffix; callers can override with `precision` and `suffix`.
function formatMeasurement(mm, options = {}) {
  const units = options.units || 'mm';
  const precision = options.precision ?? 2;
  if (units === 'in') {
    return (mm / 25.4).toFixed(precision) + ' in';
  }
  return mm.toFixed(precision) + ' mm';
}

/**
 * Linear dimension between p0 and p1, with the witness lines offset
 * perpendicular to the line by `offset` mm. The witness lines are short
 * extensions from p0/p1 to the dimension line.
 *
 * `options.units` — 'mm' | 'in' (default 'mm'). Output text suffix.
 * `options.precision` — decimal digits (default 2).
 * `options.precision` 0 yields integer-only labels (matches mech-drawing
 * tradition for whole-mm dimensions).
 */
export function DimensionLinear(p0, p1, offset, options = {}) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    throw new Error('[forge.drawings] DimensionLinear: coincident points');
  }
  // Perpendicular unit vector — pick the side based on sign of offset.
  const nx = -dy / len;
  const ny =  dx / len;
  const ox = nx * offset;
  const oy = ny * offset;

  const a0 = [p0[0] + ox, p0[1] + oy];   // dim-line end at p0 side
  const a1 = [p1[0] + ox, p1[1] + oy];   // dim-line end at p1 side

  // Small witness-line extension past the dim line so arrowheads aren't
  // jammed into the geometry.
  const tail = 1.5;
  const wx = ox + nx * tail;
  const wy = oy + ny * tail;
  const w0 = [p0[0] - nx * tail, p0[1] - ny * tail];
  const w0e = [p0[0] + wx,       p0[1] + wy];
  const w1 = [p1[0] - nx * tail, p1[1] - ny * tail];
  const w1e = [p1[0] + wx,       p1[1] + wy];

  const arrowAngle = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
  return {
    kind: 'linear',
    geometry: {
      polylines: [
        [w0, w0e],        // witness 0 (extension line from p0)
        [w1, w1e],        // witness 1
        [a0, a1],         // dimension line proper
      ],
      arrowheads: [
        { tip: a0, angle: arrowAngle + Math.PI },
        { tip: a1, angle: arrowAngle },
      ],
    },
    text: options && (options.units || options.precision != null)
      ? formatMeasurement(len, options)
      : formatNumber(len),
    anchor: [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2],
    textAngle: arrowAngle,   // SVG renderer can rotate text to match dim line
  };
}

/**
 * Radial dimension from a circle/arc center, with a leader going out at
 * `leaderAngle` (radians) to the circle's edge and then offset by `radius`
 * label distance. Text is "R<value>".
 */
export function DimensionRadial(center, radius, leaderAngle, options = {}) {
  const cx = center[0], cy = center[1];
  // Leader from center to circle edge, extending slightly beyond.
  const rTip = [
    cx + Math.cos(leaderAngle) * radius,
    cy + Math.sin(leaderAngle) * radius,
  ];
  const labelDist = radius * 1.6;
  const labelEnd = [
    cx + Math.cos(leaderAngle) * labelDist,
    cy + Math.sin(leaderAngle) * labelDist,
  ];
  const valueText = options && (options.units || options.precision != null)
    ? formatMeasurement(radius, options).replace(/ /g, '')
    : formatNumber(radius);
  return {
    kind: 'radial',
    geometry: {
      polylines: [[rTip, labelEnd]],
      arrowheads: [
        { tip: rTip, angle: leaderAngle + Math.PI },
      ],
    },
    text: 'R' + valueText,
    anchor: labelEnd,
  };
}

/**
 * Angular dimension at a vertex with two rays defined by (vertex→ray0) and
 * (vertex→ray1). The dimension arc lives at `radius` from the vertex.
 * Text is the angle in degrees followed by °.
 */
export function DimensionAngular(vertex, ray0, ray1, radius) {
  const vx = vertex[0], vy = vertex[1];
  const a0 = Math.atan2(ray0[1] - vy, ray0[0] - vx);
  const a1 = Math.atan2(ray1[1] - vy, ray1[0] - vx);
  // Normalise so we draw the *shorter* arc (always ≤ π).
  let delta = a1 - a0;
  while (delta >  Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  // Sample the arc at ~24 segments / quarter-turn for smooth SVG.
  const N = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  const arc = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (delta * i) / N;
    arc.push([vx + Math.cos(a) * radius, vy + Math.sin(a) * radius]);
  }

  // Witness extensions out to the rays.
  const witness0End = [vx + Math.cos(a0) * radius * 1.1,
                       vy + Math.sin(a0) * radius * 1.1];
  const witness1End = [vx + Math.cos(a1) * radius * 1.1,
                       vy + Math.sin(a1) * radius * 1.1];

  // Arrowhead tangent at each arc endpoint (perpendicular to the radius).
  const tan0 = a0 + (delta > 0 ?  Math.PI / 2 : -Math.PI / 2);
  const tan1 = a1 + (delta > 0 ? -Math.PI / 2 :  Math.PI / 2);

  const labelAngle = a0 + delta / 2;
  return {
    kind: 'angular',
    geometry: {
      polylines: [
        arc,
        [vertex, witness0End],
        [vertex, witness1End],
      ],
      arrowheads: [
        { tip: arc[0],             angle: tan0 },
        { tip: arc[arc.length - 1], angle: tan1 },
      ],
    },
    text: (Math.abs(delta) * 180 / Math.PI).toFixed(2) + '°',
    anchor: [vx + Math.cos(labelAngle) * radius * 1.2,
             vy + Math.sin(labelAngle) * radius * 1.2],
  };
}

/**
 * Balloon — a numbered callout for an assembly item.
 *
 * Two-form API:
 *   * Balloon(anchor, number) — legacy. Balloon centre is placed at
 *     `anchor` and there is no leader line.
 *   * Balloon({ anchor, balloonAt, number, radius }) — full form. The
 *     anchor is the *call-out point on the geometry*; `balloonAt` is
 *     where the numbered circle sits (offset from anchor). A leader
 *     line connects them with an arrowhead at the anchor end.
 *
 * The SVG renderer detects balloon-balloon collisions and nudges
 * overlapping balloons along the leader's tangent direction so labels
 * never sit on top of each other.
 */
export function Balloon(arg0, arg1) {
  // ----- two-arg legacy form: Balloon([x,y], number)
  if (Array.isArray(arg0)) {
    return {
      kind: 'balloon',
      at: [arg0[0], arg0[1]],     // call-out point AND balloon position
      balloonAt: [arg0[0], arg0[1]],
      number: String(arg1),
      radius: 3.0,
    };
  }
  // ----- object form: Balloon({ anchor, balloonAt, number, radius })
  const o = arg0 || {};
  if (!o.anchor || !Array.isArray(o.anchor)) {
    throw new Error('[forge.drawings] Balloon: anchor (geometry call-out point) required');
  }
  const balloonAt = Array.isArray(o.balloonAt) ? o.balloonAt : [o.anchor[0], o.anchor[1]];
  return {
    kind: 'balloon',
    at: [o.anchor[0], o.anchor[1]],     // alias for backward compat
    anchor: [o.anchor[0], o.anchor[1]],
    balloonAt: [balloonAt[0], balloonAt[1]],
    number: String(o.number ?? ''),
    radius: typeof o.radius === 'number' ? o.radius : 3.0,
  };
}

// ---------------------------------------------------------- drawing
//
// ForgeDrawing aggregates DrawingViews, dimensions and balloons, and
// emits a single SVG document.
export class ForgeDrawing {
  /**
   * @param {object} cfg
   * @param {string} [cfg.title='Drawing']      title-block label
   * @param {object} [cfg.titleBlock]           optional override values
   */
  constructor({ title = 'Drawing', titleBlock = {} } = {}) {
    this.title = title;
    this.titleBlock = {
      project: 'ArchDisc Forge',
      drawnBy: '',
      date: new Date().toISOString().slice(0, 10),
      scale: '1:1',
      sheet: '1 / 1',
      ...titleBlock,
    };
    this.views = [];
  }

  /**
   * Project `shapeHandle` along `direction` at `scale`, append the resulting
   * DrawingView, and return it. The default anchor is { x:0, y:0 } —
   * the caller can move the view by mutating `view.anchor` before
   * calling `toSvg`.
   *
   * @param {number} shapeHandle       — kernel handle
   * @param {string|number[]} direction — 'front'/'top'/'right'/'iso' or [dx,dy,dz]
   * @param {number} [scale=1]
   * @param {string} [label]           — defaults to uppercased preset
   */
  addView(shapeHandle, direction, scale = 1, label = null) {
    const kernel = _kernel();
    let arg;
    if (typeof direction === 'string') {
      if (!PRESETS.has(direction)) {
        throw new Error(`[forge.drawings] unknown direction preset '${direction}'`);
      }
      arg = direction;
    } else if (Array.isArray(direction) && direction.length === 3) {
      arg = Float64Array.from(direction);
    } else {
      throw new Error('[forge.drawings] direction must be a preset string or [dx,dy,dz] array');
    }
    const projection = kernel.drawings.projectShape(shapeHandle, arg);
    const view = new DrawingView({
      label: label || (typeof direction === 'string' ? direction.toUpperCase() : 'CUSTOM'),
      scale,
      projection,
    });
    this.views.push(view);
    return view;
  }

  /**
   * Append a section view (Forge-32). The cutting plane is supplied
   * as `{ origin:[x,y,z], normal:[x,y,z] }` in world coordinates.
   * `hatchSpec.spacing` controls the 45°-line spacing in mm.
   *
   * If `parentView` is provided, the section's cutting-plane line is
   * drawn across it with arrowheads + the section letter (A-A, B-B …)
   * — the conventional callout used by SolidWorks / Creo / Catia.
   */
  addSectionView({ shape, sectionPlane, hatchSpec, direction = 'front',
                   scale = 1, parentView = null, label = null }) {
    const view = new SectionView({ shape, sectionPlane, hatchSpec, direction, scale, label });
    this.views.push(view);
    if (parentView && parentView.bbox) {
      // Project the section plane onto the parent view to draw the line.
      // For now we span the parent view's full width at the plane's mean Y.
      parentView.decorations = parentView.decorations || [];
      parentView.decorations.push({
        kind: 'section-line',
        p0: [parentView.bbox.minX - 2, sectionPlane.origin[2] ?? parentView.bbox.minY],
        p1: [parentView.bbox.maxX + 2, sectionPlane.origin[2] ?? parentView.bbox.minY],
        letter: view.sectionLetter,
      });
    }
    return view;
  }

  addDetailView({ shape, focusCircle, scale = 2, direction = 'front',
                  parentView = null, label = null }) {
    const view = new DetailView({ shape, focusCircle, scale, direction, parentView, label });
    this.views.push(view);
    return view;
  }

  addBrokenView({ shape, breakRegion, breakSymbol = 'zigzag', direction = 'front',
                  scale = 1, label = null }) {
    const view = new BrokenView({ shape, breakRegion, breakSymbol, direction, scale, label });
    this.views.push(view);
    return view;
  }

  /**
   * Auto-layout — distributes views across the sheet's drawing area, then
   * returns an SVG string. Sheet sizes: A4|A3|A2|A1|A0 / A|B|C|D|E.
   *
   * `options.titleBlock` (Forge-32): name of a TitleBlocks.js template
   * ('A4'|...|'E'). Passes `options.titleBlockFields` through; everything
   * not supplied defaults to '—' so partial fills still produce a
   * publishable sheet.
   */
  toSvg(sheetSize = 'A4', orientation = 'landscape', options = {}) {
    const sheet = getSheetMm(sheetSize, orientation);
    autoLayout(this.views, sheet);
    let svg = renderSvg(this, sheet, sheetSize, orientation);
    if (options.titleBlock) {
      // Splice in a real templated title block (replaces the built-in stub).
      svg = applyTitleBlock(svg, options.titleBlock, {
        ...this.titleBlock,
        title: this.title,
        ...(options.titleBlockFields || {}),
      });
    }
    return svg;
  }
}

// ---------------------------------------------------------- auto-layout
//
// Greedy 2-column layout: fits views top-to-bottom, two columns at most.
// In a real product this would be a constraint-solving layout — for now,
// any caller that wants finer control can set `view.anchor.{x,y}` after
// `addView()` and skip auto-layout by setting `view.anchor.fixed = true`.
function autoLayout(views, sheet) {
  const margin = 20;     // mm sheet margin
  const titleBlockH = 50; // mm reserved at bottom for the title block
  const gap = 15;        // mm between views
  const usableW = sheet.w - 2 * margin;
  const usableH = sheet.h - 2 * margin - titleBlockH;

  // Place each unanchored view; preserve user-pinned positions.
  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0;
  for (const v of views) {
    if (v.anchor.fixed) continue;
    const w = v.scaledWidth;
    const h = v.scaledHeight;
    if (cursorX + w > margin + usableW) {
      cursorX = margin;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    if (cursorY + h > margin + usableH) {
      // Don't fall off the sheet; clip but warn.
      // (UI layer can re-page later.)
    }
    v.anchor.x = cursorX;
    v.anchor.y = cursorY;
    cursorX += w + gap;
    if (h > rowHeight) rowHeight = h;
  }
}

// ---------------------------------------------------------- SVG render
//
// We emit a self-contained SVG: a <defs> block with an arrowhead marker,
// then one <g> per view, then the title block at the bottom-right.
// SVG y-axis points DOWN, so we flip view-local y when emitting paths.
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function pathFromPolyline(pts, view) {
  let d = '';
  const { x: ax, y: ay } = view.anchor;
  const { minX, minY, maxY } = view.bbox;
  const flippedH = (maxY - minY) * view.scale;
  for (let i = 0; i < pts.length; i++) {
    const lx = (pts[i][0] - minX) * view.scale;
    const ly = (pts[i][1] - minY) * view.scale;
    const x = ax + lx;
    const y = ay + (flippedH - ly);   // flip Y for SVG
    d += (i === 0 ? 'M' : 'L') + x.toFixed(3) + ',' + y.toFixed(3) + ' ';
  }
  return d.trim();
}

function transformPoint(p, view) {
  const { x: ax, y: ay } = view.anchor;
  const { minX, minY, maxY } = view.bbox;
  const flippedH = (maxY - minY) * view.scale;
  const lx = (p[0] - minX) * view.scale;
  const ly = (p[1] - minY) * view.scale;
  return [ax + lx, ay + (flippedH - ly)];
}

function arrowheadSvg(tip, angle, view) {
  // 3 mm long, 1 mm wide filled triangle.
  const [tx, ty] = transformPoint(tip, view);
  // SVG-space angle: flipping Y inverts angle sign.
  const a = -angle;
  const sz = 3.0;
  const wd = 1.0;
  const bx = tx - Math.cos(a) * sz;
  const by = ty - Math.sin(a) * sz;
  const px = -Math.sin(a) * wd;
  const py =  Math.cos(a) * wd;
  return `<polygon points="${tx.toFixed(2)},${ty.toFixed(2)} ${
    (bx + px).toFixed(2)},${(by + py).toFixed(2)} ${
    (bx - px).toFixed(2)},${(by - py).toFixed(2)}" fill="#000"/>`;
}

function renderDimensions(view) {
  let out = '';
  for (const dim of view.dimensions) {
    for (const pl of dim.geometry.polylines) {
      out += `<path d="${pathFromPolyline(pl, view)}" fill="none" stroke="#000" stroke-width="0.25"/>`;
    }
    for (const a of dim.geometry.arrowheads) {
      out += arrowheadSvg(a.tip, a.angle, view);
    }
    const [tx, ty] = transformPoint(dim.anchor, view);
    out += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#000" text-anchor="middle">${escapeXml(dim.text)}</text>`;
  }
  return out;
}

function renderBalloons(view) {
  let out = '';
  // Pass 1: compute SVG-space balloon positions, then resolve collisions
  // by nudging overlapping balloons outward along the leader direction.
  const placed = [];
  for (const b of view.balloons) {
    const [ax, ay] = transformPoint(b.anchor || b.at, view);
    const [bx, by] = transformPoint(b.balloonAt || b.at, view);
    placed.push({ b, ax, ay, bx, by, r: (b.radius ?? 3.0) });
  }
  // Naive O(N²) collision resolver — 1-2 nudge iterations is enough for
  // typical assemblies (<50 balloons per view); the practical alternative
  // is RTree which is overkill for this drawing volume.
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j];
        const minDist = A.r + B.r + 1.0;
        const dx = B.bx - A.bx, dy = B.by - A.by;
        const d  = Math.hypot(dx, dy);
        if (d < minDist && d > 1e-6) {
          // Push B along the leader-tangent (perpendicular to A→anchor)
          // so its leader still points sensibly.
          const lx = B.bx - B.ax, ly = B.by - B.ay;
          const lenL = Math.hypot(lx, ly) || 1;
          // Tangent unit vector (perp to leader):
          const tx = -ly / lenL, ty = lx / lenL;
          // Move B along its tangent by (minDist - d). Direction sign:
          // pick whichever side increases distance from A.
          const sign = (tx * dx + ty * dy) >= 0 ? 1 : -1;
          const push = (minDist - d);
          B.bx += sign * tx * push;
          B.by += sign * ty * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  for (const p of placed) {
    const { ax, ay, bx, by, r, b } = p;
    // Skip leader if balloon and anchor coincide (legacy call form).
    const lenAB = Math.hypot(bx - ax, by - ay);
    if (lenAB > r + 0.5) {
      // Trim leader so it stops at the balloon's outer radius.
      const ux = (bx - ax) / lenAB, uy = (by - ay) / lenAB;
      const leaderEnd = [bx - ux * r, by - uy * r];
      // Leader line.
      out += `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" ` +
             `x2="${leaderEnd[0].toFixed(2)}" y2="${leaderEnd[1].toFixed(2)}" ` +
             `stroke="#000" stroke-width="0.3"/>`;
      // Arrowhead at the geometry-anchor end (small filled triangle).
      const sz = 2.5, wd = 0.9;
      // arrow tip points TOWARD the anchor, i.e. against (ux,uy).
      const baseX = ax + ux * sz;
      const baseY = ay + uy * sz;
      const pxv = -uy * wd;
      const pyv =  ux * wd;
      out += `<polygon points="${ax.toFixed(2)},${ay.toFixed(2)} ` +
        `${(baseX + pxv).toFixed(2)},${(baseY + pyv).toFixed(2)} ` +
        `${(baseX - pxv).toFixed(2)},${(baseY - pyv).toFixed(2)}" fill="#000"/>`;
    }
    // The balloon circle + number.
    out += `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${r.toFixed(2)}" ` +
           `fill="#fff" stroke="#000" stroke-width="0.4"/>`;
    out += `<text x="${bx.toFixed(2)}" y="${(by + 1.0).toFixed(2)}" ` +
           `font-family="Helvetica, Arial, sans-serif" font-size="${(r * 0.85).toFixed(2)}" ` +
           `fill="#000" text-anchor="middle">${escapeXml(b.number)}</text>`;
  }
  return out;
}

function renderView(view) {
  let out = `<g data-label="${escapeXml(view.label)}">`;

  // Visible solid lines.
  view.forEachPolyline((kind, _i, verts) => {
    const d = pathFromPolyline(verts, view);
    if (!d) return;
    if (kind === 'visible') {
      out += `<path d="${d}" fill="none" stroke="#000" stroke-width="0.4"/>`;
    } else if (kind === 'hidden') {
      out += `<path d="${d}" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="2 1.5"/>`;
    } else if (kind === 'outline') {
      out += `<path d="${d}" fill="none" stroke="#000" stroke-width="0.5"/>`;
    } else if (kind === 'cut') {
      // Cut-face outline: heavy solid stroke marking the section boundary.
      out += `<path d="${d}" fill="none" stroke="#000" stroke-width="0.6"/>`;
    } else if (kind === 'hatch') {
      // Hatch fill: thin gray 45° lines.
      out += `<path d="${d}" fill="none" stroke="#666" stroke-width="0.2"/>`;
    }
  });

  // Forge-32: SectionView optional callout label + plane line on parent
  // view, DetailView optional focus circle on the parent. We render
  // those from the view's `decorations` array when present.
  if (Array.isArray(view.decorations)) {
    for (const dec of view.decorations) {
      out += renderDecoration(dec, view);
    }
  }
  // BrokenView's zigzag break symbols.
  if (Array.isArray(view.breakSymbols)) {
    for (const sym of view.breakSymbols) {
      out += renderBreakSymbol(sym, view);
    }
  }

  // View label at the top-left.
  if (view.label) {
    out += `<text x="${view.anchor.x.toFixed(2)}" y="${(view.anchor.y - 2).toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="3.5" fill="#000">${escapeXml(view.label)}</text>`;
  }

  out += renderDimensions(view);
  out += renderBalloons(view);
  out += '</g>';
  return out;
}

// ---------------------------------------------------------- decorations
//
// A "decoration" is a parent-view-space annotation: the focus circle that
// a DetailView draws on its parent, the section-plane line + arrows that
// a SectionView paints on the front view, etc. Each decoration is just a
// small object with `kind` and the parameters needed to draw it.

function renderDecoration(dec, view) {
  if (dec.kind === 'detail-callout') {
    // Circle around the focus area + a letter callout in the parent view.
    const [cx, cy] = transformPoint([dec.cx, dec.cy], view);
    const r = dec.r * view.scale;
    let s = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" ` +
            `fill="none" stroke="#000" stroke-width="0.4" stroke-dasharray="3 1.5"/>`;
    s += `<text x="${(cx + r + 1.5).toFixed(2)}" y="${(cy - r).toFixed(2)}" ` +
         `font-family="Helvetica, Arial, sans-serif" font-size="4" font-weight="bold" ` +
         `fill="#000">${escapeXml(dec.letter)}</text>`;
    return s;
  }
  if (dec.kind === 'section-line') {
    // Chain-dashed line across the parent view marking the cutting plane.
    const [x0, y0] = transformPoint(dec.p0, view);
    const [x1, y1] = transformPoint(dec.p1, view);
    let s = `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" ` +
            `x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" ` +
            `stroke="#000" stroke-width="0.6" stroke-dasharray="6 1.5 2 1.5"/>`;
    // Caps with arrowheads pointing along the normal direction.
    const lx = x1 - x0, ly = y1 - y0;
    const llen = Math.hypot(lx, ly) || 1;
    const nx = -ly / llen, ny = lx / llen;
    const labelOff = 4;
    const arrowSz = 3;
    // Two cap arrowheads — one at each end.
    for (const [tx, ty] of [[x0, y0], [x1, y1]]) {
      const tipX = tx + nx * arrowSz;
      const tipY = ty + ny * arrowSz;
      s += `<polygon points="${tx.toFixed(2)},${ty.toFixed(2)} ` +
        `${(tipX - 1.0 * (ly / llen)).toFixed(2)},${(tipY + 1.0 * (lx / llen)).toFixed(2)} ` +
        `${(tipX + 1.0 * (ly / llen)).toFixed(2)},${(tipY - 1.0 * (lx / llen)).toFixed(2)}" fill="#000"/>`;
    }
    s += `<text x="${(x0 + nx * labelOff).toFixed(2)}" y="${(y0 + ny * labelOff).toFixed(2)}" ` +
         `font-family="Helvetica, Arial, sans-serif" font-size="4" font-weight="bold" ` +
         `fill="#000" text-anchor="middle">${escapeXml(dec.letter)}</text>`;
    return s;
  }
  return '';
}

// renderBreakSymbol — zig-zag (or curly) break glyph at a vertical seam
// in a BrokenView. The zig-zag spans the view's full height at the seam
// X coordinate (in view-local model units, transformed at render time).
function renderBreakSymbol(sym, view) {
  // sym: { x, yMin, yMax, kind: 'zigzag' | 'wavy' }
  const verts = [];
  if (sym.kind === 'wavy') {
    const N = 12, A = 1.5;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = sym.yMin + (sym.yMax - sym.yMin) * t;
      const x = sym.x + Math.sin(t * Math.PI * 4) * A;
      verts.push([x, y]);
    }
  } else {
    const N = 8, A = 2.0;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = sym.yMin + (sym.yMax - sym.yMin) * t;
      const x = sym.x + (i % 2 === 0 ? -A : A);
      verts.push([x, y]);
    }
  }
  const d = pathFromPolyline(verts, view);
  return `<path d="${d}" fill="none" stroke="#000" stroke-width="0.4"/>`;
}

function renderTitleBlock(drawing, sheet) {
  // 80 × 40 mm block at bottom-right, with two lines of metadata.
  const w = 80, h = 40;
  const x = sheet.w - 10 - w;
  const y = sheet.h - 10 - h;
  const tb = drawing.titleBlock;
  const lines = [
    drawing.title,
    `Project: ${tb.project}`,
    `Drawn:   ${tb.drawnBy || '—'}`,
    `Date:    ${tb.date}`,
    `Scale:   ${tb.scale}`,
    `Sheet:   ${tb.sheet}`,
  ];
  let s = `<g data-label="title-block"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.5"/>`;
  let yy = y + 6;
  for (const ln of lines) {
    s += `<text x="${(x + 3).toFixed(2)}" y="${yy.toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="3.5" fill="#000">${escapeXml(ln)}</text>`;
    yy += 5.5;
  }
  s += '</g>';
  return s;
}

function renderSvg(drawing, sheet, sizeName, orientation) {
  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" `;
  svg += `width="${sheet.w}mm" height="${sheet.h}mm" `;
  svg += `viewBox="0 0 ${sheet.w} ${sheet.h}" `;
  svg += `data-sheet="${sizeName}" data-orientation="${orientation}">`;
  // Sheet border.
  svg += `<rect x="0.5" y="0.5" width="${(sheet.w - 1).toFixed(2)}" height="${(sheet.h - 1).toFixed(2)}" fill="#fff" stroke="#000" stroke-width="0.4"/>`;
  for (const v of drawing.views) svg += renderView(v);
  svg += renderTitleBlock(drawing, sheet);
  svg += '</svg>';
  return svg;
}

// ---------------------------------------------------------- exports
export {
  TITLE_BLOCK_TEMPLATES,
  applyTitleBlock,
  TITLE_BLOCK_FIELDS,
};

export default {
  ForgeDrawing,
  DrawingView,
  SectionView,
  DetailView,
  BrokenView,
  DimensionLinear,
  DimensionRadial,
  DimensionAngular,
  Balloon,
  SHEET_SIZES,
  getSheetMm,
  TITLE_BLOCK_TEMPLATES,
  applyTitleBlock,
  TITLE_BLOCK_FIELDS,
};
