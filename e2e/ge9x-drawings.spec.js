import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'drawings');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('GE9X engineering drawings: orthographic + dimensioned sheets', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const sheets = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const {
      PartIDRegistry, DrawingEngine, PrimitiveBuilder,
      LoftSweep, TurbomachineryBlade,
    } = m;

    PartIDRegistry.reset();
    PartIDRegistry.setProject('GE9X');

    const drawings = {};

    // 1. Fan Blade — lofted airfoil
    try {
      const fanSpec = TurbomachineryBlade.fanBlade(0.42, 1.70, 0.220);
      const fanSolid = LoftSweep.loft(fanSpec.profiles, 1);
      fanSolid.name = 'GE9X Fan Blade';
      drawings['fan-blade'] = DrawingEngine.generateSheet(fanSolid, {
        partName: 'GE9X-FAN-BLD-001 Fan Blade',
        drawnBy: 'ArchDisc CAD',
        date: '2026-05-09',
        scale: 200,
        sheetSize: 'A3',
        revisions: [{ rev: '01', ecn: 'INIT', date: '2026-05-09', by: 'AD' }],
      });
    } catch (e) {
      drawings['fan-blade-error'] = e.message;
    }

    // 2. HPT Blade — turbine airfoil
    try {
      const hptSpec = TurbomachineryBlade.turbineBlade(0.18, 0.32, 0.054, 1, 2);
      const hptSolid = LoftSweep.loft(hptSpec.profiles, 1);
      hptSolid.name = 'GE9X HPT Stage 1 Blade';
      drawings['hpt-blade'] = DrawingEngine.generateSheet(hptSolid, {
        partName: 'GE9X-HPT-BLD-001 HPT Stage 1 Blade (CMC)',
        drawnBy: 'ArchDisc CAD',
        date: '2026-05-09',
        scale: 1000,
        sheetSize: 'A3',
      });
    } catch (e) {
      drawings['hpt-blade-error'] = e.message;
    }

    // 3. Fan Disk — solid cylinder
    try {
      const disk = PrimitiveBuilder.cylinder(0.52, 0.22, 96);
      disk.name = 'GE9X Fan Disk';
      drawings['fan-disk'] = DrawingEngine.generateSheet(disk, {
        partName: 'GE9X-FAN-DSK-001 Fan Disk',
        drawnBy: 'ArchDisc CAD',
        date: '2026-05-09',
        scale: 200,
        sheetSize: 'A3',
      });
    } catch (e) {
      drawings['fan-disk-error'] = e.message;
    }

    // 4. Combustor CMC liner
    try {
      const liner = PrimitiveBuilder.cylinder(0.32, 0.40, 64);
      liner.name = 'GE9X Combustor CMC Inner Liner';
      drawings['combustor-liner'] = DrawingEngine.generateSheet(liner, {
        partName: 'GE9X-COMB-LIN-001 CMC Inner Liner',
        drawnBy: 'ArchDisc CAD',
        date: '2026-05-09',
        scale: 500,
        sheetSize: 'A3',
      });
    } catch (e) {
      drawings['combustor-liner-error'] = e.message;
    }

    // 5. Exhaust nozzle
    try {
      const nozzle = PrimitiveBuilder.cylinder(0.55, 0.45, 64);
      nozzle.name = 'GE9X Exhaust Nozzle';
      drawings['exhaust-nozzle'] = DrawingEngine.generateSheet(nozzle, {
        partName: 'GE9X-EXH-NOZ-001 Exhaust Nozzle',
        drawnBy: 'ArchDisc CAD',
        date: '2026-05-09',
        scale: 500,
        sheetSize: 'A3',
      });
    } catch (e) {
      drawings['exhaust-nozzle-error'] = e.message;
    }

    return drawings;
  });

  console.log('\n=== Engineering Drawings ===');
  for (const [name, content] of Object.entries(sheets)) {
    if (name.endsWith('-error')) {
      console.log(`  ✗ ${name}: ${content}`);
      continue;
    }
    const filePath = path.join(OUT, `${name}.svg`);
    fs.writeFileSync(filePath, content);
    console.log(`  ✓ ${name}.svg (${(content.length / 1024).toFixed(1)} KB)`);
  }

  const successful = Object.keys(sheets).filter(k => !k.endsWith('-error'));
  expect(successful.length).toBeGreaterThanOrEqual(3);
});
