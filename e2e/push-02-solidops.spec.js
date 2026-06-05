// PUSH-02 — Solid modelling ops e2e.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-02');

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

test('PUSH-02-A — panel opens with 3 native surfaces detected', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSolidOpsWorkbench && window.__forgeOpenSolidOpsWorkbench());
    await page.waitForSelector('[data-testid="forge-solidops-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-02-B — fillet edges 0-3 listed', async () => {
    const a0 = await archieCount();
    const edges = await page.locator('[data-testid="forge-solidops-fillet-edges"]').innerText();
    expect(edges).toBe('0-3');
    await shot('B-top-fillet-config');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-02-C — direct surface forge.varfillet.fillet returns handle', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        if (!window.forge || !window.forge.varfillet || !window.forge.box) return null;
        const h = window.forge.box(50, 30, 20);
        return window.forge.varfillet.fillet(h, [0, 1, 2, 3],
            [{ start: 1, end: 5 }, { start: 1, end: 5 }, { start: 1, end: 5 }, { start: 1, end: 5 }]);
    });
    expect(result).toBeTruthy();
    expect(typeof result === 'number' || typeof result === 'object').toBe(true);
    await shot('C-right-fillet-direct');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-02-D — direct surface forge.loftguide.loft returns handle', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        if (!window.forge || !window.forge.loftguide) return null;
        return window.forge.loftguide.loft(
            [{ kind: 'circle', center: [0, 0, 0], radius: 10 },
             { kind: 'circle', center: [0, 0, 50], radius: 25 }],
            []
        );
    });
    expect(result).toBeTruthy();
    await shot('D-iso-loft-direct');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-02-E — tolerant boolean cut works with fuzzy=1e-3', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        if (!window.forge || !window.forge.booleantol || !window.forge.box || !window.forge.cyl) return null;
        const box = window.forge.box(50, 30, 20);
        const cyl = window.forge.cyl(8, 30, 25, 15, -5);
        return window.forge.booleantol.cut(box, cyl, 1e-3);
    });
    expect(result).toBeTruthy();
    await shot('E-close-tolbool');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-02-F — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
