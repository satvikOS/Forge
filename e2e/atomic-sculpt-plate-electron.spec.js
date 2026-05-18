import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * The autonomous sculptor, in the real ArchDisc desktop app: sculpt a plate,
 * then cut a circular through-hole in it — startSketch -> sketchRectangle ->
 * finishSketch -> extrude, then startSketch -> sketchCircle -> finishSketch ->
 * cut. No premade model, no generator: atomic operations, one updating body.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps sculpts a plate with a through-hole in the ArchDisc desktop app', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // Feature 1: a 80 x 50 x 10 mm plate.
  const plate = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('Drilled-Plate');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 80, 50);
    A.finishSketch(part);
    await A.extrude(part, 10);
    A.render(part);
    return { volume: part.solid.volume() };
  });
  expect(plate.volume).toBeCloseTo(80 * 50 * 10, 0);
  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(OUT, 'electron-plate-step1.png') });

  // Feature 2: cut a circle 20 mm in diameter clean through the 10 mm plate.
  const drilled = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = window.__atomicPart;
    A.startSketch(part, 'XY');
    A.sketchCircle(part, 0, 0, 10);
    A.finishSketch(part);
    await A.cut(part, 12);
    A.render(part);
    return { volume: part.solid.volume(), history: part.describe() };
  });
  expect(drilled.volume).toBeLessThan(plate.volume);
  expect(drilled.volume).toBeGreaterThan(36000);
  expect(drilled.volume).toBeLessThan(37500);
  console.log('  ArchDisc desktop app — construction history: ' + drilled.history);
  console.log('  plate volume: ' + plate.volume.toFixed(0)
    + ' mm^3 -> after cut: ' + drilled.volume.toFixed(0) + ' mm^3');
  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-plate-step2.png') });

  await app.close();
});
