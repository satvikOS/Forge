// PUSH-30 — Mercedes M120 V12 full build, recorded end-to-end as MP4.
//
// Single Electron session (one launch, one close). Playwright records the
// entire viewport context to a .webm file via recordVideo. After the
// session closes, ffmpeg-static transcodes the .webm to .mp4 and dumps it
// at e2e-output/push-30-v12-mp4/v12-build-session.mp4.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(1800000);                                 // 30 min budget
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-30-v12-mp4');
const SHOTDIR = OUTPUT_DIR;
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'v12-build-session.mp4');

let app, page, spec;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 250) { await page.waitForTimeout(ms); }

async function clickTab(tab) {
    await page.locator(`[data-testid="forge-v12studio-tab-${tab}"]`).click();
    await pause(150);
}

async function runTool(tab, toolId, params, screenshotLabel) {
    await clickTab(tab);
    await page.locator(`[data-testid="forge-v12studio-tool-${toolId}"]`).click();
    await page.waitForSelector('[data-testid="forge-v12studio-dialog"]', { timeout: 4000 });
    await pause(300);
    for (const [field, value] of Object.entries(params || {})) {
        const input = page.locator(`[data-testid="forge-v12studio-input-${field}"]`);
        if (await input.count() > 0) {
            await input.first().click();
            await page.keyboard.press('Meta+A');
            await page.keyboard.type(String(value), { delay: 14 });
            await pause(80);
        }
    }
    await page.locator('[data-testid="forge-v12studio-dialog-confirm"]').click();
    await page.waitForSelector('[data-testid="forge-v12studio-dialog"]', { state: 'detached', timeout: 5000 }).catch(() => {});
    await pause(400);
    if (screenshotLabel) await shot(screenshotLabel);
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    spec = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '..', 'specs', 'mercedes-m120-v12-full.json'),
        'utf8',
    ));
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')],
        timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(1500);
});

test.afterAll(async () => {
    try { await pause(3000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) {
        try { await app.close({ timeout: 10000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
    // Wait briefly for Playwright to finalise the .webm
    await new Promise((r) => setTimeout(r, 1200));
    // Find the webm if path() didn't resolve.
    if (!videoPath || !fs.existsSync(videoPath)) {
        const candidates = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'));
        if (candidates.length > 0) {
            videoPath = path.join(VIDEO_DIR, candidates[0]);
        }
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
        console.error('[push-30] no webm produced');
        return;
    }
    console.log('[push-30] webm:', videoPath);
    // Transcode via ffmpeg-static.
    const ffmpegBin = require('ffmpeg-static');
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264',
            '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                const size = fs.statSync(FINAL_MP4).size;
                console.log(`[push-30] mp4 written: ${FINAL_MP4} (${(size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-30] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ============================================================ SESSION
test('00 — boot + open V12 Studio via Cmd-K palette', async () => {
    await shot('forge-boot-empty');
    await page.keyboard.press('Meta+K');
    await pause(700);
    await page.keyboard.type('V12 Studio', { delay: 60 });
    await pause(600);
    await shot('palette-typed');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="forge-v12studio-panel"]', { timeout: 8000 });
    await pause(900);
    await shot('studio-opened');
});

// -------- Crankshaft mains --------
test('01 — crank mains: new part + sketch XY + circle Ø70 + finish + linear pattern 7×106', async () => {
    await runTool('sketch', 'new-part', { name: 'crank-mains' }, 'new-part-crank-mains');
    await runTool('sketch', 'sketch-xy', {}, 'sketch-xy');
    await runTool('sketch', 'sk-circle', { r: spec.crankshaft.main_journal_OD_mm / 2, cx: 0, cy: 0 }, 'circle-r35');
    await runTool('sketch', 'finish-sketch', {}, 'finish-sketch');
    await runTool('pattern', 'lpattern', {
        count: spec.block.main_bearings_count,
        distance: spec.crankshaft.main_journal_width_mm,
        dx: spec.block.cylinder_pitch_mm,
        dy: 0,
    }, 'lpattern-7-mains');
});

test('02 — view ISO so the crank row is visible', async () => {
    await runTool('view', 'view-iso', {}, 'view-iso-crank');
});

// -------- 6 crank throws --------
test('03 — crank throw 1 (firing angle 0°)', async () => {
    await runTool('sketch', 'new-part', { name: 'crank-throw-1' });
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-circle', { r: spec.crankshaft.rod_journal_OD_mm / 2, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('solid', 'extrude', { dist: spec.crankshaft.rod_journal_width_mm });
    const a = (spec.crankshaft.throw_angles_deg[0] * Math.PI) / 180;
    await runTool('modify', 'translate', {
        dx: spec.block.cylinder_pitch_mm / 2,
        dy: Math.cos(a) * spec.crankshaft.throw_radius_mm,
        dz: Math.sin(a) * spec.crankshaft.throw_radius_mm,
    }, 'throw-1-placed');
});

test('04 — crank throws 2 - 6 at firing angles', async () => {
    for (let i = 1; i < 6; i += 1) {
        await runTool('sketch', 'new-part', { name: `crank-throw-${i + 1}` });
        await runTool('sketch', 'sketch-xy', {});
        await runTool('sketch', 'sk-circle', { r: spec.crankshaft.rod_journal_OD_mm / 2, cx: 0, cy: 0 });
        await runTool('sketch', 'finish-sketch', {});
        await runTool('solid', 'extrude', { dist: spec.crankshaft.rod_journal_width_mm });
        const a = (spec.crankshaft.throw_angles_deg[i] * Math.PI) / 180;
        await runTool('modify', 'translate', {
            dx: (i + 0.5) * spec.block.cylinder_pitch_mm,
            dy: Math.cos(a) * spec.crankshaft.throw_radius_mm,
            dz: Math.sin(a) * spec.crankshaft.throw_radius_mm,
        }, `throw-${i + 1}-placed`);
    }
});

// -------- Block envelope --------
test('05 — block: rect 636 × 220, extrude 280, fillet r=8', async () => {
    await runTool('sketch', 'new-part', { name: 'block' }, 'new-part-block');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-rect', {
        w: spec.block.block_length_mm, h: spec.block.block_height_mm, cx: 0, cy: 0,
    }, 'block-rect');
    await runTool('sketch', 'finish-sketch', {});
    await runTool('solid', 'extrude', { dist: spec.block.block_height_mm }, 'block-extruded');
    await runTool('modify', 'fillet', { r: 8 }, 'block-filleted');
});

// -------- 12 bores (two banks of 6) --------
test('06 — bores bank A: Ø89 × 86, linear pattern 6×106', async () => {
    await runTool('sketch', 'new-part', { name: 'bores-bank-A' }, 'new-part-bores-A');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-circle', { r: spec.bore.diameter_mm / 2, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('pattern', 'lpattern', {
        count: 6, distance: spec.bore.depth_mm,
        dx: spec.block.cylinder_pitch_mm, dy: 0,
    }, 'bores-A-pattern');
    // Translate down to bank-A side
    await runTool('modify', 'translate', { dx: 0, dy: -80, dz: 100 }, 'bores-A-positioned');
});

test('07 — bores bank B mirrored to opposite side', async () => {
    await runTool('sketch', 'new-part', { name: 'bores-bank-B' }, 'new-part-bores-B');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-circle', { r: spec.bore.diameter_mm / 2, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('pattern', 'lpattern', {
        count: 6, distance: spec.bore.depth_mm,
        dx: spec.block.cylinder_pitch_mm, dy: 0,
    }, 'bores-B-pattern');
    await runTool('modify', 'translate', { dx: 0, dy: 80, dz: 100 }, 'bores-B-positioned');
});

// -------- Heads --------
test('08 — head bank A: rect 636 × 100, extrude 80, fillet r=4', async () => {
    await runTool('sketch', 'new-part', { name: 'head-A' }, 'new-part-head-A');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-rect', { w: spec.block.block_length_mm, h: 100, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('solid', 'extrude', { dist: 80 }, 'head-A-extruded');
    await runTool('modify', 'fillet', { r: 4 }, 'head-A-filleted');
    await runTool('modify', 'translate', { dx: 0, dy: -130, dz: 195 }, 'head-A-positioned');
});

test('09 — head bank B mirrored', async () => {
    await runTool('sketch', 'new-part', { name: 'head-B' }, 'new-part-head-B');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-rect', { w: spec.block.block_length_mm, h: 100, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('solid', 'extrude', { dist: 80 }, 'head-B-extruded');
    await runTool('modify', 'fillet', { r: 4 }, 'head-B-filleted');
    await runTool('modify', 'translate', { dx: 0, dy: 130, dz: 195 }, 'head-B-positioned');
});

// -------- Oil pan --------
test('10 — oil pan: rect 668 × 200, extrude 80, fillet r=6', async () => {
    await runTool('sketch', 'new-part', { name: 'oil-pan' }, 'new-part-pan');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-rect', { w: spec.block.block_length_mm * 1.05, h: 200, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('solid', 'extrude', { dist: 80 }, 'pan-extruded');
    await runTool('modify', 'fillet', { r: 6 }, 'pan-filleted');
    await runTool('modify', 'translate', { dx: 0, dy: 0, dz: -180 }, 'pan-positioned');
});

// -------- Intake plenum --------
test('11 — intake plenum: rect 600 × 150, extrude 60', async () => {
    await runTool('sketch', 'new-part', { name: 'intake-plenum' }, 'new-part-intake');
    await runTool('sketch', 'sketch-xy', {});
    await runTool('sketch', 'sk-rect', { w: 600, h: 150, cx: 0, cy: 0 });
    await runTool('sketch', 'finish-sketch', {});
    await runTool('solid', 'extrude', { dist: 60 }, 'intake-extruded');
    await runTool('modify', 'translate', { dx: 0, dy: 0, dz: 320 }, 'intake-positioned');
});

// -------- View rotations to show the assembly --------
test('12 — orbit through all 4 standard views', async () => {
    await runTool('view', 'view-front', {}, 'view-front');
    await pause(1000);
    await runTool('view', 'view-top', {}, 'view-top');
    await pause(1000);
    await runTool('view', 'view-right', {}, 'view-right');
    await pause(1000);
    await runTool('view', 'view-iso', {}, 'view-iso-final');
    await pause(2000);
});

// -------- Final wide shot --------
test('13 — final wide capture', async () => {
    await pause(2000);
    await shot('final-assembly');
    const ops = parseInt(await page.locator('[data-testid="forge-v12studio-history-count"]').innerText(), 10);
    expect(ops).toBeGreaterThan(60);
});

test('14 — zero Archie posts', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
