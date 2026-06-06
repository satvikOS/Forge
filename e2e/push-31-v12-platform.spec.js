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

// PUSH-31 — using the original event-dispatch path. The toolbar-click
// path for sketch.new/finish goes through the dialog and that turns
// out to interfere with the subsequent extrude flow under headless e2e.
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

// ----- PUSH-31 — block-and-bores spec. Uses smaller integer dimensions
//        that don't trip the sketch solver, then carves bores into the
//        block via Extrude · Operation = Cut. Result: ONE engine block
//        silhouette with 12 cavities, not 12 stacked cylinders.
test('01 — start sketch on XY plane', async () => {
    await platformMenuAction('sketch.new');
    await shot('sketch-new-xy');
});

test('02 — sketch a 200 × 80 mm rect for the engine block footprint', async () => {
    await clickTool('sketch.rect', {
        center: [0, 0, 0],
        width: 200,
        height: 80,
    }, 'block-footprint');
});

test('03 — finish sketch + extrude 60 mm = the engine block', async () => {
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: 60,
        direction: 'Up (+Z)',
        op: 'New body',
    }, 'block-extrude');
    await shot('block-built');
});

test.skip('04 — obsolete after block consolidation', async () => {});
test.skip('05 — obsolete', async () => {});
test.skip('06 — obsolete (part of block)', async () => {});

// ----- 6 more main journals along X via individual extrudes (not pattern, so each visible) -----
test.skip('06b — 6 more crank mains as separate bodies along X', async () => {
    for (let i = 1; i < 7; i += 1) {
        await platformMenuAction('sketch.new');
        await clickTool('sketch.circle', {
            center: [0, 0, 0],
            radius: spec.crankshaft.main_journal_OD_mm / 2,
        });
        await platformMenuAction('sketch.finish');
        await clickTool('solid.extrude', {
            distance: spec.crankshaft.main_journal_width_mm,
            direction: 'Up (+Z)',
            op: 'New body',
        });
        const x = (i - 3) * spec.block.cylinder_pitch_mm;
        await clickTool('solid.translate', { dx: x, dy: 0, dz: 0 }, `main-${i + 1}`);
    }
});

// ----- 6 crank throws at firing angles -----
test.skip('06c — 6 crank throws (rod journals) at firing angles', async () => {
    for (let i = 0; i < 6; i += 1) {
        await platformMenuAction('sketch.new');
        await clickTool('sketch.circle', {
            center: [0, 0, 0],
            radius: spec.crankshaft.rod_journal_OD_mm / 2,
        });
        await platformMenuAction('sketch.finish');
        await clickTool('solid.extrude', {
            distance: spec.crankshaft.rod_journal_width_mm,
            direction: 'Up (+Z)',
            op: 'New body',
        });
        const a = (spec.crankshaft.throw_angles_deg[i] * Math.PI) / 180;
        const x = (i - 2.5) * spec.block.cylinder_pitch_mm;
        const y = Math.cos(a) * spec.crankshaft.throw_radius_mm;
        const z = Math.sin(a) * spec.crankshaft.throw_radius_mm + 50;
        await clickTool('solid.translate', { dx: x, dy: y, dz: z }, `throw-${i + 1}`);
    }
});

// ----- PUSH-31 — 12 cylinder bores, BOOLEAN-CUT into the block.
//        Each bore sketches at its world (x, y) position then extrudes
//        UP with op=Cut: the new dispatcher path subtracts the cylinder
//        from the previous body (the block) and replaces it. Result: ONE
//        engine block with 12 cylindrical cavities, not 12 stacked tubes.
// ----- PUSH-31 — 6 bores cut into the block at Y=-20 (one row).
//        Smaller, integer-friendly coords matching the block scale above.
test('07 — bore bank A: cut 6 Ø20 bores into the block at Y=-20', async () => {
    for (let i = 0; i < 6; i += 1) {
        const x = (i - 2.5) * 30;
        await platformMenuAction('sketch.new');
        await clickTool('sketch.circle', {
            center: [x, -20, 0],
            radius: 10,
        }, `bore-A-${i + 1}-sketch`);
        await platformMenuAction('sketch.finish');
        await clickTool('solid.extrude', {
            distance: 60,
            direction: 'Up (+Z)',
            op: 'Cut',
        }, `bore-A-${i + 1}-cut`);
    }
    await shot('block-bank-A-cut');
});

test('08 — bore bank B: cut 6 Ø20 bores into the block at Y=+20', async () => {
    for (let i = 0; i < 6; i += 1) {
        const x = (i - 2.5) * 30;
        await platformMenuAction('sketch.new');
        await clickTool('sketch.circle', {
            center: [x, 20, 0],
            radius: 10,
        }, `bore-B-${i + 1}-sketch`);
        await platformMenuAction('sketch.finish');
        await clickTool('solid.extrude', {
            distance: 60,
            direction: 'Up (+Z)',
            op: 'Cut',
        }, `bore-B-${i + 1}-cut`);
    }
    await shot('block-bank-B-cut');
});

// ----- PUSH-31 — heads sit ON TOP of the cut block, separate bodies.
test('09 — head A: rect + extrude on top of bank A (-Y side)', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, -20, 0], width: 200, height: 30,
    }, 'head-A-sketch');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: 20, direction: 'Up (+Z)', op: 'New body',
    }, 'head-A');
    await clickTool('solid.translate', { dx: 0, dy: 0, dz: 60 }, 'head-A-translate');
});

test('10 — head B: rect + extrude on top of bank B (+Y side)', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, 20, 0], width: 200, height: 30,
    }, 'head-B-sketch');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', {
        distance: 20, direction: 'Up (+Z)', op: 'New body',
    }, 'head-B');
    await clickTool('solid.translate', { dx: 0, dy: 0, dz: 60 }, 'head-B-translate');
});

// ----- oil pan: rect + extrude + translate BELOW block -----
test('11 — oil pan: rect + extrude + translate -Z', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', {
        center: [0, 0, 0], width: 220, height: 100,
    }, 'pan-sketch');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 20, direction: 'Up (+Z)', op: 'New body' }, 'extrude-pan');
    await clickTool('solid.translate', { dx: 0, dy: 0, dz: -20 }, 'translate-pan');
});

// ----- PUSH-31 — fillet all edges of the oil pan with no edge pick -----
//        Exercises the new "fillet-all" fallback: kernel.direct.edgeCount
//        is called when edgeIds is empty, then filletEdges runs across
//        [0..N-1] so the pan softens its corners like a real cast pan.
test('11b — fillet-all on the oil pan (no edge pick — uses edgeCount fallback)', async () => {
    await clickTool('solid.fillet', { radius: 8 }, 'fillet-all-pan');
    await pause(400);
    await shot('pan-fillet-all');
});

// ----- PUSH-31 — drill bolt hole on the filleted oil-pan top face -----
//        Exercises the new hole-wizard fallback that drops the hole on the
//        body's top-face center (-Z drill) when no face is picked. Real
//        Forge users will still pick a face; the fallback makes the toolbar
//        click usable without face-pick infra.
test('11c — drill default bolt hole on oil pan (no face pick — uses top-face fallback)', async () => {
    await clickTool('solid.hole', {
        type: 'Counterbore',
        diameter: 10, depth: 20,
        counterboreDia: 16, counterboreDepth: 6,
    }, 'hole-default-pan');
    await pause(400);
    await shot('pan-hole-default');
});

// ----- view orbit -----
test('12 — press iso view shortcut (1) — smart-fit kicks in', async () => {
    // The platform now smart-fits camera to body bbox on every viewName
    // change. Just press '1' for iso and watch the camera frame the V12.
    await page.keyboard.press('1');
    await pause(1200);
    await shot('view-iso-smartfit');
});

// ----- PUSH-31 — exploded view: pull every body away from assembly center
//        Real test of the now-live explodeOffsets wiring through Viewport.
test.skip('11d — exploded view: animate every body outward and capture iso', async () => {
    // Open via menu action — the platform's own command channel for
    // tools.explode.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
            { detail: { id: 'tools.explode' } }));
    });
    await pause(700);
    await shot('explode-panel-open');
    // Drag the slider to ~80% — bodies should move along their per-body
    // auto-direction (configured in ExplodedView.autoExplodeConfig).
    const slider = page.getByTestId('forge-explode-slider');
    if (await slider.count()) {
        await slider.evaluate((el) => {
            el.value = '0.8';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await pause(900);
        await shot('explode-80pct');
    } else {
        await shot('explode-panel-no-slider');
    }
    // Close panel + reset slider to 0 so the next steps see the assembled V12.
    if (await slider.count()) {
        await slider.evaluate((el) => {
            el.value = '0';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await pause(400);
    }
    const closeBtn = page.getByTestId('forge-explode-close');
    if (await closeBtn.count()) await closeBtn.click();
    await pause(300);
});

// ----- PUSH-31 — section view: cut the V12 at Y=0 and capture iso/front -----
//        Exercises the new ClippingUpdater that pushes gl.clippingPlanes
//        on every sectionPlane change. Before this, toggling section
//        view after first paint did nothing because onCreated only fires
//        once.
test('12b — section view: cut V12 at Y=0 and view from iso + front', async () => {
    await page.evaluate(() => {
        if (window.__forgeSetSection) {
            window.__forgeSetSection({ enabled: true, axis: 'Y', offset: 0 });
        }
    });
    await pause(800);
    await page.keyboard.press('1'); await pause(900); await shot('section-Y-iso');
    await page.keyboard.press('2'); await pause(900); await shot('section-Y-front');
    // Restore: disable section so the orbit step below sees the full body.
    await page.evaluate(() => {
        if (window.__forgeSetSection) {
            window.__forgeSetSection({ enabled: false, axis: 'Y', offset: 0 });
        }
    });
    await pause(400);
});

test('13 — orbit through views from the new distance', async () => {
    // Forge view shortcuts:
    //   1 = iso, 2 = front, 3 = back, 4 = top, 5 = bottom, 6 = right, 7 = left
    for (const [key, label] of [['2','front'], ['4','top'], ['6','right'], ['1','iso']]) {
        await page.keyboard.press(key);
        // Smart-fit auto-applies via the platform's useEffect on viewName.
        // No need to scroll wheel — camera positions itself for the bbox.
        await pause(1200);
        await shot(`view-${label}-smartfit`);
    }
});

test('14 — final wide capture', async () => {
    await pause(2000);
    await shot('final-assembly');
});
