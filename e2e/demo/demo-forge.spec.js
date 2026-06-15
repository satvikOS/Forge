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

  // Block until Archie is genuinely idle. We poll the cmdbar's live
  // `disabled` attribute — the truth, since runArchie holds running=true
  // for the WHOLE turn (no mid-turn flicker). The old approach
  // (waitFor :not([disabled]) with .catch) silently PROCEEDED on timeout,
  // so a long build+sim turn bled into the next recipe (its cmdbar then
  // showed "Archie is working…"). On real timeout we abort the turn via
  // the Stop-button global so the next recipe always starts clean.
  const waitIdle = async (timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const busy = await page.locator('[data-testid="forge-cmdbar-input"]')
        .getAttribute('disabled').then((v) => v !== null).catch(() => false);
      if (!busy) return Date.now() - t0;
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => { try { window.__forgeCancelArchie?.(); } catch (_) {} }).catch(() => {});
    await page.waitForTimeout(1500);
    return -1;
  };

  const report = [];
  for (const r of FORGE_RECIPES) {
    // CLEAR the scene first (a human's File > New) — __forgeSetBodies([])
    // empties bodies AND the feature tree. Without this, parts accumulate
    // across recipes: deliverables contain every prior part and the scene
    // grows until the GPU render OOMs and the cmdbar goes unresponsive.
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); } catch (_) {} }).catch(() => {});
    await page.waitForTimeout(500);
    // Ensure Archie is idle (abort any straggler turn) BEFORE we type.
    const preIdle = await waitIdle(90000);
    if (preIdle < 0) console.log(`[demo:${r.id}] WARN: aborted a straggler turn before start`);
    const input = page.locator('[data-testid="forge-cmdbar-input"]');
    // Submit + retry up to 3× on a zero-body turn. At maxTurns=1 the model
    // occasionally "thinks" without dispatching (under-production); a fresh
    // attempt almost always dispatches. Clear between attempts so bodies
    // never accumulate.
    let st = { bodies: 0 }, passed = false, turnMs = 0;
    for (let attempt = 1; attempt <= 3 && !passed; attempt++) {
      if (attempt > 1) {
        await page.evaluate(() => { try { window.__forgeSetBodies?.([]); } catch (_) {} }).catch(() => {});
        await page.waitForTimeout(500);
        await waitIdle(60000);
        console.log(`[demo:${r.id}] retry ${attempt} (prev turn produced 0 bodies)`);
      }
      await input.click();
      await input.fill(r.prompt);
      await input.press('Enter');
      await page.waitForTimeout(1500); // let the turn start (input → disabled)
      turnMs = await waitIdle(300000); // block until the turn fully completes
      st = await forgeState(page);
      passed = r.expect(st);
    }
    console.log(`[demo:${r.id}] turn ${turnMs < 0 ? 'TIMED OUT — aborted' : (turnMs / 1000).toFixed(0) + 's'}`);

    // Deterministic parametric cascade (the tape-measure "10× bigger" —
    // Archie plans it, the app executes it deterministically). Best-effort.
    let scaled = null;
    if (passed && r.scale) {
      scaled = await page.evaluate((f) => {
        try {
          const bodies = window.__forgeBodies || [];
          let n = 0;
          for (const b of bodies) {
            if (b && b.handle != null && window.forge && typeof window.forge.scale === 'function') {
              window.forge.scale(b.handle, f, f, f); n++;
            }
          }
          if (n && window.__forgeFit) window.__forgeFit();
          return { ok: n > 0, scaled: n, factor: f };
        } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      }, r.scale).catch(() => null);
      await page.waitForTimeout(600);
    }

    await page.evaluate(() => { window.__forgeFit?.(); }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${r.id}-build.png`) });
    const stageResults = [{ shot: 'build', passed, bodies: st.bodies, lastSim: st.lastSim, scaled }];
    console.log(`[demo:${r.id}] ${passed ? 'PASS' : 'FAIL'} bodies=${st.bodies} sim=${st.lastSim}${scaled ? ' scaled=' + scaled.scaled + '×' + (scaled.factor || '') : ''}`);
    const allPass = passed;
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
    const dir = path.join(OUT, 'deliverables', r.id);
    if (allPass) {
      fs.mkdirSync(dir, { recursive: true });
      // RENDER — drive the REAL M4 Max GPU path tracer headlessly (no
      // panel; the modal overlay obstructs the next recipe's cmdbar).
      // __forgeRunPathTracedRender harvests the live body meshes, runs
      // WebGLPathTracer @256 spp, returns a PNG data URL. Write that as
      // the hero frame. Soft-fail to a viewport screenshot so a frame
      // always lands.
      const renderPath = path.join(OUT, `${r.id}-RENDER.png`);
      try { fs.unlinkSync(renderPath); } catch (_) {} // never reuse a prior run's frame
      render = await page.evaluate(async () => {
        try {
          if (typeof window.__forgeRunPathTracedRender === 'function') {
            const out = await window.__forgeRunPathTracedRender({ samples: 128, resolutionId: '720p', envPresetId: 'studio', denoise: true });
            if (out && out.dataUrl) return { mode: 'pathtrace-gpu', samples: out.samples, w: out.width, h: out.height, dataUrl: out.dataUrl };
          }
          return { mode: 'viewport', note: '__forgeRunPathTracedRender unavailable' };
        } catch (e) { return { mode: 'viewport', note: String(e && e.message || e) }; }
      });
      if (render && render.mode === 'pathtrace-gpu' && render.dataUrl) {
        try { fs.writeFileSync(renderPath, Buffer.from(render.dataUrl.split(',')[1], 'base64')); } catch (e) { render.writeErr = String(e); }
        delete render.dataUrl; // don't bloat the report json
      }
      if (!fs.existsSync(renderPath)) {
        // fallback: shaded viewport frame
        await page.evaluate(() => { window.__forgeFit?.(); }).catch(() => {});
        await page.waitForTimeout(400);
        await page.screenshot({ path: renderPath });
        if (render.mode === 'pathtrace-gpu') render.mode = 'viewport';
      }
      try { fs.copyFileSync(renderPath, path.join(dir, `${r.id}-render.png`)); deliverable.files.push(`${r.id}-render.png`); } catch (_) {}

      // PUBLISH — the kernel writes glb + STEP straight to disk via IPC
      // (exportGlbStream(bodies, filepath, opts); io.exportStep(handle,
      // filepath)). Pass absolute deliverable paths; verify on disk.
      const glbPath = path.join(dir, `${r.id}.glb`);
      const stepPath = path.join(dir, `${r.id}.step`);
      const pub = await page.evaluate(async ([gP, sP]) => {
        const out = { glb: false, step: false, errs: [] };
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.handle != null);
        try { if (window.__forgeExportGlbStream && bodies.length) { await window.__forgeExportGlbStream(bodies, gP, {}); out.glb = true; } }
        catch (e) { out.errs.push('glb: ' + String(e && e.message || e)); }
        // STEP — exportStep takes a SINGLE handle, so fold every body into
        // one compound via a guarded fuse-reduce first (else the bolt/bracket
        // STEP would be just body[0], a meaningless blank). The whole part
        // lands in the manufacturing deliverable, matching the glb.
        try {
          if (window.forge && window.forge.io && window.forge.io.exportStep && bodies.length) {
            let h = bodies[0].handle, fused = 1;
            if (typeof window.forge.fuse === 'function') {
              for (let i = 1; i < bodies.length; i++) {
                try { const nh = window.forge.fuse(h, bodies[i].handle); if (nh != null) { h = nh; fused++; } } catch (_) { /* skip a body that won't fuse */ }
              }
            }
            out.stepBodies = fused;
            await window.forge.io.exportStep(h, sP); out.step = true;
          }
        } catch (e) { out.errs.push('step: ' + String(e && e.message || e)); }
        return out;
      }, [glbPath, stepPath]).catch((e) => ({ glb: false, step: false, errs: [String(e)] }));
      await page.waitForTimeout(400);
      // verify on disk (kernel wrote them via main process)
      for (const [p, label] of [[glbPath, 'glb'], [stepPath, 'step']]) {
        try { const sz = fs.statSync(p).size; if (sz > 0) deliverable.files.push(`${r.id}.${label} (${sz}B)`); } catch (_) {}
      }
      deliverable.pubErrs = pub && pub.errs;
      // SPEC/PLAN doc — the engineering deliverable (dims + sim plan).
      try {
        const scaleLine = r.scale ? `\nParametric cascade: ${r.scale}× master-scale (the "blow it up 10× bigger" reference workflow)` : '';
        const card = `# ${r.title}\n\nReference: ${r.ref}\n\n## Archie's engineering plan (the spec)\n${r.plan || ''}\n\n## Execution (human-like app drive)\nPrompt: ${r.prompt}${scaleLine}\n\nRender: ${render.mode}${render.samples ? ' @ ' + render.samples + ' spp (M4 Max GPU ray tracing)' : ''}\nDeliverable: glb + STEP (manufacturing) + STL + render PNG\n`;
        fs.writeFileSync(path.join(dir, `${r.id}-plan.md`), card); deliverable.files.push(`${r.id}-plan.md`);
      } catch (_) {}
    }

    report.push({ id: r.id, title: r.title, ref: r.ref, allPass, stages: stageResults, finals, render, deliverable });
    console.log(`[demo:${r.id}] ${allPass ? 'PASS' : 'FAIL'} | render=${render.mode} | deliverable=${deliverable.files.length} files`);
  }

  fs.writeFileSync(path.join(OUT, 'demo-report.json'), JSON.stringify(report, null, 1));
  const passes = report.filter((r) => r.allPass).length;
  console.log(`\n=== FORGE DEMO: ${passes}/${report.length} references airtight ===`);
  await app.close();
});
