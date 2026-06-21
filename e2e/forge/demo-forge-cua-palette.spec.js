// ─────────────────────────────────────────────────────────────────────────────
// GENUINE-CUA — STAGE B (path 1): the LIVE TRAINED FORGE MODEL drives Forge
// through the REAL CommandPalette, like a human reaching for Cmd+K.
//
// This is the second on-ramp to genuine computer-use. Stage A
// (demo-forge-cua-genuine.spec.js) types a CAD prompt into the chat console and
// then watches ForgeRunner stream <tool_call>s that the shell dispatches via the
// native ForgeToolBridge — the model speaks the kernel's tool registry directly.
//
// Stage B path 1 upgrades the DRIVER to genuine UI operation. The model is NOT
// asked for a forge tool_call; it is asked — once per turn, given a fresh
// screenshot of the canvas — for the next UI COMMAND a human would invoke, as a
// tiny JSON {"command":"<palette search text>","done":<bool>,"why":"<short>"}.
// The harness then does the genuine human gesture:
//
//   1. launch the headed Electron app on the BUILT dist,
//   2. wait for the native forge-kernel.node + renderer + ForgeRunner to wire,
//   3. screenshot the CANVAS (the model's only grounding — spatial → text-search),
//   4. POST that turn's history to :8080 via ForgeRunner's adapter/call shape
//      (a COMPACT palette system prompt — see PALETTE_SYSTEM — NOT the Forge
//      tool-registry system prompt; the model names ONE UI command name + args),
//   5. open the REAL CommandPalette (Cmd+K, the actual CommandPaletteHost
//      shortcut), TYPE the command into its real input, let the fuzzy matcher
//      filter, and SELECT the top match (Enter) — the genuine end-to-end gesture,
//   6. repeat the screenshot→decide→act loop until the model says done, a body
//      is built, or the step budget is exhausted,
//   7. photoreal PBR + HDRI studio env (setupPhotoreal) + orbit/multi-cam the
//      result as the hero render (Forge has no path-tracer harvest; the photoreal
//      real-time canvas is the render, same as the flagship + Stage-A specs),
//   8. ffmpeg the frames → forge-cua-palette.mp4 + a hero png.
//
// Because the MODEL is in the loop AND every action goes through the real
// palette, the exact commands vary run to run — so this spec asserts on
// OUTCOMES (the palette opened + filtered + executed at least one command, the
// scene/feature-tree grew, a video was produced) and logs EVERY command the
// model picked and whether the palette found a match. It requires a live serve
// on :8080 with the Forge adapter (archdisc-Models/serve_forge_cua.sh). With NO
// serve the decide() fetch fails and the test reports an HONEST failure (no
// commands driven, empty scene) — it is NOT a deterministic CI test, it is the
// Stage-B capture harness. There is NO fake fallback path.
//
// CAPTURE IS CANVAS-ONLY ([data-testid="forge-v4-canvas"]) like the flagship +
// Stage-A specs — clean render, never page.screenshot() of the IDE chrome.
//
// Configurable via env:
//   FORGE_PALETTE_PROMPT  — the CAD goal the model is driving toward. VARY THIS
//                           per run ([[feedback-vary-test-prompts]]); default is a
//                           tractable bracket. The model is told the goal once and
//                           must reach it through palette commands.
//   FORGE_PALETTE_ADAPTER — informational only; the served adapter is whatever
//                           ForgeRunner's HERMES_FORGE_ADAPTER routes. Logged.
//   FORGE_PALETTE_STEPS   — max screenshot→decide→act turns (default 10).
//   FORGE_PALETTE_ENV     — photoreal HDRI environment preset (default 'studio').
//   FORGE_PALETTE_OUT     — output basename (default 'forge-cua-palette').
//
// Loads the BUILT dist headed in Electron (mirrors demo-forge-cua-genuine +
// demo-flagship-*). Run HEADED on the Mac Studio ([[feedback-headed-tests]]):
//   cd /Users/account_clawteam1/archdisc-Mech
//   (cd frontend && npm run build)              # the dist must be current
//   # in another shell, with weights present:
//   #   cd ~/archdisc-Models && ./serve_forge_cua.sh
//   npx playwright test e2e/forge/demo-forge-cua-palette.spec.js \
//     --config=playwright.config.js --headed
// ─────────────────────────────────────────────────────────────────────────────
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
// Forge flagship photoreal runtime (setupPhotoreal: HDRI env + ACES + PBR).
const RENDER_HELPER = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/forgeFlagshipRender.js');

const OUT_NAME   = process.env.FORGE_PALETTE_OUT || 'forge-cua-palette';
const SHOT_DIR   = path.resolve('/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/flagship');
const FRAME_DIR  = path.join(SHOT_DIR, `${OUT_NAME}-frames`);
const VIDEO_PATH = path.join(SHOT_DIR, `${OUT_NAME}.mp4`);
const HERO_PATH  = path.join(SHOT_DIR, `${OUT_NAME}.png`);

// The :8080 endpoint + adapter convention are the SAME as ForgeRunner
// (frontend/src/ai/ForgeRunner.js:25,35,235): POST /v1/chat/completions, NO
// `model` field, per-request `adapters` does the routing. We replicate the call
// shape here in Node (the page-side ForgeRunner.runForgePrompt drives the KERNEL
// tool registry; Stage B drives the UI, so we ask the SAME served model with a
// different, palette-only system prompt). Keep these in lockstep with ForgeRunner.
const ARCHIE_BASE_URL = process.env.FORGE_ARCHIE_URL || 'http://localhost:8080';
const HERMES_FORGE_ADAPTER = 'adapters/archie/hermes_forge-capstack-20260617';

// VARY the goal per run. A tractable cadskills-ladder part the composition-trained
// model can reason about as a sequence of UI commands.
const PROMPT = process.env.FORGE_PALETTE_PROMPT
  || 'Build a simple L-bracket: an L-shaped steel bracket with a mounting hole in '
   + 'each leg. Use the Forge command palette to reach the modelling tools.';
const ADAPTER_LABEL = process.env.FORGE_PALETTE_ADAPTER || HERMES_FORGE_ADAPTER;
const MAX_STEPS = Number(process.env.FORGE_PALETTE_STEPS || 10);
const FLAGSHIP_ENV = process.env.FORGE_PALETTE_ENV || 'studio';

// 1=iso 2=front 3=back 4=top 5=bottom 6=right 7=left (Forge digit view-keys).
// Each view carries a `dir` = the CAMERA OFFSET direction from the part-box
// center (world axes), exactly like the Stage-A + flagship specs. fitPart frames
// the part world-box at this dir so the camera always backs off OUTSIDE the part.
const VIEWS = [
  { key: '1', name: 'iso',   dir: [1.4, 0.6, 1.0]   },
  { key: '2', name: 'front', dir: [0.12, 1, 0.12]   },
  { key: '4', name: 'top',   dir: [0.08, 0.08, 1]   },
  { key: '6', name: 'right', dir: [1, 0.12, 0.12]   },
  { key: '3', name: 'back',  dir: [-0.12, -1, 0.25] },
];

// ── compact PALETTE system prompt ─────────────────────────────────────────────
// This is DELIBERATELY NOT ForgeRunner's HERMES_FORGE_SYSTEM (the kernel tool
// registry). Stage B path 1 asks the model to operate the UI, not the kernel:
// name ONE palette command per turn as a tiny JSON. The harness types that text
// into the real CommandPalette and selects the top fuzzy match. The model sees a
// canvas screenshot each turn (its only grounding) plus the running command log.
const PALETTE_SYSTEM =
`You are Archie, driving the ArchDisc Forge desktop CAD app like a human, ONLY
through its command palette (the Cmd+K search box that finds every menu item,
tool, workbench, feature and body by name).

Each turn you are shown the current 3D viewport and the commands run so far.
Reply with EXACTLY ONE line of JSON and NOTHING else:
  {"command":"<text to type into the palette>","done":false,"why":"<≤8 words>"}
- "command" is the SEARCH TEXT a human would type to find the next action
  (e.g. "L bracket", "box", "cylinder", "extrude", "hole", "flange", "fillet",
  "chamfer", a workbench name, or a tool name). The palette fuzzy-matches it; the
  top result is selected. Use short, distinctive words — the palette is a search,
  not a tool id. Do NOT emit forge tool_call JSON, angle-bracket tags, or prose.
- Set "done":true (and leave "command":"") when the goal is reached or no further
  palette command helps. Then stop.
Goal you are building toward (reach it with palette commands, step by step):`;

// ── helpers (mirrors of demo-forge-cua-genuine.spec.js) ──────────────────────

// Compute the part's WORLD bounding box from the REAL scene bodies, union them
// into window.__forgePartBox so fitPart() frames the whole part. Identical to the
// Stage-A spec so the render path is shared.
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

// Frame the WHOLE part at a given direction (the flagship fitPart) via the
// box-driven window.__forgeFitToBounds so the camera always backs off OUTSIDE
// the part — never the too-close digit-view preset.
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
// window. ForgeShellV4 tags the r3f Canvas with data-testid="forge-v4-canvas".
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
// Canvas screenshot → base64 data URL, fed to the model as its grounding image.
// Returns null if the canvas isn't capturable this turn (the decide() falls back
// to text-only context).
async function canvasDataUrl(page) {
  const { tagged, fallback } = viewportCanvas(page);
  const loc = (await tagged.count()) > 0 ? tagged : fallback;
  try {
    const buf = await loc.screenshot();
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (_) { return null; }
}

// ── the :8080 call — SAME endpoint + adapter routing as ForgeRunner ──────────
// One non-streaming chat completion. NO `model` field (Forge-191); per-request
// `adapters` routes (ForgeRunner.js:234-244). Returns the assistant text. Throws
// on a non-2xx or a transport error so the caller can report an HONEST failure
// when serve is down (no fake fallback).
async function archieComplete(messages, { temperature = 0.1, maxTokens = 256 } = {}) {
  const res = await fetch(`${ARCHIE_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature,
      max_tokens: maxTokens,
      adapters: HERMES_FORGE_ADAPTER, // mlx_lm.server hot-swap convention
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`[forge-palette] Archie ${res.status} ${res.statusText}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

// Parse the model's one-line decision. Tolerant: pull the first {...} object out
// of the reply (the model may wrap it). Returns { command, done, why, raw }.
function parseDecision(text) {
  const raw = (text || '').trim();
  let obj = null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { obj = JSON.parse(m[0]); } catch (_) { obj = null; } }
  if (!obj || typeof obj !== 'object') {
    return { command: '', done: true, why: 'unparseable reply', raw };
  }
  return {
    command: typeof obj.command === 'string' ? obj.command.trim() : '',
    done: obj.done === true,
    why: typeof obj.why === 'string' ? obj.why : '',
    raw,
  };
}

test('STAGE-B PALETTE — model drives the real Forge command palette → build → render → mp4', async () => {
  // Very generous: launch + cold adapter swap + a multi-turn palette loop (each
  // turn is a :8080 call) + the photoreal multi-cam render + ffmpeg.
  test.setTimeout(25 * 60 * 1000);
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  try { fs.unlinkSync(VIDEO_PATH); } catch (_) {}

  console.log(`[forge-palette] adapter (routed by :8080): ${ADAPTER_LABEL}`);
  console.log(`[forge-palette] goal: ${PROMPT}`);
  console.log(`[forge-palette] max steps: ${MAX_STEPS}`);

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
  page.on('console', (msg) => {
    const t = msg.text();
    if (/palette|menu-action|dispatch|forge\.runner|part\.|asset\.|sketch\.|workbench/i.test(t)) {
      console.log(`[page] ${t}`);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  }).catch(() => {});
  await page.reload().catch(() => {});
  await page.waitForLoadState('domcontentloaded');

  // The shell + renderer + native kernel + ForgeRunner must all be wired before
  // we drive — same gates as the Stage-A spec. (The palette executes real tool /
  // menu / workbench actions; those need the kernel ready.)
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 20000 });
  await page.waitForFunction(
    () => !!(window.forge && window.forge.isReady && window.forge.isReady()
             && typeof window.__forgeRun === 'function'
             && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'),
    { timeout: 30000 },
  );
  // The CommandPaletteHost must have registered its programmatic opener — proof
  // the palette is mounted and listening for Cmd+K.
  await page.waitForFunction(
    () => typeof window.__forgeOpenCommandPalette === 'function',
    { timeout: 20000 },
  );
  // clean slate — the clip opens on an empty viewport.
  await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
  await page.evaluate(() => { window.__forgeFit?.(); });
  await page.waitForTimeout(600);

  // ── frame recorder (canvas-only) ───────────────────────────────────────────
  let fi = 0;
  const shot = async (tag) => {
    await shotCanvas(page, path.join(FRAME_DIR, `f_${String(fi++).padStart(5, '0')}.png`));
    if (tag) console.log(`[forge-palette] frame ${fi - 1} :: ${tag}`);
  };
  const dwell = async (n, perMs = 130) => {
    for (let i = 0; i < n; i++) { await page.waitForTimeout(perMs); await shot(null); }
  };

  // ── live signals (read-only) ───────────────────────────────────────────────
  const sceneCount = () => page.evaluate(() => (window.__forgeBodies || []).length).catch(() => 0);
  const featureCount = () => page.evaluate(() => (window.__forgeFeatureTree || []).length).catch(() => 0);

  // ── genuine palette gestures ───────────────────────────────────────────────
  // Open the palette the way CommandPaletteHost wires it: programmatically via
  // window.__forgeOpenCommandPalette(true) — the SAME state setter the Cmd+K
  // keydown handler calls (CommandPalette.jsx:434). We use the programmatic
  // opener rather than page.keyboard.press('Meta+K') because the chord can be
  // swallowed by the OS menu in headed Electron; the opener is the identical
  // code path the shortcut triggers, so this is still genuine UI operation.
  const PAL = '[data-testid="forge-cmd-palette"]';
  const PAL_INPUT = '[data-testid="forge-cmd-palette-input"]';
  const PAL_RESULTS = '[data-testid="forge-cmd-palette-results"]';
  const openPalette = async () => {
    await page.evaluate(() => { window.__forgeOpenCommandPalette?.(true); });
    await page.waitForSelector(PAL, { timeout: 4000 });
    await expect(page.locator(PAL_INPUT)).toBeVisible({ timeout: 4000 });
  };
  const closePalette = async () => {
    // Esc closes (CommandPalette.jsx:335). Best-effort — a selected command may
    // already have closed it.
    try { await page.keyboard.press('Escape'); } catch (_) {}
    await page.waitForSelector(PAL, { state: 'detached', timeout: 2000 }).catch(() => {});
  };
  // Type a command, read how many results the fuzzy matcher returned, and (if
  // any) select the top match with Enter — the genuine select gesture. Returns
  // { matched, count, top } so the loop can log + assert the palette actually
  // found something. The results count is read off data-result-count
  // (CommandPalette.jsx:374); the top label/kind off the first role="option"
  // (data-cmd-id/data-cmd-kind, CommandPalette.jsx:384-388).
  const runCommand = async (command) => {
    await openPalette();
    const input = page.locator(PAL_INPUT);
    await input.click();
    await input.fill('');                 // clear any prior query
    await input.type(command, { delay: 18 });
    await page.waitForTimeout(220);       // let the useMemo fuzzy filter settle
    const info = await page.evaluate((sel) => {
      const ul = document.querySelector(sel.results);
      const count = ul ? Number(ul.getAttribute('data-result-count') || '0') : 0;
      const first = ul ? ul.querySelector('[role="option"]') : null;
      return {
        count,
        topId: first ? first.getAttribute('data-cmd-id') : null,
        topKind: first ? first.getAttribute('data-cmd-kind') : null,
        topLabel: first ? (first.textContent || '').trim().slice(0, 80) : null,
      };
    }, { results: PAL_RESULTS });
    if (info.count > 0) {
      // Enter executes the active (top) result — executeEntry + onClose
      // (CommandPalette.jsx:342-346). This is the genuine selection.
      await input.press('Enter');
      // executeEntry's tool path defers one frame then clicks the tool button
      // (CommandPalette.jsx:221); give the action time to run + the scene to
      // regenerate.
      await page.waitForTimeout(600);
      await page.waitForSelector(PAL, { state: 'detached', timeout: 2000 }).catch(() => {});
      return { matched: true, ...info };
    }
    // No match — close the palette and report it so the model can try other text.
    await closePalette();
    return { matched: false, ...info };
  };

  // ── (1) hold on the empty viewport so the video opens clean ─────────────────
  await shot('empty viewport');
  await dwell(5);

  // ── (2) screenshot → decide → act loop ─────────────────────────────────────
  // The model gets a canvas screenshot + the running command log each turn and
  // names ONE palette command. We type + select it, capture frames, and repeat.
  const history = [
    { role: 'system', content: `${PALETTE_SYSTEM}\n${PROMPT}` },
  ];
  const droveCommands = [];     // every command the model picked (matched or not)
  const executedCommands = [];  // commands that the palette actually matched + ran
  let fetchOk = false;          // did :8080 ever answer?
  let serveError = null;        // honest failure detail if it never did
  let modelDone = false;

  for (let step = 0; step < MAX_STEPS && !modelDone; step++) {
    await shot(`turn ${step + 1} — observing`);
    const img = await canvasDataUrl(page);
    const n = await sceneCount();
    const f = await featureCount();

    // Compose the per-turn user message: the canvas image (grounding) + a compact
    // text state line. The image part is OpenAI-compat multimodal; if the served
    // model ignores images it still gets the text state, so the loop degrades
    // gracefully without faking.
    const stateLine =
      `Viewport now: ${n} bodies, ${f} features. `
      + (droveCommands.length
          ? `Commands run so far: ${executedCommands.map((c) => `"${c}"`).join(', ') || '(none matched yet)'}. `
          : 'Nothing run yet. ')
      + 'Name the next palette command (one JSON line).';
    const userContent = img
      ? [{ type: 'text', text: stateLine },
         { type: 'image_url', image_url: { url: img } }]
      : stateLine;
    history.push({ role: 'user', content: userContent });

    let reply;
    try {
      reply = await archieComplete(history, { maxTokens: 200 });
      fetchOk = true;
    } catch (e) {
      serveError = String(e && e.message || e);
      console.warn(`[forge-palette] :8080 call failed on turn ${step + 1}: ${serveError}`);
      break; // HONEST failure — no fake. The assertions below will flag it.
    }
    history.push({ role: 'assistant', content: reply });

    const decision = parseDecision(reply);
    console.log(`[forge-palette] turn ${step + 1} decision: ${JSON.stringify({
      command: decision.command, done: decision.done, why: decision.why })}`);
    if (decision.done || !decision.command) {
      console.log(`[forge-palette] model signalled done on turn ${step + 1} (${decision.why || 'no command'}).`);
      modelDone = true;
      break;
    }

    droveCommands.push(decision.command);
    const result = await runCommand(decision.command);
    console.log(`[forge-palette] palette "${decision.command}" → matched=${result.matched}`
      + ` count=${result.count} top=${result.topKind || '-'}:${result.topLabel || '-'}`);
    if (result.matched) {
      executedCommands.push(decision.command);
      // a fresh body / feature may have landed — box-frame the part so it stays
      // framed as the build grows (same as Stage A).
      await computePartBox(page).catch(() => {});
      await fitPart(page, [1.4, 0.6, 1.0], 2.2).catch(() => {});
    }
    await dwell(4, 160);
  }

  await dwell(4, 200);

  const finalCount = await sceneCount();
  const finalFeatures = await featureCount();
  console.log(`[forge-palette] loop ended — drove ${droveCommands.length} commands, `
    + `${executedCommands.length} executed via the palette.`);
  console.log(`[forge-palette] scene bodies=${finalCount}, features=${finalFeatures}`);
  console.log(`[forge-palette] MODEL PALETTE COMMANDS:`);
  droveCommands.forEach((c, i) => console.log(`   ${i + 1}. "${c}"`
    + (executedCommands.includes(c) ? '  ✓ executed' : '  · no match')));
  if (!fetchOk) {
    console.error('[forge-palette] :8080 NEVER answered — serve is down. '
      + 'Start it: cd ~/archdisc-Models && ./serve_forge_cua.sh');
  }

  // The "did the model build something" signal: either a viewport body OR feature
  // tree growth (palette workbench/menu actions seed the feature tree before the
  // body regenerates). Treated together so the outcome assertion is honest about
  // what genuine palette operation produced.
  const built = finalCount > 0 || finalFeatures > 0;

  // ── (3) PHOTOREAL "RENDER" — whatever the palette built, dressed + multi-cam ─
  // Same path as the Stage-A + flagship specs: dress the live bodies (we do NOT
  // inject our own part) and capture ≥5 named camera angles + an orbit.
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
    console.log('[forge-palette] photoreal:', JSON.stringify(photoreal));

    const partBox = await computePartBox(page);
    console.log(`[forge-palette] part box → ${JSON.stringify(partBox)}`);
    const fitOpen = await fitPart(page, [1.4, 0.6, 1.0], 2.2);
    console.log(`[forge-palette] hero open fit → ${JSON.stringify(fitOpen)}`);
    await dwell(6);

    for (const v of VIEWS) {
      await page.keyboard.press(v.key).catch(() => {});
      await page.waitForTimeout(400);
      const fitV = await fitPart(page, v.dir, 2.2);
      console.log(`[forge-palette] hero ${v.name} fit → ${JSON.stringify(fitV)}`);
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
      await page.mouse.click(cx, cy);
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(cx, cy); await page.mouse.down();
        await page.mouse.move(cx + 22, cy, { steps: 3 }); await page.mouse.up();
        await shot(null);
      }
    }
    await dwell(6);

    await page.keyboard.press('1').catch(() => {});
    await page.waitForTimeout(300);
    await computePartBox(page).catch(() => {});
    await fitPart(page, [1.4, 0.6, 1.0], 2.2).catch(() => {});
    await page.waitForTimeout(300);
    await shotCanvas(page, HERO_PATH);
    console.log(`[forge-palette] hero still → ${HERO_PATH}`);
  } else {
    // no native body — still write a hero still of the final viewport so the
    // deliverable set is complete, and warn loudly.
    await shotCanvas(page, HERO_PATH);
    console.warn('[forge-palette] NO viewport body built via the palette — '
      + (fetchOk
          ? 'the model drove commands but none produced a solid (see the command log + the Stage-B known-gaps doc).'
          : 'serve was down on :8080 — that is the honest failure, not a palette bug.'));
  }

  // ── close cleanly ──────────────────────────────────────────────────────────
  await page.evaluate(() => { window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  // ── (4) stitch frames → mp4 (the video opens on the typed prompt) ───────────
  const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png')).sort();
  const ff = ffmpegBin();
  execFileSync(ff, [
    '-y', '-framerate', '12',
    '-pattern_type', 'glob', '-i', path.join(FRAME_DIR, 'f_*.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    VIDEO_PATH,
  ], { stdio: 'inherit' });
  console.log(`[forge-palette] mp4 → ${VIDEO_PATH}  (${frames.length} frames @ 12fps)`);

  // ── assertions (outcome-based, because the MODEL is in the loop) ────────────
  // The mp4 must exist + be a real ftyp-headed file with enough frames.
  expect(fs.existsSync(VIDEO_PATH), 'no mp4 produced').toBeTruthy();
  const buf = fs.readFileSync(VIDEO_PATH);
  expect(buf.length, 'mp4 must be non-trivial').toBeGreaterThan(4096);
  expect(buf[4]).toBe(0x66); expect(buf[5]).toBe(0x74);
  expect(buf[6]).toBe(0x79); expect(buf[7]).toBe(0x70);
  expect(fi, 'too few frames captured').toBeGreaterThan(20);

  // HONEST serve gate: if :8080 never answered, fail loudly with the fix — NOT a
  // palette bug, and never silently green.
  expect(
    fetchOk,
    `the model was never reached on :8080 (${serveError || 'no response'}) — `
      + 'is serve up with the Forge adapter? cd ~/archdisc-Models && ./serve_forge_cua.sh',
  ).toBeTruthy();

  // GENUINE-CUA proof: the model named ≥1 palette command AND the real palette
  // matched + executed ≥1 of them (the genuine open→type→select gesture ran).
  expect(
    droveCommands.length > 0,
    'the model named no palette command — check the served adapter + the compact palette prompt.',
  ).toBeTruthy();
  expect(
    executedCommands.length > 0,
    'the palette matched none of the model commands — the fuzzy search found nothing for any chosen text.',
  ).toBeTruthy();

  // OUTCOME: a body OR feature was produced through genuine palette operation.
  // (See STAGE_B_PALETTE.md known-gaps — most palette geometry tools open a param
  // dialog rather than seed a body in one selection; feature-tree growth is the
  // honest one-selection signal, body count the stronger one.)
  expect(
    built,
    'palette commands executed but produced no body/feature — '
      + 'the model reached the tools but did not complete a one-selection build '
      + '(see STAGE_B_PALETTE.md → known gaps / testid additions).',
  ).toBeTruthy();
});
