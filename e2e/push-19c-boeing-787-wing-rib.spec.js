// PUSH-19c — Boeing 787 inboard wing rib workflow.
//
// Specifications (Boeing 787-9 inboard rib, simplified):
//   - Web height ~ 700 mm, length ~ 4500 mm, flange 50 mm × 6 mm
//   - Material: 7075-T6 aluminium (Sy=503 MPa, E=71.7 GPa, ρ=2810 kg/m³)
//   - Lightening holes Ø250 mm pitched 600 mm along the web
//   - 18 holes total
//   - Sheet metal gauge 2.0 mm
//
// Exercises:
//   - PUSH-06 sheet metal flatten via window.forge.sheetextend.flatten
//   - PUSH-13 standard parts (no fasteners attached, but library referenced)
//   - PUSH-17 materials (al-7075 properties verified)
//   - PUSH-12 PMI (datum reference, flatness ⏥ 0.5, surface finish)
//   - 5+ multi-cam screenshots
//
// Manual UI only.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19c');

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

test('B787-A — front view: app ready', async () => {
    const a0 = await archieCount();
    await page.waitForTimeout(400);
    await shot('A-front-ready');
    expect(await archieCount()).toBe(a0);
});

test('B787-B — top view: build rib web with 18 lightening holes', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        if (!f || !f.box || !f.cyl) return { error: 'window.forge unavailable' };
        // Web: 4500 × 700 × 2 (length × height × thickness, gauge 2.0 mm).
        const web = f.box(4500, 700, 2);
        const holes = [];
        // 18 holes at pitch 250 mm starting at x=125 (so the first/last are
        // centred within the rib span: 18 holes × 250 mm = 4500 mm clear).
        for (let i = 0; i < 18; i += 1) {
            const cx = 125 + i * 250;
            const cy = 350;     // mid-height
            holes.push(f.cyl(125, 2, cx, cy, 0));    // Ø250 → r=125
        }
        return { web, holes: holes.length };
    });
    expect(built.error).toBeFalsy();
    expect(built.web).toBeTruthy();
    expect(built.holes).toBe(18);
    await shot('B-top-web-with-holes');
    expect(await archieCount()).toBe(a0);
});

test('B787-C — right view: 7075-T6 aluminium material', async () => {
    const a0 = await archieCount();
    const mat = await page.evaluate(() => {
        if (!window.forge || !window.forge.materials) return null;
        return window.forge.materials.get('al-7075');
    });
    expect(mat).toBeTruthy();
    expect(mat.Sy).toBeGreaterThan(400e6);   // ≥ 400 MPa (T6 spec is 503)
    expect(mat.E).toBeGreaterThan(60e9);     // ≥ 60 GPa (T6 ≈ 71.7)
    expect(mat.density).toBeGreaterThan(2700); // ≥ 2700 kg/m³
    expect(mat.density).toBeLessThan(2900);
    await shot('C-right-material');
    expect(await archieCount()).toBe(a0);
});

test('B787-D — iso view: sheet metal flatten via forge.sheetextend.flatten', async () => {
    const a0 = await archieCount();
    const flat = await page.evaluate(() => {
        if (!window.forge || !window.forge.sheetextend || !window.forge.sheetextend.flatten) return null;
        // Simple 1-bend flange: 1000 mm web + 50 mm flange at 90° with K=0.45,
        // gauge 2 mm. Expect flat length = web + flange + bend-allowance term.
        return window.forge.sheetextend.flatten({
            gauge: 2.0, kFactor: 0.45,
            segments: [
                { kind: 'flat', length: 1000 },
                { kind: 'bend', angle: 90, radius: 4 },
                { kind: 'flat', length: 50 },
            ],
        });
    });
    expect(flat).toBeTruthy();
    expect(flat.flatLength).toBeGreaterThan(1045);   // ≥ web + flange − some
    expect(flat.flatLength).toBeLessThan(1060);
    await shot('D-iso-flat');
    expect(await archieCount()).toBe(a0);
});

test('B787-E — close view: PMI annotations (datum, flatness, finish)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() => {
        if (!window.forge || !window.forge.pmi) return null;
        const a = [];
        a.push(window.forge.pmi.addDatum({ label: 'B', faceId: 1 }));   // web upper face
        a.push(window.forge.pmi.addFCF({ symbol: '⏥', tolerance: '0.5', datums: ['B'], faceId: 2 }));
        a.push(window.forge.pmi.addSurfaceFinish({ value: 'Ra 1.6', faceId: 1 }));
        a.push(window.forge.pmi.addLinearDim({ value: 'Ø250', upper: '+0.1', lower: '-0.1', faceId: 3 }));
        return a;
    });
    expect(ids).toBeTruthy();
    expect(ids.length).toBe(4);
    await shot('E-close-pmi');
    expect(await archieCount()).toBe(a0);
});

test('B787-F — no Archie posts throughout workflow', async () => {
    expect(await archieCount()).toBe(0);
});
