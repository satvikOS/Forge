// PUSH-35 — Reference geometry (datum planes). Proves the offset-plane
// workflow end-to-end: create a datum plane 50mm above XY, which auto-opens
// a sketch ON it, draw a rect, extrude — and assert via OCCT that the solid
// sits at z≥50 (i.e. it was built on the datum, not world XY). Also asserts
// the 3-point-plane and mid-plane datum factories register correctly.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-35-datum-planes');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'datum-planes-session.mp4');

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
    await btn.first().click(); await pause(500);
}
async function platformMenuAction(actionId) {
    await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
    }, actionId);
    await pause(400);
}
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 1500 }).catch(() => {});
    if (await page.locator('[data-testid="forge-tool-dock"]').count() > 0) {
        await page.keyboard.press('Escape').catch(() => {}); await pause(200);
    }
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-35] no [data-tool="${toolId}"]`); return; }
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
            let aabb = null;
            try {
                const t = f.tessellate(b.handle, 0.3);
                const p = t.positions || t.vertices || t;
                const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
                for (let i = 0; i < p.length; i += 3) for (let j = 0; j < 3; j++) {
                    mn[j] = Math.min(mn[j], p[i+j]); mx[j] = Math.max(mx[j], p[i+j]);
                }
                aabb = { mn, mx };
            } catch (e) { aabb = { err: e.message }; }
            out.push({ handle: b.handle, name: b.name || null, aabb });
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-35] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-35] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-35] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
});

test('01 — create an Offset Plane 50mm above XY (auto-opens a sketch on it)', async () => {
    await clickTool('datum.offsetPlane', { base: 'XY', distance: 50 }, 'offset-plane');
    const info = await page.evaluate(() => {
        const datums = window.__forgeDatums || [];
        const s = window.__forgeCurrentSketch;
        return {
            datumCount: datums.length,
            lastDatum: datums[datums.length - 1] || null,
            sketchOnDatum: s && typeof s.plane === 'object'
                ? { origin: s.plane.origin, normal: s.plane.normal } : null,
        };
    });
    console.log('[push-35] offset plane:', JSON.stringify(info));
    expect(info.datumCount).toBe(1);
    expect(info.lastDatum.origin[2]).toBeCloseTo(50, 3);
    // A sketch must have auto-opened on the datum (origin z≈50).
    expect(info.sketchOnDatum).not.toBeNull();
    expect(info.sketchOnDatum.origin[2]).toBeCloseTo(50, 3);
});

test('02 — sketch a rect on the datum + extrude → solid sits at z≥50', async () => {
    await clickTool('sketch.rect', { center: [0, 0, 0], width: 40, height: 30 }, 'datum-rect');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 20, direction: 'Up (+Z)', op: 'New body' }, 'datum-extrude');

    const bodies = await readNativeBodies();
    console.log('[push-35] after datum extrude:', JSON.stringify(bodies));
    expect(bodies.length).toBe(1);
    const b = bodies[0];
    // Built on the z=50 datum, extruded +20 → spans z[50,70]. The bottom face
    // must be at z≈50 (proves it was NOT built on world XY at z=0).
    expect(b.aabb.mn[2]).toBeGreaterThan(48);
    expect(b.aabb.mx[2]).toBeGreaterThan(68); expect(b.aabb.mx[2]).toBeLessThan(72);
});

test('03 — 3-point plane + mid-plane datums register', async () => {
    await clickTool('datum.plane3pt', { p1: [0,0,10], p2: [20,0,10], p3: [0,20,10] }, 'plane3pt');
    // 3pt plane auto-opens a sketch; finish it so it doesn't interfere.
    await platformMenuAction('sketch.finish');
    await clickTool('datum.midPlane', { planeA: 'XY', offsetA: 0, planeB: 'XY', offsetB: 80 }, 'midplane');
    await platformMenuAction('sketch.finish');
    const datums = await page.evaluate(() => (window.__forgeDatums || []).map((d) => ({ name: d.name, z: d.origin[2] })));
    console.log('[push-35] datums:', JSON.stringify(datums));
    // offset(50) + 3pt(z=10) + mid(z=40) = 3 datums.
    expect(datums.length).toBe(3);
    const mid = datums.find((d) => /Mid/.test(d.name));
    expect(mid.z).toBeCloseTo(40, 3);  // halfway between z=0 and z=80
    await shot('datums-final');
});
