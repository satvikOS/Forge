import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), 'engine-output', 'GE9X');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X: complete engine build with platform features', async ({ page }) => {
  ensure(OUTPUT);
  ensure(path.join(OUTPUT, 'analysis'));
  ensure(path.join(OUTPUT, 'bom'));
  ensure(path.join(OUTPUT, 'tests'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  GE AVIATION GE9X — BUILD');
  console.log('========================================\n');

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry, InteractionRecorder } = m;
    const GE9XBuilder = builderMod.default;
    const { GE9X_SPECS } = builderMod;

    PartIDRegistry.reset();
    InteractionRecorder.reset();
    InteractionRecorder.start({ project: 'GE9X', user: 'satvik' });

    const t0 = performance.now();
    const sections = [];
    const ge9x = GE9XBuilder.build({
      onProgress: (name, added, total) => {
        sections.push({ name, added, total });
      },
    });
    const buildTimeSec = (performance.now() - t0) / 1000;

    const stats = PartIDRegistry.stats();
    const bom = ge9x.generateBOM();

    InteractionRecorder.stop();

    return {
      totalParts: ge9x.partCount(),
      totalRegistered: PartIDRegistry.size(),
      buildTimeSec: +buildTimeSec.toFixed(3),
      sections,
      stats,
      bomEntries: bom.length,
      bomTop20: bom.slice(0, 20),
      specs: GE9X_SPECS,
      totalMassKg: ge9x.totalMass().toFixed(1),
    };
  });

  console.log(`Total components: ${result.totalParts.toLocaleString()}`);
  console.log(`Total registered: ${result.totalRegistered.toLocaleString()}`);
  console.log(`Build time: ${result.buildTimeSec}s`);
  console.log(`Total mass: ${result.totalMassKg} kg (spec: ${result.specs.totalMassKg} kg)`);
  console.log(`BOM unique entries: ${result.bomEntries}`);
  console.log('\nCategory breakdown:');
  for (const [cat, count] of Object.entries(result.stats.byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(8)} ${count.toLocaleString().padStart(7)} components`);
  }
  console.log('\nSection log:');
  for (const sec of result.sections) {
    console.log(`  ${sec.name.padEnd(28)} +${sec.added.toString().padStart(6)} → ${sec.total.toLocaleString()}`);
  }

  fs.writeFileSync(path.join(OUTPUT, 'build-summary.json'),
    JSON.stringify({
      engine: 'GE Aviation GE9X-105B1A',
      generated: new Date().toISOString(),
      totalComponents: result.totalParts,
      totalRegistered: result.totalRegistered,
      buildTimeSec: result.buildTimeSec,
      totalMassKg: parseFloat(result.totalMassKg),
      sections: result.sections,
      stats: result.stats,
      specs: result.specs,
      bomEntries: result.bomEntries,
    }, null, 2));

  fs.writeFileSync(path.join(OUTPUT, 'bom', 'top-20-by-quantity.json'),
    JSON.stringify(result.bomTop20, null, 2));

  expect(result.totalParts).toBeGreaterThan(20000);
  expect(result.totalRegistered).toBe(result.totalParts);
});
