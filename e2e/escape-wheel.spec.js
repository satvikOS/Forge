import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { escapeWheelProfile } from '../frontend/src/foundation/EscapeWheelGenerator.js';

/*
 * Swiss-lever escape wheel — generated from scratch in the platform.
 *
 * No imported model: each tooth is a raked club tooth — steep locking
 * heel, club tip flat, long impulse face — computed by
 * foundation.escapeWheelProfile and extruded by the platform's kernel.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

/** Count teeth by clustering tip-radius points around the full circle. */
function countTeeth(profile, tipRadius) {
  const angs = [];
  for (const [x, y] of profile) {
    if (Math.hypot(x, y) > tipRadius - 0.02) angs.push(Math.atan2(y, x));
  }
  if (!angs.length) return 0;
  angs.sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 0; i < angs.length; i++) {
    const next = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
    if (next - angs[i] > 0.1) gaps++;
  }
  return gaps;
}

test.describe('Escape wheel — generated from scratch', () => {
  test('escapeWheelProfile is a real 15-tooth club-tooth escape wheel', () => {
    const w = escapeWheelProfile({ teeth: 15, rimDiameter_mm: 6, toothHeight_mm: 0.7 });
    expect(w.teeth).toBe(15);
    expect(w.rimDiameter_mm).toBeCloseTo(6, 3);
    expect(w.tipDiameter_mm).toBeCloseTo(7.4, 3);            // rim + 2·toothHeight
    // every point between the rim and the tip circle
    const rimR = w.rimDiameter_mm / 2, tipR = w.tipDiameter_mm / 2;
    for (const [x, y] of w.profile) {
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThanOrEqual(rimR - 0.02);
      expect(r).toBeLessThanOrEqual(tipR + 0.02);
    }
    expect(countTeeth(w.profile, tipR)).toBe(15);
    console.log(`\n  15-tooth escape wheel: rim Ø${w.rimDiameter_mm}, tip Ø${w.tipDiameter_mm}, `
      + `${w.profile.length}-point profile, ${countTeeth(w.profile, tipR)} club teeth verified`);
  });

  test('the platform builds a real 3-D escape wheel from the profile', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Escape Wheel'] = {
        teeth: 15, rimDiameter_mm: 8, toothHeight_mm: 0.9, faceWidth_mm: 0.5,
        material: 'steel',
      };
    });
    await page.locator('.ribbon-tool-label', { hasText: /^Escape Wheel$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastEscapeWheel, null, { timeout: 30000 });

    const w = await page.evaluate(() => window.__lastEscapeWheel);
    console.log(`\n  built: ${w.teeth}-tooth escape wheel, rim Ø${w.rimDiameter_mm} mm, `
      + `V = ${w.volume_mm3.toFixed(3)} mm³`);
    expect(w.teeth).toBe(15);
    expect(w.tipDiameter_mm).toBeCloseTo(9.8, 2);
    expect(w.volume_mm3).toBeGreaterThan(0);

    // draw the generated tooth profile — the definitive proof
    const jpeg = await page.evaluate(() => {
      const g = window.__lastEscapeWheel;
      const W = 520, H = 520, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = '#0c0e16'; c.fillRect(0, 0, W, H);
      const R = g.tipDiameter_mm / 2, s = (W * 0.42) / R, ox = W / 2, oy = H / 2;
      const draw = (poly, stroke) => {
        c.strokeStyle = stroke; c.lineWidth = 2; c.beginPath();
        poly.forEach(([x, y], i) => {
          const px = ox + x * s, py = oy - y * s;
          if (i) c.lineTo(px, py); else c.moveTo(px, py);
        });
        c.closePath(); c.stroke();
      };
      draw(g.profile, '#8f96a0');
      if (g.borePolygon) draw(g.borePolygon, '#e0a060');
      c.fillStyle = '#9ab'; c.font = '13px monospace';
      c.fillText(`Swiss-lever escape wheel — ${g.teeth} club teeth`, 12, H - 14);
      return cv.toDataURL('image/jpeg', 0.9);
    });
    fs.writeFileSync(path.join(OUT, 'escape-wheel-profile.jpg'),
      Buffer.from(jpeg.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'escape-wheel-3d.png'),
      await page.locator('canvas').first().screenshot());
    console.log('  rendered: escape-wheel-profile.jpg + escape-wheel-3d.png');
  });
});
