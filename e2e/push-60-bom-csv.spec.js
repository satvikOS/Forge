// PUSH-60 — Bill of Materials panel + CSV export.
//
// PUSH-58 turned forge.massProps(handle) into a real Mass Properties UI;
// PUSH-60 builds on that surface and ships the BOM view a real mechanical
// CAD user expects: one row per native body, an inline material picker
// on every row (shares the PUSH-58 five-material density table —
// steel 7.85 / aluminum 2.70 / plastic 1.05 / titanium 4.50 / brass 8.50
// g/cc), live mass in grams, total mass at the bottom, and an Export CSV
// button that lands a real .csv file on disk through forge.dialog.saveFile
// + forge.dialog.writeBlob.
//
// Proof end-to-end (this spec):
//   1. Seed three native boxes via forge.makeBox: 20³ (volume 8000),
//      30³ (volume 27000), 40³ (volume 64000) — exact kernel-side numbers.
//   2. Open the BOM panel via the tools.bom menu action.
//   3. Assert the table renders three rows with the correct names and
//      volumes; default material is steel on every row.
//   4. Switch row 2 (the 30³ box) to aluminum via the inline picker;
//      assert the mass row updates to 27000 × 2.70e-3 = 72.900 g exactly.
//   5. Override the io:saveDialog IPC main-side so the OS file picker
//      doesn't pop, then click Export CSV. Assert /tmp/push60.csv exists
//      and contains every body's name, material, volume, and mass.
//   6. Five named camera angles for multi-cam verification.
//
// Multi-cam: iso/front/right/top/iso-after = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-60-bom-csv');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'bom-csv-session.mp4');
const CSV_PATH   = '/tmp/push60.csv';

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function platformMenuAction(actionId) {
    await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
    }, actionId);
    await pause(400);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(300);
}

async function readRowVolume(idx) {
    const cell = page.locator('[data-testid="forge-bom-row-volume"]').nth(idx);
    const txt  = await cell.textContent();
    return Number(/(-?[0-9]+(?:\.[0-9]+)?)/.exec(txt || '')?.[1]);
}
async function readRowMass(idx) {
    const cell = page.locator('[data-testid="forge-bom-row-mass"]').nth(idx);
    const txt  = await cell.textContent();
    return Number(/(-?[0-9]+(?:\.[0-9]+)?)/.exec(txt || '')?.[1]);
}
async function readTotalMass() {
    const cell = page.locator('[data-testid="forge-bom-total-mass"]');
    const txt  = await cell.textContent();
    return Number(/(-?[0-9]+(?:\.[0-9]+)?)/.exec(txt || '')?.[1]);
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    try { fs.unlinkSync(CSV_PATH); } catch {}
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-60|bom|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);

    // Override the io:saveDialog IPC main-side to always return our
    // deterministic /tmp/push60.csv path — the headless OS dialog can't
    // be driven by Playwright, but the renderer treats whatever the
    // main process returns as the chosen path, so an early IPC override
    // is the cleanest seam.
    await app.evaluate(async ({ ipcMain }, p) => {
        ipcMain.removeHandler('io:saveDialog');
        ipcMain.handle('io:saveDialog', async () => p);
    }, CSV_PATH);
});

test.afterAll(async () => {
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-60] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-60] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-60] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + seed three native boxes (20³, 30³, 40³)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Reset the per-body material map so a previous run can't bleed in.
    await page.evaluate(() => {
        window.__forgeBodyMaterials = new Map();
    });

    const seeded = await page.evaluate(() => {
        const out = [];
        const make = (n, side) => {
            const h = window.forge?.makeBox?.(side, side, side);
            if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
            window.__forgeAppendBody({
                id: `f-box-${n}`, kind: 'native', handle: h,
                toolId: 'solid.box', name: n,
                params: { width: side, height: side, distance: side },
            });
            return { name: n, handle: h, side };
        };
        out.push(make('Box 20', 20));
        out.push(make('Box 30', 30));
        out.push(make('Box 40', 40));
        return out;
    });
    expect(seeded[0].handle).toBeGreaterThan(0);
    expect(seeded[1].handle).toBeGreaterThan(0);
    expect(seeded[2].handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 3,
        null, { timeout: 4000 });
    await shot('three-bodies-seeded');
});

test('01 — open Bill of Materials via tools.bom', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.bom');
    await page.waitForSelector('[data-testid="forge-bom-panel"]', { state: 'visible', timeout: 6000 });
    await shot('bom-open');

    // Row count chip reflects the three seeded bodies.
    const chip = page.locator('[data-testid="forge-bom-row-count"]');
    await expect(chip).toHaveText('3');
});

test('02 — three rows; volumes match exact kernel readouts', async () => {
    await cameraTo('right');

    const rows = page.locator('[data-testid="forge-bom-row"]');
    await expect(rows).toHaveCount(3);

    // Row order = scene order = 20 / 30 / 40.
    const names = await page.locator('[data-testid="forge-bom-row-name"]').allTextContents();
    expect(names).toEqual(['Box 20', 'Box 30', 'Box 40']);

    const v0 = await readRowVolume(0);
    const v1 = await readRowVolume(1);
    const v2 = await readRowVolume(2);
    console.log('[push-60] volumes =', v0, v1, v2);
    expect(Math.abs(v0 - 8000)).toBeLessThan(1);
    expect(Math.abs(v1 - 27000)).toBeLessThan(1);
    expect(Math.abs(v2 - 64000)).toBeLessThan(1);

    // Default material is steel everywhere (density 7.85 g/cc).
    const m0 = await readRowMass(0);
    const m1 = await readRowMass(1);
    const m2 = await readRowMass(2);
    console.log('[push-60] steel masses =', m0, m1, m2);
    // 8000 × 7.85e-3 = 62.80 g, 27000 × 7.85e-3 = 211.95 g,
    // 64000 × 7.85e-3 = 502.40 g.
    expect(Math.abs(m0 - 62.80)).toBeLessThan(0.05);
    expect(Math.abs(m1 - 211.95)).toBeLessThan(0.05);
    expect(Math.abs(m2 - 502.40)).toBeLessThan(0.05);

    // Total: 62.80 + 211.95 + 502.40 = 777.15 g.
    const total = await readTotalMass();
    console.log('[push-60] total mass (all steel) =', total);
    expect(Math.abs(total - 777.15)).toBeLessThan(0.1);
    await shot('three-rows-steel');
});

test('03 — switch row 2 to aluminum → mass = 72.900 g exactly', async () => {
    await cameraTo('top');

    // Pick the row-2 material dropdown (index 1, the 30³ box).
    const sel = page.locator('[data-testid="forge-bom-row-material"]').nth(1);
    await sel.selectOption('aluminum');
    await pause(300);
    await shot('row-2-aluminum');

    const row = page.locator('[data-testid="forge-bom-row"]').nth(1);
    await expect(row).toHaveAttribute('data-material', 'aluminum');

    const m1 = await readRowMass(1);
    console.log('[push-60] aluminum mass on row 2 =', m1);
    // 27000 × 2.70e-3 = 72.900 g exact.
    expect(Math.abs(m1 - 72.900)).toBeLessThan(0.05);

    // Total now: 62.80 + 72.90 + 502.40 = 638.10 g.
    const total = await readTotalMass();
    console.log('[push-60] total mass (steel/al/steel) =', total);
    expect(Math.abs(total - 638.10)).toBeLessThan(0.1);

    // Confirm the persistence layer logged the choice on the shared Map.
    const persisted = await page.evaluate(() => {
        const map = window.__forgeBodyMaterials;
        if (!(map instanceof Map)) return null;
        const out = [];
        for (const [k, v] of map.entries()) out.push([k, v]);
        return out;
    });
    console.log('[push-60] persisted body materials =', persisted);
    expect(persisted).toEqual(expect.arrayContaining([
        expect.arrayContaining([expect.stringMatching(/^h:/), 'aluminum']),
    ]));
});

test('04 — Export CSV writes /tmp/push60.csv with body data', async () => {
    await cameraTo('iso');

    // Clean any leftover from a previous run.
    try { fs.unlinkSync(CSV_PATH); } catch {}

    const exportBtn = page.locator('[data-testid="forge-bom-export-csv"]');
    await exportBtn.click();
    await pause(900);
    await shot('export-clicked');

    // Wait for the status pill to confirm a save (or fail loudly).
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-bom-csv-status"]');
        return el && /saved|error|cancelled/i.test(el.textContent || '');
    }, null, { timeout: 6000 });

    const status = await page.locator('[data-testid="forge-bom-csv-status"]').textContent();
    console.log('[push-60] csv status =', status);
    expect(status).toMatch(/saved/i);

    // File on disk.
    expect(fs.existsSync(CSV_PATH)).toBeTruthy();
    const csv = fs.readFileSync(CSV_PATH, 'utf8');
    console.log('[push-60] CSV contents:\n' + csv);

    // Header row + three body rows + blank + TOTAL row.
    expect(csv).toMatch(/"name","qty","material","volume_mm3","density_g_cc","mass_g"/);
    expect(csv).toMatch(/"Box 20"/);
    expect(csv).toMatch(/"Box 30"/);
    expect(csv).toMatch(/"Box 40"/);
    expect(csv).toMatch(/"steel"/);
    expect(csv).toMatch(/"aluminum"/);
    // Row 2 mass — 72.900 (allow either 72.900 or 72.9 depending on toFixed).
    expect(csv).toMatch(/"72\.900"/);
    // Row 1 (steel 20³): 8000 × 7.85e-3 = 62.800 g.
    expect(csv).toMatch(/"62\.800"/);
    // Row 3 (steel 40³): 64000 × 7.85e-3 = 502.400 g.
    expect(csv).toMatch(/"502\.400"/);
    // Volumes appear with 3 decimal places.
    expect(csv).toMatch(/"8000\.000"/);
    expect(csv).toMatch(/"27000\.000"/);
    expect(csv).toMatch(/"64000\.000"/);
    // TOTAL row carries the aggregate mass 638.10 g.
    expect(csv).toMatch(/"TOTAL"/);
    expect(csv).toMatch(/"638\.100"/);

    await shot('export-confirmed');
});

test('05 — re-open panel keeps persisted material on row 2', async () => {
    // Close + re-open via tools.bom; the row-2 picker should still read
    // aluminum because we persist on window.__forgeBodyMaterials.
    await page.locator('[data-testid="forge-bom-close"]').click();
    await pause(300);
    await shot('panel-closed');

    await cameraTo('iso');
    await platformMenuAction('tools.bom');
    await page.waitForSelector('[data-testid="forge-bom-panel"]', { state: 'visible', timeout: 6000 });
    await pause(300);

    const row = page.locator('[data-testid="forge-bom-row"]').nth(1);
    await expect(row).toHaveAttribute('data-material', 'aluminum');
    const m1 = await readRowMass(1);
    console.log('[push-60] re-opened row 2 mass =', m1);
    expect(Math.abs(m1 - 72.900)).toBeLessThan(0.05);

    await shot('re-opened-persisted');
});
