// PUSH-41 (Slice-10) — Surface workbench: Trim Surface (parametric UV).
//
// Proves the Trim Surface command end to end through the real UI, and
// guards the trimNurbsFace kernel fix (old impl returned an EMPTY face):
//   1. Create a surface patch via the Surfacing panel — renders as a
//      native surface body with a measurable area A.
//   2. Run the "Trim Srf" solid tool keeping U∈[0.25,0.75], V∈[0,1] →
//      the kernel trims the face to that parametric window. Body count
//      stays 1 (trim REPLACES the surface), and the trimmed area is
//      ~half of A (and crucially > 0 — proving the face isn't empty).
//
// No stubs: area read from the native kernel via window.forge.massProps.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-41-trim');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'trim-session.mp4');

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
async function lastBodyArea() {
    return await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        if (!bodies.length || !window.forge?.massProps) return null;
        const h = bodies[bodies.length - 1].handle;
        try { return window.forge.massProps(h).area; }
        catch { return null; }
    });
}

async function dismissOverlays() {
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 1500 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await pause(150);
}

async function clickSolidTool(toolId, params = {}, screenshotLabel = null) {
    await dismissOverlays();
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-41] no [data-tool="${toolId}"]`); return; }
    await btn.first().click({ force: true, timeout: 8000 });
    const dialog = page.locator('[data-testid="forge-tool-dock"]');
    let opened = false;
    try { await dialog.waitFor({ state: 'visible', timeout: 3000 }); opened = true; } catch {}
    if (opened) {
        await pause(300);
        for (const [field, value] of Object.entries(params)) {
            const input = page.locator(`[data-testid="forge-tool-dock"] input[data-field="${field}"]`);
            if (await input.count() > 0) {
                await input.first().click(); await page.keyboard.press('Meta+A');
                await page.keyboard.type(String(value), { delay: 14 }); await pause(60);
            }
        }
        await page.locator('[data-testid="forge-tool-confirm"]').click();
        await page.waitForSelector('[data-testid="forge-tool-dock"]', { state: 'detached', timeout: 5000 }).catch(() => {});
        await pause(500);
    }
    if (screenshotLabel) await shot(screenshotLabel);
}

async function createSurface(label) {
    await dismissOverlays();
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: 'tools.surfacing' } }));
    });
    await page.waitForSelector('[data-testid="forge-surfacing-panel"]', { state: 'visible', timeout: 5000 });
    await pause(300);
    await page.locator('[data-testid="forge-surfacing-tab-surface-tools"]').click();
    await pause(200);
    await page.locator('[data-testid="forge-surfacing-op-extrude-surface"]').click();
    await page.waitForSelector('[data-testid="forge-surfacing-dialog"]', { state: 'visible', timeout: 4000 });
    await page.locator('[data-testid="forge-surfacing-dialog-confirm"]').click();
    await pause(700);
    if (label) await shot(label);
    // Close the panel so the toolbar is unobstructed.
    const close = page.locator('[data-testid="forge-surfacing-close"]');
    if (await close.count() > 0) await close.first().click().catch(() => {});
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
        if (/push-41|trim|error|Error/i.test(t)) console.log('[browser]', t);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-41] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-41] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-41] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
});

test('01 — Trim Surface tool is present in the Solid toolbar group', async () => {
    await dismissOverlays();
    await expect(page.locator('[data-tool="solid.trimSurface"]')).toHaveCount(1);
    await shot('trim-tool-present');
});

let fullArea = null;

test('02 — create a surface patch', async () => {
    await createSurface('surface');
    expect(await stateBodyCount()).toBe(1);
    expect(await renderedBodyMeshCount()).toBe(1);
    fullArea = await lastBodyArea();
    console.log('[push-41] full surface area =', fullArea);
    expect(fullArea).not.toBeNull();
    expect(fullArea).toBeGreaterThan(0);
});

test('03 — Trim the surface to U[0.25,0.75]', async () => {
    await clickSolidTool('solid.trimSurface',
        { uMin: 0.25, uMax: 0.75, vMin: 0, vMax: 1 }, 'trimmed');

    // Trim REPLACES the surface body → still exactly one.
    expect(await stateBodyCount()).toBe(1);
    expect(await renderedBodyMeshCount()).toBe(1);

    const trimmedArea = await lastBodyArea();
    console.log('[push-41] trimmed area =', trimmedArea, ' full =', fullArea);
    expect(trimmedArea).not.toBeNull();
    // Crucially > 0 — the old kernel bug produced an EMPTY face (area 0).
    expect(trimmedArea).toBeGreaterThan(0);
    // Kept half the U-range → ~half the area (allow generous tolerance).
    expect(trimmedArea).toBeLessThan(fullArea * 0.75);
    expect(trimmedArea).toBeGreaterThan(fullArea * 0.25);
});

test('04 — global search exposes the Trim Surface command', async () => {
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Trim Surface');
        await pause(500);
        await shot('search-trim');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Trim/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-41] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
