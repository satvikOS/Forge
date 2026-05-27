/**
 * Workflow-02 — Per-component STEP export + project-bundle ZIP.
 *
 * Coherent real-project integration test. Builds an injection-mould
 * tooling cassette — the kind of multi-body assembly a tool shop
 * would actually hand to a vendor — then exports the project bundle
 * and verifies every body appears as its own STEP file inside the ZIP,
 * with a valid manifest and a composed-assembly STEP.
 *
 * Real project — Injection-mould tooling cassette:
 *   - Base plate           60 × 40 × 8 mm  AISI P20 mould steel
 *   - Cavity insert        Ø 28 × 22 mm    AISI H13
 *   - Core insert          Ø 24 × 30 mm    AISI H13
 *   - Ejector pin (×4)     Ø 4 × 30 mm     SKD61
 *
 * Coherence checks:
 *   • BodyRegistry count equals manifest componentCount
 *   • Every component STEP > 100 bytes and is a real ISO-10303-21 file
 *   • assembly.step is present
 *   • Bundle ZIP has valid local-file + EOCD signatures
 *   • Every component name is filesystem-safe (no path-traversal chars)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf02-project-bundle');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-02 — Injection-mould tooling cassette → per-component STEP + project bundle ZIP', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 0,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscBodies
       && !!window.__archdiscKernel
       && !!window.__archdiscKernel.kernel
       && !!window.__archdiscAddBrepShape
       && !!window.__archdiscScene,
    null, { timeout: 60000 });

  // Build the cassette via real kernel B-rep ops + scene registration.
  // Same code path the ribbon "Box"/"Cylinder" tools take, just called
  // directly so the e2e can name the bodies deterministically.
  const buildReport = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel;     // ArchDiscKernel
    const scene = window.__archdiscScene;
    const viewport = window.__archdiscViewport;
    const addBrep = window.__archdiscAddBrepShape;
    const reg = window.__archdiscBodies;

    // Warm OCCT WASM once; subsequent calls reuse the loaded module.
    await K.brep.makeBox(0.001, 0.001, 0.001).then(s => s.dispose?.()).catch(() => null);

    const make = async (label, shapeMaker) => {
      const sh = await shapeMaker();
      await addBrep(scene, viewport, sh);
      // Name the most-recently-registered body so the manifest lists
      // human-readable component names (Base Plate (P20), …).
      const list = (typeof reg.list === 'function') ? reg.list() : reg.bodies;
      if (list.length > 0 && typeof reg.rename === 'function') {
        reg.rename(list[list.length - 1].id, label);
      }
    };

    // P20 mould-steel base plate (mm → m for kernel)
    await make('BasePlate-P20',     () => K.brep.makeBox(0.060, 0.040, 0.008));
    // H13 cavity insert (Ø 28 × 22 mm)
    await make('CavityInsert-H13',  () => K.brep.makeCylinder(0.014, 0.022));
    // H13 core insert (Ø 24 × 30 mm)
    await make('CoreInsert-H13',    () => K.brep.makeCylinder(0.012, 0.030));
    // 4× SKD61 ejector pins (Ø 4 × 30 mm)
    await make('EjectorPin1-SKD61', () => K.brep.makeCylinder(0.002, 0.030));
    await make('EjectorPin2-SKD61', () => K.brep.makeCylinder(0.002, 0.030));
    await make('EjectorPin3-SKD61', () => K.brep.makeCylinder(0.002, 0.030));
    await make('EjectorPin4-SKD61', () => K.brep.makeCylinder(0.002, 0.030));

    const list = (typeof reg.list === 'function') ? reg.list() : reg.bodies;
    return {
      ok: true,
      count: list.length,
      names: list.map(b => b.name),
      withBrep: list.filter(b => !!b.brepShapeRef).length,
    };
  });
  console.log('  [build]', JSON.stringify(buildReport));
  expect(buildReport.ok).toBe(true);
  expect(buildReport.count).toBe(7);
  expect(buildReport.withBrep).toBe(7);

  await win.screenshot({ path: path.join(OUT, '01-cassette-assembled.png') });

  // Switch to the Drawing tab so the new "Export Project Bundle" entry
  // is in the active tab. Real-user pattern: click the tab, then click
  // the tool. (dispatchEvent('click') is required because the ribbon's
  // scroll container intercepts Playwright's synthetic clicks.)
  await win.evaluate(() => {
    for (const t of document.querySelectorAll('.ribbon-tab')) {
      if ((t.textContent || '').trim().toLowerCase() === 'drawing') {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
    }
  });
  await win.waitForTimeout(280);

  const clickRes = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.ribbon-tool')) {
      if ((b.textContent || '').includes('Export Project Bundle')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  expect(clickRes.clicked).toBe(true);

  // Handler runs async (per-body STEP export ~50–200 ms × 7 bodies → ~1.5 s).
  // Wait for window.__lastBundle (mirrored from the handler) to populate.
  await win.waitForFunction(() => !!window.__lastBundle, null, { timeout: 30000 });

  const bundle = await win.evaluate(() => {
    const r = window.__lastBundle;
    if (!r || !r.ok) return { ok: false, raw: r };
    // Serialize ZIP bytes to base64 over the bridge.
    const u8 = r.zipBytes;
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return {
      ok: r.ok,
      projectName: r.projectName,
      bytes: r.bytes,
      components: r.components,
      failures: r.failures,
      manifest: r.manifest,
      zipBase64: btoa(s),
    };
  });
  console.log('  [bundle]', JSON.stringify({
    ok: bundle.ok,
    components: bundle.components,
    bytes: bundle.bytes,
    failures: bundle.failures,
    names: bundle.manifest?.components?.map(c => c.name),
  }));
  expect(bundle.ok).toBe(true);
  expect(bundle.components).toBe(7);
  expect(bundle.failures).toBe(0);
  expect(bundle.bytes).toBeGreaterThan(2000);

  // Coherence per component: every component STEP must be > 100 bytes
  // (a header-only STEP is ~280 bytes, real solid is several KB) and
  // every name must be filesystem-safe.
  expect(bundle.manifest.components.every(c => c.bytes > 100)).toBe(true);
  expect(bundle.manifest.components.every(c => /^[a-zA-Z0-9._-]+$/.test(c.name))).toBe(true);

  // Persist the bundle to disk + assert the ZIP shape host-side.
  const zipBuf = Buffer.from(bundle.zipBase64, 'base64');
  const zipPath = path.join(OUT, 'mold-cassette-bundle.zip');
  fs.writeFileSync(zipPath, zipBuf);

  // EOCD signature 0x06054B50 at end.
  const tail = zipBuf.slice(-22);
  expect(tail.readUInt32LE(0)).toBe(0x06054b50);
  // Local file header signature 0x04034B50 at start.
  expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50);

  // ZIP body must mention the canonical bundle contents and a real STEP file.
  const haystack = zipBuf.toString('utf8');
  expect(haystack.includes('manifest.json')).toBe(true);
  expect(haystack.includes('assembly.step')).toBe(true);
  expect(haystack.includes('components/')).toBe(true);
  expect(haystack.includes('ISO-10303-21;')).toBe(true);
  expect(haystack.includes('DATA;')).toBe(true);

  await win.screenshot({ path: path.join(OUT, '02-bundle-exported.png') });
  await app.close();
});
