import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), 'engine-output', 'Trent1000');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('Trent 1000: build complete engine using Trent1000Builder', async ({ page }) => {
  ensure(OUTPUT);
  ensure(path.join(OUTPUT, 'analysis'));
  ensure(path.join(OUTPUT, 'bom'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  TRENT 1000 — HIGH FIDELITY BUILD');
  console.log('========================================\n');

  const result = await page.evaluate(async () => {
    const t0 = performance.now();
    const builderMod = await import('/src/engines/Trent1000Builder.js');
    const Trent1000Builder = builderMod.default;

    const sections = [];
    const trent = Trent1000Builder.build({
      onProgress: (name, added, total) => {
        sections.push({ name, added, total });
      },
    });

    const elapsed = (performance.now() - t0) / 1000;

    // Generate BOM
    const bom = trent.generateBOM();

    return {
      totalParts: trent.partCount(),
      buildTimeSec: elapsed.toFixed(3),
      sections,
      bomEntries: bom.length,
      bomTop: bom.slice(0, 30),
      totalMassKg: trent.totalMass().toFixed(2),
    };
  });

  // Print section log
  console.log(`Total components: ${result.totalParts.toLocaleString()}`);
  console.log(`Build time: ${result.buildTimeSec} seconds`);
  console.log(`Total mass: ${result.totalMassKg} kg`);
  console.log(`BOM unique entries: ${result.bomEntries}\n`);
  console.log('Section breakdown:');
  for (const sec of result.sections) {
    console.log(`  ${sec.name.padEnd(30)} ${sec.added.toString().padStart(6)} components (running ${sec.total.toLocaleString()})`);
  }

  // Save outputs
  fs.writeFileSync(path.join(OUTPUT, 'build-summary.json'),
    JSON.stringify({
      engine: 'Rolls-Royce Trent 1000',
      totalComponents: result.totalParts,
      buildTimeSec: parseFloat(result.buildTimeSec),
      totalMassKg: parseFloat(result.totalMassKg),
      bomEntries: result.bomEntries,
      sections: result.sections,
      buildDate: new Date().toISOString(),
      builderVersion: 'Trent1000Builder v2',
      kernelVersion: '1.21.0',
    }, null, 2));

  fs.writeFileSync(path.join(OUTPUT, 'bom', 'top-30-by-quantity.json'),
    JSON.stringify(result.bomTop, null, 2));

  expect(result.totalParts).toBeGreaterThan(15000);
});
