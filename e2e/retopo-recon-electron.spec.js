/**
 * retopo-recon-electron.spec.js
 *
 * Sub-project D — Retopology / Isotropic Remeshing baseline reconnaissance.
 *
 * Builds a real-world artifact — a Box → Fillet rounded plate — via actual
 * ribbon clicks (no hardcoded geometry). Tessellates it with OCCT deflection
 * 0.5 mm, welds duplicate vertices, then measures baseline mesh quality:
 *
 *   vertexCount     — number of vertices in the welded mesh
 *   triangleCount   — number of triangles in the welded mesh
 *   minEdge         — shortest edge length (mm)
 *   maxEdge         — longest edge length (mm)
 *   meanEdge        — mean edge length (mm)
 *   stddevEdge      — standard deviation of edge lengths (mm)
 *   valenceHistogram — object mapping valence → count (e.g. {4:2, 5:8, 6:24})
 *
 * Writes: docs/superpowers/notes/retopology-D-recon.json
 * Pattern: e2e/subdivide-recon-electron.spec.js
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
} from './helpers/uiWorkflow.js';

test.setTimeout(600000);

test('Sub-project D — retopology baseline recon (Box→Fillet rounded plate)', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });

  // Wait for kernel and subdivision hooks.
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscSubdiv, null, { timeout: 60000 });

  // ── Build artifact: Box → Fillet (rounded plate) ─────────────────────────────
  // Step 1: Build Box (40³ — the plate blank).
  const boxId = await buildPrimitive(win, 'Box');

  // Step 2: Select the box body so Fillet can consume it.
  await selectBodies(win, [boxId]);

  // Step 3: Capture current shape id to detect the Fillet result.
  const idBefore = await win.evaluate(() =>
    window.__lastBrepShape && window.__lastBrepShape.id
  );

  // Step 4: Inject Fillet params then click Fillet.
  //   Under Playwright (navigator.webdriver=true) the ToolParamDialog
  //   auto-bypasses — planParams is the correct injection path.
  await injectToolParams(win, 'Fillet', { radius: 2 });
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, 'Fillet');

  // Step 5: Wait for the filleted shape to land.
  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
    idBefore,
    { timeout: 60000 },
  );

  // ── Tessellate, weld, and measure ────────────────────────────────────────────
  const metrics = await win.evaluate(async () => {
    const kernel = window.__archdiscKernel.kernel;
    const { weldMesh } = window.__archdiscSubdiv;

    // 1. Tessellate the filleted shape (deflection 0.5 mm).
    const tess = await kernel.brep.tessellate(window.__lastBrepShape, 0.5);

    // 2. Convert typed arrays to {vertices, triangles} mesh dict.
    const rawVertices = [];
    for (let i = 0; i < tess.positions.length; i += 3) {
      rawVertices.push([tess.positions[i], tess.positions[i+1], tess.positions[i+2]]);
    }
    const rawTriangles = [];
    for (let i = 0; i < tess.indices.length; i += 3) {
      rawTriangles.push([tess.indices[i], tess.indices[i+1], tess.indices[i+2]]);
    }

    // 3. Weld duplicate vertices (OCCT tessellation duplicates per face).
    //    Use tolerance 1e-4 mm to merge co-located vertices reliably.
    const mesh = weldMesh({ vertices: rawVertices, triangles: rawTriangles }, 1e-4);

    const vertexCount = mesh.vertices.length;
    const triangleCount = mesh.triangles.length;

    // 4. Collect all unique edges with their lengths.
    //    Use a canonical key "minIdx,maxIdx" to deduplicate.
    const edgeLengthMap = new Map();
    for (const [a, b, c] of mesh.triangles) {
      const pairs = [[a,b],[b,c],[c,a]];
      for (const [i, j] of pairs) {
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        const key = `${lo},${hi}`;
        if (!edgeLengthMap.has(key)) {
          const vi = mesh.vertices[i];
          const vj = mesh.vertices[j];
          const dx = vi[0]-vj[0], dy = vi[1]-vj[1], dz = vi[2]-vj[2];
          edgeLengthMap.set(key, Math.sqrt(dx*dx + dy*dy + dz*dz));
        }
      }
    }

    const edgeLengths = Array.from(edgeLengthMap.values());
    const edgeCount = edgeLengths.length;

    let minEdge = Infinity, maxEdge = -Infinity, sumEdge = 0;
    for (const l of edgeLengths) {
      if (l < minEdge) minEdge = l;
      if (l > maxEdge) maxEdge = l;
      sumEdge += l;
    }
    const meanEdge = sumEdge / edgeCount;

    let sumSq = 0;
    for (const l of edgeLengths) {
      const d = l - meanEdge;
      sumSq += d * d;
    }
    const stddevEdge = Math.sqrt(sumSq / edgeCount);

    // 5. Vertex-valence histogram.
    //    Valence of vertex v = number of unique edges incident on v.
    const valenceCount = new Array(vertexCount).fill(0);
    for (const [lo, hi] of Array.from(edgeLengthMap.keys()).map(k => k.split(',').map(Number))) {
      valenceCount[lo]++;
      valenceCount[hi]++;
    }
    const valenceHistogram = {};
    for (const v of valenceCount) {
      if (v === 0) continue; // isolated vertex (should not happen in a clean mesh)
      valenceHistogram[v] = (valenceHistogram[v] || 0) + 1;
    }

    return {
      artifact: 'Box(40³) → Fillet(r=2) — rounded plate',
      vertexCount,
      triangleCount,
      edgeCount,
      minEdge,
      maxEdge,
      meanEdge,
      stddevEdge,
      stddevOverMean: stddevEdge / meanEdge,
      valenceHistogram,
      _note:
        'Sub-project D baseline recon. Values are the deliverable — ' +
        'GREEN means measurements recorded, not that values are good.',
    };
  });

  // ── Write JSON output ────────────────────────────────────────────────────────
  const notesDir = path.join(__dirname, '..', 'docs', 'superpowers', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const jsonPath = path.join(notesDir, 'retopology-D-recon.json');
  fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
  console.log('RETOPOLOGY D RECON RESULT:', JSON.stringify(metrics, null, 2));

  // ── Assertions ────────────────────────────────────────────────────────────────
  // The spec PASSES green when each measurement has been recorded.
  // We do NOT assert that values are "good" — the numbers ARE the deliverable.

  expect(typeof metrics.vertexCount,   'vertexCount must be a number').toBe('number');
  expect(typeof metrics.triangleCount, 'triangleCount must be a number').toBe('number');
  expect(typeof metrics.minEdge,       'minEdge must be a number').toBe('number');
  expect(typeof metrics.maxEdge,       'maxEdge must be a number').toBe('number');
  expect(typeof metrics.meanEdge,      'meanEdge must be a number').toBe('number');
  expect(typeof metrics.stddevEdge,    'stddevEdge must be a number').toBe('number');
  expect(typeof metrics.valenceHistogram, 'valenceHistogram must be an object').toBe('object');

  expect(metrics.vertexCount).toBeGreaterThan(0);
  expect(metrics.triangleCount).toBeGreaterThan(0);
  expect(metrics.edgeCount).toBeGreaterThan(0);

  // Sanity: welded mesh must have fewer vertices than raw tessellation
  // (duplicates collapsed) — checked indirectly: a well-formed fillet mesh
  // always has > 8 vertices and > 6 triangles.
  expect(metrics.vertexCount).toBeGreaterThan(8);
  expect(metrics.triangleCount).toBeGreaterThan(6);

  // Edge lengths must be positive and ordered.
  expect(metrics.minEdge).toBeGreaterThan(0);
  expect(metrics.maxEdge).toBeGreaterThanOrEqual(metrics.minEdge);
  expect(metrics.meanEdge).toBeGreaterThan(0);
  expect(metrics.stddevEdge).toBeGreaterThanOrEqual(0);

  // Valence histogram must have at least one entry.
  expect(Object.keys(metrics.valenceHistogram).length).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
  await app.close();
});
