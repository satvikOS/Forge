import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fourbar');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('4-bar linkage: Grashof crank-rocker sweep + coupler curve + collision', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { FourBarLinkage, renderFourBarSweep } = await import('/src/foundation/FourBarLinkage.js');

    // Classic Grashof crank-rocker (shortest = crank, sum of shortest +
    // longest < sum of others)
    const linkage = new FourBarLinkage({
      crank: 30, coupler: 80, rocker: 70, ground: 100, branch: 'upper',
    });
    // Shortest = 30 (crank), Longest = 100 (ground)
    // Sum: 30 + 100 = 130 < 80 + 70 = 150 ✓ Grashof crank-rocker
    const grashof = linkage.grashofType();

    const result = renderFourBarSweep(linkage, {
      N: 60,
      couplerPoint: [40, 30],   // (a, b) — 40 mm along BC, 30 mm perpendicular
      obstacles: [
        { cx: 50, cy: 70, r: 10 },    // upper region — coupler curve passes near
      ],
    });

    // Also report a non-Grashof (rocker-rocker) example
    const nonGrashof = new FourBarLinkage({
      crank: 30, coupler: 30, rocker: 30, ground: 100,
    });
    return {
      grashof,
      collisionFreeFrames: result.collisionFreeFrames,
      totalFrames: result.frames.length,
      validFrames: result.frames.filter(f => f.pose !== null).length,
      couplerCurveSamples: result.couplerCurve.length,
      svg: result.svg,
      nonGrashofType: nonGrashof.grashofType(),
      collisions: result.collisions.filter(c => c.hits.length > 0).map(c => ({
        thetaDeg: +(c.theta * 180 / Math.PI).toFixed(1),
        hits: c.hits,
      })),
    };
  });

  console.log(`\n=== 4-BAR LINKAGE ===`);
  console.log(`Grashof type:           ${out.grashof}`);
  console.log(`Non-Grashof example:    ${out.nonGrashofType}`);
  console.log(`Sweep frames:           ${out.totalFrames} (valid: ${out.validFrames}, collision-free: ${out.collisionFreeFrames})`);
  console.log(`Coupler-curve samples:  ${out.couplerCurveSamples}`);
  if (out.collisions.length > 0) {
    console.log(`Collision frames:`);
    for (const c of out.collisions.slice(0, 8)) {
      console.log(`  θ ≈ ${c.thetaDeg}° → hit ${c.hits.map(h => h.link).join(', ')}`);
    }
    if (out.collisions.length > 8) console.log(`  ... + ${out.collisions.length - 8} more`);
  }

  fs.writeFileSync(path.join(ROOT, 'fourbar-sweep.svg'), out.svg);
  fs.writeFileSync(path.join(ROOT, 'fourbar-sweep.json'), JSON.stringify({
    grashof: out.grashof,
    nonGrashof: out.nonGrashofType,
    totalFrames: out.totalFrames,
    validFrames: out.validFrames,
    collisionFreeFrames: out.collisionFreeFrames,
    collisions: out.collisions,
  }, null, 2));

  expect(out.grashof).toBe('crank-rocker');
  expect(out.nonGrashofType).toBe('rocker-rocker');
  // All frames should be valid (the linkage is Grashof — full crank rotation)
  expect(out.validFrames).toBe(out.totalFrames);
});
