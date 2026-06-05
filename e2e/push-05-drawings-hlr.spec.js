// PUSH-05 — Drawings HLR e2e (forge::drawings).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-05-hlr');

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

test('PUSH-05-A — drawings HLR panel opens', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenDrawingsHLRWorkbench && window.__forgeOpenDrawingsHLRWorkbench());
    await page.waitForSelector('[data-testid="forge-drawingshlr-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-05-B — project FRONT view of 100x60x40 box yields 4 visible + 4 hidden polylines', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-drawingshlr-project"]');
    await page.waitForSelector('[data-testid="forge-drawingshlr-view-report"]', { timeout: 8000 });
    const visible = parseInt(await page.locator('[data-testid="forge-drawingshlr-visible-count"]').innerText(), 10);
    const hidden  = parseInt(await page.locator('[data-testid="forge-drawingshlr-hidden-count"]').innerText(), 10);
    expect(visible).toBe(4);
    expect(hidden).toBe(4);
    await shot('B-top-front-view');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-05-C — emit DXF produces SECTION/ENTITIES with LWPOLYLINE', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-drawingshlr-emit-dxf"]');
    await page.waitForSelector('[data-testid="forge-drawingshlr-dxf"]', { timeout: 4000 });
    const dxf = await page.locator('[data-testid="forge-drawingshlr-dxf"]').innerText();
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('EOF');
    await shot('C-right-dxf');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-05-D — emit SVG produces valid <svg> with <path>', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-drawingshlr-emit-svg"]');
    await page.waitForSelector('[data-testid="forge-drawingshlr-svg"]', { timeout: 4000 });
    const svg = await page.locator('[data-testid="forge-drawingshlr-svg"]').innerText();
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(svg).toContain('</svg>');
    await shot('D-iso-svg');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-05-E — programmatic forge.drawings.projectView works on TOP', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        if (!window.forge || !window.forge.drawings || !window.forge.drawings.projectView) return null;
        const h = window.forge.box(50, 30, 20);
        return window.forge.drawings.projectView(h, 'top');
    });
    expect(r).toBeTruthy();
    expect(r.visibleEdges).toBeTruthy();
    expect(r.visibleEdges.length).toBeGreaterThan(0);
    expect(r.minX).toBeLessThan(r.maxX);
    expect(r.minY).toBeLessThan(r.maxY);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-05-F — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
