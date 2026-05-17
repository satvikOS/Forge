import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { balanceWheelProfile } from '../frontend/src/foundation/BalanceWheelGenerator.js';

/*
 * Balance wheel — generated from scratch in the platform.
 *
 * No imported model: an annular rim carried by N arms from a central hub,
 * the open sectors between the arms as cut-outs, a staff bore — computed
 * by foundation.balanceWheelProfile and extruded by the platform kernel.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test.describe('Balance wheel — generated from scratch', () => {
  test('balanceWheelProfile is a real rim + arms + hub balance wheel', () => {
    const b = balanceWheelProfile({
      rimDiameter_mm: 10, rimWidth_mm: 0.9, arms: 2, hubDiameter_mm: 2.4,
    });
    expect(b.rimDiameter_mm).toBeCloseTo(10, 3);
    expect(b.rimInnerDiameter_mm).toBeCloseTo(8.2, 2);       // 10 − 2·0.9
    expect(b.arms).toBe(2);
    // 2 arm-gap holes + 1 bore hole
    expect(b.holes.length).toBe(3);
    // outer profile points all on the rim outer circle
    for (const [x, y] of b.profile) {
      expect(Math.hypot(x, y)).toBeCloseTo(5, 1);
    }
    console.log(`\n  balance wheel: rim Ø${b.rimDiameter_mm}, ${b.arms} arms, `
      + `hub Ø${b.hubDiameter_mm}, ${b.holes.length} cut-outs (incl. bore)`);
  });

  test('a 3-arm balance wheel is valid', () => {
    const b = balanceWheelProfile({ rimDiameter_mm: 12, arms: 3 });
    expect(b.arms).toBe(3);
    expect(b.holes.length).toBe(4);                          // 3 gaps + bore
  });

  test('the platform builds a real 3-D balance wheel', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Balance Wheel'] = {
        rimDiameter_mm: 11, rimWidth_mm: 1.0, arms: 2, armWidth_mm: 1.0,
        hubDiameter_mm: 2.6, boreDiameter_mm: 0.7, faceWidth_mm: 1.0, material: 'brass',
      };
    });
    await page.locator('.ribbon-tool-label', { hasText: /^Balance Wheel$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastBalanceWheel, null, { timeout: 30000 });

    const b = await page.evaluate(() => window.__lastBalanceWheel);
    console.log(`\n  built: balance wheel rim Ø${b.rimDiameter_mm} mm, ${b.arms} arms, `
      + `V = ${b.volume_mm3.toFixed(2)} mm³`);
    expect(b.rimDiameter_mm).toBeCloseTo(11, 3);
    expect(b.arms).toBe(2);
    expect(b.volume_mm3).toBeGreaterThan(0);

    const jpeg = await page.evaluate(() => {
      const g = window.__lastBalanceWheel;
      const W = 520, H = 520, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = '#0c0e16'; c.fillRect(0, 0, W, H);
      const R = g.rimDiameter_mm / 2, s = (W * 0.42) / R, ox = W / 2, oy = H / 2;
      const draw = (poly, stroke) => {
        c.strokeStyle = stroke; c.lineWidth = 2; c.beginPath();
        poly.forEach(([x, y], i) => {
          const px = ox + x * s, py = oy - y * s;
          if (i) c.lineTo(px, py); else c.moveTo(px, py);
        });
        c.closePath(); c.stroke();
      };
      draw(g.profile, '#c8a93f');
      for (const h of g.holes) draw(h, '#6a7079');
      c.fillStyle = '#9ab'; c.font = '13px monospace';
      c.fillText(`balance wheel — ${g.arms} arms, rim Ø${g.rimDiameter_mm} mm`, 12, H - 14);
      return cv.toDataURL('image/jpeg', 0.9);
    });
    fs.writeFileSync(path.join(OUT, 'balance-wheel-profile.jpg'),
      Buffer.from(jpeg.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'balance-wheel-3d.png'),
      await page.locator('canvas').first().screenshot());
    console.log('  rendered: balance-wheel-profile.jpg + balance-wheel-3d.png');
  });
});
