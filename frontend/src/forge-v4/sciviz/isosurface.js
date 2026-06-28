// sciviz/isosurface.js — result-field Isosurface / Contour-in-volume
// (ParaView "Contour").
// ============================================================================
// Task #65, Increment 6.
//
// The kernel's MarchingCubes.js (foundation/) extracts an iso-surface from an
// ANALYTIC density (a SIMP field). The genuinely-new work here is contouring a
// SAMPLED RESULT array — a CFD/FE solution field — at one OR many isovalues,
// and colouring the surface by a SECOND array through a sciviz TransferFunction
// (ParaView's "Contour" + "Color by …").
//
// Two cell zoos:
//   • structured CFD grid — REUSES MarchingCubes.extractIsoSurface (the same
//     256-case EDGE/TRI tables) on the cell-centred field laid out on its dual
//     vertex lattice (vertex (i,j,k) = cell centre (i+½)d, value field[idx]).
//     The colour array is sampled per output vertex with cfdVisualisation
//     sampleScalar (trilinear).
//   • hex8 / tet4 FE mesh — marching-TETRAHEDRA (hex8 → 6 tets) contouring the
//     nodal result field; the colour array is interpolated along each crossing
//     edge. Triangles are oriented outward (toward decreasing field) so the
//     enclosed volume integral is correct.
//
// Multi-isovalue is just a loop → one "shell" per isovalue; nested isovalues of
// a monotone field give nested, non-intersecting shells.
//
// THREE is injected only for the render group; contouring + the gate math run
// head-less. No new deps.
// ============================================================================

import { extractIsoSurface } from '../../foundation/MarchingCubes.js';
import { sampleScalar } from '../cfdVisualisation.js';

// hex8 → 6 tets (same body-diagonal split as clip.js / threshold.js).
const HEX_TETS = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];

// ───────────────────────────────────────────────────────────────────────────
//  Geometry helpers.
// ───────────────────────────────────────────────────────────────────────────
function triNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Enclosed volume of a closed, consistently-wound triangle soup (÷6 sum of
 *  origin tetrahedra). Sign-agnostic (returns the magnitude). */
export function enclosedVolume(positions, indices) {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

/** Mean / min / max distance of every surface vertex from a centre. */
export function radialStats(positions, center) {
  const n = positions.length / 3;
  let sum = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(
      positions[3 * i] - center[0],
      positions[3 * i + 1] - center[1],
      positions[3 * i + 2] - center[2],
    );
    sum += r; if (r < mn) mn = r; if (r > mx) mx = r;
  }
  return { mean: n ? sum / n : 0, min: mn, max: mx, count: n };
}

// ───────────────────────────────────────────────────────────────────────────
//  Marching tetrahedra — contour ONE tet (inside = F ≥ iso).
//  Pushes triangles (each = 3 {p, c} verts) into `out`, oriented OUTWARD
//  (normal toward the lower-field / outside vertices).
// ───────────────────────────────────────────────────────────────────────────
function marchTet(P, F, C, iso, out) {
  const ins = [], outs = [];
  for (let i = 0; i < 4; i++) (F[i] >= iso ? ins : outs).push(i);
  const ni = ins.length;
  if (ni === 0 || ni === 4) return;
  const cross = (a, b) => {
    const t = (iso - F[a]) / (F[b] - F[a]);
    return {
      p: [
        P[a][0] + (P[b][0] - P[a][0]) * t,
        P[a][1] + (P[b][1] - P[a][1]) * t,
        P[a][2] + (P[b][2] - P[a][2]) * t,
      ],
      c: C[a] + (C[b] - C[a]) * t,
    };
  };
  // outside (low-field) centroid → outward orientation reference
  let ox = 0, oy = 0, oz = 0;
  for (const o of outs) { ox += P[o][0]; oy += P[o][1]; oz += P[o][2]; }
  ox /= outs.length; oy /= outs.length; oz /= outs.length;
  const emit = (A, B, D) => {
    const n = triNormal(A.p, B.p, D.p);
    const cxx = (A.p[0] + B.p[0] + D.p[0]) / 3;
    const cyy = (A.p[1] + B.p[1] + D.p[1]) / 3;
    const czz = (A.p[2] + B.p[2] + D.p[2]) / 3;
    const dot = n[0] * (ox - cxx) + n[1] * (oy - cyy) + n[2] * (oz - czz);
    if (dot < 0) out.push(A, D, B); else out.push(A, B, D);     // flip to outward
  };
  if (ni === 1) {
    const a = ins[0];
    emit(cross(a, outs[0]), cross(a, outs[1]), cross(a, outs[2]));
  } else if (ni === 3) {
    const d = outs[0];
    emit(cross(ins[0], d), cross(ins[1], d), cross(ins[2], d));
  } else { // ni === 2 → quad → two triangles
    const a = ins[0], b = ins[1], c = outs[0], d = outs[1];
    const eac = cross(a, c), ead = cross(a, d), ebd = cross(b, d), ebc = cross(b, c);
    emit(eac, ead, ebd);
    emit(eac, ebd, ebc);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Structured grid (CFD) — REUSE MarchingCubes tables on the dual lattice.
// ───────────────────────────────────────────────────────────────────────────
export function contourStructuredGrid(grid, field, isovalues, opts = {}) {
  const isos = Array.isArray(isovalues) ? isovalues.slice() : [isovalues];
  const colorField = opts.colorField || field;
  const { nx, ny, nz, dx, dy, dz } = grid;
  const o = grid.origin || [0, 0, 0];
  const origin = [o[0] + 0.5 * dx, o[1] + 0.5 * dy, o[2] + 0.5 * dz]; // cell centres
  const sgrid = { nx, ny, nz, dx, dy, dz, sliceXY: nx * ny, N: nx * ny * nz, origin: o };
  const shells = isos.map((iso) => {
    const m = extractIsoSurface({
      values: field, nx, ny, nz, origin, cellSize: [dx, dy, dz], threshold: iso,
    });
    const positions = m.vertProperties;          // Float32Array
    const indices = m.triVerts;                   // Uint32Array
    const nV = positions.length / 3;
    const colorVals = new Float64Array(nV);
    // sampleScalar indexes a 0-origin lattice (cell centre i at (i+½)d), so
    // map world positions → grid-local coords by subtracting the grid origin.
    for (let i = 0; i < nV; i++) {
      colorVals[i] = sampleScalar(
        sgrid, colorField,
        positions[3 * i] - o[0], positions[3 * i + 1] - o[1], positions[3 * i + 2] - o[2],
      );
    }
    return shellRecord(iso, positions, indices, colorVals);
  });
  return packShells(shells, isos);
}

// ───────────────────────────────────────────────────────────────────────────
//  hex8 / tet4 FE mesh — marching tetrahedra.
// ───────────────────────────────────────────────────────────────────────────
export function contourMesh(mesh, nodalField, isovalues, opts = {}) {
  const isos = Array.isArray(isovalues) ? isovalues.slice() : [isovalues];
  const colorField = opts.colorField || nodalField;
  const ENC = mesh.elemNodeCount || 8;
  const conn = mesh.tets, nodes = mesh.nodes;

  const shells = isos.map((iso) => {
    const tris = [];                              // flat list of {p,c}, ×3 = a triangle
    if (ENC === 4) {
      for (let e = 0; e < mesh.elemCount; e++) {
        const P = [], F = [], C = [];
        for (let c = 0; c < 4; c++) {
          const nid = conn[e * 4 + c];
          P.push([nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]]);
          F.push(nodalField[nid]); C.push(colorField[nid]);
        }
        marchTet(P, F, C, iso, tris);
      }
    } else {
      for (let e = 0; e < mesh.elemCount; e++) {
        const P8 = [], F8 = [], C8 = [];
        for (let c = 0; c < 8; c++) {
          const nid = conn[e * 8 + c];
          P8.push([nodes[3 * nid], nodes[3 * nid + 1], nodes[3 * nid + 2]]);
          F8.push(nodalField[nid]); C8.push(colorField[nid]);
        }
        for (const [a, b, c, d] of HEX_TETS) {
          marchTet([P8[a], P8[b], P8[c], P8[d]], [F8[a], F8[b], F8[c], F8[d]],
            [C8[a], C8[b], C8[c], C8[d]], iso, tris);
        }
      }
    }
    const nV = tris.length;
    const positions = new Float32Array(nV * 3);
    const colorVals = new Float64Array(nV);
    const indices = new Uint32Array(nV);
    for (let i = 0; i < nV; i++) {
      positions[3 * i] = tris[i].p[0];
      positions[3 * i + 1] = tris[i].p[1];
      positions[3 * i + 2] = tris[i].p[2];
      colorVals[i] = tris[i].c;
      indices[i] = i;
    }
    return shellRecord(iso, positions, indices, colorVals);
  });
  return packShells(shells, isos);
}

// Dispatch on input kind (grid has nx/dx; mesh has nodes/tets).
export function contour(input, field, isovalues, opts = {}) {
  if (input && input.nodes && input.tets && input.elemCount != null) {
    return contourMesh(input, field, isovalues, opts);
  }
  return contourStructuredGrid(input, field, isovalues, opts);
}

// ───────────────────────────────────────────────────────────────────────────
//  Shell bookkeeping.
// ───────────────────────────────────────────────────────────────────────────
function shellRecord(iso, positions, indices, colorVals) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < colorVals.length; i++) {
    const v = colorVals[i]; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  if (!Number.isFinite(mn)) { mn = 0; mx = 0; }
  return {
    iso, positions, indices, colorVals,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    enclosedVolume: enclosedVolume(positions, indices),
    colorRange: [mn, mx],
  };
}
function packShells(shells, isos) {
  let mn = Infinity, mx = -Infinity;
  for (const s of shells) { if (s.colorRange[0] < mn) mn = s.colorRange[0]; if (s.colorRange[1] > mx) mx = s.colorRange[1]; }
  if (!Number.isFinite(mn)) { mn = 0; mx = 0; }
  return { shells, isovalues: isos, scalarRange: [mn, mx] };
}

// ───────────────────────────────────────────────────────────────────────────
//  Render group (optional, needs THREE) — one coloured mesh per shell.
// ───────────────────────────────────────────────────────────────────────────
export function buildIsosurfaceMesh(THREE, result, tf, opts = {}) {
  if (!THREE) throw new Error('isosurface: THREE namespace required to build a mesh');
  const group = new THREE.Group();
  group.name = 'sciviz-isosurface';
  group.userData = { sciviz: 'isosurface', shellCount: result.shells.length, isovalues: result.isovalues };
  const opacities = opts.opacities || null;
  result.shells.forEach((shell, si) => {
    const nV = shell.vertexCount;
    const colors = new Float32Array(nV * 3);
    for (let i = 0; i < nV; i++) {
      const rgb = tf ? tf.sampleColor(shell.colorVals[i]) : [0.8, 0.8, 0.85];
      colors[3 * i] = rgb[0]; colors[3 * i + 1] = rgb[1]; colors[3 * i + 2] = rgb[2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(shell.indices, 1));
    geom.computeVertexNormals();
    const op = opacities ? opacities[si] : (opts.opacity != null ? opts.opacity : 1);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.05, roughness: 0.6, side: THREE.DoubleSide,
      transparent: op < 1, opacity: op,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `sciviz-isosurface-${si}`;
    mesh.userData = { sciviz: 'iso-shell', iso: shell.iso, vertexCount: nV };
    group.add(mesh);
  });
  return group;
}

export default {
  contour, contourStructuredGrid, contourMesh,
  enclosedVolume, radialStats, buildIsosurfaceMesh,
};
