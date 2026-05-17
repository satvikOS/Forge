import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * The autonomous sculptor's first real product: a headed Playwright spec —
 * standing in for the AI — issues a sequence of atomic CAD operations and a
 * real 3-D solid is sculpted, step by step, in the running ArchDisc viewport.
 * No premade model, no generator: startSketch -> sketchRectangle ->
 * finishSketch -> extrude, twice, building an L-bracket.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps sculpts a real solid, step by step, in the ArchDisc viewport', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 30000 });

  // ── Feature 1: sketch a 60x40 rectangle and extrude it 12 mm ──────────────
  const step1 = await page.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('L-Bracket');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 60, 40);
    A.finishSketch(part);
    await A.extrude(part, 12);
    A.render(part);
    return { features: part.featureCount(), volume: part.solid.volume() };
  });
  expect(step1.volume).toBeGreaterThan(0);
  expect(step1.features).toBe(4);                 // start, rect, finish, extrude
  await page.waitForTimeout(2500);                // headed pause — watch it appear
  fs.writeFileSync(path.join(OUT, 'atomic-bracket-step1.png'),
    await page.locator('canvas').first().screenshot());

  // ── Feature 2: a second sketch + extrude unions an upstand -> L-bracket ───
  const step2 = await page.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = window.__atomicPart;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 24, 0, 12, 40);       // flush with the base's right edge
    A.finishSketch(part);
    await A.extrude(part, 40);                    // tall upstand
    A.render(part);
    return { features: part.featureCount(), volume: part.solid.volume(), history: part.describe() };
  });
  expect(step2.volume).toBeGreaterThan(step1.volume);
  expect(step2.features).toBe(8);
  console.log('  sculpted L-bracket — construction history:');
  console.log('  ' + step2.history);
  console.log(`  final volume: ${step2.volume.toFixed(0)} mm^3`);
  await page.waitForTimeout(3000);                // headed pause — watch the final part
  fs.writeFileSync(path.join(OUT, 'atomic-bracket-step2.png'),
    await page.locator('canvas').first().screenshot());
});
