// PUSH-84 (Slice-52 / Voxel-rep panel).
//
// Up through PUSH-83 the Forge shell offered B-rep + NURBS as modelling
// representations. PUSH-84 ships the third — V-rep (voxels) — via a
// floating panel that picks the active body, samples its bbox at a
// {8, 16, 32, 64} grid resolution with a Möller-Trumbore ray-cast
// point-in-mesh test, then commits the inside cube centres as a
// synthetic group body. The existing SceneMeshes / InstancedGroup path
// renders the cubes — Viewport.jsx is untouched.
//
// Proof end-to-end:
//   1. Boot Electron; dismiss any first-run banner; assert the headless
//      helper API (window.__forgeVoxelizationHelper) is wired by the
//      Host's mount effect.
//   2. Seed a 30³ native OCCT box at the origin so the headline fully-
//      filled-cube assertion lands on a real B-rep body.
//   3. Open the Voxelization panel via tools.voxelize. Assert the
//      panel mounts, the picker auto-selects the seeded box, the
//      default resolution is 8, and the stats grid shows the empty
//      state.
//   4. Pick resolution=8 (already default); click Voxelize. Assert the
//      stats grid populates: voxel count = 512 (=8³, every grid point
//      of a fully-filled cube is inside), fill ratio = 100 %, voxel
//      size ≈ 30/8 mm = 3.75 mm, equivalent volume ≈ 30³ = 27000 mm³.
//   5. Click Commit. Assert the bus event fires; window.__forgeVoxelizations
//      gets a new entry; the live scene picks up a fresh synthetic body
//      of kind 'synthetic' with spec.kind === 'group' carrying 512 cells.
//   6. Resolution sweep: switch to 16 (16³ = 4096 samples), click
//      Voxelize again. Assert the new voxel count is ≥ 4090 (a fully
//      filled cube is at every grid point — ≥ 4090 leaves a small
//      tolerance for the ray-cast missing a face-on point).
//   7. PUSH-58 regression: open Mass Properties via tools.massprops and
//      assert the panel still mounts — Voxelization is a portal sibling
//      and must not collide with other right-docked panels. Also assert
//      __forgeBodies still carries the original native box (the
//      voxel-rep is an append, not a replace).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API mount)
//   - front (seed box + open panel)
//   - top   (resolution=8 voxelize + assert stats)
//   - right (commit + assert bus + resolution=16 voxelize)
//   - iso   (PUSH-58 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-84-voxelize');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'voxelize-session.mp4');

let app, page;
let stepIndex = 0;
let boxBodyId = null;

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
    await pause(250);
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
        if (/push-84|voxel|Voxel|forge:voxelization|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    // Forge-189 onboarding tour: skip + flip the seen flag so the overlay
    // doesn't intercept clicks on the voxelization panel.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    await pause(800);
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
        const cands = fs.existsSync(VIDEO_DIR)
            ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
            : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
        console.error('[push-84] no .webm'); return;
    }
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
                const sz = (fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2);
                console.log(`[push-84] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-84] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Host mount effect installs the headless helper API. The panel
    // doesn't need to be open for these globals to exist.
    await page.waitForFunction(
        () => !!window.__forgeVoxelizationHelper
           && typeof window.__forgeOpenVoxelizationPanel === 'function'
           && typeof window.__forgeVoxelizationHelper.voxelize === 'function'
           && typeof window.__forgeVoxelizationHelper.commitVoxelization === 'function'
           && Array.isArray(window.__forgeVoxelizationHelper.VOXEL_RESOLUTIONS)
           && window.__forgeVoxelizations instanceof Map,
        null, { timeout: 8000 });

    // Default resolutions are exactly the {8, 16, 32, 64} set the slice
    // brief calls out.
    const res = await page.evaluate(() =>
        window.__forgeVoxelizationHelper.VOXEL_RESOLUTIONS.slice());
    expect(res).toEqual([8, 16, 32, 64]);
});

test('01 — seed 30³ box, open Voxel-rep panel (front)', async () => {
    await cameraTo('front');

    // Seed one native OCCT 30 mm cube centred on origin so the headline
    // "fully filled" assertion lands on a known body. The kernel's makeBox
    // builds an AABB with corners at (-dx/2, -dy/2, 0) → (dx/2, dy/2, dz),
    // so we translate to centre it on (0, 0, 0) for the symmetric voxel
    // bbox the math expects.
    boxBodyId = 'f-box-84-1';
    const seeded = await page.evaluate((id) => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        const raw = f.makeBox(30, 30, 30);
        // Translate so the box is centred on origin in Z (X/Y already centred).
        const h = f.translate(raw, 0, 0, -15);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id,
            kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Voxel Box 30',
            params: { width: 30, height: 30, distance: 30 },
        });
        return { h };
    }, boxBodyId);
    expect(seeded.error).toBeUndefined();
    expect(seeded.h).toBeGreaterThan(0);
    await page.waitForFunction(
        (n) => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= n,
        1, { timeout: 4000 });
    await shot('box-seeded');

    // Open the panel.
    await platformMenuAction('tools.voxelize');
    await page.waitForSelector('[data-testid="forge-voxelize-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The picker auto-selects the active body (the one we just seeded).
    const activeBodyId = await page.locator('[data-testid="forge-voxelize-panel"]')
                                   .getAttribute('data-active-body-id');
    expect(activeBodyId).toBe(boxBodyId);

    // Default resolution is 8.
    const defaultRes = await page.locator('[data-testid="forge-voxelize-panel"]')
                                 .getAttribute('data-resolution');
    expect(defaultRes).toBe('8');

    // The empty-state stats are surfaced.
    await expect(page.locator('[data-testid="forge-voxelize-empty"]')).toBeVisible();
    // The "rep tag" surfaces the V-rep label so the user knows this is
    // a third modelling representation alongside B-rep + NURBS.
    const repTag = await page.locator('[data-testid="forge-voxelize-rep-tag"]').textContent();
    expect((repTag || '').toLowerCase()).toContain('v-rep');
});

test('02 — Voxelize @ res=8 → 512 inside voxels @ ~100% fill (top)', async () => {
    await cameraTo('top');

    // Resolution buttons are wired — click 8 explicitly (already default
    // but the click proves the button surface is hot).
    await page.locator('[data-testid="forge-voxelize-res-8"]').click();
    await pause(200);
    const r = await page.locator('[data-testid="forge-voxelize-panel"]')
                        .getAttribute('data-resolution');
    expect(r).toBe('8');

    // Run the voxelisation. The math is JS-only and finishes in < 100 ms
    // even on a 12-tri tessellated cube.
    await page.locator('[data-testid="forge-voxelize-run"]').click();
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[data-testid="forge-voxelize-panel"]');
            if (!el) return false;
            const c = Number(el.getAttribute('data-voxel-count'));
            return Number.isFinite(c) && c > 0;
        }, null, { timeout: 8000 });
    await pause(200);
    await shot('voxelized-8');

    // Read the panel's data attributes; the stats are also surfaced in
    // the visible grid.
    const panel = page.locator('[data-testid="forge-voxelize-panel"]');
    const voxelCount = Number(await panel.getAttribute('data-voxel-count'));
    const voxelSize  = Number(await panel.getAttribute('data-voxel-size'));
    const fillRatio  = Number(await panel.getAttribute('data-fill-ratio'));
    const eqVolume   = Number(await panel.getAttribute('data-equivalent-volume'));

    // A 30³ axis-aligned cube fully encloses every 8³ grid centre.
    expect(voxelCount).toBe(512);
    // 30 mm / 8 = 3.75 mm voxel edge.
    expect(voxelSize).toBeGreaterThan(3.74);
    expect(voxelSize).toBeLessThan(3.76);
    // Fully filled ⇒ fill ratio = 1.0 (with float-tol).
    expect(fillRatio).toBeGreaterThan(0.999);
    // Equivalent volume = 512 × 3.75³ = 27000 mm³ (= 30³, by construction).
    expect(eqVolume).toBeGreaterThan(26990);
    expect(eqVolume).toBeLessThan(27010);

    // The visible stat row mirrors the data attribute.
    const statCount = await page.locator('[data-testid="forge-voxelize-stat-count"]')
                                .textContent();
    expect((statCount || '').replace(/\s+/g, ' ')).toContain('512 / 512');
    const statFill = await page.locator('[data-testid="forge-voxelize-stat-fill"]')
                               .textContent();
    expect((statFill || '').replace(/\s+/g, '')).toContain('100.00%');
});

test('03 — Commit voxel body + sweep res=16 → 4096 inside voxels (right)', async () => {
    await cameraTo('right');

    // Capture the bus event so we can prove Commit published a CustomEvent.
    await page.evaluate(() => {
        window.__push84Events = [];
        window.addEventListener('forge:voxelization-committed', (e) => {
            try {
                window.__push84Events.push({
                    id: e?.detail?.id,
                    sourceId: e?.detail?.sourceId,
                    resolution: e?.detail?.resolution,
                    voxelCount: e?.detail?.voxelCount,
                    voxelSize: e?.detail?.voxelSize,
                    fillRatio: e?.detail?.fillRatio,
                });
            } catch {}
        });
    });

    // Snapshot the body count BEFORE Commit so we can assert the append.
    const beforeCount = await page.evaluate(
        () => (window.__forgeBodies || []).length);

    // Commit the result from test 02. The VideoCaptureHUD lives at
    // zIndex 2400 bottom-right and can race for the Commit button's
    // pointer — drive the click programmatically through the DOM.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-voxelize-commit"]');
        if (!btn) throw new Error('commit button not found');
        btn.click();
    });
    await pause(500);
    await shot('committed');

    // The bus event fired with voxelCount=512.
    const events = await page.evaluate(() => window.__push84Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.voxelCount).toBe(512);
    expect(newest.resolution).toBe(8);
    expect(newest.sourceId).toBe(boxBodyId);

    // The toast surfaces the commit count.
    const toast = await page.locator('[data-testid="forge-voxelize-toast"]')
                            .textContent();
    expect((toast || '').toLowerCase()).toContain('committed 512');

    // The live scene grew by one body — the synthetic voxel-rep.
    const afterCount = await page.evaluate(
        () => (window.__forgeBodies || []).length);
    expect(afterCount).toBe(beforeCount + 1);

    // The new body is `kind: 'synthetic'` with the group spec carrying
    // 512 cells (the cube centres).
    const voxBody = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        return arr.find((b) => b && b.toolId === 'rep.voxel') || null;
    });
    expect(voxBody).not.toBeNull();
    expect(voxBody.kind).toBe('synthetic');
    expect(voxBody.spec?.kind).toBe('group');
    expect(voxBody.spec?.cells?.length).toBe(512);
    expect(voxBody.spec?.child?.kind).toBe('box');
    expect(voxBody.spec?.child?.dx).toBeGreaterThan(3.74);
    expect(voxBody.spec?.child?.dx).toBeLessThan(3.76);

    // The session-wide mirror picked it up.
    const mirrorSize = await page.evaluate(
        () => (window.__forgeVoxelizations instanceof Map)
                ? window.__forgeVoxelizations.size
                : -1);
    expect(mirrorSize).toBe(1);

    // ── Sweep: switch to resolution 16. The cube's count rises to
    // 16³ = 4096 (a fully filled cube touches every grid centre).
    // Re-select the seeded native box, since the commit may have shifted
    // the panel's auto-pick to the new voxel body.
    await page.evaluate((id) => {
        const sel = document.querySelector('[data-testid="forge-voxelize-body-picker"]');
        if (!sel) throw new Error('body picker not found');
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, id);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, boxBodyId);
    await pause(200);

    await page.locator('[data-testid="forge-voxelize-res-16"]').click();
    await pause(200);
    const r = await page.locator('[data-testid="forge-voxelize-panel"]')
                        .getAttribute('data-resolution');
    expect(r).toBe('16');

    await page.locator('[data-testid="forge-voxelize-run"]').click();
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[data-testid="forge-voxelize-panel"]');
            if (!el) return false;
            const c = Number(el.getAttribute('data-voxel-count'));
            return Number.isFinite(c) && c >= 4090;
        }, null, { timeout: 12000 });
    await pause(200);
    await shot('voxelized-16');

    const panel = page.locator('[data-testid="forge-voxelize-panel"]');
    const voxelCount = Number(await panel.getAttribute('data-voxel-count'));
    // Allow a tiny tolerance for ray-cast boundary edge cases — a fully
    // filled cube should land 4096 grid points but a face-on triangle
    // sometimes registers as a non-crossing at the precise sample.
    expect(voxelCount).toBeGreaterThanOrEqual(4090);
    expect(voxelCount).toBeLessThanOrEqual(4096);
});

test('04 — PUSH-58 regression: Mass Properties still mounts; bodies snapshot intact (iso)', async () => {
    await cameraTo('iso');

    // Open the Mass Properties panel via its menu action. PUSH-58 mounts
    // this panel and auto-reads the active native body. Both panels are
    // right-docked portals — they must coexist in the DOM.
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(500);
    await shot('massprops-regression');

    // The Voxelization panel should still be attached.
    await expect(page.locator('[data-testid="forge-voxelize-panel"]'))
        .toBeAttached();

    // The original native box is still in the scene (the voxel commit
    // was an append, not a replace).
    const stillThere = await page.evaluate((id) => {
        const arr = window.__forgeBodies || [];
        return arr.some((b) => b && b.id === id && b.kind === 'native');
    }, boxBodyId);
    expect(stillThere).toBe(true);

    // The voxel body is also still there.
    const voxStillThere = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        return arr.some((b) => b && b.toolId === 'rep.voxel');
    });
    expect(voxStillThere).toBe(true);
});
