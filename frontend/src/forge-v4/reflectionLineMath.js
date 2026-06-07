// PUSH-213 (Slice-157) — Real reflection-line analyser math.
//
// Class-A surfacing parity with Alias / ICEM. Reflection lines are the
// family of curves on a surface where the reflected view of an infinite
// straight light source forms a continuous line. Discontinuities in
// reflection-line shape reveal G1 / G2 issues just like zebra stripes —
// but with a strict directional analytic light source.
//
// Algorithm (per slice brief):
//
//   1. Define an infinite line light source as L(t) = O + t·D where O is
//      an origin point and D is a unit direction.
//
//   2. For each surface vertex with normal n, the reflected ray direction
//      is r = -2·(v·n)·n + v where v is view→vertex. The reflection line
//      passes through vertices whose reflected ray points to the light
//      source within an angular tolerance ε.
//
//   3. Implementation: at every triangle, evaluate
//          f(P) = reflection_direction(P) · light_axis(P) − cos(ε)
//      where light_axis(P) is the unit direction from P perpendicular to
//      the infinite light line (the closest-line direction). When two
//      vertices of a triangle have opposite sign for f, the reflection
//      line crosses that edge at the zero-crossing — linearly interpolate
//      the position. The two crossings on the two opposite-sign edges
//      become a line segment for that triangle (the marching-cubes 1D
//      analogue on triangle edges).
//
//   4. Multiple parallel reflection lines: offset the line origin along
//      a direction perpendicular to D by k·spacing for k = -N/2..+N/2.
//      Each line is rendered as its own coloured family.
//
// Hard constraints:
//   - NO new npm packages, no THREE import here (this is pure math).
//   - Real iso-contour math, real reflection vector math.
//
// All vectors are flat-array {x,y,z} or [x,y,z]; helpers below normalise.

// ─────────────────────────────────────────────────────────────────────
// Vector helpers — pure, no deps. Operate on plain {x,y,z} objects so
// the entry points stay friendly to test harnesses + Archie tool calls.

export function v3(x, y, z) {
  return { x: +x, y: +y, z: +z };
}

export function v3FromArray(a, off = 0) {
  return { x: +a[off + 0], y: +a[off + 1], z: +a[off + 2] };
}

export function v3Add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function v3Sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function v3Scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function v3Dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3Cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function v3Length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function v3Normalise(a) {
  const L = v3Length(a);
  if (L < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: a.x / L, y: a.y / L, z: a.z / L };
}

export function v3Lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reflection vector.
//
// Given an outgoing view direction v (from surface point toward the
// viewer) and the unit surface normal n, the reflected direction r is
// the canonical specular-reflection vector:
//
//     r = 2·(n·v)·n − v
//
// The slice brief's wording ("r = -2(v·n)n + v where v is view→vertex")
// is the same vector with v reversed in direction (view→vertex instead
// of vertex→view). To keep the convention unambiguous we always require
// `viewDir` to be a unit vector pointing from the viewer to the surface
// point (the conventional ray direction in path-tracing literature). The
// reflected direction therefore is:
//
//     r = viewDir − 2·(viewDir·n)·n
//
// which equals the mirror reflection of `viewDir` about the plane normal
// to n. Both forms are equivalent for testing collinearity with the
// infinite-light direction since the sign of the dot product is what we
// use as the contour iso-surface.

export function reflectAbout(viewDir, normal) {
  // viewDir: ray from viewer toward the surface point (unit).
  // normal:  unit surface normal at the point.
  // Returns: r = viewDir − 2·(viewDir·n)·n  (unit if inputs are unit).
  const vn = v3Dot(viewDir, normal);
  return {
    x: viewDir.x - 2 * vn * normal.x,
    y: viewDir.y - 2 * vn * normal.y,
    z: viewDir.z - 2 * vn * normal.z,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Closest-point on an infinite line L(t) = O + t·D.
//
// Returns the parameter t* such that |O + t*·D − P|² is minimised, and
// the closest point Q on the line. The "axis-to-point" direction we use
// in the iso-contour function is then  unit(P − Q).
//
// For a unit-length D, t* = D·(P − O).

export function closestPointOnLine(point, origin, dir) {
  // dir must be a unit vector.
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const t = dx * dir.x + dy * dir.y + dz * dir.z;
  return {
    t,
    closest: {
      x: origin.x + t * dir.x,
      y: origin.y + t * dir.y,
      z: origin.z + t * dir.z,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Iso-contour scalar field.
//
// For a vertex P with surface normal n, view direction viewDir, and
// light line L(t) = origin + t·dir, the iso-contour scalar is
//
//     f(P) = r · u  −  cos(ε)
//
// where r is the unit reflection vector at P, u is the unit vector from
// P to the closest point on the light line, and ε is the angular
// tolerance. The reflection line lies on f = 0 (i.e. the reflected ray
// from the viewer through P, mirrored about n, points to the light line
// within the cone of half-angle ε).
//
// For a planar surface (constant normal), any P on the plane reflects
// the viewer toward the same direction r₀, so the contour
//     f(P) = r₀ · u(P)  −  cos(ε)
// is the locus of points whose vector to the light line is at angle ε
// from r₀ — a straight line on the plane (in the limit ε → 0 it is the
// straight line whose direction is the projection of r₀ onto the plane).
//
// For a sphere (varying normal), r varies smoothly with P, and the
// f = 0 locus is a smooth closed curve — exactly the circles the e2e
// expects.

export function reflectionLineField(point, normal, viewDir, lightOrigin, lightDir, eps) {
  // viewDir, normal, lightDir: unit vectors.
  // eps: angular tolerance (radians).
  const r = v3Normalise(reflectAbout(viewDir, normal));
  // Direction from point to closest point on the light line.
  const cp = closestPointOnLine(point, lightOrigin, lightDir);
  const toLine = v3Sub(cp.closest, point);
  const u = v3Normalise(toLine);
  // Iso-contour scalar. Vertices where this is > 0 are inside the cone.
  // For a "line" (zero thickness) reflection contour we need ε → 0; we
  // make the line band finite (default ε ≈ 1.5°) so the contour has
  // numerical width but is still narrow enough to read as a curve.
  return v3Dot(r, u) - Math.cos(eps);
}

// ─────────────────────────────────────────────────────────────────────
// Iso-contour extraction on a triangle (the 1D "marching cubes" analogue).
//
// Given the three vertices of a triangle with their f-values, find the
// 0..1 line segments where f = 0 crosses the triangle. Pure interpolation
// on each edge.
//
// Cases (analogous to marching squares on a 2-simplex):
//   - all three same sign → no crossing.
//   - one vertex has different sign → two edges cross, one segment.
//   - all three vertices have f = 0 → degenerate, skip (would render as
//     a triangle, not a line).

function edgeZeroCrossing(pa, fa, pb, fb) {
  const denom = fa - fb;
  if (Math.abs(denom) < 1e-20) return v3Lerp(pa, pb, 0.5);
  const t = fa / denom;
  // Clamp to (0, 1) to keep numerical noise from drifting points off the
  // triangle edge.
  const clamped = t < 0 ? 0 : (t > 1 ? 1 : t);
  return v3Lerp(pa, pb, clamped);
}

export function triangleIsoContour(p0, p1, p2, f0, f1, f2) {
  const s0 = f0 > 0 ? 1 : (f0 < 0 ? -1 : 0);
  const s1 = f1 > 0 ? 1 : (f1 < 0 ? -1 : 0);
  const s2 = f2 > 0 ? 1 : (f2 < 0 ? -1 : 0);
  // No crossing.
  if (s0 === s1 && s1 === s2) return null;
  // Degenerate (all zero) — treat as no crossing to avoid spurious tris.
  if (s0 === 0 && s1 === 0 && s2 === 0) return null;
  // Find the two edges that cross.
  // Three edges: (0,1), (1,2), (2,0). An edge crosses if its endpoints
  // have opposite sign. Exactly two of the three cross unless the
  // triangle has a zero-vertex; in that case we still emit one segment
  // pinned at the zero vertex.
  const segments = [];
  const edges = [
    { a: p0, b: p1, fa: f0, fb: f1, sa: s0, sb: s1 },
    { a: p1, b: p2, fa: f1, fb: f2, sa: s1, sb: s2 },
    { a: p2, b: p0, fa: f2, fb: f0, sa: s2, sb: s0 },
  ];
  const crossings = [];
  for (const e of edges) {
    if (e.sa === 0 && e.sb !== 0) {
      crossings.push({ x: e.a.x, y: e.a.y, z: e.a.z });
      continue;
    }
    if (e.sb === 0 && e.sa !== 0) {
      crossings.push({ x: e.b.x, y: e.b.y, z: e.b.z });
      continue;
    }
    if (e.sa === 0 && e.sb === 0) {
      // Whole edge is zero — emit endpoints once.
      crossings.push({ x: e.a.x, y: e.a.y, z: e.a.z });
      crossings.push({ x: e.b.x, y: e.b.y, z: e.b.z });
      continue;
    }
    if (e.sa !== e.sb) {
      crossings.push(edgeZeroCrossing(e.a, e.fa, e.b, e.fb));
    }
  }
  if (crossings.length < 2) return null;
  // The first two distinct crossings form the segment. For exotic
  // 4-crossing cases (a vertex landing exactly on the iso-line) we still
  // only emit a single segment per triangle.
  segments.push(crossings[0], crossings[1]);
  return segments;
}

// ─────────────────────────────────────────────────────────────────────
// Top-level extractor.
//
// Inputs:
//   - geometry: { positions: Float32Array|Array, normals: Float32Array|Array,
//                 indices?: Uint32Array|Array }
//                If `indices` is missing, positions/normals are assumed
//                to be already in triangle-strip layout (3 vertices per
//                triangle, contiguous).
//   - lightOrigin: { x, y, z } — the O of L(t) = O + t·D.
//   - lightDirection: { x, y, z } — D (will be normalised).
//   - viewDirection: { x, y, z } — view-ray direction (will be normalised).
//   - eps: angular tolerance in radians (default 1.5°).
//
// Output:
//   Float32Array of line segments — pairs of {x,y,z} stored as
//   [ax, ay, az, bx, by, bz, ax, ay, az, bx, by, bz, ...]. Six floats
//   per segment, ready to upload to THREE.LineSegments via
//   BufferGeometry.setAttribute('position', new BufferAttribute(arr, 3)).

export function extractReflectionLines({
  geometry,
  lightOrigin = { x: 0, y: 0, z: 100 },
  lightDirection = { x: 1, y: 0, z: 0 },
  viewDirection = { x: 0, y: 0, z: -1 },
  eps = (1.5 * Math.PI) / 180,
} = {}) {
  if (!geometry || !geometry.positions || !geometry.normals) {
    return new Float32Array(0);
  }
  const positions = geometry.positions;
  const normals = geometry.normals;
  const indices = geometry.indices;
  const nVerts = (positions.length / 3) | 0;
  if (normals.length !== positions.length) {
    return new Float32Array(0);
  }
  const triCount = indices ? ((indices.length / 3) | 0) : ((nVerts / 3) | 0);
  if (triCount <= 0) return new Float32Array(0);

  // Normalise the input directions once.
  const D = v3Normalise(lightDirection);
  const V = v3Normalise(viewDirection);
  if (v3Length(D) < 0.5) return new Float32Array(0);
  if (v3Length(V) < 0.5) return new Float32Array(0);
  const O = { x: +lightOrigin.x, y: +lightOrigin.y, z: +lightOrigin.z };

  // Pre-compute per-vertex f-value. For an indexed mesh many vertices
  // are shared across triangles so caching f-values cuts ~3x.
  const fVals = new Float32Array(nVerts);
  const verts = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const p = v3FromArray(positions, i * 3);
    const n = v3Normalise(v3FromArray(normals, i * 3));
    verts[i] = p;
    fVals[i] = reflectionLineField(p, n, V, O, D, eps);
  }

  // Iso-contour extraction per triangle. Worst case 2 vertices per tri.
  const out = new Float32Array(triCount * 6);
  let outOffset = 0;
  for (let t = 0; t < triCount; t++) {
    let ia, ib, ic;
    if (indices) {
      ia = indices[t * 3 + 0];
      ib = indices[t * 3 + 1];
      ic = indices[t * 3 + 2];
    } else {
      ia = t * 3 + 0;
      ib = t * 3 + 1;
      ic = t * 3 + 2;
    }
    const seg = triangleIsoContour(
      verts[ia], verts[ib], verts[ic],
      fVals[ia], fVals[ib], fVals[ic],
    );
    if (!seg) continue;
    out[outOffset++] = seg[0].x;
    out[outOffset++] = seg[0].y;
    out[outOffset++] = seg[0].z;
    out[outOffset++] = seg[1].x;
    out[outOffset++] = seg[1].y;
    out[outOffset++] = seg[1].z;
  }
  // Trim to actual length so callers see only the populated segments.
  return out.slice(0, outOffset);
}

// ─────────────────────────────────────────────────────────────────────
// Parallel-line family helper.
//
// The slice brief calls for "number of parallel lines (1-20)". We build
// N parallel infinite lines by offsetting the origin along a vector
// perpendicular to D in equal steps over `spacing`. The set of N origins
// shares the same direction D; each is fed to `extractReflectionLines`
// independently.
//
// Picking the perpendicular: take any axis not parallel to D, cross-
// product with D, normalise. This stays numerically stable across
// arbitrary D inputs.

export function buildParallelLightOrigins(originBase, dir, count, spacing) {
  const D = v3Normalise(dir);
  if (v3Length(D) < 0.5) return [{ ...originBase }];
  const n = Math.max(1, Math.min(20, count | 0));
  if (n === 1) return [{ ...originBase }];
  // Perpendicular to D: cross with the world-up that is least parallel
  // to D so the cross product has non-trivial length.
  const ax = Math.abs(D.x), ay = Math.abs(D.y), az = Math.abs(D.z);
  const helper = ax < ay && ax < az
    ? { x: 1, y: 0, z: 0 }
    : (ay < az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 });
  const perp = v3Normalise(v3Cross(D, helper));
  const origins = new Array(n);
  for (let k = 0; k < n; k++) {
    const offset = (k - (n - 1) * 0.5) * spacing;
    origins[k] = {
      x: originBase.x + perp.x * offset,
      y: originBase.y + perp.y * offset,
      z: originBase.z + perp.z * offset,
    };
  }
  return origins;
}

// ─────────────────────────────────────────────────────────────────────
// Family colour palette — distinct hues for up to 20 parallel lines.
// HSL sweep over the colour wheel, 70% saturation, 55% lightness.
// Returned as { r, g, b } floats in [0, 1] for direct THREE.Color use.

export function familyColour(index, count) {
  const n = Math.max(1, count | 0);
  const t = (index % n) / n;
  // HSL → RGB at S=0.7, L=0.55.
  const h = t * 360;
  const s = 0.7;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60)        { rp = c; gp = x; bp = 0; }
  else if (h < 120)  { rp = x; gp = c; bp = 0; }
  else if (h < 180)  { rp = 0; gp = c; bp = x; }
  else if (h < 240)  { rp = 0; gp = x; bp = c; }
  else if (h < 300)  { rp = x; gp = 0; bp = c; }
  else               { rp = c; gp = 0; bp = x; }
  return { r: rp + m, g: gp + m, b: bp + m };
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: extract reflection lines for a *family* of parallel
// light lines, returning one Float32Array per family member.

export function extractReflectionLineFamily({
  geometry,
  lightOrigin,
  lightDirection,
  viewDirection,
  eps,
  count,
  spacing,
}) {
  const origins = buildParallelLightOrigins(
    lightOrigin,
    lightDirection,
    count,
    spacing,
  );
  const families = new Array(origins.length);
  for (let k = 0; k < origins.length; k++) {
    families[k] = {
      origin: origins[k],
      segments: extractReflectionLines({
        geometry,
        lightOrigin: origins[k],
        lightDirection,
        viewDirection,
        eps,
      }),
      colour: familyColour(k, origins.length),
    };
  }
  return families;
}

// ─────────────────────────────────────────────────────────────────────
// Built-in synthetic geometries used by the e2e + the panel "Seed" path.
// Both are pure-math constructors — no THREE dep.

/** Tessellated sphere centred at the origin (icosahedron-base subdivided
 *  by `divisions`). For divisions = 3 we get a 1280-triangle mesh — fine
 *  enough that the reflection-line contour reads as a smooth curve.
 *
 *  Returns { positions, normals, indices } — same shape forge.tessellate
 *  returns from the kernel. */
export function makeSphereMesh(radius = 10, divisions = 3) {
  // Icosahedron base.
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
  ];
  // Normalise base verts onto the unit sphere.
  verts = verts.map((v) => {
    const L = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / L, v[1] / L, v[2] / L];
  });
  let faces = [
    [ 0, 11,  5], [ 0,  5,  1], [ 0,  1,  7], [ 0,  7, 10], [ 0, 10, 11],
    [ 1,  5,  9], [ 5, 11,  4], [11, 10,  2], [10,  7,  6], [ 7,  1,  8],
    [ 3,  9,  4], [ 3,  4,  2], [ 3,  2,  6], [ 3,  6,  8], [ 3,  8,  9],
    [ 4,  9,  5], [ 2,  4, 11], [ 6,  2, 10], [ 8,  6,  7], [ 9,  8,  1],
  ];
  // Subdivide. Each tri → 4 tris by midpoint-splitting all three edges.
  const midpointCache = new Map();
  const getMidpoint = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (midpointCache.has(key)) return midpointCache.get(key);
    const va = verts[a], vb = verts[b];
    const m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
    const L = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    const norm = [m[0] / L, m[1] / L, m[2] / L];
    const idx = verts.length;
    verts.push(norm);
    midpointCache.set(key, idx);
    return idx;
  };
  for (let d = 0; d < divisions; d++) {
    const nextFaces = [];
    for (const [a, b, c] of faces) {
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);
      nextFaces.push([a, ab, ca]);
      nextFaces.push([b, bc, ab]);
      nextFaces.push([c, ca, bc]);
      nextFaces.push([ab, bc, ca]);
    }
    faces = nextFaces;
  }
  // Scale + emit normals (same as the unit-vert for a sphere).
  const positions = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3 + 0] = verts[i][0] * radius;
    positions[i * 3 + 1] = verts[i][1] * radius;
    positions[i * 3 + 2] = verts[i][2] * radius;
    normals[i * 3 + 0] = verts[i][0];
    normals[i * 3 + 1] = verts[i][1];
    normals[i * 3 + 2] = verts[i][2];
  }
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3 + 0] = faces[i][0];
    indices[i * 3 + 1] = faces[i][1];
    indices[i * 3 + 2] = faces[i][2];
  }
  return { positions, normals, indices };
}

/** Flat plane in the XY plane centred on the origin. `divisions` is the
 *  number of grid quads per side (each quad = 2 triangles). normals all
 *  point along +Z. */
export function makePlaneMesh(width = 60, height = 40, divisionsX = 8, divisionsY = 8) {
  const nx = divisionsX + 1;
  const ny = divisionsY + 1;
  const positions = new Float32Array(nx * ny * 3);
  const normals = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i / divisionsX - 0.5) * width;
      const y = (j / divisionsY - 0.5) * height;
      const idx = (j * nx + i) * 3;
      positions[idx + 0] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = 0;
      normals[idx + 0] = 0;
      normals[idx + 1] = 0;
      normals[idx + 2] = 1;
    }
  }
  const triCount = divisionsX * divisionsY * 2;
  const indices = new Uint32Array(triCount * 3);
  let off = 0;
  for (let j = 0; j < divisionsY; j++) {
    for (let i = 0; i < divisionsX; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Tri 1: a, b, d
      indices[off++] = a;
      indices[off++] = b;
      indices[off++] = d;
      // Tri 2: a, d, c
      indices[off++] = a;
      indices[off++] = d;
      indices[off++] = c;
    }
  }
  return { positions, normals, indices };
}

// ─────────────────────────────────────────────────────────────────────
// Topology classifier — given a Float32Array of segments, group them
// into polylines + detect closed loops.
//
// Used by the e2e to assert sphere → closed loops, plane → straight.

export function classifySegments(segments, mergeTolerance = 1e-3) {
  if (!segments || segments.length === 0) {
    return { polylineCount: 0, closedLoopCount: 0, straightCount: 0,
             segmentCount: 0, totalLength: 0 };
  }
  const segCount = (segments.length / 6) | 0;
  // Walk segments, build adjacency via spatial bucketing on first vertex.
  const buckets = new Map();
  const bucketKey = (x, y, z) => {
    const k = Math.round(x / mergeTolerance) + '_' +
              Math.round(y / mergeTolerance) + '_' +
              Math.round(z / mergeTolerance);
    return k;
  };
  for (let i = 0; i < segCount; i++) {
    const off = i * 6;
    const ax = segments[off + 0], ay = segments[off + 1], az = segments[off + 2];
    const bx = segments[off + 3], by = segments[off + 4], bz = segments[off + 5];
    const ka = bucketKey(ax, ay, az);
    const kb = bucketKey(bx, by, bz);
    if (!buckets.has(ka)) buckets.set(ka, []);
    if (!buckets.has(kb)) buckets.set(kb, []);
    buckets.get(ka).push({ seg: i, side: 0 });
    buckets.get(kb).push({ seg: i, side: 1 });
  }
  // For each segment, count how many other segments share its endpoints
  // (closed loop ↔ every endpoint has degree ≥ 2). For "straightness"
  // measure the chord-length to segment-sum ratio of each polyline.
  const visited = new Uint8Array(segCount);
  let polylineCount = 0;
  let closedLoopCount = 0;
  let straightCount = 0;
  let totalLength = 0;
  const isOpen = (key) => (buckets.get(key) || []).length < 2;
  for (let s = 0; s < segCount; s++) {
    if (visited[s]) continue;
    visited[s] = 1;
    polylineCount += 1;
    let chainLength = 0;
    const off = s * 6;
    let startX = segments[off + 0], startY = segments[off + 1], startZ = segments[off + 2];
    let endX   = segments[off + 3], endY   = segments[off + 4], endZ   = segments[off + 5];
    chainLength += Math.hypot(endX - startX, endY - startY, endZ - startZ);
    // Walk forward.
    let cur = s, side = 1;
    for (let step = 0; step < segCount; step++) {
      const kx = side === 1
        ? segments[cur * 6 + 3]
        : segments[cur * 6 + 0];
      const ky = side === 1
        ? segments[cur * 6 + 4]
        : segments[cur * 6 + 1];
      const kz = side === 1
        ? segments[cur * 6 + 5]
        : segments[cur * 6 + 2];
      const k = bucketKey(kx, ky, kz);
      const adj = (buckets.get(k) || []).filter(
        (e) => !visited[e.seg] && e.seg !== cur);
      if (adj.length === 0) break;
      const next = adj[0];
      visited[next.seg] = 1;
      const nxoff = next.seg * 6;
      const nextEndOff = next.side === 0 ? 3 : 0;
      const nxStartX = next.side === 0
        ? segments[nxoff + 0] : segments[nxoff + 3];
      const nxStartY = next.side === 0
        ? segments[nxoff + 1] : segments[nxoff + 4];
      const nxStartZ = next.side === 0
        ? segments[nxoff + 2] : segments[nxoff + 5];
      const nxEndX = segments[nxoff + nextEndOff + 0];
      const nxEndY = segments[nxoff + nextEndOff + 1];
      const nxEndZ = segments[nxoff + nextEndOff + 2];
      chainLength += Math.hypot(
        nxEndX - nxStartX, nxEndY - nxStartY, nxEndZ - nxStartZ);
      endX = nxEndX;
      endY = nxEndY;
      endZ = nxEndZ;
      cur = next.seg;
      side = next.side === 0 ? 1 : 0;
    }
    const chord = Math.hypot(endX - startX, endY - startY, endZ - startZ);
    if (chord < mergeTolerance * 4) {
      // Endpoints meet → closed loop.
      closedLoopCount += 1;
    } else {
      // Straightness ratio — chord / arc-length. 1.0 = perfectly straight.
      const straightness = chainLength > 0 ? chord / chainLength : 0;
      if (straightness > 0.97) straightCount += 1;
    }
    totalLength += chainLength;
  }
  return {
    polylineCount,
    closedLoopCount,
    straightCount,
    segmentCount: segCount,
    totalLength,
  };
}
