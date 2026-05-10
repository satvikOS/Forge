import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const PKG_ROOT = path.join(REPO_ROOT, 'foundation-output', 'print-package');
const PARTS_ROOT = path.join(PKG_ROOT, 'parts');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(360000);

/**
 * Build a complete self-contained print package: per-part HTML pages
 * with embedded drawings, downloadable STL, spec table; plus a top-level
 * index.html linking to every part.
 *
 * Drop the resulting `print-package/` folder into a hosted location and
 * you have a publishable, fabricator-ready bundle for each demonstrator.
 */
test('Foundation print package: per-part HTML + drawings + STL + index', async ({ page }) => {
  ensure(PARTS_ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
    const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
    const { buildPlanetary } = await import('/src/foundation/parts/PlanetaryGearset.js');
    const { buildEnclosureBase, buildEnclosureLid } = await import('/src/foundation/parts/SealedEnclosure.js');
    const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
    const { buildDrawingSVG } = await import('/src/foundation/Drawing2D.js');
    const { buildPartPackageHTML, buildIndexHTML } = await import('/src/foundation/PrintPackage.js');

    const planetary = await buildPlanetary();

    const partDefs = [
      { basename: 'phone-stand-bracket', name: 'Phone-Stand Bracket', material: 'PETG / PLA',
        spec: { 'Base': '80 × 60 × 4 mm', 'Mount holes': '4 × Ø4', 'Tilt angle': '15°' },
        mfd: await buildPhoneStandBracket() },
      { basename: 'bottle-cap-m28x2', name: 'Bottle Cap M28 × 2', material: 'PETG / PLA',
        spec: { 'Thread': 'M28 × 2', 'OD': '32 mm', 'Height': '18 mm', 'Knurls': '12 axial flutes' },
        mfd: await buildBottleCap() },
      { basename: 'bottle-neck-m28x2', name: 'Bottle Neck M28 × 2', material: 'PETG / PLA',
        spec: { 'Thread': 'M28 × 2', 'Neck OD': '28 mm', 'Shoulder OD': '34 mm', 'Bore': 'Ø22' },
        mfd: await buildBottleNeck() },
      { basename: 'hinge-leaf-A', name: 'Hinge Leaf A (centered knuckle)', material: 'PETG / PLA',
        spec: { 'Plate': '50 × 30 × 4 mm', 'Knuckle': 'Ø10 OD × Ø6 ID × 12 mm tall' },
        mfd: await buildLeafA() },
      { basename: 'hinge-leaf-B', name: 'Hinge Leaf B (split knuckles)', material: 'PETG / PLA',
        spec: { 'Plate': '50 × 30 × 4 mm', 'Knuckles': '2 × (Ø10 OD × Ø6 ID × 8 mm)' },
        mfd: await buildLeafB() },
      { basename: 'hinge-pin', name: 'Hinge Pin Ø5.8', material: 'PETG / PLA',
        spec: { 'OD': 'Ø5.8 mm', 'Length': '30 mm', 'Tips': 'Ø1.5 chamfer (entry-friendly)' },
        mfd: await buildHingePin() },
      { basename: 'gear-sun-z12', name: 'Planetary Sun Gear Z=12', material: 'PETG / PLA',
        spec: { 'Z': 12, 'Module': '1.0 mm', 'PD': '12 mm', 'Bore': 'Ø4', 'Height': '6 mm' },
        mfd: planetary.sun },
      { basename: 'gear-planet-z18', name: 'Planetary Planet Gear Z=18', material: 'PETG / PLA',
        spec: { 'Z': 18, 'Module': '1.0 mm', 'PD': '18 mm', 'Bore': 'Ø3', 'Height': '6 mm' },
        mfd: planetary.planet },
      { basename: 'gear-ring-z48', name: 'Planetary Ring Gear Z=48', material: 'PETG / PLA',
        spec: { 'Z': 48, 'Module': '1.0 mm', 'PD': '48 mm', 'OD': '52 mm', 'Flange bolts': 4, 'Height': '6 mm' },
        mfd: planetary.ring },
      { basename: 'enclosure-base', name: 'Sealed Enclosure Base', material: 'PETG / PLA',
        spec: { 'Outer': '100 × 60 × 25 mm', 'Wall': '3 mm', 'Corner bosses': 'M3 (Ø8 OD)', 'PCB mounts': '4 × Ø2.5', 'Lip': '2 mm' },
        mfd: await buildEnclosureBase() },
      { basename: 'enclosure-lid', name: 'Sealed Enclosure Lid', material: 'PETG / PLA',
        spec: { 'Outer': '100 × 60 × 5 mm', 'Through-holes': '4 × Ø3.2', 'Groove': '1.4 deep × 2 wide' },
        mfd: await buildEnclosureLid() },
    ];

    const enc = (a) => { let b = ''; for (let i = 0; i < a.length; i++) b += String.fromCharCode(a[i]); return btoa(b); };

    const out = [];
    for (const p of partDefs) {
      const report = buildPrintReport(p.mfd);
      const stl = toBinarySTL(p.mfd);
      const svg = buildDrawingSVG(p.mfd, { name: p.name, material: p.material, drawnBy: 'ArchDisc Foundation v1' });
      const html = buildPartPackageHTML({
        name: p.name,
        stlFilename: `${p.basename}.stl`,
        svgFilename: `${p.basename}.svg`,
        report, spec: p.spec,
      });
      out.push({ basename: p.basename, name: p.name, html, svg, stl: enc(stl), report });
    }

    const indexHtml = buildIndexHTML(out, 'ArchDisc Foundation — Demonstrator Print Package');
    return { parts: out, indexHtml };
  });

  for (const p of out.parts) {
    fs.writeFileSync(path.join(PARTS_ROOT, `${p.basename}.html`), p.html);
    fs.writeFileSync(path.join(PARTS_ROOT, `${p.basename}.svg`), p.svg);
    fs.writeFileSync(path.join(PARTS_ROOT, `${p.basename}.stl`), Buffer.from(p.stl, 'base64'));
    console.log(`  ✓ ${p.basename} (HTML + SVG + STL)`);
  }
  fs.writeFileSync(path.join(PKG_ROOT, 'index.html'), out.indexHtml);
  console.log(`  ✓ index.html (${out.parts.length} parts)`);

  expect(out.parts.length).toBe(11);
});
