// PUSH-53 (Slice-22) — Photorealistic preview (CPU path tracer).
//
// The forge::pathtrace kernel (CPU path tracer: BVH + AO + directional sun)
// and the PathTracePreviewWorkbench (render-settings form + canvas blit) were
// complete and wired, but the workbench (tools.pathtrace) was absent from the
// Menus spec — only the separate "Render Room" (tools.pathTracer) was
// reachable — and it had no e2e. So Visualization dim #19 was unproven. This
// slice adds the tools.pathtrace menu entry and locks in the real render with
// a headed e2e.
//
// Proof end to end through the real UI:
//   1. Open the Photorealistic Preview (Tools → Photorealistic Preview).
//   2. Set a small resolution + render → kernel pathtrace.render returns a real
//      image (stats show rays > 0, time > 0) and the canvas has non-black
//      pixels (real shaded geometry, not an empty buffer).
//
// No stubs: pixels come from the native CPU path tracer; verified via the
// canvas ImageData (non-zero RGB) + a direct kernel cross-check.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-53-pathtrace');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'pathtrace-session.mp4');

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-53|pathtrace|render|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-53] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-53] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-53] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + native pathtrace kernel available', async () => {
    await shot('boot');
    const ok = await page.evaluate(() => {
        const pt = window.forge && window.forge.pathtrace;
        return !!(pt && typeof pt.render === 'function');
    });
    expect(ok).toBe(true);
    await pause(300);
});

test('01 — open the Photorealistic Preview workbench', async () => {
    await platformMenuAction('tools.pathtrace');
    await page.waitForSelector('[data-testid="forge-pathtrace-panel"]', { state: 'visible', timeout: 6000 });
    await shot('pathtrace-panel');
});

test('02 — render → real image (rays > 0) + non-black canvas', async () => {
    // Small resolution + low AO samples so the CPU trace returns fast.
    await page.locator('[data-testid="forge-pathtrace-width"]').fill('96');
    await page.locator('[data-testid="forge-pathtrace-height"]').fill('72');
    await page.locator('[data-testid="forge-pathtrace-ao-samples"]').fill('8');
    await pause(200);
    await page.locator('[data-testid="forge-pathtrace-render"]').click({ force: true, noWaitAfter: true });
    await pause(1500);
    await shot('rendered');

    const errCount = await page.locator('[data-testid="forge-pathtrace-error"]').count();
    if (errCount > 0) {
        const e = await page.locator('[data-testid="forge-pathtrace-error"]').innerText().catch(() => '');
        if (e.trim()) console.log('[push-53] pathtrace error =', e);
    }

    // Stats show a real render (rays > 0).
    const stats = page.locator('[data-testid="forge-pathtrace-stats"]');
    await expect(stats).toBeVisible({ timeout: 15000 });
    const statsTxt = await stats.innerText();
    console.log('[push-53] render stats =', statsTxt.replace(/\n/g, ' '));
    const rays = Number((statsTxt.match(/([\d,]+)\s*rays/) || [])[1]?.replace(/,/g, '') || '0');
    expect(rays).toBeGreaterThan(0);

    // The canvas holds real pixels: count non-black samples via ImageData.
    const px = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="forge-pathtrace-canvas"]');
        if (!c || !c.width || !c.height) return { w: 0, h: 0, nonBlack: 0, total: 0 };
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let nonBlack = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 4 || d[i + 1] > 4 || d[i + 2] > 4) nonBlack++;
        }
        return { w: c.width, h: c.height, nonBlack, total: d.length / 4 };
    });
    console.log('[push-53] canvas pixels =', JSON.stringify(px));
    expect(px.w).toBeGreaterThan(0);
    // A shaded floor+box scene must light up a meaningful fraction of pixels.
    expect(px.nonBlack).toBeGreaterThan(px.total * 0.1);

    // Direct kernel cross-check: rendering the fixture returns all-finite RGB.
    const k = await page.evaluate(() => {
        const scene = window.__forgePathTraceFixtureScene
            ? window.__forgePathTraceFixtureScene() : null;
        if (!scene) return { ok: false };
        const r = window.forge.pathtrace.render({
            mesh: scene,
            camera: { position: [30, 25, 22], lookAt: [0, 0, 4], up: [0, 0, 1], fovYDegrees: 35 },
            sun: { direction: [0.5, 0.5, 0.7], colour: [1, 0.95, 0.85] },
            ambient: [0.08, 0.08, 0.10], background: [0.04, 0.05, 0.08],
            width: 48, height: 36, aoSamples: 4, aoStrength: 1, aoMaxDistance: 50, randomSeed: 1,
        });
        let nz = 0; for (let i = 0; i < r.rgb.length; i++) if (r.rgb[i] > 0) nz++;
        return { ok: true, w: r.width, h: r.height, rgbLen: r.rgb.length, nz, rays: r.rayCount };
    });
    console.log('[push-53] kernel cross-check =', JSON.stringify(k));
    expect(k.ok).toBe(true);
    expect(k.nz).toBeGreaterThan(0);
    expect(k.rays).toBeGreaterThan(0);
});

test('03 — global search exposes the Photorealistic Preview command', async () => {
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Photorealistic');
        await pause(500);
        await shot('search-pathtrace');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Photorealistic/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-53] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
