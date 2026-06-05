// PUSH-04 — Assembly mate solver e2e (forge::matelib).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-04');

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

test('PUSH-04-A — solver panel opens', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMateSolverWorkbench && window.__forgeOpenMateSolverWorkbench());
    await page.waitForSelector('[data-testid="forge-mate-solver-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-04-B — 12 mate kinds listed', async () => {
    const a0 = await archieCount();
    for (let i = 0; i <= 11; i += 1) {
        await expect(page.locator(`[data-testid="forge-mate-kind-${i}"]`)).toBeVisible();
    }
    await shot('B-top-kinds');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-04-C — solve concentric demo converges', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-mate-solve"]');
    await page.waitForSelector('[data-testid="forge-mate-report"]', { timeout: 8000 });
    const converged = await page.locator('[data-testid="forge-mate-converged"]').innerText();
    expect(converged).toBe('true');
    const iter = parseInt(await page.locator('[data-testid="forge-mate-iterations"]').innerText(), 10);
    expect(iter).toBeGreaterThan(0);
    expect(iter).toBeLessThan(256);
    await shot('C-right-converged');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-04-D — direct kernel surface returns matelib', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        const poses = [
            { id: 1, fixed: true,  t: [0, 0, 0], q: [0, 0, 0, 1] },
            { id: 2, fixed: false, t: [10, 0, 0], q: [0, 0, 0, 1] },
        ];
        const mates = [{
            kind: 2, // distance
            a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
            b: { inst: 2, origin: [0, 0, 0], axis: [0, 0, 1] },
            value: 5,
        }];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBe(true);
    // Distance mate: |AB| should ≈ 5 after solve (down from 10).
    const dx = r.poses[1].t[0] - r.poses[0].t[0];
    const dy = r.poses[1].t[1] - r.poses[0].t[1];
    const dz = r.poses[1].t[2] - r.poses[0].t[2];
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    expect(len).toBeCloseTo(5, 1);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-04-E — reset clears report', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-mate-reset"]');
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid="forge-mate-report"]').count()).toBe(0);
    await shot('D-iso-reset');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-04-F — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
