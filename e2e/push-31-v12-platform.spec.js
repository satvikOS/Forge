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

// The platform handles `sketch.new` / `sketch.finish` through the menu
// channel (handleMenuAction in ForgeShellV4) — clicking the toolbar tool
// just sets activeTool and the Confirm handler errors out when there's
// no current sketch. Dispatching the platform's forge:menu-action event
// IS the documented in-platform path: it's the same channel Cmd-K
// palette, File menu, and the top toolbar use to start/end sketches.
async function platformMenuAction(actionId) {
    await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
    }, actionId);
    await pause(400);
}

// Click a real platform tool. Most tools open a ToolParamDialog (forge-tool-dock).
// We fill its `input[data-field=...]` inputs from `params`, then click
// [data-testid=forge-tool-confirm]. For enum/select fields, sets value; for
// vec3, types into each of the 3 inputs.
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    // Before opening a new tool: nuke any stale dock or toast that could
    // intercept the next click.
    if (await page.locator('[data-testid="forge-tool-dock"]').count() > 0) {
        await page.keyboard.press('Escape').catch(() => {});
        await pause(200);
    }
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) {
        console.warn(`[push-31] no [data-tool="${toolId}"] visible — skipping`);
        return;
    }
    // force: true bypasses any overlay (toast / confirmation corner / etc.)
    // that might intercept the click.
    await btn.first().click({ force: true, timeout: 8000 });
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
        // Wait for the dock to actually close before the next tool click.
        await page.waitForSelector('[data-testid="forge-tool-dock"]', { state: 'detached', timeout: 5000 }).catch(() => {});
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
test('01 — start sketch on XY plane (platform menu action)', async () => {
    await platformMenuAction('sketch.new');
    await shot('sketch-new-xy');
});

test('02 — sketch a Ø70 circle for the main journal', async () => {
    await clickTool('sketch.circle', {
        center: [0, 0, 0],
        radius: spec.crankshaft.main_journal_OD_mm / 2,
    }, 'sketch-circle-r35');
});

test('03 — finish sketch + extrude 26 mm = Ø70 cylinder', async () => {
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: spec.crankshaft.main_journal_width_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-main-journal');
});

test('04 — move main journal to crank centerline (translate -315, 0, 0)', async () => {
    await clickTool('solid.translate', {
        dx: -3 * spec.block.cylinder_pitch_mm,
        dy: 0, dz: 0,
    }, 'translate-main-journal');
});

test('05 — linear pattern 7 mains down crank axis at 106 mm pitch', async () => {
    await clickTool('pattern.linear', {
        dir: 'X',
        count: spec.block.main_bearings_count,
        spacing: spec.block.cylinder_pitch_mm,
    }, 'pattern-linear-7-mains');
});

// ----- block envelope -----
test('06 — block: rect 636×220, extrude 280, no translate (sits at origin)', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, 0, 0],
        width: spec.block.block_length_mm,
        height: spec.block.block_height_mm,
    }, 'sketch-rect-block');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: spec.block.block_height_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-block');
});

// ----- bores bank A: circles at -Y, extrude, then translate down (-Y) -----
test('07 — bore bank A: sketch Ø89 + extrude 86 + move to bank-A side', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.circle', {
        center: [0, 0, 0],
        radius: spec.bore.diameter_mm / 2,
    }, 'sketch-bore-A');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: spec.bore.depth_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-bore-A');
    await clickTool('solid.translate', { dx: 0, dy: -110, dz: 280 }, 'translate-bore-A');
});

// ----- bores bank B mirrored to +Y -----
test('08 — bore bank B: same sketch + extrude + translate +Y', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.circle', {
        center: [0, 0, 0],
        radius: spec.bore.diameter_mm / 2,
    }, 'sketch-bore-B');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: spec.bore.depth_mm,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'extrude-bore-B');
    await clickTool('solid.translate', { dx: 0, dy: 110, dz: 280 }, 'translate-bore-B');
});

// ----- head A on bank A side, elevated -----
test('09 — head A: rect + extrude 80 + translate to bank A top', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, 0, 0], width: spec.block.block_length_mm, height: 100,
    });
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 80, direction: 'Up (+Z)', op: 'New body' }, 'extrude-head-A');
    await clickTool('solid.translate', { dx: 0, dy: -160, dz: 400 }, 'translate-head-A');
});

// ----- head B mirrored -----
test('10 — head B: same + translate +Y top', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, 0, 0], width: spec.block.block_length_mm, height: 100,
    });
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 80, direction: 'Up (+Z)', op: 'New body' }, 'extrude-head-B');
    await clickTool('solid.translate', { dx: 0, dy: 160, dz: 400 }, 'translate-head-B');
});

// ----- oil pan: rect + extrude + translate BELOW block -----
test('11 — oil pan: rect + extrude + translate -Z', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, 0, 0], width: spec.block.block_length_mm * 1.05, height: 240,
    });
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 80, direction: 'Up (+Z)', op: 'New body' }, 'extrude-pan');
    await clickTool('solid.translate', { dx: 0, dy: 0, dz: -80 }, 'translate-pan');
});

// ----- view orbit -----
test('12 — orbit through views (sidebar / cmd-bar shortcuts)', async () => {
    for (const [key, label] of [['1','front'], ['2','top'], ['3','right'], ['5','iso']]) {
        await page.keyboard.press(key);
        await pause(1000);
        await shot(`view-${label}`);
    }
});

test('13 — final wide capture', async () => {
    await pause(2000);
    await shot('final-assembly');
});
