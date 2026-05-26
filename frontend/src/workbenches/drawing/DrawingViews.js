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

// ───────────────────────────────────────────────────────────────────────────
// UX Tier 8b — Model Items + BOM + Auto-Balloon
// ───────────────────────────────────────────────────────────────────────────

/**
 * Model Items — auto-import the 3D part's dimensions onto a drawing view.
 *
 * SolidWorks convention: the 3D model carries dimensions (from sketches +
 * features); Model Items projects every parametric dimension onto the
 * active view, attached via leader lines to a heuristic anchor point.
 *
 * Algorithm: for every feature in the part's construction history
 * (Part.features array from kernel/atomic/Part.js), extract one or
 * more "dimension" records. Each record has:
 *   { kind, value_mm, label, leader: { x1,y1, x2,y2 }, textPos: {x,y} }
 *
 * Supported feature → dimension extraction:
 *   sketchRectangle → 2 dims (Width, Height)
 *   sketchCircle    → 1 dim  (Ø Radius·2)
 *   extrude         → 1 dim  (Extrude Depth)
 *   cut             → 1 dim  (Cut Depth)
 *   revolve         → 1 dim  (Revolve Angle)
 *   fillet          → 1 dim  (Fillet Radius)
 *   circularPattern → 2 dims (Count, Angle)
 *   linearPattern   → 2 dims (Count, Pitch)
 *
 * Args:
 *   manifold — foundation Manifold body (used for FRONT-view projection)
 *   features — array of {type, params} from Part.features (or compatible)
 *   options  — { name, viewKind = 'front', startLabelIndex = 1 }
 *
 * Returns:
 *   { svg, info: { dimensions, dimensionCount, unsupportedFeatures, edgeCount } }
 */
export function modelItems(manifold, features, options = {}) {
  const partName = options.name || 'Untitled Part';
  const date = options.date || new Date().toISOString().slice(0, 10);
  const viewKind = options.viewKind || 'front';

  const bb = manifold.boundingBox();
  const partOrigin = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const partExtent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;

  const SVG_W = 297, SVG_H = 210;
  const boxW = 200, boxH = 140;
  const paperScale = Math.min(0.75 * boxW / (partExtent * 1.4), 0.75 * boxH / (partExtent * 1.4), 1);

  // FRONT projection: eye = -Y, up = +Z, world-X → paper-X, world-Z → paper-Y (up).
  const front = projectEdges(manifold, [0, -1, 0], [0, 0, 1], partOrigin, paperScale);
  const viewCx = (front.bbox.minX + front.bbox.maxX) / 2;
  const viewCy = (front.bbox.minY + front.bbox.maxY) / 2;
  const viewW = front.bbox.maxX - front.bbox.minX;
  const viewH = front.bbox.maxY - front.bbox.minY;

  const originX = 35 + boxW / 2 - viewCx;
  const originY = 30 + boxH / 2 - viewCy;

  // Walk features → produce dimensions. The leader-line anchor placement
  // uses a deterministic round-robin around the view's bounding rectangle
  // so dimensions don't visually pile up. Each new dim picks the next
  // slot around the edge (top/right/bottom/left rotated) — SolidWorks
  // does fancier "auto-arrange to nearest feature" but this is honest,
  // visible, and won't pretend to find the exact feature triangle.
  const dimensions = [];
  const unsupported = [];
  let slotIdx = 0;
  const NUM_SLOTS = 12;
  const slotPos = (i) => {
    // 12 slots: 3 top, 3 right, 3 bottom, 3 left, evenly spaced. Each
    // SIDE's slots are staggered in the perpendicular direction so the
    // labels don't pile up when the view is small relative to the label
    // text — e.g. on the top, each of the 3 slots sits at a different
    // vertical distance from the view edge.
    const ring = i % NUM_SLOTS;
    const side = Math.floor(ring / 3);
    const slotN = ring % 3;
    const offset = (slotN + 1) / 4;  // 0.25 / 0.5 / 0.75 along edge
    const pad = 8 + slotN * 6;       // stagger perpendicular distance
    if (side === 0) {
      // top
      return {
        anchor: { x: front.bbox.minX + viewW * offset, y: front.bbox.minY },
        text:   { x: front.bbox.minX + viewW * offset, y: front.bbox.minY - pad - 1 },
        leader: { x1: front.bbox.minX + viewW * offset, y1: front.bbox.minY,
                  x2: front.bbox.minX + viewW * offset, y2: front.bbox.minY - pad },
        anchorAt: 'top',
      };
    } else if (side === 1) {
      return {
        anchor: { x: front.bbox.maxX, y: front.bbox.minY + viewH * offset },
        text:   { x: front.bbox.maxX + pad + 1, y: front.bbox.minY + viewH * offset + 1 },
        leader: { x1: front.bbox.maxX, y1: front.bbox.minY + viewH * offset,
                  x2: front.bbox.maxX + pad, y2: front.bbox.minY + viewH * offset },
        anchorAt: 'right',
      };
    } else if (side === 2) {
      return {
        anchor: { x: front.bbox.minX + viewW * offset, y: front.bbox.maxY },
        text:   { x: front.bbox.minX + viewW * offset, y: front.bbox.maxY + pad + 3 },
        leader: { x1: front.bbox.minX + viewW * offset, y1: front.bbox.maxY,
                  x2: front.bbox.minX + viewW * offset, y2: front.bbox.maxY + pad },
        anchorAt: 'bottom',
      };
    } else {
      return {
        anchor: { x: front.bbox.minX, y: front.bbox.minY + viewH * offset },
        text:   { x: front.bbox.minX - pad - 14, y: front.bbox.minY + viewH * offset + 1 },
        leader: { x1: front.bbox.minX, y1: front.bbox.minY + viewH * offset,
                  x2: front.bbox.minX - pad, y2: front.bbox.minY + viewH * offset },
        anchorAt: 'left',
      };
    }
  };

  const pushDim = (kind, value_mm, label) => {
    const slot = slotPos(slotIdx++);
    dimensions.push({
      id: `dim-${dimensions.length + 1}`,
      kind,
      value_mm,
      label,
      anchor: slot.anchor,
      textPos: slot.text,
      leader:  slot.leader,
      anchorAt: slot.anchorAt,
    });
  };

  for (const f of (features || [])) {
    if (!f || !f.type) continue;
    const t = f.type;
    const p = f.params || {};
    switch (t) {
      case 'sketchRectangle': {
        if (p.w > 0) pushDim('width',  p.w, `${p.w.toFixed(1)} mm`);
        if (p.h > 0) pushDim('height', p.h, `${p.h.toFixed(1)} mm`);
        break;
      }
      case 'sketchCircle': {
        if (p.r > 0) pushDim('diameter', p.r * 2, `Ø${(p.r * 2).toFixed(1)} mm`);
        break;
      }
      case 'extrude':
      case 'extrudeRect':
      case 'extrudeCircle': {
        if (p.distance > 0 || p.depth > 0) {
          const v = p.distance ?? p.depth;
          pushDim('depth', v, `${v.toFixed(1)} mm depth`);
        }
        break;
      }
      case 'cut': {
        if (p.distance > 0) pushDim('cut-depth', p.distance, `${p.distance.toFixed(1)} mm cut`);
        break;
      }
      case 'revolve': {
        if (p.degrees > 0) pushDim('angle', p.degrees, `${p.degrees.toFixed(0)}°`);
        break;
      }
      case 'fillet':
      case 'filletAll': {
        if (p.radius > 0) pushDim('radius', p.radius, `R${p.radius.toFixed(1)} mm`);
        break;
      }
      case 'chamfer': {
        if (p.distance > 0) pushDim('chamfer', p.distance, `${p.distance.toFixed(1)} mm × 45°`);
        break;
      }
      case 'circularPattern': {
        if (p.count >= 1) pushDim('count', p.count, `${p.count}×`);
        if (p.angle > 0) pushDim('pattern-angle', p.angle, `${p.angle.toFixed(0)}°`);
        break;
      }
      case 'linearPattern': {
        if (p.count >= 1) pushDim('count', p.count, `${p.count}×`);
        if (Number.isFinite(p.dx) || Number.isFinite(p.dy)) {
          const pitch = Math.hypot(p.dx || 0, p.dy || 0);
          if (pitch > 0) pushDim('pitch', pitch, `pitch ${pitch.toFixed(1)} mm`);
        }
        break;
      }
      case 'startSketch':
      case 'finishSketch':
        break;  // bookkeeping ops carry no dimension
      default:
        unsupported.push(t);
        break;
    }
  }

  // Render the SVG sheet.
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="model-items" data-dim-count="${dimensions.length}">`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // FRONT projection — the host view.
  out.push(`<g class="view view-front" data-view-name="front" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of front.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push('</g>');

  // Dimension overlay group — leader lines + text labels.
  out.push(`<g class="model-items" data-archdisc-model-items="${dimensions.length}" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const d of dimensions) {
    // Leader line
    out.push(`<line data-dim-id="${d.id}" data-dim-kind="${d.kind}" x1="${d.leader.x1.toFixed(3)}" y1="${d.leader.y1.toFixed(3)}" x2="${d.leader.x2.toFixed(3)}" y2="${d.leader.y2.toFixed(3)}" stroke="#1c5fa1" stroke-width="0.35"/>`);
    // Anchor dot
    out.push(`<circle cx="${d.anchor.x.toFixed(3)}" cy="${d.anchor.y.toFixed(3)}" r="0.4" fill="#1c5fa1"/>`);
    // Text label — anchored by side
    let textAnchor = 'middle';
    if (d.anchorAt === 'right') textAnchor = 'start';
    else if (d.anchorAt === 'left') textAnchor = 'start';
    out.push(`<text x="${d.textPos.x.toFixed(3)}" y="${d.textPos.y.toFixed(3)}" font-family="monospace" font-size="3" fill="#1c5fa1" text-anchor="${textAnchor}">${esc(d.label)}</text>`);
  }
  out.push('</g>');

  // Title block
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">Model Items  ${dimensions.length} dim(s) from ${features?.length || 0} feature(s)</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  Scale ${paperScale.toFixed(3)}:1  View ${esc(viewKind.toUpperCase())}</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      bbox: front.bbox,
      dimensions,
      dimensionCount: dimensions.length,
      featureCount: features?.length || 0,
      unsupportedFeatures: unsupported,
      edgeCount: front.edges.length,
      paperScale,
    },
  };
}

/**
 * BOM (Bill of Materials) — table listing every component in an assembly.
 *
 * SolidWorks convention: rows = components, columns = Item No / Part No /
 * Description / Quantity / Material. Each row is auto-populated from the
 * assembly's component list + the per-body attributes that the SP-2-style
 * attribute system (BodyRegistry.attachAttribute) carries.
 *
 * The BOM is rendered as a real SVG table on the sheet — ready to be
 * referenced by the Auto-Balloon op.
 *
 * Args:
 *   components — array of { name, partNumber, description, material,
 *                           quantity, manifold? }. `manifold` is optional
 *                           but used by Auto-Balloon for anchor placement.
 *   options    — { name (assembly title), date, mergeByPartNumber = true }
 *
 * Returns:
 *   { svg, info: { rows, rowCount, partNumbers, totalQty } }
 */
export function bom(components, options = {}) {
  const partName = options.name || 'Untitled Assembly';
  const date = options.date || new Date().toISOString().slice(0, 10);
  const merge = options.mergeByPartNumber !== false;

  // Build rows. Optionally merge by partNumber so 4 identical fasteners
  // produce ONE BOM row with quantity 4 (SolidWorks does this).
  const rows = [];
  const byPN = new Map();
  for (const c of (components || [])) {
    if (!c) continue;
    const pn   = c.partNumber || c.name || 'PN-?';
    const desc = c.description || c.name || '';
    const mat  = c.material || '-';
    const qty  = Number.isFinite(c.quantity) && c.quantity > 0 ? c.quantity : 1;
    if (merge && byPN.has(pn)) {
      const existing = byPN.get(pn);
      existing.quantity += qty;
      if (c.manifold) existing.manifolds.push(c.manifold);
      if (c.name) existing.componentNames.push(c.name);
    } else {
      const row = {
        itemNo: rows.length + 1,
        partNumber: pn,
        description: desc,
        material: mat,
        quantity: qty,
        manifolds: c.manifold ? [c.manifold] : [],
        componentNames: c.name ? [c.name] : [],
      };
      rows.push(row);
      byPN.set(pn, row);
    }
  }

  // Sheet geometry: A3 landscape would crowd this; use A4 landscape and put
  // the BOM table on the right edge. (The Auto-Balloon op re-emits a fresh
  // sheet that anchors balloons to the front-view projection alongside.)
  const SVG_W = 297, SVG_H = 210;
  const tableX = 110, tableY = 40;
  const colWidths = [12, 38, 70, 26, 32];  // Item / PN / Desc / Qty / Material
  const tableW = colWidths.reduce((a, b) => a + b, 0);
  const rowH = 8;
  const headerH = 10;

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="bom" data-bom-rows="${rows.length}">`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // Title bar across the top.
  out.push(`<text x="${SVG_W / 2}" y="20" font-family="monospace" font-size="6" font-weight="bold" fill="#222" text-anchor="middle">BILL OF MATERIALS</text>`);
  out.push(`<text x="${SVG_W / 2}" y="28" font-family="monospace" font-size="3.5" fill="#444" text-anchor="middle">${esc(partName)}</text>`);

  // Table frame.
  const tableH = headerH + rows.length * rowH;
  out.push(`<g class="bom-table" data-archdisc-bom-table="${rows.length}">`);
  out.push(`<rect x="${tableX}" y="${tableY}" width="${tableW}" height="${tableH}" fill="white" stroke="black" stroke-width="0.5"/>`);

  // Header row.
  let cx = tableX;
  const headers = ['Item', 'Part Number', 'Description', 'Qty', 'Material'];
  for (let i = 0; i < headers.length; i++) {
    out.push(`<rect x="${cx}" y="${tableY}" width="${colWidths[i]}" height="${headerH}" fill="#f0f4f8" stroke="black" stroke-width="0.4"/>`);
    out.push(`<text x="${cx + colWidths[i] / 2}" y="${tableY + headerH / 2 + 1.5}" font-family="monospace" font-size="3.2" font-weight="bold" fill="#222" text-anchor="middle">${esc(headers[i])}</text>`);
    cx += colWidths[i];
  }

  // Data rows.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const ry = tableY + headerH + r * rowH;
    let dx = tableX;
    const fields = [
      String(row.itemNo),
      row.partNumber,
      row.description,
      String(row.quantity),
      row.material,
    ];
    for (let i = 0; i < fields.length; i++) {
      out.push(`<rect data-bom-row="${row.itemNo}" data-bom-col="${headers[i].toLowerCase()}" x="${dx}" y="${ry}" width="${colWidths[i]}" height="${rowH}" fill="white" stroke="black" stroke-width="0.3"/>`);
      // Truncate long descriptions to fit. Monospace at 2.7 ≈ 1.6mm/char.
      const maxChars = Math.floor((colWidths[i] - 2) / 1.6);
      const txt = fields[i].length > maxChars ? fields[i].slice(0, maxChars - 1) + '…' : fields[i];
      const textAnchor = (i === 0 || i === 3) ? 'middle' : 'start';
      const tx = textAnchor === 'middle' ? dx + colWidths[i] / 2 : dx + 1.5;
      out.push(`<text x="${tx}" y="${ry + rowH / 2 + 1.4}" font-family="monospace" font-size="2.8" fill="#222" text-anchor="${textAnchor}">${esc(txt)}</text>`);
      dx += colWidths[i];
    }
  }
  out.push('</g>');

  // Title block
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  let totalQty = 0;
  for (const r of rows) totalQty += r.quantity;
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">BOM  ${rows.length} row(s), ${totalQty} part(s)</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  A4 ISO  Sorted by Item No</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      rows,
      rowCount: rows.length,
      partNumbers: rows.map(r => r.partNumber),
      totalQty,
      mergeByPartNumber: merge,
    },
  };
}

/**
 * Auto-Balloon — for each component in the BOM, place a small numbered
 * "balloon" callout on the drawing view, connected via a leader line
 * to the component's anchor point.
 *
 * Auto-placement: balloons are arranged radially around the assembly's
 * projected centroid at a fixed radius outside the bounding rect. The
 * angular position is computed from the angle between the component's
 * own projected centroid and the assembly centroid — so a part on the
 * left gets a balloon on the left, etc. Overlap detection: balloons
 * that would collide get bumped CCW one slot at a time until clear.
 *
 * Args:
 *   components — array of { name, partNumber, manifold }. The `manifold`
 *                is REQUIRED for anchor placement; components without
 *                one are still listed but balloon-less.
 *   assemblyManifold — the unioned assembly manifold (used for the
 *                FRONT-view projection backdrop)
 *   options    — { name, date, mergeByPartNumber = true,
 *                  balloonRadius_mm = 5 }
 *
 * Returns:
 *   { svg, info: { balloons, balloonCount, overlapBumps, rows } }
 */
export function autoBalloon(components, assemblyManifold, options = {}) {
  const partName = options.name || 'Untitled Assembly';
  const date = options.date || new Date().toISOString().slice(0, 10);
  const merge = options.mergeByPartNumber !== false;
  const balloonR = options.balloonRadius_mm || 5;

  const bb = assemblyManifold.boundingBox();
  const partOrigin = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const partExtent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;

  const SVG_W = 297, SVG_H = 210;
  const boxW = 220, boxH = 150;
  const paperScale = Math.min(0.70 * boxW / (partExtent * 1.4), 0.70 * boxH / (partExtent * 1.4), 1);

  // Project the assembly silhouette for the backdrop.
  const front = projectEdges(assemblyManifold, [0, -1, 0], [0, 0, 1], partOrigin, paperScale);
  const viewCx = (front.bbox.minX + front.bbox.maxX) / 2;
  const viewCy = (front.bbox.minY + front.bbox.maxY) / 2;
  const viewExtent = Math.max(front.bbox.maxX - front.bbox.minX, front.bbox.maxY - front.bbox.minY) || 1;

  const originX = 30 + boxW / 2 - viewCx;
  const originY = 35 + boxH / 2 - viewCy;

  // Step 1 — build BOM rows so balloons can reference Item No.
  const bomResult = bom(components, { name: partName, date, mergeByPartNumber: merge });
  const rows = bomResult.info.rows;

  // Step 2 — for each row's first component manifold, compute its
  // PROJECTED centroid in paper-space (so we know where to anchor the
  // leader line).
  const anchors = [];
  for (const row of rows) {
    if (!row.manifolds || row.manifolds.length === 0) {
      anchors.push({ row, projected: null });
      continue;
    }
    const m = row.manifolds[0];
    const cbb = m.boundingBox();
    // Component world-space centroid → translate to assembly-relative →
    // project through the FRONT view.
    const c = [(cbb.min[0] + cbb.max[0]) / 2, (cbb.min[1] + cbb.max[1]) / 2, (cbb.min[2] + cbb.max[2]) / 2];
    const view = buildViewMatrix([0, -1, 0], [0, 0, 1]);
    const rel = [c[0] - partOrigin[0], c[1] - partOrigin[1], c[2] - partOrigin[2]];
    const pp = projectPoint(rel, view);
    const px = pp[0] * paperScale;
    const py = -pp[1] * paperScale;  // SVG y-flip
    anchors.push({ row, projected: { x: px, y: py } });
  }

  // Step 3 — place balloons radially. Compute each balloon's preferred
  // angle from the assembly centroid through the component anchor; then
  // walk the placement ring once detecting overlap and bumping CCW.
  const ringR = viewExtent * 0.7 + balloonR + 6;
  const centroidPaperX = (front.bbox.minX + front.bbox.maxX) / 2;
  const centroidPaperY = (front.bbox.minY + front.bbox.maxY) / 2;

  const balloons = [];
  let overlapBumps = 0;

  for (const a of anchors) {
    let angleDeg;
    if (a.projected) {
      const dx = a.projected.x - centroidPaperX;
      const dy = a.projected.y - centroidPaperY;
      angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    } else {
      // Component had no manifold — pick a default slot below the view.
      angleDeg = 90;  // bottom
    }

    // Snap to nearest 30° slot to start; bump CCW if occupied.
    let slot = Math.round(angleDeg / 30) * 30;
    const seen = new Set(balloons.map(b => b.slotDeg));
    while (seen.has(slot)) {
      slot = (slot + 30) % 360;
      overlapBumps++;
      if (overlapBumps > balloons.length * 12 + 24) break;  // safety net
    }
    const rad = slot * Math.PI / 180;
    const bx = centroidPaperX + ringR * Math.cos(rad);
    const by = centroidPaperY + ringR * Math.sin(rad);

    balloons.push({
      itemNo: a.row.itemNo,
      partNumber: a.row.partNumber,
      anchor: a.projected || { x: centroidPaperX, y: centroidPaperY },
      balloonPos: { x: bx, y: by },
      slotDeg: slot,
      angleDeg,
    });
  }

  // Step 4 — render the SVG sheet (front-view + balloons + leaders).
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="auto-balloon" data-balloon-count="${balloons.length}">`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // FRONT view backdrop.
  out.push(`<g class="view view-front" data-view-name="front" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of front.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push('</g>');

  // Balloons + leader lines.
  out.push(`<g class="auto-balloons" data-archdisc-auto-balloons="${balloons.length}" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const b of balloons) {
    // Leader line — anchor to balloon centre.
    out.push(`<line data-balloon-leader="${b.itemNo}" x1="${b.anchor.x.toFixed(3)}" y1="${b.anchor.y.toFixed(3)}" x2="${b.balloonPos.x.toFixed(3)}" y2="${b.balloonPos.y.toFixed(3)}" stroke="#333" stroke-width="0.35"/>`);
    // Anchor dot.
    out.push(`<circle cx="${b.anchor.x.toFixed(3)}" cy="${b.anchor.y.toFixed(3)}" r="0.6" fill="#333"/>`);
    // Balloon — circle with the item number.
    out.push(`<circle data-balloon="${b.itemNo}" data-balloon-pn="${esc(b.partNumber)}" cx="${b.balloonPos.x.toFixed(3)}" cy="${b.balloonPos.y.toFixed(3)}" r="${balloonR}" fill="white" stroke="#1c5fa1" stroke-width="0.6"/>`);
    out.push(`<text x="${b.balloonPos.x.toFixed(3)}" y="${(b.balloonPos.y + 1.6).toFixed(3)}" font-family="monospace" font-size="4.5" font-weight="bold" fill="#1c5fa1" text-anchor="middle">${b.itemNo}</text>`);
  }
  out.push('</g>');

  // Mini BOM in the corner so the reader can decode the balloon numbers.
  const miniX = SVG_W - 100, miniY = 5;
  const miniW = 95, miniRowH = 5.5;
  out.push(`<g class="auto-balloon-bom" data-archdisc-auto-balloon-bom="${rows.length}">`);
  out.push(`<rect x="${miniX}" y="${miniY}" width="${miniW}" height="${5 + rows.length * miniRowH + 6}" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${miniX + miniW / 2}" y="${miniY + 4}" font-family="monospace" font-size="3" font-weight="bold" fill="#222" text-anchor="middle">BOM (Auto-Balloon)</text>`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const yy = miniY + 8 + i * miniRowH;
    out.push(`<circle cx="${miniX + 5}" cy="${yy + 1}" r="2.2" fill="white" stroke="#1c5fa1" stroke-width="0.4"/>`);
    out.push(`<text x="${miniX + 5}" y="${yy + 2.1}" font-family="monospace" font-size="2.7" font-weight="bold" fill="#1c5fa1" text-anchor="middle">${r.itemNo}</text>`);
    const desc = `${r.partNumber}  ×${r.quantity}  ${r.material}`;
    const maxC = 38;
    const truncated = desc.length > maxC ? desc.slice(0, maxC - 1) + '…' : desc;
    out.push(`<text x="${miniX + 10}" y="${yy + 2.2}" font-family="monospace" font-size="2.6" fill="#222">${esc(truncated)}</text>`);
  }
  out.push(`</g>`);

  // Title block.
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">Auto-Balloon  ${balloons.length} balloon(s) / ${rows.length} BOM row(s)</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  Scale ${paperScale.toFixed(3)}:1  A4 ISO</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      bbox: front.bbox,
      balloons,
      balloonCount: balloons.length,
      overlapBumps,
      rows,
      rowCount: rows.length,
      ringRadius_mm: ringR,
      paperScale,
      bomSvg: bomResult.svg,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// UX Tier 8c — Sheet Format + Title Block
// ───────────────────────────────────────────────────────────────────────────

/**
 * Real-world drawing sheet sizes in millimetres (W × H, natural / portrait
 * orientation for the ISO A-series; ANSI's "landscape natural" convention
 * is kept by setting the larger value as H so flipping to landscape gives
 * a wider sheet).
 *
 * Sources: ISO 216 (A0..A4) and ASME Y14.1 (ANSI A..E).
 */
export const SHEET_SIZES = Object.freeze({
  'A0':     { w: 841,  h: 1189 },
  'A1':     { w: 594,  h: 841  },
  'A2':     { w: 420,  h: 594  },
  'A3':     { w: 297,  h: 420  },
  'A4':     { w: 210,  h: 297  },
  'ANSI-A': { w: 216,  h: 279  },  // 8.5 × 11 in
  'ANSI-B': { w: 279,  h: 432  },  // 11 × 17 in
  'ANSI-C': { w: 432,  h: 559  },  // 17 × 22 in
  'ANSI-D': { w: 559,  h: 864  },  // 22 × 34 in
  'ANSI-E': { w: 864,  h: 1118 },  // 34 × 44 in
});

/**
 * Compute sheet dimensions (W,H in paper-mm) for a {size, orientation}
 * pair. The size's `w` / `h` is the natural-portrait orientation; if the
 * caller asks for `landscape` and natural is already portrait (w<h), the
 * dimensions get swapped. Returns { w, h, size, orientation }.
 *
 * Defaults to A3 landscape (the closest match to the legacy 297×210
 * sheet the rest of the drawing pipeline used).
 */
export function resolveSheet(opts = {}) {
  const sizeName = SHEET_SIZES[opts.size] ? opts.size : 'A3';
  const natural = SHEET_SIZES[sizeName];
  let w = natural.w;
  let h = natural.h;
  const orientation = (opts.orientation || 'landscape').toLowerCase();
  const naturalIsPortrait = w < h;
  if (orientation === 'landscape' && naturalIsPortrait) { const t = w; w = h; h = t; }
  if (orientation === 'portrait' && !naturalIsPortrait) { const t = w; w = h; h = t; }
  return { w, h, size: sizeName, orientation };
}

/**
 * Render a real ASME/ISO engineering title block in the bottom-right
 * corner of a sheet, embedded in a full standalone drawing SVG that
 * shows the active body's FRONT projection on the chosen sheet size.
 *
 * The title block is a 3-row, multi-column grid (mirrors SolidWorks /
 * Siemens NX title-block layout):
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  PART NUMBER                                              │   ← Title row (24mm tall)
 *   │  Description                                              │
 *   ├──────────────┬───────────────┬───────────────┬────────────┤
 *   │  Drawn by    │  Date         │  Material     │  Scale     │   ← Properties row 1 (12mm)
 *   ├──────────────┼───────────────┼───────────────┼────────────┤
 *   │  Sheet n/N   │  Standard     │  Units        │  Tolerance │   ← Properties row 2 (12mm)
 *   ├──────────────┴───────────────┴───────────────┴────────────┤
 *   │  Approved   /   Signature                                 │   ← Approval row (12mm)
 *   └───────────────────────────────────────────────────────────┘
 *
 * Block footprint: 120 mm × 60 mm, anchored at (sheetW - 5 - 120,
 * sheetH - 5 - 60) so it lives inside the 5mm sheet margin.
 *
 * Args:
 *   manifold — foundation Manifold body (FRONT view goes on the sheet)
 *   opts     — {
 *      // sheet
 *      size, orientation,
 *      // title-block fields
 *      partNumber, description, drawnBy, date, material, scale,
 *      sheetN, sheetTotal, approval,
 *      // misc
 *      units = 'mm', standard = 'ASME Y14.5', tolerance = '±0.1',
 *   }
 *
 * Returns:
 *   { svg, info: { sheet: {w,h,size,orientation}, fields: {...},
 *                  titleBlockBBox: {x,y,w,h}, edgeCount, paperScale } }
 */
export function titleBlock(manifold, opts = {}) {
  const sheet = resolveSheet(opts);
  const SVG_W = sheet.w, SVG_H = sheet.h;

  const fields = {
    partNumber:  opts.partNumber  || 'PN-0000',
    description: opts.description || 'Untitled Part',
    drawnBy:     opts.drawnBy     || '—',
    date:        opts.date        || new Date().toISOString().slice(0, 10),
    material:    opts.material    || '—',
    scale:       opts.scale       || '1:1',
    sheetN:      Number.isFinite(opts.sheetN)     ? opts.sheetN     : 1,
    sheetTotal:  Number.isFinite(opts.sheetTotal) ? opts.sheetTotal : 1,
    approval:    opts.approval    || 'PENDING',
    units:       opts.units       || 'mm',
    standard:    opts.standard    || 'ASME Y14.5',
    tolerance:   opts.tolerance   || '±0.1',
  };

  // Title-block footprint — bottom-right corner.
  const TB_W = 120, TB_H = 60;
  const TB_X = SVG_W - 5 - TB_W;
  const TB_Y = SVG_H - 5 - TB_H;

  // FRONT view — fit the body into the area ABOVE the title block, with a
  // 15 mm top/left margin, ~10 mm right margin and ~5mm gap above the
  // title block. We accept the body's natural aspect; the paper-scale is
  // sized to fit whichever dimension is the binding constraint.
  let edges = [];
  let paperScale = 1;
  let viewBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  if (manifold && typeof manifold.boundingBox === 'function') {
    const bb = manifold.boundingBox();
    const partOrigin = [(bb.min[0] + bb.max[0]) / 2,
                       (bb.min[1] + bb.max[1]) / 2,
                       (bb.min[2] + bb.max[2]) / 2];
    const partExtent = Math.max(bb.max[0] - bb.min[0],
                                bb.max[1] - bb.min[1],
                                bb.max[2] - bb.min[2]) || 1;
    const viewBoxW = SVG_W - 30;                  // 15 + 15 mm margins
    const viewBoxH = SVG_H - 30 - TB_H - 5;       // 15mm top + 15mm gap-to-TB + TB height
    paperScale = Math.min(0.85 * viewBoxW / (partExtent * 1.4),
                          0.85 * viewBoxH / (partExtent * 1.4), 1);
    // Project TOP-DOWN (looking along -Z with +Y as paper-up). This shows
    // the body's XY silhouette directly — the natural plane for the
    // atomic Part API (which sketches in XY + extrudes along Z), so the
    // title-block / sheet preview matches what the user just built.
    const proj = projectEdges(manifold, [0, 0, -1], [0, 1, 0], partOrigin, paperScale);
    edges = proj.edges;
    viewBBox = proj.bbox;
  }
  const viewCx = (viewBBox.minX + viewBBox.maxX) / 2;
  const viewCy = (viewBBox.minY + viewBBox.maxY) / 2;
  const viewAreaCx = (SVG_W - 30) / 2 + 15;
  const viewAreaCy = (SVG_H - TB_H - 20) / 2 + 15;
  const originX = viewAreaCx - viewCx;
  const originY = viewAreaCy - viewCy;

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="title-block" data-sheet-size="${esc(sheet.size)}" data-sheet-orientation="${esc(sheet.orientation)}" data-tb-part-number="${esc(fields.partNumber)}">`);

  // Sheet border (double-line ASME convention: outer + inner).
  out.push(`<rect x="2.5" y="2.5" width="${SVG_W - 5}" height="${SVG_H - 5}" fill="white" stroke="black" stroke-width="0.3"/>`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="none" stroke="black" stroke-width="0.5"/>`);

  // FRONT view (the body itself).
  out.push(`<g class="view view-front" data-view-name="front" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  if (edges.length > 0) {
    out.push(`<text x="${viewBBox.minX.toFixed(3)}" y="${(viewBBox.minY - 4).toFixed(3)}" font-family="monospace" font-size="4" fill="#222">FRONT</text>`);
  }
  out.push('</g>');

  // ── Title block — 3-row engineering grid in the bottom-right corner ──
  const TITLE_H    = 24;   // Row 1 — Title (PN + description)
  const PROPS_H    = 12;   // Rows 2 & 3 — Properties cells
  const APPROVAL_H = 12;   // Row 4 — Approval

  // Column widths for the properties grid (4 columns).
  const colW = TB_W / 4;   // 30 mm each

  out.push(`<g class="title-block" data-archdisc-title-block="1" data-tb-x="${TB_X}" data-tb-y="${TB_Y}" data-tb-w="${TB_W}" data-tb-h="${TB_H}">`);

  // Outer title-block frame.
  out.push(`<rect x="${TB_X}" y="${TB_Y}" width="${TB_W}" height="${TB_H}" fill="white" stroke="black" stroke-width="0.6"/>`);

  // ── Title row ──
  out.push(`<rect x="${TB_X}" y="${TB_Y}" width="${TB_W}" height="${TITLE_H}" fill="#fafbfc" stroke="black" stroke-width="0.5"/>`);
  out.push(`<text x="${TB_X + 4}" y="${TB_Y + 10}" font-family="monospace" font-size="6.5" font-weight="bold" fill="#111">${esc(fields.partNumber)}</text>`);
  out.push(`<text x="${TB_X + 4}" y="${TB_Y + 19}" font-family="monospace" font-size="3.8" fill="#333">${esc(fields.description)}</text>`);

  // ── Properties grid: 4 columns × 2 rows ──
  // Cell layout (left→right, top→bottom):
  //   [Drawn by] [Date]      [Material] [Scale]
  //   [Sheet]    [Standard]  [Units]    [Tol]
  const propsRow1Y = TB_Y + TITLE_H;
  const propsRow2Y = propsRow1Y + PROPS_H;

  const drawCell = (cx, cy, w, h, label, value) => {
    out.push(`<rect data-tb-cell="${esc(label.toLowerCase())}" x="${cx}" y="${cy}" width="${w}" height="${h}" fill="white" stroke="black" stroke-width="0.4"/>`);
    out.push(`<text x="${cx + 1.5}" y="${cy + 3.5}" font-family="monospace" font-size="2.4" fill="#666">${esc(label)}</text>`);
    out.push(`<text x="${cx + 1.5}" y="${cy + 9.5}" font-family="monospace" font-size="3.6" font-weight="bold" fill="#111">${esc(value)}</text>`);
  };

  drawCell(TB_X + 0 * colW, propsRow1Y, colW, PROPS_H, 'DRAWN',    fields.drawnBy);
  drawCell(TB_X + 1 * colW, propsRow1Y, colW, PROPS_H, 'DATE',     fields.date);
  drawCell(TB_X + 2 * colW, propsRow1Y, colW, PROPS_H, 'MATERIAL', fields.material);
  drawCell(TB_X + 3 * colW, propsRow1Y, colW, PROPS_H, 'SCALE',    fields.scale);

  drawCell(TB_X + 0 * colW, propsRow2Y, colW, PROPS_H, 'SHEET',    `${fields.sheetN} / ${fields.sheetTotal}`);
  drawCell(TB_X + 1 * colW, propsRow2Y, colW, PROPS_H, 'STANDARD', fields.standard);
  drawCell(TB_X + 2 * colW, propsRow2Y, colW, PROPS_H, 'UNITS',    fields.units);
  drawCell(TB_X + 3 * colW, propsRow2Y, colW, PROPS_H, 'TOL',      fields.tolerance);

  // ── Approval row ──
  const approvalY = propsRow2Y + PROPS_H;
  out.push(`<rect data-tb-cell="approval" x="${TB_X}" y="${approvalY}" width="${TB_W}" height="${APPROVAL_H}" fill="#fafbfc" stroke="black" stroke-width="0.5"/>`);
  out.push(`<text x="${TB_X + 2}" y="${approvalY + 3.5}" font-family="monospace" font-size="2.4" fill="#666">APPROVED</text>`);
  out.push(`<text x="${TB_X + 2}" y="${approvalY + 9.5}" font-family="monospace" font-size="3.6" font-weight="bold" fill="#111">${esc(fields.approval)}</text>`);
  // Signature line on the right half of the approval cell.
  out.push(`<line x1="${TB_X + TB_W * 0.55}" y1="${approvalY + 9}" x2="${TB_X + TB_W - 3}" y2="${approvalY + 9}" stroke="black" stroke-width="0.3"/>`);
  out.push(`<text x="${TB_X + TB_W * 0.55 + 1}" y="${approvalY + 11}" font-family="monospace" font-size="2" fill="#888">SIGNATURE</text>`);

  out.push('</g>');
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      sheet,
      fields,
      titleBlockBBox: { x: TB_X, y: TB_Y, w: TB_W, h: TB_H },
      edgeCount: edges.length,
      paperScale,
    },
  };
}

/**
 * Re-render the active sheet at a different size / orientation. Draws
 * the FRONT view (active body) + the standard double-line ASME border +
 * a minimal title block (so the user sees the sheet immediately rather
 * than an empty rectangle). The full-fledged title block is added by
 * the separate Title Block op; Sheet Format owns sheet-level geometry.
 *
 * Args:
 *   manifold — foundation Manifold body (optional; if absent, renders the
 *              empty sheet so the user can confirm the new size).
 *   opts     — { size, orientation, partName?, date? }
 *
 * Returns:
 *   { svg, info: { sheet: {w,h,size,orientation}, edgeCount, paperScale,
 *                  borderInset_mm, sheetArea_mm2 } }
 */
export function sheetFormat(manifold, opts = {}) {
  const sheet = resolveSheet(opts);
  const SVG_W = sheet.w, SVG_H = sheet.h;
  const partName = opts.partName || 'Untitled Sheet';
  const date = opts.date || new Date().toISOString().slice(0, 10);

  // Mini title block (corner) — bottom-right. Sized smaller than the
  // full Title Block op so the two SVGs differ visually too.
  const MTB_W = 100, MTB_H = 30;
  const MTB_X = SVG_W - 5 - MTB_W;
  const MTB_Y = SVG_H - 5 - MTB_H;

  let edges = [];
  let paperScale = 1;
  let viewBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  if (manifold && typeof manifold.boundingBox === 'function') {
    const bb = manifold.boundingBox();
    const partOrigin = [(bb.min[0] + bb.max[0]) / 2,
                       (bb.min[1] + bb.max[1]) / 2,
                       (bb.min[2] + bb.max[2]) / 2];
    const partExtent = Math.max(bb.max[0] - bb.min[0],
                                bb.max[1] - bb.min[1],
                                bb.max[2] - bb.min[2]) || 1;
    const viewBoxW = SVG_W - 30;
    const viewBoxH = SVG_H - 30 - MTB_H - 5;
    paperScale = Math.min(0.85 * viewBoxW / (partExtent * 1.4),
                          0.85 * viewBoxH / (partExtent * 1.4), 1);
    // Project TOP-DOWN (looking along -Z with +Y as paper-up). This shows
    // the body's XY silhouette directly — the natural plane for the
    // atomic Part API (which sketches in XY + extrudes along Z), so the
    // title-block / sheet preview matches what the user just built.
    const proj = projectEdges(manifold, [0, 0, -1], [0, 1, 0], partOrigin, paperScale);
    edges = proj.edges;
    viewBBox = proj.bbox;
  }
  const viewCx = (viewBBox.minX + viewBBox.maxX) / 2;
  const viewCy = (viewBBox.minY + viewBBox.maxY) / 2;
  const viewAreaCx = (SVG_W - 30) / 2 + 15;
  const viewAreaCy = (SVG_H - MTB_H - 20) / 2 + 15;
  const originX = viewAreaCx - viewCx;
  const originY = viewAreaCy - viewCy;

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="sheet-format" data-sheet-size="${esc(sheet.size)}" data-sheet-orientation="${esc(sheet.orientation)}" data-sheet-w="${SVG_W}" data-sheet-h="${SVG_H}">`);

  // ASME double-line border, sized to fit the new sheet.
  out.push(`<rect x="2.5" y="2.5" width="${SVG_W - 5}" height="${SVG_H - 5}" fill="white" stroke="black" stroke-width="0.3"/>`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="none" stroke="black" stroke-width="0.5"/>`);

  // Sheet legend in the top-left corner — confirms the new format choice.
  out.push(`<text x="10" y="14" font-family="monospace" font-size="4" font-weight="bold" fill="#222">SHEET ${esc(sheet.size)} (${esc(sheet.orientation.toUpperCase())})  ${SVG_W} × ${SVG_H} mm</text>`);

  // FRONT view (active body).
  out.push(`<g class="view view-front" data-view-name="front" transform="translate(${originX.toFixed(3)},${originY.toFixed(3)})">`);
  for (const e of edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  if (edges.length > 0) {
    out.push(`<text x="${viewBBox.minX.toFixed(3)}" y="${(viewBBox.minY - 4).toFixed(3)}" font-family="monospace" font-size="4" fill="#222">FRONT</text>`);
  }
  out.push('</g>');

  // Mini title block, fitted to the new sheet's corner.
  out.push(`<g class="title-block" data-archdisc-title-block="mini">`);
  out.push(`<rect x="${MTB_X}" y="${MTB_Y}" width="${MTB_W}" height="${MTB_H}" fill="white" stroke="black" stroke-width="0.5"/>`);
  out.push(`<text x="${MTB_X + 3}" y="${MTB_Y + 9}" font-family="monospace" font-size="4" font-weight="bold" fill="#111">${esc(partName)}</text>`);
  out.push(`<text x="${MTB_X + 3}" y="${MTB_Y + 17}" font-family="monospace" font-size="2.8" fill="#333">Sheet ${esc(sheet.size)}  ${esc(sheet.orientation)}  ${SVG_W}×${SVG_H} mm</text>`);
  out.push(`<text x="${MTB_X + 3}" y="${MTB_Y + 25}" font-family="monospace" font-size="2.8" fill="#333">Date ${esc(date)}  Scale ${paperScale.toFixed(3)}:1</text>`);
  out.push(`</g>`);

  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      sheet,
      edgeCount: edges.length,
      paperScale,
      borderInset_mm: 5,
      sheetArea_mm2: SVG_W * SVG_H,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// UX Tier 12 — Stepped Section Line + Tabular Note (NX-distinctive drawing ops)
//
// Siemens-NX synthesis (`siemens-nx-course-synthesis.md` §6 items 112 + 114)
// identifies two Drafting capabilities that ArchDisc previously lacked:
//
//   #112  Stepped Section Line — multi-segment section cut path with
//         right-angle jogs. The result is a composite cross-section that
//         hops between parallel planes — the canonical "stepped section
//         view". NX exposes this as Section Line → Stand Alone; SolidWorks
//         has only single-plane Section View + the (clunkier) Aligned
//         Section.
//
//   #114  Tabular Note — generic editable N×M annotation table that is
//         NOT linked to a BOM. Useful for hole charts, revision blocks,
//         tolerance tables, inspection sheets, dimension lists.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Slice a body with a single cutting plane defined by an origin + normal,
 * returning the projected 2D polylines of every edge of the resulting cut
 * surface in a chosen "screen" frame. Internally uses the same mesh-plane
 * intersection scheme as foundation/Slicer.js but inlined so we don't
 * pull the kernel into a pure-2D op.
 *
 * Args:
 *   manifold — foundation Manifold body
 *   origin   — point on the plane in WORLD coords ([x,y,z] mm)
 *   normal   — plane normal (must be roughly unit; normalised internally)
 *   screenX  — paper-X axis (mm-space, lies in the plane)
 *   screenY  — paper-Y axis (mm-space, lies in the plane)
 *
 * Returns:
 *   { segments: [{x1,y1,x2,y2}], bbox: {minX, minY, maxX, maxY} }
 */
function sliceManifoldByPlane(manifold, origin, normal, screenX, screenY) {
  const mesh = manifold.getMesh();
  const nL = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n = [normal[0] / nL, normal[1] / nL, normal[2] / nL];
  const sxL = Math.hypot(screenX[0], screenX[1], screenX[2]) || 1;
  const sx = [screenX[0] / sxL, screenX[1] / sxL, screenX[2] / sxL];
  const syL = Math.hypot(screenY[0], screenY[1], screenY[2]) || 1;
  const sy = [screenY[0] / syL, screenY[1] / syL, screenY[2] / syL];

  const numTri = mesh.triVerts.length / 3;
  const segments = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // For each triangle: compute signed distance of each vertex to the plane;
  // edges with sign-change contribute one intersection point. A triangle
  // crossing the plane contributes a SEGMENT between its two intersection
  // points (drawn as the cut-edge outline of that face on the plane).
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVert(mesh, i0);
    const p1 = getVert(mesh, i1);
    const p2 = getVert(mesh, i2);
    const d0 = (p0[0] - origin[0]) * n[0] + (p0[1] - origin[1]) * n[1] + (p0[2] - origin[2]) * n[2];
    const d1 = (p1[0] - origin[0]) * n[0] + (p1[1] - origin[1]) * n[1] + (p1[2] - origin[2]) * n[2];
    const d2 = (p2[0] - origin[0]) * n[0] + (p2[1] - origin[1]) * n[1] + (p2[2] - origin[2]) * n[2];

    const pts = [];
    const addCross = (pa, da, pb, db) => {
      if ((da > 0 && db <= 0) || (da <= 0 && db > 0)) {
        const t01 = da / (da - db);
        pts.push([
          pa[0] + (pb[0] - pa[0]) * t01,
          pa[1] + (pb[1] - pa[1]) * t01,
          pa[2] + (pb[2] - pa[2]) * t01,
        ]);
      }
    };
    addCross(p0, d0, p1, d1);
    addCross(p1, d1, p2, d2);
    addCross(p2, d2, p0, d0);

    if (pts.length === 2) {
      const a = pts[0], b = pts[1];
      // Project into the screen-frame (origin = plane-origin).
      const rax = a[0] - origin[0], ray = a[1] - origin[1], raz = a[2] - origin[2];
      const rbx = b[0] - origin[0], rby = b[1] - origin[1], rbz = b[2] - origin[2];
      const ax = rax * sx[0] + ray * sx[1] + raz * sx[2];
      const ay = rax * sy[0] + ray * sy[1] + raz * sy[2];
      const bx = rbx * sx[0] + rby * sx[1] + rbz * sx[2];
      const by = rbx * sy[0] + rby * sy[1] + rbz * sy[2];
      segments.push({ x1: ax, y1: -ay, x2: bx, y2: -by });  // SVG y-flip
      if (ax < minX) minX = ax;  if (bx < minX) minX = bx;
      if (ax > maxX) maxX = ax;  if (bx > maxX) maxX = bx;
      if (-ay < minY) minY = -ay; if (-by < minY) minY = -by;
      if (-ay > maxY) maxY = -ay; if (-by > maxY) maxY = -by;
    }
  }

  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0; }
  return { segments, bbox: { minX, minY, maxX, maxY } };
}

/**
 * Stepped Section Line — multi-segment section cut path with right-angle
 * jogs (NX "Section Line → Stand Alone"). The user supplies a polyline of
 * points in PAPER-mm of the FRONT view's paper space; each segment of the
 * polyline defines a cutting plane perpendicular to the FRONT view (the
 * plane contains the world-Y axis — "into the page" — and the segment's
 * direction in paper-space). The op:
 *
 *   - Draws the SECTION LINE itself on the FRONT view (a thick chain-dot
 *     polyline ending with arrow heads labelled `A`–`A` (or caller label);
 *     each jog gets a small marker so the reader can see the steps.
 *   - For each segment: slices the body with the corresponding plane and
 *     PROJECTS the intersection into the section sheet, concatenated
 *     side-by-side. The result is a composite cross-section that hops
 *     between parallel planes — the canonical stepped-section view.
 *
 * Args:
 *   manifold — foundation Manifold body
 *   opts:
 *     points : [{x, y}]   polyline points in PAPER-mm of the FRONT view
 *                         (must have ≥2 points; right-angle jogs expected)
 *     view   : 'front'    (parent view name — only 'front' wired today)
 *     label  : 'A'        section label (rendered as `A`–`A` on the arrows)
 *     name   : 'Untitled Part'
 *
 * Returns:
 *   { svg, info: { label, segments: [{plane, sliceSegmentCount, width}],
 *                  segmentCount, jogCount, totalCutEdges, frontBBox,
 *                  paperScale, view } }
 */
export function steppedSectionLine(manifold, opts = {}) {
  const partName = opts.name || 'Untitled Part';
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const label = opts.label || 'A';
  const view = opts.view || 'front';
  const rawPts = Array.isArray(opts.points) ? opts.points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  const points = rawPts.length >= 2 ? rawPts : [{ x: -30, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 20 }, { x: 30, y: 20 }];

  // FRONT projection (eye=-Y, up=+Z) → paper-X = world-X, paper-Y = world-Z.
  // So a point in paper-mm at (px, py) corresponds (in world) to a plane
  // passing through (px/scale, *, -py/scale) — Y is "into the page".
  const bb = manifold.boundingBox();
  const partOrigin = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const partExtent = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;

  const SVG_W = 297, SVG_H = 210;
  // Top half: FRONT view + section line annotation
  // Bottom half: stepped section composite
  const frontBoxW = 160, frontBoxH = 80;
  const sectBoxW = 280, sectBoxH = 80;
  const paperScale = Math.min(0.85 * frontBoxW / (partExtent * 1.4), 0.85 * frontBoxH / (partExtent * 1.4), 1);

  const front = projectEdges(manifold, [0, -1, 0], [0, 0, 1], partOrigin, paperScale);
  const frontOriginX = 25 + frontBoxW / 2 - (front.bbox.minX + front.bbox.maxX) / 2;
  const frontOriginY = 25 + frontBoxH / 2 - (front.bbox.minY + front.bbox.maxY) / 2;

  // For each segment of the polyline build a world-space cutting plane.
  // FRONT view: paper-X = world-X, paper-Y = -world-Z (SVG y-flip already
  // applied to projected edges). To convert a paper-mm point (px,py) back
  // to world: wx = px/scale + partOrigin.x, wz = -py/scale + partOrigin.z,
  // wy = partOrigin.y (Y axis is "into the page" — the cutting plane spans
  // it).
  //
  // For a segment from (p0 → p1) in paper-mm:
  //   midpoint in paper-mm:  (mx, my)
  //   segment direction (paper):  (dx, dy)
  //   In world: the IN-PLANE direction is (dx/scale, 0, -dy/scale)
  //                                       (paper-X, 0, paper-Y back to world-Z)
  //   The plane CONTAINS the world-Y axis (it goes "into the page")
  //   So plane normal = direction × Y = (-dy/scale * (-1), 0, dx/scale * (-1))? No —
  //   Easier: pick TWO in-plane vectors → cross = normal.
  //     in-plane v1 = (dx/scale, 0, -dy/scale)  (along segment)
  //     in-plane v2 = (0, 1, 0)                  (into the page)
  //     normal = v1 × v2 = (0 * 0 - (-dy/scale) * 1, (-dy/scale) * 0 - dx/scale * 0, dx/scale * 1 - 0 * 0)
  //            = (dy/scale, 0, dx/scale)  → perpendicular to the segment in paper-XZ
  //   The screen frame for the cross-section: paper-X = world-Y (into the
  //   page; reveals "depth"), paper-Y = world-Z (up, same as FRONT).
  const segments = [];
  let cumX = 0;   // running offset across the composite section sheet
  let totalCutEdges = 0;
  const sectionSlices = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-6) continue;

    const planeOrigin = [
      mx / paperScale + partOrigin[0],
      partOrigin[1],
      -my / paperScale + partOrigin[2],
    ];
    const planeNormal = [dy, 0, dx];   // unnormalised (sliceManifoldByPlane normalises)
    const screenX = [0, 1, 0];          // world-Y "into the page" → paper-X
    const screenY = [0, 0, 1];          // world-Z up → paper-Y

    const slice = sliceManifoldByPlane(manifold, planeOrigin, planeNormal, screenX, screenY);
    sectionSlices.push({ slice, paperX0: cumX });
    const wWorld = (slice.bbox.maxX - slice.bbox.minX);
    cumX += wWorld * paperScale + 12;   // 12 mm gutter between hops
    totalCutEdges += slice.segments.length;

    segments.push({
      from: a,
      to: b,
      midPaper: { x: mx, y: my },
      planeOrigin,
      planeNormal,
      sliceSegmentCount: slice.segments.length,
      width_mm: wWorld,
    });
  }

  // Render: FRONT view + the section-line polyline + arrow heads at each
  // end + jog markers; then the composite section sheet below.
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="stepped-section" data-section-label="${esc(label)}" data-segment-count="${segments.length}" data-jog-count="${Math.max(0, points.length - 2)}">`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.4"/>`);

  // FRONT view backdrop.
  out.push(`<g class="view view-front" data-view-name="front" transform="translate(${frontOriginX.toFixed(3)},${frontOriginY.toFixed(3)})">`);
  for (const e of front.edges) {
    out.push(`<line x1="${e.x1.toFixed(3)}" y1="${e.y1.toFixed(3)}" x2="${e.x2.toFixed(3)}" y2="${e.y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
  }
  out.push(`<text x="${(front.bbox.minX).toFixed(3)}" y="${(front.bbox.minY - 3).toFixed(3)}" font-family="monospace" font-size="4" fill="#222">FRONT</text>`);
  out.push('</g>');

  // The stepped section LINE itself — chain-dot polyline + jog markers +
  // labelled arrow heads at each end.
  out.push(`<g class="section-line" data-archdisc-stepped-section-line="${esc(label)}" transform="translate(${frontOriginX.toFixed(3)},${frontOriginY.toFixed(3)})">`);
  // Chain-dot polyline.
  const polyPts = points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
  out.push(`<polyline data-stepped-section-polyline="1" points="${polyPts}" fill="none" stroke="#b54214" stroke-width="0.6" stroke-dasharray="6,1.5,0.5,1.5"/>`);
  // Jog markers — small filled squares at each interior vertex.
  for (let i = 1; i < points.length - 1; i++) {
    const jp = points[i];
    out.push(`<rect data-stepped-section-jog="${i}" x="${(jp.x - 0.9).toFixed(3)}" y="${(jp.y - 0.9).toFixed(3)}" width="1.8" height="1.8" fill="#b54214"/>`);
  }
  // Arrow heads at each end.
  const drawArrow = (atPt, fromPt, endLabel) => {
    const dxA = atPt.x - fromPt.x;
    const dyA = atPt.y - fromPt.y;
    const lA = Math.hypot(dxA, dyA) || 1;
    const uxA = dxA / lA, uyA = dyA / lA;
    const perpX = -uyA, perpY = uxA;
    const HEAD = 4.5, SPREAD = 1.8;
    const hx1 = atPt.x - uxA * HEAD + perpX * SPREAD;
    const hy1 = atPt.y - uyA * HEAD + perpY * SPREAD;
    const hx2 = atPt.x - uxA * HEAD - perpX * SPREAD;
    const hy2 = atPt.y - uyA * HEAD - perpY * SPREAD;
    out.push(`<line data-stepped-section-arrow="${endLabel}" x1="${atPt.x.toFixed(3)}" y1="${atPt.y.toFixed(3)}" x2="${hx1.toFixed(3)}" y2="${hy1.toFixed(3)}" stroke="#b54214" stroke-width="0.7"/>`);
    out.push(`<line x1="${atPt.x.toFixed(3)}" y1="${atPt.y.toFixed(3)}" x2="${hx2.toFixed(3)}" y2="${hy2.toFixed(3)}" stroke="#b54214" stroke-width="0.7"/>`);
    out.push(`<text x="${(atPt.x + uxA * 4 + perpX * 2).toFixed(3)}" y="${(atPt.y + uyA * 4 + perpY * 2 + 1.4).toFixed(3)}" font-family="monospace" font-size="5" font-weight="bold" fill="#b54214">${esc(endLabel)}</text>`);
  };
  drawArrow(points[0], points[1], label);
  drawArrow(points[points.length - 1], points[points.length - 2], label);
  out.push('</g>');

  // Composite section sheet (bottom half) — each slice rendered in its own
  // hop, separated by gutters. Add a labelled banner.
  const sectOriginX = 12 + sectBoxW / 2 - cumX / 2;
  const sectOriginY = 120;
  out.push(`<g class="section-composite" data-archdisc-stepped-section-composite="${segments.length}" transform="translate(${sectOriginX.toFixed(3)},${sectOriginY.toFixed(3)})">`);
  out.push(`<text x="0" y="-6" font-family="monospace" font-size="5" font-weight="bold" fill="#222">SECTION ${esc(label)}–${esc(label)}  (STEPPED)</text>`);
  for (let i = 0; i < sectionSlices.length; i++) {
    const { slice, paperX0 } = sectionSlices[i];
    // Centre the slice within its hop box (the slice's bbox.minX/Y are
    // already in paper-mm relative to the plane-origin).
    const dx_g = paperX0 - slice.bbox.minX * paperScale;
    const dy_g = -slice.bbox.minY * paperScale + 5;
    out.push(`<g data-hop="${i + 1}" transform="translate(${(dx_g).toFixed(3)},${(dy_g).toFixed(3)})">`);
    for (const s of slice.segments) {
      out.push(`<line x1="${(s.x1 * paperScale).toFixed(3)}" y1="${(s.y1 * paperScale).toFixed(3)}" x2="${(s.x2 * paperScale).toFixed(3)}" y2="${(s.y2 * paperScale).toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
    }
    // Hop label below.
    out.push(`<text x="${((slice.bbox.minX + slice.bbox.maxX) / 2 * paperScale).toFixed(3)}" y="${(slice.bbox.maxY * paperScale + 9).toFixed(3)}" font-family="monospace" font-size="3" fill="#1c5fa1" text-anchor="middle">hop ${i + 1} • ${slice.segments.length} edges</text>`);
    out.push('</g>');
  }
  out.push('</g>');

  // Title block.
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${SVG_W - 105}" y="${SVG_H - 35}" width="100" height="30" fill="white" stroke="black" stroke-width="0.4"/>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 26}" font-family="monospace" font-size="3.6" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 18}" font-family="monospace" font-size="2.7">Stepped Section ${esc(label)}–${esc(label)}  ${segments.length} segment(s), ${Math.max(0, points.length - 2)} jog(s)</text>`);
  out.push(`<text x="${SVG_W - 102}" y="${SVG_H - 10}" font-family="monospace" font-size="2.7">Date ${date}  Scale ${paperScale.toFixed(3)}:1  A4 ISO</text>`);
  out.push(`</g>`);
  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      label,
      view,
      points,
      segments,
      segmentCount: segments.length,
      jogCount: Math.max(0, points.length - 2),
      totalCutEdges,
      frontBBox: front.bbox,
      paperScale,
    },
  };
}

/**
 * Tabular Note — generic editable N×M annotation table on a drawing sheet
 * (NX "Annotation → Table"). NOT BOM-specific. Used for hole charts,
 * revision blocks, tolerance tables, dimension lists, inspection sheets.
 *
 * Args:
 *   opts:
 *     title    : 'HOLE CHART'   table title
 *     columns  : [{label, width}]  header column defs (width in mm; falls back
 *                                  to 30 mm per column if missing)
 *     rows     : [[cell, cell, ...]]   row data; cells string-coerced
 *     position : {x, y}        top-left of table in paper-mm; defaults to
 *                              (40, 40) on an A3 landscape sheet
 *     size     : 'A3'          sheet size (default A3 landscape)
 *     orientation : 'landscape'
 *     name     : 'Untitled Part'
 *
 * Returns:
 *   { svg, info: { title, columnCount, rowCount, position, tableBBox,
 *                  cells: [[{col, row, value, x, y, w, h}]] } }
 */
export function tabularNote(opts = {}) {
  const partName = opts.name || 'Untitled Part';
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const title = opts.title || 'TABULAR NOTE';
  const sheet = resolveSheet({ size: opts.size || 'A3', orientation: opts.orientation || 'landscape' });
  const SVG_W = sheet.w, SVG_H = sheet.h;

  const columnsIn = Array.isArray(opts.columns) ? opts.columns : [];
  const rowsIn = Array.isArray(opts.rows) ? opts.rows : [];

  // Normalise column defs.
  const columns = columnsIn.length > 0
    ? columnsIn.map((c, i) => ({
        label: String(c && c.label !== undefined ? c.label : `Col${i + 1}`),
        width: Number.isFinite(c && c.width) ? c.width : 30,
      }))
    : [{ label: 'Col1', width: 30 }];

  // Default rows: empty placeholder so the user still sees a table.
  const rows = rowsIn.length > 0
    ? rowsIn.map(r => Array.isArray(r) ? r.map(v => v == null ? '' : String(v)) : [String(r ?? '')])
    : [columns.map(() => '')];

  // Geometry.
  const tableX = Number.isFinite(opts.position?.x) ? opts.position.x : 40;
  const tableY = Number.isFinite(opts.position?.y) ? opts.position.y : 40;
  const titleH = 9;
  const headerH = 8;
  const rowH = 7;
  const tableW = columns.reduce((s, c) => s + c.width, 0);
  const tableH = titleH + headerH + rows.length * rowH;

  // Cell records for introspection.
  const cells = [];

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet" data-archdisc-view="tabular-note" data-tn-title="${esc(title)}" data-tn-cols="${columns.length}" data-tn-rows="${rows.length}">`);

  // Sheet frame (double-line ASME convention to match Title Block).
  out.push(`<rect x="2.5" y="2.5" width="${SVG_W - 5}" height="${SVG_H - 5}" fill="white" stroke="black" stroke-width="0.3"/>`);
  out.push(`<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="none" stroke="black" stroke-width="0.5"/>`);

  // Tabular note container.
  out.push(`<g class="tabular-note" data-archdisc-tabular-note="1" data-tn-x="${tableX}" data-tn-y="${tableY}" data-tn-w="${tableW}" data-tn-h="${tableH}">`);
  // Outer frame.
  out.push(`<rect x="${tableX}" y="${tableY}" width="${tableW}" height="${tableH}" fill="white" stroke="black" stroke-width="0.6"/>`);

  // Title row.
  out.push(`<rect data-tn-cell="title" x="${tableX}" y="${tableY}" width="${tableW}" height="${titleH}" fill="#eef2f7" stroke="black" stroke-width="0.5"/>`);
  out.push(`<text x="${(tableX + tableW / 2).toFixed(3)}" y="${(tableY + titleH * 0.65).toFixed(3)}" font-family="monospace" font-size="4.2" font-weight="bold" fill="#111" text-anchor="middle">${esc(title)}</text>`);

  // Header row.
  let cx = tableX;
  const headerY = tableY + titleH;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    out.push(`<rect data-tn-cell="header" data-tn-col="${i}" x="${cx}" y="${headerY}" width="${col.width}" height="${headerH}" fill="#fafbfc" stroke="black" stroke-width="0.4"/>`);
    out.push(`<text x="${(cx + col.width / 2).toFixed(3)}" y="${(headerY + headerH * 0.65).toFixed(3)}" font-family="monospace" font-size="3.2" font-weight="bold" fill="#222" text-anchor="middle">${esc(col.label)}</text>`);
    cx += col.width;
  }

  // Data rows.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const ry = headerY + headerH + r * rowH;
    let dx = tableX;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const value = i < row.length ? String(row[i]) : '';
      const maxChars = Math.floor((col.width - 2) / 1.55);
      const txt = value.length > maxChars ? value.slice(0, Math.max(1, maxChars - 1)) + '…' : value;
      out.push(`<rect data-tn-cell="data" data-tn-row="${r}" data-tn-col="${i}" x="${dx}" y="${ry}" width="${col.width}" height="${rowH}" fill="white" stroke="black" stroke-width="0.3"/>`);
      out.push(`<text x="${(dx + col.width / 2).toFixed(3)}" y="${(ry + rowH * 0.65).toFixed(3)}" font-family="monospace" font-size="2.9" fill="#111" text-anchor="middle">${esc(txt)}</text>`);
      cells.push({ row: r, col: i, value, x: dx, y: ry, w: col.width, h: rowH });
      dx += col.width;
    }
  }
  out.push('</g>');

  // Mini corner block (so the sheet matches the Title Block / Sheet Format
  // visual language).
  const MTB_W = 100, MTB_H = 22;
  const MTB_X = SVG_W - 5 - MTB_W;
  const MTB_Y = SVG_H - 5 - MTB_H;
  out.push(`<g class="title-block" data-archdisc-title-block="mini">`);
  out.push(`<rect x="${MTB_X}" y="${MTB_Y}" width="${MTB_W}" height="${MTB_H}" fill="white" stroke="black" stroke-width="0.5"/>`);
  out.push(`<text x="${MTB_X + 3}" y="${MTB_Y + 8}" font-family="monospace" font-size="4" font-weight="bold" fill="#111">${esc(partName)}</text>`);
  out.push(`<text x="${MTB_X + 3}" y="${MTB_Y + 14}" font-family="monospace" font-size="2.8" fill="#333">Tabular Note  ${columns.length}×${rows.length}  ${title}</text>`);
  out.push(`<text x="${MTB_X + 3}" y="${MTB_Y + 19}" font-family="monospace" font-size="2.8" fill="#333">Date ${esc(date)}  Sheet ${esc(sheet.size)} ${esc(sheet.orientation)}</text>`);
  out.push(`</g>`);

  out.push('</svg>');

  return {
    svg: out.join('\n'),
    info: {
      title,
      sheet,
      columns,
      columnCount: columns.length,
      rowCount: rows.length,
      position: { x: tableX, y: tableY },
      tableBBox: { x: tableX, y: tableY, w: tableW, h: tableH },
      cells,
      rowsRendered: rows.length,
    },
  };
}

export default { auxiliaryView, cropView, brokenView, modelItems, bom, autoBalloon, titleBlock, sheetFormat, steppedSectionLine, tabularNote, resolveSheet, SHEET_SIZES };
