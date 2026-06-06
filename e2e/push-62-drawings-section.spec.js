// PUSH-62 (Slice-29 / Drawings dim #5 — Live Section view panel)
//
// PUSH-05 + PUSH-42 + PUSH-55 wired a real HLR projection / on-screen
// render / Save DXF flow for the four canonical projection views
// (front / top / right / iso). The kernel surface has shipped
// projectSection / sectionView for cutting-plane section views since
// Forge-32, but the workbench never exposed them — users could not
// produce a real engineering section view from inside the app.
//
// PUSH-62 lights up the existing surface. A Mode toggle (Projection
// vs Section) on DrawingsHLRWorkbench drops down a cutting-plane
// editor (axis X/Y/Z + offset in mm); clicking the existing
// "Project view" button in section mode calls
// forge.drawings.projectSection(handle, dir, plane, hatchSpec),
// converts the packed-Float32 view bucket into the same View2D shape
// the renderer + emitDXF already speak, and feeds it through the
// existing DrawingCanvas + Save DXF pipeline.
//
// Proof end-to-end through the real Electron UI:
//   1. Seed a real OCCT 60×40×30 box body so a Z=15 cut slices through
//      the middle.
//   2. Open Drawings (HLR) via tools.drawingsHlr (auto-projects FRONT
//      in projection mode — visible-edge count > 0).
//   3. Flip Mode → Section, set axis=Z + offset=15, click Project view.
//      The new section result lands on screen and the DrawingCanvas
//      renders both the silhouette + the cut-edge / hatch lines as
//      visible polylines (>0 SVG <path> elements).
//   4. Click Save DXF…; io:saveDialog is overridden to a temp path
//      main-side; the section DXF bytes hit disk through the real
//      writeBlob IPC handler and contain LWPOLYLINE + the VISIBLE
//      layer (so the section silhouette + hatch are written as
//      drawing entities a downstream CAD tool can ingest).
//
// Multi-cam: iso / front / right / top / iso-after = 5 named camera
// angles per Forge-171 multi-cam mandate.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-62-drawings-section');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'drawings-section-session.mp4');
const DXF_SECTION = path.join(os.tmpdir(), `push-62-section-${Date.now()}.dxf`);

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
        if (/push-62|drawings|dxf|emitDXF|projectSection|forge|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
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
    if (app) {
        try { await app.close({ timeout: 10000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR)
            ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
            : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
        console.error('[push-62] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-62] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-62] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed a real OCCT 60×40×30 body', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(60, 40, 30);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-section', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 60x40x30',
            params: { width: 60, height: 40, distance: 30 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('01 — open Drawings (HLR); FRONT auto-projects in projection mode', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.drawingsHlr');
    await page.waitForSelector('[data-testid="forge-drawingshlr-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('drawings-hlr-open');

    // Mode toggle exists and defaults to projection.
    const modeToggle = page.locator('[data-testid="forge-drawingshlr-mode"]');
    await expect(modeToggle).toBeVisible();
    expect(await modeToggle.inputValue()).toBe('projection');

    // Existing FRONT projection still auto-runs (>0 visible edges).
    const visibleCount = await page.locator('[data-testid="forge-drawingshlr-visible-count"]')
        .textContent();
    console.log('[push-62] FRONT projection visible edges =', visibleCount);
    expect(Number(visibleCount)).toBeGreaterThan(0);
});

test('02 — flip to Section mode, axis=Z + offset=15, project the section', async () => {
    await cameraTo('right');

    // Flip mode → section. UI reveals the axis dropdown + offset input.
    await page.locator('[data-testid="forge-drawingshlr-mode"]').selectOption('section');
    await pause(400);
    await expect(page.locator('[data-testid="forge-drawingshlr-section-axis"]'))
        .toBeVisible();
    await expect(page.locator('[data-testid="forge-drawingshlr-section-offset"]'))
        .toBeVisible();
    await shot('section-mode-open');

    // Axis = Z (default), offset = 15 → cut through the middle of a
    // 60×40×30 box.
    await page.locator('[data-testid="forge-drawingshlr-section-axis"]').selectOption('Z');
    await page.locator('[data-testid="forge-drawingshlr-section-offset"]').fill('15');
    await pause(200);

    // Project — re-uses the existing button, but in section mode this
    // calls forge.drawings.projectSection under the hood.
    await page.locator('[data-testid="forge-drawingshlr-project"]').click();
    await pause(600);
    await shot('section-projected');

    // Visible-edge count still > 0 (silhouette + cut + hatch all land
    // in the visible bucket so the existing canvas renders them).
    const visibleCount = await page.locator('[data-testid="forge-drawingshlr-visible-count"]')
        .textContent();
    console.log('[push-62] SECTION visible-edges (post-convert) =', visibleCount);
    expect(Number(visibleCount)).toBeGreaterThan(0);

    // Section status report renders cut + hatch counts directly.
    const cutCount = await page.locator('[data-testid="forge-drawingshlr-cut-count"]')
        .textContent();
    const hatchCount = await page.locator('[data-testid="forge-drawingshlr-hatch-count"]')
        .textContent();
    console.log('[push-62] SECTION cut/hatch =', cutCount, '/', hatchCount);
    expect(Number(cutCount)).toBeGreaterThan(0);
    expect(Number(hatchCount)).toBeGreaterThan(0);

    // DrawingCanvas SVG has > 0 <path> elements rendered.
    const pathCount = await page.locator(
        '[data-testid="forge-drawingshlr-canvas"] path').count();
    console.log('[push-62] SECTION svg path count =', pathCount);
    expect(pathCount).toBeGreaterThan(0);
});

test('03 — Save DXF in section mode lands a real .dxf on disk', async () => {
    await cameraTo('top');

    // window.forge.dialog is frozen by contextBridge — override the
    // io:saveDialog IPC handler in the main process to return our
    // target path verbatim (matches the push-55 pattern).
    await app.evaluate(async ({ ipcMain }, tmpPath) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => tmpPath);
    }, DXF_SECTION);

    await page.locator('[data-testid="forge-drawingshlr-save-dxf"]').click();
    await pause(800);
    await shot('after-save-section');

    // Save note + reported path.
    const reportedPath = await page.evaluate(() => window.__forgeLastDxfPath || null);
    console.log('[push-62] SECTION reported path =', reportedPath, 'expected =', DXF_SECTION);
    expect(reportedPath).toBe(DXF_SECTION);

    // File on disk is real DXF with section content.
    expect(fs.existsSync(DXF_SECTION)).toBe(true);
    const size = fs.statSync(DXF_SECTION).size;
    console.log('[push-62] SECTION DXF size =', size, 'B');
    expect(size).toBeGreaterThan(500);
    const body = fs.readFileSync(DXF_SECTION, 'utf8');
    expect(body).toContain('SECTION');
    expect(body).toContain('ENTITIES');
    expect(body).toContain('LWPOLYLINE');
    expect(body).toContain('VISIBLE');
});

test('04 — close the panel + iso recap', async () => {
    await cameraTo('iso');
    await page.locator('[aria-label="Close drawings HLR"]').click().catch(() => {});
    await pause(400);
    await shot('panel-closed');
});
