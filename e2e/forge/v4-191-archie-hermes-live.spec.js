// v4-191-archie-hermes-live.spec.js — Forge-191 headed verification that
// the LIVE hermes_forge adapter drives the real app end-to-end:
//
//   cmdbar prompt → runArchie → mlx_lm.server (localhost:8080, per-request
//   adapters=hermes_forge hot-swap) → <tool_call> tags → ForgeToolBridge →
//   native forge-kernel.node → bodies in window.__forgeBodies → viewport.
//
// NO LLM mock — this spec fails honestly when the model regresses (per the
// "no fallbacks tolerated" mandate). Only the optional sidecars (vision
// :8081 / memory :8083) are stubbed so their connection timeouts don't pad
// each turn.
//
// Requires:
//   - mlx_lm.server up on :8080 with models/hermes-3-8b-bf16 (any boot
//     adapter — runArchie hot-swaps to adapters/archie/hermes_forge
//     per-request).
//   - frontend prod bundle built (npm run build) — dev mode stalls on the
//     9k-line shell compile.
//
// Multi-camera screenshots per feedback-forge-multicam-e2e: ≥5 named
// angles + close-up, viewport framed via __forgeFit.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-191-archie-hermes';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _shotN = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_shotN).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const VIEWS = [
  { key: '1', name: 'iso'   },
  { key: '2', name: 'front' },
  { key: '4', name: 'top'   },
  { key: '6', name: 'right' },
  { key: '3', name: 'back'  },
];

async function submitPrompt(page, prompt) {
  const input = page.locator('[data-testid="forge-cmdbar-input"]');
  await input.click();
  await input.fill(prompt);
  await input.press('Enter');
}

async function archieBodyCount(page) {
  return page.evaluate(() =>
    (window.__forgeBodies || []).filter((b) => String(b.id || '').startsWith('archie-')).length);
}

async function threadTail(page, n = 8) {
  return page.evaluate((k) => {
    const els = Array.from(document.querySelectorAll('.forge-archie-msg'));
    return els.slice(-k).map((el) =>
      `[${el.getAttribute('data-role')}] ${(el.textContent || '').trim().slice(0, 160)}`);
  }, n);
}

// Wait until the archie-body count reaches `want` or a final archie
// message lands AND the count stopped moving. Live model turns run
// 5–30 s; budget generously.
async function waitForBodies(page, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    const n = await archieBodyCount(page);
    if (n >= want) return n;
    if (n !== last) last = n;
    await page.waitForTimeout(800);
  }
  return archieBodyCount(page);
}

test.describe.serial('Forge-191 · LIVE hermes_forge drives the app (no mock)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Sidecars (vision/memory) are optional — stub so each turn doesn't
    // pay their connection timeout. The chat endpoint is NOT stubbed.
    await page.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caption: '' }) }));
    await page.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) }));
    await page.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) }));

    await page.evaluate(() => {
      try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 15000 });
    await page.waitForTimeout(800);
  });

  test.afterAll(async () => { if (app) await app.close(); });

  test('01 native kernel is loaded (hard requirement — no canned fallback path)', async () => {
    await shot(page, 'baseline');
    const ready = await page.evaluate(() =>
      !!(window.forge && typeof window.forge.isReady === 'function' && window.forge.isReady()));
    expect(ready, 'forge-kernel.node must be loaded — the canned "kernel not ready" ' +
                  'reply would make this spec pass without touching Archie').toBe(true);
  });

  test('02 Archie chat server reachable on :8080', async () => {
    const ok = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8080/v1/models');
        const j = await r.json();
        return Array.isArray(j.data) && j.data.length > 0;
      } catch (_) { return false; }
    });
    expect(ok, 'mlx_lm.server must be up on :8080 for a LIVE-model spec').toBe(true);
  });

  test('03 "make a 100x50x30 mm box" → real tool_call → native body', async () => {
    test.setTimeout(180000);
    const before = await archieBodyCount(page);
    await submitPrompt(page, 'make a 100x50x30 mm box');
    await shot(page, 'box-typed');

    const after = await waitForBodies(page, before + 1, 90000);
    const tail = await threadTail(page);
    console.log('--- box thread tail ---');
    for (const t of tail) console.log(t);
    await shot(page, 'box-after');

    expect(after, `expected ≥1 archie body, thread: ${tail.join(' | ')}`)
      .toBeGreaterThanOrEqual(before + 1);

    // The dispatch must be the REAL part.make-box with the user's mm
    // dimensions — not a generic spawn.
    const boxBody = await page.evaluate(() => {
      const b = (window.__forgeBodies || []).filter((x) => x.toolId === 'part.make-box').pop();
      return b ? { toolId: b.toolId, params: b.params, kind: b.kind, handle: b.handle } : null;
    });
    expect(boxBody, 'no body with toolId part.make-box').not.toBeNull();
    expect(boxBody.kind).toBe('native');
    expect(typeof boxBody.handle).toBe('number');
    expect(boxBody.params).toMatchObject({ dx: 100, dy: 50, dz: 30 });

    // ✓ tool message in the thread (honest dispatch, not a fallback tier).
    const sawToolOk = (await threadTail(page, 12)).some((t) =>
      t.startsWith('[tool]') && t.includes('part.make-box') && t.includes('✓'));
    expect(sawToolOk, 'thread must show part.make-box(...) → ✓').toBe(true);
  });

  test('04 Hermes runtime path drove the turn (persona telemetry)', async () => {
    const p = await page.evaluate(() => window.__forgeLastPersona || null);
    expect(p, '__forgeLastPersona missing — runArchie did not run').not.toBeNull();
    expect(p.hermes, 'persona telemetry must flag the Forge-190 Hermes path').toBe(true);
    expect(String(p.systemHead || '')).toContain('kernel tool registry');
  });

  test('05 "build a flange" → multi-call dispatch (≥2 cylinders)', async () => {
    test.setTimeout(180000);
    const before = await archieBodyCount(page);
    await submitPrompt(page, 'build a flange');
    const after = await waitForBodies(page, before + 2, 90000);
    const tail = await threadTail(page, 12);
    console.log('--- flange thread tail ---');
    for (const t of tail) console.log(t);
    await shot(page, 'flange-after');

    // The flange recipe is cylinder + cylinder + fuse. Assert the two
    // cylinder spawns landed as bodies; the fuse handle-threading is a
    // known follow-up (the model emits fuse(a:1,b:2) against absolute
    // handles) — record it in the log, don't paper over it.
    const cylOk = tail.filter((t) =>
      t.startsWith('[tool]') && t.includes('part.make-cylinder') && t.includes('✓')).length;
    expect(cylOk, `expected ≥2 part.make-cylinder ✓ dispatches, thread: ${tail.join(' | ')}`)
      .toBeGreaterThanOrEqual(2);
    expect(after).toBeGreaterThanOrEqual(before + 2);
  });

  test('06 multi-camera screenshots — iso/front/top/right/back + close', async () => {
    // Viewport must dominate (feedback-scale-to-viewer): blur the cmdbar,
    // click the canvas, fit, then walk the named views.
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.__forgeFit?.(); });
    await page.waitForTimeout(400);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(450);
      await page.evaluate(() => { window.__forgeFit?.(); });
      await page.waitForTimeout(300);
      await shot(page, `bodies-${v.name}`);
    }
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 10; ++i) await page.mouse.wheel(0, -120);
    }
    await page.waitForTimeout(400);
    await shot(page, 'bodies-close');
  });

  test('07 feature tree lists the Archie bodies (UIUX surface, not just state)', async () => {
    // The Archie dock and the Inspector share the right rail (dockOpen
    // ternary in ForgeShellV4) — close the dock the way a user would so
    // the feature tree mounts.
    const closeBtn = page.locator('[data-testid="forge-archie"] [aria-label="Close dock"]');
    if (await closeBtn.count()) await closeBtn.click();
    await page.waitForTimeout(400);
    await shot(page, 'inspector-tree');
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="forge-feature-tree"] li'))
        .map((el) => (el.textContent || '').trim()));
    const archieEntries = labels.filter((l) => /archie/i.test(l));
    console.log('feature-tree archie entries:', archieEntries);
    expect(archieEntries.length,
      `feature tree must surface Archie bodies; saw: ${labels.slice(0, 12).join(' | ')}`)
      .toBeGreaterThanOrEqual(3);
  });
});
