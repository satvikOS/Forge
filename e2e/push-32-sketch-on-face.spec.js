// PUSH-32 — Sketch-on-face (#216) proven end-to-end through the REAL Forge
// platform UI. Builds a deck plate, opens a sketch on its TOP FACE (not a
// world plane), draws a circle, and extrude-CUTs a bore through it — the
// classic SolidWorks "extrude-cut on the top face" newcomer workflow that
// was previously impossible (sketch always fell back to world XY).
//
// Proof of correctness (no stubs): after the cut, we read the live kernel
// body and assert via OCCT that
//   (a) a single native body remains (the plate, bored),
//   (b) the bore is positioned on the plate's TOP face — i.e. the cut
//       volume removed material at the top-face Z, not at world Z=0.
//
// Single persistent Electron session, headed, recordVideo -> MP4.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-32-sketch-on-face');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'sketch-on-face-session.mp4');

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

// Drive a real platform tool through its ToolParamDialog (forge-tool-dock).
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    if (await page.locator('[data-testid="forge-tool-dock"]').count() > 0) {
        await page.keyboard.press('Escape').catch(() => {});
        await pause(200);
    }
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) {
        console.warn(`[push-32] no [data-tool="${toolId}"] visible — skipping`);
        return;
    }
    await btn.first().click({ force: true, timeout: 8000 });
    const dialog = page.locator('[data-testid="forge-tool-dock"]');
    let opened = false;
    try { await dialog.waitFor({ state: 'visible', timeout: 3000 }); opened = true; }
    catch { /* no dialog */ }
    if (opened) {
        await pause(300);
        for (const [field, value] of Object.entries(params)) {
            const input = page.locator(`[data-testid="forge-tool-dock"] input[data-field="${field}"]`);
            const select = page.locator(`[data-testid="forge-tool-dock"] select[data-field="${field}"]`);
            if (await input.count() > 0) {
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
        await page.waitForSelector('[data-testid="forge-tool-dock"]', { state: 'detached', timeout: 5000 }).catch(() => {});
        await pause(500);
    }
    if (screenshotLabel) await shot(screenshotLabel);
}

// Read the live native bodies + their OCCT AABBs straight from the kernel
// in the renderer. Returns [{handle, name, aabb:{mn,mx}, vol}].
async function readNativeBodies() {
    return await page.evaluate(() => {
        const out = [];
        const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const f = window.forge;
        for (const b of bodies) {
            if (!b || b.kind !== 'native' || typeof b.handle !== 'number') continue;
            let aabb = null, vol = null;
            try {
                const t = f.tessellate(b.handle, 0.2);
                const p = t.positions || t.vertices || t;
                const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
                for (let i = 0; i < p.length; i += 3) {
                    for (let j = 0; j < 3; j++) {
                        mn[j] = Math.min(mn[j], p[i + j]);
                        mx[j] = Math.max(mx[j], p[i + j]);
                    }
                }
                aabb = { mn, mx };
            } catch (e) { aabb = { err: e.message }; }
            try { const m = f.massProps(b.handle); vol = m.volume != null ? m.volume : m.mass; }
            catch (e) { vol = 'err:' + e.message; }
            out.push({ handle: b.handle, name: b.name || null, aabb, vol });
        }
        return out;
    });
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
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
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) {
        try { await app.close({ timeout: 10000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-32] no .webm produced'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-32] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else { console.error('[push-32] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n')); }
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
    await shot('mech-active');
});

test('01 — build a 200×120×40 deck plate on XY', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', { center: [0, 0, 0], width: 200, height: 120 }, 'plate-footprint');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 40, direction: 'Up (+Z)', op: 'New body' }, 'plate-built');

    const bodies = await readNativeBodies();
    console.log('[push-32] after plate:', JSON.stringify(bodies));
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    const plate = bodies[bodies.length - 1];
    // Plate top face should be at z≈40 (extruded +Z 40 from XY).
    expect(plate.aabb.mx[2]).toBeGreaterThan(38);
    expect(plate.aabb.mx[2]).toBeLessThan(42);
});

test('02 — select the plate (so sketch-on-face targets it)', async () => {
    // Select via the kernel-backed body list; the shell reads selection.ids.
    await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        const last = bodies[bodies.length - 1];
        if (last && typeof window.__forgeSelect === 'function') {
            window.__forgeSelect({ kind: 'body', ids: [last.handle] });
        }
    });
    await pause(400);
    await shot('plate-selected');
});

test('03 — open a sketch ON THE TOP FACE of the plate', async () => {
    await clickTool('sketch.new', { plane: 'Top face of body' }, 'sketch-on-top-face');
    // Verify the active sketch session is on a CUSTOM (face-derived) plane,
    // not a world plane — i.e. #216 actually fired.
    const planeInfo = await page.evaluate(() => {
        const s = window.__forgeCurrentSketch;
        if (!s) return { present: false };
        return {
            present: true,
            customPlane: typeof s.plane === 'object' && s.plane !== null,
            origin: (typeof s.plane === 'object') ? s.plane.origin : s.plane,
            normal: (typeof s.plane === 'object') ? s.plane.normal : null,
        };
    });
    console.log('[push-32] sketch plane:', JSON.stringify(planeInfo));
    expect(planeInfo.present).toBe(true);
    expect(planeInfo.customPlane).toBe(true);
    // The derived plane origin must sit on the plate top (z≈40), normal ≈ +Z.
    expect(planeInfo.origin[2]).toBeGreaterThan(38);
    expect(Math.abs(planeInfo.normal[2])).toBeGreaterThan(0.9);
});

test('04 — sketch a Ø30 circle on the face + extrude-CUT a bore through', async () => {
    await clickTool('sketch.circle', { center: [0, 0, 0], radius: 15 }, 'face-circle');
    await platformMenuAction('sketch.finish');
    // Down = -normal = into the face; Cut = boolean against the plate.
    await clickTool('solid.extrude', { distance: 40, direction: 'Down (-Z)', op: 'Cut' }, 'bore-cut');

    const bodies = await readNativeBodies();
    console.log('[push-32] after bore cut:', JSON.stringify(bodies));
    // Exactly one native body remains — the plate with the bore cut into it.
    expect(bodies.length).toBe(1);
    const bored = bodies[0];
    // Plate footprint preserved (200×120) and top still at z≈40.
    const dx = bored.aabb.mx[0] - bored.aabb.mn[0];
    const dy = bored.aabb.mx[1] - bored.aabb.mn[1];
    expect(dx).toBeGreaterThan(195); expect(dx).toBeLessThan(205);
    expect(dy).toBeGreaterThan(115); expect(dy).toBeLessThan(125);
    expect(bored.aabb.mx[2]).toBeGreaterThan(38); expect(bored.aabb.mx[2]).toBeLessThan(42);
    // The cut removed material: solid plate vol = 200*120*40 = 960000 mm³.
    // After a Ø30 through-bore: 960000 - π*15²*40 ≈ 960000 - 28274 ≈ 931726.
    // Assert the volume dropped by roughly the bore volume (proves a real
    // cut placed on the face, not a no-op or a phantom body at Z=0).
    expect(bored.vol).toBeGreaterThan(925000);
    expect(bored.vol).toBeLessThan(945000);
    await shot('bored-plate-final');
});

test('05 — pick a SIDE face (face filter) + sketch + boss extrude on it', async () => {
    // Enter face-selection filter, then resolve a vertical side face of the
    // bored plate from the kernel and drive a real face pick through the
    // shell selection (bodyHandle + faceId), exactly as the viewport raycast
    // click does. This proves arbitrary-face picking, not just auto top-face.
    await platformMenuAction('edit.filterFace');
    const pick = await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        const body = bodies[bodies.length - 1];
        const D = window.forge.direct;
        const n = D.faceCount(body.handle);
        // find a planar face whose normal is ~horizontal (a +X/+Y wall)
        for (let i = 1; i <= n; i++) {
            const fi = D.inferFeature(body.handle, i);
            if (fi && /planar/i.test(fi.label || '') && Math.abs(fi.normal[2]) < 0.2) {
                window.__forgeSelect({ kind: 'face', ids: [body.handle],
                    bodyHandle: body.handle, faceId: i });
                return { handle: body.handle, faceId: i,
                    normal: fi.normal, centroid: fi.centroid };
            }
        }
        return null;
    });
    console.log('[push-32] side-face pick:', JSON.stringify(pick));
    expect(pick).not.toBeNull();
    await pause(300);

    await clickTool('sketch.new', { plane: 'Top face of body' }, 'sketch-on-side-face');
    const planeInfo = await page.evaluate(() => {
        const s = window.__forgeCurrentSketch;
        return s && typeof s.plane === 'object'
            ? { custom: true, origin: s.plane.origin, normal: s.plane.normal, faceId: s.plane.faceId }
            : { custom: false };
    });
    console.log('[push-32] side sketch plane:', JSON.stringify(planeInfo));
    expect(planeInfo.custom).toBe(true);
    // The sketch plane must be the SIDE face we picked: normal horizontal,
    // faceId matching the pick.
    expect(Math.abs(planeInfo.normal[2])).toBeLessThan(0.2);
    expect(planeInfo.faceId).toBe(pick.faceId);

    const volBefore = (await readNativeBodies())[0].vol;
    await clickTool('sketch.circle', { center: [0, 0, 0], radius: 8 }, 'side-circle');
    await platformMenuAction('sketch.finish');
    // Up (+normal) = boss growing OUT of the side wall; Add = fuse to plate.
    await clickTool('solid.extrude', { distance: 15, direction: 'Up (+Z)', op: 'Add' }, 'side-boss');

    const bodies = await readNativeBodies();
    console.log('[push-32] after side boss:', JSON.stringify(bodies));
    expect(bodies.length).toBe(1);
    // A boss adds material: volume must grow vs before (proves the boss grew
    // OUTWARD off the side face, not into the body).
    expect(bodies[0].vol).toBeGreaterThan(volBefore + 1000);
    await shot('side-boss-final');
});

test('06 — iso view, smart-fit, final capture', async () => {
    await page.keyboard.press('1').catch(() => {});
    await pause(800);
    await shot('iso-final');
});
