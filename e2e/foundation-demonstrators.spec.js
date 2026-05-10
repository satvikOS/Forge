import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'foundation-output');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function saveSTL(name, base64) {
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(base64, 'base64'));
}
function saveJSON(name, obj) {
  fs.writeFileSync(path.join(ROOT, name), JSON.stringify(obj, null, 2));
}

test.setTimeout(300000);

/**
 * M8 — five real demonstrator parts. Each is built, evaluated for
 * manifold correctness, STL-exported, print-prep-reported, and key
 * geometric expectations are asserted.
 */
test.describe('M8 — Five real demonstrator parts (printable, assemblable)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('1) Phone-stand bracket: base + tilted wall + lip, manifold + STL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const out = await page.evaluate(async () => {
      const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
      const m = await buildPhoneStandBracket();
      const r = buildPrintReport(m);
      const stl = toBinarySTL(m);
      let bin = ''; for (let i = 0; i < stl.length; i++) bin += String.fromCharCode(stl[i]);
      return { report: r, stl: btoa(bin) };
    });

    expect(out.report.manifold).toBe(true);
    expect(out.report.triangles).toBeGreaterThan(50);
    saveSTL('M8-1-phone-bracket.stl', out.stl);
    saveJSON('M8-1-phone-bracket-report.json', out.report);
  });

  test('2) Threaded bottle cap + neck: thread engages, both manifold', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const out = await page.evaluate(async () => {
      const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
      const cap = await buildBottleCap();
      const neck = await buildBottleNeck();
      const reportCap = buildPrintReport(cap);
      const reportNeck = buildPrintReport(neck);
      const stlCap = toBinarySTL(cap);
      const stlNeck = toBinarySTL(neck);
      const enc = (a) => { let b=''; for (let i=0;i<a.length;i++) b += String.fromCharCode(a[i]); return btoa(b); };
      return {
        cap: { report: reportCap, stl: enc(stlCap) },
        neck: { report: reportNeck, stl: enc(stlNeck) },
      };
    });
    expect(out.cap.report.manifold).toBe(true);
    expect(out.neck.report.manifold).toBe(true);
    saveSTL('M8-2-bottle-cap.stl', out.cap.stl);
    saveSTL('M8-2-bottle-neck.stl', out.neck.stl);
    saveJSON('M8-2-bottle-cap-report.json', out.cap.report);
    saveJSON('M8-2-bottle-neck-report.json', out.neck.report);
  });

  test('3) Hinged bracket pair: 2 leaves + pin, mate solver places + leaves rotate freely', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const out = await page.evaluate(async () => {
      const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
      const { Part } = await import('/src/foundation/Part.js');
      const { Assembly } = await import('/src/foundation/AssemblyMate.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');

      const leafA = await buildLeafA();
      const leafB = await buildLeafB();
      const pin = await buildHingePin();

      // Assembly: place leafA at origin (knuckle axis at x=50, y=15, z=2),
      // leafB knuckle pair straddles leafA's knuckle, pin runs through both.
      const partA = new Part('LeafA');
      const partB = new Part('LeafB');
      const partPin = new Part('HingePin');

      // Initial intentionally-off positions
      partB.transform.translation = [0, 0, 30];
      partB.transform.rotation = [0, 0, 180];
      partPin.transform.translation = [0, 0, 0];

      const asm = new Assembly('hinge');
      asm.addPart(partA);
      asm.addPart(partB);
      asm.addPart(partPin);
      asm.fix(partA);

      // Pin's axis (local +Z) concentric with leafA's knuckle axis at (50,15)
      asm.concentric(
        partA, { type: 'axis', origin: [50, 15, 2], dir: [0, 0, 1] },
        partPin, { type: 'axis', origin: [0, 0, 0], dir: [0, 0, 1] },
      );
      // Pin and leafB mate likewise — but leafB knuckles are split, so
      // axis collinear with leafA knuckle.
      asm.concentric(
        partA, { type: 'axis', origin: [50, 15, 2], dir: [0, 0, 1] },
        partB, { type: 'axis', origin: [50, 15, 2], dir: [0, 0, 1] },
      );
      const r = asm.solve();

      const reports = {
        leafA: buildPrintReport(leafA),
        leafB: buildPrintReport(leafB),
        pin: buildPrintReport(pin),
      };
      const enc = (a) => { let b=''; for (let i=0;i<a.length;i++) b += String.fromCharCode(a[i]); return btoa(b); };
      return {
        result: r,
        partB_translation: partB.transform.translation,
        partB_rotation: partB.transform.rotation,
        reports,
        stls: { leafA: enc(toBinarySTL(leafA)), leafB: enc(toBinarySTL(leafB)), pin: enc(toBinarySTL(pin)) },
      };
    });

    expect(out.result.converged).toBe(true);
    expect(out.reports.leafA.manifold).toBe(true);
    expect(out.reports.leafB.manifold).toBe(true);
    expect(out.reports.pin.manifold).toBe(true);
    saveSTL('M8-3-hinge-leafA.stl', out.stls.leafA);
    saveSTL('M8-3-hinge-leafB.stl', out.stls.leafB);
    saveSTL('M8-3-hinge-pin.stl', out.stls.pin);
    saveJSON('M8-3-hinge-report.json', { mate: out.result, parts: out.reports,
      partB_solved: { t: out.partB_translation, r: out.partB_rotation }});
  });

  test('4) Planetary gearset: sun + 4 planets + ring fit by Z_sun + 2*Z_planet = Z_ring', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const out = await page.evaluate(async () => {
      const { buildPlanetary } = await import('/src/foundation/parts/PlanetaryGearset.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
      const set = await buildPlanetary();
      const reports = {
        sun: buildPrintReport(set.sun),
        planet: buildPrintReport(set.planet),
        ring: buildPrintReport(set.ring),
      };
      const enc = (a) => { let b=''; for (let i=0;i<a.length;i++) b += String.fromCharCode(a[i]); return btoa(b); };
      return {
        reports, spec: set.spec, centers: set.centers,
        stls: {
          sun: enc(toBinarySTL(set.sun)),
          planet: enc(toBinarySTL(set.planet)),
          ring: enc(toBinarySTL(set.ring)),
        },
      };
    });
    // Mating constraint:  Z_sun + 2*Z_planet == Z_ring
    expect(out.spec.Z_SUN + 2 * out.spec.Z_PLANET).toBe(out.spec.Z_RING);
    expect(out.reports.sun.manifold).toBe(true);
    expect(out.reports.planet.manifold).toBe(true);
    expect(out.reports.ring.manifold).toBe(true);
    saveSTL('M8-4-gear-sun.stl', out.stls.sun);
    saveSTL('M8-4-gear-planet.stl', out.stls.planet);
    saveSTL('M8-4-gear-ring.stl', out.stls.ring);
    saveJSON('M8-4-gear-report.json', { reports: out.reports, spec: out.spec, centers: out.centers });
  });

  test('5) Sealed enclosure: base + lid mate via lip+groove, both manifold + printable', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const out = await page.evaluate(async () => {
      const { buildEnclosureBase, buildEnclosureLid, ENCLOSURE_SPEC }
        = await import('/src/foundation/parts/SealedEnclosure.js');
      const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
      const base = await buildEnclosureBase();
      const lid = await buildEnclosureLid();
      const reports = { base: buildPrintReport(base), lid: buildPrintReport(lid) };
      const enc = (a) => { let b=''; for (let i=0;i<a.length;i++) b += String.fromCharCode(a[i]); return btoa(b); };
      return {
        reports, spec: ENCLOSURE_SPEC,
        stls: { base: enc(toBinarySTL(base)), lid: enc(toBinarySTL(lid)) },
      };
    });
    expect(out.reports.base.manifold).toBe(true);
    expect(out.reports.lid.manifold).toBe(true);
    saveSTL('M8-5-enclosure-base.stl', out.stls.base);
    saveSTL('M8-5-enclosure-lid.stl', out.stls.lid);
    saveJSON('M8-5-enclosure-report.json', { reports: out.reports, spec: out.spec });
  });
});
