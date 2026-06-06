// PUSH-59 (Slice-28 / Assembly Interference Detection panel)
//
// The kernel has shipped `forge.assembly.detectInterference` since
// Forge-35, but it operates on InstanceIds in the ComponentRegistry —
// so the shell-level `tools.interfere` action threw "instance does not
// exist" the moment it was fed raw shape handles from
// __forgeBodies[].handle. There was no first-class panel; the toast
// surface degraded to a silent fail.
//
// This slice ships a real UI:
//   - tools.interference opens a right-docked panel
//   - "Run check" iterates every pair of native bodies and asks the
//     kernel for the volume of their intersection via the robust path
//     `forge.common(a,b)` → `forge.massProps(common).volume`
//   - colliding pairs are rendered with body names + volume
//   - empty state surfaces "No interferences detected"
//
// Proof end-to-end:
//   1. Boot Forge under FORGE_E2E=1 and seed two overlapping native
//      boxes (40×40×40 each — first at origin, second translated +20mm
//      on X so the intersection volume is 20×40×40 = 32 000 mm³).
//   2. Open tools.interference. The panel autoruns on open.
//   3. The list shows exactly 1 colliding pair with volume ≈ 32 000 mm³.
//   4. Click "Run check" again and confirm the same answer (idempotent).
//   5. Translate Box B clear of Box A (+60mm so the boxes are
//      disjoint) and Run check → empty-state "No interferences
//      detected".
//
// Multi-cam: iso/front/right/top/iso-after = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-59-interference');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'interference-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function platformMenuAction(actionId) {
    await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
    }, actionId);
    await pause(400);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(300);
}

// Read the row-0 volume cell — that's the dominant colliding pair.
async function readTopRowVolume() {
    const cell = page.locator('[data-testid="forge-interference-row-0-volume"]');
    if (await cell.count() === 0) return null;
    const txt = await cell.textContent();
    const m = /(-?[0-9]+\.[0-9]+)/.exec(txt || '');
    return m ? Number(m[1]) : null;
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
        if (/push-59|interference|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-59] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-59] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-59] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + seed two overlapping 40×40×40 native boxes', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        if (typeof f.common !== 'function') return { error: 'forge.common unavailable' };
        if (typeof f.massProps !== 'function') return { error: 'forge.massProps unavailable' };
        const a = f.makeBox(40, 40, 40);
        const b0 = f.makeBox(40, 40, 40);
        // Translate the second box +20 on X so it overlaps the first by
        // a 20×40×40 = 32000 mm³ slab. translate() may return a NEW
        // handle on Forge's immutable shape registry.
        const b  = f.translate(b0, 20, 0, 0);
        if (typeof a !== 'number' || typeof b !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-a', kind: 'native', handle: a,
            toolId: 'solid.box', name: 'Box A 40',
            params: { width: 40, height: 40, distance: 40 },
        });
        window.__forgeAppendBody({
            id: 'f-box-b', kind: 'native', handle: b,
            toolId: 'solid.box', name: 'Box B 40',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handleA: a, handleB: b };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handleA).toBeGreaterThan(0);
    expect(seeded.handleB).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — kernel sanity: common(A,B).volume ≈ 32000 mm³ via JS API', async () => {
    await cameraTo('front');
    const directVol = await page.evaluate(() => {
        const bodies = window.__forgeBodies.filter((b) => b.kind === 'native');
        const a = bodies[0].handle;
        const b = bodies[1].handle;
        const inter = window.forge.common(a, b);
        const mp = window.forge.massProps(inter);
        return { vol: mp?.volume ?? null, inter };
    });
    console.log('[push-59] direct kernel common volume =', directVol.vol);
    expect(directVol.vol).not.toBeNull();
    // The intersection is exactly 20×40×40 = 32000 mm³.
    expect(Math.abs(directVol.vol - 32000)).toBeLessThan(1);
    await shot('kernel-direct');
});

test('02 — open Interference panel via tools.interference', async () => {
    await cameraTo('right');
    await platformMenuAction('tools.interference');
    await page.waitForSelector('[data-testid="forge-interference-panel"]', { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Body count badge says 2.
    await expect(page.locator('[data-testid="forge-interference-body-count"]'))
        .toContainText(/2\s*native\s*bodies/i);
});

test('03 — auto-scan on open reports exactly 1 colliding pair @ ~32000 mm³', async () => {
    await cameraTo('top');
    // Auto-run fires on open. Wait for the results section.
    await page.waitForSelector('[data-testid="forge-interference-results"]', { state: 'visible', timeout: 6000 });
    await shot('autoscan-results');

    const summary = await page.locator('[data-testid="forge-interference-summary"]').textContent();
    console.log('[push-59] summary =', summary);
    expect(summary).toMatch(/1\s+colliding\s+pair/i);

    const list = page.locator('[data-testid="forge-interference-list"]');
    await expect(list).toBeVisible();
    await expect(list.locator('[data-testid="forge-interference-row-0"]')).toBeVisible();

    const vol = await readTopRowVolume();
    console.log('[push-59] panel-reported volume =', vol);
    expect(vol).not.toBeNull();
    expect(Math.abs(vol - 32000)).toBeLessThan(1);

    // Body names appear in the row.
    const rowA = await page.locator('[data-testid="forge-interference-row-0-a"]').textContent();
    const rowB = await page.locator('[data-testid="forge-interference-row-0-b"]').textContent();
    expect(rowA).toMatch(/Box [AB] 40/);
    expect(rowB).toMatch(/Box [AB] 40/);
});

test('04 — Run check button re-runs the scan with identical result', async () => {
    await cameraTo('iso');
    // Click the button — the panel should re-run the scan.
    await page.locator('[data-testid="forge-interference-run"]').click();
    await pause(800);
    await shot('rerun-results');

    const vol = await readTopRowVolume();
    console.log('[push-59] rerun volume =', vol);
    expect(vol).not.toBeNull();
    expect(Math.abs(vol - 32000)).toBeLessThan(1);
});

test('05 — separate the bodies → empty state "No interferences detected"', async () => {
    // Push Box B further out so it no longer overlaps A.
    const newHandle = await page.evaluate(() => {
        const bodies = window.__forgeBodies.filter((b) => b.kind === 'native');
        const b = bodies[1];
        // Translate the existing handle by +60 on X so the centres are
        // 80mm apart (boxes are 40mm wide, so they are fully disjoint).
        const newH = window.forge.translate(b.handle, 60, 0, 0);
        // Mutate the body entry — the panel reads handles from
        // __forgeBodies on every scan.
        b.handle = newH;
        return newH;
    });
    expect(newHandle).toBeGreaterThan(0);

    await page.locator('[data-testid="forge-interference-run"]').click();
    await pause(800);
    await shot('clean-results');

    await expect(page.locator('[data-testid="forge-interference-summary"]'))
        .toContainText(/No interferences detected/i);
    await expect(page.locator('[data-testid="forge-interference-empty"]')).toBeVisible();
});
