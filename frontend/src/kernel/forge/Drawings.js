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

/**
 * Linear dimension between p0 and p1, with the witness lines offset
 * perpendicular to the line by `offset` mm. The witness lines are short
 * extensions from p0/p1 to the dimension line.
 */
export function DimensionLinear(p0, p1, offset) {
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
    text: formatNumber(len),
    anchor: [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2],
  };
}

/**
 * Radial dimension from a circle/arc center, with a leader going out at
 * `leaderAngle` (radians) to the circle's edge and then offset by `radius`
 * label distance. Text is "R<value>".
 */
export function DimensionRadial(center, radius, leaderAngle) {
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
  return {
    kind: 'radial',
    geometry: {
      polylines: [[rTip, labelEnd]],
      arrowheads: [
        { tip: rTip, angle: leaderAngle + Math.PI },
      ],
    },
    text: 'R' + formatNumber(radius),
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
 * Balloon — a numbered callout for an assembly item. Renders as a small
 * circle with the part number inside, with an optional leader line to
 * `at` (the call-out point on the geometry).
 */
export function Balloon(at, number) {
  return {
    kind: 'balloon',
    at: [at[0], at[1]],
    number: String(number),
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
   * Auto-layout — distributes views across the sheet's drawing area, then
   * returns an SVG string. Sheet sizes: A4|A3|A2|A1|A0 / A|B|C|D|E.
   */
  toSvg(sheetSize = 'A4', orientation = 'landscape') {
    const sheet = getSheetMm(sheetSize, orientation);
    autoLayout(this.views, sheet);
    return renderSvg(this, sheet, sheetSize, orientation);
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
  for (const b of view.balloons) {
    const [tx, ty] = transformPoint(b.at, view);
    out += `<circle cx="${tx.toFixed(2)}" cy="${ty.toFixed(2)}" r="3" fill="#fff" stroke="#000" stroke-width="0.3"/>`;
    out += `<text x="${tx.toFixed(2)}" y="${(ty + 1).toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="2.8" fill="#000" text-anchor="middle">${escapeXml(b.number)}</text>`;
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
    }
  });

  // View label at the top-left.
  if (view.label) {
    out += `<text x="${view.anchor.x.toFixed(2)}" y="${(view.anchor.y - 2).toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="3.5" fill="#000">${escapeXml(view.label)}</text>`;
  }

  out += renderDimensions(view);
  out += renderBalloons(view);
  out += '</g>';
  return out;
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
export default {
  ForgeDrawing,
  DrawingView,
  DimensionLinear,
  DimensionRadial,
  DimensionAngular,
  Balloon,
  SHEET_SIZES,
  getSheetMm,
};
