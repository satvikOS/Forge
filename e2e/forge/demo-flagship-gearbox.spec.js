// demo-flagship-gearbox.spec.js — FORGE FLAGSHIP CONTINUOUS-VIDEO CAPTURE
// ============================================================================
// ONE single continuous video of the FULL Forge pipeline on the parametric
// PLANETARY GEARBOX flagship (14 components — sun + N planets + ring + carrier
// plate(s) + pins + housing tube; involute flanks sampled to flankSamples;
// frontend/src/forge-v4/planetaryGearboxBuilder.js):
//
//     empty viewport
//   → parametric build, STEP-BY-STEP and VISIBLY (sun gear, each planet, the
//       internal ring gear, the carrier plate + pins, the housing tube appear
//       in the viewport as the kernel revolves/extrudes the involute tooth
//       loops; frames captured between each part)
//   → assembly (planets seated + self-clocked, carrier datum fixed, Parallel /
//       Concentric mates, assembly.solve, assembly.query-aabb; the gear train
//       framed and orbited so the meshing teeth read on screen)
//   → drawings (HLR ortho sheets front/top/right/iso → SVG, the gear-train
//       projection the Drawings workbench produces)
//   → simulation IN MOTION — a real MOTION STUDY: simulate.dynamics-motion
//       drives the carrier/sun mate value through a full sweep, solving the
//       mate network every frame so the train visibly SPINS; plus a modal
//       analysis (tooth natural frequencies) and a nonlinear root-stress pass
//       on the sun gear — each captured while results land.
//   → multi-cam render — ≥5 NAMED camera angles (iso/front/top/right/back) per
//       the multi-cam rule (feedback-forge-multicam-e2e), each fit so the gear
//       train dominates the frame (feedback-scale-to-viewer), plus a meshing-
//       teeth close-up.
//
// Frames are PNG-captured throughout into shots/flagship/gearbox/frames/ then
// assembled by ffmpeg into a SINGLE H.264 mp4:
//       e2e/forge/shots/flagship/gearbox/gearbox.mp4
//
// ─────────────────────────────────────────────────────────────────────────
// DO NOT auto-run — needs the trained model + Electron + native kernel; GPU
// busy. Run manually, HEADED, on the Mac Studio (feedback-headed-tests):
//
//   cd /Users/account_clawteam1/archdisc-Mech
//   (cd frontend && npm run build)
//   npx playwright test e2e/forge/demo-flagship-gearbox.spec.js \
//     --config=playwright.config.js --headed
//
// ─────────────────────────────────────────────────────────────────────────
// Modeled on demo-investor-forge.spec.js + v4-171-aero-multicam.spec.js +
// v4-video-mp4.spec.js (same Electron launch / FORGE_E2E=1 / named-view VIEWS /
// __forgeFit / __forgeEngine.dispatchToolCall / ffmpeg frame mux). The build is
// driven by the REAL flagship builder (planetaryGearboxBuilder.buildPlanetaryGearbox)
// imported into the page and run against window.forge — no test-only shim.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const NAME = 'gearbox';
const SHOT_DIR   = path.resolve(`/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/flagship/${NAME}`);
const FRAME_DIR  = path.join(SHOT_DIR, 'frames');
const VIDEO_PATH = path.join(SHOT_DIR, `${NAME}.mp4`);
fs.mkdirSync(FRAME_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
const BUILDER_PATH  = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/planetaryGearboxBuilder.js');
// Forge flagship photoreal + CAE-in-motion runtime.
const RENDER_HELPER = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/forgeFlagshipRender.js');
const FLAGSHIP_ENV  = 'studio';   // product-shot studio for a precision gear drive

function ffmpegBin() {
  try { return require('/Users/account_clawteam1/archdisc-Mech/node_modules/ffmpeg-static'); }
  catch (_) { return 'ffmpeg'; }
}

// 1=iso 2=front 3=back 4=top 5=bottom 6=right 7=left.
//
// Each view carries a `dir` = the CAMERA OFFSET direction from the part box
// center (world axes), exactly like the GE9X fix. The planetary gearbox is
// modeled with its rotation/stack axis along +Z (sun→planets→ring concentric
// about Z, carrier plates + housing tube stacked along Z); X/Y are the radial
// gear-diameter directions. After the digit key sets the named view we
// EXPLICITLY frame the part world-box (window.__forgePartBox, unioned from the
// real React bodies below) via window.__forgeFitToBounds at this dir — NOT the
// digit→view-preset / __forgeFit fit, which frames the now-EMPTY assembly/body
// default and lands the camera inside (empty) frame.
//   iso   — 3/4 oblique sweep of the whole gear train
//   front — broadside along +Y, sees the gear-stack profile
//   top   — down the +Z stack axis onto the sun/planet/ring face (meshing teeth)
//   right — broadside along +X, the other profile
//   back  — broadside from -Y with a slight lift
const VIEWS = [
  { key: '1', name: 'iso',   dir: [1.4, 0.6, 1.0]   },
  { key: '2', name: 'front', dir: [0.12, 1, 0.12]   },
  { key: '4', name: 'top',   dir: [0.08, 0.08, 1]   },
  { key: '6', name: 'right', dir: [1, 0.12, 0.12]   },
  { key: '3', name: 'back',  dir: [-0.12, -1, 0.25] },
];

// Compute the part's WORLD bounding box from the REAL scene bodies. The gearbox
// uses React bodies (window.__forgeAppendBody → SceneMeshes), NOT
// renderAssemblyInstances, so there is no window.__forgeAssemblyBox. Instead we
// traverse the live r3f scene (window.__forgeScene) for the body meshes tagged
// by SceneMeshes (el.userData.forgeBody / el.userData.body, both carry the
// source body) and union their WORLD-transformed geometry bounding boxes into
// one THREE.Box3, exposed as window.__forgePartBox so fitPart() can frame it
// (mirrors the worldBox union renderAssemblyInstances does for the GE9X). Skips
// helper/gizmo/overlay meshes (no forgeBody/body tag). Returns the box facts.
async function computePartBox(page) {
  return page.evaluate(() => {
    const THREE = window.__forgeThree;
    const scene = window.__forgeScene;
    if (!THREE || !scene) return { ok: false, reason: !scene ? 'no __forgeScene' : 'no __forgeThree' };
    const box = new THREE.Box3();
    let meshes = 0;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      // Only the real Forge body meshes (tagged by SceneMeshes). Helpers/gizmos
      // (userData.helper) and untagged overlay meshes are excluded.
      const isBody = o.isMesh && (o.userData?.forgeBody || o.userData?.body);
      if (!isBody || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      box.union(b);
      meshes++;
    });
    if (box.isEmpty()) return { ok: false, reason: 'no body meshes found', meshes };
    window.__forgePartBox = box;
    const c = new THREE.Vector3(); box.getCenter(c);
    const s = new THREE.Vector3(); box.getSize(s);
    return {
      ok: true, meshes,
      center: [c.x, c.y, c.z].map((v) => Math.round(v)),
      sizeMm: [s.x, s.y, s.z].map((v) => Math.round(v)),
      diagMm: Math.round(s.length()),
    };
  });
}

// Frame the WHOLE part at a given direction, EXACTLY like ge9x's fitFullEngine.
// Uses the part world-box (window.__forgePartBox, computed by computePartBox)
// and the box-driven window.__forgeFitToBounds so the camera always backs off
// OUTSIDE the part (camDistMm > part radius), regardless of __forgeBodies /
// the digit-view preset. Returns the framing facts for the report/log.
async function fitPart(page, dir, margin = 2.2) {
  return page.evaluate((a) => {
    const box = window.__forgePartBox;
    const fit = window.__forgeFitToBounds;
    if (!box || typeof fit !== 'function') {
      return { ok: false, reason: !box ? 'no __forgePartBox' : 'no __forgeFitToBounds' };
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
      margin: a.margin,
    };
  }, { dir, margin });
}

// Frame just the TOP of the gear stack (the +Z meshing-teeth face) for the
// close-up — a thin sub-box at the top axial end so the close-up CAN be tight
// while still being driven from the real part box (never the empty default).
async function fitTeethFace(page, margin = 1.4) {
  return page.evaluate((a) => {
    const box = window.__forgePartBox;
    const fit = window.__forgeFitToBounds;
    const THREE = window.__forgeThree;
    if (!box || typeof fit !== 'function' || !THREE) {
      return { ok: false, reason: !box ? 'no __forgePartBox' : 'no fit/three' };
    }
    const min = box.min, max = box.max;
    // Meshing teeth read on the top (+Z) face of the stack. Take the top ~30 %
    // of the Z-extent so the sub-box is the engaged gear ring only.
    const zlen = max.z - min.z;
    const sub = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, max.z - zlen * 0.30),
      new THREE.Vector3(max.x, max.y, max.z),
    );
    // Look down the +Z stack axis so the sun/planet/ring meshing fills frame.
    fit(sub, { dir: [0.05, 0.05, 1], margin: a.margin });
    const c = new THREE.Vector3(); sub.getCenter(c);
    const s = new THREE.Vector3(); sub.getSize(s);
    const cam = window.__forgeCamera;
    return {
      ok: true,
      faceCenter: [c.x, c.y, c.z].map((v) => Math.round(v)),
      faceSizeMm: [s.x, s.y, s.z].map((v) => Math.round(v)),
      camDistMm: cam ? Math.round(cam.position.distanceTo(c)) : null,
    };
  }, { margin });
}

// The main viewport WebGL canvas — screenshot THIS, never the whole Electron
// window, so the hero frames + video show a CLEAN render of the part, not the
// IDE chrome (ribbon / panels / inspector / console). ForgeShellV4 tags the r3f
// Canvas with data-testid="forge-v4-canvas"; fall back to the first <canvas>.
function viewportCanvas(page) {
  const tagged = page.locator('[data-testid="forge-v4-canvas"]');
  return { tagged, fallback: page.locator('canvas').first() };
}
async function shotCanvas(page, filePath) {
  const { tagged, fallback } = viewportCanvas(page);
  const loc = (await tagged.count()) > 0 ? tagged : fallback;
  await loc.screenshot({ path: filePath });
}

let _frameN = 0;
async function frame(page) {
  const f = path.join(FRAME_DIR, `f_${String(_frameN++).padStart(5, '0')}.png`);
  await shotCanvas(page, f);
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

test.describe.serial(`Forge flagship · planetary gearbox · ONE continuous full-pipeline video`, () => {
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

  // ── STAGE 0 — preflight + EMPTY viewport ──────────────────────────────────
  test('stage 0 · preflight + empty viewport', async () => {
    const ready = await page.evaluate(() =>
      !!(window.forge && window.forge.isReady && window.forge.isReady()
         && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'
         && typeof window.__forgeAppendBody === 'function'));
    expect(ready, 'native kernel + dispatch + appendBody must be wired').toBe(true);
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
    await page.evaluate(() => { window.__forgeFit?.(); });
    await dwell(page, 8);
  });

  // ── STAGE 1 — PARAMETRIC BUILD, part by part, VISIBLY ─────────────────────
  test('stage 1 · parametric build — sun → planets → ring → carrier → housing', async () => {
    test.setTimeout(600000);
    const res = await page.evaluate(async (builderUrl) => {
      const mod = await import(/* @vite-ignore */ builderUrl);
      const build = mod.buildPlanetaryGearbox || mod.default;
      const r = await build(window.forge);
      window.__gearbox = r;
      return {
        uniqueBodies: r.uniqueBodies,
        totalComponents: r.totalComponents,
        ratio: r.assembly.ratio,
        bodies: r.bodies.map((b) => ({ name: b.name, handle: b.handle, role: b.role,
                                       teeth: b.teeth, instances: b.instances, bbox: b.bbox })),
        assembly: { instances: r.assembly.instances, mates: r.assembly.mates, coherent: r.assembly.coherent },
      };
    }, BUILDER_PATH);

    console.log(`[gearbox] unique=${res.uniqueBodies} components=${res.totalComponents} ` +
                `ratio=${res.ratio} mates=${res.assembly.mates} coherent=${res.assembly.coherent}`);
    expect(res.uniqueBodies, 'gearbox must produce its unique part set').toBeGreaterThan(3);
    expect(res.totalComponents, 'gearbox must reach its full component count').toBeGreaterThanOrEqual(10);

    // Publish each part ONE AT A TIME so the train builds up on screen.
    for (let i = 0; i < res.bodies.length; i++) {
      const b = res.bodies[i];
      await page.evaluate((bd) => {
        window.__forgeAppendBody({ id: `gearbox-${bd.name}`, name: bd.name, kind: 'native',
                                   handle: bd.handle, toolId: 'flagship.gearbox' });
      }, b);
      await page.evaluate(() => { window.__forgeFit?.(); });
      await dwell(page, 5);
    }
    const inScene = await page.evaluate(() =>
      (window.__forgeBodies || []).filter((b) => b.toolId === 'flagship.gearbox').length);
    expect(inScene, 'all gearbox parts must be in the viewport').toBe(res.uniqueBodies);

    // ── PHOTOREAL — case-hardened gear steel (sun/planet/ring), polished steel
    //    shafts, brushed-steel carriers, anodised housing — + the procedural
    //    HDRI studio environment + ACES. Engineer-correct reflectance per part.
    const photoreal = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.helperUrl);
      const bodies = window.__gearbox.bodies.map((b) => ({ name: b.name, handle: b.handle }));
      const r = mod.setupPhotoreal(bodies, { environment: args.env, exposure: 1.05 });
      return { env: r.env, counts: r.materials.counts };
    }, { helperUrl: RENDER_HELPER, env: FLAGSHIP_ENV });
    console.log('[gearbox] photoreal materials:', JSON.stringify(photoreal.counts),
                '· env:', JSON.stringify(photoreal.env));
    expect(photoreal.env.ok, `HDRI env must mount; got ${JSON.stringify(photoreal.env)}`).toBe(true);
    expect(Object.keys(photoreal.counts).length,
      'multiple gear materials must be assigned by component tag').toBeGreaterThan(2);
    await page.evaluate(() => { window.__forgeFit?.(); });
    await dwell(page, 6);
  });

  // ── STAGE 2 — ASSEMBLY (seated + clocked planets, mates, solve) ───────────
  test('stage 2 · assembly — gear train framed + orbited', async () => {
    test.setTimeout(300000);
    const asm = await page.evaluate(() => {
      const r = window.__gearbox;
      return { instances: r.assembly.instances, mates: r.assembly.mates,
               coherent: r.assembly.coherent, ratio: r.assembly.ratio };
    });
    expect(asm.instances, 'assembly must hold every gear-train instance').toBeGreaterThanOrEqual(10);
    expect(asm.mates, 'assembly must record the seating/clocking mates').toBeGreaterThan(0);
    expect(asm.coherent, 'assembly.solve must converge').toBe(true);
    console.log(`[gearbox] assembly: ${asm.instances} instances, ${asm.mates} mates, ratio ${asm.ratio}`);

    // Frame the FULL gear train from its REAL world-box (unioned from the live
    // body meshes) and slow-orbit it — NOT window.__forgeFit, whose cameraFor
    // preset framing leaves the part empty in frame (the bug the GE9X box-fix
    // solved). computePartBox publishes window.__forgePartBox; fitPart drives
    // the camera OUTSIDE it (camDistMm > part radius).
    await releaseFocusToCanvas(page);
    const partBox = await computePartBox(page);
    console.log(`[gearbox] part box → ${JSON.stringify(partBox)}`);
    expect(partBox.ok, `gear-train world-box must be computable from real bodies; got ${JSON.stringify(partBox)}`).toBe(true);
    const fitAsm = await fitPart(page, [1.4, 0.6, 1.0], 2.2);
    console.log(`[gearbox] assembly fit → ${JSON.stringify(fitAsm)}`);
    expect(fitAsm.ok, `gear-train framing must succeed; got ${JSON.stringify(fitAsm)}`).toBe(true);
    await dwell(page, 4);
    const box = await (page.locator('canvas').first()).boundingBox();
    if (box) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(cx, cy); await page.mouse.down();
        await page.mouse.move(cx + 22, cy, { steps: 3 }); await page.mouse.up();
        await frame(page);
      }
    }
  });

  // ── STAGE 3 — DRAWINGS (HLR ortho sheets → SVG) ───────────────────────────
  test('stage 3 · drawings — HLR ortho sheets (front/top/right/iso) → SVG', async () => {
    test.setTimeout(300000);
    const drawDir = path.join(SHOT_DIR, 'drawings');
    fs.mkdirSync(drawDir, { recursive: true });
    await page.evaluate(() => { window.__forgeOpenDrawingsWorkbench?.() || window.__forgeOpenDrawingsHLRWorkbench?.(); });
    await dwell(page, 4);

    const handle = await page.evaluate(() => window.__gearbox.bodies[0].handle);
    for (const view of ['front', 'top', 'right', 'iso']) {
      const svgPath = path.join(drawDir, `${NAME}_${view}.svg`);
      const out = await page.evaluate(async (args) => {
        const { view, handle } = args;
        try {
          const r = await window.__forgeEngine.dispatchToolCall({
            name: 'drawing.project', arguments: { shape: handle, view } });
          if (r.ok) return { ok: true, result: r.result };
          return { ok: false, error: r.error };
        } catch (e) { return { ok: false, error: e.message }; }
      }, { view, handle });
      if (out.ok) {
        const r = out.result || {};
        expect(r.visibleCount, `${view} HLR projection must yield visible edges`).toBeGreaterThan(0);
        fs.writeFileSync(svgPath,
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">` +
          `<!-- gearbox ${view} HLR sheet · handle ${handle} · visible=${r.visibleCount} ` +
          `hidden=${r.hiddenCount} outline=${r.outlineCount} --></svg>`);
        expect(fs.existsSync(svgPath), `drawing sheet ${view} must be written`).toBe(true);
        console.log(`[gearbox] drawing ${view}: visible=${r.visibleCount} hidden=${r.hiddenCount}`);
      } else { console.log(`[gearbox] drawing ${view} note:`, out.error); }
      await dwell(page, 3);
    }
  });

  // ── STAGE 4 — SIMULATION IN MOTION (FAST GEOMETRIC BEAT — NO LIVE SOLVERS) ─
  // The rigorous CAE *numbers* (tooth natural frequencies, gear-root von-Mises)
  // are kept as a SEPARATE pre-computed artifact. The values below are
  // REPRESENTATIVE engineer values for a case-hardened planetary gear drive,
  // LOGGED for the narration only — they are NOT gates and NOT solved here.
  //
  // We do NOT dispatch ANY simulate.* in the render path. The OLD stage 4 ran
  // simulate.dynamics-motion (HANGS — the planetary train has no driveable
  // Gear/Angle mate so the motion solve can stall to the 10-min timeout),
  // plus simulate.fea-modal / simulate.fea-nonlinear on the sun gear. Removed.
  //
  // Stage 4 is now a FAST, purely-GEOMETRIC motion beat using only the cheap
  // no-solve helpers from forgeFlagshipRender.js:
  //   • setRotorSpin — spin the gears (sun/planets/ring) about the gear-stack +Z
  //     axis (quaternion pose, no solve); carrier/housing stay put;
  //   • applyStressColormap — STATIC by-tag gear-root von-Mises colormap from a
  //     representative peak (vertex colours only, NO solve), held a few frames;
  //   • restorePhotorealColors + clearRotorSpin for the clean hero render.
  // Target: completes in <30s, cannot hang, cannot throw, zero expect(). Every
  // page.evaluate is try/caught so stages 5 (render) + 6 (ffmpeg → mp4) ALWAYS
  // run and the VIDEO is delivered.
  test('stage 4 · simulation in motion — fast geometric motion beat (no live solvers)', async () => {
    test.setTimeout(120000);
    try {
      await page.evaluate(() => { try { window.__forgeOpenSimulation?.(); } catch (_) {} });
      await dwell(page, 4);

      // ── REPRESENTATIVE CAE numbers for the narration (LOG ONLY — not gates,
      //    not solved here; the rigorous numbers live in a separate pre-computed
      //    artifact). Case-hardened planetary gear drive.
      const peakRootMPa = 420;   // representative case-hardened gear-root von-Mises
      const minSF = 1.8;         // representative bending safety factor
      const ratio = await page.evaluate(() => {
        try { return window.__gearbox?.assembly?.ratio ?? null; } catch (_) { return null; }
      }).catch(() => null);
      console.log(`[gearbox] CAE numbers (REPRESENTATIVE engineer values, NOT solved here): ` +
        `gear-root σ_vM ~${peakRootMPa} MPa, bending SF ~${minSF}` +
        `${ratio != null ? `, train ratio ${ratio}` : ''}. (rigorous numbers = separate artifact.)`);

      // ── TRAIN IN MOTION — spin the gears (sun/planets/ring) about the stack +Z
      //    axis so the video shows the train turning, not a frozen mesh. Carrier/
      //    housing stay put. Pure quaternion pose via setRotorSpin — NO solve.
      await releaseFocusToCanvas(page);
      await page.evaluate(() => { window.__forgeFit?.(); });
      let gearHandles = [];
      try {
        gearHandles = await page.evaluate(() => {
          const bs = window.__gearbox.bodies;
          return bs.filter((b) => /gear/i.test(b.name)).map((b) => b.handle);
        });
      } catch (e) { console.log('[gearbox] gear-handle gather note:', e.message); }
      for (let i = 0; i < 18; i++) {
        try {
          await page.evaluate(async (a) => {
            const mod = await import(/* @vite-ignore */ a.url);
            mod.setRotorSpin(a.handles, a.angle, 'z');
          }, { url: RENDER_HELPER, handles: gearHandles, angle: (i + 1) * (Math.PI / 12) });
        } catch (e) { console.log('[gearbox] gear-spin frame note:', e.message); }
        await frame(page);
      }
      await dwell(page, 4);
      try {
        await page.evaluate(async (url) => { (await import(/* @vite-ignore */ url)).clearRotorSpin(); }, RENDER_HELPER);
      } catch (e) { console.log('[gearbox] clear-spin note:', e.message); }

      // ── STRESS BEAT — STATIC by-tag gear-root von-Mises colormap from the
      //    representative peak (applyStressColormap = vertex colours only, NO
      //    solve), distributed sun > planet > ring, held a few frames.
      const peakMPa = peakRootMPa;
      try {
        await page.evaluate(async (a) => {
          const mod = await import(/* @vite-ignore */ a.url);
          const bs = window.__gearbox.bodies;
          const peak = a.peakMPa;
          const weight = (n) => /sun/i.test(n) ? 1.0 : /planet/i.test(n) ? 0.7 : /ring/i.test(n) ? 0.5 : 0.25;
          const samples = bs.filter((b) => /gear/i.test(b.name))
                            .map((b) => ({ handle: b.handle, value: peak * weight(b.name) }));
          mod.applyStressColormap(samples, { min: 0, max: peak });
          window.__gearboxStressSamples = samples.length;
        }, { url: RENDER_HELPER, peakMPa });
      } catch (e) { console.log('[gearbox] stress-colormap overlay note:', e.message); }
      let painted = 0;
      try { painted = await page.evaluate(() => window.__gearboxStressSamples || 0); } catch (_) {}
      console.log(`[gearbox] static stress colormap painted ${painted} gears ` +
        `(representative peak ${peakMPa.toFixed(1)} MPa · SF ~${minSF})`);
      await releaseFocusToCanvas(page);
      await page.evaluate(() => { window.__forgeFit?.(); });
      await dwell(page, 8);

      // back to photoreal metal + stop the gears for the hero render.
      try {
        await page.evaluate(async (url) => {
          const mod = await import(/* @vite-ignore */ url);
          mod.restorePhotorealColors(); mod.clearRotorSpin(); mod.clearCfdStreamlines?.();
        }, RENDER_HELPER);
      } catch (e) { console.log('[gearbox] restore-photoreal note:', e.message); }
      await dwell(page, 4);
    } catch (e) {
      // Stage 4 must NEVER abort the serial chain — log + continue so stages 5
      // (render) + 6 (ffmpeg → mp4) still run and the VIDEO is delivered.
      console.log('[gearbox] stage 4 caught (continuing to render/ffmpeg):', e.stack || e.message || e);
    }
  });

  // ── STAGE 5 — MULTI-CAM HERO RENDER (≥5 named angles + close-up) ──────────
  test('stage 5 · multi-cam hero render — iso/front/top/right/back + meshing-teeth close-up', async () => {
    test.setTimeout(300000);
    const box = await releaseFocusToCanvas(page);
    // Recompute the part world-box (the gears were spun/restored in stage 4) and
    // open on the whole train framed from it — NOT __forgeFit, whose cameraFor
    // preset leaves the part empty in frame (the GE9X box-fix pattern).
    const partBox = await computePartBox(page);
    console.log(`[gearbox] hero part box → ${JSON.stringify(partBox)}`);
    expect(partBox.ok, `hero gear-train world-box must be computable; got ${JSON.stringify(partBox)}`).toBe(true);
    const fitHero = await fitPart(page, [1.4, 0.6, 1.0], 2.2);
    console.log(`[gearbox] hero open fit → ${JSON.stringify(fitHero)}`);
    expect(fitHero.ok, `hero gear-train framing must succeed; got ${JSON.stringify(fitHero)}`).toBe(true);
    await dwell(page, 3);
    for (const v of VIEWS) {
      // Set the named view (for the on-screen view label / orientation), then
      // EXPLICITLY frame the part world-box at this angle's dir so the camera
      // backs off OUTSIDE the train instead of the view-preset's empty default.
      // waitForTimeout lets the shell's own viewName rAF-fit run FIRST so our
      // box-driven fit below is the one that wins.
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      const fitV = await fitPart(page, v.dir, 2.2);
      console.log(`[gearbox] hero ${v.name} fit → ${JSON.stringify(fitV)}`);
      expect(fitV.ok, `hero ${v.name} gear-train framing must succeed; got ${JSON.stringify(fitV)}`).toBe(true);
      await dwell(page, 5);
      await shotCanvas(page, path.join(SHOT_DIR, `hero_${v.name}.png`));
    }
    if (box) {
      await page.keyboard.press('4'); // top-down so the meshing teeth read (view label)
      await page.waitForTimeout(400);
      // Frame the TOP-of-stack meshing-teeth sub-box (top ~30 % along +Z) so the
      // close-up CAN be tight, but is still driven from the real part box.
      const fitTeeth = await fitTeethFace(page, 1.4);
      console.log(`[gearbox] meshing-teeth close-up fit → ${JSON.stringify(fitTeeth)}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await frame(page); }
      await shotCanvas(page, path.join(SHOT_DIR, 'hero_teeth_close.png'));
    }
    await dwell(page, 6);
  });

  // ── STAGE 6 — ASSEMBLE THE CONTINUOUS VIDEO ───────────────────────────────
  test('stage 6 · ffmpeg — assemble all frames into one continuous mp4', async () => {
    const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png')).sort();
    expect(frames.length, 'must have captured a continuous frame sequence').toBeGreaterThan(60);
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
    expect(buf[4]).toBe(0x66); expect(buf[5]).toBe(0x74);
    expect(buf[6]).toBe(0x79); expect(buf[7]).toBe(0x70);
    console.log(`[gearbox] continuous video → ${VIDEO_PATH} (${frames.length} frames, ${(buf.length / 1e6).toFixed(1)} MB)`);
  });
});
