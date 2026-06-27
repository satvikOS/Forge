// ─────────────────────────────────────────────────────────────────────────────
// cadgenbench-cua-helper.js — shared, page-driven helpers for the GENUINE-CUA
// CADGenBench harness (cadgenbench-cua.spec.js) AND its offline self-check
// (cadgenbench-cua-selfcheck.js).
//
// EVERY function here operates ONLY through the `page` object (Playwright's
// real Electron page, or — in the self-check — a MockPage that simulates the
// live console WITHOUT the model). Because the spec and the self-check call the
// SAME functions, the self-check exercises the real wiring; only Electron + the
// trained model are stubbed.
//
// THE GENUINE CUA CONTRACT (the governing "by only CUAs" principle):
//   submitPromptToConsole() types the fixture spec into the LIVE Forge command
//   bar [data-testid="forge-cmdbar-input"] and presses Enter. That is the EXACT
//   entry a human uses:
//       CommandBar onKeyDown Enter → submit() → onSubmit(text)
//         (frontend/src/forge-v4/CommandBar.jsx:93-94, 48)
//       → ForgeShellV4 onSubmit={(text)=>runArchie(text)}
//         (frontend/src/forge-v4/ForgeShellV4.jsx:3134)
//       → runArchie → import('../ai/ForgeRunner.js').runForgePrompt
//         (frontend/src/forge-v4/ForgeShellV4.jsx:572, 633)
//       → :8080 trained adapter → <tool_call>s → ForgeToolBridge.dispatchToolCall
//         → forge-kernel.node → bodies surfaced into window.__forgeBodies.
//   The geometry MUST come from THAT path. We NEVER call
//   window.__forgeEngine.dispatchToolCall / window.__forgeRun with a fixed
//   sequence (the deterministic builder bypass the flagship specs use) — doing
//   so would defeat the genuine-CUA requirement.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

// ── default locations (all overridable by the spec via env) ──────────────────
const MODELS_ROOT = '/Users/account_clawteam1/archdisc-Models';
const MECH_ROOT = '/Users/account_clawteam1/archdisc-Mech';
const DEFAULT_SPECS = path.join(MODELS_ROOT, 'data/forge/cadgen_mm/specs49.jsonl');
const DEFAULT_FIXTURES = path.join(MODELS_ROOT, 'data/cadgenbench-data');
const DEFAULT_OUT = path.join(MECH_ROOT, 'cadgenbench_deliverables/cua_submission');

// ── (1) fixture specs — VLM-extracted dimensioned prompts, keyed by id ───────
// specs49.jsonl is one JSON object per line: {"id":"101","spec":"A 120 x 80 …"}.
function loadSpecs(specPath = DEFAULT_SPECS) {
  if (!fs.existsSync(specPath)) {
    throw new Error(`[cadgen-cua] spec file not found: ${specPath}`);
  }
  const out = [];
  const lines = fs.readFileSync(specPath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); }
    catch (e) { throw new Error(`[cadgen-cua] bad JSONL line in ${specPath}: ${t.slice(0, 80)}`); }
    if (obj && obj.id != null && typeof obj.spec === 'string' && obj.spec.trim()) {
      out.push({ id: String(obj.id), spec: obj.spec.trim() });
    }
  }
  if (out.length === 0) throw new Error(`[cadgen-cua] no usable {id,spec} rows in ${specPath}`);
  return out;
}

// Optional fixture-set narrowing. `only` = comma-separated ids; `limit` = count.
function pickFixtures(specs, { only = '', limit = 0 } = {}) {
  let list = specs.slice();
  if (only && String(only).trim()) {
    const want = new Set(String(only).split(',').map((s) => s.trim()).filter(Boolean));
    list = list.filter((f) => want.has(f.id));
  }
  if (limit && Number(limit) > 0) list = list.slice(0, Number(limit));
  return list;
}

// ── output layout — matches the CADGenBench submission contract exactly:
//    <outRoot>/<id>/output.step  (one folder per sample id; see
//    forge-kernel/test/cadgenbench_submission_packer.mjs §1). ───────────────────
function dirFor(outRoot, id) { return path.join(outRoot, String(id)); }
function stepPathFor(outRoot, id) { return path.join(dirFor(outRoot, id), 'output.step'); }
function renderPathFor(outRoot, id) { return path.join(dirFor(outRoot, id), 'render.png'); }
function metaPathFor(outRoot, id) { return path.join(dirFor(outRoot, id), 'meta.json'); }

// ─────────────────────────────────────────────────────────────────────────────
// PAGE-DRIVEN PRIMITIVES (genuine console only)
// ─────────────────────────────────────────────────────────────────────────────

// Route the live console to a chosen adapter (A/B v7 vs CPT-re-SFT later) via
// window.__FORGE_ADAPTER_OVERRIDE — the non-breaking hook ForgeRunner reads
// (frontend/src/ai/ForgeRunner.js:268). addInitScript re-applies across reloads.
async function routeAdapter(page, adapter) {
  if (!adapter) return;
  await page.addInitScript((a) => { try { window.__FORGE_ADAPTER_OVERRIDE = a; } catch (_) {} }, adapter);
  await page.evaluate((a) => { try { window.__FORGE_ADAPTER_OVERRIDE = a; } catch (_) {} }, adapter).catch(() => {});
}

// Gate: native kernel ready + runner installed + STEP writer wired. runArchie
// no-ops (posts an "addon isn't loaded" reply, never calls :8080) unless the
// native kernel is ready, so this MUST hold before any fixture is driven.
async function waitForReady(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => !!(window.forge && window.forge.isReady && window.forge.isReady()
             && typeof window.__forgeRun === 'function'
             && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'
             && window.forge.io && typeof window.forge.io.exportStep === 'function'),
    { timeout: timeoutMs },
  );
}

// Clear the scene so each fixture renders/exports unambiguously its own part.
async function clearScene(page) {
  await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} }).catch(() => {});
}

// THE CUA OPERATION — type the spec into the LIVE command bar and submit it the
// SAME way a human does (no bypass). See the genuine-CUA contract at the top.
async function submitPromptToConsole(page, prompt) {
  const input = page.locator('[data-testid="forge-cmdbar-input"]');
  await input.click();
  await input.fill(prompt);
  await input.press('Enter'); // → onKeyDown Enter → submit() → onSubmit → runArchie
}

// Count the bodies THIS turn's model drove into the scene. runArchie tags every
// Archie-built body id `archie-<base36>-<seq>` with kind:'native'
// (frontend/src/forge-v4/ForgeShellV4.jsx:673-704).
async function archieBodyCount(page) {
  return page.evaluate(() => (window.__forgeBodies || [])
    .filter((b) => String(b && b.id || '').startsWith('archie-')
                && b.kind === 'native' && typeof b.handle === 'number').length).catch(() => 0);
}

// The dock pushes a `tool` role message per dispatched tool_call ("▶ box … ✓");
// reading them proves the model genuinely drove the build step by step.
async function readToolSteps(page) {
  return page.evaluate(() => Array.from(
    document.querySelectorAll('.forge-archie-msg[data-role="tool"]'),
  ).map((el) => (el.textContent || '').trim()).filter(Boolean)).catch(() => []);
}

// Poll until the model has driven ≥minBodies AND the scene has settled (the
// single-shot Forge build emits a complete part in one turn). Returns the final
// body count reached (0 = honest miss).
async function waitForBuild(page, { minBodies = 1, timeoutMs = 180000, pollMs = 800, settleMs = 6000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = -1; let stable = 0;
  while (Date.now() < deadline) {
    const n = await archieBodyCount(page);
    if (n === last) stable += pollMs; else { stable = 0; last = n; }
    if (n >= minBodies && stable >= settleMs) return n;
    await page.waitForTimeout(pollMs);
  }
  return archieBodyCount(page);
}

// Resolve the final part body — the LAST archie-* native body, whose handle is
// the current body handle (context verbs accumulate into ONE evolving body, so
// for these single-part fixtures this is the finished solid). Mirrors
// demo-investor-forge.spec.js:306-313.
async function resolveFinalBody(page) {
  return page.evaluate(() => {
    const archie = (window.__forgeBodies || [])
      .filter((b) => String(b && b.id || '').startsWith('archie-')
                  && b.kind === 'native' && typeof b.handle === 'number');
    const last = archie[archie.length - 1] || null;
    return last
      ? { handle: last.handle, id: last.id, kind: last.kind, toolId: last.toolId || null, bodyCount: archie.length }
      : { handle: null, id: null, kind: null, toolId: null, bodyCount: archie.length };
  }).catch(() => ({ handle: null, id: null, kind: null, toolId: null, bodyCount: 0 }));
}

// Export the current body handle to STEP via the SAME OCCT writer the
// File ▸ Export STEP menu calls (window.forge.io.exportStep → preload io bridge
// → kernel.io.exportStep; electron/preload.js:1275). NO mesh, NO fake STEP.
async function exportStep(page, handle, fp) {
  return page.evaluate((args) => {
    try {
      const r = window.forge.io.exportStep(args.handle, args.fp);
      return { ok: r !== false, r };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, { handle, fp });
}

// Best-effort headless render of the result canvas for the local visual check.
// Frames the part then screenshots the WebGL canvas only (clean render, not the
// IDE chrome). Never throws — a render hiccup must not lose the STEP deliverable.
async function captureRender(page, fp) {
  try {
    await page.evaluate(() => { try { window.__forgeFit?.(); } catch (_) {} });
    await page.waitForTimeout(500);
    const tagged = page.locator('[data-testid="forge-v4-canvas"]');
    const loc = (await tagged.count().catch(() => 0)) > 0 ? tagged : page.locator('canvas').first();
    await loc.screenshot({ path: fp });
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// A valid AP203/AP214 STEP opens with ISO-10303-21 and carries geometry. Used to
// confirm the kernel wrote a real B-rep before we count the fixture as a hit.
function validateStepFile(fp) {
  if (!fs.existsSync(fp)) return { ok: false, reason: 'missing' };
  const txt = fs.readFileSync(fp, 'utf8');
  if (txt.length < 500) return { ok: false, reason: 'trivial', bytes: txt.length };
  if (!/ISO-10303-21/.test(txt)) return { ok: false, reason: 'no ISO-10303-21 header', bytes: txt.length };
  if (!/MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION|CARTESIAN_POINT/.test(txt)) {
    return { ok: false, reason: 'no geometric entities', bytes: txt.length };
  }
  return { ok: true, bytes: txt.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PER-FIXTURE ORCHESTRATION — genuine CUA, honest miss, no placeholder.
// Returns a result record; writes <id>/output.step ONLY on a validated hit,
// and ALWAYS writes <id>/meta.json (provenance for hit AND miss).
// ─────────────────────────────────────────────────────────────────────────────
async function runFixture(page, fixture, opts = {}) {
  const {
    outRoot = DEFAULT_OUT,
    fixturesDir = DEFAULT_FIXTURES,
    minBodies = 1,
    buildMs = 180000,
    render = true,
    adapterLabel = '',
    log = (() => {}),
  } = opts;

  const id = String(fixture.id);
  const dir = dirFor(outRoot, id);
  const stepPath = stepPathFor(outRoot, id);
  const renderPath = renderPathFor(outRoot, id);
  const metaPath = metaPathFor(outRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  // Never leave a stale STEP from a prior run masquerading as this run's hit.
  try { fs.unlinkSync(stepPath); } catch (_) {}
  // Drop the reference drawing beside the render so the local visual check has
  // the input.png and our result side by side (best-effort, never throws).
  try {
    const refPng = path.join(fixturesDir, id, 'input.png');
    if (fs.existsSync(refPng)) fs.copyFileSync(refPng, path.join(dir, 'input.png'));
  } catch (_) {}

  const rec = {
    id, status: 'miss', reason: null, spec: fixture.spec,
    adapter: adapterLabel || null, handle: null, bodyCount: 0,
    toolCalls: 0, stepBytes: 0, stepPath: null, renderPath: null,
    startedAt: new Date().toISOString(),
  };

  const writeMeta = () => {
    rec.finishedAt = new Date().toISOString();
    try { fs.writeFileSync(metaPath, JSON.stringify(rec, null, 2)); } catch (_) {}
  };

  // (a) clean slate, (b) TYPE THE SPEC INTO THE LIVE CONSOLE (the CUA op).
  await clearScene(page);
  log(`[${id}] → console: ${fixture.spec.slice(0, 90)}${fixture.spec.length > 90 ? '…' : ''}`);
  await submitPromptToConsole(page, fixture.spec);

  // (c) watch the model drive the kernel build.
  const n = await waitForBuild(page, { minBodies, timeoutMs: buildMs });
  const tools = await readToolSteps(page);
  rec.bodyCount = n;
  rec.toolCalls = tools.length;

  if (n < minBodies) {
    rec.reason = 'no body built by the model (honest miss — serve down, kernel error, or model declined)';
    log(`[${id}] MISS — ${rec.reason} (tool_calls=${tools.length})`);
    writeMeta();
    return rec;
  }

  // (d) resolve the finished part body handle.
  const body = await resolveFinalBody(page);
  rec.handle = body.handle;
  rec.bodyCount = body.bodyCount;
  if (body.handle == null || typeof body.handle !== 'number') {
    rec.reason = 'no archie-* native body with a numeric kernel handle';
    log(`[${id}] MISS — ${rec.reason}`);
    writeMeta();
    return rec;
  }

  // (e) export STEP via the real OCCT writer.
  const ex = await exportStep(page, body.handle, stepPath);
  if (!ex.ok) {
    rec.reason = `forge.io.exportStep failed: ${ex.error || ex.r}`;
    log(`[${id}] MISS — ${rec.reason}`);
    try { fs.unlinkSync(stepPath); } catch (_) {}
    writeMeta();
    return rec;
  }

  // (f) validate the written STEP — a real B-rep, not a stub.
  const v = validateStepFile(stepPath);
  if (!v.ok) {
    rec.reason = `STEP written but invalid (${v.reason})`;
    log(`[${id}] MISS — ${rec.reason}`);
    try { fs.unlinkSync(stepPath); } catch (_) {}
    writeMeta();
    return rec;
  }

  rec.status = 'hit';
  rec.stepBytes = v.bytes;
  rec.stepPath = stepPath;

  // (g) headless render for the local visual check (best-effort).
  if (render) {
    const r = await captureRender(page, renderPath);
    if (r.ok) rec.renderPath = renderPath;
  }

  log(`[${id}] HIT — handle=${body.handle} bodies=${body.bodyCount} tool_calls=${tools.length} step=${v.bytes}B`);
  writeMeta();
  return rec;
}

module.exports = {
  // locations
  DEFAULT_SPECS, DEFAULT_FIXTURES, DEFAULT_OUT, MECH_ROOT, MODELS_ROOT,
  // fixtures
  loadSpecs, pickFixtures,
  // output layout
  dirFor, stepPathFor, renderPathFor, metaPathFor,
  // page primitives (genuine console)
  routeAdapter, waitForReady, clearScene, submitPromptToConsole,
  archieBodyCount, readToolSteps, waitForBuild, resolveFinalBody,
  exportStep, captureRender, validateStepFile,
  // orchestration
  runFixture,
};
