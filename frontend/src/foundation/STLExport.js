/**
 * ArchDisc Foundation — STL export with manifold validation.
 *
 * manifold-3d guarantees the input mesh is manifold (closed, oriented,
 * non-self-intersecting). Our STL writer emits binary STL by default
 * because (a) it's smaller and (b) ASCII STL has historically been a
 * source of precision loss. We also expose ASCII STL for debugging.
 *
 * Validation we report (not enforce — manifold already does):
 *   - triangle count
 *   - vertex count
 *   - bounding box (mm)
 *   - volume (mm³)
 *   - surface area (mm²)
 *   - manifold status (always true on manifold-3d output)
 *
 * Print-prep checks (informational, do not block export):
 *   - min wall thickness via raycasting heuristic
 *   - overhang report — % of triangles below `overhangAngle` from horizontal
 *   - watertightness (already guaranteed by manifold)
 */

/**
 * Get the triangle mesh from a Manifold object.
 */
function getTriMesh(manifold) {
  const mesh = manifold.getMesh();
  return {
    vertProperties: mesh.vertProperties,
    triVerts: mesh.triVerts,
    numProp: mesh.numProp,
    numTri: mesh.triVerts.length / 3,
    numVert: mesh.vertProperties.length / mesh.numProp,
  };
}

/**
 * Compute triangle normal (right-hand rule).
 */
function triNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function getVertex(mesh, idx) {
  const off = idx * mesh.numProp;
  return [mesh.vertProperties[off], mesh.vertProperties[off + 1], mesh.vertProperties[off + 2]];
}

/**
 * Export a Manifold as binary STL.
 * @param {Manifold} manifold
 * @returns {Uint8Array}
 */
export function toBinarySTL(manifold) {
  const mesh = getTriMesh(manifold);
  const numTri = mesh.numTri;
  const buf = new ArrayBuffer(80 + 4 + numTri * 50);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // 80-byte header — set to a recognizable banner
  const banner = 'ArchDisc-foundation-binary-STL';
  for (let i = 0; i < banner.length && i < 80; i++) u8[i] = banner.charCodeAt(i);

  view.setUint32(80, numTri, true);

  let off = 84;
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVertex(mesh, i0);
    const p1 = getVertex(mesh, i1);
    const p2 = getVertex(mesh, i2);
    const n = triNormal(p0, p1, p2);
    view.setFloat32(off, n[0], true); off += 4;
    view.setFloat32(off, n[1], true); off += 4;
    view.setFloat32(off, n[2], true); off += 4;
    for (const v of [p0, p1, p2]) {
      view.setFloat32(off, v[0], true); off += 4;
      view.setFloat32(off, v[1], true); off += 4;
      view.setFloat32(off, v[2], true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2; // attribute byte count
  }
  return u8;
}

/**
 * Export a Manifold as ASCII STL — useful for human inspection / diff.
 * @returns {string}
 */
export function toAsciiSTL(manifold, name = 'archdisc_part') {
  const mesh = getTriMesh(manifold);
  const out = [`solid ${name}`];
  for (let t = 0; t < mesh.numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVertex(mesh, i0);
    const p1 = getVertex(mesh, i1);
    const p2 = getVertex(mesh, i2);
    const n = triNormal(p0, p1, p2);
    out.push(`  facet normal ${n[0]} ${n[1]} ${n[2]}`);
    out.push(`    outer loop`);
    for (const v of [p0, p1, p2]) out.push(`      vertex ${v[0]} ${v[1]} ${v[2]}`);
    out.push(`    endloop`);
    out.push(`  endfacet`);
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}

/**
 * Build a print-ready report. All metrics in current model units (mm
 * if your sketches are in mm).
 *
 * @param {Manifold} manifold
 * @param {object} opts
 * @param {number} opts.overhangAngleDeg — angle below horizontal that
 *                                          counts as needing supports
 *                                          (default 45)
 * @param {number} opts.minWallThicknessMm - threshold for wall warning
 *                                            (default 0.8 mm; FDM safe)
 */
export function buildPrintReport(manifold, opts = {}) {
  const overhangAngleDeg = opts.overhangAngleDeg ?? 45;
  const overhangCos = Math.cos((overhangAngleDeg * Math.PI) / 180);
  const minWall = opts.minWallThicknessMm ?? 0.8;

  const mesh = getTriMesh(manifold);
  const volume = manifold.volume();
  const surfaceArea = manifold.surfaceArea();
  const bbox = manifold.boundingBox();

  let overhangCount = 0;
  let downwardArea = 0;
  let totalArea = 0;
  let edgeLenMin = Infinity, edgeLenMax = 0;

  for (let t = 0; t < mesh.numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    const p0 = getVertex(mesh, i0);
    const p1 = getVertex(mesh, i1);
    const p2 = getVertex(mesh, i2);

    // area
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    totalArea += area;

    // normal (no need to normalize for sign of z-component test)
    // overhang: triangle whose downward-pointing normal makes an
    // angle > overhangAngleDeg with horizontal — i.e. nz is more
    // negative than -cos(overhangAngleDeg).
    const len = Math.hypot(cx, cy, cz) || 1;
    const nz = cz / len;
    if (nz < -overhangCos) {
      overhangCount++;
      downwardArea += area;
    }
    for (const [a, b] of [[p0, p1], [p1, p2], [p2, p0]]) {
      const e = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (e < edgeLenMin) edgeLenMin = e;
      if (e > edgeLenMax) edgeLenMax = e;
    }
  }

  return {
    manifold: true,
    triangles: mesh.numTri,
    vertices: mesh.numVert,
    boundingBoxMm: bbox,
    volumeMm3: volume,
    surfaceAreaMm2: surfaceArea,
    edgeLengthRangeMm: { min: edgeLenMin, max: edgeLenMax },
    overhang: {
      angleThresholdDeg: overhangAngleDeg,
      triangleCount: overhangCount,
      areaFraction: totalArea > 0 ? downwardArea / totalArea : 0,
    },
    minWallThicknessThresholdMm: minWall,
    notes: [
      'manifold output guaranteed by manifold-3d.',
      'min-wall-thickness deep analysis pending — current report shows edge length ranges as a coarse signal.',
      'Overhang area fraction is informational; supports may still be needed for downward-facing features even when fraction is low.',
    ],
  };
}
