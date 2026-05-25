/**
 * UX Tier 11c — NX unified Pattern Feature (single tool, layout selector).
 *
 * Tier 11c collapses ArchDisc's previously-separate `Linear Pattern` +
 * `Circular Pattern` ribbon entries into one NX-style `Pattern` tool with
 * a layout-enum at the top of its PropertyManagerDock dialog (linear /
 * circular / polygon; sketchDriven + reference queued). The kernel ops
 * themselves are unchanged — Tier-11c is a pure UX consolidation that
 * dispatches to `foundation.linearPattern` / `foundation.circularPattern`
 * by layout, and synthesises `polygon` as N seed copies on a circle of
 * `polygonRadius` at equal angular increments.
 *
 * Bespoke workflow — DIFFERENT bespoke from every other Tier — a real
 * **machined bolt-flange** built end-to-end via the unified Pattern tool:
 *
 *   A. Base flange disk — atomic build (Ø80 × 8 mm) + render.
 *   B. unified Pattern, layout='circular', count=8, radius=30, angle=360.
 *      → bolt-circle of 8 cylindrical bolt-hole seeds around +Z.
 *   C. unified Pattern, layout='linear', count=3, spacing=90, dirX=1,
 *      useCurrentBody=true. → 3 instances of the bolt-circle in a row
 *      along +X (the "flange-in-a-row" deliverable).
 *
 * ONE iso framing, 3-4 stills, perfectly-viewable framing. Motion-capture,
 * `--workers=1`, NO `node:*` imports. Real parametric tooling — no
 * hand-built bodies, no kernel-handler shortcut: every pattern is driven
 * by clicking the ribbon `Pattern` button after staging the per-step
 * params via `__archdiscPlanParams['Pattern']` (the same single-shot
 * override slot the AI plan executor uses).
 *
 * Run:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier11c-unified-pattern-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier11c-unified-pattern');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-11c unified Pattern Feature: machined bolt-flange (circular ×8, then linear ×3)', async () => {
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
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  // For this spec we DRIVE the unified Pattern dialog through the plan-
  // params slot (one-shot override per requestToolParams call). Leave
  // the bypass at its automated default — the planParam slot is read
  // FIRST in requestToolParams so this is the cleanest "no dock click"
  // path, exactly what an AI plan step does.

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

  const setIso = async () => {
    await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const reg = window.__archdiscRegistry;
      let cx = 0, cy = 0, cz = 0, r = 0.12;
      if (reg && reg.bodies && reg.bodies.length && THREE) {
        const box = new THREE.Box3();
        for (const b of reg.bodies) {
          if (b.group) { b.group.updateMatrixWorld(true); box.expandByObject(b.group); }
        }
        if (!box.isEmpty()) {
          const c = box.getCenter(new THREE.Vector3());
          const s = box.getSize(new THREE.Vector3());
          cx = c.x; cy = c.y; cz = c.z;
          r = Math.max(s.x, s.y, s.z) * 1.6 + 0.04;
        }
      }
      vp.camera.position.set(cx + r * 0.72, cy + r * 0.58, cz + r * 0.72);
      vp.camera.lookAt(cx, cy, cz);
      vp.camera.up.set(0, 1, 0);
      vp.orbitControls.target.set(cx, cy, cz);
      vp.orbitControls.update();
    });
    await win.waitForTimeout(240);
  };

  // ─── A. Base flange disk via atomic build ──────────────────────────────
  await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const flange = A.createPart('bolt-flange-disk');
    await A.startSketch(flange, 'XY');
    A.sketchCircle(flange, 0, 0, 40, 96);  // Ø80 mm flange disk
    A.finishSketch(flange);
    await A.extrude(flange, 8);            // 8 mm thick
    A.renderBody(flange, 0x6b8aa3);
  });
  await setIso();
  await frame('A-flange-disk-iso');

  const diskVolume = await win.evaluate(() => {
    const m = window.__lastFoundationManifold;
    return m ? m.volume() : 0;
  });
  console.log(`  [stage A] flange disk V = ${diskVolume.toFixed(0)} mm³ (expected ~40212 = π·40²·8)`);
  expect(diskVolume).toBeGreaterThan(38000);
  expect(diskVolume).toBeLessThan(42000);

  // ─── B. Unified Pattern — layout=circular, count=8 ────────────────────
  // Stage the per-call params on the planParams slot so requestToolParams
  // returns them on the next call. This is exactly how an AI plan step
  // drives the unified Pattern tool: ONE tool name, layout field selects
  // the dispatch.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Pattern'] = {
      layout: 'circular',
      count: 8,
      // Axis defaults to +Z (axisX=0, axisY=0, axisZ=1) — leave defaults.
      angle: 360,
      radius: 30,            // 30-mm-radius bolt-circle
      seedSize: [3, 3, 12],  // small square posts as bolt-hole seeds
    };
  });

  // Click the new unified Pattern ribbon entry (Part tab).
  await win.locator('.ribbon-tab', { hasText: /^Part$/ }).first().click();
  await win.waitForTimeout(400);
  // The "Pattern" tool sits alongside the legacy "Linear Pattern" + "Circular
  // Pattern" entries; match the EXACT label text "Pattern" (not a substring)
  // so we pick up only the unified entry.
  // Click the unified Pattern button by matching the exact tool-label text.
  // Note "Linear Pattern" + "Circular Pattern" + "Mirror Feature" are
  // also in the same group; the anchored regex `^Pattern$` matches ONLY
  // the unified entry's label span.
  {
    const labels = win.locator('.ribbon-tool-label');
    const count = await labels.count();
    let clicked = false;
    for (let i = 0; i < count; i += 1) {
      const txt = (await labels.nth(i).textContent() || '').trim();
      if (txt === 'Pattern') {
        // Click the parent .ribbon-tool button so the React onClick fires.
        await labels.nth(i).locator('xpath=..').click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('Tier-11c: unified "Pattern" ribbon entry not found');
  }

  // Wait for the foundation manifold registry to pick up the new body.
  // The Pattern handler ends with addFoundationManifoldToScene → sets
  // __lastFoundationManifold to the patterned result.
  await win.waitForFunction((targetV) => {
    const m = window.__lastFoundationManifold;
    if (!m) return false;
    const v = m.volume();
    // Expected: 8 × seedSize-volume = 8 × (3·3·12) = 8 × 108 = 864 mm³.
    return v > 700 && v < 1100;
  }, 0, { timeout: 30000 });
  await setIso();
  await frame('B-pattern-circular-bolt-circle-x8');

  const stageB = await win.evaluate(() => {
    const m = window.__lastFoundationManifold;
    const v = m.volume();
    const bb = m.boundingBox();
    return {
      volume: v,
      bbox: {
        min: [bb.min[0], bb.min[1], bb.min[2]],
        max: [bb.max[0], bb.max[1], bb.max[2]],
      },
    };
  });
  console.log(`  [stage B] bolt-circle V = ${stageB.volume.toFixed(0)} mm³ (expected ~864 = 8 × 108)`);
  console.log(`  [stage B] bbox: [${stageB.bbox.min.map(x => x.toFixed(1))}] → [${stageB.bbox.max.map(x => x.toFixed(1))}]`);
  // 8 seeds on a 30-mm bolt-circle → XY bbox roughly ±31..33 (seed half-
  // width adds ~1.5 to the radius).
  expect(stageB.volume).toBeGreaterThan(700);
  expect(stageB.volume).toBeLessThan(1100);
  const dx = stageB.bbox.max[0] - stageB.bbox.min[0];
  const dy = stageB.bbox.max[1] - stageB.bbox.min[1];
  expect(dx).toBeGreaterThan(55);
  expect(dx).toBeLessThan(75);
  // 8-fold symmetry → XY bbox roughly square.
  expect(Math.abs(dx - dy)).toBeLessThan(8);
  const boltCircleVolume = stageB.volume;

  // ─── C. Unified Pattern — layout=linear, count=3 along +X ──────────────
  // useCurrentBody=true takes the just-built bolt-circle (the current
  // _lastFoundationManifold) as the seed; spacing 90 mm gives a clear
  // separation so the 3 flange instances read distinctly in the still.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Pattern'] = {
      layout: 'linear',
      count: 3,
      spacing: 90,
      dirX: 1, dirY: 0, dirZ: 0,
      useCurrentBody: true,
    };
  });

  // Click the unified Pattern button by matching the exact tool-label text.
  // Note "Linear Pattern" + "Circular Pattern" + "Mirror Feature" are
  // also in the same group; the anchored regex `^Pattern$` matches ONLY
  // the unified entry's label span.
  {
    const labels = win.locator('.ribbon-tool-label');
    const count = await labels.count();
    let clicked = false;
    for (let i = 0; i < count; i += 1) {
      const txt = (await labels.nth(i).textContent() || '').trim();
      if (txt === 'Pattern') {
        // Click the parent .ribbon-tool button so the React onClick fires.
        await labels.nth(i).locator('xpath=..').click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('Tier-11c: unified "Pattern" ribbon entry not found');
  }

  // Wait for the linear pattern to replace _lastFoundationManifold with
  // a 3-instance arrangement. Expected V ≈ 3 × boltCircleVolume.
  await win.waitForFunction((targetV) => {
    const m = window.__lastFoundationManifold;
    if (!m) return false;
    const v = m.volume();
    return v > targetV * 2.7 && v < targetV * 3.3;
  }, boltCircleVolume, { timeout: 30000 });
  await setIso();
  await frame('C-pattern-linear-3-flanges-in-row');

  const stageC = await win.evaluate(() => {
    const m = window.__lastFoundationManifold;
    const v = m.volume();
    const bb = m.boundingBox();
    return {
      volume: v,
      bbox: {
        min: [bb.min[0], bb.min[1], bb.min[2]],
        max: [bb.max[0], bb.max[1], bb.max[2]],
      },
    };
  });
  console.log(`  [stage C] 3-flange row V = ${stageC.volume.toFixed(0)} mm³ (expected ~${(boltCircleVolume * 3).toFixed(0)})`);
  console.log(`  [stage C] bbox: [${stageC.bbox.min.map(x => x.toFixed(1))}] → [${stageC.bbox.max.map(x => x.toFixed(1))}]`);
  expect(stageC.volume).toBeGreaterThan(boltCircleVolume * 2.7);
  expect(stageC.volume).toBeLessThan(boltCircleVolume * 3.3);
  // 3 copies along +X at spacing=90 → X spread ≈ 2×90 + bolt-circle-X
  // ≈ 180 + 65 = 245 mm. Floor at ~210 mm (3 spans + slack).
  const xSpread = stageC.bbox.max[0] - stageC.bbox.min[0];
  expect(xSpread).toBeGreaterThan(210);
  expect(xSpread).toBeLessThan(280);
  // The Y bbox should still match the single bolt-circle's Y bbox
  // (no Y translation in the linear pattern).
  const ySpread = stageC.bbox.max[1] - stageC.bbox.min[1];
  expect(ySpread).toBeGreaterThan(55);
  expect(ySpread).toBeLessThan(75);

  // ─── Summary still — wider iso so the 3 in a row are all in frame ──────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const r = 0.30;  // 300 mm radius framing
    vp.camera.position.set(r * 0.72, r * 0.42, r * 0.72);
    vp.camera.lookAt(0.090, 0, 0);  // centred on the middle flange (~90 mm)
    vp.camera.up.set(0, 1, 0);
    vp.orbitControls.target.set(0.090, 0, 0);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(360);
  await frame('D-summary-3-flange-row-wide-iso');

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
