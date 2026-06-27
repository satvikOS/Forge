// ─────────────────────────────────────────────────────────────────────────────
// cadgenbench-cua.spec.js — HEADLESS, GENUINE-CUA CADGenBench harness.
//
// For each of the 49 CADGenBench gen fixtures, Archie GENUINELY DRIVES FORGE:
// the VLM-extracted dimensioned spec (data/forge/cadgen_mm/specs49.jsonl) is
// TYPED into the LIVE Forge command bar (the SAME entry a human uses), the
// trained model drives ForgeRunner → forge-kernel.node, and the resulting OCCT
// B-rep is exported to <id>/output.step. This is the governing "by only CUAs"
// principle — the geometry comes from the model operating the app, NEVER from a
// deterministic dispatchToolCall/__forgeRun sequence.
//
// THE GENUINE CONSOLE PATH (every step is the real one — see the helper header):
//   type spec → [data-testid="forge-cmdbar-input"] Enter
//     → CommandBar.submit (CommandBar.jsx:48,93-94)
//     → ForgeShellV4 onSubmit → runArchie (ForgeShellV4.jsx:3134,547)
//     → ForgeRunner.runForgePrompt → :8080 trained adapter (ForgeShellV4.jsx:633)
//     → <tool_call>s → ForgeToolBridge.dispatchToolCall → forge-kernel.node
//     → window.__forgeBodies  → forge.io.exportStep(handle, path)  (preload.js:1275)
//
// HONEST MISS: if a fixture's CUA build produces no valid body, that id gets NO
// output.step — only a meta.json recording the miss. NEVER a placeholder STEP,
// never fallback geometry, never a faked export.
//
// HEADLESS (project rule — the watchable headed pass is a separate, deliberate
// run). Software GL (swiftshader) lets the canvas render for the visual check.
//
// ─────────────────────────────────────────────────────────────────────────────
// DO NOT auto-run while a GPU CPT train is in flight. Run in the CPT pause:
//
//   # 1) build the frontend dist the Electron main loads:
//   cd /Users/account_clawteam1/archdisc-Mech && (cd frontend && npm run build)
//   # 2) serve the trained Forge brain on :8080 (archdisc-Models):
//   #      cd ~/archdisc-Models && ./serve_forge_cua.sh
//   # 3) drive all 49 fixtures, HEADLESS:
//   npx playwright test e2e/forge/cadgenbench-cua.spec.js \
//     --config=e2e/forge/playwright.headless.config.js
//
//   # point it at a different adapter (A/B v7 vs the CPT-re-SFT fold):
//   FORGE_CUA_ADAPTER=adapters/archie/archie-14b-v3-cadgen-resft \
//     npx playwright test e2e/forge/cadgenbench-cua.spec.js \
//       --config=e2e/forge/playwright.headless.config.js
//
//   # a quick smoke (first 3 fixtures) or a specific subset:
//   CADGEN_LIMIT=3 npx playwright test e2e/forge/cadgenbench-cua.spec.js --config=…
//   CADGEN_ONLY=101,117,132 npx playwright test e2e/forge/cadgenbench-cua.spec.js --config=…
//
// Env knobs:
//   FORGE_CUA_ADAPTER — route the live console to this adapter (else shipped default)
//   CADGEN_SPECS      — specs jsonl (default …/archdisc-Models/data/forge/cadgen_mm/specs49.jsonl)
//   CADGEN_OUT        — output root (default …/archdisc-Mech/cadgenbench_deliverables/cua_submission)
//   CADGEN_ONLY       — comma list of ids to run
//   CADGEN_LIMIT      — cap the number of fixtures
//   CADGEN_BUILD_MS   — per-fixture watch budget (default 180000)
//   CADGEN_RENDER     — '0' to skip the headless render capture
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const H = require('./cadgenbench-cua-helper.js');

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

const SPECS_PATH = process.env.CADGEN_SPECS || H.DEFAULT_SPECS;
const OUT_ROOT   = process.env.CADGEN_OUT   || H.DEFAULT_OUT;
const ADAPTER    = process.env.FORGE_CUA_ADAPTER || '';
const BUILD_MS   = Number(process.env.CADGEN_BUILD_MS || 180000);
const DO_RENDER  = process.env.CADGEN_RENDER !== '0';

const FIXTURES = H.pickFixtures(H.loadSpecs(SPECS_PATH), {
  only: process.env.CADGEN_ONLY || '',
  limit: process.env.CADGEN_LIMIT || 0,
});

test.describe.serial('CADGenBench · GENUINE-CUA · spec → live model drives Forge → output.step', () => {
  let app, page;
  const results = [];

  test.beforeAll(async () => {
    // generous: 49 live single-shot builds share one app.
    test.setTimeout(60 * 60 * 1000);
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    console.log(`[cadgen-cua] fixtures: ${FIXTURES.length}  out: ${OUT_ROOT}`);
    console.log(`[cadgen-cua] adapter override: ${ADAPTER || '(shipped default)'}`);

    // headless software GL so the canvas renders for the visual check.
    app = await _electron.launch({
      args: [
        ELECTRON_MAIN, '--no-sandbox',
        '--use-gl=swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      ],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    if (page.url().startsWith('devtools://')) {
      page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
        || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
    }
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    await page.waitForLoadState('domcontentloaded');
    // route to the chosen adapter (no-op when unset) BEFORE the first runArchie.
    await H.routeAdapter(page, ADAPTER);
    await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} }).catch(() => {});
    await page.reload().catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
    await expect(page.locator('[data-testid="forge-cmdbar-input"]')).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 20000 });
    // native kernel + runner + STEP writer must all be wired or runArchie no-ops.
    await H.waitForReady(page, 30000);
  });

  test.afterAll(async () => {
    if (app) await app.close().catch(() => {});
    // write the batch summary.
    const summary = {
      generatedAt: new Date().toISOString(),
      specs: SPECS_PATH,
      outRoot: OUT_ROOT,
      adapter: ADAPTER || '(shipped default)',
      total: results.length,
      hits: results.filter((r) => r.status === 'hit').length,
      misses: results.filter((r) => r.status !== 'hit').length,
      results,
    };
    try {
      fs.writeFileSync(path.join(OUT_ROOT, '_summary.json'), JSON.stringify(summary, null, 2));
      console.log(`[cadgen-cua] SUMMARY → ${summary.hits}/${summary.total} hits; ${path.join(OUT_ROOT, '_summary.json')}`);
    } catch (_) {}
  });

  // 00 — preflight: kernel + STEP writer + LIVE chat server (a real-geometry run
  // is impossible without all three; fail loudly here, not silently per-fixture).
  test('00 preflight — native kernel + STEP writer + live :8080', async () => {
    const ready = await page.evaluate(() => !!(window.forge && window.forge.isReady && window.forge.isReady()));
    expect(ready, 'forge-kernel.node must be loaded').toBe(true);
    const hasStep = await page.evaluate(() => !!(window.forge && window.forge.io && typeof window.forge.io.exportStep === 'function'));
    expect(hasStep, 'window.forge.io.exportStep must be wired (preload io bridge)').toBe(true);
    const chatUp = await page.evaluate(async () => {
      try { const r = await fetch('http://localhost:8080/v1/models'); const j = await r.json(); return Array.isArray(j.data) && j.data.length > 0; }
      catch (_) { return false; }
    });
    expect(chatUp, 'mlx_lm.server must be up on :8080 (serve_forge_cua.sh) for a genuine-CUA run').toBe(true);
  });

  // 01 — the batch: drive every fixture through the genuine console. Per-fixture
  // misses are honest (recorded, no output.step) and do NOT fail the run; the
  // only hard failure is "the model drove NOTHING across the WHOLE batch", which
  // means serve is down / wiring is broken — the same signal the genuine demo
  // spec asserts.
  test('01 batch — 49 fixtures, genuine CUA, honest misses', async () => {
    test.setTimeout(60 * 60 * 1000);
    for (const fx of FIXTURES) {
      const rec = await H.runFixture(page, fx, {
        outRoot: OUT_ROOT,
        buildMs: BUILD_MS,
        render: DO_RENDER,
        adapterLabel: ADAPTER || '(shipped default)',
        log: (m) => console.log(m),
      });
      results.push(rec);
    }
    const hits = results.filter((r) => r.status === 'hit');
    console.log(`[cadgen-cua] DONE — ${hits.length}/${results.length} fixtures produced a valid output.step`);
    for (const r of results) {
      console.log(`   ${r.id}: ${r.status}${r.status === 'hit' ? ` (handle ${r.handle}, ${r.stepBytes}B)` : ` — ${r.reason}`}`);
    }
    // genuine-CUA guard: at least ONE fixture must have been built by the model.
    // (All-miss ⇒ serve down or the console path is broken — fail loudly.)
    expect(
      hits.length > 0,
      'the live model drove NOTHING across all fixtures — is serve up on :8080 with the Forge adapter (serve_forge_cua.sh)?',
    ).toBeTruthy();
  });
});
