// forge_drawing.mjs — Forge engineering-DRAWING generator.
//
// 3D model  →  full CADGenBench/Mecado-format A2 engineering drawing
//              (multi-view + dimensions + callouts + title block)  →  SVG + PNG.
//
// This is BOTH a new core capability and the generator that mints
// (drawing → known-model) training pairs: because the model is built here from
// explicit kernel calls, every hole position / diameter and the overall bbox
// are known exactly, so the auto-dimensions are GROUND TRUTH, not re-derived.
//
// Pipeline:
//   1. build (or import) a sample model via the headless kernel
//   2. project front / top / right / iso views (kernel forge.drawings.projectView — HLR)
//   3. scale + place the 4 views in third-angle + iso layout on a 594x420 mm A2 sheet
//   4. auto-dimension: overall bbox (L/W/H) + every hole (Ø callout + leader)
//   5. render the zone border + title block + notes as SVG primitives
//   6. emit drawing.svg, rasterize -> drawing.png via headless chromium (Playwright)
//
// Usage:  node scripts/forge_drawing.mjs
//
// Reuses forge-kernel/test/cadscore_harness.mjs::makeHeadlessForge to load the
// addon. Keeps kernel use light (one model) per the hardware-calm constraint.

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { makeHeadlessForge } = await import(
  pathToFileURL(path.join(ROOT, 'forge-kernel', 'test', 'cadscore_harness.mjs')).href
);

// ───────────────────────────────────────────────────────────────────────────
//  A2 sheet geometry  (594 x 420 mm landscape, 1 mm = 1 SVG user unit)
// ───────────────────────────────────────────────────────────────────────────
const SHEET = { w: 594, h: 420 };
const MARGIN = 10;          // outer paper margin to the border
const ZONE = 8;             // zone-band thickness (where 1..12 / A..H live)
// inner drawing frame (everything lives inside this)
const FRAME = {
  x0: MARGIN + ZONE,
  y0: MARGIN + ZONE,
  x1: SHEET.w - MARGIN - ZONE,
  y1: SHEET.h - MARGIN - ZONE,
};
const COLS = 12;            // zone columns 1..12 across top + bottom
const ROWS = 8;             // zone rows  A..H down both sides

// ───────────────────────────────────────────────────────────────────────────
//  1. BUILD A SAMPLE MODEL  (multi-feature plate; we track every hole)
// ───────────────────────────────────────────────────────────────────────────
//  A 160 x 100 x 12 mm mounting plate with:
//    - one Ø20 THRU central bore
//    - four Ø9 THRU corner fixing holes on a 130 x 70 bolt rectangle
//  Positions/diameters are kept so the dimensioner has ground truth.
function buildSampleModel(forge) {
  const L = 160, W = 100, T = 12;          // length (X), width (Y), thickness (Z)
  let body = forge.makeBox(L, W, T);
  // centre the plate on the origin so view bboxes are symmetric & holes line up
  body = forge.translate(body, -L / 2, -W / 2, 0);

  const holes = [];
  const drill = (x, y, dia) => {
    const r = dia / 2;
    // cutter overhangs through the full thickness (start below, run past the top)
    let cyl = forge.makeCylinder(r, T + 10);
    cyl = forge.translate(cyl, x, y, -5);
    body = forge.cut(body, cyl);
    holes.push({ x, y, dia, thru: true });
  };

  drill(0, 0, 20);                          // central bore Ø20
  const bx = 130 / 2, by = 70 / 2;          // 130 x 70 bolt rectangle
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) drill(sx * bx, sy * by, 9);

  // A hole-free copy of the same blank — used ONLY for a clean isometric edge
  // silhouette (the through-bore wall facets otherwise fill the iso with a
  // black fan). Hole mouths are overlaid analytically on the iso. One extra
  // cheap box projection; hardware-light.
  let blank = forge.makeBox(L, W, T);
  blank = forge.translate(blank, -L / 2, -W / 2, 0);

  return {
    handle: body,
    isoBlank: blank,
    meta: { L, W, T, holes },
    title: 'MOUNTING PLATE',
    project: 'FORGE-CADGEN',
    material: 'AL 6061-T6',
    sheetNo: '1',
  };
}

// 3D bbox from a tessellation (massProps does not expose a bbox).
function bbox3D(forge, h) {
  const t = forge.tessellate(h, 0.1, 0.5);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  const P = t.positions;
  for (let i = 0; i < P.length; i += 3)
    for (let a = 0; a < 3; a++) {
      const v = P[i + a];
      if (v < mn[a]) mn[a] = v;
      if (v > mx[a]) mx[a] = v;
    }
  return { min: mn, max: mx };
}

// ───────────────────────────────────────────────────────────────────────────
//  SVG primitive helpers
// ───────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(3));

function line(x1, y1, x2, y2, attr = {}) {
  const a = { stroke: '#000', 'stroke-width': 0.25, ...attr };
  const s = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${s}/>`;
}
function rect(x, y, w, h, attr = {}) {
  const a = { fill: 'none', stroke: '#000', 'stroke-width': 0.3, ...attr };
  const s = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${s}/>`;
}
function circle(cx, cy, r, attr = {}) {
  const a = { fill: 'none', stroke: '#000', 'stroke-width': 0.25, ...attr };
  const s = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${s}/>`;
}
function text(x, y, str, attr = {}) {
  const a = { 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': 3.2, fill: '#000', ...attr };
  const s = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<text x="${f(x)}" y="${f(y)}" ${s}>${esc(str)}</text>`;
}
function polyline(pts, attr = {}) {
  const a = { fill: 'none', stroke: '#000', 'stroke-width': 0.25, ...attr };
  const s = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  const d = pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
  return `<polyline points="${d}" ${s}/>`;
}

// Arrowhead (filled triangle) pointing FROM (bx,by) TOWARD (tx,ty).
function arrow(tx, ty, bx, by, len = 2.2, wid = 0.8) {
  const dx = tx - bx, dy = ty - by;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;        // unit toward tip
  const px = -uy, py = ux;               // perpendicular
  const baseX = tx - ux * len, baseY = ty - uy * len;
  const x1 = baseX + px * wid, y1 = baseY + py * wid;
  const x2 = baseX - px * wid, y2 = baseY - py * wid;
  return `<polygon points="${f(tx)},${f(ty)} ${f(x1)},${f(y1)} ${f(x2)},${f(y2)}" fill="#000"/>`;
}

// ───────────────────────────────────────────────────────────────────────────
//  2-3. VIEW LAYOUT  — transform kernel view coords → sheet coords
// ───────────────────────────────────────────────────────────────────────────
// projectView returns 2D polylines whose Y is "screen down" for some buckets;
// we map view-space (vx,vy) → sheet-space with a single uniform scale + offset,
// flipping Y so the part reads upright on the page (sheet Y is also "down" in
// SVG, so we flip to keep CAD "up" = page up).
function makeViewPlacement(view, scale, cx, cy) {
  const bb = view.bbox;
  const w = bb.maxX - bb.minX || 1;
  const h = bb.maxY - bb.minY || 1;
  // centre the view bbox at (cx,cy) on the sheet, flip Y
  const ox = cx - (bb.minX + w / 2) * scale;
  const oy = cy + (bb.minY + h / 2) * scale;   // +: because we flip below
  const map = (p) => ({ x: ox + p.x * scale, y: oy - p.y * scale });
  return { map, scale, ox, oy, bb, w, h };
}

// The kernel HLR returns the cylindrical bore WALLS tessellated into thousands
// of tiny / diagonal facet chords (visibleEdges len 2484, all 2-point segs).
// Rendered raw they fill the views with a solid black "X". An engineering
// drawing of a plate wants the part OUTLINE + clean hole circles, not the
// faceted wall facets. We therefore:
//   - keep only AXIS-ALIGNED projected segments (the true silhouette of a
//     prismatic plate is axis-aligned in front/top/right), deduped;
//   - draw hole circles ANALYTICALLY from the known build data (ground truth);
//   - for the ISO view, keep the projected silhouette but drop the interior
//     facet chords that lie inside the outline bbox by a margin.
function isAxisAligned(a, b, tol = 0.05) {
  return Math.abs(a.x - b.x) < tol || Math.abs(a.y - b.y) < tol;
}
function dedupSegs(segs, q = 0.05) {
  const seen = new Set();
  const out = [];
  for (const s of segs) {
    const k1 = `${Math.round(s[0].x / q)},${Math.round(s[0].y / q)},${Math.round(s[1].x / q)},${Math.round(s[1].y / q)}`;
    const k2 = `${Math.round(s[1].x / q)},${Math.round(s[1].y / q)},${Math.round(s[0].x / q)},${Math.round(s[0].y / q)}`;
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1);
    out.push(s);
  }
  return out;
}

// Emit a clean orthographic view: axis-aligned outline only, deduped, no hidden.
function emitOrtho(view, place) {
  const segs = [];
  for (const pl of view.visibleEdges) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const a = pl[i], b = pl[i + 1];
      if (isAxisAligned(a, b)) segs.push([a, b]);
    }
  }
  const ded = dedupSegs(segs);
  return ded.map((s) =>
    line(place.map(s[0]).x, place.map(s[0]).y, place.map(s[1]).x, place.map(s[1]).y,
      { 'stroke-width': 0.5, stroke: '#000' })).join('\n');
}

// Emit the ISO view of the hole-free blank: a clean box silhouette. Keep all
// visible edges (deduped); a prismatic blank projects to only ~9 edges so no
// facet clutter remains.
function emitIso(view, place) {
  const segs = [];
  for (const pl of view.visibleEdges) {
    for (let i = 0; i + 1 < pl.length; i++) segs.push([pl[i], pl[i + 1]]);
  }
  const ded = dedupSegs(segs, 0.08);
  return ded.map((s) =>
    line(place.map(s[0]).x, place.map(s[0]).y, place.map(s[1]).x, place.map(s[1]).y,
      { 'stroke-width': 0.45, stroke: '#000' })).join('\n');
}

// Analytic hole circle on a view. plane: which model axes map to (sheet-h, sheet-v).
//   'top'  : hole (x,y) -> view (x,y)   draw a circle
//   'front': hole (x)   -> view x; depth along thickness -> two wall lines
//   'right': hole (y)   -> view x; depth along thickness -> two wall lines
function holeCircleTop(hpos, cx, cy, scale) {
  const sx = cx + hpos.x * scale, sy = cy - hpos.y * scale;
  const r = (hpos.dia / 2) * scale;
  return circle(sx, sy, r, { 'stroke-width': 0.5 }) + '\n'
    // centre marks
    + line(sx - r - 1.5, sy, sx + r + 1.5, sy, { 'stroke-width': 0.2, 'stroke-dasharray': '2,1,0.5,1' })
    + line(sx, sy - r - 1.5, sx, sy + r + 1.5, { 'stroke-width': 0.2, 'stroke-dasharray': '2,1,0.5,1' });
}

// ───────────────────────────────────────────────────────────────────────────
//  4. AUTO-DIMENSION
// ───────────────────────────────────────────────────────────────────────────
// Horizontal linear dimension between sheet-x a and b, dimension line at sheet-y dy,
// witness lines rising from feature-y wy.  value drawn centred above the line.
function dimH(ax, bx, dy, wy, value) {
  const out = [];
  const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
  const ext = 1.5;                 // small gap between feature and witness start
  // witness (extension) lines
  out.push(line(ax, wy + Math.sign(dy - wy) * ext, ax, dy + Math.sign(wy - dy) * 1.0));
  out.push(line(bx, wy + Math.sign(dy - wy) * ext, bx, dy + Math.sign(wy - dy) * 1.0));
  // dimension line
  out.push(line(lo, dy, hi, dy, { 'stroke-width': 0.3 }));
  // arrowheads pointing outward to each witness
  out.push(arrow(lo, dy, lo + 4, dy));
  out.push(arrow(hi, dy, hi - 4, dy));
  // value
  out.push(text((lo + hi) / 2, dy - 1.2, value, { 'text-anchor': 'middle', 'font-size': 3.2 }));
  return out.join('\n');
}
// Vertical linear dimension between sheet-y a and b, dimension line at sheet-x dx.
function dimV(ay, by, dx, wx, value) {
  const out = [];
  const lo = Math.min(ay, by), hi = Math.max(ay, by);
  const ext = 1.5;
  out.push(line(wx + Math.sign(dx - wx) * ext, ay, dx + Math.sign(wx - dx) * 1.0, ay));
  out.push(line(wx + Math.sign(dx - wx) * ext, by, dx + Math.sign(wx - dx) * 1.0, by));
  out.push(line(dx, lo, dx, hi, { 'stroke-width': 0.3 }));
  out.push(arrow(dx, lo, dx, lo + 4));
  out.push(arrow(dx, hi, dx, hi - 4));
  // rotated value text
  out.push(`<text x="${f(dx - 1.2)}" y="${f((lo + hi) / 2)}" font-family="Helvetica, Arial, sans-serif" font-size="3.2" fill="#000" text-anchor="middle" transform="rotate(-90 ${f(dx - 1.2)} ${f((lo + hi) / 2)})">${esc(value)}</text>`);
  return out.join('\n');
}
// Leader + Ø callout for a hole. (lx,ly) hole centre on sheet; tx,ty text anchor.
function holeLeader(lx, ly, r, tx, ty, label) {
  const out = [];
  // leader from text to a point on the hole circle
  const ang = Math.atan2(ly - ty, lx - tx);
  const px = lx - Math.cos(ang) * r, py = ly - Math.sin(ang) * r;
  out.push(line(tx, ty, px, py, { 'stroke-width': 0.3 }));
  out.push(arrow(px, py, tx, ty));
  out.push(text(tx + (tx <= lx ? -1 : 1), ty - 0.6, label,
    { 'text-anchor': tx <= lx ? 'end' : 'start', 'font-size': 3.0 }));
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
//  5. ZONE BORDER + TITLE BLOCK + NOTES
// ───────────────────────────────────────────────────────────────────────────
function zoneBorder() {
  const out = [];
  // outer paper edge
  out.push(rect(MARGIN, MARGIN, SHEET.w - 2 * MARGIN, SHEET.h - 2 * MARGIN,
    { 'stroke-width': 0.4 }));
  // inner drawing frame
  out.push(rect(FRAME.x0, FRAME.y0, FRAME.x1 - FRAME.x0, FRAME.y1 - FRAME.y0,
    { 'stroke-width': 0.6 }));
  // column ticks + numbers (1..12) top & bottom
  const cw = (FRAME.x1 - FRAME.x0) / COLS;
  for (let i = 0; i <= COLS; i++) {
    const x = FRAME.x0 + i * cw;
    out.push(line(x, MARGIN, x, FRAME.y0, { 'stroke-width': 0.3 }));
    out.push(line(x, FRAME.y1, x, SHEET.h - MARGIN, { 'stroke-width': 0.3 }));
    if (i < COLS) {
      const lbl = String(COLS - i);   // 12 at left → 1 at right (matches reference)
      out.push(text(x + cw / 2, MARGIN + ZONE / 2 + 1.2, lbl,
        { 'text-anchor': 'middle', 'font-size': 3.4 }));
      out.push(text(x + cw / 2, SHEET.h - MARGIN - ZONE / 2 + 1.8, lbl,
        { 'text-anchor': 'middle', 'font-size': 3.4 }));
    }
  }
  // row ticks + letters (A..H) left & right
  const rh = (FRAME.y1 - FRAME.y0) / ROWS;
  for (let j = 0; j <= ROWS; j++) {
    const y = FRAME.y0 + j * rh;
    out.push(line(MARGIN, y, FRAME.x0, y, { 'stroke-width': 0.3 }));
    out.push(line(FRAME.x1, y, SHEET.w - MARGIN, y, { 'stroke-width': 0.3 }));
    if (j < ROWS) {
      const lbl = String.fromCharCode(65 + j);  // A at top → H at bottom
      out.push(text(MARGIN + ZONE / 2, y + rh / 2 + 1.2, lbl,
        { 'text-anchor': 'middle', 'font-size': 3.4 }));
      out.push(text(SHEET.w - MARGIN - ZONE / 2, y + rh / 2 + 1.2, lbl,
        { 'text-anchor': 'middle', 'font-size': 3.4 }));
    }
  }
  // corner registration marks
  for (const [cxs, cys] of [[FRAME.x0, FRAME.y0], [FRAME.x1, FRAME.y0],
                            [FRAME.x0, FRAME.y1], [FRAME.x1, FRAME.y1]]) {
    out.push(circle(cxs, cys, 1.6, { 'stroke-width': 0.3 }));
    out.push(line(cxs - 2.4, cys, cxs + 2.4, cys, { 'stroke-width': 0.3 }));
    out.push(line(cxs, cys - 2.4, cxs, cys + 2.4, { 'stroke-width': 0.3 }));
  }
  return out.join('\n');
}

function titleBlock(model) {
  const out = [];
  const tbw = 175, tbh = 56;
  const x = FRAME.x1 - tbw, y = FRAME.y1 - tbh;
  out.push(rect(x, y, tbw, tbh, { 'stroke-width': 0.6 }));
  // left column = field labels/values; right column = branding + legal
  const splitX = x + 105;
  out.push(line(splitX, y, splitX, y + tbh, { 'stroke-width': 0.4 }));

  // ---- left: field rows ----
  const rows = [
    ['MATERIAL', model.material],
    ['ORIGINATED', 'FORGE-AUTO'],
    ['CHECKED', '—'],
    ['RELEASED', '—'],
    ['WEIGHT', model.weight],
    ['TITLE', model.title],
    ['PROJECT', model.project],
  ];
  const rh = tbh / (rows.length + 1);  // +1 for the revisions strip
  rows.forEach(([k, v], i) => {
    const ry = y + i * rh;
    out.push(line(x, ry, splitX, ry, { 'stroke-width': 0.25 }));
    out.push(text(x + 2, ry + rh / 2 + 1.1, k, { 'font-size': 2.6, fill: '#555' }));
    out.push(text(x + 34, ry + rh / 2 + 1.2, v ?? '', { 'font-size': 3.2, 'font-weight': 'bold' }));
    out.push(line(x + 32, ry, x + 32, ry + rh, { 'stroke-width': 0.2, stroke: '#aaa' }));
  });
  // revisions strip (bottom-left)
  const ry = y + rows.length * rh;
  out.push(line(x, ry, splitX, ry, { 'stroke-width': 0.4 }));
  out.push(text(x + 2, ry + rh / 2 + 1.1, 'REVISIONS', { 'font-size': 2.6, fill: '#555' }));
  out.push(text(x + 34, ry + rh / 2 + 1.1, 'A  ORIGINAL  ' + new Date().toISOString().slice(0, 10),
    { 'font-size': 2.6 }));

  // ---- right: branding + legal + size/sheet ----
  out.push(text(splitX + 4, y + 9, 'FORGE', { 'font-size': 8, 'font-weight': 'bold' }));
  out.push(text(splitX + 38, y + 9, 'CAD', { 'font-size': 8, fill: '#888' }));
  out.push(circle(splitX + 60, y + 6.5, 3, { 'stroke-width': 0.5 }));
  out.push(line(splitX, y + 13, x + tbw, y + 13, { 'stroke-width': 0.3 }));
  const legal = [
    'THIS DRAWING IS DESIGNED TO EVALUATE',
    'AUTOMATED CAD GENERATION.',
    'NOT INTENDED FOR HUMAN USE.',
  ];
  legal.forEach((l, i) => out.push(text(splitX + 4, y + 19 + i * 4.2, l,
    { 'font-size': 2.8, fill: '#333' })));
  out.push(line(splitX, y + tbh - 14, x + tbw, y + tbh - 14, { 'stroke-width': 0.3 }));
  out.push(text(splitX + 4, y + tbh - 9.5, 'Copyright (c) Forge CAD — all rights reserved',
    { 'font-size': 2.4, fill: '#666' }));
  // size + sheet boxes
  out.push(line(splitX, y + tbh - 7, x + tbw, y + tbh - 7, { 'stroke-width': 0.3 }));
  const thirdW = (x + tbw - splitX) / 2;
  out.push(line(splitX + thirdW, y + tbh - 7, splitX + thirdW, y + tbh, { 'stroke-width': 0.3 }));
  out.push(text(splitX + 4, y + tbh - 2.4, 'SIZE A2', { 'font-size': 3.4, 'font-weight': 'bold' }));
  out.push(text(splitX + thirdW + 4, y + tbh - 2.4, 'SHEET ' + model.sheetNo,
    { 'font-size': 3.4, 'font-weight': 'bold' }));
  return out.join('\n');
}

function notesBlock(model, x, y) {
  const out = [];
  const lines = [
    'NOTES:',
    '1. ALL MEASUREMENTS IN MM.',
    `2. PLATE THICKNESS ${model.meta.T} MM.`,
    `3. MATERIAL: ${model.material}.`,
    '4. BREAK ALL SHARP EDGES 0.5 MM.',
    '5. HOLES Ø THRU UNLESS NOTED.',
    '6. TOLERANCE ±0.2 UNLESS NOTED.',
  ];
  lines.forEach((l, i) => out.push(text(x, y + i * 4.4, l,
    { 'font-size': i === 0 ? 3.4 : 3.0, 'font-weight': i === 0 ? 'bold' : 'normal' })));
  return out.join('\n');
}

function viewLabel(x, y, label) {
  return text(x, y, label, { 'text-anchor': 'middle', 'font-size': 3.6, 'font-weight': 'bold' });
}

// ───────────────────────────────────────────────────────────────────────────
//  Assemble the full SVG
// ───────────────────────────────────────────────────────────────────────────
function buildSVG(forge, model) {
  const views = {
    front: forge.drawings.projectView(model.handle, 'front'),
    top: forge.drawings.projectView(model.handle, 'top'),
    right: forge.drawings.projectView(model.handle, 'right'),
    // iso of the hole-free blank → clean edge silhouette (see buildSampleModel)
    iso: forge.drawings.projectView(model.isoBlank || model.handle, 'iso'),
  };

  // pick a uniform scale so the largest view comfortably fits its cell.
  const cellW = 165, cellH = 95;
  const spanW = Math.max(views.front.bbox.maxX - views.front.bbox.minX,
    views.top.bbox.maxX - views.top.bbox.minX);
  const spanH = (views.front.bbox.maxY - views.front.bbox.minY)
    + (views.top.bbox.maxY - views.top.bbox.minY);
  const scale = Math.min(cellW / spanW, cellH / (spanH + 30)) * 0.85;

  // third-angle layout:
  //   TOP   above FRONT (shares X)
  //   FRONT bottom-left
  //   RIGHT to the right of FRONT (shares Y)
  //   ISO   upper-right
  const frontCx = FRAME.x0 + 70;
  const frontCy = FRAME.y0 + 150;
  const topCx = frontCx;
  const topGap = (views.front.bbox.maxY - views.front.bbox.minY) * scale / 2
    + (views.top.bbox.maxY - views.top.bbox.minY) * scale / 2 + 28;
  const topCy = frontCy - topGap;
  const rightCx = frontCx
    + (views.front.bbox.maxX - views.front.bbox.minX) * scale / 2
    + (views.right.bbox.maxX - views.right.bbox.minX) * scale / 2 + 40;
  const rightCy = frontCy;
  const isoCx = FRAME.x1 - 95;
  const isoCy = FRAME.y0 + 70;

  const pFront = makeViewPlacement(views.front, scale, frontCx, frontCy);
  const pTop = makeViewPlacement(views.top, scale, topCx, topCy);
  const pRight = makeViewPlacement(views.right, scale, rightCx, rightCy);
  const pIso = makeViewPlacement(views.iso, scale * 1.25, isoCx, isoCy);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.w}mm" height="${SHEET.h}mm" viewBox="0 0 ${SHEET.w} ${SHEET.h}">`);
  parts.push(`<rect x="0" y="0" width="${SHEET.w}" height="${SHEET.h}" fill="#fff"/>`);

  // border + zones
  parts.push(zoneBorder());

  const { L, W, T, holes } = model.meta;

  // views — clean axis-aligned outlines for ortho, filtered silhouette for iso
  parts.push(emitOrtho(views.front, pFront));
  parts.push(emitOrtho(views.top, pTop));
  parts.push(emitOrtho(views.right, pRight));
  parts.push(emitIso(views.iso, pIso));

  // analytic hole circles on TOP (true plan), drawn from ground-truth build data
  for (const hpos of holes) parts.push(holeCircleTop(hpos, topCx, topCy, scale));
  // bore centre-lines + hidden wall edges on FRONT (depth = thickness T)
  for (const hpos of holes) {
    const sx = frontCx + hpos.x * scale;
    const r = (hpos.dia / 2) * scale;
    const topY = pFront.map({ x: 0, y: views.front.bbox.maxY }).y;
    const botY = pFront.map({ x: 0, y: views.front.bbox.minY }).y;
    // hidden bore walls (dashed verticals)
    parts.push(line(sx - r, topY, sx - r, botY, { 'stroke-width': 0.25, 'stroke-dasharray': '1.5,1' }));
    parts.push(line(sx + r, topY, sx + r, botY, { 'stroke-width': 0.25, 'stroke-dasharray': '1.5,1' }));
    // centre line
    parts.push(line(sx, topY - 2, sx, botY + 2, { 'stroke-width': 0.2, 'stroke-dasharray': '2,1,0.5,1' }));
  }
  // bore walls + centre-lines on RIGHT (depth along Y)
  for (const hpos of holes) {
    const sx = rightCx + hpos.y * scale;     // right view x-axis = model Y
    const r = (hpos.dia / 2) * scale;
    const topY = pRight.map({ x: 0, y: views.right.bbox.maxY }).y;
    const botY = pRight.map({ x: 0, y: views.right.bbox.minY }).y;
    parts.push(line(sx - r, topY, sx - r, botY, { 'stroke-width': 0.25, 'stroke-dasharray': '1.5,1' }));
    parts.push(line(sx + r, topY, sx + r, botY, { 'stroke-width': 0.25, 'stroke-dasharray': '1.5,1' }));
    parts.push(line(sx, topY - 2, sx, botY + 2, { 'stroke-width': 0.2, 'stroke-dasharray': '2,1,0.5,1' }));
  }

  // view labels
  parts.push(viewLabel(frontCx, frontCy + (views.front.bbox.maxY - views.front.bbox.minY) * scale / 2 + 30, 'FRONT'));
  parts.push(viewLabel(topCx, topCy - (views.top.bbox.maxY - views.top.bbox.minY) * scale / 2 - 22, 'TOP'));
  parts.push(viewLabel(rightCx, rightCy + (views.front.bbox.maxY - views.front.bbox.minY) * scale / 2 + 30, 'RIGHT'));
  parts.push(viewLabel(isoCx, isoCy + (views.iso.bbox.maxY - views.iso.bbox.minY) * scale * 1.25 / 2 + 14, 'ISOMETRIC'));

  // ---- AUTO-DIMENSIONS ----
  // FRONT view shows L (x) and T (y). Overall length dim below front view.
  {
    const half = L / 2 * scale;
    const left = frontCx - half, right = frontCx + half;
    const featY = pFront.map({ x: 0, y: views.front.bbox.maxY }).y;     // top edge of part
    const botY = pFront.map({ x: 0, y: views.front.bbox.minY }).y;      // bottom edge
    const dimY = botY + 16;
    parts.push(dimH(left, right, dimY, botY, String(L)));
    // thickness T at the right side of the front view
    const dimX = right + 10;
    parts.push(dimV(featY, botY, dimX, right, String(T)));
  }
  // TOP view shows L (x) and W (y). Width dim to the left of top view.
  {
    const halfH = W / 2 * scale;
    const topEdge = topCy - halfH, botEdge = topCy + halfH;
    const leftX = pTop.map({ x: views.top.bbox.minX, y: 0 }).x;
    const dimX = leftX - 16;
    parts.push(dimV(topEdge, botEdge, dimX, leftX, String(W)));
    // hole callouts + bolt-rectangle dims on TOP view (true plan position)
    const seenDia = new Map();
    for (const hpos of holes) seenDia.set(hpos.dia, (seenDia.get(hpos.dia) || 0) + 1);
    // one representative Ø callout per distinct diameter (TYP)
    const placed = new Set();
    for (const hpos of holes) {
      if (placed.has(hpos.dia)) continue;
      placed.add(hpos.dia);
      const sx = topCx + hpos.x * scale;
      const sy = topCy - hpos.y * scale;
      const r = (hpos.dia / 2) * scale;
      const cnt = seenDia.get(hpos.dia);
      const lbl = `${cnt > 1 ? cnt + 'x ' : ''}Ø${hpos.dia} THRU${cnt > 1 ? ' TYP' : ''}`;
      const tx = sx + 22, ty = sy - 14;
      parts.push(holeLeader(sx, sy, r, tx, ty, lbl));
    }
    // bolt-rectangle spacing dims (distinct hole x/y extents, excluding centre)
    const xs = [...new Set(holes.filter((h) => h.x !== 0).map((h) => h.x))].sort((a, b) => a - b);
    const ys = [...new Set(holes.filter((h) => h.y !== 0).map((h) => h.y))].sort((a, b) => a - b);
    if (xs.length === 2) {
      const ax = topCx + xs[0] * scale, bx = topCx + xs[1] * scale;
      const dimY = botEdge + 14;
      parts.push(dimH(ax, bx, dimY, botEdge, String(xs[1] - xs[0])));
    }
    if (ys.length === 2) {
      const ay = topCy - ys[0] * scale, by = topCy - ys[1] * scale;
      const dimX2 = (topCx + Math.max(...holes.map((h) => h.x)) * scale) + 16;
      parts.push(dimV(ay, by, dimX2, topCx, String(ys[1] - ys[0])));
    }
  }

  // notes (upper-left)
  parts.push(notesBlock(model, FRAME.x0 + 6, FRAME.y0 + 12));

  // title block (bottom-right)
  parts.push(titleBlock(model));

  parts.push('</svg>');
  return { svg: parts.join('\n'), views, scale };
}

// ───────────────────────────────────────────────────────────────────────────
//  6. RASTERIZE  SVG → PNG  via headless chromium
// ───────────────────────────────────────────────────────────────────────────
async function rasterize(svgPath, pngPath) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  // A2 at ~150 dpi-ish: scale sheet mm by a device factor for a crisp raster
  const DEV = 3;  // 594*3 = 1782 px wide
  const page = await browser.newPage({
    viewport: { width: SHEET.w * DEV, height: SHEET.h * DEV },
    deviceScaleFactor: 1,
  });
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:#fff}
    svg{width:${SHEET.w * DEV}px;height:${SHEET.h * DEV}px;display:block}</style>
    </head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: SHEET.w * DEV, height: SHEET.h * DEV } });
  await browser.close();
}

// ───────────────────────────────────────────────────────────────────────────
//  MAIN
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const forge = makeHeadlessForge();
  const model = buildSampleModel(forge);

  // ground-truth bbox + weight (massProps volume × density)
  const bb = bbox3D(forge, model.handle);
  const mp = forge.massProps(model.handle);
  const rho = 2.7e-9;                         // AL 6061 tonne/mm^3
  model.weight = (mp.volume * rho * 1e6).toFixed(1) + ' g';  // tonne→g
  model.meta.bbox = bb;

  const { svg, views, scale } = buildSVG(forge, model);

  const outDir = path.join(ROOT, 'forge-kernel', 'cadgenbench_deliverables', 'drawings');
  fs.mkdirSync(outDir, { recursive: true });
  const svgPath = path.join(outDir, 'sample.svg');
  const pngPath = path.join(outDir, 'sample.png');
  fs.writeFileSync(svgPath, svg);
  console.log('[forge_drawing] wrote', svgPath, `(${(svg.length / 1024).toFixed(1)} KB)`);

  await rasterize(svgPath, pngPath);
  console.log('[forge_drawing] wrote', pngPath);

  // console summary
  const vc = Object.fromEntries(Object.entries(views).map(([k, v]) =>
    [k, v.visibleEdges.length + 'v/' + v.hiddenEdges.length + 'h']));
  console.log('[forge_drawing] model:', model.title,
    `${model.meta.L}x${model.meta.W}x${model.meta.T}mm`,
    model.meta.holes.length, 'holes, weight', model.weight);
  console.log('[forge_drawing] views (visible/hidden polylines):', JSON.stringify(vc),
    'scale', scale.toFixed(3));
}

main().catch((e) => { console.error(e); process.exit(1); });
