import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'drawings');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

/**
 * Foundation drawing engine — derive 3-view + iso engineering drawings
 * from manifold geometry for each M8 demonstrator. Output one A3-landscape
 * SVG per part with title block and ASME 3rd-angle projection symbol.
 */
test.describe('Foundation drawings — derived from manifold geometry', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Generate 3-view drawings for all M8 demonstrators', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const { drawings } = await page.evaluate(async () => {
      const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
      const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
      const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
      const { buildPlanetary } = await import('/src/foundation/parts/PlanetaryGearset.js');
      const { buildEnclosureBase, buildEnclosureLid } = await import('/src/foundation/parts/SealedEnclosure.js');
      const { buildDrawingSVG } = await import('/src/foundation/Drawing2D.js');

      const parts = [
        { name: 'Phone-Stand Bracket', material: 'PETG / PLA', file: 'M8-1-phone-bracket', mfd: await buildPhoneStandBracket() },
        { name: 'Bottle Cap M28x2',    material: 'PETG / PLA', file: 'M8-2-bottle-cap',    mfd: await buildBottleCap() },
        { name: 'Bottle Neck M28x2',   material: 'PETG / PLA', file: 'M8-2-bottle-neck',   mfd: await buildBottleNeck() },
        { name: 'Hinge Leaf A',         material: 'PETG / PLA', file: 'M8-3-hinge-leafA',   mfd: await buildLeafA() },
        { name: 'Hinge Leaf B',         material: 'PETG / PLA', file: 'M8-3-hinge-leafB',   mfd: await buildLeafB() },
        { name: 'Hinge Pin Ø5.8',       material: 'PETG / PLA', file: 'M8-3-hinge-pin',     mfd: await buildHingePin() },
      ];
      const planetary = await buildPlanetary();
      parts.push({ name: 'Planetary Sun (Z=12)',    material: 'PETG / PLA', file: 'M8-4-gear-sun',    mfd: planetary.sun });
      parts.push({ name: 'Planetary Planet (Z=18)', material: 'PETG / PLA', file: 'M8-4-gear-planet', mfd: planetary.planet });
      parts.push({ name: 'Planetary Ring (Z=48)',   material: 'PETG / PLA', file: 'M8-4-gear-ring',   mfd: planetary.ring });
      parts.push({ name: 'Sealed Enclosure Base',   material: 'PETG / PLA', file: 'M8-5-enclosure-base', mfd: await buildEnclosureBase() });
      parts.push({ name: 'Sealed Enclosure Lid',    material: 'PETG / PLA', file: 'M8-5-enclosure-lid',  mfd: await buildEnclosureLid() });

      const out = [];
      for (const p of parts) {
        const svg = buildDrawingSVG(p.mfd, { name: p.name, material: p.material, drawnBy: 'ArchDisc Foundation v1' });
        out.push({ file: p.file, svg });
      }
      return { drawings: out };
    });

    expect(drawings.length).toBe(11);
    for (const d of drawings) {
      const filePath = path.join(ROOT, `${d.file}.svg`);
      fs.writeFileSync(filePath, d.svg);
      const size = fs.statSync(filePath).size;
      expect(size).toBeGreaterThan(2000);  // SVG with title block + at least some edges
      console.log(`  ✓ ${d.file}.svg (${size} bytes)`);
    }
  });
});
