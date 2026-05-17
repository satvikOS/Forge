import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { involute, involuteParamAtRadius, circlePolyline } from '../frontend/src/kernel/atomic/ParametricCurve.js';
import { chainLoops, signedArea, orient } from '../frontend/src/kernel/atomic/SketchProfile.js';

/*
 * Cross-module proof for atomic-CAD L0: compose the geometry primitives
 * (ParametricCurve + SketchProfile) into a real involute gear-tooth profile
 * and a full gear outline — with NO generator function, only atomic curve
 * and profile operations — and render it in a HEADED browser so it is seen.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

/** Rotate an [x,y] point list by `ang` radians about the origin. */
function rotatePts(pts, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

/**
 * Compose ONE closed, CCW involute gear-tooth loop from the L0 primitives:
 * an involute flank, its x-axis mirror, a tip segment and a root segment,
 * chained by SketchProfile.chainLoops.
 */
function buildToothLoop(baseR, tipR, flankSegs = 12) {
  const tEnd = involuteParamAtRadius(baseR, tipR);
  const flankA = involute(baseR, 0, tEnd, flankSegs);
  const flankB = flankA.map(([x, y]) => [x, -y]).reverse();

  // Build segments: flankA forward, tip connector, flankB forward
  // Note: flankB naturally ends at flankA's start, so no explicit root segment needed
  const segs = [];

  // Segments along flankA (forward direction)
  for (let i = 0; i < flankA.length - 1; i++) {
    segs.push([flankA[i], flankA[i + 1]]);
  }

  // Tip segment: from tip of flankA to tip of flankB
  segs.push([flankA[flankA.length - 1], flankB[0]]);

  // Segments along flankB (forward direction in the reversed array)
  for (let i = 0; i < flankB.length - 1; i++) {
    segs.push([flankB[i], flankB[i + 1]]);
  }

  const loops = chainLoops(segs, 1e-6);
  expect(loops.length).toBe(1);
  return orient(loops[0], true);
}

test.describe('atomic-CAD L0 — sculpted gear-tooth profile', () => {
  test('two involute flanks + tip + root chain into one closed CCW tooth loop', () => {
    const baseR = 9.4, tipR = 11.0;
    const tooth = buildToothLoop(baseR, tipR);
    expect(signedArea(tooth)).toBeGreaterThan(0);          // CCW outer boundary
    for (const [x, y] of tooth) {
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThanOrEqual(baseR - 1e-6);
      expect(r).toBeLessThanOrEqual(tipR + 1e-6);
    }
    console.log(`  sculpted tooth loop: ${tooth.length} pts, area ${signedArea(tooth).toFixed(4)} mm^2`);
  });

  test('a full involute gear outline renders in a headed browser', async ({ page }) => {
    const baseR = 9.4, tipR = 11.0, teeth = 18;
    const tooth = buildToothLoop(baseR, tipR);
    const gear = [];
    for (let k = 0; k < teeth; k++) {
      gear.push(rotatePts(tooth, (2 * Math.PI * k) / teeth));
    }
    const baseCircle = circlePolyline(baseR, 96);
    const tipCircle = circlePolyline(tipR, 96);

    fs.mkdirSync(OUT, { recursive: true });
    await page.setContent('<canvas id="c" width="640" height="640"></canvas>'
      + '<style>body{margin:0;background:#0c0e16}</style>');

    const drawn = await page.evaluate(({ gear, baseCircle, tipCircle, teeth, tipR }) => {
      const cv = document.getElementById('c');
      const c = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      c.fillStyle = '#0c0e16'; c.fillRect(0, 0, W, H);
      const s = (W * 0.40) / tipR, ox = W / 2, oy = H / 2;
      const P = ([x, y]) => [ox + x * s, oy - y * s];
      const stroke = (poly, color) => {
        c.strokeStyle = color; c.lineWidth = 1.5; c.beginPath();
        poly.forEach((pt, i) => { const [px, py] = P(pt); i ? c.lineTo(px, py) : c.moveTo(px, py); });
        c.closePath();
        c.stroke();
      };
      stroke(baseCircle, '#3a4250');
      stroke(tipCircle, '#3a4250');
      for (const tooth of gear) stroke(tooth, '#c8c8d0');
      c.fillStyle = '#9aa3ad'; c.font = '14px monospace';
      c.fillText(`atomic-CAD L0 — ${teeth}-tooth involute gear, sculpted from curve primitives`, 14, H - 16);
      return true;
    }, { gear, baseCircle, tipCircle, teeth, tipR });
    expect(drawn).toBe(true);

    await page.waitForTimeout(2500);   // headed pause so the gear is visible
    fs.writeFileSync(path.join(OUT, 'atomic-l0-gear.png'),
      await page.locator('#c').screenshot());
    console.log(`  rendered ${teeth}-tooth gear -> autonomous-output/atomic-l0-gear.png`);
  });
});
