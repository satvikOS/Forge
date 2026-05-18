import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * The autonomous sculptor, in the real ArchDisc desktop app: revolve a
 * rectangular profile around the axis into a cylindrical sleeve (a turned
 * part) — startSketch -> sketchRectangle -> finishSketch -> revolve. The
 * rectangle sits in the +X half-plane so the revolve sweeps a tube.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps revolves a sleeve in the ArchDisc desktop app', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  const sleeve = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('Sleeve');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 15, 20, 10, 40);   // centre (15,20), w 10, h 40 -> x 10..20, y 0..40
    A.finishSketch(part);
    await A.revolve(part, 96, 360);
    A.render(part);
    return { volume: part.solid.volume(), history: part.describe() };
  });

  // Analytical sleeve volume = pi*(R_out^2 - R_in^2)*height = pi*(400-100)*40 ~= 37699 mm^3
  expect(sleeve.volume).toBeGreaterThan(36000);
  expect(sleeve.volume).toBeLessThan(39000);
  console.log('  ArchDisc desktop app — construction history: ' + sleeve.history);
  console.log('  revolved sleeve volume: ' + sleeve.volume.toFixed(0) + ' mm^3 (analytical ~37699)');
  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-sleeve.png') });

  await app.close();
});
