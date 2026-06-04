// PUSH-17 — Materials library + exploded view e2e. Multi-cam.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-17');

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

async function archieCount() {
    return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
}

test('PUSH-17-A — materials panel opens with 22+ materials', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMaterialsLibrary && window.__forgeOpenMaterialsLibrary());
    await page.waitForSelector('[data-testid="forge-materials-panel"]', { timeout: 6000 });
    const list = page.locator('[data-testid^="forge-material-"]');
    expect(await list.count()).toBeGreaterThanOrEqual(20);
    await shot('A-front-library-open');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-17-B — filter narrows to aluminum', async () => {
    const a0 = await archieCount();
    await page.fill('[data-testid="forge-materials-filter"]', 'aluminum');
    await page.waitForTimeout(150);
    const count = await page.locator('[data-testid^="forge-material-"]').count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(8);
    await shot('B-top-filtered-aluminum');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-17-C — select 6061 + apply sets the global map', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-material-al-6061"]');
    await page.click('[data-testid="forge-materials-apply"]');
    await page.waitForSelector('[data-testid="forge-materials-confirm"]', { timeout: 3000 });
    const map = await page.evaluate(() => window.forge && window.forge.materials && window.forge.materials.map && window.forge.materials.map());
    expect(map['__default']).toBe('al-6061');
    await shot('C-right-applied');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-17-D — window.forge.materials.lookup returns full record', async () => {
    const a0 = await archieCount();
    const mat = await page.evaluate(() => window.forge.materials.lookup('steel-4140'));
    expect(mat).toBeTruthy();
    expect(mat.density).toBe(7850);
    expect(mat.E).toBe(205e9);
    expect(mat.Sut).toBe(1020e6);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-17-E — exploded view slider drives factor', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenExplodedView && window.__forgeOpenExplodedView());
    await page.waitForSelector('[data-testid="forge-explode-panel"]', { timeout: 4000 });
    // Set slider to 0.5 via JS (range inputs accept value but require event).
    await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-explode-slider"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '0.5');
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const factor = await page.locator('[data-testid="forge-explode-factor"]').innerText();
    expect(factor).toBe('0.50');
    await shot('D-iso-explode-mid');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-17-F — animate runs 0→1 and fires forge:explode-update', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => {
        window.__explodeTaps = [];
        window.__explodeHandler = (e) => window.__explodeTaps.push(e.detail.factor);
        window.addEventListener('forge:explode-update', window.__explodeHandler);
    });
    await page.click('[data-testid="forge-explode-play"]');
    await page.waitForTimeout(2600);
    const taps = await page.evaluate(() => {
        window.removeEventListener('forge:explode-update', window.__explodeHandler);
        return window.__explodeTaps.slice();
    });
    expect(taps.length).toBeGreaterThan(10);
    expect(taps[taps.length - 1]).toBeGreaterThanOrEqual(0.99);
    await shot('E-close-after-animate');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-17-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
