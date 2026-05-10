import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'feature-recognition');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

test('Feature recognition: identify planar + cylindrical patches across demonstrators', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { recognize } = await import('/src/foundation/FeatureRecognition.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
    const { buildLeafA, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
    const { buildEnclosureBase, buildEnclosureLid } = await import('/src/foundation/parts/SealedEnclosure.js');
    const { iso4762, iso4032, iso7089 } = await import('/src/foundation/FastenerLib.js');

    const parts = [
      { name: 'Phone-Stand Bracket', mfd: await buildPhoneStandBracket(),
        expected: 'plate + tilted wall + lip + 4 cylindrical Ø4 holes' },
      { name: 'Hinge Leaf A', mfd: await buildLeafA(),
        expected: 'plate + central knuckle barrel + bore' },
      { name: 'Hinge Pin Ø5.8', mfd: await buildHingePin(),
        expected: 'one cylinder + 2 conical tip caps' },
      { name: 'Sealed Enclosure Base', mfd: await buildEnclosureBase(),
        expected: 'box + 4 corner bosses (cyl) + 4 PCB bosses (cyl) + 4 corner clearance holes (cyl) + 4 PCB ID holes (cyl)' },
      { name: 'M6 SHCS', mfd: await iso4762('M6', 25),
        expected: 'head cylinder + shank cylinder + hex socket (planar facets)' },
      { name: 'M6 nut', mfd: await iso4032('M6'),
        expected: '6 planar hex faces + 1 cylindrical thru-bore' },
      { name: 'M6 washer', mfd: await iso7089('M6'),
        expected: '2 planar annular faces + 2 cylindrical surfaces (OD + ID)' },
      { name: 'Bottle Cap M28x2', mfd: await buildBottleCap(),
        expected: 'cylindrical body + helical thread (freeform) + 12 axial knurls' },
    ];

    const results = [];
    for (const p of parts) {
      const t0 = performance.now();
      const r = recognize(p.mfd);
      const elapsed = (performance.now() - t0) / 1000;
      results.push({
        name: p.name,
        expected: p.expected,
        elapsed: +elapsed.toFixed(3),
        triangles: r.summary.totalTriangles,
        summary: r.summary,
      });
    }
    return results;
  });

  console.log(`\n=== FEATURE RECOGNITION ===`);
  for (const r of out) {
    console.log(`\n${r.name}  (${r.triangles} tri, ${r.elapsed}s)`);
    console.log(`  expected: ${r.expected}`);
    console.log(`  found:    ${r.summary.planarPatches} planar, ${r.summary.cylindricalPatches} cylindrical, ${r.summary.freeformPatches} freeform`);
    if (r.summary.cylinders.length > 0) {
      console.log(`  cylinders:`);
      for (const c of r.summary.cylinders.slice(0, 12)) {
        console.log(`    Ø${c.diameter.toFixed(2)} × ${c.axialExtent.toFixed(2)} (area ${c.area.toFixed(0)} mm², rms ${c.rms.toFixed(4)})`);
      }
      if (r.summary.cylinders.length > 12) console.log(`    ... + ${r.summary.cylinders.length - 12} more`);
    }
  }

  fs.writeFileSync(path.join(ROOT, 'feature-recognition-report.json'), JSON.stringify(out, null, 2));

  // Validation: phone bracket should detect at least 4 cylindrical patches near Ø4
  const bracket = out.find(r => r.name === 'Phone-Stand Bracket');
  const ø4cyls = bracket.summary.cylinders.filter(c => c.diameter > 3.5 && c.diameter < 4.5);
  console.log(`\nValidation: bracket should show ≥4 Ø4 holes — found ${ø4cyls.length}`);
  expect(ø4cyls.length).toBeGreaterThanOrEqual(4);

  // M6 nut should expose 6 planar patches (hex faces) + at least 1 cylindrical (bore)
  const m6nut = out.find(r => r.name === 'M6 nut');
  expect(m6nut.summary.planarPatches).toBeGreaterThanOrEqual(6);
  expect(m6nut.summary.cylindricalPatches).toBeGreaterThanOrEqual(1);

  // M6 washer should have ≥2 planar (top + bottom faces) and ≥2 cylindrical (OD + ID)
  const m6washer = out.find(r => r.name === 'M6 washer');
  expect(m6washer.summary.planarPatches).toBeGreaterThanOrEqual(2);
  expect(m6washer.summary.cylindricalPatches).toBeGreaterThanOrEqual(2);

  // M6 washer cylindrical patches should match catalog: ID 6.4, OD 12
  const wD = m6washer.summary.cylinders.map(c => c.diameter).sort((a, b) => a - b);
  console.log(`M6 washer cylinders (sorted): ${wD.map(d => d.toFixed(2)).join(', ')}`);
  // Loose: catalog ID is 6.4, OD is 12. Linear-tet polygonal cylinders
  // approximate diameter to the inscribed circle, not the circumscribed,
  // so expect ~6.0-6.4 for ID and ~11.7-12 for OD.
  expect(wD.some(d => d > 5.5 && d < 7)).toBe(true);    // ID
  expect(wD.some(d => d > 11 && d < 13)).toBe(true);    // OD
});
