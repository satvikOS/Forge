/**
 * ArchDisc Drawing Workbench — Auxiliary / Crop / Broken view types.
 *
 * Lives in the drawing workbench. Self-contained per-view projection
 * machinery so we don't need to refactor `foundation/Drawing2D.js`
 * (whose only public export is the all-in-one `buildDrawingSVG`).
 *
 * Three first-class drawing-view operations, each producing a real
 * standalone SVG sheet that the existing DrawingPreviewPanel renders:
 *
 *   1. AUXILIARY VIEW — view projected perpendicular to a user-picked
 *      face/edge normal. Tags the parent FRONT view with an arrow
 *      pointing to the auxiliary view (SolidWorks convention).
 *
 *   2. CROP VIEW — base FRONT view clipped to a user-drawn rectangular
 *      boundary (axis-aligned in the parent view's paper-space). Uses
 *      SVG <clipPath> for reversible clipping.
 *
 *   3. BROKEN VIEW — long-shaft foreshortening: two break locations
 *      along the long axis split the projection into a left zone and
 *      a right zone; the middle is removed and replaced by a zig-zag
 *      break-line indicator. The drawn length equals
 *      (left part + right part) in scale.
 *
 * The implementation projects the manifold mesh' silhouette + crease
 * edges (same classification as foundation/Drawing2D.js but inlined
 * so we can plug arbitrary view directions). The math is identical;
 * see SOLIDWORKS-COURSE-SYNTHESIS Tier 8 #71-73 for the SW reference
 * UI conventions.
 */

// ───────────────────────────────────────────────────────────────────────────
// Mesh / linear-algebra helpers (kept private; mirrors Drawing2D internals
// so the SP-6 kernel agent can work on Drawing2D in parallel without
// us stepping on the foundation module).
// ───────────────────────────────────────────────────────────────────────────

const VISIBLE_LINE_WIDTH = 0.7;
const SMOOTH_THRESHOLD_DEG = 30;

function getVert(mesh, idx) {
  const off = idx * mesh.numProp;
  return [mesh.vertProperties[off], mesh.vertProperties[off + 1], mesh.vertProperties[off + 2]];
}
function computeNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v) { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/** Topological edge map: undirected edge -> incident triangle list w/ normals. */
function buildEdgeMap(mesh) {
  const edgeMap = new Map();
  const numTri = mesh.triVerts.length / 3;
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVert(mesh, i0);
    const p1 = getVert(mesh, i1);
    const p2 = getVert(mesh, i2);
    const n = computeNormal(p0, p1, p2);
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let entry = edgeMap.get(key);
      if (!entry) { entry = { vA: a, vB: b, tris: [] }; edgeMap.set(key, entry); }
      entry.tris.push({ tri: t, normal: n });
    }
  }
  return edgeMap;
}

/** View matrix from camera eye direction + up. eye is the +Z view axis. */
function buildViewMatrix(eye, up) {
  const z = normalize(eye);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return { x, y, z };
}
function projectPoint(p, view) {
  return [dot(p, view.x), dot(p, view.y), dot(p, view.z)];
}

/** Classify edges as silhouette + crease for a view direction. */
function classifyEdges(edgeMap, viewDir) {
  const silhouette = [];
  const crease = [];
  const creaseCos = Math.cos((SMOOTH_THRESHOLD_DEG * Math.PI) / 180);
  for (const e of edgeMap.values()) {
    if (e.tris.length === 1) { silhouette.push(e); continue; }
    const [t0, t1] = e.tris;
    const n0 = t0.normal, n1 = t1.normal;
    const f0 = dot(n0, viewDir);
    const f1 = dot(n1, viewDir);
    if (f0 * f1 < 0) silhouette.push(e);
    else if (dot(n0, n1) < creaseCos) crease.push(e);
  }
  return { silhouette, crease };
}

/**
 * Project every drawable edge to 2D paper coords. Returns a list of
 *   { x1, y1, x2, y2 }  (already paper-space, mm).
 * Y already flipped (SVG convention) so callers can drop them straight
 * into <line> elements.
 *
 *   eye  — projection direction in world space (camera looks DOWN +eye)
 *   up   — paper-up direction
 *   partOrigin — world-space point that becomes paper-origin
 *   paperScale — world mm to paper mm (typically < 1)
 */
function projectEdges(manifold, eye, up, partOrigin, paperScale) {
  const mesh = manifold.getMesh();
  const view = buildViewMatrix(eye, up);
  const edgeMap = buildEdgeMap(mesh);
  const { silhouette, crease } = classifyEdges(edgeMap, eye);
  const all = [...silhouette, ...crease];

  const drawn = new Set();
  const out = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const e of all) {
    const key = e.vA < e.vB ? `${e.vA},${e.vB}` : `${e.vB},${e.vA}`;
    if (drawn.has(key)) continue;
    drawn.add(key);

    const a = getVert(mesh, e.vA);
    const b = getVert(mesh, e.vB);
    const ap = projectPoint([a[0] - partOrigin[0], a[1] - partOrigin[1], a[2] - partOrigin[2]], view);
    const bp = projectPoint([b[0] - partOrigin[0], b[1] - partOrigin[1], b[2] - partOrigin[2]], view);

    const x1 = ap[0] * paperScale;
    const y1 = -ap[1] * paperScale;  // flip Y for SVG (paper y grows downward)
    const x2 = bp[0] * paperScale;
    const y2 = -bp[1] * paperScale;
    out.push({ x1, y1, x2, y2 });

    if (x1 < minX) minX = x1; if (x2 < minX) minX = x2;
    if (x1 > maxX) maxX = x1; if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1; if (y2 < minY) minY = y2;
    if (y1 > maxY) maxY = y1; if (y2 > maxY) maxY = y2;
  }

  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0; }
  return { edges: out, bbox: { minX, minY, maxX, maxY } };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ───────────────────────────────────────────────────────────────────────────
// Public API — each view type produces a standalone SVG drawing sheet.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Auxiliary View — projects the body along a direction normal to a
 * caller-specified face/edge. The view is drawn on an A4 sheet next
 * to a smaller FRONT-view thumbnail; an arrow on the FRONT view
 * points along the auxiliary projection direction (SolidWorks
 * convention). Per ASME the auxiliary view is labelled with a letter
 * (default 'A') matching the arrow.
 *
 * Args:
 *   manifold — foundation Manifold body
 *   normal   — { x, y, z } face/edge normal in world space (must be unit-length-ish)
 *   options  — { name, label = 'A', up = [0,0,1] }
 *
 * Returns:
 *   { svg, info: { auxBBox, frontBBox, projection: {nx,ny,nz}, edgeCount } }
 */
export function auxiliaryView(manifold, normal, options = {}) {
  const label = options.label || 'A';
  const partName = options.name || 'Untitled Part';
  const date = options.date || new Date().toISOString().slice(0, 10);
  const upHint = options.up || [0, 0, 1];

  // Sanitise + normalise the projection direction.
  let n = [normal.x, normal.y, normal.z];
  const nl = Math.hypot(...n);
  if (!Number.isFinite(nl) || nl < 1e-9) n = [0, 1, 0];
  else n = [n[0] / nl, n[1] / nl, n[2] / nl];

  // Choose an "up" direction that isn't parallel to n. Fall back to global Z
  // (then X) if the chosen up is degenerate.
  let up = upHint;
  const uDot = Math.abs(dot(normalize(up), n));
  if (uDot > 0.97) {
    up = [1, 0, 0];
    if (Math.abs(dot(normalize(up), n)) > 0.97) up = [0, 1, 0];
  }

  // Part bounds for scale + origin.
  const bb = manifold.boundingBox();
  const partOrigin = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const partExtent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);

  // Sheet geometry: A4 landscape, FRONT view on the left (small), AUXILIARY
  // view on the right (primary). Each view gets ~120 × 100 mm; pick a paper
  // scale that fits the part bounding box.
  const SVG_W = 297, SVG_H = 210;
  const auxBoxW = 150, auxBoxH = 140;
  const frontBoxW = 90, frontBoxH = 100;
  const paperScale = Math.min(0.8 * auxBoxW / (partExtent * 1.4), 0.8 * auxBoxH / (partExtent * 1.4), 1);

  // FRONT view at world +Y (matches Drawing2D convention).
  const front = projectEdges(manifold, [0, -1, 0], [0, 0, 1], partOrigin, paperScale);
  // AUXILIARY view along the picked normal.
  const aux = projectEdges(manifold, n, up, partOrigin, paperScale);

  const frontOriginX = 30 + frontBoxW / 2 - (front.bbox.minX + front.bbox.maxX) / 2;
  const frontOriginY = 60 + frontBoxH / 2 - (front.bbox.minY + front.bbox.maxY) / 2;
  const auxOriginX = 135 + auxBoxW / 2 - (aux.bbox.minX + aux.bbox.maxX) / 2;
  const auxOriginY = 50 + auxBoxH / 2 - (aux.bbox.minY + aux.bbox.maxY) / 2;

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="auxiliary">`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // FRONT view + bounding-box rectangle around the slot.
  out.push(`<g class="view view-front" data-view-name="front" transform="translate(${frontOriginX.toFixed(3)},${frontOriginY.toFixed(3)})">`);
  for (const e of front.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push(`<text x="${(front.bbox.minX).toFixed(3)}" y="${(front.bbox.minY - 3).toFixed(3)}" font-family="monospace" font-size="4" fill="#222">FRONT</text>`);
  out.push('</g>');

  // Auxiliary projection arrow on the FRONT view — drawn in paper coords so
  // it's anchored to the FRONT view group. The arrow shows the direction of
  // the auxiliary projection in PAPER space, i.e. the projection of n into
  // the FRONT view's paper plane.
  const frontView = buildViewMatrix([0, -1, 0], [0, 0, 1]);
  const nFrontPaperX = dot(n, frontView.x);
  const nFrontPaperY = -dot(n, frontView.y);  // flip y for SVG
  const arrowLen = Math.min(frontBoxW, frontBoxH) * 0.35;
  const arrowMag = Math.hypot(nFrontPaperX, nFrontPaperY) || 1;
  const ax = (nFrontPaperX / arrowMag) * arrowLen;
  const ay = (nFrontPaperY / arrowMag) * arrowLen;
  // Anchor at the centre of the FRONT view.
  const frCx = (front.bbox.minX + front.bbox.maxX) / 2;
  const frCy = (front.bbox.minY + front.bbox.maxY) / 2;
  const frx2 = frCx + ax, fry2 = frCy + ay;
  // Arrow head — two short strokes forming a chevron.
  const headLen = 3;
  const headSpread = 1.6;
  const arrLen = Math.hypot(frx2 - frCx, fry2 - frCy) || 1;
  const ux = (frx2 - frCx) / arrLen, uy = (fry2 - frCy) / arrLen;
  const perpX = -uy, perpY = ux;
  const hx1 = frx2 - ux * headLen + perpX * headSpread;
  const hy1 = fry2 - uy * headLen + perpY * headSpread;
  const hx2 = frx2 - ux * headLen - perpX * headSpread;
  const hy2 = fry2 - uy * headLen - perpY * headSpread;
  out.push(`<g class="aux-arrow" data-aux-arrow="${label}" transform="translate(${frontOriginX.toFixed(3)},${frontOriginY.toFixed(3)})">`);
  out.push(`<line x1="${frCx.toFixed(3)}" y1="${frCy.toFixed(3)}" x2="${frx2.toFixed(3)}" y2="${fry2.toFixed(3)}" stroke="#b54214" stroke-width="0.6"/>`);
  out.push(`<line x1="${frx2.toFixed(3)}" y1="${fry2.toFixed(3)}" x2="${hx1.toFixed(3)}" y2="${hy1.toFixed(3)}" stroke="#b54214" stroke-width="0.6"/>`);
  out.push(`<line x1="${frx2.toFixed(3)}" y1="${fry2.toFixed(3)}" x2="${hx2.toFixed(3)}" y2="${hy2.toFixed(3)}" stroke="#b54214" stroke-width="0.6"/>`);
  out.push(`<text x="${(frx2 + ux * 3).toFixed(3)}" y="${(fry2 + uy * 3 + 2).toFixed(3)}" font-family="monospace" font-size="5" font-weight="bold" fill="#b54214">${esc(label)}</text>`);
  out.push('</g>');

  // AUXILIARY view (the projection itself).
  out.push(`<g class="view view-auxiliary" data-view-name="auxiliary" transform="translate(${auxOriginX.toFixed(3)},${auxOriginY.toFixed(3)})">`);
  for (const e of aux.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push(`<text x="${(aux.bbox.minX).toFixed(3)}" y="${(aux.bbox.minY - 3).toFixed(3)}" font-family="monospace" font-size="5" font-weight="bold" fill="#222">VIEW ${esc(label)}-${esc(label)} (AUX)</text>`);
  out.push('</g>');

  // Title block — small ASME footer.
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">Auxiliary View ${esc(label)}  normal: (${n[0].toFixed(3)}, ${n[1].toFixed(3)}, ${n[2].toFixed(3)})</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  Scale ${paperScale.toFixed(3)}:1  A4 ISO</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      auxBBox: aux.bbox,
      frontBBox: front.bbox,
      projection: { x: n[0], y: n[1], z: n[2] },
      label,
      edgeCount: aux.edges.length,
      frontEdgeCount: front.edges.length,
      paperScale,
    },
  };
}

/**
 * Crop View — base FRONT projection clipped to a caller-specified
 * rectangular boundary in WORLD-mm coordinates of the FRONT view's
 * paper space. The boundary is rendered as a viewport box; only edges
 * inside (or crossing into) the box are drawn. SVG <clipPath> handles
 * the precise clip so partial-cross edges are visually trimmed at the
 * boundary too.
 *
 * Args:
 *   manifold — foundation Manifold body
 *   crop     — { x, y, w, h }  rectangle in PAPER-mm (relative to the
 *              FRONT view's paper origin). The CROP-VIEW system stores
 *              this so a future Uncrop op can restore the full view.
 *   options  — { name }
 *
 * Returns:
 *   { svg, info: { bbox, crop, edgeCount, originalEdgeCount } }
 */
export function cropView(manifold, crop, options = {}) {
  const partName = options.name || 'Untitled Part';
  const date = options.date || new Date().toISOString().slice(0, 10);

  const bb = manifold.boundingBox();
  const partOrigin = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const partExtent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);

  const SVG_W = 297, SVG_H = 210;
  const boxW = 220, boxH = 160;
  const paperScale = Math.min(0.85 * boxW / (partExtent * 1.4), 0.85 * boxH / (partExtent * 1.4), 1);

  const front = projectEdges(manifold, [0, -1, 0], [0, 0, 1], partOrigin, paperScale);

  // Default crop: middle 50% of the view bounding box.
  let c = crop;
  if (!c) {
    const w = front.bbox.maxX - front.bbox.minX;
    const h = front.bbox.maxY - front.bbox.minY;
    c = { x: front.bbox.minX + w * 0.25, y: front.bbox.minY + h * 0.25, w: w * 0.5, h: h * 0.5 };
  }

  // Centre the view on the sheet.
  const originX = 35 + boxW / 2 - (front.bbox.minX + front.bbox.maxX) / 2;
  const originY = 30 + boxH / 2 - (front.bbox.minY + front.bbox.maxY) / 2;

  // Edges inside or crossing the crop rectangle.
  let inside = 0, crossing = 0;
  const clipBoxXmin = c.x, clipBoxYmin = c.y;
  const clipBoxXmax = c.x + c.w, clipBoxYmax = c.y + c.h;
  for (const e of front.edges) {
    const aInside = e.x1 >= clipBoxXmin && e.x1 <= clipBoxXmax && e.y1 >= clipBoxYmin && e.y1 <= clipBoxYmax;
    const bInside = e.x2 >= clipBoxXmin && e.x2 <= clipBoxXmax && e.y2 >= clipBoxYmin && e.y2 <= clipBoxYmax;
    if (aInside && bInside) inside++;
    else if (aInside !== bInside) crossing++;
  }

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="crop">`);
  out.push('<defs>');
  out.push(`<clipPath id="archdisc-crop-clip" clipPathUnits="userSpaceOnUse">`);
  out.push(`<rect x="${(originX + c.x).toFixed(3)}" y="${(originY + c.y).toFixed(3)}" width="${c.w.toFixed(3)}" height="${c.h.toFixed(3)}"/>`);
  out.push('</clipPath>');
  out.push('</defs>');
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // Ghost: the full FRONT view drawn faintly so we can see what was cropped.
  out.push(`<g class="view view-front-ghost" data-view-name="front-ghost" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of front.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="#dadada" stroke-width="0.25" stroke-dasharray="0.5,0.8"/>`);
  }
  out.push('</g>');

  // Cropped (real) FRONT view — clipped by the boundary.
  out.push(`<g class="view view-front-cropped" data-view-name="cropped" clip-path="url(#archdisc-crop-clip)" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of front.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push('</g>');

  // The crop boundary — drawn over the clipped view as a teal box.
  out.push(`<g class="crop-boundary" data-crop-boundary="rect">`);
  out.push(`<rect x="${(originX + c.x).toFixed(3)}" y="${(originY + c.y).toFixed(3)}" width="${c.w.toFixed(3)}" height="${c.h.toFixed(3)}" fill="none" stroke="#0a6e8a" stroke-width="0.5" stroke-dasharray="2,1.5"/>`);
  out.push(`<text x="${(originX + c.x + 2).toFixed(3)}" y="${(originY + c.y + 4).toFixed(3)}" font-family="monospace" font-size="3" fill="#0a6e8a">CROP</text>`);
  out.push(`</g>`);

  // Title block.
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">Crop View  boundary ${c.w.toFixed(1)} × ${c.h.toFixed(1)} mm</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  Scale ${paperScale.toFixed(3)}:1  A4 ISO</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      bbox: front.bbox,
      crop: c,
      originalEdgeCount: front.edges.length,
      edgesInside: inside,
      edgesCrossing: crossing,
      paperScale,
    },
  };
}

/**
 * Broken View — foreshortened drawing for a long part. Two break-cut
 * locations `breakStart` and `breakEnd` (in PAPER-mm of the FRONT view's
 * paper space) split the projection into a left zone and right zone.
 * Middle is removed; right zone shifts left by (breakEnd - breakStart).
 * A zig-zag indicator is drawn at the join (SolidWorks convention).
 *
 * Args:
 *   manifold — foundation Manifold body
 *   breakStart, breakEnd — paper-mm X positions of the cut (breakEnd > breakStart)
 *   options  — { name, axis = 'x' }   axis along which the part is long
 *
 * Returns:
 *   { svg, info: { fullLength, gapLength, finalLength, leftEdgeCount, rightEdgeCount } }
 */
export function brokenView(manifold, breakStart, breakEnd, options = {}) {
  const partName = options.name || 'Untitled Part';
  const date = options.date || new Date().toISOString().slice(0, 10);
  const axis = options.axis === 'y' ? 'y' : 'x';  // currently x-axis breaks only

  const bb = manifold.boundingBox();
  const partOrigin = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const partExtent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);

  const SVG_W = 297, SVG_H = 210;
  const boxW = 250, boxH = 90;
  const paperScale = Math.min(0.85 * boxW / (partExtent * 1.4), 0.85 * boxH / (partExtent * 1.4), 1);

  const front = projectEdges(manifold, [0, -1, 0], [0, 0, 1], partOrigin, paperScale);

  // Validate break range.
  let bs = Math.min(breakStart, breakEnd);
  let be = Math.max(breakStart, breakEnd);
  const fullMinX = front.bbox.minX, fullMaxX = front.bbox.maxX;
  if (bs <= fullMinX || be >= fullMaxX) {
    // Default: hide the middle third.
    const w = fullMaxX - fullMinX;
    bs = fullMinX + w * 0.40;
    be = fullMinX + w * 0.60;
  }
  const gap = be - bs;
  const fullW = fullMaxX - fullMinX;
  const finalW = fullW - gap;

  // Clip + shift each edge: keep edges left of bs as-is; edges right of be
  // shift left by gap; edges crossing the break boundary are clipped at the
  // boundary line. We keep partial edges on each side.
  const leftEdges = [];
  const rightEdges = [];

  for (const e of front.edges) {
    const x1 = e.x1, y1 = e.y1, x2 = e.x2, y2 = e.y2;
    const ax = axis === 'x' ? x1 : y1;
    const bx = axis === 'x' ? x2 : y2;
    // Both fully on left
    if (ax <= bs && bx <= bs) { leftEdges.push({ x1, y1, x2, y2 }); continue; }
    // Both fully on right
    if (ax >= be && bx >= be) {
      rightEdges.push({ x1: x1 - gap, y1, x2: x2 - gap, y2 });
      continue;
    }
    // Both inside the gap → drop.
    if (ax > bs && ax < be && bx > bs && bx < be) continue;

    // Edge crosses the boundary(s). Compute the segment-vs-boundary intersection
    // and split.
    const segStart = { x: x1, y: y1, ax: ax };
    const segEnd = { x: x2, y: y2, ax: bx };

    // Intersect against vertical lines x = bs and x = be (or y for axis='y').
    const lerp = (t) => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    const denom = bx - ax;
    if (Math.abs(denom) < 1e-9) continue;
    const tStart = (bs - ax) / denom;
    const tEnd = (be - ax) / denom;

    // Left fragment: from the endpoint with ax <= bs to the crossing at bs.
    if (segStart.ax <= bs || segEnd.ax <= bs) {
      const tFromLeft = segStart.ax <= bs ? 0 : 1;
      const tCrossLeft = Math.min(1, Math.max(0, tStart));
      if (tFromLeft !== tCrossLeft) {
        const pa = lerp(tFromLeft), pb = lerp(tCrossLeft);
        leftEdges.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
      }
    }
    // Right fragment.
    if (segStart.ax >= be || segEnd.ax >= be) {
      const tFromRight = segStart.ax >= be ? 0 : 1;
      const tCrossRight = Math.min(1, Math.max(0, tEnd));
      if (tFromRight !== tCrossRight) {
        const pa = lerp(tFromRight), pb = lerp(tCrossRight);
        rightEdges.push({ x1: pa.x - gap, y1: pa.y, x2: pb.x - gap, y2: pb.y });
      }
    }
  }

  // Position on the sheet (centre the foreshortened drawing horizontally).
  const originX = 25 + boxW / 2 - (front.bbox.minX + (fullMaxX - gap) - front.bbox.minX) / 2;
  const originY = 50 + boxH / 2 - (front.bbox.minY + front.bbox.maxY) / 2;

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="broken">`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // Drawn left + right zones.
  out.push(`<g class="view view-broken-left" data-view-name="broken-left" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of leftEdges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push('</g>');
  out.push(`<g class="view view-broken-right" data-view-name="broken-right" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of rightEdges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push('</g>');

  // Zigzag break-line indicator at the join (between left zone and shifted right zone).
  // Join X (paper-mm relative to group origin) is `bs` — the left zone ends at bs;
  // the right zone (post-shift) starts at bs too.
  const joinX = bs;
  const breakTopY = front.bbox.minY - 2;
  const breakBotY = front.bbox.maxY + 2;
  const segs = 8;
  const zigW = 2.0;
  const breakPts = [];
  for (let i = 0; i <= segs; i++) {
    const ty = breakTopY + (breakBotY - breakTopY) * (i / segs);
    const tx = joinX + ((i % 2 === 0) ? -zigW : zigW);
    breakPts.push(`${tx.toFixed(3)},${ty.toFixed(3)}`);
  }
  out.push(`<g class="break-line" data-break-line="zigzag" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  out.push(`<polyline points="${breakPts.join(' ')}" fill="none" stroke="#7a3614" stroke-width="0.6"/>`);
  out.push(`<text x="${(joinX + 2).toFixed(3)}" y="${(breakBotY + 4).toFixed(3)}" font-family="monospace" font-size="3" fill="#7a3614">BREAK</text>`);
  out.push('</g>');

  // Length annotation — show full length, gap length, drawn length.
  out.push(`<text x="${(originX + front.bbox.minX).toFixed(3)}" y="${(originY + front.bbox.minY - 6).toFixed(3)}" font-family="monospace" font-size="3.5" fill="#222">`);
  out.push(`Full ${(fullW / paperScale).toFixed(1)} mm  |  Hidden ${(gap / paperScale).toFixed(1)} mm  |  Drawn ${(finalW / paperScale).toFixed(1)} mm</text>`);

  // Title block.
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">Broken View  drawn ${(finalW / paperScale).toFixed(1)}mm = ${((bs - fullMinX) / paperScale).toFixed(1)} + ${((fullMaxX - be) / paperScale).toFixed(1)} (world mm)</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  Scale ${paperScale.toFixed(3)}:1  A4 ISO</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      fullLength: fullW / paperScale,
      gapLength: gap / paperScale,
      finalLength: finalW / paperScale,
      leftLength: (bs - fullMinX) / paperScale,
      rightLength: (fullMaxX - be) / paperScale,
      leftEdgeCount: leftEdges.length,
      rightEdgeCount: rightEdges.length,
      originalEdgeCount: front.edges.length,
      paperScale,
      breakStart: bs,
      breakEnd: be,
      axis,
    },
  };
}

export default { auxiliaryView, cropView, brokenView };
