// Forge investor-demo driver (task #61) — the airtight loop for CAD:
//   Archie BRAIN states the engineering spec (dims + measurements +
//   SIM PLAN) → drives the native OCCT app via tool interactions →
//   VISUAL go/no-go each stage → multi-cam final.
//
// Runs HEADED against the live promoted adapter on :8080. Per-stage
// screenshots + 5-angle finals + demo-report.json. Sim stages verify via
// the Archie thread reporting stress/von-Mises (no clean result hook yet
// — tuned in the headed pass). A stage that misses its go/no-go is
// recorded fail; the run continues.
//
// Requires: mlx_lm.server :8080 (promoted adapter), Vite :3000.
// One flow at a time (hardware-calm).

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { FORGE_RECIPES } from './recipes.forge.mjs';

const OUT = path.resolve(__dirname, 'shots', 'forge');
const ANGLES = [
  ['front', [0, 0, 500]], ['iso', [350, 300, 350]], ['right', [500, 0, 0]],
  ['top', [0, 500, 1]], ['close', [150, 120, 150]],
];

async function forgeState(page) {
  return page.evaluate(() => {
    const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0;
    // thread text — best-effort scan for the Archie reply / sim report.
    let threadText = '';
    try {
      const nodes = document.querySelectorAll('[data-testid*="archie"], [class*="archie"], [class*="thread"], [class*="message"]');
      threadText = Array.from(nodes).map((n) => n.textContent || '').join(' ').slice(-4000);
    } catch (_) { /* ignore */ }
    const lastSim = /\b(\d+(\.\d+)?\s*MPa|von[\s-]?mises|peak stress|yield|factor of safety)\b/i.test(threadText);
    return { bodies, lastSim, threadText: threadText.slice(-400) };
  });
}

test('Forge investor demo — engineering plan → drive → visually verify', async () => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 120,
  });
  let page = await app.firstWindow();
  if (page.url().startsWith('devtools://')) {
    page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-app"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 15000 });
  await page.waitForTimeout(700);

  const report = [];
  for (const r of FORGE_RECIPES) {
    const stageResults = [];
    for (let si = 0; si < r.stages.length; si++) {
      const stage = r.stages[si];
      const input = page.locator('[data-testid="forge-cmdbar-input"]');
      await input.click();
      await input.fill(stage.prompt);
      await input.press('Enter');

      const deadline = Date.now() + 180000;
      let st = await forgeState(page);
      let passed = false;
      while (Date.now() < deadline) {
        st = await forgeState(page);
        if (stage.expect(st)) { passed = true; break; }
        await page.waitForTimeout(2500);
      }
      await page.evaluate(() => { window.__forgeFit?.(); }).catch(() => {});
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${r.id}-${stage.shot}.png`) });
      stageResults.push({ shot: stage.shot, passed, bodies: st.bodies, lastSim: st.lastSim });
      console.log(`[demo:${r.id}/${stage.shot}] ${passed ? 'PASS' : 'FAIL'} bodies=${st.bodies} sim=${st.lastSim}`);
      if (!passed) break; // halt this recipe on a failed stage (no broken demo)
    }
    const allPass = stageResults.length === r.stages.length && stageResults.every((s) => s.passed);
    // multi-cam final only on a fully-passed recipe
    const finals = [];
    if (allPass) {
      for (const [name, pos] of ANGLES) {
        await page.evaluate(([p]) => {
          const cam = window.__forgeCamera;
          if (cam) { cam.position.set(p[0], p[1], p[2]); cam.lookAt?.(0, 0, 0); }
          window.__forgeFit?.();
        }, [pos]).catch(() => {});
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(OUT, `${r.id}-final-${name}.png`) });
        finals.push(name);
      }
    }
    // ── FINAL PIPELINE STAGE: hi-def GPU ray-traced render → publish
    //    full engineering deliverable (glb + STEP + STL + render). ──
    let render = { mode: 'skipped' };
    let deliverable = { files: [] };
    if (allPass) {
      // RENDER — Forge path tracer (M4 Max GPU). Returns an rgb buffer;
      // the workbench draws it to a canvas. Soft-fail to the raster
      // viewport so a hero frame always lands.
      render = await page.evaluate(async () => {
        try {
          if (typeof window.__forgeOpenPathTracer === 'function') window.__forgeOpenPathTracer();
          else if (typeof window.__forgeOpenPathTraceWorkbench === 'function') window.__forgeOpenPathTraceWorkbench();
          await new Promise((res) => setTimeout(res, 600));
          if (typeof window.__forgePathTraceRender === 'function') {
            const out = await window.__forgePathTraceRender({ width: 1280, height: 720, samples: 256, bounces: 4 });
            return { mode: 'pathtrace', samples: 256, ok: !!out };
          }
          return { mode: 'raster' };
        } catch (e) { return { mode: 'error', error: String(e && e.message || e) }; }
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `${r.id}-RENDER.png`) });

      // PUBLISH — glb + STEP (the manufacturing-grade deliverable) + STL.
      const exported = await page.evaluate(async () => {
        const out = {};
        const u8toB64 = (b) => { const u8 = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return { b64: btoa(s), bytes: u8.length }; };
        try { if (window.__forgeExportGlbStream) { const g = await window.__forgeExportGlbStream(); if (g) out.glb = u8toB64(g); } } catch (_) {}
        try { if (window.forge && window.forge.io && window.forge.io.exportStep) { const bodies = window.__forgeBodies || []; const h = bodies[0] && (bodies[0].handle); if (h != null) { const step = await window.forge.io.exportStep(h); if (typeof step === 'string') out.step = step; } } } catch (_) {}
        try { if (window.__forgeLastStlExport) { const s = window.__forgeLastStlExport; if (typeof s === 'string') out.stl = s; } } catch (_) {}
        return out;
      });
      const dir = path.join(OUT, 'deliverables', r.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const [k, v] of Object.entries(exported || {})) {
        try {
          if (k === 'glb' && v && v.b64) { fs.writeFileSync(path.join(dir, `${r.id}.glb`), Buffer.from(v.b64, 'base64')); deliverable.files.push(`${r.id}.glb (${v.bytes}B)`); }
          else if (typeof v === 'string' && v.length) { fs.writeFileSync(path.join(dir, `${r.id}.${k}`), v); deliverable.files.push(`${r.id}.${k} (${v.length}B)`); }
        } catch (_) {}
      }
      try { fs.copyFileSync(path.join(OUT, `${r.id}-RENDER.png`), path.join(dir, `${r.id}-render.png`)); deliverable.files.push(`${r.id}-render.png`); } catch (_) {}
    }

    report.push({ id: r.id, title: r.title, ref: r.ref, allPass, stages: stageResults, finals, render, deliverable });
    console.log(`[demo:${r.id}] ${allPass ? 'PASS' : 'FAIL'} | render=${render.mode} | deliverable=${deliverable.files.length} files`);
  }

  fs.writeFileSync(path.join(OUT, 'demo-report.json'), JSON.stringify(report, null, 1));
  const passes = report.filter((r) => r.allPass).length;
  console.log(`\n=== FORGE DEMO: ${passes}/${report.length} references airtight ===`);
  await app.close();
});
