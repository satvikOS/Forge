// PUSH-145 — Cert traceability matrix.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-145-cert-traceability');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'cert-traceability-session.mp4');
const CSV_PATH  = path.join(os.tmpdir(), `push-145-cert-${Date.now()}.csv`);

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
    await page.evaluate(() => { try { localStorage.removeItem('forge.v4.certTraceability'); } catch {} });
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-145] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const c = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        c.on('close', () => resolve());
    });
});

test('00 — open cert panel', async () => {
    await cam('iso');
    await shot('boot');
    await menu('tools.certTraceability');
    await page.waitForSelector('[data-testid="forge-cert-traceability-panel"]', { state: 'visible', timeout: 6000 });
    await shot('open');
});

test('01 — load AS9100 Rev D preset → rows populate', async () => {
    await cam('front');
    await page.locator('[data-testid="forge-cert-template"]').selectOption('AS9100_REV_D');
    await pause(200);
    // Reload to actually load the rows (selectOption triggers loadTemplate already).
    await page.locator('[data-testid="forge-cert-reload"]').click();
    await pause(400);
    await shot('as9100');
    const count = await page.locator('[data-testid="forge-cert-traceability-panel"]').getAttribute('data-row-count');
    console.log('[push-145] AS9100 row count =', count);
    expect(Number(count)).toBeGreaterThan(0);
});

test('02 — mark some rows pass/fail', async () => {
    await cam('top');
    // Mark first 2 rows.
    await page.locator('[data-testid="forge-cert-result-0"]').selectOption('pass');
    await pause(150);
    const c1 = await page.locator('[data-testid="forge-cert-traceability-panel"]').getAttribute('data-row-count');
    if (Number(c1) > 1) {
        await page.locator('[data-testid="forge-cert-result-1"]').selectOption('fail');
        await pause(150);
    }
    await shot('marked');
    const passCntTxt = await page.locator('[data-testid="forge-cert-pass"]').textContent();
    console.log('[push-145] pass chip =', passCntTxt);
    expect(passCntTxt || '').toMatch(/Pass\s+\d/);
});

test('03 — export CSV to disk', async () => {
    await cam('right');
    await app.evaluate(async ({ ipcMain }, p) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => p);
    }, CSV_PATH);
    await page.locator('[data-testid="forge-cert-export"]').click();
    await pause(700);
    await shot('exported');
    expect(fs.existsSync(CSV_PATH)).toBe(true);
    const body = fs.readFileSync(CSV_PATH, 'utf8');
    console.log('[push-145] CSV size =', body.length, 'first 80 chars:', body.slice(0, 80));
    expect(body.length).toBeGreaterThan(50);
});

test('04 — close + iso final', async () => {
    await cam('iso');
    await page.locator('[data-testid="forge-cert-close"]').click().catch(() => {});
    await pause(200);
    await shot('closed');
});
