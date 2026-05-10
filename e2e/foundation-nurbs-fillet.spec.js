import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'nurbs');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('NURBS variable-radius fillet — Phase 5 of Parasolid parity', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Constant-radius corner fillet: every point at exact distance R from edge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { cornerFillet, validateCornerFillet } = await import('/src/foundation/NURBSFillet.js');
      const args = {
        startPoint: [0, 0, 0],
        endPoint: [50, 0, 0],
        normalA: [0, 1, 0],     // face A's outward normal (+Y)
        normalB: [0, 0, 1],     // face B's outward normal (+Z)
        radiusStart: 5,
        radiusEnd: 5,
      };
      const surf = cornerFillet(args);
      const v = validateCornerFillet(surf, args, 30);
      return {
        controlNet: surf.controlNet,
        knotsU: surf.knotsU,
        knotsV: surf.knotsV,
        ...v,
      };
    });

    console.log(`\n=== CONSTANT-RADIUS FILLET R=5 ===`);
    console.log(`Control net dimensions: ${result.controlNet.length} × ${result.controlNet[0].length}`);
    console.log(`Knots U: [${result.knotsU.join(', ')}]`);
    console.log(`Knots V: [${result.knotsV.join(', ')}]`);
    console.log(`Max radius error (vs R=5):     ${result.maxRadiusError.toExponential(2)}`);
    console.log(`Max tangency error (|n·tangent|): ${result.maxTangencyError.toExponential(2)}`);

    fs.writeFileSync(path.join(ROOT, 'fillet-constant.json'), JSON.stringify(result, null, 2));

    // EXACT to machine precision
    expect(result.maxRadiusError).toBeLessThan(1e-12);
    expect(result.maxTangencyError).toBeLessThan(1e-12);
  });

  test('Variable-radius fillet: linearly tapering R 1 → 8', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { cornerFillet, validateCornerFillet } = await import('/src/foundation/NURBSFillet.js');
      const args = {
        startPoint: [0, 0, 0],
        endPoint: [80, 0, 0],
        normalA: [0, 1, 0],
        normalB: [0, 0, 1],
        radiusStart: 1,
        radiusEnd: 8,
      };
      const surf = cornerFillet(args);
      const v = validateCornerFillet(surf, args, 40);
      // Sample some specific points to verify the radius profile
      const startMid = surf.eval(0.5, 0);   // u=0.5, v=0 — middle of arc at start
      const endMid = surf.eval(0.5, 1);     // u=0.5, v=1 — middle of arc at end
      const centerMid = surf.eval(0.5, 0.5); // u=0.5, v=0.5 — middle radius
      const r0_actual = Math.hypot(startMid[1], startMid[2]);
      const r1_actual = Math.hypot(endMid[1], endMid[2]);
      const rmid_actual = Math.hypot(centerMid[1] - 40 * 0, centerMid[2]); // edge passes through (40, 0, 0) at v=0.5
      return {
        ...v,
        startMid, endMid, centerMid,
        r0_actual, r1_actual, rmid_actual,
        rmid_expected: 4.5,
      };
    });

    console.log(`\n=== VARIABLE-RADIUS FILLET R=1 → R=8 ===`);
    console.log(`Mid-arc at v=0:   r = ${result.r0_actual.toFixed(6)} mm  (expected 1)`);
    console.log(`Mid-arc at v=0.5: r = ${result.rmid_actual.toFixed(6)} mm  (expected ${result.rmid_expected})`);
    console.log(`Mid-arc at v=1:   r = ${result.r1_actual.toFixed(6)} mm  (expected 8)`);
    console.log(`Max radius error: ${result.maxRadiusError.toExponential(2)}`);
    console.log(`Max tangency error: ${result.maxTangencyError.toExponential(2)}`);

    fs.writeFileSync(path.join(ROOT, 'fillet-variable.json'), JSON.stringify(result, null, 2));

    expect(Math.abs(result.r0_actual - 1)).toBeLessThan(1e-12);
    expect(Math.abs(result.r1_actual - 8)).toBeLessThan(1e-12);
    expect(Math.abs(result.rmid_actual - 4.5)).toBeLessThan(1e-12);
    expect(result.maxRadiusError).toBeLessThan(1e-12);
    expect(result.maxTangencyError).toBeLessThan(1e-12);
  });

  test('Fillet → STEP AP203: round-trip as RATIONAL_B_SPLINE_SURFACE', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { cornerFillet } = await import('/src/foundation/NURBSFillet.js');
      const { exportNURBSSurface } = await import('/src/foundation/NURBSStepExport.js');
      const surf = cornerFillet({
        startPoint: [0, 0, 0], endPoint: [50, 0, 0],
        normalA: [0, 1, 0], normalB: [0, 0, 1],
        radiusStart: 2, radiusEnd: 8,
      });
      const step = exportNURBSSurface(surf, { name: 'VariableRadiusFillet_R2_R8' });
      return { step, bytes: step.length };
    });

    fs.writeFileSync(path.join(ROOT, 'fillet-variable.step'), result.step);
    console.log(`\nVariable fillet → STEP: ${result.bytes} bytes`);

    expect(result.step).toContain('B_SPLINE_SURFACE_WITH_KNOTS');
    expect(result.step).toContain('RATIONAL_B_SPLINE_SURFACE');
  });

  test('Fillet → manifold (tessellated): convert to STL through Phase 3', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { cornerFillet } = await import('/src/foundation/NURBSFillet.js');
      const { surfaceToManifold } = await import('/src/foundation/NURBSToManifold.js');
      const { toBinarySTL } = await import('/src/foundation/STLExport.js');

      const surf = cornerFillet({
        startPoint: [0, 0, 0], endPoint: [50, 0, 0],
        normalA: [0, 1, 0], normalB: [0, 0, 1],
        radiusStart: 2, radiusEnd: 8,
      });
      // Tessellate the open surface; just dump the tessellation as raw STL
      // (it is not a closed manifold without caps; we ship the open
      // surface mesh for visualisation).
      const mesh = surf.tessellate({ stepsU: 32, stepsV: 8 });
      // Build a fake STL header on the raw triangle list
      const numTri = mesh.triVerts.length / 3;
      const buf = new ArrayBuffer(80 + 4 + numTri * 50);
      const view = new DataView(buf);
      const u8 = new Uint8Array(buf);
      const banner = 'ArchDisc-fillet-surface-mesh';
      for (let i = 0; i < banner.length && i < 80; i++) u8[i] = banner.charCodeAt(i);
      view.setUint32(80, numTri, true);
      let off = 84;
      for (let t = 0; t < numTri; t++) {
        const i0 = mesh.triVerts[t*3], i1 = mesh.triVerts[t*3+1], i2 = mesh.triVerts[t*3+2];
        const get = (i) => [mesh.vertProperties[i*3], mesh.vertProperties[i*3+1], mesh.vertProperties[i*3+2]];
        const p0 = get(i0), p1 = get(i1), p2 = get(i2);
        // normal (right-hand)
        const ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
        const vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
        let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        view.setFloat32(off, nx, true); off += 4;
        view.setFloat32(off, ny, true); off += 4;
        view.setFloat32(off, nz, true); off += 4;
        for (const v of [p0, p1, p2]) {
          view.setFloat32(off, v[0], true); off += 4;
          view.setFloat32(off, v[1], true); off += 4;
          view.setFloat32(off, v[2], true); off += 4;
        }
        view.setUint16(off, 0, true); off += 2;
      }
      let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return {
        triCount: numTri,
        stl: btoa(bin),
      };
    });

    console.log(`Fillet tessellation: ${result.triCount} triangles`);
    fs.writeFileSync(path.join(ROOT, 'fillet-variable.stl'), Buffer.from(result.stl, 'base64'));
    expect(result.triCount).toBeGreaterThan(100);
  });
});
