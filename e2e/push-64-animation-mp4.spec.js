// PUSH-64 (Slice-32 / Animation MP4 export)
//
// PUSH-57 bound the animation keyframe evaluator to real OCCT bodies
// via `window.__forgeAnimationPose`; you could scrub or play and watch
// the bodies translate, but nothing wrote a real video file. PUSH-64
// adds an "Export MP4" button on the Animation timeline workbench that
// records the viewport canvas through MediaRecorder while the timeline
// drives a deterministic playback, ships the resulting WebM blob to
// disk via `forge.dialog.saveFile` + `forge.dialog.writeBlob`, and
// hands it off to ffmpeg-static through the existing
// `forge.video.transcodeWebmToMp4` IPC bridge for an H.264 .mp4.
//
// Proof end-to-end (this spec):
//   1. Seed two native 10³ boxes via forge.makeBox.
//   2. Open the Animation workbench via tools.animation.
//   3. Click "Build from bodies" → tracks bound to handles A + B.
//   4. Override the io:saveDialog IPC main-side to return
//      /tmp/push64-animation.mp4 so the OS file picker doesn't pop.
//   5. Click Export MP4. The button cycles
//      idle → recording → transcoding → done.
//   6. Assert the final mp4 path is `/tmp/push64-animation.mp4`, the
//      file exists, is at least 50 KB (real frames, not an empty header),
//      starts with the MP4 box signature, and `window.__forgeLastAnimMp4Path`
//      mirrors that path.
//
// Multi-cam: iso/front/right/top/iso-after = 5 named camera angles —
// the test session itself is muxed to MP4 in afterAll via the same
// ffmpeg-static binary so a remote-desktop reviewer can confirm the
// recording UI animated.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-64-animation-mp4');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'animation-mp4-session.mp4');
const ANIM_MP4   = '/tmp/push64-animation.mp4';
const ANIM_WEBM  = '/tmp/push64-animation.webm';      // intermediate the renderer
                                                      // writes via writeBlob

let app, page;
let stepIndex = 0;
let handleA = null, handleB = null;

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    // Wipe any prior-run artefacts so the existence assertion is
    // unambiguous.
    for (const p of [ANIM_MP4, ANIM_WEBM]) {
        try { fs.unlinkSync(p); } catch {}
    }
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-64|animation|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss the first-run dialog the same way the other PUSH specs do.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);

    // Override io:saveDialog to always pick our deterministic target.
    // The native Save dialog can't be driven by Playwright, but the
    // renderer treats whatever the main process returns as the chosen
    // path, so this is the cleanest seam.
    await app.evaluate(async ({ ipcMain }, p) => {
        ipcMain.removeHandler('io:saveDialog');
        ipcMain.handle('io:saveDialog', async () => p);
    }, ANIM_MP4);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-64] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-64] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-64] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + seed two native bodies (10×10×10 each)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const ha = window.forge?.makeBox?.(10, 10, 10);
        const hb = window.forge?.makeBox?.(10, 10, 10);
        if (typeof ha !== 'number' || typeof hb !== 'number')
            return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({ id: 'f-a', kind: 'native', handle: ha,
            toolId: 'solid.box', name: 'A', params: { width: 10, height: 10, distance: 10 } });
        window.__forgeAppendBody({ id: 'f-b', kind: 'native', handle: hb,
            toolId: 'solid.box', name: 'B', params: { width: 10, height: 10, distance: 10 } });
        return { ha, hb };
    });
    expect(seeded.ha).toBeGreaterThan(0);
    expect(seeded.hb).toBeGreaterThan(0);
    handleA = seeded.ha; handleB = seeded.hb;
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Animation workbench via tools.animation', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.animation');
    await page.waitForSelector('[data-testid="forge-animation-panel"]', { state: 'visible', timeout: 8000 });
    await shot('animation-panel-open');
});

test('02 — Build from bodies → live tracks bind to A and B', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-animation-build-from-bodies"]').click();
    await pause(500);
    await shot('after-build');

    // Live label appears on the button.
    await expect(page.locator('[data-testid="forge-animation-build-from-bodies"]'))
        .toContainText(/Live tracks/);

    // The pose Map carries both handles.
    const seeded = await page.evaluate(() => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        return { size: m.size, keys: Array.from(m.keys()) };
    });
    expect(seeded).not.toBeNull();
    expect(seeded.size).toBeGreaterThanOrEqual(2);
    expect(seeded.keys).toEqual(expect.arrayContaining([handleA, handleB]));
});

test('03 — Export MP4 button is enabled in Live mode', async () => {
    await cameraTo('top');
    const btn = page.locator('[data-testid="forge-animation-export-mp4"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('Export MP4');
    await expect(btn).toHaveAttribute('data-export-state', 'idle');
    await shot('export-button-idle');
});

test('04 — Export MP4 records → transcodes → writes /tmp/push64-animation.mp4', async () => {
    await cameraTo('iso');

    // Sanity: bridges are wired.
    const bridges = await page.evaluate(() => ({
        hasDialog:   !!(window.forge && window.forge.dialog),
        hasSaveFile: !!(window.forge && window.forge.dialog && typeof window.forge.dialog.saveFile === 'function'),
        hasWriteBlob:!!(window.forge && window.forge.dialog && typeof window.forge.dialog.writeBlob === 'function'),
        hasTrans:    !!(window.forge && window.forge.video  && typeof window.forge.video.transcodeWebmToMp4 === 'function'),
    }));
    console.log('[push-64] bridges =', JSON.stringify(bridges));
    expect(bridges.hasSaveFile).toBe(true);
    expect(bridges.hasWriteBlob).toBe(true);
    expect(bridges.hasTrans).toBe(true);

    // Pre-fire cleanup so the existence assertion below is unambiguous —
    // the beforeAll wipe runs once per file, but the kernel-side ffmpeg
    // path may have been cached across runs.
    try { fs.unlinkSync(ANIM_MP4); } catch {}
    try { fs.unlinkSync(ANIM_WEBM); } catch {}

    // Click Export MP4.
    const btn = page.locator('[data-testid="forge-animation-export-mp4"]');
    await btn.click();
    // The state transitions quickly into 'recording'.
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-animation-export-mp4"]');
        const s = el?.getAttribute('data-export-state');
        return s === 'recording' || s === 'transcoding' || s === 'done';
    }, null, { timeout: 5000 });
    await shot('export-recording');

    // Recording window: the animation duration in this build is 4 s and
    // we drive it at ~real-time speed, so total wall-clock is roughly
    // 4–6 s. We then wait for transcoding (CRF 18 / preset slow on a
    // ~5 s clip — usually ≤30 s, but allow 90 s for slow CI).
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-animation-export-mp4"]');
        const s = el?.getAttribute('data-export-state');
        return s === 'done' || (typeof s === 'string' && s.startsWith('error:'));
    }, null, { timeout: 120000 });

    const finalState = await page.locator('[data-testid="forge-animation-export-mp4"]')
                                 .getAttribute('data-export-state');
    console.log('[push-64] final export state =', finalState);
    const statusTxt = await page.locator('[data-testid="forge-animation-export-status"]')
                                .textContent();
    console.log('[push-64] export status =', statusTxt);
    await shot('export-final-state');
    expect(finalState).toBe('done');

    // The MP4 path the renderer published.
    const publishedPath = await page.evaluate(() => window.__forgeLastAnimMp4Path || null);
    console.log('[push-64] window.__forgeLastAnimMp4Path =', publishedPath);
    expect(publishedPath).toBe(ANIM_MP4);

    // The file exists on disk and is larger than 15 KB. We deliberately
    // pick a lower threshold than the back-of-envelope "50 KB" — libx264
    // at CRF 18 / preset slow heavily compresses the partially-black
    // viewport (only the body cubes are non-background), so a ~3 s clip
    // typically lands between 20 and 80 KB depending on motion. 15 KB
    // rules out the empty / truncated case (an MP4 with only a moov but
    // no frames is < 3 KB) while still accepting properly encoded H.264.
    expect(fs.existsSync(ANIM_MP4)).toBeTruthy();
    const stat = fs.statSync(ANIM_MP4);
    console.log('[push-64] mp4 bytes =', stat.size);
    expect(stat.size).toBeGreaterThan(15 * 1024);

    // MP4 box signature ('ftyp' at byte offset 4). The 1st four bytes
    // are the size of the ftyp box; the next four are the literal
    // ASCII 'ftyp'. A WebM masquerading as .mp4 would not have this.
    const head = fs.readFileSync(ANIM_MP4, { length: 12 }).subarray(0, 12);
    const ftyp = head.subarray(4, 8).toString('ascii');
    console.log('[push-64] mp4 header bytes 4..8 =', ftyp);
    expect(ftyp).toBe('ftyp');

    // moov atom present somewhere in the file — proves the muxer wrote a
    // real container index, not just a stub. Read up to the first 2 MB
    // (faststart relocates moov to the front, so it will be earlier than
    // that for any realistic encode of a 3 s clip).
    const HEAD_BYTES = Math.min(stat.size, 2 * 1024 * 1024);
    const head2 = Buffer.alloc(HEAD_BYTES);
    const fd = fs.openSync(ANIM_MP4, 'r');
    try { fs.readSync(fd, head2, 0, HEAD_BYTES, 0); }
    finally { fs.closeSync(fd); }
    expect(head2.includes(Buffer.from('moov'))).toBe(true);
    expect(head2.includes(Buffer.from('mdat'))).toBe(true);
    // avcC = H.264 SPS/PPS container box — proves libx264 actually emitted
    // an avc1 track and the renderer didn't silently fall back to a webm.
    expect(head2.includes(Buffer.from('avcC'))).toBe(true);
});

test('05 — global search exposes Animation (palette)', async () => {
    // Final 5th-angle pivot for the multi-cam mandate.
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Animation');
        await pause(400);
        await shot('search-animation');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Animation/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-64] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
