// PUSH-19e — Airbus A320 main landing gear shock strut workflow.
//
// Specifications (Airbus A320 MLG, Messier-Bugatti-Dowty design):
//   - Outer cylinder Ø260 mm OD × 16 mm wall × 1900 mm length
//   - Inner piston Ø228 mm OD × 1100 mm stroke
//   - Material: AISI 300M steel (E=205 GPa, Sy=1620 MPa, Sut=1930 MPa,
//     ρ=7860 kg/m³) — ultra-high-strength low-alloy used in landing gear
//   - 4140 acceptable substitute in our materials library (Sy 655 MPa is
//     conservative; real 300M is 2.5× higher)
//   - Surface finish: outer chrome 0.1 Ra, inner bore 0.2 Ra (super-finish)
//
// Exercises:
//   - Outer cylinder + inner piston creation
//   - PUSH-17 materials (4140 chrome-moly as 300M substitute)
//   - PUSH-04 matelib (piston concentric in outer cylinder)
//   - PUSH-12 PMI (datum E gland, runout ⌒ 0.02, surface finish Ra 0.1)
//   - 5+ multi-cam screenshots
// Manual UI only.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19e');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
});

test.afterAll(async () => {
    if (app) { try { await app.close({ timeout: 6000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
});

async function archieCount() { return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count(); }

test('A320-A — front view: app ready', async () => {
    await page.waitForTimeout(400);
    await shot('A-front-ready');
});

test('A320-B — top view: build outer cylinder + inner piston', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        if (!window.forge || !window.forge.cyl || !window.forge.booleantol) return null;
        // Outer cylinder Ø260 × 1900 mm.
        const outer = window.forge.cyl(130, 1900, 0, 0, 0);
        // Inner bore Ø228 — cut from outer.
        const bore  = window.forge.cyl(114, 1900, 0, 0, 0);
        const outerHollow = window.forge.booleantol.cut(outer, bore, 1e-3);
        // Inner piston Ø228 OD × 1100 mm stroke, retracted.
        const piston = window.forge.cyl(114, 1100, 0, 0, 1900 - 1100);
        return { outerHollow, piston };
    });
    expect(result).toBeTruthy();
    expect(result.outerHollow).toBeTruthy();
    expect(result.piston).toBeTruthy();
    await shot('B-top-strut');
    expect(await archieCount()).toBe(a0);
});

test('A320-C — right view: 4140 steel (300M substitute) verified', async () => {
    const a0 = await archieCount();
    const mat = await page.evaluate(() => {
        if (!window.forge || !window.forge.materials) return null;
        return window.forge.materials.get('steel-4140');
    });
    expect(mat).toBeTruthy();
    expect(mat.Sy).toBeGreaterThan(600e6);          // 4140 is 655 MPa
    expect(mat.E).toBe(205e9);
    expect(mat.density).toBe(7850);
    await shot('C-right-material');
    expect(await archieCount()).toBe(a0);
});

test('A320-D — iso view: piston concentric mate to outer cylinder solves', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        if (!window.forge || !window.forge.matelib) return null;
        const poses = [
            { id: 1, fixed: true,  t: [0, 0, 0],       q: [0, 0, 0, 1] },   // outer
            { id: 2, fixed: false, t: [0.003, 0.002, 0], q: [0, 0, 0, 1] }, // piston offset
        ];
        const mates = [{
            kind: 1, // concentric
            a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
            b: { inst: 2, origin: [0, 0, 0], axis: [0, 0, 1] },
            value: 0,
        }];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBe(true);
    expect(r.poses[1].t[0]).toBeCloseTo(0, 4);     // piston centred
    expect(r.poses[1].t[1]).toBeCloseTo(0, 4);
    await shot('D-iso-mate');
    expect(await archieCount()).toBe(a0);
});

test('A320-E — close view: PMI (datum E gland, runout 0.02, finish Ra 0.1)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() => {
        if (!window.forge || !window.forge.pmi) return null;
        const a = [];
        a.push(window.forge.pmi.addDatum({ label: 'E', faceId: 1 }));
        a.push(window.forge.pmi.addFCF({ symbol: '⌒', tolerance: '0.02', datums: ['E'], faceId: 2 }));
        a.push(window.forge.pmi.addSurfaceFinish({ value: 'Ra 0.1', faceId: 3 }));
        a.push(window.forge.pmi.addLinearDim({ value: 'Ø260', upper: '+0.013', lower: '-0', faceId: 1 }));
        a.push(window.forge.pmi.addLinearDim({ value: 'Ø228', upper: '-0.013', lower: '-0.033', faceId: 4 }));   // H7/g6 sliding fit
        return a;
    });
    expect(ids).toBeTruthy();
    expect(ids.length).toBe(5);
    await shot('E-close-pmi');
    expect(await archieCount()).toBe(a0);
});

test('A320-F — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
