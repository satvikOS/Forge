// PUSH-68 (Slice-36) — Camera Bookmarks panel.
//
// SolidWorks "Save View" / Fusion "Named Views" / Creo "Saved Views"
// parity. Prior to PUSH-68 Forge could fit-to-bounds + canonical
// iso/front/top/right view shortcuts, but had no way to capture and
// restore arbitrary user-framed cameras. PUSH-68 ships a real panel:
//   • save the current camera state (position + target) as a named
//     bookmark
//   • restore by clicking a row → camera position + OrbitControls
//     target snap back, .update() lands them cleanly
//   • delete by clicking the per-row Delete button
//   • persists to localStorage `forge.v4.cameraBookmarks`
//   • reachable through the `tools.cameraBookmarks` menu action
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner. Clear
//      `forge.v4.cameraBookmarks` for a known-empty start.
//   2. Seed a 40×40×40 native box so the viewport has something the
//      Drei OrbitControls can latch onto (R3F doesn't always finish
//      first-frame bring-up until at least one mesh draws).
//   3. Open Camera Bookmarks via `tools.cameraBookmarks`. The panel
//      mounts and reports 0 saved.
//   4. Frame view-A (front), save bookmark "side view". The bookmark
//      list grows by 1 and persists to localStorage.
//   5. Move the camera (switch to top), then click "side view" → camera
//      restores to view-A position + target; assert |position - saved|
//      and |target - saved| are < 1e-3 mm.
//   6. Save a second bookmark "iso view" from the iso camera, then
//      restore "side view" again — assert lossless round-trip.
//   7. Delete "iso view" → list shrinks by 1, localStorage reflects
//      the deletion.
//   8. Regression on PUSH-65 (also uses camera): open tools.sectionPlane,
//      confirm the panel mounts and the live SectionPlane bus still
//      ticks (independent of our camera writes).
//
// Multi-cam: 5 named angles per Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel, save bookmark)
//   - top   (move camera away from saved view)
//   - right (restore + 2nd bookmark)
//   - iso   (delete + section-panel regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-68-camera-bookmarks');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'camera-bookmarks-session.mp4');

let app, page;
let stepIndex = 0;
let savedSideView = null;
let savedIsoView  = null;

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
    await pause(450);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    // Camera switch goes through requestAnimationFrame in ForgeShellV4's
    // PUSH-31 useEffect — wait two frames for the smart-fit to land
    // before we attempt to read the resulting camera state.
    await pause(600);
}

// Read the live camera state straight off OrbitControls — mirrors the
// CameraBookmarksPanel.readCameraState() helper but as a page-level
// evaluate so the test can assert on what the kernel actually has.
async function readLiveCamera() {
    return await page.evaluate(() => {
        const orbit = window.__forgeOrbit;
        if (!orbit || !orbit.object || !orbit.target) return null;
        const p = orbit.object.position;
        const t = orbit.target;
        return {
            position: [Number(p.x), Number(p.y), Number(p.z)],
            target:   [Number(t.x), Number(t.y), Number(t.z)],
        };
    });
}

function dist(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    let s = 0;
    for (let i = 0; i < 3; i += 1) {
        const d = Number(a[i]) - Number(b[i]);
        s += d * d;
    }
    return Math.sqrt(s);
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
        if (/push-68|bookmark|Bookmark|camera|Camera|forge:camera|section|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss any first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    // Skip the Forge-189 onboarding tour overlay if it raced in.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        // Start from a known-empty bookmarks store so test assertions
        // are deterministic across runs.
        try { window.localStorage.removeItem('forge.v4.cameraBookmarks'); } catch {}
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
        console.error('[push-68] no .webm');
        return;
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
                console.log(`[push-68] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-68] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed a 40×40×40 native box (iso cam)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(40, 40, 40);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-68', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40x40x40',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    // Wait until the OrbitControls ref has been published by Viewport's
    // useFrame loop. Without this guard, the panel's Save button is
    // disabled (canCapture = false) and the first save would no-op.
    await page.waitForFunction(
        () => !!(window.__forgeOrbit && window.__forgeOrbit.object && window.__forgeOrbit.target),
        null, { timeout: 8000 });
    await shot('body-seeded');
});

test('01 — open Camera Bookmarks panel via tools.cameraBookmarks', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.cameraBookmarks');
    await page.waitForSelector('[data-testid="forge-camera-bookmarks-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Count chip reflects the empty store on first open.
    const count = await page.locator('[data-testid="forge-camera-bookmarks-count"]')
                            .getAttribute('data-count');
    expect(Number(count)).toBe(0);
    // Empty hint is rendered.
    await expect(page.locator('[data-testid="forge-camera-bookmarks-empty"]'))
        .toBeVisible();
});

test('02 — save bookmark "side view" from the front camera', async () => {
    // Capture the live camera state BEFORE we click Save so we know
    // exactly what value the bookmark should hold.
    const live = await readLiveCamera();
    expect(live).not.toBeNull();
    console.log('[push-68] front camera live =', live);
    savedSideView = live;

    await page.locator('[data-testid="forge-camera-bookmarks-save"]').click({ timeout: 4000 });
    await pause(300);

    // List grows from 0 → 1; count chip mirrors that.
    await page.waitForFunction(
        () => Number(document.querySelector(
            '[data-testid="forge-camera-bookmarks-count"]')?.getAttribute('data-count')) === 1,
        null, { timeout: 4000 });
    await shot('saved-side-view');

    // Find the row's id (the panel auto-assigns the name "View 1" on
    // first save; we rename it to "side view" in-place to match the
    // brief).
    const rowTestid = await page.evaluate(() => {
        const r = document.querySelector('[data-testid^="forge-camera-bookmark-row-"]');
        return r ? r.getAttribute('data-testid') : null;
    });
    expect(rowTestid).not.toBeNull();
    const rowId = rowTestid.replace(/^forge-camera-bookmark-row-/, '');
    console.log('[push-68] new bookmark id =', rowId);

    // Click Rename → fill input → blur (panel commits on blur or Enter).
    await page.locator(`[data-testid="forge-camera-bookmark-edit-${rowId}"]`).click({ timeout: 3000 });
    const renameInput = page.locator(`[data-testid="forge-camera-bookmark-rename-${rowId}"]`);
    await renameInput.fill('side view');
    await renameInput.press('Enter');
    await pause(200);

    // After commit, the row's data-bookmark-name attribute updates.
    const renamedName = await page.locator(`[data-testid="forge-camera-bookmark-row-${rowId}"]`)
                                  .getAttribute('data-bookmark-name');
    expect(renamedName).toBe('side view');

    // Persistence — read localStorage directly to prove the panel's
    // saveBookmarks() effect landed.
    const stored = await page.evaluate(() => {
        const raw = window.localStorage.getItem('forge.v4.cameraBookmarks');
        return raw ? JSON.parse(raw) : null;
    });
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('side view');
    expect(Array.isArray(stored[0].position)).toBe(true);
    expect(stored[0].position.length).toBe(3);
    expect(Array.isArray(stored[0].target)).toBe(true);
    expect(stored[0].target.length).toBe(3);
    // The stored position/target must round-trip the live camera read
    // — single source of truth.
    expect(dist(stored[0].position, savedSideView.position)).toBeLessThan(1e-3);
    expect(dist(stored[0].target,   savedSideView.target)).toBeLessThan(1e-3);
    console.log('[push-68] stored side view =', stored[0]);
});

test('03 — move camera (top) then restore "side view" — round-trip lossless', async () => {
    await cameraTo('top');
    // After the top camera move, the live camera must have shifted off
    // the saved front-view position. If it hasn't (the fit was a no-op),
    // the test would still pass trivially — assert the actual delta
    // first so the test is meaningful.
    const afterTop = await readLiveCamera();
    console.log('[push-68] camera after view.top =', afterTop);
    expect(dist(afterTop.position, savedSideView.position)).toBeGreaterThan(1e-2);
    await shot('camera-top');

    // The bookmarks panel survives camera changes — re-open if for any
    // reason it was dismissed.
    const panelVisible = await page.locator('[data-testid="forge-camera-bookmarks-panel"]')
                                   .isVisible().catch(() => false);
    if (!panelVisible) {
        await platformMenuAction('tools.cameraBookmarks');
        await page.waitForSelector('[data-testid="forge-camera-bookmarks-panel"]',
                                   { state: 'visible', timeout: 6000 });
    }

    // Restore.
    const rowId = await page.evaluate(() => {
        const r = document.querySelector('[data-bookmark-name="side view"]');
        return r ? r.getAttribute('data-testid').replace(/^forge-camera-bookmark-row-/, '') : null;
    });
    expect(rowId).not.toBeNull();
    await page.locator(`[data-testid="forge-camera-bookmark-restore-${rowId}"]`)
              .click({ timeout: 4000 });
    await pause(450);
    await shot('restored-side-view');

    // The host publishes window.__forgeCameraBookmarkLastRestored on
    // every successful restore — this is the deterministic test hook.
    const lastRestored = await page.evaluate(() => window.__forgeCameraBookmarkLastRestored || null);
    expect(lastRestored).not.toBeNull();
    expect(lastRestored.name).toBe('side view');
    expect(dist(lastRestored.position, savedSideView.position)).toBeLessThan(1e-3);
    expect(dist(lastRestored.target,   savedSideView.target)).toBeLessThan(1e-3);

    // The actual live OrbitControls must now report the saved values
    // (we wrote .position.set(...) + .target.set(...) + .update()).
    const liveAfter = await readLiveCamera();
    console.log('[push-68] camera after restore =', liveAfter);
    expect(dist(liveAfter.position, savedSideView.position)).toBeLessThan(1e-3);
    expect(dist(liveAfter.target,   savedSideView.target)).toBeLessThan(1e-3);
});

test('04 — save 2nd bookmark "iso view", re-restore side view', async () => {
    await cameraTo('right');
    // Move to iso and save the second bookmark.
    await cameraTo('iso');
    const isoLive = await readLiveCamera();
    expect(isoLive).not.toBeNull();
    savedIsoView = isoLive;
    console.log('[push-68] iso camera live =', isoLive);

    await page.locator('[data-testid="forge-camera-bookmarks-save"]').click({ timeout: 4000 });
    await pause(300);
    await page.waitForFunction(
        () => Number(document.querySelector(
            '[data-testid="forge-camera-bookmarks-count"]')?.getAttribute('data-count')) === 2,
        null, { timeout: 4000 });

    // Find the new row (the one that ISN'T "side view") and rename to
    // "iso view".
    const newRowId = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll(
            '[data-testid^="forge-camera-bookmark-row-"]'));
        const fresh = rows.find((r) => r.getAttribute('data-bookmark-name') !== 'side view');
        return fresh ? fresh.getAttribute('data-testid').replace(/^forge-camera-bookmark-row-/, '') : null;
    });
    expect(newRowId).not.toBeNull();
    await page.locator(`[data-testid="forge-camera-bookmark-edit-${newRowId}"]`).click({ timeout: 3000 });
    const renameInput = page.locator(`[data-testid="forge-camera-bookmark-rename-${newRowId}"]`);
    await renameInput.fill('iso view');
    await renameInput.press('Enter');
    await pause(250);
    await shot('two-bookmarks');

    // Now restore "side view" again — proves the list-driven restore
    // works for any row, not just the most recently created one.
    const sideRowId = await page.evaluate(() => {
        const r = document.querySelector('[data-bookmark-name="side view"]');
        return r ? r.getAttribute('data-testid').replace(/^forge-camera-bookmark-row-/, '') : null;
    });
    await page.locator(`[data-testid="forge-camera-bookmark-restore-${sideRowId}"]`)
              .click({ timeout: 4000 });
    await pause(450);
    const liveBack = await readLiveCamera();
    expect(dist(liveBack.position, savedSideView.position)).toBeLessThan(1e-3);
    expect(dist(liveBack.target,   savedSideView.target)).toBeLessThan(1e-3);

    // Verify the bus event fired for the second restore as well.
    const lastRestored = await page.evaluate(() => window.__forgeCameraBookmarkLastRestored || null);
    expect(lastRestored.name).toBe('side view');
});

test('05 — delete "iso view", regression PUSH-65 section panel', async () => {
    await cameraTo('iso');

    // Find and delete the "iso view" row.
    const isoRowId = await page.evaluate(() => {
        const r = document.querySelector('[data-bookmark-name="iso view"]');
        return r ? r.getAttribute('data-testid').replace(/^forge-camera-bookmark-row-/, '') : null;
    });
    expect(isoRowId).not.toBeNull();
    await page.locator(`[data-testid="forge-camera-bookmark-delete-${isoRowId}"]`)
              .click({ timeout: 4000 });
    await pause(300);

    // List shrinks back to 1; localStorage matches.
    await page.waitForFunction(
        () => Number(document.querySelector(
            '[data-testid="forge-camera-bookmarks-count"]')?.getAttribute('data-count')) === 1,
        null, { timeout: 4000 });
    const stored = await page.evaluate(() => {
        const raw = window.localStorage.getItem('forge.v4.cameraBookmarks');
        return raw ? JSON.parse(raw) : null;
    });
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('side view');
    await shot('deleted-iso-view');

    // ── PUSH-65 regression — Section Plane panel still mounts + the
    // bus event still fires. We don't fully toggle the slider here,
    // we just prove the panel is reachable + the plane is publishable
    // after our camera writes.
    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });
    await page.locator('[data-testid="forge-section-plane-enabled"]').check();
    await pause(250);
    const planeLive = await page.evaluate(() => window.__forgeSectionPlane || null);
    expect(planeLive).not.toBeNull();
    expect(planeLive.enabled).toBe(true);
    console.log('[push-68] PUSH-65 regression — sectionPlane =', planeLive);
    await shot('regression-section-panel');
});
