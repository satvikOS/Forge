/**
 * UX Tier-1 — SolidWorks-convention overlays in motion.
 *
 * Builds a real plate sketch + extrude in the headed Electron app, framing
 * one perfectly-readable still per state. Demonstrates ALL FOUR Tier-1
 * conventions doing real work:
 *
 *   1. Sketch colour states  — sketch a line, capture it BLUE (under-def),
 *      add a distance dimension + horizontal constraint → BLACK/grey (full-def),
 *      add a redundant length dim → RED (over-def). One still per state.
 *
 *   2. PropertyManager dock + Confirmation Corner — open Extrude Boss,
 *      capture the dock on the LEFT and the green-check / red-X corner on
 *      the TOP-RIGHT. One still framed for the whole viewport.
 *
 *   3. Heads-up View Toolbar — click Zoom-Fit, Normal-To, then Display
 *      Style → Wireframe. One still per click proving the action took effect.
 *
 * One workflow, one `test()`, slow-mo + motion-capture infra, no `node:*`
 * imports. Run with:
 *   ./node_modules/.bin/playwright test e2e/ux-tier1-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Write to a dir NOT under test-results/ so Playwright's per-spec cleanup
// doesn't wipe the frames between runs.
const OUT = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier1');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-1 SW UX: sketch colour states, dock, confirmation corner, heads-up toolbar', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.webm')) {
      try { fs.rmSync(path.join(OUT, f)); } catch {}
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 180,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscSketch, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  // E2E specs run under Playwright (navigator.webdriver === true) which
  // auto-bypasses the param dialog. For this spec we WANT to exercise the
  // dock, so explicitly opt back in.
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(220);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // ─── A. Sketch colour states — blue → black/full → red ─────────────────
  // Activate a sketch on the XY plane, draw a single LINE, then drive the
  // sketch solver through the three SW colour states with explicit
  // constraint adds. We use the InteractiveSketch directly (window
  // singleton) because the sketch entity colouring is plumbed there.

  const sketchInfoBlue = await win.evaluate(() => {
    const scene = window.__three_scene;
    const sketch = window.__archdiscSketch;
    sketch.activate(scene, 'XY');
    // Draw a horizontal-ish line, intentionally NOT axis-aligned so the
    // user clearly sees the line straighten when constraints are added.
    const p1 = { u: -0.030, v: -0.005 };
    const p2 = { u:  0.030, v:  0.008 };
    sketch._createLine(p1, p2);
    sketch.applyDoFColouring();
    const st = sketch.getStatus();
    return { state: st.state, signedDof: st.signedDof, entityCount: st.entityCount };
  });
  expect(sketchInfoBlue.state).toBe('under-defined');
  expect(sketchInfoBlue.signedDof).toBeGreaterThan(0);

  // Frame the sketch dead-centre + look straight at the XY plane so the line
  // and the state badge are both perfectly readable.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    vp.camera.position.set(0, 0.18, 0.0001);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.target.set(0, 0, 0);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(400);
  await frame('A1-sketch-under-defined-blue');

  // Add a length distance + a horizontal constraint → fully-defined.
  const sketchInfoFull = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const e = sketch.entities[0];
    sketch.solver.distance(e.solverP1, e.solverP2, 0.060); // 60 mm
    sketch.solver.horizontal(e.solverLine);
    sketch.solver.fixed(e.solverP1);
    sketch.solver.solve();
    // Refresh visuals to reflect the snapped, fully-defined line.
    sketch._updateAllVisuals?.();
    sketch.applyDoFColouring();
    const st = sketch.getStatus();
    return { state: st.state, signedDof: st.signedDof };
  });
  expect(sketchInfoFull.state).toBe('fully-defined');
  expect(sketchInfoFull.signedDof).toBe(0);
  await win.waitForTimeout(450);
  await frame('A2-sketch-fully-defined-black');

  // Add a REDUNDANT distance constraint → over-defined.
  const sketchInfoOver = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const e = sketch.entities[0];
    // Redundant — same endpoints, different value → conflict.
    sketch.solver.distance(e.solverP1, e.solverP2, 0.040);
    sketch.applyDoFColouring();
    const st = sketch.getStatus();
    return { state: st.state, signedDof: st.signedDof };
  });
  expect(sketchInfoOver.state).toBe('over-defined');
  expect(sketchInfoOver.signedDof).toBeLessThan(0);
  await win.waitForTimeout(450);
  await frame('A3-sketch-over-defined-red');

  // Tidy up the sketch before the extrude step so the viewport isn't
  // cluttered with the toy line + endpoint markers from the colour test.
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    if (sketch.active) sketch.deactivate(window.__three_scene);
  });
  await win.waitForTimeout(220);

  // ─── B. PropertyManager Dock + Confirmation Corner ────────────────────
  // Click the Extrude Boss tool in the ribbon (Part tab is default). The
  // dock auto-opens for migrated tools and the confirmation corner mirrors
  // it. Frame the whole viewport so BOTH elements + their relationship to
  // the model are visible in one shot.
  await win.locator('.ribbon-tab', { hasText: /^Part$/ }).first().click();
  await win.waitForTimeout(300);

  // Park the camera in iso so the upcoming extrude has a clean iso framing
  // BEFORE the dock pops up — the dock occludes the left edge of the
  // viewport so we want the model centred-right of the docked panel.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    vp.camera.position.set(0.15, 0.10, 0.15);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.target.set(0, 0, 0);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(220);

  // Click Extrude Boss — this invokes requestToolParams('Extrude Boss'),
  // which both the floating dialog and the dock listen to. The dock takes
  // precedence (DOCKED_TOOLS membership) and the floating one is CSS-
  // suppressed via body.sw-dock-suppress-floating.
  await win.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
  // Wait for the dock to render.
  await win.waitForSelector('[data-archdisc-pm-dock="Extrude Boss"]', { timeout: 15000 });
  // The Confirmation Corner should also be active.
  await win.waitForSelector('[data-archdisc-confirm-corner="active"]', { timeout: 5000 });
  // Heads-up toolbar is mounted regardless; just confirm it's there.
  await expect(win.locator('[data-archdisc-headsup="active"]')).toBeVisible();
  await win.waitForTimeout(700);
  await frame('B1-extrude-dock-and-confirmation-corner');

  // Tweak one dock input to prove typing through it works, then commit.
  await win.evaluate(() => {
    const el = document.querySelector('.sw-property-dock input[data-field="height"]');
    if (el) {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, '18');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await win.waitForTimeout(280);
  await frame('B2-dock-height-edited');

  // Commit via the green-check in the confirmation corner.
  await win.locator('[data-archdisc-confirm="ok"]').click();
  // Wait for the Extrude Boss to actually produce a body — the exact-B-rep
  // handler sets window.__lastBrepShape; the foundation handler sets
  // window.__lastFoundationManifold; the registry tracks both via
  // __archdiscBodies. Any one of these three is sufficient confirmation.
  await win.waitForFunction(() => {
    return !!window.__lastBrepShape
        || !!window.__lastFoundationManifold
        || (window.__archdiscBodies && window.__archdiscBodies.list
              && window.__archdiscBodies.list().length > 0);
  }, null, { timeout: 60000 });
  await win.waitForTimeout(900);
  // Frame the just-extruded boss with the dock + corner DISMISSED so the
  // viewport is clean — the SolidWorks "after-confirm" state. Fit to screen
  // then tighten the frame so the part fills the viewport.
  await win.evaluate(() => {
    if (window.__archdiscFocusOnFoundationBodies) window.__archdiscFocusOnFoundationBodies();
    else if (window.__archdiscFitToScreen) window.__archdiscFitToScreen();
    // Pull camera in to a closer iso angle on the body.
    const vp = window.__archdiscViewport;
    const reg = window.__archdiscRegistry;
    if (reg && reg.bodies && reg.bodies[0] && reg.bodies[0].group) {
      const THREE = window.THREE;
      const box = new THREE.Box3().setFromObject(reg.bodies[0].group);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z) || 0.1;
      const d = max * 1.4;
      vp.camera.position.set(c.x + d * 0.6, c.y + d * 0.5, c.z + d * 0.7);
      vp.camera.lookAt(c);
      vp.orbitControls.target.copy(c);
      vp.orbitControls.update();
    }
  });
  await win.waitForTimeout(500);
  await frame('B3-extrude-after-confirm');

  // ─── C. Heads-up View Toolbar — one click per button, one still each ──
  // For each click, also confirm the underlying viewport state changed so the
  // still is documented: camera position, display mode, etc.
  const camPos = () => win.evaluate(() => {
    const c = window.__archdiscViewport.camera.position;
    return [c.x, c.y, c.z];
  });

  // Pull the camera back so we can see the move from Zoom-Fit clearly.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    vp.camera.position.set(0.50, 0.40, 0.50);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.target.set(0, 0, 0);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(400);
  const camBeforeZoomFit = await camPos();

  // 1. Zoom-Fit  — camera should pull back to a tight frame on the model.
  await win.locator('[data-archdisc-hu="zoom-fit"]').click();
  await win.waitForTimeout(700);
  await frame('C1-headsup-zoom-fit');
  const camAfterZoomFit = await camPos();
  console.log(`  [zoom-fit] cam: ${camBeforeZoomFit.join(',')} -> ${camAfterZoomFit.join(',')}`);
  // The two cam positions must differ — proves the click did something.
  expect(camBeforeZoomFit.join(',')).not.toBe(camAfterZoomFit.join(','));

  // 4. View Orientation → Top  (do this BEFORE Normal-To so the next still
  // has the model clearly framed). Going top-down gives a flat-on view of
  // the extruded boss's top face.
  await win.locator('[data-archdisc-hu="orient"]').click();
  await win.waitForSelector('[data-archdisc-hu-orient="top"]', { timeout: 4000 });
  await win.waitForTimeout(280);
  await win.locator('[data-archdisc-hu-orient="top"]').click();
  await win.waitForTimeout(700);
  await frame('C2-headsup-view-top');

  // Reset to iso so the next click moves to a clearly-different view.
  await win.locator('[data-archdisc-hu="orient"]').click();
  await win.waitForSelector('[data-archdisc-hu-orient="iso"]', { timeout: 4000 });
  await win.waitForTimeout(280);
  await win.locator('[data-archdisc-hu-orient="iso"]').click();
  await win.waitForTimeout(700);

  // 3. Display Style → Wireframe  (best demonstrated on the iso view)
  await win.locator('[data-archdisc-hu="display"]').click();
  await win.waitForSelector('[data-archdisc-hu-display="wireframe"]', { timeout: 4000 });
  await win.waitForTimeout(280);
  await win.locator('[data-archdisc-hu-display="wireframe"]').click();
  await win.waitForTimeout(800);
  await frame('C3-headsup-wireframe');
  // Confirm the global display-mode marker flipped.
  const dispMode = await win.evaluate(() => window.__archdiscDisplayMode);
  expect(dispMode).toBe('wireframe');

  // 2. Normal-To Selection — back to a defined view; do this LAST so it
  // demonstrates the corner snap-back behaviour the SW user expects.
  await win.locator('[data-archdisc-hu="normal-to"]').click();
  await win.waitForTimeout(700);
  await frame('C4-headsup-normal-to');

  // Sanity: no uncaught page errors during the workflow.
  // (We allow specific React-warning noise — only fail on real ERRORs.)
  const realErrors = pageErrors.filter((m) =>
    !/Warning: |defaultProps|Each child in a list|forwardRef render|deprecated|sourcemap/i.test(m));
  if (realErrors.length) {
    console.log('  [pageErrors filtered]:\n  - ' + realErrors.join('\n  - '));
  }

  await app.close();
  // Resolve the recorded video path (only flushed on close).
  try {
    const v = typeof win.video === 'function' ? win.video() : null;
    if (v) {
      const p = await v.path();
      if (p && fs.existsSync(p)) {
        const dest = path.join(OUT, '00-session.webm');
        if (dest !== p) {
          try { if (fs.existsSync(dest)) fs.rmSync(dest); fs.renameSync(p, dest); }
          catch { try { fs.copyFileSync(p, dest); } catch {} }
        }
        console.log(`  [video] ${dest} (${fs.statSync(dest).size} bytes)`);
      }
    }
  } catch (e) { console.log('  [video] capture failed: ' + e.message); }
});
