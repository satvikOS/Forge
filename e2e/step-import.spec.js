import { test, expect } from '@playwright/test';
import { manifoldToSTEP } from '../frontend/src/foundation/StepExport.js';
import { parseStep, parseEntities } from '../frontend/src/foundation/StepImport.js';

test.describe('STEP import (tolerant reader)', () => {
  test.describe.configure({ timeout: 120000 });

  test('parseEntities tokenises the entity graph', () => {
    const step = [
      'ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;',
      "#1=CARTESIAN_POINT('',(0.,0.,0.));",
      "#2=CARTESIAN_POINT('',(10.,0.,0.));",
      "#3=VERTEX_POINT('',#1);",
      'ENDSEC;', 'END-ISO-10303-21;',
    ].join('\n');
    const ent = parseEntities(step);
    expect(ent.size).toBe(3);
    expect(ent.get(1).type).toBe('CARTESIAN_POINT');
    expect(ent.get(3).type).toBe('VERTEX_POINT');
  });

  test('Round-trip: export a manifold to STEP, parse it back', async ({ page }) => {
    // Build a real manifold cube in the browser, export to STEP,
    // then parse it back with the importer — counts must round-trip.
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    const stepText = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const Mod = await getManifold();
      const cube = Mod.Manifold.cube([20, 14, 8], true);
      const mesh = cube.getMesh();
      return { triCount: mesh.triVerts.length / 3, vertCount: mesh.vertProperties.length / mesh.numProp };
    });
    console.log(`\nSource cube: ${stepText.vertCount} verts, ${stepText.triCount} tris`);

    // Export + re-import happens here in node with the foundation modules.
    const exportStep = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { manifoldToSTEP } = await import('/src/foundation/StepExport.js');
      const Mod = await getManifold();
      const cube = Mod.Manifold.cube([20, 14, 8], true);
      return manifoldToSTEP(cube, { name: 'RoundTrip_Cube' });
    });
    expect(exportStep).toContain('MANIFOLD_SOLID_BREP');
    expect(exportStep).toContain('ADVANCED_FACE');

    // Parse the exported STEP with the importer.
    const mesh = parseStep(exportStep);
    console.log(`Re-imported: ${mesh.vertices.length} verts, ${mesh.triangles.length} tris, ${mesh.faceCount} faces, ${mesh.skippedFaces} skipped`);
    // A cube triangulates to 12 triangles → 12 ADVANCED_FACEs → 12 tris back.
    expect(mesh.faceCount).toBe(stepText.triCount);
    expect(mesh.triangles.length).toBe(stepText.triCount);
    expect(mesh.skippedFaces).toBe(0);
    // 8 cube corners.
    expect(mesh.vertices.length).toBe(8);
  });

  test('Import STEP ribbon: round-tripped file rebuilds a body in the scene', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Generate a STEP file in-page, hand it to the hidden file input
    // that the Import STEP handler creates.
    const stepText = await page.evaluate(async () => {
      const { getManifold } = await import('/src/foundation/manifoldKernel.js');
      const { manifoldToSTEP } = await import('/src/foundation/StepExport.js');
      const Mod = await getManifold();
      const cyl = Mod.Manifold.cylinder(30, 10, 10, 32, true);
      return manifoldToSTEP(cyl, { name: 'Imported_Cylinder' });
    });

    // Intercept the file chooser the handler triggers.
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('.ribbon-tool-label', { hasText: /^Import STEP$/ }).first().click();
    const chooser = await fileChooserPromise;
    // Write the STEP to a temp file and feed it.
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmp = path.join(os.tmpdir(), `archdisc-import-${Date.now()}.step`);
    fs.writeFileSync(tmp, stepText);
    await chooser.setFiles(tmp);

    // The handler parses + builds a manifold + adds it to the scene.
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const vol = await page.evaluate(() => window.__lastFoundationManifold.volume());
    console.log(`\nImported cylinder volume: ${vol.toFixed(0)} mm³`);
    // R=10, H=30 → ideal π·100·30 = 9425 mm³; the 32-facet inscribed
    // polygon comes in a touch under that (~9364).
    expect(vol).toBeGreaterThan(9000);
    expect(vol).toBeLessThan(9500);

    // A body was registered.
    const bodyCount = await page.evaluate(() => window.__archdiscBodies?.list?.()?.length ?? 0);
    expect(bodyCount).toBeGreaterThanOrEqual(1);
  });
});
