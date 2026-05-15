import { test, expect } from '@playwright/test';

test.describe('Interactive sketch → foundation Sketch2D wiring', () => {
  test.describe.configure({ timeout: 120000 });

  test('Rough-drawn quad cleans up to a square via the foundation solver', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Activate an interactive sketch on the XZ plane + draw a rough
    // 50×30 mm quadrilateral (corners off by ~1°). Coordinates are in
    // metres — the InteractiveSketch grid is 1 mm.
    const preAngles = await page.evaluate(() => {
      const s = window.__archdiscSketch;
      s.activate(window.__three_scene, 'XZ');
      s._createLine({ u: 0.0004, v: 0.0002 }, { u: 0.0503, v: 0.0006 }); // bottom
      s._createLine({ u: 0.0503, v: 0.0006 }, { u: 0.0505, v: 0.0304 }); // right
      s._createLine({ u: 0.0505, v: 0.0304 }, { u: 0.0006, v: 0.0302 }); // top
      s._createLine({ u: 0.0006, v: 0.0302 }, { u: 0.0004, v: 0.0002 }); // left
      const deg = (e) => Math.atan2(e.p2.v - e.p1.v, e.p2.u - e.p1.u) * 180 / Math.PI;
      return s.entities.filter(e => e.type === 'line').map(deg);
    });
    console.log(`\nPre-cleanup line angles: ${preAngles.map(a => a.toFixed(2) + '°').join(', ')}`);
    // Bottom edge is visibly tilted (not exactly 0°).
    expect(Math.abs(preAngles[0])).toBeGreaterThan(0.3);

    // Run the foundation cleanup.
    const result = await page.evaluate(() => window.__archdiscCleanupSketch());
    console.log(`Cleanup: ${result.constraintsAdded} constraints, converged=${result.solver?.converged}, ${result.dimensions?.length} dims`);
    expect(result.ok).toBe(true);
    expect(result.solver.converged).toBe(true);
    expect(result.constraintsAdded).toBeGreaterThanOrEqual(5);   // anchor + axis snaps + equal-length

    // Post-cleanup the lines must be exactly axis-aligned.
    const post = await page.evaluate(() => {
      const s = window.__archdiscSketch;
      const lines = s.entities.filter(e => e.type === 'line');
      const horizErr = (e) => {
        const a = Math.abs(Math.atan2(e.p2.v - e.p1.v, e.p2.u - e.p1.u) * 180 / Math.PI);
        return Math.min(a, Math.abs(180 - a));
      };
      const vertErr = (e) =>
        Math.abs(Math.abs(Math.atan2(e.p2.v - e.p1.v, e.p2.u - e.p1.u) * 180 / Math.PI) - 90);
      return {
        bottomH: horizErr(lines[0]),
        rightV:  vertErr(lines[1]),
        topH:    horizErr(lines[2]),
        leftV:   vertErr(lines[3]),
        dims:    s._foundationDimensions?.length ?? 0,
      };
    });
    console.log(`Post-cleanup errors: bottomH=${post.bottomH.toExponential(2)}°, rightV=${post.rightV.toExponential(2)}°, topH=${post.topH.toExponential(2)}°, leftV=${post.leftV.toExponential(2)}°`);
    expect(post.bottomH).toBeLessThan(1e-3);
    expect(post.topH).toBeLessThan(1e-3);
    expect(post.rightV).toBeLessThan(1e-3);
    expect(post.leftV).toBeLessThan(1e-3);
    expect(post.dims).toBe(4);    // one length dimension per line

    // The 3D visuals were rebuilt — sketch group still has line objects.
    const visualCount = await page.evaluate(() => {
      const g = window.__archdiscSketch.sketchGroup;
      return g.children.filter(c => c.userData.sketchEntity && c.type === 'Line').length;
    });
    console.log(`Rebuilt sketch line visuals: ${visualCount}`);
    expect(visualCount).toBeGreaterThanOrEqual(4);
  });

  test('Auto-Constrain ribbon tool drives the same cleanup', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Build a rough sketch first.
    await page.evaluate(() => {
      const s = window.__archdiscSketch;
      s.activate(window.__three_scene, 'XZ');
      s._createLine({ u: 0, v: 0 }, { u: 0.04, v: 0.001 });
      s._createLine({ u: 0, v: 0.02 }, { u: 0.04, v: 0.0215 });
    });

    // Click the Auto-Constrain ribbon button.
    await page.locator('.ribbon-tab', { hasText: 'Sketch' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Auto-Constrain$/ }).first().click();
    await page.waitForTimeout(1500);

    // The two near-parallel lines should now be exactly parallel.
    const delta = await page.evaluate(() => {
      const lines = window.__archdiscSketch.entities.filter(e => e.type === 'line');
      const ang = (e) => Math.atan2(e.p2.v - e.p1.v, e.p2.u - e.p1.u);
      return Math.abs((ang(lines[1]) - ang(lines[0])) * 180 / Math.PI);
    });
    console.log(`\nLine-pair angle delta after Auto-Constrain: ${delta.toExponential(2)}°`);
    expect(delta).toBeLessThan(0.05);
  });
});
