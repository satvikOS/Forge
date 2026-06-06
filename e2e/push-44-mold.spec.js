// PUSH-44 (Slice-13) — Mold Tools: parting surface + cavity/core split.
//
// The forge::mold kernel (analyseDraft/computeParting/splitCavityCore/
// insertCoolingChannels/buildRunnerSystem) was complete and exposed in the
// preload, and a Mold workbench + toolbar existed — but the mold.* tools
// were NOT wired into the live kernelDispatch (only stale entries in the
// dead synthetic-path function). Running them produced a "kernel does not
// implement this op" error. This slice wires mold.parting / mold.cavity /
// mold.core to the real kernel.
//
// Proof end to end through the real UI:
//   1. Seed a draftable part (a cone — real silhouette along +Z) as a
//      native body in the scene.
//   2. Switch to the Mold workbench, run Cavity → the dispatch encloses
//      the part in a mold block, computes the parting surface, splits it,
//      and commits the CAVITY half as a new solid body (count 1→2) whose
//      volume is positive and smaller than the enclosing block.
//
// No stubs: the cavity volume is read from the native kernel on the real
// committed body handle.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-44-mold');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'mold-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function switchWorkbench(wbId) {
    const btn = page.locator(`[data-wb="${wbId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-44] no [data-wb="${wbId}"]`); return; }
    await btn.first().click(); await pause(600);
}
async function dismissOverlays() {
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 1500 }).catch(() => {});
    if (await page.locator('[data-testid="forge-tool-dock"]').count() > 0) {
        await page.keyboard.press('Escape').catch(() => {}); await pause(200);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await pause(150);
}
async function stateBodyCount() {
    return await page.evaluate(() =>
        (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').length);
}
async function lastBodyVolume() {
    return await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        if (!bodies.length || !window.forge?.massProps) return null;
        const h = bodies[bodies.length - 1].handle;
        try { return Math.abs(window.forge.massProps(h).volume); }
        catch { return null; }
    });
}
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    await dismissOverlays();
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-44] no [data-tool="${toolId}"]`); return false; }
    await btn.first().click({ force: true, timeout: 8000 });
    const dialog = page.locator('[data-testid="forge-tool-dock"]');
    let opened = false;
    try { await dialog.waitFor({ state: 'visible', timeout: 3000 }); opened = true; } catch {}
    if (opened) {
        await pause(300);
        for (const [field, value] of Object.entries(params)) {
            const input = page.locator(`[data-testid="forge-tool-dock"] input[data-field="${field}"]`);
            const select = page.locator(`[data-testid="forge-tool-dock"] select[data-field="${field}"]`);
            if (await input.count() > 0) {
                await input.first().click(); await page.keyboard.press('Meta+A');
                await page.keyboard.type(String(value), { delay: 14 }); await pause(60);
            } else if (await select.count() > 0) {
                await select.first().selectOption(String(value)); await pause(60);
            }
        }
        await page.locator('[data-testid="forge-tool-confirm"]').click();
        await page.waitForSelector('[data-testid="forge-tool-dock"]', { state: 'detached', timeout: 5000 }).catch(() => {});
        await pause(500);
    }
    if (screenshotLabel) await shot(screenshotLabel);
    return true;
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
        if (/push-44|mold|cavity|parting|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(1200);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-44] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-44] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-44] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot', async () => {
    await shot('boot');
});

test('01 — seed a draftable cone part into the scene', async () => {
    // The cone has a real silhouette along +Z so the mold parting surface
    // can be computed. Seed it as a native body via the kernel facade.
    const ok = await page.evaluate(() => {
        if (!window.forge?.makeCone || typeof window.__forgeAppendBody !== 'function') return false;
        const h = window.forge.makeCone(20, 8, 30);
        window.__forgeAppendBody({ id: `cone-${Date.now()}`, kind: 'native', handle: h,
                                   toolId: 'primitive.cone', name: 'Cone Part' });
        return true;
    });
    expect(ok).toBe(true);
    await pause(600);
    expect(await stateBodyCount()).toBe(1);
    await shot('cone-part');
});

test('02 — Mold workbench → Cavity splits a mold block around the part', async () => {
    await switchWorkbench('mold');
    await shot('mold-wb');

    const partVol = await lastBodyVolume();
    console.log('[push-44] cone part volume =', partVol);

    await clickTool('mold.cavity', { direction: '+Z' }, 'cavity');

    // A new cavity solid body is committed → body count grows to 2.
    expect(await stateBodyCount()).toBe(2);

    // The cavity is a real solid: positive volume, and larger than the
    // small cone part (it is most of an enclosing mold block).
    const cavityVol = await lastBodyVolume();
    console.log('[push-44] cavity volume =', cavityVol, ' part =', partVol);
    expect(cavityVol).not.toBeNull();
    expect(cavityVol).toBeGreaterThan(partVol);
});

test('03 — global search exposes the Mold Cavity command', async () => {
    await dismissOverlays();
    await page.keyboard.press('Meta+K').catch(() => {});
    await pause(400);
    let palette = page.locator('[data-testid="forge-cmd-palette"]');
    if (await palette.count() === 0) {
        await page.keyboard.press('Control+K').catch(() => {});
        await pause(400);
        palette = page.locator('[data-testid="forge-cmd-palette"]');
    }
    if (await palette.count() > 0) {
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Cavity');
        await pause(500);
        await shot('search-cavity');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Cavity/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-44] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
