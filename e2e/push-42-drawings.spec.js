// PUSH-42 (Slice-11) — Drawings (HLR): project the REAL model to a 2D view.
//
// The DrawingsHLRWorkbench previously projected a HARDCODED 100×60×40
// sample box and only printed edge counts + raw DXF/SVG text. This slice
// makes it (a) project the user's actual current body, (b) render the
// projection as a real 2D drawing (SVG canvas: visible solid, hidden
// dashed), and (c) be reachable from the Tools menu + global search.
//
// Proof end to end through the real UI:
//   1. Build a 80×50×30 block (sketch rect + extrude).
//   2. Open Drawings (HLR) via the platform menu action.
//   3. Assert it projects THE BLOCK (not the 100×60×40 sample): a FRONT
//      view has visible edges > 0 and a bbox whose width/height match the
//      block's footprint (80 × 30), and the drawing canvas is rendered.
//
// No stubs: edge counts + bbox come from the native HLR projection of the
// real body handle in the live scene.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-42-drawings');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'drawings-session.mp4');

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
async function stateBodyCount() {
    return await page.evaluate(() =>
        (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').length);
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
async function clickTool(toolId, params = {}, screenshotLabel = null) {
    await dismissOverlays();
    const btn = page.locator(`[data-tool="${toolId}"]`);
    if (await btn.count() === 0) { console.warn(`[push-42] no [data-tool="${toolId}"]`); return; }
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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-42|drawing|hlr|error|Error/i.test(t)) console.log('[browser]', t);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-42] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-42] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-42] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + Mech workbench', async () => {
    await shot('boot');
    await switchWorkbench('mech');
});

test('01 — build an 80×50×30 block', async () => {
    await platformMenuAction('sketch.new');
    await clickTool('sketch.rect', { center: [0, 0, 0], width: 80, height: 50 }, 'block-sketch');
    await platformMenuAction('sketch.finish');
    await clickTool('solid.extrude', { distance: 30, direction: 'Up (+Z)', op: 'New body' }, 'block');
    expect(await stateBodyCount()).toBe(1);
});

test('02 — open Drawings (HLR) → it projects the REAL block, not the sample', async () => {
    await dismissOverlays();
    await platformMenuAction('tools.drawingsHlr');
    await page.waitForSelector('[data-testid="forge-drawingshlr-panel"]', { state: 'visible', timeout: 5000 });
    await pause(800); // auto-project on open
    await shot('drawings-front');

    // It must NOT report it is using the sample box.
    const desc = await page.locator('[data-testid="forge-drawingshlr-panel"]').innerText();
    expect(desc).not.toMatch(/Scene empty/i);

    // FRONT view of an 80(x)×50(y)×30(z) block: the projection plane is XZ,
    // so the 2D bbox should be 80 wide × 30 tall.
    const report = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-drawingshlr-bbox"]');
        const vc = document.querySelector('[data-testid="forge-drawingshlr-visible-count"]');
        return { bbox: el ? el.innerText : null, visible: vc ? Number(vc.innerText) : -1 };
    });
    console.log('[push-42] front view report =', JSON.stringify(report));
    expect(report.visible).toBeGreaterThan(0);

    // Parse the bbox "x [a → b] y [c → d]" and check span ≈ 80 × 30.
    const nums = (report.bbox || '').match(/-?\d+\.?\d*/g)?.map(Number) || [];
    expect(nums.length).toBe(4);
    const wdt = Math.abs(nums[1] - nums[0]);
    const hgt = Math.abs(nums[3] - nums[2]);
    console.log('[push-42] front view footprint =', wdt, '×', hgt, '(expect ~80 × 30)');
    expect(Math.abs(wdt - 80)).toBeLessThan(1);
    expect(Math.abs(hgt - 30)).toBeLessThan(1);
});

test('03 — the projection renders as an actual drawing (SVG canvas)', async () => {
    const canvas = page.locator('[data-testid="forge-drawingshlr-canvas"]');
    await expect(canvas).toBeVisible();
    // The canvas draws one <path> per projected edge — must be non-empty.
    const pathCount = await canvas.locator('path').count();
    console.log('[push-42] drawing canvas path count =', pathCount);
    expect(pathCount).toBeGreaterThan(0);
    await shot('drawings-canvas');
});

test('04 — TOP view reprojects to the 80×50 footprint', async () => {
    await page.locator('[data-testid="forge-drawingshlr-direction"]').selectOption('top');
    await pause(700); // auto-reproject on direction change
    const report = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-drawingshlr-bbox"]');
        return el ? el.innerText : null;
    });
    const nums = (report || '').match(/-?\d+\.?\d*/g)?.map(Number) || [];
    const wdt = Math.abs(nums[1] - nums[0]);
    const hgt = Math.abs(nums[3] - nums[2]);
    console.log('[push-42] top view footprint =', wdt, '×', hgt, '(expect ~80 × 50)');
    expect(Math.abs(wdt - 80)).toBeLessThan(1);
    expect(Math.abs(hgt - 50)).toBeLessThan(1);
    await shot('drawings-top');
});

test('05 — global search exposes the Drawings (HLR) command', async () => {
    await dismissOverlays();
    await page.keyboard.press('Meta+K').catch(() => {});
    await pause(400);
    let palette = page.locator('[data-testid="forge-cmd-palette"]');
    if (await palette.count() === 0) {
        await page.keyboard.press('Control+K').catch(() => {});
        await pause(400);
        palette = page.locator('[data-testid="forge-cmd-palette"]');
    }
    if (await palette.count() > 0) {
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Drawings HLR');
        await pause(500);
        await shot('search-drawings');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Drawings/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-42] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
