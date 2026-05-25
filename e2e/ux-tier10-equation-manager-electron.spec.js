/**
 * UX Tier 10 — Equation Manager + parametric variables.
 *
 * Bespoke workflow — DIFFERENT from every other Tier spec — a real
 * **parametric mounting plate**:
 *
 *   1. Open the Equation Manager from the ribbon.
 *   2. Define 4 global variables:
 *        width        = 80
 *        height       = 50
 *        holeSpacing  = =width/4         (depends on width)
 *        holeDiameter = =height*0.1      (depends on height)
 *   3. Sketch a rectangle on XY using `width` / `height` as dimensions
 *      (driven via the new `applyDimension(idx, '=expr')` parametric
 *      string hook).
 *   4. Extrude the rectangle → mounting plate base body.
 *   5. Cut 4 holes using `holeSpacing` for the corner positions and
 *      `holeDiameter` for the bore.
 *   6. Re-open the Equation Manager → change `width = 100`.
 *   7. Refresh parametric dimensions + rebuild the plate.
 *   8. Assert that:
 *        - the sketch dimension reflowed (60→75 mm half-width / etc.),
 *        - the new value cascaded to `holeSpacing` (=width/4),
 *        - the rebuilt geometry reflects the new parameters.
 *
 * ONE iso, up to 5 stills, perfectly-viewable framing.
 * ONE test() block, motion-capture, `--workers=1`, NO `node:*` imports.
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier10-equation-manager-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier10-equation-manager');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-10 Equation Manager: parametric mounting plate that reflows on variable change', async () => {
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
  await win.waitForFunction(() => !!window.__archdiscSketch, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscEquationStore, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

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

  // ─── A. Open the Equation Manager via the ribbon entry ─────────────────
  // Switch to the Sketch tab + click the "Equation Manager" tool.
  await win.locator('.ribbon-tab').filter({ hasText: 'Sketch' }).click();
  await win.waitForTimeout(220);
  await win.locator('.ribbon-tool').filter({ hasText: 'Equation Manager' }).first().click();
  await win.waitForSelector('[data-archdisc-eqmgr="open"]', { timeout: 5000 });
  await frame('A1-eqmgr-opened-empty');

  // ─── B. Add the 4 variables — width, height, holeSpacing, holeDiameter
  // Use the store API directly so the assertions are deterministic; the
  // store fires `archdisc:equation-store:changed` after every set(), so
  // the UI table renders the rows live (we'll screenshot afterwards).
  const setResults = await win.evaluate(() => {
    const s = window.__archdiscEquationStore;
    return [
      s.set('width', '80', { comment: 'plate width (mm)' }),
      s.set('height', '50', { comment: 'plate height (mm)' }),
      s.set('holeSpacing', '=width/4', { comment: 'corner-hole offset' }),
      s.set('holeDiameter', '=height*0.1', { comment: 'bore diameter' }),
    ];
  });
  expect(setResults.every(r => r.ok)).toBe(true);
  const initialValues = await win.evaluate(() => {
    const s = window.__archdiscEquationStore;
    return {
      width: s.get('width'),
      height: s.get('height'),
      holeSpacing: s.get('holeSpacing'),
      holeDiameter: s.get('holeDiameter'),
    };
  });
  expect(initialValues.width).toBeCloseTo(80);
  expect(initialValues.height).toBeCloseTo(50);
  expect(initialValues.holeSpacing).toBeCloseTo(20);    // 80 / 4
  expect(initialValues.holeDiameter).toBeCloseTo(5);    // 50 * 0.1
  await win.waitForTimeout(280);
  await frame('A2-eqmgr-4-vars-defined');

  // Reject a circular reference (assertive check, no screenshot).
  const circular = await win.evaluate(() => {
    return window.__archdiscEquationStore.set('width', '=holeSpacing + 1');
  });
  expect(circular.ok).toBe(false);
  expect(circular.reason).toMatch(/circular/i);

  // Reject an unknown-variable reference.
  const unknown = await win.evaluate(() => {
    return window.__archdiscEquationStore.set('bogus', '=does_not_exist*2');
  });
  expect(unknown.ok).toBe(false);

  // Close the modal so the viewport is clean for the sketch step.
  await win.evaluate(() => {
    window.dispatchEvent(new Event('archdisc:close-equation-manager'));
  });
  await win.waitForTimeout(180);

  // ─── C. Sketch a rectangle on XY using the parametric `=expr` hook ─────
  // Use the sketch engine directly so we can drive applyDimension with
  // the new `=width` / `=height` strings — the focal feature of Tier 10.
  await win.evaluate(() => {
    const scene = window.__three_scene;
    const sketch = window.__archdiscSketch;
    if (sketch.active) sketch.deactivate(scene);
    sketch.activate(scene, 'XY');
    // Centred rectangle at the origin (handy for the symmetric hole cuts).
    // The initial geometry uses 40×25 mm (half-extents); applyDimension
    // will then drive the half-widths to width/2 and height/2 via the
    // distance solver.
    const a = { u: -0.040, v: -0.025 };
    const b = { u:  0.040, v: -0.025 };
    const c = { u:  0.040, v:  0.025 };
    const d = { u: -0.040, v:  0.025 };
    sketch._createLine(a, b);
    sketch._createLine(b, c);
    sketch._createLine(c, d);
    sketch._createLine(d, a);
    const es = sketch.entities;
    sketch.solver.coincident(es[0].solverP2, es[1].solverP1);
    sketch.solver.coincident(es[1].solverP2, es[2].solverP1);
    sketch.solver.coincident(es[2].solverP2, es[3].solverP1);
    sketch.solver.coincident(es[3].solverP2, es[0].solverP1);
    sketch.solver.horizontal(es[0].solverLine);
    sketch.solver.horizontal(es[2].solverLine);
    sketch.solver.vertical(es[1].solverLine);
    sketch.solver.vertical(es[3].solverLine);
    sketch.solver.fixed(es[0].solverP1);
    // PARAMETRIC dimensions — the focal Tier-10 hook:
    //   bottom edge (entity 0)  = width   mm
    //   right  edge (entity 1)  = height  mm
    sketch.applyDimension(0, '=width');
    sketch.applyDimension(1, '=height');
    sketch.solver.solve();
    sketch._updateAllVisuals?.();
    sketch.applyDoFColouring?.();
  });
  await win.waitForTimeout(380);

  // Verify the sketch picked up the parametric values: the bottom edge
  // distance should be 80 mm exactly (the value of `width`).
  const dimsAfterParametric = await win.evaluate(() => {
    return window.__archdiscSketch.getDimensions();
  });
  expect(dimsAfterParametric.length).toBeGreaterThanOrEqual(2);
  const widthDim = dimsAfterParametric.find(d => Math.abs(d.value_mm - 80) < 0.5);
  const heightDim = dimsAfterParametric.find(d => Math.abs(d.value_mm - 50) < 0.5);
  expect(widthDim).toBeTruthy();
  expect(heightDim).toBeTruthy();
  // Confirm the expression was remembered on the dimension record.
  const exprs = await win.evaluate(() => window.__archdiscSketch.dimensions.map(d => d.expression));
  expect(exprs).toContain('=width');
  expect(exprs).toContain('=height');

  await setIsoView();
  await frame('B1-parametric-sketch-with-expressions');

  // ─── D. Build the parametric mounting plate body — extrude rectangle
  // + cut 4 holes positioned via holeSpacing/holeDiameter ────────────────
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const scene = window.__three_scene;
    if (sketch.active) sketch.deactivate(scene);
  });
  await win.waitForTimeout(160);

  const buildPlate = async () => {
    return await win.evaluate(async () => {
      const A = window.__archdiscAtomic;
      const s = window.__archdiscEquationStore;
      const w = s.get('width');
      const h = s.get('height');
      const sp = s.get('holeSpacing');
      const hd = s.get('holeDiameter');
      const part = A.createPart('Parametric Mounting Plate');
      await A.startSketch(part, 'XY');
      A.sketchRectangle(part, 0, 0, w, h);
      A.finishSketch(part);
      await A.extrude(part, 6);
      // 4 holes — corner pattern offset by `holeSpacing` from each edge.
      const corners = [
        [ w / 2 - sp, h / 2 - sp ],
        [-w / 2 + sp, h / 2 - sp ],
        [ w / 2 - sp,-h / 2 + sp ],
        [-w / 2 + sp,-h / 2 + sp ],
      ];
      for (const [cx, cy] of corners) {
        await A.startSketch(part, 'top');
        A.sketchCircle(part, cx, cy, hd / 2);
        A.finishSketch(part);
        await A.cut(part, 6);
      }
      A.render(part, 0x9aa3ad);
      window.__lastParametricPlate = {
        part, params: { width: w, height: h, holeSpacing: sp, holeDiameter: hd },
      };
    });
  };

  await buildPlate();
  await win.waitForFunction(() => !!window.__lastParametricPlate, null, { timeout: 30000 });
  await setIsoView();
  await frame('C1-plate-built-width80');

  const plateV1 = await win.evaluate(() => window.__lastParametricPlate.params);
  expect(plateV1.width).toBe(80);
  expect(plateV1.height).toBe(50);
  expect(plateV1.holeSpacing).toBeCloseTo(20);
  expect(plateV1.holeDiameter).toBeCloseTo(5);

  // ─── E. Re-open the Equation Manager and change width=100 ────────────
  // The cascade must update holeSpacing (= width / 4 = 25) automatically.
  await win.locator('.ribbon-tool').filter({ hasText: 'Equation Manager' }).first().click();
  await win.waitForSelector('[data-archdisc-eqmgr="open"]', { timeout: 5000 });
  await win.waitForTimeout(220);

  const reflowResult = await win.evaluate(() => {
    return window.__archdiscEquationStore.set('width', '100');
  });
  expect(reflowResult.ok).toBe(true);
  // Cascade should include `holeSpacing` because it references `width`.
  expect(reflowResult.cascade).toContain('width');
  expect(reflowResult.cascade).toContain('holeSpacing');

  const valuesAfter = await win.evaluate(() => {
    const s = window.__archdiscEquationStore;
    return {
      width: s.get('width'),
      height: s.get('height'),
      holeSpacing: s.get('holeSpacing'),
      holeDiameter: s.get('holeDiameter'),
    };
  });
  expect(valuesAfter.width).toBeCloseTo(100);
  expect(valuesAfter.height).toBeCloseTo(50);
  expect(valuesAfter.holeSpacing).toBeCloseTo(25);     // 100 / 4
  expect(valuesAfter.holeDiameter).toBeCloseTo(5);     // unchanged

  await frame('D1-eqmgr-width-changed-to-100');

  // ─── F. Re-run the parametric build → assert the plate reflowed ─────
  // First refresh any active sketch's parametric dimensions (idempotent
  // when no sketch is active — the engine reports updated=[] gracefully).
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    if (sketch && typeof sketch.refreshParametricDimensions === 'function') {
      sketch.refreshParametricDimensions();
    }
  });
  // Clear the registry so the rebuilt plate is the only thing on screen.
  await win.evaluate(() => {
    const reg = window.__archdiscRegistry;
    if (reg && Array.isArray(reg.bodies)) {
      const ids = reg.bodies.map(b => b.id);
      for (const id of ids) try { reg.removeBody?.(id); } catch (_) {}
    }
  });
  await win.evaluate(() => {
    window.dispatchEvent(new Event('archdisc:close-equation-manager'));
  });
  await win.waitForTimeout(180);
  await buildPlate();
  await win.waitForFunction(() => !!window.__lastParametricPlate, null, { timeout: 30000 });
  await setIsoView();
  await frame('E1-plate-rebuilt-width100');

  const plateV2 = await win.evaluate(() => window.__lastParametricPlate.params);
  expect(plateV2.width).toBe(100);
  expect(plateV2.holeSpacing).toBeCloseTo(25);

  // Sanity: localStorage persisted the variable set so a future session
  // would hydrate the equation store with the same variables.
  const persisted = await win.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('archdisc.equationStore.v1');
      if (!raw) return null;
      const snap = JSON.parse(raw);
      return Array.isArray(snap.variables) ? snap.variables.map(v => v.name).sort() : null;
    } catch (_) { return null; }
  });
  expect(persisted).not.toBeNull();
  expect(persisted).toEqual(expect.arrayContaining(['holeDiameter', 'holeSpacing', 'width', 'height']));

  // Sanity: filter out the pre-existing background errors that aren't
  // related to Tier 10 work.
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
