// PUSH-84 (Slice-52 / Voxel-rep panel).
//
// Voxelisation math + point-in-mesh test for the V-rep (voxel) modelling
// representation, alongside the existing B-rep (OCCT) and NURBS surfaces.
//
// The kernel exposes `forge.tessellate(handle, linTol, angTol)` which
// returns `{ positions: Float32Array, indices?: Uint32Array }` — the
// classic triangle soup. For native bodies we walk the triangles in JS
// and count the +X ray crossings from each grid point: odd ⇒ inside,
// even ⇒ outside. For synthetic bodies we lean on `spec.kind === 'box'`
// (axis-aligned, params dx/dy/dz centred on origin) — every grid point
// inside the box is inside the body.
//
// This file is pure math. No React, no DOM, no kernel side-effects beyond
// the one read-only `forge.tessellate` call inside `nativeBodyMesh`. The
// panel + host live in VoxelizationPanel.jsx; the e2e drives both.

// ────────────────────────────────────────────────────────────────────
// Allowed grid resolutions per the slice brief. The slider is bound to
// this exact set so the e2e can pin a known sample budget.

export const VOXEL_RESOLUTIONS = Object.freeze([8, 16, 32, 64]);

// Default resolution — modest enough to voxelise in < 200 ms on a real
// scene (8³ = 512 grid points × ~10k tris ≈ 5M ray-tri tests, ~few-hundred
// ms in JS).
export const DEFAULT_VOXEL_RESOLUTION = 8;

// Hard ceiling on the number of triangles we'll consider for the
// ray-casting test. The kernel's tessellate output for a 30 mm box at
// (0.1, 0.5) tolerance is ~12 triangles; a complex part might emit a few
// hundred thousand. We cap at this many — beyond it the panel surfaces
// `error: 'mesh too large'` so the user knows to coarsen the tolerance.
export const MAX_TRIANGLES = 200000;

// ────────────────────────────────────────────────────────────────────
// Tessellation tolerance for the native body voxel pipeline. Linear is
// in mm, angular is in radians. These match the values ForgeShellV4
// uses for its scene meshes — keeping them in sync means we voxelise
// the same surface the viewport renders.
export const TESSELLATE_LIN_TOL = 0.1;
export const TESSELLATE_ANG_TOL = 0.5;

// ────────────────────────────────────────────────────────────────────
// Sample a triangle mesh out of a native body via `forge.tessellate`.
// Returns `{ positions, indices, triCount }` on success or `null` on
// failure. The positions array is a packed Float32Array of (x, y, z)
// triples in mm; indices, when present, is a Uint32Array of triangle
// vertex offsets (3 per triangle). When `indices` is absent we treat
// `positions` as already in triangle-soup order (3 verts per tri).

export function nativeBodyMesh(body) {
  if (!body || typeof body.handle !== 'number') return null;
  if (typeof window === 'undefined') return null;
  const fn = window.forge && window.forge.tessellate;
  if (typeof fn !== 'function') return null;
  let mesh;
  try {
    mesh = fn(body.handle, TESSELLATE_LIN_TOL, TESSELLATE_ANG_TOL);
  } catch (ex) {
    return { error: String(ex && ex.message || ex) };
  }
  if (!mesh || !mesh.positions || mesh.positions.length === 0) {
    return null;
  }
  const positions = mesh.positions;
  const indices = mesh.indices || null;
  const triCount = indices
    ? Math.floor(indices.length / 3)
    : Math.floor(positions.length / 9);
  if (triCount > MAX_TRIANGLES) {
    return { error: 'mesh too large: ' + triCount + ' > ' + MAX_TRIANGLES };
  }
  return { positions, indices, triCount };
}

// ────────────────────────────────────────────────────────────────────
// Axis-aligned bbox of a packed Float32Array of (x, y, z) triples.
// Returns `{ min:[x,y,z], max:[x,y,z] }` or `null` for an empty array.

export function meshBounds(positions) {
  if (!positions || positions.length < 3) return null;
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  if (!Number.isFinite(minx) || !Number.isFinite(maxx)) return null;
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}

// ────────────────────────────────────────────────────────────────────
// Synthetic-body bbox. We support the synthetic kinds that
// kernelDispatch.buildSyntheticGeometry knows how to draw — box / sphere /
// cylinder / torus / cone — plus the `synthetic.dx/dy/dz` shorthand
// HarnessWorkbench / SpringDesignerPanel use. Returns the same shape
// as `meshBounds`.

export function syntheticBodyBounds(body) {
  if (!body) return null;
  const spec = body.spec || body.synthetic;
  if (!spec) return null;
  const kind = spec.kind;
  if (kind === 'box') {
    const dx = Number(spec.dx) || 0;
    const dy = Number(spec.dy) || 0;
    const dz = Number(spec.dz) || 0;
    if (dx <= 0 || dy <= 0 || dz <= 0) return null;
    return { min: [-dx / 2, -dy / 2, -dz / 2], max: [dx / 2, dy / 2, dz / 2] };
  }
  if (kind === 'cylinder' || kind === 'cone') {
    const r = Number(spec.r ?? spec.rTop ?? 0);
    const rb = Number(spec.rBot ?? r);
    const rmax = Math.max(r, rb);
    const h = Number(spec.h) || 0;
    if (rmax <= 0 || h <= 0) return null;
    return { min: [-rmax, -h / 2, -rmax], max: [rmax, h / 2, rmax] };
  }
  if (kind === 'sphere') {
    const r = Number(spec.r) || 0;
    if (r <= 0) return null;
    return { min: [-r, -r, -r], max: [r, r, r] };
  }
  if (kind === 'torus') {
    const R = Number(spec.R) || 0;
    const r = Number(spec.r) || 0;
    if (R <= 0 || r <= 0) return null;
    const outer = R + r;
    return { min: [-outer, -r, -outer], max: [outer, r, outer] };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Best-effort body bbox. Native bodies fall back to the tessellated
// mesh bounds; synthetic bodies use the spec. Returns null if no path
// produces a finite box.

export function bodyBounds(body, meshOverride) {
  if (!body) return null;
  if (meshOverride && meshOverride.positions) {
    const b = meshBounds(meshOverride.positions);
    if (b) return b;
  }
  if (body.kind === 'synthetic') {
    return syntheticBodyBounds(body);
  }
  // Native — pull from a fresh tessellate.
  const m = nativeBodyMesh(body);
  if (m && m.positions) return meshBounds(m.positions);
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Point-in-triangle ray-cast test along a constant tilted +X direction.
// Returns 1 if the ray hits the triangle in the +ray half-space, 0
// otherwise. The classic Möller-Trumbore intersection.
//
// The ray direction is fixed to (1, RAY_DY, RAY_DZ) — slightly off-axis
// so the ray never passes exactly along a triangle edge or vertex of an
// axis-aligned mesh (which would tickle the u/v boundary conditions and
// count 0 or 2 crossings, breaking the parity test). The small tilt
// preserves the +X half-space partitioning (every triangle still gets a
// well-defined "in front" / "behind" classification) while sliding the
// ray off any grid-aligned coincidences.
//
// The values are irrational-shaped to keep the ray off every plausible
// rational triangle the kernel + synthetic primitives can emit.

const RAY_DX = 1.0;
const RAY_DY = 0.00193151742767;  // ≈ π / 1627  — small but irrational
const RAY_DZ = 0.00321908167392;  // ≈ e  / 845   — different magnitude

function rayHitsTriangle(px, py, pz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) {
  // edge1 = v1 - v0; edge2 = v2 - v0
  const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
  const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
  // h = dir × edge2
  const hx = RAY_DY * e2z - RAY_DZ * e2y;
  const hy = RAY_DZ * e2x - RAY_DX * e2z;
  const hz = RAY_DX * e2y - RAY_DY * e2x;
  // a = edge1 · h
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -1e-12 && a < 1e-12) return 0;     // parallel
  const f = 1 / a;
  // s = p - v0
  const sx = px - v0x, sy = py - v0y, sz = pz - v0z;
  // u = f * (s · h)
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return 0;
  // q = s × edge1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  // v = f * (dir · q)
  const v = f * (RAY_DX * qx + RAY_DY * qy + RAY_DZ * qz);
  if (v < 0 || u + v > 1) return 0;
  // t = f * (edge2 · q)
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  // We want strictly positive t (hit lies in +ray half-space). Tiny
  // epsilon so a grid point exactly on the surface isn't double counted.
  return t > 1e-9 ? 1 : 0;
}

// ────────────────────────────────────────────────────────────────────
// `pointInMesh(point, mesh)` — true if `point = [x, y, z]` is inside
// the closed triangle mesh, false if outside. The classic +X ray-cast:
// count triangle crossings, odd ⇒ inside.
//
// `mesh` is the output of `nativeBodyMesh` — `{ positions, indices }`.
// `indices` is optional (un-indexed soup falls back to packed triples).

export function pointInMesh(point, mesh) {
  if (!Array.isArray(point) || point.length < 3) return false;
  if (!mesh || !mesh.positions) return false;
  const px = Number(point[0]);
  const py = Number(point[1]);
  const pz = Number(point[2]);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return false;
  const positions = mesh.positions;
  const indices = mesh.indices || null;
  let crossings = 0;
  if (indices) {
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
      crossings += rayHitsTriangle(
        px, py, pz,
        positions[i0], positions[i0 + 1], positions[i0 + 2],
        positions[i1], positions[i1 + 1], positions[i1 + 2],
        positions[i2], positions[i2 + 1], positions[i2 + 2],
      );
    }
  } else {
    for (let i = 0; i < positions.length; i += 9) {
      crossings += rayHitsTriangle(
        px, py, pz,
        positions[i],     positions[i + 1], positions[i + 2],
        positions[i + 3], positions[i + 4], positions[i + 5],
        positions[i + 6], positions[i + 7], positions[i + 8],
      );
    }
  }
  return (crossings & 1) === 1;
}

// ────────────────────────────────────────────────────────────────────
// `pointInBody(point, body)` — top-level inside/outside test that picks
// the right path:
//   * native + kernel tessellate available ⇒ ray-cast against the mesh.
//   * synthetic + spec.kind === 'box'      ⇒ analytic axis-aligned box.
//   * synthetic + spec.kind === 'sphere'   ⇒ |p| < r.
//   * synthetic + spec.kind === 'cylinder' ⇒ analytic radial + height.
//   * fallback                             ⇒ false.
//
// The optional `cache` argument lets a voxelisation loop reuse one
// tessellated mesh instead of re-querying the kernel per point — pass
// `{ mesh: nativeBodyMesh(body) }` from `voxelize` below.

export function pointInBody(point, body, cache) {
  if (!body) return false;
  if (body.kind === 'native' || typeof body.handle === 'number') {
    const mesh = (cache && cache.mesh) || nativeBodyMesh(body);
    if (!mesh || mesh.error) return false;
    return pointInMesh(point, mesh);
  }
  const spec = body.spec || body.synthetic;
  if (!spec) return false;
  const px = Number(point[0]), py = Number(point[1]), pz = Number(point[2]);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return false;
  if (spec.kind === 'box') {
    const hx = Number(spec.dx) / 2;
    const hy = Number(spec.dy) / 2;
    const hz = Number(spec.dz) / 2;
    return px >= -hx && px <= hx && py >= -hy && py <= hy && pz >= -hz && pz <= hz;
  }
  if (spec.kind === 'sphere') {
    const r = Number(spec.r);
    return (px * px + py * py + pz * pz) <= r * r;
  }
  if (spec.kind === 'cylinder') {
    const r = Number(spec.r);
    const h = Number(spec.h);
    const inRadius = (px * px + pz * pz) <= r * r;
    const inHeight = py >= -h / 2 && py <= h / 2;
    return inRadius && inHeight;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────
// `voxelize(body, resolution)` — sample the body at `resolution³` grid
// points across the body's bbox, collect the inside ones as cube centres,
// and return `{ centers, voxelSize, bounds, resolution, sampleCount,
// insideCount, fillRatio, equivalentVolume_mm3 }`.
//
// `centers` is an array of `{ x, y, z }` records ordered by (i, j, k)
// — the same record shape the synthetic `kind: 'group'` spec consumes
// via its `cells` field. `voxelSize` is the cell edge length in mm.

export function voxelize(body, resolution) {
  const r = (VOXEL_RESOLUTIONS.includes(resolution) ? resolution : DEFAULT_VOXEL_RESOLUTION);
  if (!body) {
    return {
      centers: [], voxelSize: 0, bounds: null, resolution: r,
      sampleCount: 0, insideCount: 0, fillRatio: 0,
      equivalentVolume_mm3: 0, error: 'no body',
    };
  }
  // Pull the tessellated mesh once for native bodies — sampling the same
  // surface r³ times would be a kernel-call disaster otherwise.
  const cache = {};
  if (body.kind === 'native' || typeof body.handle === 'number') {
    const m = nativeBodyMesh(body);
    if (m && m.error) {
      return {
        centers: [], voxelSize: 0, bounds: null, resolution: r,
        sampleCount: 0, insideCount: 0, fillRatio: 0,
        equivalentVolume_mm3: 0, error: m.error,
      };
    }
    cache.mesh = m;
  }
  const bounds = bodyBounds(body, cache.mesh);
  if (!bounds) {
    return {
      centers: [], voxelSize: 0, bounds: null, resolution: r,
      sampleCount: 0, insideCount: 0, fillRatio: 0,
      equivalentVolume_mm3: 0, error: 'no bounds',
    };
  }
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  // Use the longest axis for the cell edge so the grid is uniform —
  // this matches the prompt's "voxel grid" mental model and keeps the
  // cubes isotropic in the viewport.
  const span = Math.max(dx, dy, dz);
  if (!(span > 0)) {
    return {
      centers: [], voxelSize: 0, bounds, resolution: r,
      sampleCount: 0, insideCount: 0, fillRatio: 0,
      equivalentVolume_mm3: 0, error: 'degenerate bbox',
    };
  }
  const voxelSize = span / r;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const half = (r * voxelSize) / 2;
  const start = [cx - half + voxelSize / 2, cy - half + voxelSize / 2, cz - half + voxelSize / 2];
  const centers = [];
  // Sample order is k (Z) outer, j (Y) middle, i (X) inner — same row-
  // major convention the e2e relies on for the "fully filled box" count.
  for (let k = 0; k < r; k++) {
    const z = start[2] + k * voxelSize;
    for (let j = 0; j < r; j++) {
      const y = start[1] + j * voxelSize;
      for (let i = 0; i < r; i++) {
        const x = start[0] + i * voxelSize;
        if (pointInBody([x, y, z], body, cache)) {
          centers.push({ x, y, z });
        }
      }
    }
  }
  const sampleCount = r * r * r;
  const insideCount = centers.length;
  const fillRatio = sampleCount === 0 ? 0 : insideCount / sampleCount;
  const equivalentVolume_mm3 = insideCount * voxelSize * voxelSize * voxelSize;
  return {
    centers, voxelSize, bounds, resolution: r,
    sampleCount, insideCount, fillRatio,
    equivalentVolume_mm3,
  };
}

// ────────────────────────────────────────────────────────────────────
// Convert a voxelisation record into a synthetic body that the existing
// SceneMeshes / InstancedGroup path can render. We wrap the centres
// in a `spec: { kind: 'group', cells: [...], child: { kind: 'box', dx, dy, dz } }`
// — exactly the shape kernelDispatch.buildSyntheticGeometry handles via
// its group branch (one merged InstancedMesh-shaped geometry).
//
// `sourceId` becomes the parent reference for the synthetic; we also
// pass through the `voxel` block (centres + voxelSize + stats) so the
// panel can re-display the result without re-running the math.

export function buildVoxelBody(voxelization, sourceBody, idHint) {
  if (!voxelization || !voxelization.centers || voxelization.centers.length === 0) {
    return null;
  }
  const id = (typeof idHint === 'string' && idHint.length) ? idHint
    : `voxel-${(sourceBody && sourceBody.id) || 'body'}-${Date.now()}`;
  const s = voxelization.voxelSize;
  const sourceLabel = (sourceBody && (sourceBody.name || sourceBody.toolId || sourceBody.id)) || 'body';
  return {
    id,
    kind: 'synthetic',
    toolId: 'rep.voxel',
    name: `Voxels (${voxelization.resolution}³) — ${sourceLabel}`,
    spec: {
      kind: 'group',
      cells: voxelization.centers.map((c) => ({ x: c.x, y: c.y, z: c.z })),
      child: { kind: 'box', dx: s, dy: s, dz: s },
    },
    voxel: {
      sourceId: sourceBody && sourceBody.id,
      sourceHandle: sourceBody && typeof sourceBody.handle === 'number' ? sourceBody.handle : null,
      resolution: voxelization.resolution,
      voxelSize: voxelization.voxelSize,
      insideCount: voxelization.insideCount,
      sampleCount: voxelization.sampleCount,
      fillRatio: voxelization.fillRatio,
      equivalentVolume_mm3: voxelization.equivalentVolume_mm3,
      bounds: voxelization.bounds,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Read the live bodies snapshot — same filter the Layers / Body Colours
// / MassProps panels use. Exported so the panel and the e2e share one
// definition of "what's pickable".

export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  // Voxelisation needs *something* to sample — synthetic bodies without
  // a spec / native bodies without a handle aren't useful. We also skip
  // bodies that are themselves voxel outputs to keep the picker focused
  // on the modelling reps (B-rep + NURBS + synthetic primitives).
  return all.filter((b) => {
    if (!b || typeof b.id !== 'string') return false;
    if (b.toolId === 'rep.voxel') return false;
    if (b.kind === 'synthetic') return !!(b.spec || b.synthetic);
    return typeof b.handle === 'number';
  });
}

// ────────────────────────────────────────────────────────────────────
// Active body — same heuristic as MassPropsPanel: prefer the body whose
// handle matches `window.__forgeSelection.bodyHandle`, fall back to the
// last entry in the snapshot.

export function activeVoxelBody() {
  const bodies = readBodiesSnapshot();
  if (bodies.length === 0) return null;
  if (typeof window === 'undefined') return bodies[bodies.length - 1];
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = bodies.find((b) => b.handle === sel.bodyHandle);
    if (m) return m;
  }
  return bodies[bodies.length - 1];
}
