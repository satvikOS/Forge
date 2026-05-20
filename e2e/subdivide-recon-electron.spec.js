/**
 * subdivide-recon-electron.spec.js
 *
 * Sub-project C — Subdivision Surface baseline reconnaissance.
 *
 * Measures baseline pinching and shading-error metrics for the existing
 * Loop subdivision implementation (foundation/LoopSubdivision.js) on a
 * coarse cube tessellation obtained via the OCCT B-rep kernel.
 *
 * Metrics recorded:
 *   cornerPinch   — max distance from each nominal cube corner to the
 *                   nearest subdivided vertex (mm).  Measures how far
 *                   corners have been pulled inward.
 *   edgeDrift     — max perpendicular distance from a subdivided vertex
 *                   to its nearest cube edge line, for vertices whose
 *                   closest projection falls ON the edge segment (mm).
 *                   Measures feature-edge rounding.
 *   kinkCount     — number of shared-edge triangle pairs in the
 *                   subdivided mesh with dihedral angle > 30°.
 *                   Measures shading-error hotspots.
 *
 *   baseCornerPinch — same for pre-subdivision mesh (should be 0)
 *   baseEdgeDrift   — same for pre-subdivision mesh (should be 0)
 *   baseKinkCount   — same for pre-subdivision mesh (should be ~12
 *                     for a cube with flat-face/edge discontinuities)
 *
 * Writes:  docs/superpowers/notes/subdivision-C-recon.json
 * Pattern: e2e/brep-a5-recon-electron.spec.js
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.setTimeout(600000);

test('Sub-project C — subdivision baseline recon (pinching + shading metrics)', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });

  // Wait for both kernel and subdivision hooks to be available.
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscSubdiv, null, { timeout: 60000 });

  // ── Main recon evaluate ──────────────────────────────────────────────────────
  const recon = await win.evaluate(async () => {
    const kernel = window.__archdiscKernel.kernel;
    const { loopSubdivide } = window.__archdiscSubdiv;

    // ── Helper: cross product ──────────────────────────────────────────────────
    function cross(a, b) {
      return [
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0],
      ];
    }

    // ── Helper: dot product ────────────────────────────────────────────────────
    function dot(a, b) {
      return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    }

    // ── Helper: vector length ──────────────────────────────────────────────────
    function len(v) {
      return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    }

    // ── Helper: normalize ─────────────────────────────────────────────────────
    function normalize(v) {
      const l = len(v);
      if (l < 1e-12) return [0,0,0];
      return [v[0]/l, v[1]/l, v[2]/l];
    }

    // ── Helper: subtract vectors ───────────────────────────────────────────────
    function sub(a, b) {
      return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    }

    // ── Helper: Euclidean distance ────────────────────────────────────────────
    function dist(a, b) {
      const d = sub(a, b);
      return len(d);
    }

    // ── 1. Build cube via OCCT and tessellate ──────────────────────────────────
    const box = await kernel.brep.makeBox(20, 20, 20);
    // tessellate takes the BrepShape wrapper object, not the raw .shape property.
    const tess = await kernel.brep.tessellate(box, 0.5);

    // tess: { positions: Float32Array, normals: Float32Array, indices: Uint32Array }
    const baseVertices = [];
    for (let i = 0; i < tess.positions.length; i += 3) {
      baseVertices.push([tess.positions[i], tess.positions[i+1], tess.positions[i+2]]);
    }
    const baseTriangles = [];
    for (let i = 0; i < tess.indices.length; i += 3) {
      baseTriangles.push([tess.indices[i], tess.indices[i+1], tess.indices[i+2]]);
    }

    const baseMesh = { vertices: baseVertices, triangles: baseTriangles };

    // ── 2. Apply 2 Loop subdivision steps ──────────────────────────────────────
    const subdivMesh = loopSubdivide(baseMesh, 2);

    // ── 3. Measurement helpers ─────────────────────────────────────────────────

    /**
     * Cube nominal corner positions for a 20×20×20 cube at origin.
     */
    const CUBE_CORNERS = [
      [0,0,0], [20,0,0], [0,20,0], [20,20,0],
      [0,0,20], [20,0,20], [0,20,20], [20,20,20],
    ];

    /**
     * The 12 cube edges as pairs of corner indices (into CUBE_CORNERS).
     */
    const CUBE_EDGES = [
      [0,1],[2,3],[4,5],[6,7], // bottom/top parallel to X
      [0,2],[1,3],[4,6],[5,7], // parallel to Y
      [0,4],[1,5],[2,6],[3,7], // parallel to Z
    ];

    /**
     * cornerPinch: for each nominal corner, find the closest subdivided vertex.
     * Returns max distance over all 8 corners.
     */
    function measureCornerPinch(mesh) {
      let maxDist = 0;
      const perCorner = [];
      for (const corner of CUBE_CORNERS) {
        let minD = Infinity;
        for (const v of mesh.vertices) {
          const d = dist(v, corner);
          if (d < minD) minD = d;
        }
        perCorner.push(minD);
        if (minD > maxDist) maxDist = minD;
      }
      return { cornerPinch: maxDist, perCorner };
    }

    /**
     * edgeDrift: for each cube edge, find subdivided vertices whose projection
     * onto the edge segment lies within the segment (t in [0,1]), and measure
     * the perpendicular distance to the edge line.
     * Returns max perpendicular distance over all vertices + all edges.
     */
    function measureEdgeDrift(mesh) {
      let maxDrift = 0;
      const perEdge = [];

      for (const [ci, cj] of CUBE_EDGES) {
        const p0 = CUBE_CORNERS[ci];
        const p1 = CUBE_CORNERS[cj];
        const edgeVec = sub(p1, p0);
        const edgeLen = len(edgeVec);
        const edgeDir = normalize(edgeVec);
        let edgeMaxDrift = 0;

        for (const v of mesh.vertices) {
          const toV = sub(v, p0);
          const t = dot(toV, edgeDir) / edgeLen;
          // Only consider vertices whose projection falls on the segment
          if (t < 0 || t > 1) continue;

          // Projection point on edge
          const proj = [
            p0[0] + t * edgeLen * edgeDir[0],
            p0[1] + t * edgeLen * edgeDir[1],
            p0[2] + t * edgeLen * edgeDir[2],
          ];
          const perpDist = dist(v, proj);
          if (perpDist > edgeMaxDrift) edgeMaxDrift = perpDist;
          if (perpDist > maxDrift) maxDrift = perpDist;
        }
        perEdge.push(edgeMaxDrift);
      }

      return { edgeDrift: maxDrift, perEdge };
    }

    /**
     * kinkCount: count shared-edge triangle pairs with dihedral angle > 30°.
     * These are shading-error hotspots (hard crease without normal smoothing).
     */
    function measureKinkCount(mesh) {
      const { vertices, triangles } = mesh;
      const KINK_THRESHOLD_COS = Math.cos(30 * Math.PI / 180); // cos(30°) ≈ 0.866

      // Build shared-edge map: "i,j" → list of triangle normals
      const edgeTriNormals = new Map();
      const ekey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

      for (const [a, b, c] of triangles) {
        // Compute face normal
        const va = vertices[a], vb = vertices[b], vc = vertices[c];
        const ab = sub(vb, va);
        const ac = sub(vc, va);
        const n = normalize(cross(ab, ac));

        for (const [i, j] of [[a,b],[b,c],[c,a]]) {
          const k = ekey(i, j);
          if (!edgeTriNormals.has(k)) edgeTriNormals.set(k, []);
          edgeTriNormals.get(k).push(n);
        }
      }

      let kinkCount = 0;
      for (const normals of edgeTriNormals.values()) {
        if (normals.length < 2) continue; // boundary edge — skip
        // For exactly 2 adjacent triangles (well-formed mesh):
        const d = dot(normals[0], normals[1]);
        // dihedral > 30° ⟺ dot product of normals < cos(30°)
        if (d < KINK_THRESHOLD_COS) kinkCount++;
      }

      return { kinkCount };
    }

    // ── 4. Compute baseline (pre-subdivision) metrics ─────────────────────────
    const baseCornerResult = measureCornerPinch(baseMesh);
    const baseEdgeResult   = measureEdgeDrift(baseMesh);
    const baseKinkResult   = measureKinkCount(baseMesh);

    // ── 5. Compute post-subdivision metrics ───────────────────────────────────
    const subdivCornerResult = measureCornerPinch(subdivMesh);
    const subdivEdgeResult   = measureEdgeDrift(subdivMesh);
    const subdivKinkResult   = measureKinkCount(subdivMesh);

    // ── 6. Assemble result ────────────────────────────────────────────────────
    return {
      // Pre-subdivision (base mesh)
      baseMeshInfo: {
        vertexCount: baseMesh.vertices.length,
        triangleCount: baseMesh.triangles.length,
      },
      baseCornerPinch: baseCornerResult.cornerPinch,
      baseEdgeDrift: baseEdgeResult.edgeDrift,
      baseKinkCount: baseKinkResult.kinkCount,
      baseCornerPinchPerCorner: baseCornerResult.perCorner,
      baseEdgeDriftPerEdge: baseEdgeResult.perEdge,

      // Post-subdivision (2 Loop steps)
      subdivMeshInfo: {
        vertexCount: subdivMesh.vertices.length,
        triangleCount: subdivMesh.triangles.length,
      },
      cornerPinch: subdivCornerResult.cornerPinch,
      edgeDrift: subdivEdgeResult.edgeDrift,
      kinkCount: subdivKinkResult.kinkCount,
      cornerPinchPerCorner: subdivCornerResult.perCorner,
      edgeDriftPerEdge: subdivEdgeResult.perEdge,

      _note: 'Sub-project C baseline recon. Values are the deliverable — ' +
        'GREEN means measurements recorded, not that values are good.',
    };
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'subdivision-C-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(recon, null, 2));
  console.log('SUBDIVISION C RECON RESULT:', JSON.stringify(recon, null, 2));

  // ── Assertions ────────────────────────────────────────────────────────────────
  // The spec PASSES green when each measurement has been recorded.
  // We do NOT assert that values are "good" — the numbers ARE the deliverable.

  expect(typeof recon.cornerPinch, 'cornerPinch must be a number').toBe('number');
  expect(typeof recon.edgeDrift,   'edgeDrift must be a number').toBe('number');
  expect(typeof recon.kinkCount,   'kinkCount must be a number').toBe('number');

  expect(typeof recon.baseCornerPinch, 'baseCornerPinch must be a number').toBe('number');
  expect(typeof recon.baseEdgeDrift,   'baseEdgeDrift must be a number').toBe('number');
  expect(typeof recon.baseKinkCount,   'baseKinkCount must be a number').toBe('number');

  expect(recon.baseMeshInfo.vertexCount).toBeGreaterThan(0);
  expect(recon.baseMeshInfo.triangleCount).toBeGreaterThan(0);
  expect(recon.subdivMeshInfo.vertexCount).toBeGreaterThan(recon.baseMeshInfo.vertexCount);
  expect(recon.subdivMeshInfo.triangleCount).toBeGreaterThan(recon.baseMeshInfo.triangleCount);

  // Subdivision produces exactly 4x the triangles per step → 16x after 2 steps
  // (give or take boundary effects — just verify it's substantially larger)
  expect(recon.subdivMeshInfo.triangleCount).toBeGreaterThan(recon.baseMeshInfo.triangleCount * 3);

  // cornerPinchPerCorner must have 8 entries (one per cube corner)
  expect(Array.isArray(recon.cornerPinchPerCorner)).toBe(true);
  expect(recon.cornerPinchPerCorner.length).toBe(8);

  // edgeDriftPerEdge must have 12 entries (one per cube edge)
  expect(Array.isArray(recon.edgeDriftPerEdge)).toBe(true);
  expect(recon.edgeDriftPerEdge.length).toBe(12);

  expect(pageErrors).toEqual([]);
  await app.close();
});
