/**
 * UX Tier 11d — Boolean-inside-Extrude (NX-unified Extrude consolidation).
 *
 * Tier 11d collapses ArchDisc's previously-separate `Extrude Boss` +
 * `Extrude Cut` ribbon entries into ONE NX-style `Extrude` tool with a
 * Boolean enum at the top of its PropertyManagerDock dialog
 * (`none` / `unite` / `subtract` / `intersect`). The kernel ops themselves
 * are unchanged — Tier-11d is a pure UX consolidation that dispatches to
 * the existing foundation `Mod.Manifold.extrude` + the manifold-3d
 * boolean ops (`union` / `difference` / `intersection`) based on the
 * picked boolean mode.
 *
 * Bespoke workflow — DIFFERENT bespoke from every other Tier — a real
 * **flanged mounting bracket** built end-to-end via the unified Extrude
 * tool, exercising all 3 non-trivial boolean modes in sequence:
 *
 *   A. Extrude `boolean='none'`  — base plate 100 × 60 × 8 mm (new body).
 *   B. Extrude `boolean='unite'` — raised boss 40 × 40 × 15 mm fused on
 *      top of the base plate (offset by posZ = 8 mm so the boss sits ON
 *      the plate, not embedded).
 *   C. Extrude `boolean='subtract'` — Ø12 mm mounting hole drilled
 *      straight through both base + boss (rectangular 12 × 12 mm pocket
 *      profile centred on origin, distance 40 mm — through-cut through
 *      the entire 23-mm stack).
 *
 * ONE iso framing held through stages A → C. 4 stills + a session video.
 * Motion-capture, `--workers=1`, NO `node:*` imports. Real consolidation
 * showing the single `Extrude` tool driving all 3 boolean cases via the
 * planParam-slot path (the same one-shot override the AI plan executor
 * uses).
 *
 * Run:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier11d-extrude-boolean-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier11d-extrude-boolean');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-11d unified Extrude: flanged mounting bracket (none → unite → subtract)', async () => {
  test.setTimeout(300000);
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
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(280);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // Hold the SAME iso framing through every stage so the consolidation
  // reads as one continuous mounting-bracket build — base → boss → hole.
  const setBracketIso = async () => {
    await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      // 200-mm camera radius centred on the bracket origin — sized so the
      // 100×60 base plate, the 40×40×15 boss on top, AND the Ø12 hole all
      // read clearly without re-framing per stage.
      const r = 0.20;
      vp.camera.position.set(r * 0.78, r * 0.62, r * 0.78);
      vp.camera.lookAt(0, 0.008, 0);   // a hair above origin (centre of stack)
      vp.camera.up.set(0, 1, 0);
      vp.orbitControls.target.set(0, 0.008, 0);
      vp.orbitControls.update();
    });
    await win.waitForTimeout(240);
  };

  // Helper: click the unified `Extrude` ribbon entry by EXACT label
  // match (so we don't pick up "Extrude Boss", "Extrude Cut", or
  // "Extruded Surface"). Returns once the click has dispatched.
  const clickExtrude = async () => {
    await win.locator('.ribbon-tab', { hasText: /^Part$/ }).first().click();
    await win.waitForTimeout(300);
    const labels = win.locator('.ribbon-tool-label');
    const n = await labels.count();
    for (let i = 0; i < n; i += 1) {
      const txt = (await labels.nth(i).textContent() || '').trim();
      if (txt === 'Extrude') {
        await labels.nth(i).locator('xpath=..').click();
        return;
      }
    }
    throw new Error('Tier-11d: unified "Extrude" ribbon entry not found');
  };

  // ─── A. boolean='none' — base plate 100×60×8 mm ───────────────────────
  // First Extrude → no target body → boolean=none → fresh body. Note we
  // pass `__explicitNone: true` so the auto-detect logic doesn't flip
  // even on a re-run (there's no target on the first call anyway).
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Extrude'] = {
      boolean: 'none',
      __explicitNone: true,
      width: 100, depth: 60, distance: 8,
      dirX: 0, dirY: 0, dirZ: 1,
      draft: 0,
      posX: 0, posY: 0, posZ: 0,
    };
  });
  await clickExtrude();
  // Expected V = 100 × 60 × 8 = 48000 mm³.
  await win.waitForFunction(() => {
    const m = window.__lastFoundationManifold;
    if (!m) return false;
    const v = m.volume();
    return v > 46000 && v < 50000;
  }, null, { timeout: 30000 });
  await setBracketIso();
  await frame('A-base-plate-extrude-none');

  const stageA = await win.evaluate(() => {
    const m = window.__lastFoundationManifold;
    const bb = m.boundingBox();
    return {
      volume: m.volume(),
      bbox: { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] },
    };
  });
  console.log(`  [stage A] base plate V = ${stageA.volume.toFixed(0)} mm³ (expected ~48000 = 100·60·8)`);
  console.log(`  [stage A] bbox: [${stageA.bbox.min.map(x => x.toFixed(1))}] → [${stageA.bbox.max.map(x => x.toFixed(1))}]`);
  expect(stageA.volume).toBeGreaterThan(46000);
  expect(stageA.volume).toBeLessThan(50000);
  // 100×60×8 prism centred on XY origin, sitting on z=0 .. z=8.
  expect(stageA.bbox.max[0] - stageA.bbox.min[0]).toBeGreaterThan(98);
  expect(stageA.bbox.max[0] - stageA.bbox.min[0]).toBeLessThan(102);
  expect(stageA.bbox.max[1] - stageA.bbox.min[1]).toBeGreaterThan(58);
  expect(stageA.bbox.max[1] - stageA.bbox.min[1]).toBeLessThan(62);
  expect(stageA.bbox.max[2] - stageA.bbox.min[2]).toBeGreaterThan(7.5);
  expect(stageA.bbox.max[2] - stageA.bbox.min[2]).toBeLessThan(8.5);
  const baseVolume = stageA.volume;

  // ─── B. boolean='unite' — raised boss 40×40×15 mm on top of plate ─────
  // posZ=8 lifts the 15-mm prism so its base sits ON the plate top (z=8),
  // top face at z=23. Unite fuses it with the base plate. Expected V =
  // base + boss = 48000 + 40·40·15 = 48000 + 24000 = 72000 mm³.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Extrude'] = {
      boolean: 'unite',
      width: 40, depth: 40, distance: 15,
      dirX: 0, dirY: 0, dirZ: 1,
      draft: 0,
      posX: 0, posY: 0, posZ: 8,    // sit boss on top of the 8-mm-thick plate
    };
  });
  await clickExtrude();
  // Expected V = 48000 + 24000 = 72000 mm³.
  await win.waitForFunction(() => {
    const m = window.__lastFoundationManifold;
    if (!m) return false;
    const v = m.volume();
    return v > 70000 && v < 74000;
  }, null, { timeout: 30000 });
  await setBracketIso();
  await frame('B-raised-boss-extrude-unite');

  const stageB = await win.evaluate(() => {
    const m = window.__lastFoundationManifold;
    const bb = m.boundingBox();
    return {
      volume: m.volume(),
      bbox: { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] },
    };
  });
  console.log(`  [stage B] base + boss V = ${stageB.volume.toFixed(0)} mm³ (expected ~72000 = 48000 + 40·40·15)`);
  console.log(`  [stage B] bbox: [${stageB.bbox.min.map(x => x.toFixed(1))}] → [${stageB.bbox.max.map(x => x.toFixed(1))}]`);
  expect(stageB.volume).toBeGreaterThan(70000);
  expect(stageB.volume).toBeLessThan(74000);
  // Boss raises the Z bbox from 8 → 23 mm; X/Y stay at the base's extent.
  expect(stageB.bbox.max[2]).toBeGreaterThan(22);
  expect(stageB.bbox.max[2]).toBeLessThan(24);
  expect(stageB.bbox.max[0] - stageB.bbox.min[0]).toBeGreaterThan(98);
  expect(stageB.bbox.max[1] - stageB.bbox.min[1]).toBeGreaterThan(58);
  // Volume jump exactly the boss volume (within manifold quantisation).
  expect(stageB.volume - baseVolume).toBeGreaterThan(23500);
  expect(stageB.volume - baseVolume).toBeLessThan(24500);
  const stackVolume = stageB.volume;

  // ─── C. boolean='subtract' — Ø12 mm mounting hole through the stack ───
  // The unified Extrude uses a rectangular profile by default; for the
  // mounting hole we pass an explicit `profile` (12-segment circular
  // polygon approximating a Ø12 circle) so the cut is a real round hole.
  // posZ=-2 sets the tool's base just below the plate so the through-cut
  // exits cleanly; distance=30 over-shoots the 23-mm-tall stack so the
  // hole runs all the way through.
  await win.evaluate(() => {
    const segs = 64;
    const r = 6;            // Ø12 mm hole
    const profile = [];
    for (let i = 0; i < segs; i += 1) {
      const t = (i * 2 * Math.PI) / segs;
      profile.push([r * Math.cos(t), r * Math.sin(t), 0]);
    }
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Extrude'] = {
      boolean: 'subtract',
      profile,
      distance: 30,                                  // through-cut, 23-mm stack + slack
      dirX: 0, dirY: 0, dirZ: 1,
      draft: 0,
      posX: 0, posY: 0, posZ: -2,                    // start tool below plate bottom
    };
  });
  await clickExtrude();
  // Expected hole volume = π · 6² · 23 ≈ 2601 mm³ (boss is 15 mm tall on
  // an 8-mm plate; total stack thickness = 23 mm; the tool exits cleanly).
  // Final V ≈ 72000 − 2601 ≈ 69399 mm³.
  await win.waitForFunction(() => {
    const m = window.__lastFoundationManifold;
    if (!m) return false;
    const v = m.volume();
    return v > 68500 && v < 70500;
  }, null, { timeout: 30000 });
  await setBracketIso();
  await frame('C-mounting-hole-extrude-subtract');

  const stageC = await win.evaluate(() => {
    const m = window.__lastFoundationManifold;
    const bb = m.boundingBox();
    return {
      volume: m.volume(),
      bbox: { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] },
    };
  });
  const holeVolume = stackVolume - stageC.volume;
  const holeExpected = Math.PI * 6 * 6 * 23;        // ≈ 2601 mm³
  console.log(`  [stage C] bracket V = ${stageC.volume.toFixed(0)} mm³ (expected ~69400 = 72000 − ~2601)`);
  console.log(`  [stage C] hole removed = ${holeVolume.toFixed(0)} mm³ (analytical π·6²·23 = ${holeExpected.toFixed(0)})`);
  console.log(`  [stage C] bbox: [${stageC.bbox.min.map(x => x.toFixed(1))}] → [${stageC.bbox.max.map(x => x.toFixed(1))}]`);
  // Subtract removed approx the analytical cylinder volume (within ~3%
  // for the 64-seg polygonal approximation of the circle).
  expect(holeVolume).toBeGreaterThan(holeExpected * 0.95);
  expect(holeVolume).toBeLessThan(holeExpected * 1.05);
  // Outer bbox unchanged by the hole (the hole is fully interior to XY).
  expect(stageC.bbox.max[0] - stageC.bbox.min[0]).toBeGreaterThan(98);
  expect(stageC.bbox.max[1] - stageC.bbox.min[1]).toBeGreaterThan(58);
  expect(stageC.bbox.max[2]).toBeGreaterThan(22);
  expect(stageC.bbox.max[2]).toBeLessThan(24);

  // ─── D. Summary still — same iso framing, final bracket ───────────────
  await frame('D-summary-flanged-mounting-bracket');

  // Sanity: filter benign console noise.
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
