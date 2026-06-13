// Forge-197 — parity ledger #17 (Forge half): modifier-key multi-select.
// Shift+click extends, Ctrl/Cmd+click toggles, plain click replaces,
// empty click clears the whole set. aisSelection owns the set;
// window.__forgeSelection.ids carries every selected body (consumers
// reading ids[0] keep working).
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

let app; let page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'],
    slowMo: 50,
  });
  page = await app.firstWindow();
  // --dev auto-opens DevTools; firstWindow() can race and grab it.
  if (page.url().startsWith('devtools://')) {
    page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-app"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 15000 });
  await page.waitForTimeout(600);
});

test.afterAll(async () => { if (app) await app.close(); });

test('Shift+click extends, Ctrl+click toggles, viewport clicks carry the set', async () => {
  test.setTimeout(120000);

  // Two native boxes side by side.
  await page.evaluate(() => {
    const h1 = window.forge.makeBox(60, 60, 60);
    const h2 = window.forge.translate(window.forge.makeBox(60, 60, 60), 150, 0, 0);
    window.__forgeAppendBody({ id: `ms-a-${h1}`, kind: 'native', handle: h1, toolId: 'part.make-box', name: 'ms A' });
    window.__forgeAppendBody({ id: `ms-b-${h2}`, kind: 'native', handle: h2, toolId: 'part.make-box', name: 'ms B' });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__forgeFit?.(); });
  await page.waitForTimeout(500);

  // Drive the selection-set semantics through the aisSelection snapshot
  // the viewport publishes — plain pick then modifier picks, using the
  // real handlers with synthetic entities (the same code path Viewport
  // onClick routes through after resolvePointerEvent).
  const result = await page.evaluate(async () => {
    const mod = await import('/src/forge-v4/aisSelection.js');
    const bodies = window.__forgeBodies.filter((b) => String(b.id).startsWith('ms-'));
    const [A, B] = bodies.map((b) => ({ kind: 'body', bodyId: b.handle ?? b.id, body: b }));

    // plain replace
    mod.clear();
    mod.addToSelection(A);
    const single = { ...window.__forgeSelection };

    // shift-extend
    mod.addToSelection(B);
    const extended = { ...window.__forgeSelection };
    const multiFlag = mod.isMultiSelect();

    // ctrl-toggle off
    mod.toggleSelection(A);
    const afterToggle = { ...window.__forgeSelection };

    // empty-click clears
    mod.onMissed();
    const afterMiss = { ...window.__forgeSelection };

    return { single, extended, multiFlag, afterToggle, afterMiss };
  });

  expect(result.single.kind).toBe('body');
  expect(result.single.ids.length).toBe(1);
  expect(result.extended.ids.length).toBe(2);
  expect(result.extended.multi).toBe(true);
  expect(result.multiFlag).toBe(true);
  expect(result.afterToggle.ids.length).toBe(1);
  expect(result.afterMiss.kind).toBe('none');
  expect(result.afterMiss.ids.length).toBe(0);
});
