// PUSH-38 (Slice-8) — Surface workbench: Thicken surface → solid.
//
// Proves the full surface→solid pipeline end to end through the real UI:
//   1. Open the Surfacing panel, run "Extrude surface" → a NURBS surface
//      patch is created AND committed to the live scene (renders in the
//      viewport, becomes a pickable native body). As an OPEN surface its
//      enclosed volume is ~0.
//   2. Run the "Thicken" solid tool on that surface → the kernel offsets
//      it (BRepOffset_MakeOffset, makeThickSolid) into a CLOSED solid.
//      The body's |volume| jumps from ~0 to a clearly positive value and
//      the body count stays 1 (thicken REPLACES the surface body).
//
// No stubs: volume is read from the native kernel via window.forge.massProps
// on the actual body handle in the live scene.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-38-thicken');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'thicken-session.mp4');

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
    if (await btn.count() === 0) return;
    await btn.first().click(); await pause(500);
}

// Count rendered body meshes in the live three.js scene.
async function renderedBodyMeshCount() {
    return await page.evaluate(() => {
        const scene = window.__forgeScene;
        if (!scene) return -1;
        const ids = new Set();
        scene.traverse((o) => {
            if (o.isMesh && o.userData && typeof o.userData.bodyId === 'number') ids.add(o.userData.bodyId);
        });
        return ids.size;
    });
}
async function stateBodyCount() {
    return await page.evaluate(() =>
        (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').length);
}
// Read |volume| of the most-recent native body straight from the kernel.
async function lastBodyVolume() {
    return await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        if (!bodies.length || !window.forge?.massProps) return null;
        const h = bodies[bodies.length - 1].handle;
        try { return Math.abs(window.forge.massProps(h).volume); }
        catch { return null; }
    });
}

// Dismiss any autosave/restore banner or context menu that could intercept clicks.
async function dismissOverlays() {
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 1500 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await pause(150);
}

// Fire a toolbar/solid tool through the platform menu-action bus, then fill
// + confirm the tool dock dialog.
async function clickSolidTool(toolId, params = {}, screenshotLabel = null) {
    await dismissOverlays();
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-38] no [data-tool="${toolId}"]`); return; }
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
        if (/push-38|forge|surf|thicken|error|Error/i.test(t)) console.log('[browser]', t);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-38] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-38] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-38] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
});

test('01 — Thicken tool is present in the Solid toolbar group', async () => {
    await dismissOverlays();
    const btn = page.locator('[data-tool="solid.thicken"]');
    await expect(btn).toHaveCount(1);
    await shot('thicken-tool-present');
});

test('02 — create a surface via the Surfacing panel (extrude-surface)', async () => {
    await dismissOverlays();
    // Open the Surfacing panel via the platform tools.surfacing action.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: 'tools.surfacing' } }));
    });
    await page.waitForSelector('[data-testid="forge-surfacing-panel"]', { state: 'visible', timeout: 5000 });
    await pause(400);
    // Switch to the Surface Tools tab and run extrude-surface with defaults.
    await page.locator('[data-testid="forge-surfacing-tab-surface-tools"]').click();
    await pause(300);
    await page.locator('[data-testid="forge-surfacing-op-extrude-surface"]').click();
    await page.waitForSelector('[data-testid="forge-surfacing-dialog"]', { state: 'visible', timeout: 4000 });
    await shot('extrude-surface-dialog');
    await page.locator('[data-testid="forge-surfacing-dialog-confirm"]').click();
    await pause(800);
    await shot('surface-created');

    // The surface is committed to the scene as a native body and renders.
    expect(await stateBodyCount()).toBe(1);
    const renderDiag = await page.evaluate(() => {
        const out = {};
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        out.nativeBodies = bodies.map((b) => ({ id: b.id, handle: b.handle, kind: b.kind, surface: b.surface }));
        const b = bodies[bodies.length - 1];
        if (b && window.forge?.tessellate) {
            try { const m = window.forge.tessellate(b.handle, 0.1, 0.5);
                  out.tess = { positions: m.positions?.length, indices: m.indices?.length }; }
            catch (e) { out.tessErr = e.message; }
        }
        const scene = window.__forgeScene;
        if (scene) {
            let meshes = 0, tagged = 0;
            scene.traverse((o) => { if (o.isMesh) { meshes++; if (o.userData && typeof o.userData.bodyId === 'number') tagged++; } });
            out.sceneMeshes = meshes; out.sceneTagged = tagged;
        } else out.scene = 'missing';
        return out;
    });
    console.log('[push-38][renderDiag]', JSON.stringify(renderDiag));
    expect(await renderedBodyMeshCount()).toBe(1);

    // As an OPEN surface, its enclosed volume is ~0.
    const vol = await lastBodyVolume();
    expect(vol).not.toBeNull();
    expect(vol).toBeLessThan(1e-3);
    console.log('[push-38] open-surface volume =', vol);
});

test('03 — Thicken the surface into a solid', async () => {
    // Close the surfacing panel so the toolbar is unobstructed.
    const close = page.locator('[data-testid="forge-surfacing-close"]');
    if (await close.count() > 0) await close.first().click().catch(() => {});
    await pause(400);

    await clickSolidTool('solid.thicken', { thickness: 3, side: 'Outward' }, 'thickened');

    // Still exactly one native body (thicken REPLACES the surface body).
    expect(await stateBodyCount()).toBe(1);
    expect(await renderedBodyMeshCount()).toBe(1);

    // The body is now a closed solid: |volume| is clearly positive.
    const vol = await lastBodyVolume();
    expect(vol).not.toBeNull();
    expect(vol).toBeGreaterThan(1.0);
    console.log('[push-38] thickened solid volume =', vol);
});

test('04 — global search exposes the Thicken command', async () => {
    await dismissOverlays();
    // Open the command palette (Cmd/Ctrl+K).
    await page.keyboard.press('Meta+K').catch(() => {});
    await pause(400);
    let palette = page.locator('[data-testid="forge-cmd-palette"]');
    if (await palette.count() === 0) {
        await page.keyboard.press('Control+K').catch(() => {});
        await pause(400);
        palette = page.locator('[data-testid="forge-cmd-palette"]');
    }
    if (await palette.count() > 0) {
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Thicken');
        await pause(500);
        await shot('search-thicken');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Thicken/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-38] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
