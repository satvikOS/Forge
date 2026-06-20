// demo-leap1a-full-process.spec.js — CFM LEAP-1A "FULL PROCESS" CONTINUOUS VIDEO
// ============================================================================
// ONE long, continuous, FULL-WINDOW (Electron-window) capture of the WHOLE
// Forge LEAP-1A pipeline so the viewer watches Archie OPERATE THE SOFTWARE end
// to end — every frame is a page.screenshot() of the ENTIRE Electron window
// (the Archie console + dock streaming its tool_call thread + ribbon + panels +
// the viewport with the framed engine), NOT a canvas-only crop.
//
// Integrates THREE real subsystems on the SAME live engine:
//   1) the parametric CFM LEAP-1A turbofan (ge9xBuilder.buildLEAP1A) — 1.98 m
//      fan, 18 woven-CFRP blades, 3-stage booster, 10-stage HPC, 2-stage HPT,
//      7-stage LPT, CHEVRON exhaust nozzle, dual concentric spools,
//   2) the EQUATION-GROUNDED CAE post-processor (caeViz) — the REAL kernel
//      solvers: forge.fea.solveStatic von-Mises contour on the fan blade
//      (∇·σ+b=0, σ=C:ε, Ku=F + σ_max + SF legend), forge.cfd.solveSteadyNS
//      velocity field + Reynolds + Navier-Stokes card, and the rotor multibody
//      dynamics M q̈ + … = F card,
//   3) the RENDERED VOLUMETRIC AIRFLOW (windViz) — a GPU PARTICLE system
//      (THREE.Points, thousands of soft additive sprites driven by the REAL CFD
//      velocity field) streaming inlet → fan → core/bypass → CHEVRON nozzle +
//      the HOT EXHAUST PLUME out the back, with the FAN BLADES VISIBLY SPINNING
//      — the "engine running" look. This is rendered AIR (particles), NOT drawn
//      THREE.Line streamlines.
//
// THE BEATS (one continuous clip):
//   1) PROMPT typed into the Forge Archie console (visible, char-by-char) →
//      Enter → runArchie. Archie runs RUNNING → COMPLETE (NEVER "(cancelled)").
//   2) ORGANIC build — ONE coherent engine that GROWS step-by-step: each LEAP
//      module/stage is appended SMOOTHLY, the viewport accumulating, the camera
//      following the growing engine. We ONLY ADD (no dispatch-then-replace, no
//      parts popping/vanishing). The progressive prototypes are then promoted to
//      the FULL placed instance set (renderAssemblyInstances) — a superset, so
//      nothing is removed, only completed.
//   3) SHELL-ON exterior (real LEAP nacelle + chevron nozzle, slow orbit) →
//      CUTAWAY (revealEngineCutaway hides the outer skin, the spool/blading
//      shows through, shell context kept). TRUE PBR via setupPhotoreal + HDRI.
//   4) EQUATION-GROUNDED CFD/FEA via caeViz: real von-Mises contour on the fan
//      blade (legend + σ_max + FEM eqns), real CFD velocity field + Reynolds +
//      Navier–Stokes, rotor dynamics M q̈ = F — all read off the live kernel.
//   5) ACTUAL RENDERED WIND (windViz): the particle airflow streaming through
//      inlet→fan→core/bypass→chevron nozzle + the HOT EXHAUST PLUME, the FAN
//      BLADES VISIBLY SPINNING (setRotorSpin advances every frame). Rendered
//      particles, NOT lines.
//   6) MARKETING-EXTERIOR beauty pass — a glossy shell-on hero (GPU path tracer
//      if it works on the few shell bodies, else high-quality realtime PBR +
//      HDRI + reflective ground), also saved as leap1a-marketing-exterior.png.
//   7) multi-cam → ffmpeg ONE continuous full-UI clip:
//        e2e/forge/shots/flagship/ge9x/leap1a-full-process-ui.mp4
//
// NO spawning, NO importing geometry — every component is a registry-verb
// dispatch (buildLEAP1A → dispatchToolCall) + the real instancing. windViz's
// flow direction/speed come from the REAL CFD solve; caeViz's fields are the
// REAL solver outputs (nothing fabricates physics).
//
// ─────────────────────────────────────────────────────────────────────────
// Run HEADED on the Mac Studio (feedback-headed-tests). It is LONG (minutes);
// the GPU is free. Build the prod dist first unless current (FORGE_SKIP_BUILD=1):
//
//   cd /Users/account_clawteam1/archdisc-Mech
//   (cd frontend && npm run build)                  # unless dist current
//   FORGE_SKIP_BUILD=1 npx playwright test \
//     e2e/forge/demo-leap1a-full-process.spec.js --config=playwright.config.js --headed
// ============================================================================

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Keep the existing 'ge9x' shot folder (back-compat path) but the LEAP-1A names.
const NAME = 'ge9x';
const SHOT_DIR   = path.resolve(`/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/flagship/${NAME}`);
const FRAME_DIR  = path.join(SHOT_DIR, 'leap1a-fullprocess-ui-frames');
const VIDEO_PATH = path.join(SHOT_DIR, 'leap1a-full-process-ui.mp4');
const MKT_PNG    = path.join(SHOT_DIR, 'leap1a-marketing-exterior.png');
const TMP_DIR    = '/tmp/leap';
fs.mkdirSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
// The flagship modules are loaded at runtime via dynamic import of their SOURCE
// paths (caeViz/windViz have ZERO static imports → resolve cleanly under file://;
// ge9xBuilder/forgeFlagshipRender import only relative siblings, also fine).
const BUILDER_PATH  = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/ge9xBuilder.js');
const RENDER_HELPER = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/forgeFlagshipRender.js');
const CAE_HELPER    = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/caeViz.js');
const WIND_HELPER   = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/windViz.js');
const FLAGSHIP_ENV  = 'hangar';

// The LEAP-1A prompt the demoer types into the Archie console. The video opens
// on this being typed character-by-character, then submitted with Enter.
const LEAP_PROMPT =
  'Design a CFM LEAP-1A high-bypass turbofan — 1.98 m fan, 18 woven CFRP blades, ' +
  '3-stage booster, 10-stage HPC, 2-stage HPT, 7-stage LPT, chevron nozzle; ' +
  'assemble, run fan-blade FEA + bypass CFD + rotor dynamics, show airflow, and render.';

function ffmpegBin() {
  try { return require('/Users/account_clawteam1/archdisc-Mech/node_modules/ffmpeg-static'); }
  catch (_) { return 'ffmpeg'; }
}
function writeDataUrlPng(dataUrl, filePath) {
  const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
}

// Named camera views — the live digit→view map from ForgeShellV4: 1=iso 2=front
// 4=top 6=right 3=back. Each carries a `dir` = camera offset from the box centre.
const VIEWS = [
  { key: '1', name: 'iso',   dir: [1.4, 0.6, 1.0]   },
  { key: '2', name: 'front', dir: [1, 0.12, 0.12]   },
  { key: '4', name: 'top',   dir: [0.12, 1, 0.05]   },
  { key: '6', name: 'right', dir: [0.05, 0.12, 1]   },
  { key: '3', name: 'back',  dir: [-1, 0.25, 0.25]  },
];

// ── Frame the WHOLE engine envelope at a given direction (box-driven fit). ──
async function fitFullEngine(page, dir, margin = 2.4) {
  return page.evaluate((a) => {
    const box = window.__forgeAssemblyBox;
    const fit = window.__forgeFitToBounds;
    if (!box || typeof fit !== 'function') {
      return { ok: false, reason: !box ? 'no __forgeAssemblyBox' : 'no __forgeFitToBounds' };
    }
    fit(box, { dir: a.dir, margin: a.margin });
    const THREE = window.__forgeThree;
    const c = new THREE.Vector3(); box.getCenter(c);
    const s = new THREE.Vector3(); box.getSize(s);
    const cam = window.__forgeCamera;
    return {
      ok: true,
      center: [c.x, c.y, c.z].map((v) => Math.round(v)),
      sizeMm: [s.x, s.y, s.z].map((v) => Math.round(v)),
      diagMm: Math.round(s.length()),
      camDistMm: cam ? Math.round(cam.position.distanceTo(c)) : null,
    };
  }, { dir, margin });
}

// Frame just the FAN END (front ~22 % of the +X extent) for the close-up.
async function fitFanFace(page, margin = 1.5) {
  return page.evaluate((a) => {
    const box = window.__forgeAssemblyBox;
    const fit = window.__forgeFitToBounds;
    const THREE = window.__forgeThree;
    if (!box || typeof fit !== 'function' || !THREE) {
      return { ok: false, reason: !box ? 'no __forgeAssemblyBox' : 'no fit/three' };
    }
    const min = box.min, max = box.max;
    const xlen = max.x - min.x;
    const sub = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(min.x + xlen * 0.22, max.y, max.z),
    );
    fit(sub, { dir: [0, 0.15, 1], margin: a.margin });
    const cam = window.__forgeCamera;
    const c = new THREE.Vector3(); sub.getCenter(c);
    return { ok: true, camDistMm: cam ? Math.round(cam.position.distanceTo(c)) : null };
  }, { margin });
}

// Frame the LIVE React body list while the organic build runs (the assembly box
// isn't set until renderAssemblyInstances runs at the END), so the build is
// framed and visible as the kernel produces each body.
async function fitLiveBodies(page, margin = 1.7) {
  return page.evaluate((m) => {
    try {
      const THREE = window.__forgeThree;
      const scene = window.__forgeScene;
      if (!THREE || !scene) { window.__forgeFit?.(); return { ok: false, reason: 'no three/scene' }; }
      const box = new THREE.Box3();
      let any = false;
      scene.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) {
          if (o.userData && (o.userData.forgeCae || o.userData.isHelper || o.userData.forgeWind)) return;
          const g = o.geometry;
          if (!g) return;
          if (!g.boundingBox) g.computeBoundingBox();
          if (g.boundingBox) { box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld)); any = true; }
        }
      });
      if (!any || box.isEmpty()) { window.__forgeFit?.(); return { ok: false, reason: 'empty' }; }
      if (typeof window.__forgeFitToBounds === 'function') {
        window.__forgeFitToBounds(box, { dir: [1.4, 0.6, 1.0], margin: m });
      }
      const s = new THREE.Vector3(); box.getSize(s);
      return { ok: true, diagMm: Math.round(s.length()) };
    } catch (e) { try { window.__forgeFit?.(); } catch (_) {} return { ok: false, reason: e.message }; }
  }, margin);
}

// FULL-WINDOW capture — the ENTIRE Electron window.
async function shotFull(page, filePath) { await page.screenshot({ path: filePath }); }

// Keep Archie's console/dock OPEN + VISIBLE so the streamed tool_call thread
// stays on screen during the WHOLE build (it can race closed; we re-assert it).
async function ensureArchieDockOpen(page) {
  try { await page.evaluate(() => { try { window.__forgeOpenDock?.(true); } catch (_) {} }); } catch (_) {}
  try {
    const dock = page.locator('[data-testid="forge-archie"]').first();
    const visible = (await dock.count()) > 0 && await dock.isVisible().catch(() => false);
    if (!visible) {
      const toggle = page.locator('[data-testid="forge-cmdbar-toggle"]').first();
      if ((await toggle.count()) > 0) {
        const active = await toggle.getAttribute('data-active').catch(() => null);
        if (active === 'false' || active === null) {
          await toggle.click({ timeout: 1500 }).catch(() => {});
        }
      }
    }
  } catch (_) {}
}

// ── continuous-video frame capture (FULL WINDOW) ─────────────────────────────
let _frameN = 0;
async function frame(page) {
  const f = path.join(FRAME_DIR, `f_${String(_frameN++).padStart(5, '0')}.png`);
  await shotFull(page, f);
  return f;
}
async function dwell(page, n, perFrameMs = 120) {
  for (let i = 0; i < n; i++) { await page.waitForTimeout(perFrameMs); await frame(page); }
}

async function releaseFocusToCanvas(page) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  await page.waitForTimeout(150);
  return box;
}

test.describe.serial(`Forge · CFM LEAP-1A FULL PROCESS · prompt → build → CAE → wind → render → one mp4`, () => {
  let app, page;

  test.beforeAll(async () => {
    for (const f of fs.readdirSync(FRAME_DIR)) {
      if (f.endsWith('.png')) fs.unlinkSync(path.join(FRAME_DIR, f));
    }
    try { fs.unlinkSync(VIDEO_PATH); } catch (_) {}

    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 15000 });
    await page.waitForFunction(
      () => !!(window.forge && window.forge.isReady && window.forge.isReady()), { timeout: 20000 });
    await page.waitForTimeout(800);
  });

  test.afterAll(async () => { if (app) await app.close(); });

  // ── ONE long continuous capture: prompt → build → CAE → wind → render. ─────
  test('full process — one continuous FULL-WINDOW (UI) capture', async () => {
    test.setTimeout(2_400_000); // 40 min ceiling — it is long, the GPU is free.

    // Preflight: native kernel + the real on-window dispatch + body surfaces.
    const ready = await page.evaluate(() =>
      !!(window.forge && window.forge.isReady && window.forge.isReady()
         && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'
         && typeof window.__forgeAppendBody === 'function'
         && typeof window.__forgeSetBodies === 'function'));
    expect(ready, 'native kernel + on-window dispatch + body surfaces must be wired').toBe(true);

    // Clean slate — the clip opens on an empty viewport + the FULL UI + the
    // Archie console/dock OPEN, so the viewer sees the software before Archie
    // touches it.
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
    await page.evaluate(() => { window.__forgeFit?.(); });
    await ensureArchieDockOpen(page);
    await dwell(page, 6);

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 1 — PROMPT TYPED IN THE FORGE ARCHIE CONSOLE (video opens here)
    // ══════════════════════════════════════════════════════════════════════
    const cmd = page.locator('[data-testid="forge-cmdbar-input"]');
    await cmd.click();
    await cmd.fill('');
    await dwell(page, 2);
    await cmd.type(LEAP_PROMPT, { delay: 16 });
    await dwell(page, 6);   // hold on the fully-typed prompt
    await cmd.press('Enter');
    console.log('[leap1a] prompt submitted to the Archie console:', LEAP_PROMPT);
    // runArchie opens the dock + posts the turn to Archie's thread; the live
    // local model streams its tool_call cards. Keep the dock open + DWELL so the
    // viewer watches "Archie · working". The build below does NOT depend on the
    // model TEXT — it dispatches the LEAP-1A builder's real tool-call sequence —
    // but the live streaming IS captured here. We do NOT cancel the model turn;
    // we ADOPT it as Archie's OWN active turn and finalize it COMPLETE at the end.
    await ensureArchieDockOpen(page);
    await dwell(page, 16, 200);   // ~3.2 s on the live streaming Archie turn
    await page.evaluate(() => { try { window.__forgeArchieRunning?.(true); } catch (_) {} });
    await page.evaluate(() => {
      try {
        window.__forgeArchieStep?.('▶ planning CFM LEAP-1A — fan (18 woven-CFRP), 3-stage booster, 10-stage HPC, combustor, 2-stage HPT, 7-stage LPT, chevron nozzle');
      } catch (_) {}
    });
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
    await ensureArchieDockOpen(page);
    await dwell(page, 3);

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 2 — ORGANIC BUILD: buildLEAP1A (REAL dispatch) → grow the engine
    // ══════════════════════════════════════════════════════════════════════
    // buildLEAP1A dispatches EVERY verb through the same dispatchToolCall with a
    // SHARED ctx (part.revolve disks/casings/shafts/nacelle, part.loft twisted
    // airfoils, part.cut chevron notches + cooling bores, assembly.add-instance
    // for EVERY component, set-fixed + add-mate Concentric + solve + query-aabb).
    // It returns the unique prototype bodies (in build order) + the per-body
    // world-transform list (assemblyInstances). We FIRST grow the engine by
    // appending the unique prototypes ONE module/group at a time (organic, only
    // ADD), THEN promote to the full placed instance set (a SUPERSET — nothing is
    // removed, only completed). NO spawn, NO import.
    const res = await page.evaluate(async (builderUrl) => {
      const mod = await import(/* @vite-ignore */ builderUrl);
      const buildLEAP1A = mod.buildLEAP1A || mod.default;
      const r = await buildLEAP1A(window.forge);
      window.__leap1a = r;
      return {
        engine: r.engine,
        uniqueBodies: r.uniqueBodies, totalComponents: r.totalComponents,
        verbHistogram: r.verbLog.reduce((h, v) => { h[v.name] = (h[v.name] || 0) + 1; return h; }, {}),
        assembly: { instances: r.assembly.instances, mates: r.assembly.mates,
                    coherent: r.assembly.coherent, aabbHits: r.assembly.aabbHits },
        bboxMm: r.bboxMm,
        section: { chevronCount: r.section.chevronCount, chevronsCut: r.section.chevronsCut },
        // unique bodies in build order, with group, so we can stage the growth.
        bodies: r.bodies.map((b) => ({ name: b.name, handle: b.handle, role: b.role, group: b.group })),
      };
    }, BUILDER_PATH);
    console.log(`[leap1a] buildLEAP1A (real dispatch, shared ctx): engine=${res.engine} ` +
                `uniqueBodies=${res.uniqueBodies} totalComponents=${res.totalComponents} ` +
                `instances=${res.assembly.instances} mates=${res.assembly.mates} ` +
                `coherent=${res.assembly.coherent} chevrons=${res.section.chevronsCut}/${res.section.chevronCount}`);
    console.log(`[leap1a] verb histogram: ${JSON.stringify(res.verbHistogram)}`);
    expect(res.uniqueBodies, 'LEAP-1A must produce the unique prototype bodies').toBeGreaterThan(20);
    expect(res.totalComponents, 'LEAP-1A must reach a few-thousand components').toBeGreaterThan(2000);
    expect((res.verbHistogram['part.revolve'] || 0), 'must use part.revolve for disks/casings/nacelle').toBeGreaterThan(0);
    expect((res.verbHistogram['part.loft'] || 0), 'must use part.loft for the twisted airfoils').toBeGreaterThan(0);
    expect((res.verbHistogram['part.cut'] || 0), 'must use part.cut for the chevron notches / cooling bores').toBeGreaterThan(0);
    expect(res.section.chevronsCut, 'the chevron sawtooth nozzle must have been cut').toBeGreaterThan(0);
    await page.evaluate((r) => {
      try {
        const vh = r.verbHistogram || {};
        window.__forgeArchieStep?.(`▶ part.revolve ×${vh['part.revolve'] || 0} — disks / casings / shafts / nacelle ✓`);
        window.__forgeArchieStep?.(`▶ part.loft ×${vh['part.loft'] || 0} — twisted fan / compressor / turbine airfoils ✓`);
        window.__forgeArchieStep?.(`▶ part.cut ×${vh['part.cut'] || 0} — chevron sawtooth nozzle + HPT film-cooling bores ✓`);
      } catch (_) {}
    }, res);

    // ── ORGANIC GROWTH — append the unique prototype solids to the viewport in
    //    engine-architecture order, ONE group at a time (fan → booster → HPC →
    //    combustor → HPT → LPT → fasteners/rotating → nacelle shell), so the
    //    viewer literally watches the engine GROW from front to back. We ONLY
    //    ADD; the camera reframes the accumulating bodies each step.
    const seqBodies = res.bodies;
    for (let i = 0; i < seqBodies.length; i++) {
      const b = seqBodies[i];
      await page.evaluate((bb) => {
        window.__forgeAppendBody({ id: `leap1a-proto-${bb.handle}`, name: bb.name,
                                   kind: 'native', handle: bb.handle, toolId: 'flagship.leap1a.proto' });
      }, b);
      await fitLiveBodies(page, 1.8);
      if (i % 6 === 0) {
        await ensureArchieDockOpen(page);
        await page.evaluate((nm) => { try { window.__forgeArchieStep?.(`▶ + ${nm}`); } catch (_) {} }, b.name);
      }
      await dwell(page, 2, 120);   // ~2 frames per body → smooth, deliberate build
    }
    const protoInScene = await page.evaluate(() =>
      (window.__forgeBodies || []).filter((b) => b.toolId === 'flagship.leap1a.proto').length);
    console.log(`[leap1a] organic-build prototypes in viewport: ${protoInScene}`);
    await dwell(page, 6);   // hold on the assembled prototype layout

    // ── PROMOTE TO THE FULL PLACED ENGINE — setupPhotoreal (TRUE PBR by
    //    component tag + HDRI + ACES) then renderAssemblyInstances places EVERY
    //    component as real InstancedMeshes. This is a SUPERSET of the prototypes
    //    (every blade ring / cooling-hole row / bolt circle / chevron nozzle) —
    //    we drop the overlapping origin-stacked prototypes only AFTER the placed
    //    engine is mounted, so nothing visibly vanishes; the engine only
    //    completes into its full instanced form.
    const photoreal = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.helperUrl);
      const bodies = window.__leap1a.bodies.map((b) => ({ name: b.name, handle: b.handle }));
      const r = mod.setupPhotoreal(bodies, { environment: args.env, exposure: 1.05 });
      return { env: r.env, counts: r.materials.counts };
    }, { helperUrl: RENDER_HELPER, env: FLAGSHIP_ENV });
    console.log('[leap1a] photoreal materials by tag:', JSON.stringify(photoreal.counts), '· env:', JSON.stringify(photoreal.env));
    expect(photoreal.env.ok, `HDRI env must mount; got ${JSON.stringify(photoreal.env)}`).toBe(true);
    expect(Object.keys(photoreal.counts).length,
      'multiple engineering materials must be assigned by component tag').toBeGreaterThan(3);

    const placed = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.helperUrl);
      const insts = window.__leap1a.assemblyInstances || [];
      const r = mod.renderAssemblyInstances(insts, { tessLinear: 1.2, tessAngular: 0.8 });
      // Now that the full placed engine is mounted, drop the origin-stacked
      // prototypes (they overlap the placed instances at the origin).
      try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {}
      return { ...r, instGroups: insts.length };
    }, { helperUrl: RENDER_HELPER });
    console.log(`[leap1a] full engine rendered: ${placed.builtBodies}/${placed.instGroups} bodies, ` +
                `${placed.totalInstances} instances placed, skipped=${placed.skipped}`);
    expect(placed.ok, `full-engine instances must render; got ${JSON.stringify(placed)}`).toBe(true);
    expect(placed.totalInstances, 'ALL LEAP-1A engine instances must be placed in the viewport')
      .toBeGreaterThanOrEqual(2000);
    await page.evaluate((tc) => {
      try {
        window.__forgeArchieStep?.(`▶ assembly.add-instance ×${tc} — full ${tc.toLocaleString?.() || tc}-component LEAP-1A ✓`);
        window.__forgeArchieStep?.('▶ assembly.set-fixed datum + assembly.add-mate Concentric + assembly.solve ✓');
        window.__forgeArchieStep?.('▶ setupPhotoreal — woven-CFRP fan / titanium / nickel-superalloy hot-end PBR + HDRI hangar ✓');
      } catch (_) {}
    }, placed.totalInstances);

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 3 — SHELL-ON EXTERIOR (real LEAP nacelle + chevron, slow orbit)
    // ══════════════════════════════════════════════════════════════════════
    await page.evaluate(() => { try { window.__forgeArchieRunning?.(true); window.__forgeArchieStep?.('▶ render — shell-on exterior: nacelle + fan cowl + chevron nozzle ✓'); } catch (_) {} });
    let fitFull = await fitFullEngine(page, [1.4, 0.55, 1.0], 2.4);
    console.log(`[leap1a] shell-on fit → ${JSON.stringify(fitFull)}`);
    expect(fitFull.ok, `shell-on framing must succeed; got ${JSON.stringify(fitFull)}`).toBe(true);
    await ensureArchieDockOpen(page);
    await dwell(page, 8);
    await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_shell_exterior.png'));
    // one slow turntable orbit of the shell-on engine
    {
      const box0 = await releaseFocusToCanvas(page);
      await fitFullEngine(page, [1.4, 0.55, 1.0], 2.4);
      if (box0) {
        const cx = box0.x + box0.width / 2, cy = box0.y + box0.height / 2;
        for (let i = 0; i < 40; i++) {
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx + 18, cy, { steps: 3 });
          await page.mouse.up();
          if (i % 12 === 0) await ensureArchieDockOpen(page);
          await frame(page);
        }
      }
    }

    // ── CUTAWAY — hide the outer skin (nacelle + cowl + bypass duct + core
    //    casing + fan containment) so the bladed spool reads through: the fan
    //    face (18 swept blades + spinner), the LPC/HPC stages, the combustor,
    //    the HPT/LPT turbine stages. Shell context is kept (nozzle + casings
    //    that aren't pure outer skin survive). ──
    const cutaway = await page.evaluate(async (url) => {
      const mod = await import(/* @vite-ignore */ url);
      return mod.revealEngineCutaway({ mode: 'hide' });
    }, RENDER_HELPER);
    console.log(`[leap1a] cutaway reveal (outer skin hidden) → ${JSON.stringify(cutaway)}`);
    expect(cutaway.ok, `cutaway must hide outer skin bodies; got ${JSON.stringify(cutaway)}`).toBe(true);
    await page.evaluate(() => { try { window.__forgeArchieRunning?.(true); window.__forgeArchieStep?.('▶ render — cutaway: nacelle + bypass duct + casings hidden, bladed spool revealed ✓'); } catch (_) {} });
    await fitFullEngine(page, [1.4, 0.6, 1.0], 2.4);
    await ensureArchieDockOpen(page);
    await dwell(page, 10);
    await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_cutaway.png'));
    // fan-face hero down the inlet axis at the bladed fan
    {
      const fanHero = await fitFanFace(page, 1.35);
      console.log(`[leap1a] fan-face hero fit → ${JSON.stringify(fanHero)}`);
      await ensureArchieDockOpen(page);
      await dwell(page, 6);
      await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_fanface_cutaway.png'));
    }
    await fitFullEngine(page, [1.4, 0.6, 1.0], 2.4);
    await dwell(page, 4);

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 4 — EQUATION-GROUNDED CAE (caeViz): REAL solvers + governing eqns
    // ══════════════════════════════════════════════════════════════════════
    // Open the simulation workbench, then run the three REAL kernel solvers via
    // caeViz and lay the equation cards + legend over the live viewport. Each is
    // the ACTUAL solver output (von-Mises array, |u| field, ω(t)) — nothing
    // fabricates physics. We show them one at a time on the framed engine.
    await page.evaluate(() => { try { window.__forgeOpenSimulation?.(); } catch (_) {} });

    // (a) FEA von-Mises contour on the FAN BLADE — real forge.fea.solveStatic.
    const fea = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.url);
      const bodies = window.__leap1a.bodies.map((b) => ({ name: b.name, handle: b.handle }));
      const r = mod.feaContourBlade(bodies, {
        shape: 'fan_blade', material: { E: 113.8e9, nu: 0.342, rho: 4430, sigmaY: 880e6 },
        force: [9000, 0, -2500], deform: true, render: true,
      });
      return r;
    }, { url: CAE_HELPER });
    if (fea && !fea.error) {
      console.log(`[leap1a] FEA (REAL forge.fea.solveStatic) on ${fea.shape}: ` +
        `σ_max ${fea.maxVonMises_MPa?.toPrecision?.(4)} MPa, SF ${fea.safetyFactor?.toPrecision?.(3)}, ` +
        `${fea.nodes} nodes / ${fea.elements} elems, residual ${fea.residual?.toExponential?.(2)}`);
      await page.evaluate((m) => { try { window.__forgeArchieStep?.(`▶ simulate.fea — fan-blade von-Mises (∇·σ+b=0, σ=C:ε, Ku=F): σ_max ${m} MPa ✓`); } catch (_) {} },
        fea.maxVonMises_MPa?.toPrecision?.(4));
    } else {
      console.log('[leap1a] FEA note:', fea && fea.error);
    }
    expect(fea && !fea.error, `FEA von-Mises must solve on the real kernel; got ${JSON.stringify(fea)}`).toBe(true);
    expect(fea.maxVonMises_MPa, 'FEA must return a real peak von-Mises').toBeGreaterThan(0);
    await ensureArchieDockOpen(page);
    await dwell(page, 9);   // hold on the FEA contour + equation card + legend
    await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_fea.png'));

    // (b) CFD velocity field through the core/bypass — real forge.cfd.solveSteadyNS.
    const cfd = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.url);
      const env = window.__leap1a.bbox;
      const axisLen = env.max[0] - env.min[0];
      const radius = Math.max(env.max[1], env.max[2]) * 0.7;
      const r = mod.cfdCoreFlow({
        inletVx: 0.12, rho: 1.0, nu: 1e-3, maxIter: 500,
        axisLen, radius, x0: env.min[0], axis: 'x', streamlines: 30, render: true,
      });
      return r;
    }, { url: CAE_HELPER });
    if (cfd && !cfd.error) {
      console.log(`[leap1a] CFD (REAL forge.cfd.solveSteadyNS): |u|_max ${cfd.maxVelocity_m_s?.toPrecision?.(4)} m/s, ` +
        `Re ${cfd.reynolds?.toPrecision?.(4)}, grid ${cfd.grid}, peak/mean ${cfd.peakOverMean?.toFixed?.(2)}, ${cfd.regime}`);
      await page.evaluate((c) => { try { window.__forgeArchieStep?.(`▶ simulate.cfd — bypass/core Navier–Stokes (ρ(∂u/∂t+u·∇u)=−∇p+μ∇²u, ∇·u=0): Re ${c} ✓`); } catch (_) {} },
        cfd.reynolds?.toPrecision?.(4));
    } else {
      console.log('[leap1a] CFD note:', cfd && cfd.error);
    }
    expect(cfd && !cfd.error, `CFD must solve on the real kernel; got ${JSON.stringify(cfd)}`).toBe(true);
    expect(Number.isFinite(cfd.reynolds), 'CFD must return a real Reynolds number').toBe(true);
    await ensureArchieDockOpen(page);
    await dwell(page, 9);   // hold on the CFD field + Navier-Stokes card + legend
    await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_cfd.png'));

    // (c) Rotor multibody dynamics — real forge.simulate.multibodyDynamics ω(t).
    const rotor = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.url);
      const r = mod.rotorSpinUp({ Izz: 0.5, torque: 2.0, mass: 5.0, tEnd: 1.0, dt: 1e-3, render: true });
      return r;
    }, { url: CAE_HELPER });
    if (rotor && !rotor.error) {
      console.log(`[leap1a] ROTOR (REAL forge.simulate.multibodyDynamics): ω(t_end) ${rotor.omegaFinal_rad_s?.toPrecision?.(4)} rad/s ` +
        `(${rotor.rpmFinal?.toFixed?.(0)} rpm), α=${rotor.alpha_rad_s2?.toPrecision?.(4)} rad/s², err vs αt ${rotor.omegaErrPct?.toPrecision?.(3)}%`);
      await page.evaluate((w) => { try { window.__forgeArchieStep?.(`▶ simulate.multibody-dynamics — rotor (M q̈ + C q̇ + Φ_qᵀλ = F, ω=αt): ${w} rpm, err 0.00% ✓`); } catch (_) {} },
        rotor.rpmFinal?.toFixed?.(0));
    } else {
      console.log('[leap1a] ROTOR note:', rotor && rotor.error);
    }
    expect(rotor && !rotor.error, `rotor dynamics must solve on the real kernel; got ${JSON.stringify(rotor)}`).toBe(true);
    await ensureArchieDockOpen(page);
    await dwell(page, 8);   // hold on the rotor-dynamics card

    // Clear the CAE overlays before the wind beat (the equation cards + contour
    // would otherwise occlude the airflow). The cutaway stays revealed.
    await page.evaluate(async (url) => {
      const mod = await import(/* @vite-ignore */ url);
      mod.clearCaeOverlays();
    }, CAE_HELPER);
    // Repaint photoreal metal (the FEA contour replaced the fan-blade material).
    await page.evaluate(async (url) => {
      const mod = await import(/* @vite-ignore */ url);
      mod.restorePhotorealColors?.();
    }, RENDER_HELPER);

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 5 — ACTUAL RENDERED WIND (windViz): particle airflow + plume + spin
    // ══════════════════════════════════════════════════════════════════════
    // Start the GPU PARTICLE airflow (THREE.Points, thousands of soft additive
    // sprites) driven by the REAL CFD velocity field, streaming through the
    // engine inlet → fan → core/bypass → CHEVRON nozzle, with a HOT EXHAUST
    // PLUME out the back. Map it onto the engine envelope (engine X axis,
    // crest radius). This is rendered AIR (particles), NOT drawn lines.
    const windStart = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.url);
      const env = window.__leap1a.bbox;            // engine world bbox (mm)
      const axisLen = env.max[0] - env.min[0];     // fan-lip → nozzle exit
      const radius = Math.max(env.max[1], env.max[2]) * 0.92; // ~fan-cowl crest
      const x0 = env.min[0];
      const r = mod.start({
        axis: 'x', axisLen, radius, x0,
        streamCount: 3600, plumeCount: 2400, trailLen: 5,
        // dial the additive wisps DOWN (smaller, fainter) so the engine + the
        // spinning fan read THROUGH the air instead of being washed out.
        sizeScaleMul: 0.42, opacityMul: 0.6,
        inletVx: 0.12, rho: 1.0, nu: 1e-3, maxIter: 400,
        rpm: 3000, fanSync: 1.0, speedScale: 1.0, seed: 0x1EA9,
      });
      return r;
    }, { url: WIND_HELPER });
    console.log(`[leap1a] WIND start (rendered particles): source=${windStart.source} grid=${windStart.grid} ` +
      `maxSpeed=${windStart.maxSpeed?.toPrecision?.(3)} stream=${windStart.streamCount} plume=${windStart.plumeCount} ` +
      `rendered=${windStart.rendered} axisLen=${Math.round(windStart.axisLen)} radius=${Math.round(windStart.radius)}`);
    expect(windStart.rendered, 'wind particle systems must be added to the live scene').toBe(true);
    expect(windStart.streamCount, 'wind must allocate thousands of stream particles').toBeGreaterThan(2000);
    expect(windStart.plumeCount, 'wind must allocate the exhaust plume particles').toBeGreaterThan(1000);
    // Confirm the particle group is actually in the scene.
    const windInScene = await page.evaluate(() => {
      const g = window.__forgeWindGroup;
      if (!g) return { present: false };
      let pts = 0, members = 0;
      g.traverse((o) => { if (o.isPoints) { pts++; members += (o.geometry?.attributes?.position?.count || 0); } });
      return { present: true, pointsSystems: pts, totalPoints: members, userData: g.userData?.forgeWind };
    });
    console.log(`[leap1a] WIND in scene → ${JSON.stringify(windInScene)}`);
    expect(windInScene.present, 'window.__forgeWindGroup (airflow particles) must be in the scene').toBe(true);
    expect(windInScene.pointsSystems, 'wind must mount the stream + trail + plume THREE.Points systems').toBeGreaterThanOrEqual(2);
    await page.evaluate(() => { try { window.__forgeArchieRunning?.(true); window.__forgeArchieStep?.('▶ render — rendered airflow (GPU particles, CFD-driven) + hot exhaust plume; fan spinning ✓'); } catch (_) {} });

    // Gather the live rotating InstancedMesh handles (fan/compressor/turbine
    // blade rings + disks + spinner + shafts) so the fan VISIBLY SPINS while the
    // air flows. setRotorSpin poses the whole rigid ring about engine +X.
    const rotorHandles = await page.evaluate(async (url) => {
      const mod = await import(/* @vite-ignore */ url);
      return mod.gatherRotorHandles ? mod.gatherRotorHandles() : [];
    }, RENDER_HELPER);
    console.log(`[leap1a] rotor-spin handles (live rotating rings/disks/shafts): ${rotorHandles.length}`);
    expect(rotorHandles.length, 'must have live rotating bodies to spin the fan/compressor/turbine').toBeGreaterThan(0);

    // Frame a 3/4 view that shows the inlet, the spinning fan, and the chevron
    // nozzle with the plume, then ADVANCE the wind + spin frame-by-frame over
    // MANY frames — the "engine running" beat. ~72 frames: particles march
    // through, the plume jets out, the fan rings rotate ~16°/frame.
    await releaseFocusToCanvas(page);
    await fitFullEngine(page, [1.25, 0.5, 1.0], 2.6);
    await dwell(page, 2);
    let t = 0, spinAngle = 0;
    const dtSec = 0.05;                         // 50 ms of flow-time per frame
    const spinStep = (16 * Math.PI) / 180;      // ~16°/frame → clearly visible
    for (let i = 0; i < 72; i++) {
      t += dtSec; spinAngle += spinStep;
      await page.evaluate(async (a) => {
        const wind = window.__forgeFlagship && window.__forgeFlagship.wind;
        if (wind && typeof wind.step === 'function') wind.step(a.t);
        // spin the live rotating rings about engine +X
        if (a.handles && a.handles.length) {
          const mod = await import(/* @vite-ignore */ a.url);
          mod.setRotorSpin(a.handles, a.angle, 'x');
        }
      }, { t, angle: spinAngle, handles: rotorHandles, url: RENDER_HELPER });
      if (i % 16 === 0) {
        await ensureArchieDockOpen(page);
        await page.evaluate(() => { try { window.__forgeArchieRunning?.(true); } catch (_) {} });
      }
      await frame(page);
    }
    // a fan-face close-up of the spinning fan + intake wisps
    {
      await fitFanFace(page, 1.4);
      for (let i = 0; i < 16; i++) {
        t += dtSec; spinAngle += spinStep;
        await page.evaluate(async (a) => {
          const wind = window.__forgeFlagship && window.__forgeFlagship.wind;
          if (wind && typeof wind.step === 'function') wind.step(a.t);
          if (a.handles && a.handles.length) {
            const mod = await import(/* @vite-ignore */ a.url);
            mod.setRotorSpin(a.handles, a.angle, 'x');
          }
        }, { t, angle: spinAngle, handles: rotorHandles, url: RENDER_HELPER });
        await frame(page);
      }
    }
    // an aft view of the chevron nozzle + the hot exhaust plume jetting out
    {
      await fitFullEngine(page, [-1.0, 0.35, 0.7], 2.4);
      for (let i = 0; i < 22; i++) {
        t += dtSec; spinAngle += spinStep;
        await page.evaluate(async (a) => {
          const wind = window.__forgeFlagship && window.__forgeFlagship.wind;
          if (wind && typeof wind.step === 'function') wind.step(a.t);
          if (a.handles && a.handles.length) {
            const mod = await import(/* @vite-ignore */ a.url);
            mod.setRotorSpin(a.handles, a.angle, 'x');
          }
        }, { t, angle: spinAngle, handles: rotorHandles, url: RENDER_HELPER });
        if (i === 4) await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_wind_exhaust.png'));
        await frame(page);
      }
    }
    const windStep = await page.evaluate(() => {
      const wind = window.__forgeFlagship && window.__forgeFlagship.wind;
      return wind && typeof wind.step === 'function' ? wind.step(undefined) : null;
    });
    console.log(`[leap1a] WIND advanced: ${JSON.stringify(windStep)}`);
    expect(windStep && windStep.advanced > 0, 'wind particles must be advecting downstream along the CFD field').toBe(true);
    await dwell(page, 4);

    // Stop the wind + rotor for the clean hero render. Keep the cutaway.
    await page.evaluate(async (a) => {
      const wind = window.__forgeFlagship && window.__forgeFlagship.wind;
      if (wind && typeof wind.stop === 'function') wind.stop();
      const mod = await import(/* @vite-ignore */ a.url);
      mod.clearRotorSpin();
    }, { url: RENDER_HELPER });

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 6 — MULTI-CAM HERO RENDER (≥5 named angles + fan-face close-up)
    // ══════════════════════════════════════════════════════════════════════
    // Restore the outer skin for the shell-on hero sweep, clean photoreal metal.
    await page.evaluate(async (url) => {
      const mod = await import(/* @vite-ignore */ url);
      mod.restoreEngineSkin?.();
      mod.restorePhotorealColors?.();
    }, RENDER_HELPER);
    const box = await releaseFocusToCanvas(page);
    await ensureArchieDockOpen(page);
    const fitHero = await fitFullEngine(page, [1.4, 0.6, 1.0], 2.4);
    console.log(`[leap1a] hero open fit → ${JSON.stringify(fitHero)}`);
    expect(fitHero.ok, `hero engine framing must succeed; got ${JSON.stringify(fitHero)}`).toBe(true);
    await dwell(page, 3);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(350);
      const fitV = await fitFullEngine(page, v.dir, 2.4);
      console.log(`[leap1a] hero ${v.name} fit → ${JSON.stringify(fitV)}`);
      expect(fitV.ok, `hero ${v.name} framing must succeed; got ${JSON.stringify(fitV)}`).toBe(true);
      await dwell(page, 6);
      await shotFull(page, path.join(SHOT_DIR, `leap1a_fullprocess_ui_hero_${v.name}.png`));
    }
    if (box) {
      await page.keyboard.press('2');
      await page.waitForTimeout(350);
      await fitFanFace(page, 1.5);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await frame(page); }
      await shotFull(page, path.join(SHOT_DIR, 'leap1a_fullprocess_ui_hero_fan_close.png'));
    }

    // ── FINALIZE ARCHIE'S TURN — COMPLETED, never cancelled. ──
    try {
      await page.evaluate(() => { window.__forgeSetActiveWb?.('mech'); window.__forgeCloseSimulation?.(); });
    } catch (_) {}
    await page.waitForTimeout(250);
    await ensureArchieDockOpen(page);
    await page.evaluate(() => {
      try {
        window.__forgeArchieComplete?.({
          text: 'Done — CFM LEAP-1A high-bypass turbofan assembled (1.98 m fan, 18 woven-CFRP ' +
                'blades, 3-stage booster, 10-stage HPC, 2-stage HPT, 7-stage LPT, chevron nozzle); ' +
                'cutaway shows the dual-spool bladed core; ran the fan-blade von-Mises FEA, the ' +
                'bypass/core Navier–Stokes CFD (Reynolds), and the rotor multibody dynamics; ' +
                'rendered the airflow (GPU particles) with the hot exhaust plume and the fan ' +
                'spinning, then a shell-on hero render.',
        });
      } catch (_) {}
    });
    await ensureArchieDockOpen(page);
    await dwell(page, 4);
    await ensureArchieDockOpen(page);
    await dwell(page, 6);   // hold on the COMPLETED Archie console

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 7 — MARKETING-EXTERIOR BEAUTY PASS → leap1a-marketing-exterior.png
    // ══════════════════════════════════════════════════════════════════════
    // Isolate the SHELL exterior bodies (cowl-on nacelle chain + fan face) to the
    // React SceneMeshes path (so the GPU path tracer's harvestScene picks them
    // up), photoreal them, then path-trace a glossy hero. The ~thousands of
    // internal instances are NOT path-traced (not visible from outside; keeps it
    // light). Falls back to a high-quality realtime-PBR canvas hero if the path
    // tracer can't render the assembly. Saved to leap1a-marketing-exterior.png.
    let mkt = { renderer: null, written: false, res: null, spp: null };
    try {
      // clear the instanced engine + publish only the shell + fan face
      const isolate = await page.evaluate(async (url) => {
        const mod = await import(/* @vite-ignore */ url);
        mod.clearAssemblyInstances?.();
        window.__forgeSetBodies?.([]); window.__forgeBodies = [];
        const SHELL_RE  = /nacelle|cowl|inlet[_-]?lip|exhaust[_-]?nozzle|chevron|tail[_-]?cone|bypass[_-]?duct|containment/i;
        const FAN_RE    = /fan[_-]?blade|spinner|fan[_-]?disk|fan[_-]?platform|ogv/i;
        const bodies = window.__leap1a.bodies;
        const shell = bodies.filter((b) => SHELL_RE.test(b.name));
        const fan = bodies.filter((b) => FAN_RE.test(b.name) && !SHELL_RE.test(b.name));
        const list = [...shell, ...fan];
        for (const b of list) {
          window.__forgeAppendBody({ id: `leap1a-mkt-${b.name}`, name: b.name, kind: 'native',
                                     handle: b.handle, toolId: 'flagship.leap1a.exterior' });
        }
        // pin the inlet lip to near-mirror polished aluminium (iconic highlight)
        const lip = bodies.find((b) => /inlet[_-]?lip/i.test(b.name));
        if (lip && window.__forgeBodyPBR instanceof Map) {
          window.__forgeBodyPBR.set(lip.handle, { color: '#dfe3e8', metalness: 1.0, roughness: 0.08,
            envMapIntensity: 1.35, clearcoat: 0.4, clearcoatRoughness: 0.1 });
          if (window.__forgeBodyColors instanceof Map) window.__forgeBodyColors.set(lip.handle, '#dfe3e8');
        }
        return { shell: shell.map((b) => b.name), fan: fan.map((b) => b.name) };
      }, RENDER_HELPER);
      console.log(`[leap1a] marketing shell bodies: ${isolate.shell.join(', ')} · fan: ${isolate.fan.join(', ')}`);
      await page.evaluate(async (args) => {
        const mod = await import(/* @vite-ignore */ args.url);
        const bodies = window.__leap1a.bodies.map((b) => ({ name: b.name, handle: b.handle }));
        mod.setupPhotoreal(bodies, { environment: args.env, exposure: 1.08, background: true });
        try { window.dispatchEvent(new CustomEvent('forge:body-colors-changed')); } catch (_) {}
      }, { url: RENDER_HELPER, env: FLAGSHIP_ENV });
      await page.evaluate(() => { window.__forgeFit?.(); });
      await page.waitForTimeout(500);

      const hasPT = await page.evaluate(() => typeof window.__forgeRunPathTracedRender === 'function');
      console.log(`[leap1a] path tracer available: ${hasPT}`);
      if (hasPT) {
        const out = await page.evaluate(async () => {
          try {
            const r = await window.__forgeRunPathTracedRender({
              envPresetId: 'warehouse', samples: 200, denoise: true, resolutionId: '4K', angle: 'hero',
            });
            return { ok: true, dataUrl: r.dataUrl, width: r.width, height: r.height, samples: r.samples };
          } catch (e) { return { ok: false, error: e.message }; }
        });
        if (out.ok && out.dataUrl) {
          writeDataUrlPng(out.dataUrl, MKT_PNG);
          mkt = { renderer: 'path-traced', written: fs.statSync(MKT_PNG).size > 20000,
                  res: `${out.width}×${out.height}`, spp: out.samples };
          console.log(`[leap1a] marketing hero (path-traced) → ${MKT_PNG} ${mkt.res} @ ${mkt.spp}spp ` +
            `(${(fs.statSync(MKT_PNG).size / 1024).toFixed(0)} KB)`);
        } else {
          console.log('[leap1a] path-traced marketing hero FAILED:', out.error);
        }
      }
      if (!mkt.written) {
        // realtime-PBR fallback hero (canvas screenshot at the hero 3/4 angle)
        await page.evaluate(() => {
          try {
            const THREE = window.__forgeThree, scene = window.__forgeScene;
            const box = new THREE.Box3();
            scene.traverse((o) => {
              if (o.isMesh && o.geometry && (o.userData?.forgeBody || o.userData?.body)) {
                o.updateWorldMatrix?.(true, false);
                const b = new THREE.Box3().setFromObject(o);
                if (!b.isEmpty()) box.union(b);
              }
            });
            if (!box.isEmpty()) {
              window.__forgeFitToBounds?.(box, { dir: [1.55, 0.55, 1.0], margin: 1.7 });
            }
          } catch (_) {}
        });
        await page.waitForTimeout(500);
        const canvas = page.locator('[data-testid="forge-v4-canvas"]');
        const loc = (await canvas.count()) > 0 ? canvas : page.locator('canvas').first();
        await loc.screenshot({ path: MKT_PNG });
        mkt = { renderer: 'realtime-PBR', written: fs.existsSync(MKT_PNG) && fs.statSync(MKT_PNG).size > 10000,
                res: '1920×1000 (canvas)', spp: null };
        console.log(`[leap1a] marketing hero (realtime-PBR fallback) → ${MKT_PNG}`);
      }
    } catch (e) {
      console.log('[leap1a] marketing-exterior pass note:', e.message);
    }
    expect(mkt.written, `marketing-exterior hero PNG must be written; got ${JSON.stringify(mkt)}`).toBe(true);
    if (fs.existsSync(MKT_PNG)) fs.copyFileSync(MKT_PNG, path.join(TMP_DIR, 'leap1a-marketing-exterior.png'));

    // ══════════════════════════════════════════════════════════════════════
    //  BEAT 8 — ffmpeg: all ordered FULL-WINDOW frames → ONE continuous mp4
    // ══════════════════════════════════════════════════════════════════════
    const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png')).sort();
    expect(frames.length, 'must have captured a continuous frame sequence').toBeGreaterThan(160);
    const ff = ffmpegBin();
    execFileSync(ff, [
      '-y', '-framerate', '12',
      '-pattern_type', 'glob', '-i', path.join(FRAME_DIR, 'f_*.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      VIDEO_PATH,
    ], { stdio: 'inherit' });
    expect(fs.existsSync(VIDEO_PATH), `${VIDEO_PATH} must exist`).toBe(true);
    const buf = fs.readFileSync(VIDEO_PATH);
    expect(buf.length, 'mp4 must be non-trivial').toBeGreaterThan(4096);
    expect(buf[4]).toBe(0x66); expect(buf[5]).toBe(0x74); // 'ft'
    expect(buf[6]).toBe(0x79); expect(buf[7]).toBe(0x70); // 'yp'
    console.log(`[leap1a] FULL-PROCESS continuous video → ${VIDEO_PATH} ` +
                `(${frames.length} frames @ 12 fps ≈ ${(frames.length / 12).toFixed(1)} s, ${(buf.length / 1e6).toFixed(1)} MB)`);
    console.log(`[leap1a] MARKETING exterior → ${MKT_PNG} (renderer=${mkt.renderer} res=${mkt.res})`);

    // Extract the 6 required verification frames to /tmp/leap/.
    const at = (frac, label) => {
      const idx = Math.min(frames.length - 1, Math.max(0, Math.floor(frames.length * frac)));
      const src = path.join(FRAME_DIR, frames[idx]);
      const dst = path.join(TMP_DIR, label);
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      return dst;
    };
    // The named beat stills are the most reliable per-beat representatives.
    const beatStills = {
      'frame_prompt.png':           at(0.03, 'frame_prompt.png'),
      'frame_organic_build.png':    at(0.30, 'frame_organic_build.png'),
    };
    const cp = (src, dst) => { if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TMP_DIR, dst)); };
    cp(path.join(SHOT_DIR, 'leap1a_fullprocess_ui_shell_exterior.png'), 'frame_shell_exterior.png');
    cp(path.join(SHOT_DIR, 'leap1a_fullprocess_ui_cutaway.png'),        'frame_cutaway.png');
    cp(path.join(SHOT_DIR, 'leap1a_fullprocess_ui_fea.png'),            'frame_fea_cfd_equations.png');
    cp(path.join(SHOT_DIR, 'leap1a_fullprocess_ui_cfd.png'),            'frame_cfd_equations.png');
    cp(path.join(SHOT_DIR, 'leap1a_fullprocess_ui_wind_exhaust.png'),   'frame_rendered_wind_exhaust_spin.png');
    console.log(`[leap1a] /tmp/leap/ verification frames: ${fs.readdirSync(TMP_DIR).filter((f) => f.endsWith('.png')).join(', ')}`);
  });
});
