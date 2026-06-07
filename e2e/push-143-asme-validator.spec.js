// PUSH-143 — ASME Y14.5-2018 semantic GD&T validator.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-143-asme-validator');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'asme-validator-session.mp4');

let app, page;
let stepIndex = 0;
async function shot(label) {
    stepIndex += 1;
    const n = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${n}.png`), fullPage: true });
}
async function pause(ms = 300) { await page.waitForTimeout(ms); }
async function menu(id) {
    await page.evaluate((x) => window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: x } })), id);
    await pause(350);
}
async function cam(v) { await menu(`view.${v}`); await pause(200); }

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(2500);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(500);
});
test.afterAll(async () => {
    try { await pause(1200); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1000));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-143] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const c = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        c.on('close', () => resolve());
    });
});

test('00 — seed valid + invalid frames', async () => {
    await cam('iso');
    await shot('boot');
    await page.evaluate(() => {
        // Mix: a valid Position frame + an invalid (no datums) Position frame.
        window.__forgeGdtFrames = [
            { symbol: 'Position', tolerance: 0.1, hasDiameter: true,
              datums: [{ ref: 'A', modifier: 'M' }, { ref: 'B', modifier: '' }],
              modifier: 'M',
              formatted: '⌖|Ø0.1 Ⓜ|A Ⓜ|B' },
            { symbol: 'Position', tolerance: 0.1, hasDiameter: true,
              datums: [], modifier: 'M',
              formatted: '⌖|Ø0.1 Ⓜ' },  // INVALID: Position needs ≥1 datum
            { symbol: 'Flatness', tolerance: 0.05, hasDiameter: false, datums: [], modifier: '',
              formatted: '▱|0.05' },  // valid: Flatness needs no datum
        ];
    });
    await shot('seeded');
});
test('01 — open + run', async () => {
    await cam('front');
    await menu('tools.asmeValidator');
    await page.waitForSelector('[data-testid="forge-asme-validator-panel"]', { state: 'visible', timeout: 6000 });
    await shot('open');
    await page.locator('[data-testid="forge-asme-run"]').click();
    await pause(400);
    await shot('after-run');
});
test('02 — validator report published on window', async () => {
    await cam('top');
    const report = await page.evaluate(() => window.__forgeAsmeValidatorReport || null);
    console.log('[push-143] report keys =', report && Object.keys(report).join(','));
    expect(report).not.toBeNull();
    // The asmeY145Rules.js engine returns { frames: [...] } or
    // { byFrame: [...] } depending on slice version. Accept either.
    const list = report.frames || report.byFrame || [];
    expect(list.length).toBe(3);
});
test('03 — rerun produces a report', async () => {
    await cam('right');
    await page.locator('[data-testid="forge-asme-run"]').click();
    await pause(500);
    await shot('rerun');
    const report = await page.evaluate(() => window.__forgeAsmeValidatorReport);
    expect(report).not.toBeNull();
});
test('04 — close + final iso shot', async () => {
    await cam('iso');
    await page.locator('[data-testid="forge-asme-validator-close"]').click().catch(() => {});
    await pause(200);
    await shot('closed');
});
