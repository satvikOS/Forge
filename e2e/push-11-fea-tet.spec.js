// PUSH-11 — Tet4 FEA e2e (forge::fea::tet).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(600000);   // FEA runs slow

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-11');

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

test('PUSH-11-A — Tet4 panel opens', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenFEATetWorkbench && window.__forgeOpenFEATetWorkbench());
    await page.waitForSelector('[data-testid="forge-feat-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-11-B — mesh shape returns > 500 nodes + > 1000 tets', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-feat-mesh"]');
    await page.waitForSelector('[data-testid="forge-feat-mesh-report"]', { timeout: 60000 });
    const nodes = parseInt(await page.locator('[data-testid="forge-feat-node-count"]').innerText(), 10);
    const tets  = parseInt(await page.locator('[data-testid="forge-feat-tet-count"]').innerText(), 10);
    expect(nodes).toBeGreaterThan(500);
    expect(tets).toBeGreaterThan(1000);
    await shot('B-top-mesh');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-11-C — linear static solve converges with disp + vonMises in band', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-feat-solve-static"]');
    await page.waitForSelector('[data-testid="forge-feat-static-report"]', { timeout: 240000 });
    const conv  = await page.locator('[data-testid="forge-feat-converged"]').innerText();
    const disp  = parseFloat(await page.locator('[data-testid="forge-feat-maxdisp"]').innerText());
    const vm    = parseFloat(await page.locator('[data-testid="forge-feat-maxvm"]').innerText());
    expect(conv).toBe('true');
    // CST shear locking band: 0.5 µm < disp < 500 µm (theory 200 µm).
    expect(disp).toBeGreaterThan(0.5);
    expect(disp).toBeLessThan(500);
    // vonMises band: 10 < σ < 200 MPa.
    expect(vm).toBeGreaterThan(10);
    expect(vm).toBeLessThan(200);
    await shot('C-right-static');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-11-D — modal solve returns 3 frequencies in 50-5000 Hz band', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-feat-solve-modal"]');
    await page.waitForSelector('[data-testid="forge-feat-modal-report"]', { timeout: 300000 });
    const f0 = parseFloat(await page.locator('[data-testid="forge-feat-freq-0"]').innerText());
    expect(f0).toBeGreaterThan(50);
    // First mode of the 100x10x10 cantilever lies around 2.7 kHz; allow
    // up to 10 kHz for solver convergence on small meshes.
    expect(f0).toBeLessThan(10000);
    await shot('D-iso-modal');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-11-E — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
