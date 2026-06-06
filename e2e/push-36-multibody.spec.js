// PUSH-36 — Multi-body manager. A Bodies panel lists every native body with
// a per-body show/hide toggle + rename. Proves: build 2 bodies, the Bodies
// panel lists both, hide one → the viewport stops rendering it (mesh count
// drops) while the body still exists in state, then show it again.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-36-multibody');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'multibody-session.mp4');

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
    if (await btn.count() === 0) { console.warn(`[push-36] no [data-tool="${toolId}"]`); return; }
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

// Count rendered body meshes in the live three.js scene (userData.bodyId set
// on each visible body mesh). Hidden bodies are not added to the scene.
async function renderedBodyMeshCount() {
    return await page.evaluate(() => {
        const scene = window.__forgeScene;
        if (!scene) return -1;
        const ids = new Set();
        scene.traverse((o) => {
            if (o.isMesh && o.userData && typeof o.userData.bodyId === 'number') ids.add(o.userData.bodyId);
        });
        return ids.size;
    });
}
async function stateBodyCount() {
    return await page.evaluate(() =>
        (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').length);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-36] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-36] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-36] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
});

test('01 — build two separate bodies', async () => {
    // Body A
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', { center: [-40, 0, 0], width: 30, height: 30 }, 'bodyA-sketch');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 20, direction: 'Up (+Z)', op: 'New body' }, 'bodyA');
    // Body B
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', { center: [40, 0, 0], width: 30, height: 30 }, 'bodyB-sketch');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 20, direction: 'Up (+Z)', op: 'New body' }, 'bodyB');

    expect(await stateBodyCount()).toBe(2);
    expect(await renderedBodyMeshCount()).toBe(2);
});

test('02 — Bodies panel lists both bodies', async () => {
    const list = page.locator('[data-testid="forge-body-list"] li');
    await expect(list).toHaveCount(2);
    await shot('bodies-listed');
});

test('03 — hide one body → viewport stops rendering it, state keeps it', async () => {
    // Grab the first listed body's handle and toggle its visibility.
    const firstHandle = await page.evaluate(() => {
        const li = document.querySelector('[data-testid="forge-body-list"] li');
        return li ? Number(li.getAttribute('data-body-id')) : null;
    });
    expect(firstHandle).not.toBeNull();
    await page.locator(`[data-testid="body-visible-${firstHandle}"]`).click();
    await pause(600);
    await shot('one-hidden');

    // Still 2 bodies in state, but only 1 rendered in the scene.
    expect(await stateBodyCount()).toBe(2);
    expect(await renderedBodyMeshCount()).toBe(1);
    // The list row is marked hidden.
    const hidden = await page.evaluate((h) => {
        const li = document.querySelector(`[data-testid="forge-body-list"] li[data-body-id="${h}"]`);
        return li ? li.getAttribute('data-visible') : null;
    }, firstHandle);
    expect(hidden).toBe('false');
});

test('04 — show it again → both render', async () => {
    const firstHandle = await page.evaluate(() => {
        const li = document.querySelector('[data-testid="forge-body-list"] li');
        return li ? Number(li.getAttribute('data-body-id')) : null;
    });
    await page.locator(`[data-testid="body-visible-${firstHandle}"]`).click();
    await pause(600);
    expect(await renderedBodyMeshCount()).toBe(2);
    await shot('both-shown');
});
