import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { involuteGearProfile } from '../frontend/src/foundation/GearGenerator.js';

/*
 * Involute spur gear — generated from scratch in the platform.
 *
 * No imported model: the tooth flanks are true involutes of the base
 * circle, computed by foundation.involuteGearProfile, and the platform's
 * own feature kernel extrudes the profile into a real 3-D gear.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

/**
 * Count teeth by clustering the points that reach the tip radius. The
 * clusters sit around a full circle, so the tooth count equals the
 * number of angular gaps between them — including the wrap-around gap.
 */
function countTeeth(profile, tipRadius) {
  const angs = [];
  for (const [x, y] of profile) {
    if (Math.hypot(x, y) > tipRadius - 0.05) angs.push(Math.atan2(y, x));
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

test.describe('Involute spur gear — generated from scratch', () => {
  test('involuteGearProfile is mathematically a real involute gear', () => {
    const g = involuteGearProfile({ teeth: 20, module_mm: 2, pressureAngleDeg: 20 });
    // standard gear relations — exact
    expect(g.pitchDiameter_mm).toBeCloseTo(40, 3);            // m·N
    expect(g.addendumDiameter_mm).toBeCloseTo(44, 3);          // pitch + 2m
    expect(g.rootDiameter_mm).toBeCloseTo(35, 2);              // pitch − 2.5m
    expect(g.baseDiameter_mm).toBeCloseTo(40 * Math.cos(20 * Math.PI / 180), 2);
    expect(g.circularPitch_mm).toBeCloseTo(Math.PI * 2, 3);
    // every profile point lies between the root and addendum circles
    const rootR = g.rootDiameter_mm / 2, tipR = g.addendumDiameter_mm / 2;
    for (const [x, y] of g.profile) {
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThanOrEqual(rootR - 0.05);
      expect(r).toBeLessThanOrEqual(tipR + 0.05);
    }
    // the profile genuinely has 20 teeth
    expect(countTeeth(g.profile, tipR)).toBe(20);
    console.log(`\n  20-tooth m2 gear: pitch Ø${g.pitchDiameter_mm}, base Ø${g.baseDiameter_mm}, `
      + `${g.profile.length}-point involute profile, ${countTeeth(g.profile, tipR)} teeth verified`);
  });

  test('a low-tooth-count pinion (watch-style) is still valid', () => {
    const p = involuteGearProfile({ teeth: 8, module_mm: 0.3, pressureAngleDeg: 20 });
    expect(p.pitchDiameter_mm).toBeCloseTo(2.4, 3);
    expect(countTeeth(p.profile, p.addendumDiameter_mm / 2)).toBe(8);
  });

  test('the platform builds a real 3-D gear from the involute profile', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Spur Gear'] = {
        teeth: 24, module_mm: 2, pressureAngleDeg: 20, faceWidth_mm: 8,
      };
    });
    await page.locator('.ribbon-tool-label', { hasText: /^Spur Gear$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastGearSpec, null, { timeout: 30000 });

    const spec = await page.evaluate(() => window.__lastGearSpec);
    console.log(`\n  built: ${spec.teeth}-tooth gear, pitch Ø${spec.pitchDiameter_mm} mm, `
      + `V = ${spec.volume_mm3.toFixed(0)} mm³`);
    expect(spec.teeth).toBe(24);
    expect(spec.pitchDiameter_mm).toBeCloseTo(48, 3);
    // the real solid: volume between the root cylinder and the tip cylinder
    const fw = spec.faceWidth_mm;
    const vRoot = Math.PI * (spec.rootDiameter_mm / 2) ** 2 * fw;
    const vTip = Math.PI * (spec.addendumDiameter_mm / 2) ** 2 * fw;
    const vBore = Math.PI * (spec.boreDiameter_mm / 2) ** 2 * fw;
    expect(spec.volume_mm3).toBeGreaterThan(vRoot - vBore - 1);
    expect(spec.volume_mm3).toBeLessThan(vTip - vBore + 1);

    // draw the actual generated tooth profile — the definitive proof
    const profileJpeg = await page.evaluate(() => {
      const g = window.__lastGearSpec;
      const W = 520, H = 520, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = '#0c0e16'; c.fillRect(0, 0, W, H);
      const R = g.addendumDiameter_mm / 2;
      const s = (W * 0.42) / R, ox = W / 2, oy = H / 2;
      const draw = (poly, stroke) => {
        c.strokeStyle = stroke; c.lineWidth = 2; c.beginPath();
        poly.forEach(([x, y], i) => {
          const px = ox + x * s, py = oy - y * s;
          if (i) c.lineTo(px, py); else c.moveTo(px, py);
        });
        c.closePath(); c.stroke();
      };
      draw(g.profile, '#7fb0e0');
      if (g.borePolygon) draw(g.borePolygon, '#e0a060');
      c.fillStyle = '#9ab'; c.font = '13px monospace';
      c.fillText(`involute spur gear — ${g.teeth} teeth, module ${g.module_mm} mm`, 12, H - 14);
      return cv.toDataURL('image/jpeg', 0.9);
    });
    fs.writeFileSync(path.join(OUT, 'spur-gear-profile.jpg'),
      Buffer.from(profileJpeg.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'spur-gear-3d.png'),
      await page.locator('canvas').first().screenshot());
    console.log('  rendered: spur-gear-profile.jpg + spur-gear-3d.png');
  });
});
