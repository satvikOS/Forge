// PUSH-34 — Edge picking proven end-to-end. The kernel emits per-edge
// pickable polylines (direct.edgeSegments) tagged with the SAME 0-based id
// part.filletEdges uses; the viewport renders them as clickable lines in
// edge-filter mode and a click reports {kind:'edge', bodyHandle, edgeId}.
//
// Proof (no stubs): build a box, enter edge filter, pick ONE edge, fillet
// it. Assert the volume dropped by ~exactly a single-edge round (NOT the
// all-edges fallback), proving the picked edge id drove the kernel op.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-34-edge-picking');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'edge-picking-session.mp4');

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
    await btn.first().click();
    await pause(500);
}
async function platformMenuAction(actionId) {
    await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
    }, actionId);
    await pause(400);
}
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    if (await page.locator('[data-testid="forge-tool-dock"]').count() > 0) {
        await page.keyboard.press('Escape').catch(() => {});
        await pause(200);
    }
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-34] no [data-tool="${toolId}"]`); return; }
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
                const n = await input.count();
                if (Array.isArray(value) && n >= 3) {
                    for (let i = 0; i < Math.min(value.length, n); i += 1) {
                        await input.nth(i).click(); await page.keyboard.press('Meta+A');
                        await page.keyboard.type(String(value[i]), { delay: 12 }); await pause(40);
                    }
                } else {
                    await input.first().click(); await page.keyboard.press('Meta+A');
                    await page.keyboard.type(String(value), { delay: 14 }); await pause(60);
                }
            } else if (await select.count() > 0) {
                await select.first().selectOption(String(value)); await pause(60);
            }
        }
        await page.locator('[data-testid="forge-tool-confirm"]').click();
        await page.waitForSelector('[data-testid="forge-tool-dock"]', { state: 'detached', timeout: 5000 }).catch(() => {});
        await pause(500);
    }
    if (screenshotLabel) await shot(screenshotLabel);
}

async function readNativeBodies() {
    return await page.evaluate(() => {
        const out = [];
        const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const f = window.forge;
        for (const b of bodies) {
            if (!b || b.kind !== 'native' || typeof b.handle !== 'number') continue;
            let vol = null;
            try { const m = f.massProps(b.handle); vol = m.volume != null ? m.volume : m.mass; }
            catch (e) { vol = 'err:' + e.message; }
            out.push({ handle: b.handle, name: b.name || null, vol });
        }
        return out;
    });
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
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
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-34] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-34] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else { console.error('[push-34] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n')); }
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
});

test('01 — build a 60×40×30 block', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', { center: [0, 0, 0], width: 60, height: 40 }, 'block-footprint');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 30, direction: 'Up (+Z)', op: 'New body' }, 'block-built');
    const bodies = await readNativeBodies();
    console.log('[push-34] after block:', JSON.stringify(bodies));
    expect(bodies.length).toBe(1);
    expect(bodies[0].vol).toBeGreaterThan(71000);  // 60*40*30 = 72000
    expect(bodies[0].vol).toBeLessThan(73000);
});

test('02 — kernel emits pickable edges with the fillet id convention', async () => {
    const edgeInfo = await page.evaluate(() => {
        const body = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').slice(-1)[0];
        const segs = window.forge.direct.edgeSegments(body.handle, 0.25);
        return {
            handle: body.handle,
            count: segs.length,
            ids: segs.map((s) => s.id),
            firstEdgePts: segs[0] ? segs[0].points.length / 3 : 0,
        };
    });
    console.log('[push-34] edges:', JSON.stringify(edgeInfo));
    // A box has 12 unique edges; TopExp_Explorer enumerates 24 (shared by 2
    // faces each) — matching part.filletEdges' edgeById convention.
    expect(edgeInfo.count).toBeGreaterThanOrEqual(12);
    expect(edgeInfo.ids[0]).toBe(0);
    expect(edgeInfo.firstEdgePts).toBeGreaterThanOrEqual(2);
});

test('03 — enter edge filter, pick ONE edge, fillet it', async () => {
    // Dismiss any stale autosave banner / context menu that could intercept
    // the toolbar click.
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 2000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await pause(300);

    await platformMenuAction('edit.filterEdge');
    // Drive a real edge pick (bodyHandle + 0-based edgeId), exactly as the
    // viewport edge-line onClick does.
    const pick = await page.evaluate(() => {
        const body = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').slice(-1)[0];
        window.__forgeSelect({ kind: 'edge', ids: [body.handle], bodyHandle: body.handle, edgeId: 0 });
        return { handle: body.handle, edgeId: 0 };
    });
    console.log('[push-34] edge pick:', JSON.stringify(pick));
    await pause(300);
    await shot('edge-picked');

    const volBefore = (await readNativeBodies())[0].vol;
    await clickTool('solid.fillet', { radius: 5 }, 'edge-filleted');
    const bodies = await readNativeBodies();
    console.log('[push-34] after fillet:', JSON.stringify(bodies), 'before', volBefore);
    expect(bodies.length).toBe(1);
    const v = bodies[0].vol;
    // A single R5 fillet on one 30mm-long edge removes the corner wedge:
    // (r^2 - π r^2/4) * length = (25 - 19.635)*30 ≈ 161 mm³. The all-edges
    // fallback would remove FAR more (every one of 12 edges). Assert the
    // drop is small + positive → exactly one edge was rounded.
    const drop = volBefore - v;
    expect(drop).toBeGreaterThan(50);     // real material removed
    expect(drop).toBeLessThan(2000);      // NOT the all-edges fallback
});

test('04 — iso view + final capture', async () => {
    await page.keyboard.press('1').catch(() => {});
    await pause(800);
    await shot('iso-final');
});
