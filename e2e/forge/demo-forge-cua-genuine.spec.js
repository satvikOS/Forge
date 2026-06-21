// ─────────────────────────────────────────────────────────────────────────────
// GENUINE-CUA CAPTURE — the LIVE TRAINED FORGE MODEL drives Forge's UI end-to-end.
// The Forge mirror of archdisc-Studio/e2e/demo/demo-cua-genuine.spec.js.
//
// This is NOT a re-implementation of dispatchToolCall in the page (that's what
// the flagship builder specs do, to prove the op surface deterministically).
// Here the spec does the ONE thing only the real model can do:
//
//   1. launch the headed Electron app on the BUILT dist,
//   2. wait for the native forge-kernel.node + renderer + ForgeRunner to wire,
//   3. TYPE a CAD prompt into the real Archie command bar,  ← the video STARTS here
//   4. press Enter, and then DO NOTHING but watch —
//   5. the live console (ForgeShellV4.runArchie → ForgeRunner.runForgePrompt →
//      :8080 → the hermes_forge adapter) streams <tool_call>s; the shell's own
//      onTrace dispatches each one via the REAL ForgeToolBridge.dispatchToolCall
//      (native OCCT kernel), and surfaces each produced body to the viewport —
//      a part is BUILT in the 3D scene, ALL by the model.
//   6. capture canvas frames THROUGHOUT (from the typed prompt onward),
//   7. apply photoreal PBR + HDRI studio env (setupPhotoreal) and orbit/multi-cam
//      the model-built part as the hero "render" (Forge has no path-tracer harvest;
//      the photoreal real-time canvas is the render, same as the flagship specs),
//   8. ffmpeg the frames → forge-cua-genuine.mp4 + a hero png.
//
// Because the MODEL is in the loop, the exact ops vary run to run — so this spec
// asserts on OUTCOMES (the scene grew → at least one body, a video was produced),
// logs EVERY tool_call the model emitted (read from the live Archie dock DOM the
// shell writes per dispatch), and is GENEROUS on timeouts. It requires a live
// serve on :8080 with the Forge adapter (archdisc-Models/serve_forge_cua.sh).
// With no serve the runArchie fetch fails and the test reports an honest failure
// (no tool_calls, empty scene) — it is NOT a deterministic CI test, it is the
// demo-capture harness.
//
// CAPTURE IS CANVAS-ONLY ([data-testid="forge-v4-canvas"]) like the fixed
// flagship specs — clean render, never page.screenshot() of the IDE chrome.
//
// Configurable via env:
//   FORGE_CUA_PROMPT    — the prompt typed into the bar. Default is a tractable,
//                         cadskills-ladder-grade part the Forge model reliably
//                         builds in ONE turn (a Ø120 8-bolt mounting flange).
//                         NOT the 20k GE9X (1000+ calls, too long for one turn).
//   FORGE_CUA_ADAPTER   — informational only; the served adapter is whatever
//                         ForgeRunner's HERMES_FORGE_ADAPTER routes. Logged so the
//                         capture records which fold drove it.
//   FORGE_CUA_BUILD_MS  — how long to watch the model build before forcing the
//                         close-out (default 300000 = 5 min).
//   FORGE_CUA_ENV       — photoreal HDRI environment preset (default 'studio').
//   FORGE_CUA_OUT       — output basename (default 'forge-cua-genuine').
//
// Loads the BUILT dist headed in Electron (mirrors demo-flagship-*.spec.js). Run
// HEADED on the Mac Studio ([[feedback-headed-tests]]):
//   cd /Users/account_clawteam1/archdisc-Mech
//   (cd frontend && npm run build)              # the dist must be current
//   # in another shell, with weights present:
//   #   cd ~/archdisc-Models && ./serve_forge_cua.sh
//   npx playwright test e2e/forge/demo-forge-cua-genuine.spec.js \
//     --config=playwright.config.js --headed
// ─────────────────────────────────────────────────────────────────────────────
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
// Forge flagship photoreal runtime (setupPhotoreal: HDRI env + ACES + PBR).
const RENDER_HELPER = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/forgeFlagshipRender.js');

const OUT_NAME   = process.env.FORGE_CUA_OUT || 'forge-cua-genuine';
const SHOT_DIR   = path.resolve('/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/flagship');
const FRAME_DIR  = path.join(SHOT_DIR, `${OUT_NAME}-frames`);
const VIDEO_PATH = path.join(SHOT_DIR, `${OUT_NAME}.mp4`);
const HERO_PATH  = path.join(SHOT_DIR, `${OUT_NAME}.png`);

// A TRACTABLE cadskills-ladder-grade part the composition-trained Forge adapter
// builds in ONE turn (a flange = bored plate/cylinder + central bore + a bolt
// circle — the part.bolt-circle pattern verb is exactly what the corpus teaches).
const PROMPT = process.env.FORGE_CUA_PROMPT
  || 'Model a Ø120 mm mounting flange, 16 mm thick, with a 40 mm central bore '
   + 'and an 8-hole bolt circle of Ø11 holes on a 95 mm bolt-circle diameter; '
   + 'break the outer edges with a 2 mm chamfer.';
const ADAPTER_LABEL = process.env.FORGE_CUA_ADAPTER
  || 'adapters/archie/hermes_forge-capstack-20260617'; // ForgeRunner HERMES_FORGE_ADAPTER
// When FORGE_CUA_ADAPTER is explicitly set, ACTUALLY route the live console to
// that fold via window.__FORGE_ADAPTER_OVERRIDE (the non-breaking hook added in
// ForgeRunner.js) — this lets the genuine-CUA harness A/B a non-default adapter
// (e.g. the 14B v2 reasoning-merged fold) WITHOUT editing the shipped
// HERMES_FORGE_ADAPTER default. Unset ⇒ no override ⇒ the shipped 8B drives.
const ADAPTER_OVERRIDE = process.env.FORGE_CUA_ADAPTER || '';
const BUILD_MS = Number(process.env.FORGE_CUA_BUILD_MS || 300000); // 5 min watch window
const FLAGSHIP_ENV = process.env.FORGE_CUA_ENV || 'studio';

// 1=iso 2=front 3=back 4=top 5=bottom 6=right 7=left (Forge digit view-keys).
//
// Each view carries a `dir` = the CAMERA OFFSET direction from the part box
// center (world axes), exactly like the flagship gearbox/GE9X fix. A mounting
// flange is a thick disc about its bore axis (+Z); X/Y are the radial
// face-diameter directions. After the digit key sets the named view we
// EXPLICITLY frame the part world-box (window.__forgePartBox, unioned from the
// real model-built bodies) via window.__forgeFitToBounds at this dir — NOT the
// digit→view-preset / __forgeFit fit, which frames the default body and zooms
// in too close on the small part (the bug this spec is fixing).
const VIEWS = [
  { key: '1', name: 'iso',   dir: [1.4, 0.6, 1.0]   },
  { key: '2', name: 'front', dir: [0.12, 1, 0.12]   },
  { key: '4', name: 'top',   dir: [0.08, 0.08, 1]   },
  { key: '6', name: 'right', dir: [1, 0.12, 0.12]   },
  { key: '3', name: 'back',  dir: [-0.12, -1, 0.25] },
];

// Compute the part's WORLD bounding box from the REAL scene bodies the MODEL
// built. Forge body meshes (SceneMeshes) carry el.userData.forgeBody /
// el.userData.body; traverse the live r3f scene (window.__forgeScene), union
// their WORLD-transformed geometry bounding boxes into one THREE.Box3, and
// expose it as window.__forgePartBox so fitPart() can frame the whole part
// (mirrors demo-flagship-gearbox.spec.js). Skips helper/gizmo/overlay meshes.
async function computePartBox(page) {
  return page.evaluate(() => {
    const THREE = window.__forgeThree;
    const scene = window.__forgeScene;
    if (!THREE || !scene) return { ok: false, reason: !scene ? 'no __forgeScene' : 'no __forgeThree' };
    const box = new THREE.Box3();
    let meshes = 0;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
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

// Frame the WHOLE part at a given direction (the flagship fitPart). Uses the
// part world-box (window.__forgePartBox, computed by computePartBox) and the
// box-driven window.__forgeFitToBounds so the camera always backs off OUTSIDE
// the part (camDistMm > part radius) — never the too-close digit-view preset.
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

function ffmpegBin() {
  try { return require('/Users/account_clawteam1/archdisc-Mech/node_modules/ffmpeg-static'); }
  catch (_) { return 'ffmpeg'; }
}

// The main viewport WebGL canvas — screenshot THIS, never the whole Electron
// window, so the hero frames + video show a CLEAN render of the part, not the
// IDE chrome. ForgeShellV4 tags the r3f Canvas with data-testid="forge-v4-canvas";
// fall back to the first <canvas>.
function viewportCanvas(page) {
  return {
    tagged: page.locator('[data-testid="forge-v4-canvas"]'),
    fallback: page.locator('canvas').first(),
  };
}
async function shotCanvas(page, filePath) {
  const { tagged, fallback } = viewportCanvas(page);
  const loc = (await tagged.count()) > 0 ? tagged : fallback;
  try { await loc.screenshot({ path: filePath }); }
  catch (_) { /* a transient nav during a heavy op must not kill the capture */ }
}

test('GENUINE-CUA — type a CAD prompt → live Forge model drives Forge → build → render → mp4', async () => {
  // Very generous: launch + cold adapter swap + a real composition trace + the
  // photoreal multi-cam render + ffmpeg.
  test.setTimeout(20 * 60 * 1000);
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  try { fs.unlinkSync(VIDEO_PATH); } catch (_) {}

  console.log(`[forge-cua] adapter (routed by the live console): ${ADAPTER_LABEL}`);
  console.log(`[forge-cua] prompt: ${PROMPT}`);

  // ── launch headed Electron on the built dist ───────────────────────────────
  const app = await _electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox'],
    env: { ...process.env, FORGE_E2E: '1' },
    slowMo: 30,
  });
  let page = await app.firstWindow();
  if (page.url().startsWith('devtools://')) {
    page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  // surface the page console so the model's dispatch / runner logs land in our log
  page.on('console', (msg) => {
    const t = msg.text();
    if (/tool_call|dispatch|archie|forge\.runner|part\.|asset\.|sketch\.|assembly\.|simulate\./i.test(t)) {
      console.log(`[page] ${t}`);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  // Route the live console to the requested fold (no-op when unset). addInitScript
  // re-applies it on every navigation, so it survives the reload below and is in
  // place before the FIRST runArchie fetch reads window.__FORGE_ADAPTER_OVERRIDE.
  if (ADAPTER_OVERRIDE) {
    await page.addInitScript((a) => { try { window.__FORGE_ADAPTER_OVERRIDE = a; } catch (_) {} }, ADAPTER_OVERRIDE);
    await page.evaluate((a) => { try { window.__FORGE_ADAPTER_OVERRIDE = a; } catch (_) {} }, ADAPTER_OVERRIDE).catch(() => {});
    console.log(`[forge-cua] routing live console to OVERRIDE adapter: ${ADAPTER_OVERRIDE}`);
  }
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  }).catch(() => {});
  await page.reload().catch(() => {});
  await page.waitForLoadState('domcontentloaded');

  // the command bar (the real chat input) must be mounted before we type.
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
  await expect(page.locator('[data-testid="forge-cmdbar-input"]')).toBeVisible({ timeout: 20000 });
  // the renderer must be up so the canvas captures show geometry.
  await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 20000 });
  // CRITICAL: runArchie no-ops (posts an "offline" message, never calls :8080)
  // unless the native kernel is ready. Gate on it + the ForgeRunner install so
  // the model genuinely drives the build.
  await page.waitForFunction(
    () => !!(window.forge && window.forge.isReady && window.forge.isReady()
             && typeof window.__forgeRun === 'function'
             && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'),
    { timeout: 30000 },
  );
  // clean slate — the clip opens on an empty viewport.
  await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
  await page.evaluate(() => { window.__forgeFit?.(); });
  await page.waitForTimeout(600);

  // ── frame recorder (canvas-only) ───────────────────────────────────────────
  let fi = 0;
  const shot = async (tag) => {
    await shotCanvas(page, path.join(FRAME_DIR, `f_${String(fi++).padStart(5, '0')}.png`));
    if (tag) console.log(`[forge-cua] frame ${fi - 1} :: ${tag}`);
  };
  const dwell = async (n, perMs = 130) => {
    for (let i = 0; i < n; i++) { await page.waitForTimeout(perMs); await shot(null); }
  };

  // ── live signals (read-only) ───────────────────────────────────────────────
  // scene body count — anything the model added lands in window.__forgeBodies.
  const sceneCount = () => page.evaluate(() => (window.__forgeBodies || []).length).catch(() => 0);
  // The shell pushes a `tool` role message to the Archie dock per dispatched
  // tool_call (humanized "▶ box 120×80×20 mm ✓"). We read those straight off the
  // live dock DOM so we can log EXACTLY which ops the model drove — proof the
  // model is in the loop. ArchieDock renders .forge-archie-msg[data-role].
  const toolMessages = () => page.evaluate(() => Array.from(
    document.querySelectorAll('.forge-archie-msg[data-role="tool"]'),
  ).map((el) => (el.textContent || '').trim()).filter(Boolean)).catch(() => []);
  // The shell finalizes ONE archie ('archie' role) reply once the turn completes
  // (status maxTurns for a single-shot Forge build). When the input re-enables
  // (running=false) AND a non-empty archie reply is present, the model is done.
  const archieReplies = () => page.evaluate(() => Array.from(
    document.querySelectorAll('.forge-archie-msg[data-role="archie"]'),
  ).map((el) => (el.textContent || '').trim())
   .filter((t) => t && t !== '…thinking…' && t !== 'Working…')).catch(() => []);
  // running flag — the cmd bar input is disabled while Archie works.
  const isRunning = () => page.locator('[data-testid="forge-cmdbar-input"]').isDisabled().catch(() => false);

  // ── (1) hold on the empty viewport so the video opens clean ─────────────────
  await shot('empty viewport');
  await dwell(5);

  // ── (2) THE VIDEO STARTS ON THE TYPED PROMPT ───────────────────────────────
  // Focus the real command bar, type the prompt visibly (so the capture shows
  // the human authoring it), capture frames during the type, then press Enter.
  const input = page.locator('[data-testid="forge-cmdbar-input"]');
  await input.click();
  const chunks = PROMPT.match(/.{1,18}(\s|$)/g) || [PROMPT];
  for (const c of chunks) {
    await input.type(c, { delay: 14 });
    await shot('typing prompt');
  }
  await shot('prompt typed — about to submit');
  await input.press('Enter');
  console.log('[forge-cua] prompt submitted — handing the wheel to the live model.');

  // ── (3) WATCH THE MODEL DRIVE ──────────────────────────────────────────────
  // Poll for model-driven UI changes and capture frames throughout. The
  // COMPLETION CONDITION (the model "finished driving") for a single-shot Forge
  // build is:
  //   • the cmd bar is no longer `running` (runArchie's finally cleared it) AND
  //   • at least one tool_call was dispatched (the dock shows tool messages) AND
  //   • a non-pending archie reply has been finalized.
  // We ALSO bail when the scene has grown and held stable for a long window, as a
  // belt-and-braces fallback if the reply finalization is slow.
  // We log every NEW tool message as it appears so the console shows the model
  // driving step by step.
  const tStart = Date.now();
  let lastCount = -1;
  let stableMs = 0;
  let seenTools = 0;
  let peakCount = 0;

  while (Date.now() - tStart < BUILD_MS) {
    await page.waitForTimeout(500);
    await shot(null);

    // log newly-dispatched tool_calls (the model driving).
    const tools = await toolMessages();
    if (tools.length > seenTools) {
      for (let i = seenTools; i < tools.length; i++) {
        console.log(`[forge-cua] TOOL_CALL #${i + 1} :: ${tools[i]}`);
      }
      seenTools = tools.length;
      // a fresh body may have landed — box-frame the whole part (not the too-close
      // __forgeFit preset) so the part stays properly framed as it grows.
      await computePartBox(page).catch(() => {});
      await fitPart(page, [1.4, 0.6, 1.0], 2.2).catch(() => {});
    }

    const n = await sceneCount();
    if (n > peakCount) peakCount = n;
    if (n === lastCount) stableMs += 500; else { stableMs = 0; lastCount = n; }

    const running = await isRunning();
    const replied = (await archieReplies()).length > 0;

    // COMPLETION: turn finished (not running) + the model actually dispatched
    // something + its summary reply is in.
    if (!running && seenTools > 0 && replied) {
      console.log(`[forge-cua] completion: turn finished — ${seenTools} tool_calls, ${n} bodies, reply posted.`);
      break;
    }
    // FALLBACK: the model built something and the scene has settled for a while.
    if (n >= 1 && stableMs >= 15000 && seenTools > 0) {
      console.log(`[forge-cua] completion: scene stable (${n} bodies, ${seenTools} tool_calls); proceeding.`);
      break;
    }
  }

  // capture a few extra frames on whatever the model produced.
  await dwell(6, 200);

  const finalCount = await sceneCount();
  const allTools = await toolMessages();
  const replies = await archieReplies();
  console.log(`[forge-cua] watch ended after ${Math.round((Date.now() - tStart) / 1000)}s`);
  console.log(`[forge-cua] scene bodies=${finalCount} (peak ${peakCount})`);
  console.log(`[forge-cua] MODEL EMITTED ${allTools.length} TOOL CALLS:`);
  allTools.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  if (replies.length) console.log(`[forge-cua] Archie reply: ${replies[replies.length - 1].slice(0, 200)}`);

  // ── (4) PHOTOREAL "RENDER" — the model-built part, dressed + multi-cam ──────
  // Forge has no path-traced render harvest (no window.__forgeLastRender). The
  // deliverable render is the photoreal REAL-TIME canvas (HDRI studio env + ACES
  // + PBR), exactly like the fixed flagship specs. We dress whatever the MODEL
  // built (read live from window.__forgeBodies — we do NOT inject our own part)
  // and capture ≥5 named camera angles + an orbit so the part dominates the frame
  // ([[feedback-forge-multicam-e2e]] + [[feedback-scale-to-viewer]]).
  if (finalCount > 0) {
    const photoreal = await page.evaluate(async (args) => {
      try {
        const mod = await import(/* @vite-ignore */ args.helperUrl);
        const bodies = (window.__forgeBodies || [])
          .filter((b) => b && b.kind === 'native' && typeof b.handle === 'number')
          .map((b) => ({ name: b.name || b.id || `body-${b.handle}`, handle: b.handle }));
        const r = mod.setupPhotoreal(bodies, { environment: args.env, exposure: 1.05 });
        return { ok: true, env: r.env, counts: r.materials && r.materials.counts, bodies: bodies.length };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }, { helperUrl: RENDER_HELPER, env: FLAGSHIP_ENV });
    console.log('[forge-cua] photoreal:', JSON.stringify(photoreal));

    // Frame the WHOLE part from its REAL world-box (unioned from the live
    // model-built body meshes) — NOT window.__forgeFit, whose digit-view preset
    // zooms in too close on this small flange (the bug being fixed). computePartBox
    // publishes window.__forgePartBox; fitPart drives the camera OUTSIDE it.
    const partBox = await computePartBox(page);
    console.log(`[forge-cua] part box → ${JSON.stringify(partBox)}`);
    const fitOpen = await fitPart(page, [1.4, 0.6, 1.0], 2.2);
    console.log(`[forge-cua] hero open fit → ${JSON.stringify(fitOpen)}`);
    await dwell(6);

    // multi-cam hero stills — ≥5 named angles, each box-framed so the WHOLE part
    // fills the frame on a clean canvas. The digit key sets the named view label;
    // then fitPart explicitly frames the part world-box at this angle's dir so the
    // camera backs off OUTSIDE the part instead of the too-close view preset.
    for (const v of VIEWS) {
      await page.keyboard.press(v.key).catch(() => {});
      await page.waitForTimeout(400);
      const fitV = await fitPart(page, v.dir, 2.2);
      console.log(`[forge-cua] hero ${v.name} fit → ${JSON.stringify(fitV)}`);
      await dwell(5);
      await shotCanvas(page, path.join(SHOT_DIR, `${OUT_NAME}_hero_${v.name}.png`));
    }

    // a gentle iso orbit so the hero tail of the video reads as a turntable.
    await page.keyboard.press('1').catch(() => {});
    await page.waitForTimeout(300);
    await fitPart(page, [1.4, 0.6, 1.0], 2.2).catch(() => {});
    const box = await viewportCanvas(page).fallback.boundingBox().catch(() => null);
    if (box) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      // blur any focused input first so the canvas receives the drag.
      await page.mouse.click(cx, cy);
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(cx, cy); await page.mouse.down();
        await page.mouse.move(cx + 22, cy, { steps: 3 }); await page.mouse.up();
        await shot(null);
      }
    }
    await dwell(6);

    // hero still (iso) — the deliverable thumbnail. Recompute the box (the orbit
    // moved the camera) and box-frame the whole part one last time.
    await page.keyboard.press('1').catch(() => {});
    await page.waitForTimeout(300);
    await computePartBox(page).catch(() => {});
    await fitPart(page, [1.4, 0.6, 1.0], 2.2).catch(() => {});
    await page.waitForTimeout(300);
    await shotCanvas(page, HERO_PATH);
    console.log(`[forge-cua] hero still → ${HERO_PATH}`);
  } else {
    console.warn('[forge-cua] NO body built by the model — video shows the empty viewport + typed prompt only. '
      + 'Is serve up on :8080 with the Forge adapter, and the native kernel loaded?');
  }

  // ── close cleanly ──────────────────────────────────────────────────────────
  await page.evaluate(() => { window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  // ── (5) stitch frames → mp4 (the video opens on the typed prompt) ───────────
  const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png')).sort();
  const ff = ffmpegBin();
  execFileSync(ff, [
    '-y', '-framerate', '12',
    '-pattern_type', 'glob', '-i', path.join(FRAME_DIR, 'f_*.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    VIDEO_PATH,
  ], { stdio: 'inherit' });
  console.log(`[forge-cua] mp4 → ${VIDEO_PATH}  (${frames.length} frames @ 12fps)`);

  // ── assertions (outcome-based, because the MODEL is in the loop) ────────────
  // The mp4 must exist and open on the typed prompt (we captured the type).
  expect(fs.existsSync(VIDEO_PATH), 'no mp4 produced').toBeTruthy();
  const buf = fs.readFileSync(VIDEO_PATH);
  expect(buf.length, 'mp4 must be non-trivial').toBeGreaterThan(4096);
  // ftyp box signature.
  expect(buf[4]).toBe(0x66); expect(buf[5]).toBe(0x74);
  expect(buf[6]).toBe(0x79); expect(buf[7]).toBe(0x70);
  expect(fi, 'too few frames captured').toBeGreaterThan(20);
  // The model must have actually driven SOMETHING — at least one dispatched
  // tool_call OR a grown scene. (If serve is down, runArchie's fetch fails and
  // both are empty — that fails here loudly, which is the correct signal
  // pre-serve.)
  expect(
    allTools.length > 0 || finalCount > 0,
    'the live model drove nothing — is serve up on :8080 with the Forge adapter (serve_forge_cua.sh)?',
  ).toBeTruthy();
});
