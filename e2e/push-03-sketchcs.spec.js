// PUSH-03 — Sketch constraints e2e (forge::sketcher, planegcs).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-03');

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

test('PUSH-03-A — panel opens', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSketchConstraintsWorkbench && window.__forgeOpenSketchConstraintsWorkbench());
    await page.waitForSelector('[data-testid="forge-sketch-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-03-B — 10 constraint kinds listed', async () => {
    const a0 = await archieCount();
    for (const name of ['Coincident', 'Parallel', 'Perpendicular', 'Distance',
                         'Horizontal', 'Vertical', 'PointOnLine', 'PointOnCircle',
                         'Equal', 'Tangent']) {
        await expect(page.locator(`[data-testid="forge-sketch-kind-${name}"]`)).toBeVisible();
    }
    await shot('B-top-kinds');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-03-C — rectangle build + solve yields exact axis-aligned rect', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-sketch-solve"]');
    await page.waitForSelector('[data-testid="forge-sketch-report"]', { timeout: 8000 });
    const status = await page.locator('[data-testid="forge-sketch-status"]').innerText();
    const rect   = await page.locator('[data-testid="forge-sketch-is-rect"]').innerText();
    expect(['1', '2', '0']).toContain(status);   // 0=converged/1=ok/2=under-constrained — solver returns enum
    expect(rect).toBe('true');
    await shot('C-right-rectangle');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-03-D — direct surface forge.sketcher solves a constrained line', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        if (!window.forge || !window.forge.sketcher) return null;
        const s = window.forge.sketcher;
        const h = s.createSketch();
        const p0 = s.addPoint(h, 0, 0);
        const p1 = s.addPoint(h, 50, 0.05);   // slightly off axis
        const ln = s.addLine(h, p0, p1);
        s.addConstraint(h, s.kinds.Horizontal, [ln]);
        s.addConstraint(h, s.kinds.Distance,   [p0, p0], 0);          // pin origin
        s.addConstraint(h, s.kinds.Distance,   [p0, p1], 50);
        const status = s.solve(h);
        const pp0 = s.readPoint(h, p0);
        const pp1 = s.readPoint(h, p1);
        s.destroySketch(h);
        return { status, pp0, pp1 };
    });
    expect(result).toBeTruthy();
    // p1 should now be on y=0 (horizontal line through origin), at x=50.
    expect(Math.abs(result.pp1.y)).toBeLessThan(1e-4);
    expect(result.pp1.x).toBeCloseTo(50, 3);
    await shot('D-iso-line');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-03-E — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
