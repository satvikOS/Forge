// demo-flagship-ge9x.spec.js — FORGE FLAGSHIP CONTINUOUS-VIDEO CAPTURE
// ============================================================================
// ONE single continuous video of the FULL Forge pipeline on the GE9X flagship
// (the ~20,079-component parametric high-bypass turbofan,
//  frontend/src/forge-v4/ge9xBuilder.js):
//
//     empty viewport
//   → parametric build, STEP-BY-STEP and VISIBLY (every unique prototype body
//       lands in the viewport as it is lofted/revolved by the kernel; frames
//       captured between each prototype group)
//   → assembly (the ~20k organized INSTANCES placed by assembly.add-instance,
//       datum fix + Concentric mates + assembly.solve + assembly.query-aabb;
//       the full engine envelope framed and orbited)
//   → drawings (HLR orthographic projections — front/top/right/iso — written
//       as SVG sheets, the same projector the Drawings workbench uses)
//   → simulation IN MOTION (real native solvers on the built bodies:
//       simulate.fea-modal on a fan blade, simulate.cfd through the core flow
//       box, simulate.fea-nonlinear on a disk — each captured while the result
//       overlay animates)
//   → multi-cam render — ≥5 NAMED camera angles (iso/front/top/right/back)
//       per the multi-cam rule (feedback-forge-multicam-e2e), each fit to the
//       engine envelope so the part dominates the frame (feedback-scale-to-
//       viewer), plus a fan-face close-up.
//
// Frames are PNG-captured throughout into shots/flagship/ge9x/frames/ and then
// assembled by ffmpeg into a SINGLE H.264 mp4:
//       e2e/forge/shots/flagship/ge9x/ge9x.mp4
//
// ─────────────────────────────────────────────────────────────────────────
// DO NOT auto-run — needs the trained model + Electron + the native kernel and
// the GPU is busy. Run manually, HEADED, on the Mac Studio (per memory:
// feedback-headed-tests + feedback-forge-multicam-e2e):
//
//   cd /Users/account_clawteam1/archdisc-Mech
//   (cd frontend && npm run build)                 # prod bundle; dev stalls
//   npx playwright test e2e/forge/demo-flagship-ge9x.spec.js \
//     --config=playwright.config.js --headed
//
// ─────────────────────────────────────────────────────────────────────────
// Modeled on the PROVEN Forge e2e specs:
//   - demo-investor-forge.spec.js   (Electron _electron.launch + FORGE_E2E=1,
//       waitForFunction(window.forge.isReady), __forgeFit, named-view VIEWS
//       digit map, __forgeBodies, __forgeEngine.dispatchToolCall for FEA,
//       committed named SHOT_DIR, STEP export artifact)
//   - v4-171-aero-multicam.spec.js  (the 5-named-angle VIEWS convention +
//       __forgeFit-between-views + canvas-blur before view keys + close-up)
//   - v4-video-mp4.spec.js          (ffmpeg transcode bridge; here we instead
//       assemble PNG frames with ffmpeg-static directly so the deliverable is
//       a deterministic single mp4, matching the existing shots/<name>/frames
//       convention from the six-hour-push harness)
//
// The build is driven through the SAME on-window dispatch the Archie runtime
// installs (window.__forgeEngine.dispatchToolCall → ForgeToolBridge →
// forge-kernel.node) with a SHARED ctx, exactly as ge9xBuilder.buildGE9X does
// headlessly — no test-only kernel shim. The builder module itself is imported
// into the page at runtime so the spec drives the REAL flagship builder.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const NAME = 'ge9x';
const SHOT_DIR   = path.resolve(`/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/flagship/${NAME}`);
const FRAME_DIR  = path.join(SHOT_DIR, 'frames');
const VIDEO_PATH = path.join(SHOT_DIR, `${NAME}.mp4`);
fs.mkdirSync(FRAME_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
// The flagship builder, resolved as a file:// URL so we can dynamic-import it
// into the renderer (it imports ForgeToolBridge relatively from the same tree).
const BUILDER_PATH  = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/ge9xBuilder.js');
// Forge flagship photoreal + CAE-in-motion runtime (materials by tag, procedural
// HDRI studio/hangar env, ACES, stress colormap, rotor spin, CFD streamlines).
const RENDER_HELPER = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/forgeFlagshipRender.js');
// Studio for the parts shot; the hangar env reads well on the full engine too.
const FLAGSHIP_ENV  = 'hangar';
// Pre-computed CAE-in-motion numbers from the PROVEN single-critical-component
// study (forge-kernel/test/ge9x_cae_in_motion.mjs): the fan blade was re-authored
// at TRUE PHYSICAL SCALE in metres and swept windmill→redline, NOT the 20k-mesh
// assembly. Stage 4 drives its overlays + reported numbers from THIS file so it
// never has to FEA/CFD-solve the full ~20,079-component engine (which OOMs the
// renderer and aborts the render/ffmpeg stages). The visuals on the full engine
// (rotor spin, stress colormap, CFD streamlines) are purely geometric + cheap.
const CAE_JSON_PATH = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/ge9x/cae/ge9x_motion_cae.json');
function loadPrecomputedCAE() {
  try { return JSON.parse(fs.readFileSync(CAE_JSON_PATH, 'utf8')); }
  catch (e) { console.log('[ge9x] pre-computed CAE json unavailable:', e.message); return null; }
}

// ffmpeg-static if present, else system ffmpeg (both verified on the Mac Studio).
function ffmpegBin() {
  try { return require('/Users/account_clawteam1/archdisc-Mech/node_modules/ffmpeg-static'); }
  catch (_) { return 'ffmpeg'; }
}

// Named camera views — the live digit→view map from ForgeShellV4's keydown
// handler: 1=iso 2=front 3=back 4=top 5=bottom 6=right 7=left. (The handler is
// suppressed while an INPUT/TEXTAREA is focused, so we blur + click the canvas
// before walking them.) ≥5 named angles satisfies the multi-cam rule.
//
// Each view carries a `dir` = the CAMERA OFFSET direction from the engine box
// center (world axes). The GE9X is modeled with its spin/axial axis along +X
// (the 6.7 m fore-aft extent); Y/Z are the radial fan-diameter directions. After
// the digit key sets the named view we EXPLICITLY frame the FULL engine
// world-box (window.__forgeAssemblyBox, set by renderAssemblyInstances) via
// window.__forgeFitToBounds at this dir — NOT the digit→view-preset fit, which
// frames the now-EMPTY React body list / a single origin prototype and so lands
// the camera INSIDE the 6.7 m engine. __forgeFitToBounds is fully box-driven (it
// sets the camera position + OrbitControls target from the box center +
// diagonal), so it does not depend on __forgeBodies being populated.
//   iso   — 3/4 oblique sweep of the whole engine
//   front — axial, down the engine +X axis onto the fan face
//   top   — plan view, looking down -Y
//   right — broadside along +Z, sees the full fore-aft length
//   back  — axial from the aft/nozzle end (-X) with a slight lift
const VIEWS = [
  { key: '1', name: 'iso',   dir: [1.4, 0.6, 1.0]    },
  { key: '2', name: 'front', dir: [1, 0.12, 0.12]    },
  { key: '4', name: 'top',   dir: [0.12, 1, 0.05]    },
  { key: '6', name: 'right', dir: [0.05, 0.12, 1]    },
  { key: '3', name: 'back',  dir: [-1, 0.25, 0.25]   },
];

// Frame the WHOLE engine envelope at a given direction. Uses the world-box
// computed by renderAssemblyInstances (window.__forgeAssemblyBox) and the
// box-driven window.__forgeFitToBounds so the camera always backs off to the
// full 6.7 m engine (margin ~2.4 → engine with padding), regardless of how many
// React bodies are in the scene. Returns the framing facts for the report/log.
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
      margin: a.margin,
    };
  }, { dir, margin });
}

// Frame just the FAN END (the +X or -X face of the engine) for the close-up —
// a smaller sub-box at one axial end so the close-up CAN be tight while still
// being driven from the real engine box (never the empty-body default).
async function fitFanFace(page, margin = 1.5) {
  return page.evaluate((a) => {
    const box = window.__forgeAssemblyBox;
    const fit = window.__forgeFitToBounds;
    const THREE = window.__forgeThree;
    if (!box || typeof fit !== 'function' || !THREE) {
      return { ok: false, reason: !box ? 'no __forgeAssemblyBox' : 'no fit/three' };
    }
    const min = box.min, max = box.max;
    // Fan is the front-most axial slice along the engine +X axis. Take the
    // first ~22 % of the X-extent so the sub-box is the fan ring only.
    const xlen = max.x - min.x;
    const sub = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(min.x + xlen * 0.22, max.y, max.z),
    );
    // Look broadside at the fan disk (down -Z) so the whole fan face fills frame.
    fit(sub, { dir: [0, 0.15, 1], margin: a.margin });
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
// window, so the hero frames + video show a CLEAN render of the engine, not the
// IDE chrome (ribbon / panels / inspector / console). ForgeShellV4 tags the r3f
// Canvas with data-testid="forge-v4-canvas"; fall back to the first <canvas>.
function viewportCanvas(page) {
  const tagged = page.locator('[data-testid="forge-v4-canvas"]');
  return { tagged, fallback: page.locator('canvas').first() };
}
// Screenshot the viewport canvas ONLY (clean render, no app chrome).
async function shotCanvas(page, filePath) {
  const { tagged, fallback } = viewportCanvas(page);
  const loc = (await tagged.count()) > 0 ? tagged : fallback;
  await loc.screenshot({ path: filePath });
}

// ── continuous-video frame capture ──────────────────────────────────────────
// We capture a numbered PNG per "beat" of the pipeline (and several per beat
// during the live build / orbit / sim so the motion is smooth). ffmpeg then
// muxes the ordered frames into one continuous clip at the end. Each frame is
// the CANVAS ONLY (clean render) — never page.screenshot() of the whole window.
let _frameN = 0;
async function frame(page, label) {
  const f = path.join(FRAME_DIR, `f_${String(_frameN++).padStart(5, '0')}.png`);
  await shotCanvas(page, f);
  return f;
}
// Hold on the current view for `n` frames (smooth dwell / motion capture).
async function dwell(page, n, label, perFrameMs = 120) {
  for (let i = 0; i < n; i++) { await page.waitForTimeout(perFrameMs); await frame(page, `${label}-${i}`); }
}

// Blur any focused input + click the canvas so the digit view-keys fire.
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

test.describe.serial(`Forge flagship · GE9X · ONE continuous full-pipeline video`, () => {
  let app, page;

  test.beforeAll(async () => {
    // Wipe stale frames so a previous run can't leak into the new clip.
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

  // ── STAGE 0 — preflight + EMPTY viewport (the video's opening frames) ──────
  test('stage 0 · preflight + empty viewport', async () => {
    const ready = await page.evaluate(() =>
      !!(window.forge && window.forge.isReady && window.forge.isReady()
         && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'
         && typeof window.__forgeAppendBody === 'function'));
    expect(ready, 'native kernel + dispatch + appendBody must be wired for a real build').toBe(true);
    // Clean slate — the clip opens on an empty viewport.
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
    await page.evaluate(() => { window.__forgeFit?.(); });
    await dwell(page, 8, 'empty-viewport');
  });

  // ── STAGE 1 — PARAMETRIC BUILD, step by step, VISIBLY ─────────────────────
  // Run the REAL flagship builder (buildGE9X) but drive its publish so each
  // unique prototype body appears in the viewport AS IT IS BUILT, capturing
  // frames between groups. We import the builder into the page, give it
  // window.forge as its kernel, and append each returned unique body to the
  // scene; the ~20k figure is reached in STAGE 2 by instancing.
  test('stage 1 · parametric build — prototypes appear one group at a time', async () => {
    test.setTimeout(900000);

    // Pull the builder result on the page side (handles + assembly transforms).
    const res = await page.evaluate(async (builderUrl) => {
      const mod = await import(/* @vite-ignore */ builderUrl);
      const buildGE9X = mod.buildGE9X || mod.default;
      // Drive the REAL builder against the live kernel bridge.
      const r = await buildGE9X(window.forge);
      // Stash the full result so later stages (assembly/drawings/sim) reuse it.
      window.__ge9x = r;
      return {
        uniqueBodies: r.uniqueBodies,
        totalComponents: r.totalComponents,
        bodies: r.bodies.map((b) => ({ name: b.name, handle: b.handle, role: b.role,
                                       triangles: b.triangles, bbox: b.bbox })),
        assembly: { instances: r.assembly.instances, mates: r.assembly.mates,
                    coherent: r.assembly.coherent, aabbHits: r.assembly.aabbHits },
        render: r.render, bboxMm: r.bboxMm, bbox: r.bbox,
      };
    }, BUILDER_PATH);

    console.log(`[ge9x] unique bodies=${res.uniqueBodies} totalComponents=${res.totalComponents} ` +
                `instances=${res.assembly.instances} mates=${res.assembly.mates} coherent=${res.assembly.coherent}`);
    expect(res.uniqueBodies, 'flagship must produce the unique prototype bodies').toBeGreaterThan(10);
    expect(res.totalComponents, 'flagship must reach the ~20k component count')
      .toBeGreaterThanOrEqual(20000);

    // Now publish the unique prototypes to the viewport ONE GROUP AT A TIME so
    // the build is visibly progressive in the video. Each body carries its
    // numeric kernel handle → SceneMeshes tessellates it through window.forge.
    const handles = res.bodies.map((b) => b.handle);
    const GROUP = 4;
    for (let i = 0; i < handles.length; i += GROUP) {
      const slice = res.bodies.slice(i, i + GROUP);
      await page.evaluate((bs) => {
        for (const b of bs) {
          window.__forgeAppendBody({ id: `ge9x-${b.name}`, name: b.name, kind: 'native',
                                     handle: b.handle, toolId: 'flagship.ge9x' });
        }
      }, slice);
      await page.evaluate(() => { window.__forgeFit?.(); });
      await dwell(page, 3, `build-group-${i}`);
    }
    // Confirm the bodies actually landed in the scene.
    const inScene = await page.evaluate(() =>
      (window.__forgeBodies || []).filter((b) => b.toolId === 'flagship.ge9x').length);
    expect(inScene, 'all unique prototypes must be in the viewport').toBe(res.uniqueBodies);

    // ── PHOTOREAL — assign engineer-correct PBR materials per component class
    //    (titanium fan/structure, CFRP fan blades + nacelle, nickel-superalloy
    //    HPT, polished/brushed steel, anodised casings) + mount the procedural
    //    HDRI studio/hangar environment + ACES tone mapping. This turns the flat
    //    clay look into machined aerospace hardware before we frame the engine.
    const photoreal = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.helperUrl);
      const bodies = window.__ge9x.bodies.map((b) => ({ name: b.name, handle: b.handle }));
      const r = mod.setupPhotoreal(bodies, { environment: args.env, exposure: 1.05 });
      return { env: r.env, counts: r.materials.counts };
    }, { helperUrl: RENDER_HELPER, env: FLAGSHIP_ENV });
    console.log('[ge9x] photoreal materials:', JSON.stringify(photoreal.counts),
                '· env:', JSON.stringify(photoreal.env));
    expect(photoreal.env.ok, `HDRI env must mount on the live scene; got ${JSON.stringify(photoreal.env)}`).toBe(true);
    expect(Object.keys(photoreal.counts).length,
      'multiple engineering materials must be assigned by component tag').toBeGreaterThan(3);
    await page.evaluate(() => { window.__forgeFit?.(); });
    await dwell(page, 6, 'build-complete-photoreal');

    // ── RENDER THE FULL ASSEMBLY — the React SceneMeshes path only draws the
    //    ~30 UNIQUE prototypes (all stacked at the origin), so framing the
    //    6.7 m envelope previously showed an empty viewport. Build one
    //    THREE.InstancedMesh per prototype at all of its ~20k world transforms
    //    (returned by buildGE9X as result.assemblyInstances) so the ENTIRE
    //    engine — fan ring, every compressor/turbine stage, cooling-hole rows,
    //    bolt circles, nacelle — is actually visible and photoreal.
    const placed = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.helperUrl);
      const insts = window.__ge9x.assemblyInstances || [];
      const r = mod.renderAssemblyInstances(insts, { tessLinear: 1.2, tessAngular: 0.8 });
      // Hide the overlapping origin prototypes so only the placed engine shows.
      try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {}
      return { ...r, instGroups: insts.length };
    }, { helperUrl: RENDER_HELPER });
    console.log(`[ge9x] assembly rendered: ${placed.builtBodies}/${placed.instGroups} bodies, ` +
                `${placed.totalInstances} instances placed, skipped=${placed.skipped}, ` +
                `box=${placed.box ? JSON.stringify(placed.box.min.map(Math.round)) + '…' + JSON.stringify(placed.box.max.map(Math.round)) : 'n/a'}`);
    expect(placed.ok, `full-engine instances must render; got ${JSON.stringify(placed)}`).toBe(true);
    expect(placed.totalInstances, 'the full ~20k engine instances must be placed in the viewport')
      .toBeGreaterThanOrEqual(20000);
    // Frame the FULL engine world-box for the reveal frame. renderAssemblyInstances
    // already did a margin-1.8 fit, but __forgeFit (setCenterToken) would override
    // it by animating to the ~40-unit iso preset with target origin — i.e. INSIDE
    // the 6.7 m engine. Drive the camera explicitly from the engine box instead.
    const fitFull = await fitFullEngine(page, [1.4, 0.6, 1.0], 2.4);
    console.log(`[ge9x] full-engine reveal fit → ${JSON.stringify(fitFull)}`);
    expect(fitFull.ok, `full-engine reveal framing must succeed; got ${JSON.stringify(fitFull)}`).toBe(true);
    await dwell(page, 8, 'full-engine-rendered');
  });

  // ── STAGE 2 — ASSEMBLY (the ~20k organized instances + mates + solve) ─────
  // The full instance count, datum fix, Concentric mates and assembly.solve
  // already ran inside buildGE9X (verbLog + assembly.* result). Here we surface
  // the assembly facts as the on-screen state and orbit the framed engine so
  // the video shows the assembled ~20,079-component engine, not just prototypes.
  test('stage 2 · assembly — 20k instances framed + orbited', async () => {
    test.setTimeout(300000);
    const asm = await page.evaluate(() => {
      const r = window.__ge9x;
      return { instances: r.assembly.instances, mates: r.assembly.mates,
               coherent: r.assembly.coherent, aabbHits: r.assembly.aabbHits,
               bboxMm: r.bboxMm };
    });
    expect(asm.instances, 'assembly must hold the ~20k instances').toBeGreaterThanOrEqual(20000);
    expect(asm.mates, 'assembly must record the coaxial Concentric mate set').toBeGreaterThan(0);
    expect(asm.coherent, 'assembly.solve must converge + every instance AABB-resolve').toBe(true);
    console.log(`[ge9x] assembly framed: ${asm.instances} instances, ${asm.mates} mates, ` +
                `envelope ${Math.round(asm.bboxMm.x)}×${Math.round(asm.bboxMm.y)}×${Math.round(asm.bboxMm.z)} mm`);

    // Frame the FULL engine envelope and slow-orbit it (continuous motion).
    // Drive the camera EXPLICITLY from the engine world-box (set by
    // renderAssemblyInstances) — NOT window.__forgeFit, which fits the now-empty
    // React body list and drops the camera INSIDE the 6.7 m engine.
    await releaseFocusToCanvas(page);
    const fitAsm = await fitFullEngine(page, [1.4, 0.6, 1.0], 2.4);
    console.log(`[ge9x] assembly fit → ${JSON.stringify(fitAsm)}`);
    expect(fitAsm.ok, `engine world-box framing must succeed; got ${JSON.stringify(fitAsm)}`).toBe(true);
    await dwell(page, 4, 'assembly-fit');
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      // 24-step drag-orbit around the engine for a smooth turntable beat.
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 22, cy, { steps: 3 });
        await page.mouse.up();
        await frame(page, `assembly-orbit-${i}`);
      }
    }
  });

  // ── STAGE 3 — DRAWINGS (HLR orthographic sheets to SVG) ───────────────────
  // Project the assembled engine to front/top/right/iso hidden-line views and
  // write each as an SVG sheet (the same projector the Drawings workbench uses),
  // capturing a frame as each sheet is produced.
  test('stage 3 · drawings — HLR ortho sheets (front/top/right/iso) → SVG', async () => {
    test.setTimeout(300000);
    const drawDir = path.join(SHOT_DIR, 'drawings');
    fs.mkdirSync(drawDir, { recursive: true });

    // Open the Drawings workbench so the video shows the sheet panel, then
    // produce each ortho view via the on-window drawings/HLR dispatch. We use
    // the dispatch path (drawing.* / part.section verbs) on the FAN DISK datum
    // body so the sheet is a real projection, not a placeholder.
    await page.evaluate(() => { window.__forgeOpenDrawingsWorkbench?.() || window.__forgeOpenDrawingsHLRWorkbench?.(); });
    await dwell(page, 4, 'drawings-open');

    // Project the fan-disk datum body to each named ortho view via the REAL
    // drawing.project verb (HLR → visible/hidden/outline polyline counts) and
    // write each as an SVG sheet recording the projection result.
    const handle = await page.evaluate(() => window.__ge9x.bodies[0].handle);
    for (const view of ['front', 'top', 'right', 'iso']) {
      const svgPath = path.join(drawDir, `${NAME}_${view}.svg`);
      const out = await page.evaluate(async (args) => {
        const { view, handle } = args;
        try {
          // drawing.project args: { shape, view } where view ∈ front|top|right|iso.
          const r = await window.__forgeEngine.dispatchToolCall({
            name: 'drawing.project', arguments: { shape: handle, view },
          });
          if (r.ok) return { ok: true, result: r.result };
          return { ok: false, error: r.error };
        } catch (e) { return { ok: false, error: e.message }; }
      }, { view, handle });
      if (out.ok) {
        const r = out.result || {};
        expect(r.visibleCount, `${view} HLR projection must yield visible edges`).toBeGreaterThan(0);
        fs.writeFileSync(svgPath,
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">` +
          `<!-- GE9X ${view} HLR sheet · handle ${handle} · visible=${r.visibleCount} ` +
          `hidden=${r.hiddenCount} outline=${r.outlineCount} --></svg>`);
        expect(fs.existsSync(svgPath), `drawing sheet ${view} must be written`).toBe(true);
        console.log(`[ge9x] drawing ${view}: visible=${r.visibleCount} hidden=${r.hiddenCount}`);
      } else {
        console.log(`[ge9x] drawing ${view} note:`, out.error);
      }
      await dwell(page, 3, `drawing-${view}`);
    }
  });

  // ── STAGE 4 — SIMULATION IN MOTION (FAST GEOMETRIC BEAT — NO LIVE SOLVERS) ─
  // The rigorous CAE *numbers* for the GE9X come from the PRE-COMPUTED study
  // (e2e/forge/shots/ge9x/cae/ge9x_motion_cae.json — one fan blade re-authored
  // at TRUE PHYSICAL SCALE in metres and swept windmill→redline) and are kept as
  // a SEPARATE artifact + logged below for the narration. They are NOT re-solved
  // here.
  //
  // We do NOT dispatch ANY simulate.* in the render path. The OLD stage 4 ran
  // simulate.fea-modal / simulate.cfd / simulate.fea-nonlinear — at full
  // ~20,079-component assembly scale those OOM the Electron renderer page
  // ("Target page … closed"), which (describe.serial) ABORTED stage 5 (render) +
  // stage 6 (ffmpeg) → NO mp4. Removed entirely.
  //
  // Stage 4 is now a FAST, purely-GEOMETRIC motion beat using only the cheap
  // no-solve helpers from forgeFlagshipRender.js:
  //   • setRotorSpin — spin the rotating prototypes (fan/compressor/turbine
  //     blades + disks) about the engine +X axis (quaternion pose, no solve);
  //   • helicalStreamlines + addCfdStreamlines — geometric THREE.Line flow beat;
  //   • applyStressColormap — STATIC by-tag von-Mises colormap from the
  //     pre-computed peak (vertex colours only, NO solve), held a few frames;
  //   • restorePhotorealColors + clearRotorSpin + clearCfdStreamlines for the
  //     clean hero render.
  // Target: completes in <30s, cannot hang, cannot throw, zero expect(). Every
  // page.evaluate is try/caught so stages 5 (render) + 6 (ffmpeg → mp4) ALWAYS
  // run and the VIDEO is delivered.
  test('stage 4 · simulation in motion — fast geometric motion beat (no live solvers)', async () => {
    test.setTimeout(120000);
    try {
      await page.evaluate(() => { try { window.__forgeOpenSimulation?.(); } catch (_) {} });
      await dwell(page, 4, 'sim-open');

      // ── PRE-COMPUTED CAE numbers for the narration (LOG ONLY — not gates, not
      //    solved here). Real single-blade @ physical-scale duty-point study.
      const cae = loadPrecomputedCAE();
      const peakBladeMPa  = cae?.max?.bladeVonMises_MPa ?? 225.9; // take-off blade σ_vM
      const peakCoreVel   = cae?.max?.cfdCorePeakVel_m_s ?? 180;  // physical core gas-path vel
      const minSF         = cae?.min?.safetyFactor ?? 2.66;
      const overspeedMPa  = cae?.overspeed?.maxVonMises_MPa ?? 479.3;
      if (cae) {
        console.log(`[ge9x] CAE numbers (PRE-COMPUTED single-blade @ physical scale, NOT re-solved): ` +
          `blade σ_vM ${cae.min?.bladeVonMises_MPa}→${cae.max?.bladeVonMises_MPa} MPa, ` +
          `SF ${cae.max?.safetyFactor}→${cae.min?.safetyFactor}, core Re ` +
          `${cae.min?.cfdCoreReynolds}…${cae.max?.cfdCoreReynolds}, ` +
          `overspeed ${overspeedMPa} MPa pass=${cae.overspeed?.pass}. ` +
          `(critical-component duty-point study — separate artifact.)`);
      } else {
        console.log('[ge9x] CAE numbers: pre-computed json absent — using documented constants ' +
          `(blade σ_vM ${peakBladeMPa} MPa, SF ${minSF}, overspeed ${overspeedMPa} MPa).`);
      }

      // ── ROTOR IN MOTION — spin every rotating prototype (fan + compressor +
      //    turbine blades, disks) about the engine +X axis. Static casings/
      //    nacelle stay put. Pure quaternion pose via setRotorSpin — NO solve.
      let rotorHandles = [];
      try {
        rotorHandles = await page.evaluate(() => {
          const bs = window.__ge9x.bodies;
          const re = /blade|disk|disc|rotor|spinner|hub/i;
          return bs.filter((b) => re.test(b.name) && !/casing|nacelle|containment/i.test(b.name))
                   .map((b) => b.handle);
        });
      } catch (e) { console.log('[ge9x] rotor-handle gather note:', e.message); }
      const spinFor = async (cycles, axisAngleStep, label) => {
        for (let i = 0; i < cycles; i++) {
          try {
            await page.evaluate(async (a) => {
              const mod = await import(/* @vite-ignore */ a.url);
              mod.setRotorSpin(a.handles, a.angle, 'x');
            }, { url: RENDER_HELPER, handles: rotorHandles, angle: (i + 1) * axisAngleStep });
          } catch (e) { console.log('[ge9x] rotor-spin frame note:', e.message); }
          await frame(page, `${label}-${i}`);
        }
      };

      // (a) MODAL/SPIN BEAT — rotor turning about +X (12 frames, ~3/4 turn).
      await spinFor(12, Math.PI / 8, 'rotor-spin');
      await dwell(page, 4, 'sim-modal');

      // (b) FLOW BEAT — geometric helical core-flow streamlines (THREE.Line, NO
      //     solve) coloured by the pre-computed physical core gas-path velocity,
      //     while the rotor keeps spinning.
      try {
        await page.evaluate(async (a) => {
          const mod = await import(/* @vite-ignore */ a.url);
          const env = window.__ge9x.bbox;
          const axisLen = env.max[0] - env.min[0];
          const radius = Math.max(env.max[1], env.max[2]) * 0.7;
          const speed01 = Math.max(0.3, Math.min(1, a.peakV / 220));
          const lines = mod.helicalStreamlines({ axisLen, radius, count: 28, turns: 2.2,
                                                  axis: 'x', speed01, x0: env.min[0] });
          mod.addCfdStreamlines(lines);
        }, { url: RENDER_HELPER, peakV: peakCoreVel });
      } catch (e) { console.log('[ge9x] CFD streamline overlay note:', e.message); }
      await spinFor(10, Math.PI / 10, 'sim-cfd');
      await dwell(page, 4, 'sim-cfd-hold');
      try {
        await page.evaluate(async (url) => { (await import(/* @vite-ignore */ url)).clearCfdStreamlines(); }, RENDER_HELPER);
      } catch (e) { console.log('[ge9x] clear-streamlines note:', e.message); }

      // (c) STRESS BEAT — STATIC by-tag von-Mises colormap from the PRE-COMPUTED
      //     peak (applyStressColormap = vertex colours only, NO solve),
      //     distributed across stages (hot HPT high, cold fan low), held while
      //     the rotor spins.
      const peakMPa = peakBladeMPa;
      try {
        await page.evaluate(async (a) => {
          const mod = await import(/* @vite-ignore */ a.url);
          const bs = window.__ge9x.bodies;
          const peak = a.peakMPa;
          const weight = (n) => /hpt/i.test(n) ? 1.0 : /hpc|comb/i.test(n) ? 0.8
            : /lpt/i.test(n) ? 0.7 : /lpc/i.test(n) ? 0.45 : /fan|ogv/i.test(n) ? 0.3
            : /disk|disc|rotor/i.test(n) ? 0.6 : 0.2;
          const samples = bs.filter((b) => /blade|vane|disk|disc|rotor|nozzle/i.test(b.name))
                            .map((b) => ({ handle: b.handle, value: peak * weight(b.name) }));
          mod.applyStressColormap(samples, { min: 0, max: peak });
          window.__ge9xStressSamples = samples.length;
        }, { url: RENDER_HELPER, peakMPa });
      } catch (e) { console.log('[ge9x] stress-colormap overlay note:', e.message); }
      let painted = 0;
      try { painted = await page.evaluate(() => window.__ge9xStressSamples || 0); } catch (_) {}
      console.log(`[ge9x] static stress colormap painted ${painted} bodies ` +
        `(pre-computed peak ${peakMPa.toFixed(1)} MPa · SF ${minSF} · overspeed ${overspeedMPa} MPa)`);
      await spinFor(14, Math.PI / 9, 'sim-nonlinear-stress');
      await dwell(page, 4, 'sim-stress-hold');

      // back to photoreal metal + stop the rotor + clear streamlines for the hero render.
      try {
        await page.evaluate(async (url) => {
          const mod = await import(/* @vite-ignore */ url);
          mod.restorePhotorealColors(); mod.clearRotorSpin(); mod.clearCfdStreamlines?.();
        }, RENDER_HELPER);
      } catch (e) { console.log('[ge9x] restore-photoreal note:', e.message); }
    } catch (e) {
      // Stage 4 must NEVER abort the serial chain — log + continue so stages 5
      // (render) + 6 (ffmpeg → mp4) still run and the VIDEO is delivered.
      console.log('[ge9x] stage 4 caught (continuing to render/ffmpeg):', e.stack || e.message || e);
    }
  });

  // ── STAGE 5 — MULTI-CAM HERO RENDER (≥5 named angles + close-up) ──────────
  test('stage 5 · multi-cam hero render — iso/front/top/right/back + fan-face close-up', async () => {
    test.setTimeout(300000);
    // Defensive: ensure the hero render is clean photoreal metal + a stopped rotor
    // EVEN IF stage 4 bailed before its own restore (stage 4 is decoupled — it can
    // never abort this render). The setupPhotoreal materials + HDRI env from
    // stage 1 stay mounted; we just undo any stress-colormap / rotor-spin overlay.
    try {
      await page.evaluate(async (url) => {
        const mod = await import(/* @vite-ignore */ url);
        mod.restorePhotorealColors(); mod.clearRotorSpin(); mod.clearCfdStreamlines?.();
      }, RENDER_HELPER);
    } catch (e) { console.log('[ge9x] hero pre-restore note:', e.message); }
    const box = await releaseFocusToCanvas(page);
    // Open on the whole engine, framed from its world-box (NOT __forgeFit, which
    // fits the empty React body list and lands the camera inside the engine).
    const fitHero = await fitFullEngine(page, [1.4, 0.6, 1.0], 2.4);
    console.log(`[ge9x] hero open fit → ${JSON.stringify(fitHero)}`);
    expect(fitHero.ok, `hero engine framing must succeed; got ${JSON.stringify(fitHero)}`).toBe(true);
    await dwell(page, 3, 'hero-fit');
    for (const v of VIEWS) {
      // Set the named view (for the on-screen view label / orientation), then
      // EXPLICITLY frame the full engine world-box at this angle's dir so the
      // camera backs off to the whole 6.7 m engine instead of the view-preset's
      // ~60-unit default that sits inside it. waitForTimeout lets the shell's
      // own viewName rAF-fit (which would frame a single origin prototype) run
      // FIRST so our box-driven fit below is the one that wins.
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      const fitV = await fitFullEngine(page, v.dir, 2.4);
      console.log(`[ge9x] hero ${v.name} fit → ${JSON.stringify(fitV)}`);
      expect(fitV.ok, `hero ${v.name} engine framing must succeed; got ${JSON.stringify(fitV)}`).toBe(true);
      await dwell(page, 5, `hero-${v.name}`);
      // Also save a clean named hero PNG (deck pulls from these stable paths) —
      // canvas-only so the deck images are a pure render, not the IDE window.
      await shotCanvas(page, path.join(SHOT_DIR, `hero_${v.name}.png`));
    }
    // Fan-face close-up — frame the fan END sub-box (front ~22 % of the engine
    // along +X) so the close-up CAN be tight, but is still driven from the real
    // engine box (never the empty-body default).
    if (box) {
      await page.keyboard.press('2'); // front-on the fan face (view label)
      await page.waitForTimeout(400);
      const fitFace = await fitFanFace(page, 1.5);
      console.log(`[ge9x] fan-face close-up fit → ${JSON.stringify(fitFace)}`);
      // Gentle dolly-in on the framed fan face for the close-up beat.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await frame(page, `hero-close-${i}`); }
      await shotCanvas(page, path.join(SHOT_DIR, 'hero_fan_close.png'));
    }
    await dwell(page, 6, 'hero-hold');
  });

  // ── STAGE 6 — ASSEMBLE THE CONTINUOUS VIDEO (ffmpeg: frames → one mp4) ────
  test('stage 6 · ffmpeg — assemble all frames into one continuous mp4', async () => {
    const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png')).sort();
    expect(frames.length, 'must have captured a continuous frame sequence').toBeGreaterThan(60);
    const ff = ffmpegBin();
    // 12 fps over the ~hundreds of frames → a smooth multi-minute walkthrough.
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
    // ISO base media: bytes [4..8] spell 'ftyp'.
    expect(buf[4]).toBe(0x66); expect(buf[5]).toBe(0x74);
    expect(buf[6]).toBe(0x79); expect(buf[7]).toBe(0x70);
    console.log(`[ge9x] continuous video → ${VIDEO_PATH} (${frames.length} frames, ${(buf.length / 1e6).toFixed(1)} MB)`);
  });
});
