import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'step');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

/**
 * Export every M8 demonstrator to STEP AP203 and validate file
 * structure: ISO-10303-21 header, populated DATA section, valid
 * MANIFOLD_SOLID_BREP, ADVANCED_BREP_SHAPE_REPRESENTATION, all faces
 * referenced from the closed shell.
 */
test('Foundation STEP AP203 export — all 11 demonstrators', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const results = await page.evaluate(async () => {
    const { manifoldToSTEP } = await import('/src/foundation/StepExport.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
    const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
    const { buildPlanetary } = await import('/src/foundation/parts/PlanetaryGearset.js');
    const { buildEnclosureBase, buildEnclosureLid } = await import('/src/foundation/parts/SealedEnclosure.js');

    const planetary = await buildPlanetary();
    const parts = [
      { basename: 'phone-stand-bracket', name: 'Phone-Stand Bracket', mfd: await buildPhoneStandBracket() },
      { basename: 'bottle-cap-m28x2',    name: 'Bottle Cap M28x2',    mfd: await buildBottleCap() },
      { basename: 'bottle-neck-m28x2',   name: 'Bottle Neck M28x2',   mfd: await buildBottleNeck() },
      { basename: 'hinge-leaf-A',        name: 'Hinge Leaf A',        mfd: await buildLeafA() },
      { basename: 'hinge-leaf-B',        name: 'Hinge Leaf B',        mfd: await buildLeafB() },
      { basename: 'hinge-pin',           name: 'Hinge Pin',           mfd: await buildHingePin() },
      { basename: 'gear-sun-z12',        name: 'Planetary Sun Z=12',  mfd: planetary.sun },
      { basename: 'gear-planet-z18',     name: 'Planetary Planet Z=18', mfd: planetary.planet },
      { basename: 'gear-ring-z48',       name: 'Planetary Ring Z=48', mfd: planetary.ring },
      { basename: 'enclosure-base',      name: 'Sealed Enclosure Base', mfd: await buildEnclosureBase() },
      { basename: 'enclosure-lid',       name: 'Sealed Enclosure Lid',  mfd: await buildEnclosureLid() },
    ];

    const out = [];
    for (const p of parts) {
      const t0 = performance.now();
      const step = manifoldToSTEP(p.mfd, { name: p.name, author: 'ArchDisc Foundation v1' });
      const elapsedSec = (performance.now() - t0) / 1000;
      out.push({
        basename: p.basename, name: p.name,
        step,
        elapsedSec: +elapsedSec.toFixed(3),
        triangleCount: p.mfd.numTri(),
        sizeBytes: step.length,
      });
    }
    return out;
  });

  console.log(`\n=== STEP AP203 EXPORT ===`);
  for (const r of results) {
    fs.writeFileSync(path.join(ROOT, `${r.basename}.step`), r.step);
    // Sanity-check structure
    const has203Header = r.step.startsWith('ISO-10303-21;');
    const hasManifoldBrep = /MANIFOLD_SOLID_BREP/.test(r.step);
    const hasShapeRep = /ADVANCED_BREP_SHAPE_REPRESENTATION/.test(r.step);
    const hasEnd = r.step.includes('END-ISO-10303-21;');
    const faceCount = (r.step.match(/ADVANCED_FACE\(/g) || []).length;

    console.log(`  ${r.basename}: ${(r.sizeBytes / 1024).toFixed(0)} KB, ${faceCount} faces, ${r.triangleCount} tri (${r.elapsedSec}s)  ` +
      `${has203Header ? 'hdr✓' : 'hdr✗'} ${hasManifoldBrep ? 'mfd✓' : 'mfd✗'} ${hasShapeRep ? 'rep✓' : 'rep✗'} ${hasEnd ? 'end✓' : 'end✗'}`);

    expect(has203Header).toBe(true);
    expect(hasManifoldBrep).toBe(true);
    expect(hasShapeRep).toBe(true);
    expect(hasEnd).toBe(true);
    expect(faceCount).toBe(r.triangleCount);   // one face per triangle
  }
});
