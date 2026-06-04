// PUSH-13 — Standard parts browser e2e.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-13');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
});

test.afterAll(async () => {
    if (app) { try { await app.close({ timeout: 6000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
});

async function archieCount() { return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count(); }

test('PUSH-13-A — browser opens with full catalog (≥80 parts)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenStandardPartsBrowser && window.__forgeOpenStandardPartsBrowser());
    await page.waitForSelector('[data-testid="forge-stdparts-panel"]', { timeout: 5000 });
    const count = await page.evaluate(() => window.forge && window.forge.stdpartsCatalog && window.forge.stdpartsCatalog.count);
    expect(count).toBeGreaterThanOrEqual(80);
    await shot('A-front-catalog-open');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-13-B — filter "M8" finds the bolt and nut', async () => {
    const a0 = await archieCount();
    await page.fill('[data-testid="forge-stdparts-filter"]', 'M8');
    await page.waitForTimeout(100);
    const txt = await page.locator('[data-testid="forge-stdparts-list"]').innerText();
    expect(txt).toContain('ISO 4014 M8x40');
    expect(txt).toContain('ISO 4032 M8');
    expect(txt).toContain('ISO 7089 M8');
    await shot('B-top-m8');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-13-C — kind filter narrows to bearings only', async () => {
    const a0 = await archieCount();
    await page.fill('[data-testid="forge-stdparts-filter"]', '');
    await page.selectOption('[data-testid="forge-stdparts-kind"]', 'bearing');
    await page.waitForTimeout(150);
    const txt = await page.locator('[data-testid="forge-stdparts-list"]').innerText();
    expect(txt).toContain('SKF 6205');
    expect(txt).not.toContain('ISO 4014');
    await shot('C-right-bearings');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-13-D — kind filter to AISC W-shapes', async () => {
    const a0 = await archieCount();
    await page.selectOption('[data-testid="forge-stdparts-kind"]', 'wshape');
    await page.waitForTimeout(150);
    const txt = await page.locator('[data-testid="forge-stdparts-list"]').innerText();
    expect(txt).toContain('AISC W10x49');
    expect(txt).toContain('DIN IPE 200');
    await shot('D-iso-wshapes');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-13-E — insert button fires forge:insert-stdpart', async () => {
    const a0 = await archieCount();
    await page.selectOption('[data-testid="forge-stdparts-kind"]', 'gear');
    await page.waitForTimeout(150);
    await page.evaluate(() => {
        window.__stdpartTaps = [];
        window.__stdpartHandler = (e) => window.__stdpartTaps.push(e.detail);
        window.addEventListener('forge:insert-stdpart', window.__stdpartHandler);
    });
    await page.click('[data-testid^="forge-stdparts-insert-AGMA_m2"]');
    await page.waitForTimeout(300);
    const taps = await page.evaluate(() => {
        window.removeEventListener('forge:insert-stdpart', window.__stdpartHandler);
        return window.__stdpartTaps.slice();
    });
    expect(taps.length).toBeGreaterThan(0);
    expect(taps[0].part.kind).toBe('gear');
    await shot('E-close-insert');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-13-F — window.forge.stdpartsCatalog.get returns full spec', async () => {
    const a0 = await archieCount();
    const spec = await page.evaluate(() => window.forge.stdpartsCatalog.get('SKF 6204'));
    expect(spec).toBeTruthy();
    expect(spec.innerDiameter).toBe(20);
    expect(spec.outerDiameter).toBe(47);
    expect(spec.width).toBe(14);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-13-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
