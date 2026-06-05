// PUSH-15 — SIMP topology optimisation e2e.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(240000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-15');

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

test('PUSH-15-A — panel opens', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenTopologyWorkbench && window.__forgeOpenTopologyWorkbench());
    await page.waitForSelector('[data-testid="forge-topology-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-15-B — small grid (6×4×3) SIMP run completes', async () => {
    const a0 = await archieCount();
    // Use a tiny grid (6×4×3 = 72 cells = 432 tets) so the run finishes in
    // reasonable wallclock for CI. Reduce maxIter to 6.
    await page.fill('[data-testid="forge-topo-nx"]', '6');
    await page.fill('[data-testid="forge-topo-ny"]', '4');
    await page.fill('[data-testid="forge-topo-nz"]', '3');
    await page.fill('[data-testid="forge-topo-maxiter"]', '6');
    await page.click('[data-testid="forge-topo-run"]');
    await page.waitForSelector('[data-testid="forge-topo-report"]', { timeout: 60000 });
    const iter = parseInt(await page.locator('[data-testid="forge-topo-iter"]').innerText(), 10);
    const cells = parseInt(await page.locator('[data-testid="forge-topo-cells"]').innerText(), 10);
    expect(iter).toBeGreaterThan(0);
    expect(iter).toBeLessThanOrEqual(6);
    expect(cells).toBe(72);
    await shot('B-top-converged');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-15-C — compliance is finite and positive', async () => {
    const a0 = await archieCount();
    const c = await page.locator('[data-testid="forge-topo-compliance"]').innerText();
    const cv = parseFloat(c);
    expect(Number.isFinite(cv)).toBe(true);
    expect(cv).toBeGreaterThan(0);
    await shot('C-right-compliance');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-15-D — density histogram has 10 bins', async () => {
    const a0 = await archieCount();
    const rows = await page.locator('[data-testid="forge-topo-histogram"] tr').count();
    expect(rows).toBe(10);
    await shot('D-iso-histogram');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-15-E — programmatic window.forge.topology.runCantilever works', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        return window.forge.topology.runCantilever({
            W: 30, H: 20, T: 15, nx: 4, ny: 3, nz: 2,
            maxIter: 4, volumeFraction: 0.3,
        });
    });
    expect(r).toBeTruthy();
    expect(r.densitiesCube.length).toBe(24);  // 4×3×2
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.compliance).toBeGreaterThan(0);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-15-F — SDF closure built from result returns sane values', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        const opt = window.forge.topology.runCantilever({
            W: 30, H: 20, T: 15, nx: 4, ny: 3, nz: 2, maxIter: 3,
        });
        const sdf = window.forge.topology.makeCubeDensitySDF(opt, 0.5);
        // Inside design box → -1..+1; outside → -1.
        const insideMid = sdf([15, 10, 7.5]);
        const outsideFar = sdf([100, 100, 100]);
        return { insideMid, outsideFar };
    });
    expect(r.outsideFar).toBe(-1);
    expect(r.insideMid).toBeGreaterThanOrEqual(-1);
    expect(r.insideMid).toBeLessThanOrEqual(1);
    await shot('E-close-sdf');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-15-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
