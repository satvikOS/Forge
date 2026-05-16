import { test, expect } from '@playwright/test';
import { PlanarMechanism } from '../frontend/src/foundation/KinematicsCore.js';
import { runMotionStudy } from '../frontend/src/foundation/MotionStudy.js';
import {
  motionFilmstripSVG, motionAnimatedSVG, countAnimatedFrames,
} from '../frontend/src/foundation/MotionRender.js';

function sliderCrankStudy() {
  const r = 40, l = 120;
  const mech = new PlanarMechanism({
    links: [{ name: 'ground' }, { name: 'crank' }, { name: 'conrod' }, { name: 'slider' }],
    joints: [
      { type: 'revolute', linkA: 0, linkB: 1, pA: [0, 0], pB: [0, 0] },
      { type: 'revolute', linkA: 1, linkB: 2, pA: [r, 0], pB: [0, 0] },
      { type: 'revolute', linkA: 2, linkB: 3, pA: [l, 0], pB: [0, 0] },
      { type: 'prismatic', linkA: 0, linkB: 3, pA: [0, 0], pB: [0, 0], axisAngle: 0, perpOffset: 0 },
    ],
    drivers: [{ jointIndex: 0, fn: (t) => 2 * Math.PI * t }],
  });
  mech._q = [0, 0, 0, r, 0, 0, r + l, 0, 0];
  const linkSegments = [
    [], [[[0, 0], [r, 0]]], [[[0, 0], [l, 0]]],
    [[[-16, -12], [16, -12]], [[16, -12], [16, 12]], [[16, 12], [-16, 12]], [[-16, 12], [-16, -12]]],
  ];
  return { study: runMotionStudy(mech, { t0: 0, t1: 1, frames: 60, linkSegments }), linkSegments };
}

test.describe('Motion render — verifiable animation artifacts', () => {
  test.describe.configure({ timeout: 120000 });

  test('Animated SVG embeds every motion frame and the motion is present', () => {
    const { study, linkSegments } = sliderCrankStudy();
    const svg = motionAnimatedSVG(study.frames, linkSegments, { durationSec: 3 });
    // Every frame is embedded as a SMIL keyframe.
    expect(countAnimatedFrames(svg)).toBe(60);
    expect(svg).toContain('<animate attributeName="points"');
    expect(svg).toContain('repeatCount="indefinite"');
    // The motion is genuinely in the artifact: the slider link's
    // polyline differs between the first and a later keyframe.
    const sliderAnimate = svg.split('<animate').pop();
    const values = sliderAnimate.match(/values="([^"]+)"/)[1].split(';');
    expect(values.length).toBe(60);
    expect(values[0]).not.toBe(values[30]);     // the piston moved
  });

  test('Filmstrip SVG renders one panel per sampled frame', () => {
    const { study, linkSegments } = sliderCrankStudy();
    const svg = motionFilmstripSVG(study.frames, linkSegments, { count: 8 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // 8 panels → 8 frame-time labels.
    expect((svg.match(/>t=/g) || []).length).toBe(8);
    // Each panel draws the moving links as polylines.
    expect((svg.match(/<polyline/g) || []).length).toBeGreaterThanOrEqual(8 * 3);
  });

  test('Motion Study ribbon emits a verifiable animated-SVG artifact', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator('.ribbon-tab', { hasText: 'Assembly' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Motion Study$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastMotionStudy, null, { timeout: 20000 });

    const r = await page.evaluate(() => ({
      animatedSVGFrames: window.__lastMotionStudy.animatedSVGFrames,
      svgLen: window.__lastMotionStudy.animatedSVG.length,
      hasAnimate: window.__lastMotionStudy.animatedSVG.includes('<animate'),
      hasFilmstrip: window.__lastMotionStudy.filmstripSVG.includes('<svg'),
    }));
    console.log(`\nMotion artifact: ${r.animatedSVGFrames} frames, animated SVG ${r.svgLen} chars`);
    expect(r.animatedSVGFrames).toBe(120);
    expect(r.hasAnimate).toBe(true);
    expect(r.hasFilmstrip).toBe(true);
  });

  test('Live viewport animation actually renders motion (screenshot regression)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator('.ribbon-tab', { hasText: 'Assembly' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Motion Study$/ }).first().click();
    await page.waitForFunction(() => !!window.__archdiscAnimRAF, null, { timeout: 20000 });

    // Capture the viewport at two distinct animation times. If the
    // mechanism is genuinely animating, the rendered pixels differ.
    const canvas = page.locator('canvas').first();
    const shotA = await canvas.screenshot();
    await page.waitForTimeout(900);
    const shotB = await canvas.screenshot();
    const identical = Buffer.compare(shotA, shotB) === 0;
    console.log(`\nViewport screenshots ${shotA.length}/${shotB.length} bytes — identical=${identical}`);
    expect(identical).toBe(false);     // the platform self-verifies its render moved
  });
});
