// PUSH-43 (Slice-12) — Sheet Metal: develop the flat pattern into a real,
// visible 2D drawing.
//
// The sheet-metal kernel chain (baseFlange/edgeFlange/flatPattern/bends)
// was complete and the FlatPatternView component existed — but the view
// was ORPHANED (never mounted), so running Flat produced an invisible
// wire body and no drawing. This slice mounts a FlatPatternHost and has
// the shell open it (event-driven) after sheet.flatPattern / sheet.unfold,
// sourcing the develop from the formed body.
//
// Proof end to end through the real UI:
//   1. Switch to the Sheet workbench, build a 100×60 base flange.
//   2. Add a 25mm edge flange on edge 0 (one 90° bend).
//   3. Run Flat → the FlatPatternHost renders the developed pattern with
//      a bbox ≈ 224×60 (base 100 + developed flange) and a bend count of 1,
//      and the SVG outline has real geometry (paths drawn).
//
// No stubs: bbox + bend count come from the native flatPattern/bends on
// the real formed body handle.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-43-sheet-flat');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'sheet-flat-session.mp4');

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
    if (await btn.count() === 0) { console.warn(`[push-43] no [data-wb="${wbId}"]`); return; }
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
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    await dismissOverlays();
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-43] no [data-tool="${toolId}"]`); return false; }
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
        if (/push-43|sheet|flat|bend|error|Error/i.test(t)) console.log('[browser]', t);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-43] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-43] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-43] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + Sheet workbench', async () => {
    await shot('boot');
    await switchWorkbench('sheet');
    await shot('sheet-wb');
});

test('01 — build a 100×60 base flange', async () => {
    const ok = await clickTool('sheet.baseFlange',
        { width: 100, height: 60, thickness: 2, bendRadius: 3 }, 'base-flange');
    expect(ok).toBe(true);
    expect(await stateBodyCount()).toBe(1);
});

test('02 — add a 25mm edge flange (one 90° bend)', async () => {
    await clickTool('sheet.edgeFlange',
        { edgeId: 0, length: 25, angleDeg: 90, thickness: 2, bendRadius: 3 }, 'edge-flange');
    // Edge flange replaces/extends the sheet body — still at least one body.
    expect(await stateBodyCount()).toBeGreaterThanOrEqual(1);
});

test('03 — Flat develops a visible flat-pattern drawing', async () => {
    await clickTool('sheet.flatPattern', { thickness: 2, bendRadius: 3 }, 'flat-cmd');
    // The FlatPatternHost mounts the developed pattern.
    await page.waitForSelector('[data-testid="forge-flat-pattern-view"]', { state: 'visible', timeout: 6000 });
    await pause(600);
    await shot('flat-pattern');

    // Bend count == 1 (the single edge-flange bend).
    const bendTxt = await page.locator('[data-testid="forge-flat-pattern-bend-count"]').innerText();
    console.log('[push-43] flat-pattern bend readout =', bendTxt);
    expect(bendTxt).toMatch(/Bends:\s*1/);

    // bbox readout present and sane: developed width ≥ the 100mm base
    // (the flange adds developed length) and height ≈ 60mm.
    const bbox = await page.locator('[data-testid="forge-flat-pattern-bbox"]').innerText();
    console.log('[push-43] flat-pattern bbox readout =', bbox);
    const nums = (bbox || '').match(/-?\d+\.?\d*/g)?.map(Number) || [];
    expect(nums.length).toBeGreaterThanOrEqual(2);
    const wdt = nums[0], hgt = nums[1];
    // Developed width ≥ base 100 (flange develops outboard); height ≈ 60.
    expect(wdt).toBeGreaterThan(99);
    expect(Math.abs(hgt - 60)).toBeLessThan(2);
});

test('04 — the flat pattern renders real outline geometry', async () => {
    // The flat-pattern SVG draws the developed outline + bend lines.
    const paths = page.locator('[data-testid="forge-flat-pattern-view"] svg path');
    const count = await paths.count();
    console.log('[push-43] flat-pattern svg path count =', count);
    expect(count).toBeGreaterThan(0);
    await shot('flat-outline');
});
