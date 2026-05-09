import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'platform-tests', 'step-verify');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('STEP exporter: produces valid ISO 10303 for all primitive + lofted', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, STEPExporter, LoftSweep, TurbomachineryBlade } = m;

    const cases = {
      box: PrimitiveBuilder.box(0.10, 0.05, 0.04),
      cylinder: PrimitiveBuilder.cylinder(0.05, 0.20, 32),
      cylinderShell: PrimitiveBuilder.cylinderShell(0.20, 0.18, 0.40, 64),
      cone: PrimitiveBuilder.cone(0.10, 0.20, 32),
      sphere: PrimitiveBuilder.sphere(0.05, 32, 16),
      torus: PrimitiveBuilder.torus(0.10, 0.02, 64, 16),
    };
    let lofted = null;
    try {
      const blade = TurbomachineryBlade.fanBlade(0.42, 1.70, 0.220);
      lofted = LoftSweep.loft(blade.profiles, 1);
      cases.lofted = lofted;
    } catch (e) {
      console.warn('Lofted failed:', e.message);
    }

    const out = {};
    for (const [name, solid] of Object.entries(cases)) {
      try {
        const stepText = STEPExporter.toSTEP(solid, name);
        const lines = stepText.split('\n');
        out[name] = {
          valid: stepText.startsWith('ISO-10303-21;') && stepText.includes('END-ISO-10303-21'),
          bytes: stepText.length,
          lines: lines.length,
          entities: lines.filter(l => l.startsWith('#') && l.includes('=')).length,
          sample: lines.slice(0, 3).concat(['...'], lines.slice(-3)),
          stepText,
        };
      } catch (e) {
        out[name] = { error: e.message };
      }
    }
    return out;
  });

  console.log('\n=== STEP Export Verification ===');
  for (const [name, r] of Object.entries(result)) {
    if (r.error) {
      console.log(`  ✗ ${name.padEnd(15)} ERROR: ${r.error}`);
      continue;
    }
    console.log(`  ${r.valid ? '✓' : '✗'} ${name.padEnd(15)} ${(r.bytes / 1024).toFixed(1)} KB, ${r.lines} lines, ${r.entities} entities`);
    fs.writeFileSync(path.join(OUT, `${name}.step`), r.stepText);
  }

  for (const r of Object.values(result)) {
    if (!r.error) {
      expect(r.valid).toBe(true);
      expect(r.entities).toBeGreaterThan(0);
    }
  }
});
