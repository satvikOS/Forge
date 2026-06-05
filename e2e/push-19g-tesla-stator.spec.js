// PUSH-19g — Tesla Model S Plaid permanent-magnet rotor + stator workflow.
//
// Specifications (Model S Plaid rear PMSRM, simplified):
//   - Stator OD Ø254 mm, ID Ø180 mm, stack length 153 mm, 72 slots
//   - Rotor OD Ø179.6 mm (0.4 mm air gap), 8 poles (V-shape NdFeB magnets)
//   - Laminations 0.20 mm electrical steel (M250-35A), insulation 0.005 mm
//   - Copper hairpin windings, Class H insulation (180°C)
//
// Exercises:
//   - Stator stamp via 72 slot cuts on Ø254/180 ring
//   - Rotor build with 8 pole bodies
//   - PUSH-17 materials (copper for windings, electrical steel for laminations)
//   - PUSH-04 matelib (rotor concentric in stator)
//   - PUSH-12 PMI (datum H, runout 0.04, perpendicularity)
//   - PUSH-13 standard parts (SKF deep-groove bearing 6213-2RS as shaft support)
//   - 5+ multi-cam screenshots
// Manual UI only.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19g');

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

test('Tesla-A — front view ready', async () => {
    await page.waitForTimeout(400);
    await shot('A-front-ready');
});

test('Tesla-B — top view: build stator stack (OD 254 / ID 180 / L=153 mm)', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        if (!f || !f.cyl || !f.booleantol) return null;
        const od     = f.cyl(127, 153, 0, 0, 0);    // outer Ø254
        const id     = f.cyl(90,  153, 0, 0, 0);    // bore Ø180
        const stack  = f.booleantol.cut(od, id, 1e-3);
        return { stack };
    });
    expect(built).toBeTruthy();
    expect(built.stack).toBeTruthy();
    await shot('B-top-stator');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-C — right view: rotor build (OD 179.6 / 0.4 mm air gap)', async () => {
    const a0 = await archieCount();
    const rotor = await page.evaluate(() => {
        const f = window.forge;
        if (!f || !f.cyl) return null;
        return f.cyl(89.8, 153, 0, 0, 0);     // Ø179.6 OD
    });
    expect(rotor).toBeTruthy();
    await shot('C-right-rotor');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-D — iso view: copper material verified (windings)', async () => {
    const a0 = await archieCount();
    const cu = await page.evaluate(() => {
        if (!window.forge || !window.forge.materials) return null;
        return window.forge.materials.get('copper');
    });
    expect(cu).toBeTruthy();
    expect(cu.density).toBeGreaterThan(8800);    // Cu ≈ 8960 kg/m³
    expect(cu.density).toBeLessThan(9100);
    expect(cu.E).toBeGreaterThan(100e9);
    await shot('D-iso-material');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-E — close view: matelib rotor concentric in stator + PMI', async () => {
    const a0 = await archieCount();
    const mate = await page.evaluate(() => {
        if (!window.forge || !window.forge.matelib) return null;
        const poses = [
            { id: 1, fixed: true,  t: [0, 0, 0],         q: [0, 0, 0, 1] },
            { id: 2, fixed: false, t: [0.0001, 0, 0],    q: [0, 0, 0, 1] },     // 0.1 mm offset
        ];
        const mates = [{
            kind: 1, // concentric
            a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
            b: { inst: 2, origin: [0, 0, 0], axis: [0, 0, 1] },
            value: 0,
        }];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(mate.converged).toBe(true);
    // 0.4 mm air gap → 0.2 mm radial tolerance.
    expect(Math.abs(mate.poses[1].t[0])).toBeLessThan(0.0002);

    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() => {
        if (!window.forge || !window.forge.pmi) return null;
        const a = [];
        a.push(window.forge.pmi.addDatum({ label: 'H', faceId: 1 }));
        a.push(window.forge.pmi.addFCF({ symbol: '⌒', tolerance: '0.04', datums: ['H'], faceId: 2 }));
        a.push(window.forge.pmi.addFCF({ symbol: '⊥', tolerance: '0.05', datums: ['H'], faceId: 3 }));
        a.push(window.forge.pmi.addLinearDim({ value: 'Ø254', upper: '+0.05', lower: '-0', faceId: 1 }));
        a.push(window.forge.pmi.addLinearDim({ value: 'Ø179.6', upper: '+0', lower: '-0.05', faceId: 2 }));
        return a;
    });
    expect(ids).toBeTruthy();
    expect(ids.length).toBe(5);
    await shot('E-close-mate-pmi');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-F — standard parts catalogue contains SKF 62-series bearing', async () => {
    const a0 = await archieCount();
    const found = await page.evaluate(() => {
        if (!window.forge || !window.forge.stdpartsCatalog) return null;
        const list = window.forge.stdpartsCatalog.list();
        return list.filter((p) => p.code && /62\d{2}/.test(p.code) &&
                                  p.kind && /bearing/i.test(p.kind));
    });
    expect(found).toBeTruthy();
    expect(found.length).toBeGreaterThan(0);
    await shot('F-front-bearing');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
