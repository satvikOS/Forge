/**
 * ArchDisc Foundation — 3D-print slicer + G-code generator.
 *
 * Slice a manifold-3d Manifold (or compatible mesh) by horizontal
 * planes at uniform layer heights, producing ordered closed polygons
 * per layer. Optionally generate G-code for an FDM printer (perimeter
 * + simple linear infill).
 *
 * Algorithm:
 *
 *   For each plane z = z_k:
 *     1. For each triangle whose vertices straddle z, compute the
 *        line segment where the triangle intersects the plane.
 *     2. Stitch segments into closed polygon loops by chaining
 *        endpoints (within `weldEps`).
 *     3. Classify outer vs inner loops by signed area for hole-
 *        aware infill.
 *
 * G-code:
 *   - Standard FDM Marlin / Klipper subset
 *   - Header: M82 (absolute extrusion), G28 (home), M104/M109 (temp),
 *             G92 E0
 *   - Per layer: G0 to start, G1 along perimeter with extrusion,
 *                G1 zig-zag infill clipped against perimeter
 *   - Trailer: M104 S0 (cool), G28 X0
 *
 * Defaults match a generic 0.4-mm-nozzle FDM printer.
 */

const TET_FACES_NA = null;   // unused
const DEFAULT_WELD_EPS = 1e-4;

function getVert(mesh, idx) {
  const off = idx * mesh.numProp;
  return [mesh.vertProperties[off], mesh.vertProperties[off + 1], mesh.vertProperties[off + 2]];
}

/**
 * Intersect one triangle with plane z = zPlane. Returns 0, 1, or 2
 * intersection points. (3 if all 3 vertices lie on the plane — we
 * skip these to avoid degenerate slivers.)
 */
function triPlaneZ(p0, p1, p2, zPlane) {
  const d0 = p0[2] - zPlane;
  const d1 = p1[2] - zPlane;
  const d2 = p2[2] - zPlane;
  // If all on same side, no intersection.
  if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) return null;
  const pts = [];
  const interp = (a, b, da, db) => {
    if (Math.abs(da) < 1e-12 && Math.abs(db) < 1e-12) return null;
    if (da * db > 0) return null;     // same sign, no crossing
    if (Math.abs(db - da) < 1e-12) return null;
    const t = -da / (db - da);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const e01 = interp(p0, p1, d0, d1);
  const e12 = interp(p1, p2, d1, d2);
  const e20 = interp(p2, p0, d2, d0);
  if (e01) pts.push(e01);
  if (e12) pts.push(e12);
  if (e20) pts.push(e20);
  if (pts.length < 2) return null;
  // Dedup near-coincident points
  const out = [];
  for (const p of pts) {
    let dup = false;
    for (const q of out) {
      if (Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) { dup = true; break; }
    }
    if (!dup) out.push(p);
  }
  if (out.length !== 2) return null;
  return out;
}

/**
 * Slice the mesh at z = zPlane → array of unordered line segments.
 */
function sliceAtZ(mesh, zPlane) {
  const segs = [];
  const numTri = mesh.triVerts.length / 3;
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVert(mesh, i0);
    const p1 = getVert(mesh, i1);
    const p2 = getVert(mesh, i2);
    const xs = triPlaneZ(p0, p1, p2, zPlane);
    if (xs) segs.push([xs[0], xs[1]]);
  }
  return segs;
}

/**
 * Stitch segments into closed polygons. Greedy: pick a segment, walk
 * by matching its endpoint to another segment's start (within eps),
 * continue until we return to the start.
 */
function stitch(segments, weldEps = DEFAULT_WELD_EPS) {
  const polys = [];
  const used = new Uint8Array(segments.length);
  const eps2 = weldEps * weldEps;
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  for (let s0 = 0; s0 < segments.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const poly = [segments[s0][0], segments[s0][1]];
    let last = poly[poly.length - 1];
    let extended = true;
    while (extended) {
      extended = false;
      for (let s = 0; s < segments.length; s++) {
        if (used[s]) continue;
        const seg = segments[s];
        if (dist2(seg[0], last) < eps2) {
          poly.push(seg[1]);
          last = seg[1];
          used[s] = 1;
          extended = true;
          break;
        } else if (dist2(seg[1], last) < eps2) {
          poly.push(seg[0]);
          last = seg[0];
          used[s] = 1;
          extended = true;
          break;
        }
      }
    }
    // Close if endpoints meet within eps
    if (poly.length >= 3 && dist2(poly[0], poly[poly.length - 1]) < eps2) {
      poly.pop();   // remove duplicate closing point
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += (x2 - x1) * (y1 + y2);
  }
  return -a / 2;
}

/**
 * Slice a manifold into N layers between zMin and zMax.
 *
 * @param {Manifold|MeshLike} manifold
 * @param {object} options
 * @param {number} options.layerHeight - mm
 * @param {number} options.weldEps     - segment dedup tolerance (mm)
 * @returns {Array<{ z, polygons: [{points, signedArea, isOuter}] }>}
 */
export function sliceManifold(manifold, options = {}) {
  const layerHeight = options.layerHeight ?? 0.2;
  const weldEps = options.weldEps ?? DEFAULT_WELD_EPS;
  const mesh = manifold.getMesh ? manifold.getMesh() : manifold;
  const bbox = manifold.boundingBox ? manifold.boundingBox() : meshBBox(mesh);
  const zMin = bbox.min[2];
  const zMax = bbox.max[2];
  const numLayers = Math.max(1, Math.floor((zMax - zMin) / layerHeight));
  const layers = [];
  for (let k = 0; k < numLayers; k++) {
    const z = zMin + (k + 0.5) * layerHeight;   // mid-layer
    const segs = sliceAtZ(mesh, z);
    const polys = stitch(segs, weldEps);
    const polyData = polys.map(p => {
      const A = signedArea(p);
      return { points: p, signedArea: A, isOuter: A > 0 };
    });
    layers.push({ z, polygons: polyData });
  }
  return layers;
}

function meshBBox(mesh) {
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  const numV = mesh.vertProperties.length / mesh.numProp;
  for (let i = 0; i < numV; i++) {
    const x = mesh.vertProperties[i * mesh.numProp];
    const y = mesh.vertProperties[i * mesh.numProp + 1];
    const z = mesh.vertProperties[i * mesh.numProp + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  return { min: [xmin, ymin, zmin], max: [xmax, ymax, zmax] };
}

/**
 * Render layer outlines as SVG.
 * Each layer's polygons traced; multiple layers superimposed with
 * z-coloring (warm = top, cool = bottom).
 */
export function renderLayersSVG(layers, options = {}) {
  const margin = options.marginMm ?? 8;
  const stride = options.layerStride ?? 1;
  // Compute bounds
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const L of layers) for (const p of L.polygons) for (const [x, y] of p.points) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const w = (xmax - xmin) + 2 * margin;
  const h = (ymax - ymin) + 2 * margin;
  const N = layers.length;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">`);
  lines.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>`);
  for (let k = 0; k < N; k += stride) {
    const layer = layers[k];
    const t = k / Math.max(N - 1, 1);
    const r = Math.round(50 + 200 * t);
    const g = Math.round(100 + 50 * (1 - t));
    const b = Math.round(220 - 200 * t);
    const stroke = `rgb(${r},${g},${b})`;
    for (const poly of layer.polygons) {
      let d = '';
      for (let i = 0; i < poly.points.length; i++) {
        const [x, y] = poly.points[i];
        const X = margin + (x - xmin);
        const Y = margin + (ymax - y);    // flip y for screen
        d += (i === 0 ? `M ${X.toFixed(3)} ${Y.toFixed(3)}` : ` L ${X.toFixed(3)} ${Y.toFixed(3)}`);
      }
      d += ' Z';
      lines.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="0.18"/>`);
    }
  }
  lines.push(`<text x="${margin}" y="${h - 2}" font-family="monospace" font-size="2.5">${N} layers (every ${stride}th rendered) · z = ${layers[0]?.z.toFixed(2) ?? '?'} → ${layers[N-1]?.z.toFixed(2) ?? '?'} mm</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

/**
 * Generate basic FDM G-code from sliced layers.
 *
 * @param {Array} layers - slicer output
 * @param {object} opts
 *   nozzleDiameterMm     0.4
 *   layerHeightMm        0.2
 *   filamentDiameterMm   1.75
 *   printSpeedMmPerMin   1800   (= 30 mm/s)
 *   travelSpeedMmPerMin  4800
 *   nozzleTempC          200
 *   bedTempC             60
 *   extrusionMultiplier  1.0
 * @returns {string}
 */
export function generateGCode(layers, opts = {}) {
  const nozzle = opts.nozzleDiameterMm ?? 0.4;
  const layerH = opts.layerHeightMm ?? 0.2;
  const filamentDia = opts.filamentDiameterMm ?? 1.75;
  const printF = opts.printSpeedMmPerMin ?? 1800;
  const travelF = opts.travelSpeedMmPerMin ?? 4800;
  const nozzleT = opts.nozzleTempC ?? 200;
  const bedT = opts.bedTempC ?? 60;
  const extMult = opts.extrusionMultiplier ?? 1.0;

  // Volumetric extrusion calc:
  //   filament cross-section area: A_f = π (d_f/2)²
  //   per-mm-travel volume: V = nozzle × layerH × extMult
  //   per-mm-travel filament length: E_per_mm = V / A_f
  const Af = Math.PI * (filamentDia / 2) ** 2;
  const Eper = (nozzle * layerH * extMult) / Af;

  const out = [];
  out.push(';; ArchDisc Foundation slicer');
  out.push(`;; layers ${layers.length}, layerH ${layerH}, nozzle ${nozzle}, filament ${filamentDia}`);
  out.push(`;; nozzle ${nozzleT} °C, bed ${bedT} °C`);
  out.push('M82 ; absolute extrusion');
  out.push('G21 ; mm');
  out.push('G90 ; absolute');
  out.push(`M140 S${bedT}`);
  out.push(`M104 S${nozzleT}`);
  out.push(`M190 S${bedT}`);
  out.push(`M109 S${nozzleT}`);
  out.push('G28 ; home');
  out.push('G92 E0');
  out.push('G1 Z0.2 F300');

  let E = 0;
  let lastX = 0, lastY = 0, lastZ = 0;

  for (let k = 0; k < layers.length; k++) {
    const L = layers[k];
    out.push('');
    out.push(`;; LAYER ${k} z=${L.z.toFixed(3)}`);
    out.push(`G1 Z${L.z.toFixed(3)} F${travelF}`);
    lastZ = L.z;

    for (const poly of L.polygons) {
      // Travel to first point
      const p0 = poly.points[0];
      out.push(`G0 X${p0[0].toFixed(3)} Y${p0[1].toFixed(3)} F${travelF}`);
      lastX = p0[0]; lastY = p0[1];

      // Extrude perimeter
      for (let i = 1; i < poly.points.length; i++) {
        const p = poly.points[i];
        const dx = p[0] - lastX, dy = p[1] - lastY;
        const dist = Math.hypot(dx, dy);
        E += Eper * dist;
        out.push(`G1 X${p[0].toFixed(3)} Y${p[1].toFixed(3)} E${E.toFixed(4)} F${printF}`);
        lastX = p[0]; lastY = p[1];
      }
      // Close back to start
      const dx = poly.points[0][0] - lastX, dy = poly.points[0][1] - lastY;
      const dist = Math.hypot(dx, dy);
      E += Eper * dist;
      out.push(`G1 X${poly.points[0][0].toFixed(3)} Y${poly.points[0][1].toFixed(3)} E${E.toFixed(4)} F${printF}`);
      lastX = poly.points[0][0]; lastY = poly.points[0][1];
    }
  }

  out.push('');
  out.push(';; END');
  out.push(`G1 Z${(lastZ + 5).toFixed(3)} F${travelF}`);
  out.push('M104 S0');
  out.push('M140 S0');
  out.push('G28 X0');
  return out.join('\n');
}

/**
 * Estimate print stats (filament use, time) from G-code.
 */
export function estimatePrint(gcode) {
  const lines = gcode.split('\n');
  let filamentMm = 0;
  let totalTimeS = 0;
  let lastX = 0, lastY = 0, lastZ = 0, lastE = 0, lastF = 1800;
  for (const ln of lines) {
    if (!ln.startsWith('G0') && !ln.startsWith('G1')) continue;
    const x = match(ln, /X(-?[\d.]+)/);
    const y = match(ln, /Y(-?[\d.]+)/);
    const z = match(ln, /Z(-?[\d.]+)/);
    const e = match(ln, /E(-?[\d.]+)/);
    const f = match(ln, /F([\d.]+)/);
    if (f != null) lastF = f;
    const nx = x ?? lastX, ny = y ?? lastY, nz = z ?? lastZ;
    const dx = nx - lastX, dy = ny - lastY, dz = nz - lastZ;
    const dist = Math.hypot(dx, dy, dz);
    const speed = lastF / 60;   // mm/s
    if (speed > 0) totalTimeS += dist / speed;
    if (e != null) {
      const dE = e - lastE;
      if (dE > 0) filamentMm += dE;
      lastE = e;
    }
    lastX = nx; lastY = ny; lastZ = nz;
  }
  return { filamentMm, filamentLengthMm: filamentMm, printTimeMin: totalTimeS / 60 };
}

function match(s, re) {
  const m = s.match(re);
  return m ? parseFloat(m[1]) : null;
}
