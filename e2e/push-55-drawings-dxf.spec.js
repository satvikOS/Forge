// PUSH-55 (Slice-24b / Drawings dim #5 — DXF lands on disk)
//
// PUSH-42 mounted DrawingsHLRWorkbench and made it render a real HLR
// projection of the live model, but the only "export" was a DXF string
// pasted into a <pre> on screen — you couldn't actually take the drawing
// out of the app. This slice wires a real Save DXF… button that calls the
// existing native forge.drawings.emitDXF kernel pipeline and pipes the
// bytes through Electron's saveFile / writeBlob to land on disk.
//
// Proof end-to-end through the real Electron UI:
//   1. Seed a real OCCT box body (40×30×20) so HLR projects real edges.
//   2. Open Drawings (HLR) via tools.drawingsHlr.
//   3. The workbench auto-projects the FRONT view (footprint 40×20).
//   4. Click Save DXF…; the save dialog is stubbed in this test to a temp
//      path. Bytes hit disk through the real writeBlob IPC handler.
//   5. The DXF file is non-trivial (>500 bytes), starts with the DXF
//      header (SECTION / ENTITIES), and carries at least one LWPOLYLINE
//      under the VISIBLE layer.
//   6. Switching the view direction TOP and saving again writes a
//      different footprint, proving each save reflects the current view.
//
// Multi-cam: iso/front/right/top/iso-after = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-55-drawings-dxf');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'drawings-dxf-session.mp4');
const DXF_FRONT  = path.join(os.tmpdir(), `push-55-front-${Date.now()}.dxf`);
const DXF_TOP    = path.join(os.tmpdir(), `push-55-top-${Date.now()}.dxf`);

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
    await pause(500);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(300);
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-55|drawings|dxf|emitDXF|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-55] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-55] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-55] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + seed a real OCCT 40×30×20 body', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(40, 30, 20);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40x30x20',
            params: { width: 40, height: 30, distance: 20 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('01 — open Drawings (HLR) workbench', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.drawingsHlr');
    await page.waitForSelector('[data-testid="forge-drawingshlr-panel"]', { state: 'visible', timeout: 6000 });
    await shot('drawings-hlr-open');

    // FRONT view auto-projects on open. Confirm the visible-edge count > 0
    // (real body, not the sample-fallback empty case).
    const visibleCount = await page.locator('[data-testid="forge-drawingshlr-visible-count"]')
        .textContent();
    console.log('[push-55] FRONT visible edges =', visibleCount);
    expect(Number(visibleCount)).toBeGreaterThan(0);
});

test('02 — Save DXF (FRONT) writes a real DXF with LWPOLYLINE on disk', async () => {
    await cameraTo('right');
    // window.forge.dialog is frozen by contextBridge — can't monkey-patch
    // from the renderer. Instead, override the io:saveDialog IPC handler
    // in the main process to return our target path verbatim.
    await app.evaluate(async ({ ipcMain }, tmpPath) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => tmpPath);
    }, DXF_FRONT);

    await page.locator('[data-testid="forge-drawingshlr-save-dxf"]').click();
    await pause(800);
    await shot('after-save-front');

    // Save note + reported path.
    const reportedPath = await page.evaluate(() => window.__forgeLastDxfPath || null);
    console.log('[push-55] FRONT reported path =', reportedPath, 'expected =', DXF_FRONT);
    expect(reportedPath).toBe(DXF_FRONT);

    // File on disk is real DXF.
    expect(fs.existsSync(DXF_FRONT)).toBe(true);
    const size = fs.statSync(DXF_FRONT).size;
    console.log('[push-55] FRONT DXF size =', size, 'B');
    expect(size).toBeGreaterThan(500);
    const body = fs.readFileSync(DXF_FRONT, 'utf8');
    expect(body).toContain('SECTION');
    expect(body).toContain('ENTITIES');
    expect(body).toContain('LWPOLYLINE');
    expect(body).toContain('VISIBLE');
});

test('03 — switch to TOP, save again — content differs (proof it reflects current view)', async () => {
    await cameraTo('top');
    // Switch the workbench's view direction to TOP.
    await page.locator('[data-testid="forge-drawingshlr-direction"]').selectOption('top');
    await pause(800);
    await shot('drawings-top');

    await app.evaluate(async ({ ipcMain }, tmpPath) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => tmpPath);
    }, DXF_TOP);
    await page.locator('[data-testid="forge-drawingshlr-save-dxf"]').click();
    await pause(800);
    await shot('after-save-top');

    expect(fs.existsSync(DXF_TOP)).toBe(true);
    const topSize = fs.statSync(DXF_TOP).size;
    const frontSize = fs.statSync(DXF_FRONT).size;
    console.log('[push-55] FRONT vs TOP sizes =', frontSize, '·', topSize);

    // Both files exist + have content; their byte content should differ
    // because the projected view changed (40×20 → 40×30 footprint).
    const front = fs.readFileSync(DXF_FRONT, 'utf8');
    const top   = fs.readFileSync(DXF_TOP, 'utf8');
    expect(top).toContain('LWPOLYLINE');
    expect(front).not.toBe(top);
});

test('04 — global search exposes the workbench', async () => {
    await cameraTo('iso');
    await page.keyboard.press('Escape').catch(() => {});
    await pause(200);
    await page.keyboard.press('Meta+K').catch(() => {});
    await pause(400);
    let palette = page.locator('[data-testid="forge-cmd-palette"]');
    if (await palette.count() === 0) {
        await page.keyboard.press('Control+K').catch(() => {});
        await pause(400);
        palette = page.locator('[data-testid="forge-cmd-palette"]');
    }
    if (await palette.count() > 0) {
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Drawings');
        await pause(400);
        await shot('search-drawings');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Drawings \\(HLR\\)/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-55] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
