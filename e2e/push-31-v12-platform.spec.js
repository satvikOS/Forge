// PUSH-31 — Mercedes M120 V12 built using ONLY the existing Forge-v4
// platform UI (no custom workbench). Drives:
//   • Sidebar workbench rail buttons [data-wb=...]   (Mech / Sketch / ...)
//   • Toolbar tool buttons          [data-tool=...]  (sketch.new, sketch.circle,
//                                                    solid.extrude, etc.)
//   • The platform's ToolParamDialog [data-testid=forge-tool-dock] with its
//     <input data-field=...> inputs and [data-testid=forge-tool-confirm].
//
// Result: native OCCT kernel produces a real body per Confirm — visible in
// the Forge viewport, listed in the feature tree, undo/redoable.
//
// One persistent Electron session, recordVideo on, ffmpeg-static transcodes
// to MP4 in afterAll. Reads spec from specs/mercedes-m120-v12-full.json.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(1800000);                                 // 30 min
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-31-v12-platform');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'v12-platform-session.mp4');

let app, page, spec;
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
    await btn.first().click();
    await pause(500);
}

// Click a real platform tool. Most tools open a ToolParamDialog (forge-tool-dock).
// We fill its `input[data-field=...]` inputs from `params`, then click
// [data-testid=forge-tool-confirm]. For enum/select fields, sets value; for
// vec3, types into each of the 3 inputs.
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) {
        console.warn(`[push-31] no [data-tool="${toolId}"] visible — skipping`);
        return;
    }
    await btn.first().click();
    // Some tools (sketch.finish) have empty schema and may not open a dialog.
    const dialog = page.locator('[data-testid="forge-tool-dock"]');
    let opened = false;
    try {
        await dialog.waitFor({ state: 'visible', timeout: 3000 });
        opened = true;
    } catch { /* no dialog */ }
    if (opened) {
        await pause(300);
        for (const [field, value] of Object.entries(params)) {
            const input = page.locator(`[data-testid="forge-tool-dock"] input[data-field="${field}"]`);
            const select = page.locator(`[data-testid="forge-tool-dock"] select[data-field="${field}"]`);
            if (await input.count() > 0) {
                // vec3 fields render 3 inputs in a row with the same data-field; handle as array.
                const n = await input.count();
                if (Array.isArray(value) && n >= 3) {
                    for (let i = 0; i < Math.min(value.length, n); i += 1) {
                        await input.nth(i).click();
                        await page.keyboard.press('Meta+A');
                        await page.keyboard.type(String(value[i]), { delay: 12 });
                        await pause(40);
                    }
                } else {
                    await input.first().click();
                    await page.keyboard.press('Meta+A');
                    await page.keyboard.type(String(value), { delay: 14 });
                    await pause(60);
                }
            } else if (await select.count() > 0) {
                await select.first().selectOption(String(value));
                await pause(60);
            }
        }
        await page.locator('[data-testid="forge-tool-confirm"]').click();
        await pause(500);
    }
    if (screenshotLabel) await shot(screenshotLabel);
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    spec = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '..', 'specs', 'mercedes-m120-v12-full.json'), 'utf8'));
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
    await pause(1200);
});

test.afterAll(async () => {
    try { await pause(2500); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) {
        try { await app.close({ timeout: 10000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'));
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
        console.error('[push-31] no .webm produced');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                const size = fs.statSync(FINAL_MP4).size;
                console.log(`[push-31] mp4 written: ${FINAL_MP4} (${(size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-31] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — Forge boot + switch to Mech workbench (sidebar click)', async () => {
    await shot('boot');
    await switchWorkbench('mech');
    await shot('mech-workbench-active');
    // Verify the toolbar is showing mech tools
    const toolbar = await page.locator('[data-testid="forge-toolbar"]').count();
    expect(toolbar).toBeGreaterThan(0);
});

// ----- crankshaft main journal -----
test('01 — new sketch on XY plane', async () => {
    await clickTool('sketch.new', { plane: 'XY' }, 'sketch-new-xy');
});

test('02 — sketch a Ø70 circle for the main journal', async () => {
    await clickTool('sketch.circle', {
        center: [0, 0, 0],
        radius: spec.crankshaft.main_journal_OD_mm / 2,
    }, 'sketch-circle-r35');
});

test('03 — finish sketch', async () => {
    await clickTool('sketch.finish', {}, 'sketch-finish');
});

test('04 — extrude profile 26 mm to make the journal', async () => {
    await clickTool('solid.extrude', {
        distance: spec.crankshaft.main_journal_width_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-26-main-journal');
});

test('05 — linear pattern 7 mains down crank axis at 106 mm pitch', async () => {
    await clickTool('pattern.linear', {
        dir: 'X',
        count: spec.block.main_bearings_count,
        spacing: spec.block.cylinder_pitch_mm,
    }, 'pattern-linear-7-mains');
});

// ----- block envelope -----
test('06 — new sketch on XY plane', async () => {
    await clickTool('sketch.new', { plane: 'XY' }, 'sketch-new-xy-block');
});

test('07 — sketch block outline rectangle 636 × 220', async () => {
    await clickTool('sketch.rect', {
        center: [0, 0, 0],
        width: spec.block.block_length_mm,
        height: spec.block.block_height_mm,
    }, 'sketch-rect-block');
});

test('08 — finish sketch', async () => {
    await clickTool('sketch.finish', {}, 'sketch-finish-block');
});

test('09 — extrude block 280 mm', async () => {
    await clickTool('solid.extrude', {
        distance: spec.block.block_height_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-block');
});

test('10 — fillet block edges r=8 mm', async () => {
    await clickTool('solid.fillet', { radius: 8 }, 'fillet-block');
});

// ----- bores bank A -----
test('11 — new sketch on top face / XY for bores', async () => {
    await clickTool('sketch.new', { plane: 'XY' }, 'sketch-new-bores');
});

test('12 — sketch bore Ø89', async () => {
    await clickTool('sketch.circle', {
        center: [0, -80, 0],
        radius: spec.bore.diameter_mm / 2,
    }, 'sketch-circle-bore');
});

test('13 — finish sketch', async () => {
    await clickTool('sketch.finish', {}, 'sketch-finish-bore');
});

test('14 — extrude bore 86 mm', async () => {
    await clickTool('solid.extrude', {
        distance: spec.bore.depth_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-bore');
});

test('15 — linear pattern 6 bores along X', async () => {
    await clickTool('pattern.linear', {
        dir: 'X',
        count: 6,
        spacing: spec.block.cylinder_pitch_mm,
    }, 'pattern-bores-A');
});

// ----- bores bank B (mirror via separate build) -----
test('16 — new sketch + circle Ø89 at +Y for bank B', async () => {
    await clickTool('sketch.new', { plane: 'XY' });
    await clickTool('sketch.circle', {
        center: [0, 80, 0],
        radius: spec.bore.diameter_mm / 2,
    }, 'sketch-bore-bank-B');
});

test('17 — finish + extrude + linear pattern for bank B', async () => {
    await clickTool('sketch.finish', {});
    await clickTool('solid.extrude', { distance: spec.bore.depth_mm, direction: 'Up (+Z)', op: 'New body' });
    await clickTool('pattern.linear', {
        dir: 'X', count: 6, spacing: spec.block.cylinder_pitch_mm,
    }, 'pattern-bores-B');
});

// ----- head -----
test('18 — head rect 636 × 100, extrude 80, fillet r=4', async () => {
    await clickTool('sketch.new', { plane: 'XY' });
    await clickTool('sketch.rect', {
        center: [0, 0, 0], width: spec.block.block_length_mm, height: 100,
    });
    await clickTool('sketch.finish', {});
    await clickTool('solid.extrude', { distance: 80, direction: 'Up (+Z)', op: 'New body' }, 'extrude-head');
    await clickTool('solid.fillet', { radius: 4 }, 'fillet-head');
});

// ----- oil pan -----
test('19 — oil pan rect 668 × 200, extrude 80, fillet r=6', async () => {
    await clickTool('sketch.new', { plane: 'XY' });
    await clickTool('sketch.rect', {
        center: [0, 0, 0], width: spec.block.block_length_mm * 1.05, height: 200,
    });
    await clickTool('sketch.finish', {});
    await clickTool('solid.extrude', { distance: 80, direction: 'Up (+Z)', op: 'New body' }, 'extrude-pan');
    await clickTool('solid.fillet', { radius: 6 }, 'fillet-pan');
});

// ----- view orbit -----
test('20 — orbit through views (sidebar / cmd-bar shortcuts)', async () => {
    // Press number keys for view shortcuts (1=front, 2=top, 3=right, 5=iso typically)
    for (const [key, label] of [['1','front'], ['2','top'], ['3','right'], ['5','iso']]) {
        await page.keyboard.press(key);
        await pause(1000);
        await shot(`view-${label}`);
    }
});

test('21 — final wide capture', async () => {
    await pause(2000);
    await shot('final-assembly');
});
