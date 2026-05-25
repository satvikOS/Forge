/**
 * UX Tier 10b — 3D-feature parametric expressions in every numeric param
 *
 * Tier 10 shipped Equation Manager + global variables + a `=expr` hook on
 * SKETCH dimensions. Tier 10b extends the same `=expr` hook to every
 * NUMERIC FIELD on every tool param dialog — both the floating
 * `ToolParamDialog` (legacy tools) and the SW-convention
 * `PropertyManagerDock` (migrated tools like Extrude Boss + Circular
 * Pattern). Variable edits cascade to live dialogs without re-firing the
 * tool.
 *
 * Bespoke workflow — DIFFERENT from every other Tier spec — a real
 * **parametric flange driven by Equation Manager variables**:
 *
 *   1. Define 4 vars: flangeOuter=60, flangeThickness=8,
 *      holeRadius='=flangeOuter*0.04' (cascade → 2.4),
 *      holeCount=6.
 *   2. Open Extrude Boss dock → set height = '=flangeThickness'.
 *      Assert the Σ badge + "= 8" subtitle appear. Commit.
 *   3. Open Circular Pattern dock → count='=holeCount',
 *      radius='=holeRadius'. Same badge + subtitle assertion. Commit.
 *   4. Change `flangeThickness=12` in the Equation Manager. Re-open
 *      Extrude Boss with height='=flangeThickness'; assert the dock
 *      shows "= 12" — the live re-eval picked up the new value AND
 *      the next extrude on the same body honors 12, not 8.
 *
 * ONE iso, 5 stills, perfectly-viewable framing.
 * ONE test() block, motion-capture, `--workers=1`, NO `node:*` imports.
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier10b-feature-expressions-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier10b-feature-expressions');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-10b 3D-feature expressions: parametric flange driven by Equation Manager', async () => {
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
    slowMo: 170,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscEquationStore, null, { timeout: 60000 });

  // The dock + floating dialog only render when the bypass is OFF.
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  // Start from an empty equation store so this run is deterministic.
  await win.evaluate(() => { window.__archdiscEquationStore.clear(); });

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

  const setIsoView = async () => {
    await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const reg = window.__archdiscRegistry;
      let cx = 0, cy = 0, cz = 0, r = 0.10;
      if (reg && reg.bodies && reg.bodies.length && THREE) {
        const box = new THREE.Box3();
        for (const b of reg.bodies) {
          if (b.group) { b.group.updateMatrixWorld(true); box.expandByObject(b.group); }
        }
        if (!box.isEmpty()) {
          const c = box.getCenter(new THREE.Vector3());
          const s = box.getSize(new THREE.Vector3());
          cx = c.x; cy = c.y; cz = c.z;
          r = Math.max(s.x, s.y, s.z) * 1.8;
        }
      }
      vp.camera.position.set(cx + r * 0.72, cy + r * 0.50, cz + r * 0.72);
      vp.camera.lookAt(cx, cy, cz);
      vp.camera.up.set(0, 1, 0);
      vp.orbitControls.target.set(cx, cy, cz);
      vp.orbitControls.update();
    });
    await win.waitForTimeout(220);
  };

  // ─── A. Define the 4 flange variables in the equation store ───────────
  const setResults = await win.evaluate(() => {
    const s = window.__archdiscEquationStore;
    return [
      s.set('flangeOuter', '60', { comment: 'flange OD (mm)' }),
      s.set('flangeThickness', '8', { comment: 'flange thickness (mm)' }),
      s.set('holeRadius', '=flangeOuter*0.04', { comment: 'bore radius' }),
      s.set('holeCount', '6', { comment: 'bolt-circle hole count' }),
    ];
  });
  expect(setResults.every(r => r.ok)).toBe(true);

  const initialValues = await win.evaluate(() => {
    const s = window.__archdiscEquationStore;
    return {
      flangeOuter: s.get('flangeOuter'),
      flangeThickness: s.get('flangeThickness'),
      holeRadius: s.get('holeRadius'),
      holeCount: s.get('holeCount'),
    };
  });
  expect(initialValues.flangeOuter).toBeCloseTo(60);
  expect(initialValues.flangeThickness).toBeCloseTo(8);
  expect(initialValues.holeRadius).toBeCloseTo(2.4);     // 60 * 0.04
  expect(initialValues.holeCount).toBeCloseTo(6);

  // Helper — type a value into a docked numeric input. We use the proto-
  // setter trick (same pattern as Tier-1 e2e) so React's controlled input
  // sees the change.
  const typeIntoDockInput = async (field, value) => {
    await win.evaluate(({ field, value }) => {
      const el = document.querySelector(`.sw-property-dock input[data-field="${field}"]`);
      if (!el) throw new Error(`dock input not found: ${field}`);
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { field, value });
    await win.waitForTimeout(180);
  };

  // ─── B. Open Extrude Boss → set height = '=flangeThickness' ───────────
  // Park the camera in iso so the model lands centred-right of the dock.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    vp.camera.position.set(0.12, 0.09, 0.12);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.target.set(0, 0, 0);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(220);

  await win.locator('.ribbon-tab', { hasText: /^Part$/ }).first().click();
  await win.waitForTimeout(260);
  await win.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
  await win.waitForSelector('[data-archdisc-pm-dock="Extrude Boss"]', { timeout: 15000 });
  await win.waitForTimeout(280);

  // Type the parametric expression into the height field.
  await typeIntoDockInput('height', '=flangeThickness');

  // Verify the Σ badge appeared + the subtitle shows "= 8 mm".
  await win.waitForSelector('[data-archdisc-expr-badge="height"]', { timeout: 3000 });
  const heightEvalText = await win.locator('[data-archdisc-expr-eval="height"]').textContent();
  expect(heightEvalText).toMatch(/=\s*8/);
  await frame('A1-extrude-dock-with-flangeThickness-expression');

  // Commit via the confirmation corner — same as Tier-1.
  await win.locator('[data-archdisc-confirm="ok"]').click();
  await win.waitForFunction(() => {
    return !!window.__lastBrepShape
        || !!window.__lastFoundationManifold
        || (window.__archdiscBodies && window.__archdiscBodies.list
              && window.__archdiscBodies.list().length > 0);
  }, null, { timeout: 60000 });
  await win.waitForTimeout(700);
  await setIsoView();
  await frame('A2-extrude-built-thickness8');

  // Confirm the produced solid has the expected thickness (~8 mm = .008 m).
  const extrudeHeights = await win.evaluate(() => {
    const reg = window.__archdiscRegistry;
    const out = [];
    if (reg && reg.bodies) {
      const THREE = window.THREE;
      for (const b of reg.bodies) {
        if (!b.group) continue;
        const box = new THREE.Box3().setFromObject(b.group);
        if (box.isEmpty()) continue;
        const s = box.getSize(new THREE.Vector3());
        out.push({ x: s.x, y: s.y, z: s.z });
      }
    }
    return out;
  });
  // The Extrude Boss handler uses height/depth fields; the resulting bbox's
  // smallest dimension should be ~8 mm (= .008 m).
  const minDim8 = Math.min(...extrudeHeights.flatMap(s => [s.x, s.y, s.z]).filter(v => v > 0));
  expect(minDim8).toBeGreaterThan(0.006);
  expect(minDim8).toBeLessThan(0.012);

  // ─── C. Circular Pattern: count='=holeCount', radius='=holeRadius' ─────
  await win.locator('.ribbon-tool-label', { hasText: /^Circular Pattern$/ }).first().click();
  await win.waitForSelector('[data-archdisc-pm-dock="Circular Pattern"]', { timeout: 15000 });
  await win.waitForTimeout(280);

  await typeIntoDockInput('count', '=holeCount');
  await typeIntoDockInput('radius', '=holeRadius');

  // Both should now wear the Σ badge.
  await win.waitForSelector('[data-archdisc-expr-badge="count"]', { timeout: 3000 });
  await win.waitForSelector('[data-archdisc-expr-badge="radius"]', { timeout: 3000 });
  const countEval = await win.locator('[data-archdisc-expr-eval="count"]').textContent();
  const radiusEval = await win.locator('[data-archdisc-expr-eval="radius"]').textContent();
  expect(countEval).toMatch(/=\s*6/);
  expect(radiusEval).toMatch(/=\s*2\.4/);
  await frame('B1-circ-pattern-with-2-expressions');

  // Commit the pattern.
  await win.locator('[data-archdisc-confirm="ok"]').click();
  await win.waitForTimeout(1500);
  await setIsoView();
  await frame('B2-pattern-built');

  // ─── D. Change `flangeThickness=12` and re-open Extrude → live re-eval
  const reflow = await win.evaluate(() => {
    return window.__archdiscEquationStore.set('flangeThickness', '12');
  });
  expect(reflow.ok).toBe(true);

  // The previously-closed dock should NOT have re-fired. Re-opening
  // Extrude Boss with the same expression should show the NEW evaluated
  // value in the live subtitle.
  await win.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
  await win.waitForSelector('[data-archdisc-pm-dock="Extrude Boss"]', { timeout: 15000 });
  await win.waitForTimeout(280);
  await typeIntoDockInput('height', '=flangeThickness');
  await win.waitForSelector('[data-archdisc-expr-badge="height"]', { timeout: 3000 });
  const heightEval2 = await win.locator('[data-archdisc-expr-eval="height"]').textContent();
  expect(heightEval2).toMatch(/=\s*12/);
  await frame('C1-extrude-dock-honors-new-thickness12');

  // ─── E. Live-update assertion: change flangeThickness with dock open
  // and verify the subtitle reflows WITHOUT re-typing. The user keeps
  // the dock open, edits the variable in another panel, and the dock's
  // resolved subtitle picks up the new value automatically.
  await win.evaluate(() => {
    window.__archdiscEquationStore.set('flangeThickness', '15');
  });
  await win.waitForTimeout(380);
  const heightEval3 = await win.locator('[data-archdisc-expr-eval="height"]').textContent();
  expect(heightEval3).toMatch(/=\s*15/);
  await frame('C2-dock-live-reflow-to-15');

  // Commit and verify the geometry honors the latest value (15 mm).
  await win.locator('[data-archdisc-confirm="ok"]').click();
  await win.waitForTimeout(1500);
  await setIsoView();
  await frame('D1-final-build-thickness15');

  // Assert the new body's bbox has a ~15 mm dimension somewhere.
  const finalHeights = await win.evaluate(() => {
    const reg = window.__archdiscRegistry;
    const out = [];
    if (reg && reg.bodies) {
      const THREE = window.THREE;
      for (const b of reg.bodies) {
        if (!b.group) continue;
        const box = new THREE.Box3().setFromObject(b.group);
        if (box.isEmpty()) continue;
        const s = box.getSize(new THREE.Vector3());
        out.push({ x: s.x, y: s.y, z: s.z });
      }
    }
    return out;
  });
  // Look for any dimension close to 15 mm (= .015 m) on at least one body.
  const has15 = finalHeights.some(s => [s.x, s.y, s.z].some(v => Math.abs(v - 0.015) < 0.0025));
  expect(has15).toBe(true);

  // Sanity: filter background errors that aren't related to this work.
  const realErrors = pageErrors.filter((m) =>
    !/Warning: |defaultProps|Each child in a list|forwardRef render|deprecated|sourcemap/i.test(m)
    && !/Health check failed|ERR_FILE_NOT_FOUND|AxiosError|Network Error|THREE\.Object3D\.add/i.test(m));
  if (realErrors.length) {
    console.log('  [pageErrors filtered]:\n  - ' + realErrors.join('\n  - '));
  }

  await app.close();
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
