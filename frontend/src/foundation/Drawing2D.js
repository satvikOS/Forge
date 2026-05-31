/**
 * ArchDisc Foundation — 3D → 2D Engineering Drawing
 *
 * Derives an SVG drawing directly from a Manifold solid by:
 *
 *   1. Projecting all triangles onto a view plane (front/top/side or arbitrary)
 *   2. Classifying every edge of the mesh as:
 *        - silhouette : adjacent triangles' normals on opposite sides of the
 *                       view direction (one front-facing, one back-facing).
 *                       This is the visible profile of the body.
 *        - crease     : adjacent triangles whose normals differ by more than
 *                       a threshold angle (sharp feature edge).
 *        - smooth     : nearly-coplanar adjacent triangles (curve tessellation).
 *                       Suppressed in the drawing.
 *   3. Emitting visible silhouette + crease edges as SVG lines with proper
 *      ASME / ISO line weights and styles.
 *
 * The output is a single SVG with three orthographic views (front, top,
 * side) plus an isometric, plus a title block with bounding-box dimensions.
 *
 * NOTE: this implementation does NOT yet do full hidden-line removal —
 * occluded edges are simply dropped, not rendered as dashed hidden lines.
 * That is the next iteration. For now visible silhouette + crease edges
 * cover the dominant use case (quick part documentation).
 */

const SMOOTH_THRESHOLD_DEG = 30;   // edges below this dihedral are tesselation, skip
const VISIBLE_LINE_WIDTH = 0.7;    // mm in paper space (ISO 128 thick)
const CONSTRUCTION_LINE_WIDTH = 0.18;
const DIM_LINE_WIDTH = 0.25;

const VIEW_DIRECTIONS = {
  front: { eye: [0, -1, 0], up: [0, 0, 1] },
  top:   { eye: [0,  0,-1], up: [0, 1, 0] },
  side:  { eye: [1,  0, 0], up: [0, 0, 1] },
  iso:   { eye: [-1,-1, 1], up: [0, 0, 1] },
};

/**
 * Build the topological edge map of a manifold mesh:
 *   each undirected edge → its 1 or 2 incident triangles + their normals.
 */
function buildEdgeMap(mesh) {
  const edgeMap = new Map();   // key="i0,i1" sorted → { tris: [{idx, normal}, …] }
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
function normalize(v) { const l = Math.hypot(...v) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }

/**
 * Build a 3×3 view matrix mapping world → view space:
 *   x_view = right axis
 *   y_view = up axis
 *   z_view = -eye (camera looks down -z_view)
 *
 * Then project: viewSpacePoint = M × (worldPoint − origin).
 * Drop z to get 2D paper coordinates.
 */
function buildViewMatrix(eye, up) {
  const z = normalize(eye);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return { x, y, z };
}

function projectPoint(p, view) {
  return [dot(p, view.x), dot(p, view.y), dot(p, view.z)];
}

/**
 * Classify every mesh edge for a given view direction. Returns lists
 * of silhouette + crease edges (each with their two endpoint indices).
 */
function classifyEdges(mesh, edgeMap, viewDir) {
  const silhouette = [];
  const crease = [];
  const creaseCos = Math.cos((SMOOTH_THRESHOLD_DEG * Math.PI) / 180);
  for (const e of edgeMap.values()) {
    if (e.tris.length === 1) {
      // boundary (shouldn't happen on closed manifold)
      silhouette.push(e); continue;
    }
    const [t0, t1] = e.tris;
    const n0 = t0.normal, n1 = t1.normal;
    const f0 = dot(n0, viewDir);   // front-facing if dot < 0 (normal away from eye)
    const f1 = dot(n1, viewDir);
    if (f0 * f1 < 0) {
      silhouette.push(e);          // sign change = silhouette
    } else if (dot(n0, n1) < creaseCos) {
      crease.push(e);              // sharp feature
    }
    // else: smooth tesselation, skip
  }
  return { silhouette, crease };
}

/**
 * Project an edge to 2D paper coordinates given a view matrix and a
 * translation that centers the part.
 */
function projectEdge(e, mesh, view, offset) {
  const a = getVert(mesh, e.vA);
  const b = getVert(mesh, e.vB);
  const ap = projectPoint([a[0] - offset[0], a[1] - offset[1], a[2] - offset[2]], view);
  const bp = projectPoint([b[0] - offset[0], b[1] - offset[1], b[2] - offset[2]], view);
  return { x1: ap[0], y1: ap[1], x2: bp[0], y2: bp[1], z1: ap[2], z2: bp[2] };
}

/**
 * Hidden-line test: is point (x, y) at depth z in view space occluded by
 * any triangle that lies in front of it (smaller z = closer to viewer in
 * our convention)?
 *
 * We project all triangles into 2D paper coords once. For each query
 * sample (x, y, z) we look up the candidate triangles whose 2D bounding
 * boxes contain (x, y), then test point-in-triangle and depth.
 */
function buildOcclusionGrid(mesh, view, partOrigin) {
  const numTri = mesh.triVerts.length / 3;
  const tris2D = new Array(numTri);
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVert(mesh, i0); const p1 = getVert(mesh, i1); const p2 = getVert(mesh, i2);
    const a = projectPoint([p0[0] - partOrigin[0], p0[1] - partOrigin[1], p0[2] - partOrigin[2]], view);
    const b = projectPoint([p1[0] - partOrigin[0], p1[1] - partOrigin[1], p1[2] - partOrigin[2]], view);
    const c = projectPoint([p2[0] - partOrigin[0], p2[1] - partOrigin[1], p2[2] - partOrigin[2]], view);
    const triMinX = Math.min(a[0], b[0], c[0]);
    const triMaxX = Math.max(a[0], b[0], c[0]);
    const triMinY = Math.min(a[1], b[1], c[1]);
    const triMaxY = Math.max(a[1], b[1], c[1]);
    tris2D[t] = {
      ax: a[0], ay: a[1], az: a[2],
      bx: b[0], by: b[1], bz: b[2],
      cx: c[0], cy: c[1], cz: c[2],
      minX: triMinX, maxX: triMaxX, minY: triMinY, maxY: triMaxY,
    };
    if (triMinX < xmin) xmin = triMinX;
    if (triMaxX > xmax) xmax = triMaxX;
    if (triMinY < ymin) ymin = triMinY;
    if (triMaxY > ymax) ymax = triMaxY;
  }

  // Bucket triangles into a uniform grid for O(1) point-query candidates.
  // Cell size = sqrt(area / numTri) ≈ avg-triangle scale.
  const w = Math.max(xmax - xmin, 1e-6);
  const h = Math.max(ymax - ymin, 1e-6);
  const cellSize = Math.max(Math.sqrt((w * h) / Math.max(numTri, 1)), 1e-3);
  const cols = Math.max(1, Math.ceil(w / cellSize));
  const rows = Math.max(1, Math.ceil(h / cellSize));
  const cells = Array.from({ length: cols * rows }, () => []);
  const cellIdx = (cx, cy) => cy * cols + cx;
  for (let t = 0; t < numTri; t++) {
    const tri = tris2D[t];
    const cx0 = Math.max(0, Math.min(cols - 1, Math.floor((tri.minX - xmin) / cellSize)));
    const cx1 = Math.max(0, Math.min(cols - 1, Math.floor((tri.maxX - xmin) / cellSize)));
    const cy0 = Math.max(0, Math.min(rows - 1, Math.floor((tri.minY - ymin) / cellSize)));
    const cy1 = Math.max(0, Math.min(rows - 1, Math.floor((tri.maxY - ymin) / cellSize)));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) cells[cellIdx(cx, cy)].push(t);
    }
  }
  return { tris2D, cells, cols, rows, cellSize, xmin, ymin };
}

function trianglesNear(grid, x, y) {
  const cx = Math.max(0, Math.min(grid.cols - 1, Math.floor((x - grid.xmin) / grid.cellSize)));
  const cy = Math.max(0, Math.min(grid.rows - 1, Math.floor((y - grid.ymin) / grid.cellSize)));
  return grid.cells[cy * grid.cols + cx];
}

/**
 * Barycentric point-in-triangle test that returns interpolated depth z
 * at (px, py) if inside, else null.
 */
function triDepthAt(t, px, py) {
  if (px < t.minX || px > t.maxX || py < t.minY || py > t.maxY) return null;
  const v0x = t.bx - t.ax, v0y = t.by - t.ay;
  const v1x = t.cx - t.ax, v1y = t.cy - t.ay;
  const v2x = px   - t.ax, v2y = py   - t.ay;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return null;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  const eps = -1e-6;
  if (u < eps || v < eps || w < eps) return null;
  return u * t.az + v * t.bz + w * t.cz;
}

/**
 * Emit one orthographic view as an SVG <g> element. Performs hidden-line
 * removal: silhouette + crease edges that are occluded by closer
 * triangles render dashed; visible portions render solid. Edges are
 * deduped by sorted vertex pair so each undirected edge draws once.
 */
function emitViewSVG(mesh, viewName, viewDef, partOrigin, paperOrigin, paperScale) {
  const view = buildViewMatrix(viewDef.eye, viewDef.up);
  const edgeMap = buildEdgeMap(mesh);
  const { silhouette, crease } = classifyEdges(mesh, edgeMap, viewDef.eye);
  const grid = buildOcclusionGrid(mesh, view, partOrigin);
  const out = [`<g class="view view-${viewName}" transform="translate(${paperOrigin[0]},${paperOrigin[1]})">`];

  const drawnKeys = new Set();
  const drawEdgeWithHLR = (e) => {
    const key = e.vA < e.vB ? `${e.vA},${e.vB}` : `${e.vB},${e.vA}`;
    if (drawnKeys.has(key)) return;
    drawnKeys.add(key);

    const p = projectEdge(e, mesh, view, partOrigin);
    // Depth-sample N points along the edge in view space. Treat a sample
    // as occluded if any triangle (other than the two adjacent to this
    // edge) interpolates a smaller-z at that sample's (x, y), with a
    // small back-off to avoid self-occlusion at the edge.
    const adjacentTris = new Set(e.tris.map(t => t.tri));
    // Adapt samples to mesh complexity; for >10k tri parts (e.g. helical
    // threads) we use fewer samples to keep generation tractable.
    const totalTris = grid.tris2D.length;
    const SAMPLES = totalTris > 10000 ? 6 : totalTris > 2000 ? 12 : 18;
    const occlusionBackoff = 1e-3;  // mm in view space
    const segs = [];   // list of { from, to, hidden }
    let curStart = 0;
    let curHidden = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const tParam = i / SAMPLES;
      const x = p.x1 + (p.x2 - p.x1) * tParam;
      const y = p.y1 + (p.y2 - p.y1) * tParam;
      const z = p.z1 + (p.z2 - p.z1) * tParam;
      let hidden = false;
      const candidates = trianglesNear(grid, x, y);
      for (let k = 0; k < candidates.length; k++) {
        const ti = candidates[k];
        if (adjacentTris.has(ti)) continue;
        const tz = triDepthAt(grid.tris2D[ti], x, y);
        if (tz != null && tz < z - occlusionBackoff) { hidden = true; break; }
      }
      if (curHidden === null) curHidden = hidden;
      if (hidden !== curHidden) {
        segs.push({ from: curStart, to: tParam, hidden: curHidden });
        curStart = tParam; curHidden = hidden;
      }
    }
    segs.push({ from: curStart, to: 1, hidden: curHidden });

    for (const s of segs) {
      const x1 = (p.x1 + (p.x2 - p.x1) * s.from) * paperScale;
      const y1 = -(p.y1 + (p.y2 - p.y1) * s.from) * paperScale;
      const x2 = (p.x1 + (p.x2 - p.x1) * s.to) * paperScale;
      const y2 = -(p.y1 + (p.y2 - p.y1) * s.to) * paperScale;
      const dx = x2 - x1, dy = y2 - y1;
      if (dx * dx + dy * dy < 1e-4) continue;
      if (s.hidden) {
        out.push(`<line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}" stroke="#888" stroke-width="${VISIBLE_LINE_WIDTH * 0.6}" stroke-dasharray="1.2,0.8"/>`);
      } else {
        out.push(`<line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}" stroke="black" stroke-width="${VISIBLE_LINE_WIDTH}"/>`);
      }
    }
  };

  for (const e of silhouette) drawEdgeWithHLR(e);
  for (const e of crease)     drawEdgeWithHLR(e);

  // Label
  out.push(`<text x="0" y="-3" font-family="monospace" font-size="3.5" fill="#333">${viewName.toUpperCase()}</text>`);
  out.push('</g>');
  return out.join('\n');
}

/**
 * Build a complete 3-view + iso engineering drawing for a Manifold.
 *
 * Paper layout (in mm):
 *   A3 landscape: 420 × 297
 *
 *      ┌──────────────────────────────────────────────────────┐
 *      │ TOP                          ISO                     │
 *      │                                                      │
 *      │ FRONT                        SIDE                    │
 *      │                                                      │
 *      │                              ┌─────────────────────┐ │
 *      │                              │ TITLE BLOCK         │ │
 *      │                              └─────────────────────┘ │
 *      └──────────────────────────────────────────────────────┘
 */
export function buildDrawingSVG(manifold, options = {}) {
  const mesh = manifold.getMesh();
  const bbox = manifold.boundingBox();
  const minP = bbox.min, maxP = bbox.max;
  const sizeX = maxP[0] - minP[0];
  const sizeY = maxP[1] - minP[1];
  const sizeZ = maxP[2] - minP[2];
  const partOrigin = [(minP[0] + maxP[0]) / 2, (minP[1] + maxP[1]) / 2, (minP[2] + maxP[2]) / 2];
  const partExtent = Math.max(sizeX, sizeY, sizeZ);

  // Choose a paper scale that fits 3 views in ~390 × 270 mm.
  const viewExtent = partExtent * 1.4;   // each view gets some breathing room
  const paperScale = Math.min(140 / viewExtent, 100 / viewExtent, 1);

  // View positions (mm on the paper)
  const viewPositions = {
    front: [60,  130],
    top:   [60,   60],
    side:  [220, 130],
    iso:   [220,  60],
  };

  const SVG_W = 420, SVG_H = 297;
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}mm" height="${SVG_H}mm" preserveAspectRatio="xMidYMid meet">`,
    `<rect x="5" y="5" width="${SVG_W - 10}" height="${SVG_H - 10}" fill="white" stroke="black" stroke-width="0.5"/>`,
  ];

  // Emit each view
  for (const [name, def] of Object.entries(VIEW_DIRECTIONS)) {
    out.push(emitViewSVG(mesh, name, def, partOrigin, viewPositions[name], paperScale));
  }

  // Title block in lower-right corner
  const partName = options.name ?? 'Untitled Part';
  const material = options.material ?? '—';
  const tolerance = options.tolerance ?? 'ASME Y14.5 ±0.1 mm unless noted';
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const drawnBy = options.drawnBy ?? 'ArchDisc Foundation';
  const scaleStr = `${paperScale.toFixed(2)}:1`;
  const tbX = 230, tbY = 215, tbW = 180, tbH = 70;
  out.push(`<g class="title-block">`);
  out.push(`<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="white" stroke="black" stroke-width="0.5"/>`);
  out.push(`<line x1="${tbX}" y1="${tbY + 12}" x2="${tbX + tbW}" y2="${tbY + 12}" stroke="black" stroke-width="0.3"/>`);
  out.push(`<line x1="${tbX}" y1="${tbY + 24}" x2="${tbX + tbW}" y2="${tbY + 24}" stroke="black" stroke-width="0.3"/>`);
  out.push(`<line x1="${tbX}" y1="${tbY + 36}" x2="${tbX + tbW}" y2="${tbY + 36}" stroke="black" stroke-width="0.3"/>`);
  out.push(`<line x1="${tbX}" y1="${tbY + 48}" x2="${tbX + tbW}" y2="${tbY + 48}" stroke="black" stroke-width="0.3"/>`);
  out.push(`<line x1="${tbX + 60}" y1="${tbY + 24}" x2="${tbX + 60}" y2="${tbY + 48}" stroke="black" stroke-width="0.3"/>`);
  out.push(`<text x="${tbX + 4}" y="${tbY + 9}" font-family="monospace" font-size="4.0" font-weight="bold">${esc(partName)}</text>`);
  out.push(`<text x="${tbX + 4}" y="${tbY + 21}" font-family="monospace" font-size="2.5">Material: ${esc(material)}</text>`);
  out.push(`<text x="${tbX + 4}" y="${tbY + 33}" font-family="monospace" font-size="2.5">Bbox: ${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} mm</text>`);
  out.push(`<text x="${tbX + 64}" y="${tbY + 33}" font-family="monospace" font-size="2.5">Vol: ${manifold.volume().toFixed(0)} mm³</text>`);
  out.push(`<text x="${tbX + 4}" y="${tbY + 45}" font-family="monospace" font-size="2.5">Tris: ${mesh.triVerts.length / 3}</text>`);
  out.push(`<text x="${tbX + 64}" y="${tbY + 45}" font-family="monospace" font-size="2.5">Genus: ${manifold.genus()}</text>`);
  out.push(`<text x="${tbX + 4}" y="${tbY + 57}" font-family="monospace" font-size="2.0">${esc(tolerance)}</text>`);
  out.push(`<text x="${tbX + 4}" y="${tbY + 67}" font-family="monospace" font-size="2.5">Drawn: ${esc(drawnBy)}  ${date}  Scale ${scaleStr}</text>`);
  out.push(`</g>`);

  // ASME third-angle projection symbol in lower-left
  out.push(`<g transform="translate(20, 250)">
    <circle cx="0" cy="6" r="4" fill="none" stroke="black" stroke-width="0.4"/>
    <circle cx="0" cy="6" r="2.5" fill="none" stroke="black" stroke-width="0.4"/>
    <polygon points="14,2 14,10 26,6" fill="none" stroke="black" stroke-width="0.4"/>
    <polygon points="14,2 22,2 18,5 22,10 14,10 18,6" fill="none" stroke="black" stroke-width="0.4"/>
    <text x="0" y="20" font-family="monospace" font-size="2.5" text-anchor="middle">3rd-angle</text>
  </g>`);

  out.push('</svg>');
  return out.join('\n');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
