import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-35 — Routing (NX/Creo Routing-class). HEADED on the Mac Electron
 * shell so you can watch the bends apply in real time. Drives the
 * real "Sculpt Route" ribbon tool four times with progressively richer
 * waypoint sets — sharp polyline → single-bend elbow → three-bend
 * harness → 90° corner pushed past its leg headroom so the radius
 * clamp surfaces. Every invocation lands a real foundation body in the
 * registry and a route report on window.__lastRouteReport.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-route');
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  {
    label: '01-sharp',
    color: 0xff6b6b,                                          // tomato — sharp polyline
    note: 'sharp polyline (bendR=0)',
    params: {
      diameter: 24, bendR: 0,
      x1:   0, y1: 50, z1: 0,
      x2: 400, y2: 50, z2: 0,
      x3: 400, y3: 50, z3: 400,
      x4: 800, y4: 50, z4: 400,
      arcSamples: 16,
    },
  },
  {
    label: '02-elbow',
    color: 0x4ecdc4,                                          // teal — single tangent arc
    note: 'single 90° elbow honoured',
    params: {
      diameter: 24, bendR: 120,
      x1:   0, y1: 250, z1: 0,
      x2: 600, y2: 250, z2: 0,
      x3: 600, y3: 250, z3: 600,
      x4: 600, y4: 250, z4: 600,                              // collapse W4 onto W3 → 1 corner
      arcSamples: 24,
    },
  },
  {
    label: '03-harness',
    color: 0xc6a86b,                                          // brass — two-bend harness
    note: 'two 90° bends honoured (axis-aligned U-shape)',
    params: {
      diameter: 22, bendR: 90,
      x1:   0, y1: 450, z1:   0,
      x2: 500, y2: 450, z2:   0,
      x3: 500, y3: 450, z3: 500,
      x4: 950, y4: 450, z4: 500,
      arcSamples: 20,
    },
  },
  {
    label: '04-clamped',
    color: 0xffd166,                                          // amber — clamp surfaces
    note: 'requested R clamped to fit leg headroom',
    params: {
      diameter: 18, bendR: 600,                               // legs only 200 mm long → clamp
      x1:   0, y1: 650, z1: 0,
      x2: 200, y2: 650, z2: 0,
      x3: 200, y3: 650, z3: 200,
      x4: 400, y4: 650, z4: 200,
      arcSamples: 16,
    },
  },
];

test.describe.configure({ timeout: 8 * 60 * 1000 });

test('Sculpt Route — headed Electron, bends honoured + radius clamp surfaces', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  // Bypass the param dialog — params come in via __archdiscPlanParams.
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');

  // Frame the camera so the whole harness stack is visible.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(2.2, 1.6, 2.4);
    vp.orbitControls.target.set(0.5, 0.45, 0.4);
    vp.camera.lookAt(0.5, 0.45, 0.4);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];

  for (const route of ROUTES) {
    // Stash the per-route params; the dialog bypass consumes them.
    await win.evaluate((r) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Route'] = r.params;
    }, route);
    // Dispatch the real ribbon tool — same path the user clicks.
    await win.locator('[data-ribbon-tool-name="Sculpt Route"]').first().dispatchEvent('click');
    // Wait for a fresh route report to land for THIS invocation.
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastRouteReport;
        return !!r && r.diameter === expected.diameter && r.bendR === expected.bendR;
      },
      { diameter: route.params.diameter, bendR: route.params.bendR },
      { timeout: 30000 }
    );
    const report = await win.evaluate(() => window.__lastRouteReport);
    reports.push({ ...route, report });
    console.log(`[Sculpt Route] ${route.label} (${route.note}):`,
      JSON.stringify({
        diameter: report.diameter, bendR: report.bendR,
        centerlineLength: +report.centerlineLength.toFixed(2),
        straightLength: +report.straightLength.toFixed(2),
        saved: +report.saved.toFixed(2),
        bends: report.bends.map(b => ({
          turnDeg: +b.turnDeg.toFixed(2), requestedR: b.requestedR,
          achievedR: +b.achievedR.toFixed(2), clamped: b.clamped,
          arcLength: +b.arcLength.toFixed(2), kept: b.kept,
        })),
      }, null, 0));
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `${route.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [sharp, elbow, harness, clamped] = reports.map(r => r.report);

  // 1. The sharp polyline is honoured but NO arcs were added.
  expect(sharp.bends.filter(b => b.arcLength > 0).length).toBe(0);
  expect(sharp.saved).toBeLessThan(1);                        // ≈ straight = centerline
  expect(sharp.centerlineLength).toBeCloseTo(sharp.straightLength, 1);

  // 2. The single-elbow case rounds exactly one 90° corner at R=120.
  const elbowKept = elbow.bends.filter(b => b.arcLength > 0);
  expect(elbowKept.length).toBe(1);
  expect(elbowKept[0].turnDeg).toBeCloseTo(90, 0);
  expect(elbowKept[0].achievedR).toBeCloseTo(120, 0);
  expect(elbowKept[0].clamped).toBe(false);
  // Arc length = R · γ for γ=π/2 → 120·π/2 ≈ 188.50.
  expect(elbowKept[0].arcLength).toBeCloseTo(120 * Math.PI / 2, 0);
  // Centerline shorter than the straight polyline by 2T − Rγ = 2·120 − 188.50 ≈ 51.5 mm.
  expect(elbow.saved).toBeGreaterThan(45);
  expect(elbow.saved).toBeLessThan(60);

  // 3. The two-bend harness honours both 90° corners (axis-aligned U-shape).
  const harnessKept = harness.bends.filter(b => b.arcLength > 0);
  expect(harnessKept.length).toBe(2);
  for (const b of harnessKept) {
    expect(b.turnDeg).toBeCloseTo(90, 0);
    expect(b.achievedR).toBeCloseTo(90, 0);
    expect(b.clamped).toBe(false);
  }

  // 4. The clamped case: requested R=600 on 200 mm legs → radius clamped.
  const clampedBends = clamped.bends.filter(b => b.arcLength > 0);
  expect(clampedBends.length).toBeGreaterThanOrEqual(1);
  for (const b of clampedBends) {
    expect(b.clamped).toBe(true);
    expect(b.achievedR).toBeLessThan(600);
    expect(b.achievedR).toBeGreaterThan(0);
  }

  // 5. Every invocation actually rendered a body in the foundation registry.
  const bodies = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodies).toBeGreaterThanOrEqual(ROUTES.length);

  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
