// PUSH-61 — Persistent body→material assignments.
//
// PUSH-58 shipped the Mass Properties panel with a local-state material
// picker, and PUSH-60 added the Bill of Materials panel with its own
// material dropdowns persisted onto an in-memory `window.__forgeBodyMaterials`
// Map. The two surfaces still didn't share state: the BOM could store
// "aluminum" for box A while the MassProps panel showed "steel" for the
// same box, and either choice vanished on the next reload because the
// Map was memory-only.
//
// PUSH-61 introduces a shared persistence layer at
// `frontend/src/forge-v4/bodyMaterials.js` (localStorage key
// `forge.v4.bodyMaterials`, `forge:material-applied` window event) and
// wires both panels — plus a brand-new Materials Browser dialog
// reachable through the `tools.materials` menu action — into it.
//
// Proof end-to-end (this spec):
//   1. Seed two native boxes via forge.makeBox: 30³ (volume 27000) and
//      20³ (volume 8000). Reset the persistence helper so a previous run
//      can't bleed in.
//   2. Open MassPropsPanel on body 1, switch its material to aluminum,
//      assert mass = 27000 × 2.70e-3 = 72.900 g (exact PUSH-58 readout).
//   3. Switch the active selection to body 2 — assert MassProps now
//      shows steel (default), mass = 8000 × 7.85e-3 = 62.800 g.
//   4. Switch the active selection back to body 1 — assert the panel
//      STILL reads aluminum (proves the assignment is persisted on the
//      shared helper, not a transient component state).
//   5. Open MaterialsBrowserPanel via tools.materials — assert two rows
//      (Box 30, Box 20) with the correct already-persisted materials
//      (aluminum + steel).
//   6. Switch body 2 to titanium inside the Materials Browser; close
//      the browser; re-open MassPropsPanel on body 2; assert it reads
//      titanium (8000 × 4.50e-3 = 36.000 g exact). This proves the
//      cross-panel propagation.
//   7. Reload the renderer (full page navigation); assert the
//      assignments survive — the helper has hydrated from localStorage.
//
// Multi-cam: iso/front/right/top/iso-after = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-61-body-materials');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'body-materials-session.mp4');

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

async function selectBodyHandle(handle) {
    await page.evaluate((h) => {
        window.__forgeSelection = { bodyHandle: h };
        window.dispatchEvent(new CustomEvent('forge:selection-changed', {
            detail: { bodyHandle: h },
        }));
    }, handle);
    await pause(250);
}

async function readMassRowGrams() {
    const txt = await page.locator('[data-testid="forge-massprops-mass"]').textContent();
    const m = /([0-9]+\.[0-9]+)\s*g\b/.exec(txt || '');
    return m ? Number(m[1]) : null;
}

async function readMassMaterial() {
    return page.locator('[data-testid="forge-massprops-material"]').inputValue();
}

async function openMassProps() {
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]', {
        state: 'visible', timeout: 6000,
    });
}

async function closeMassProps() {
    const close = page.locator('[data-testid="forge-massprops-close"]');
    if (await close.count() > 0) {
        await close.click();
        await pause(300);
    }
}

async function openMaterialsBrowser() {
    await page.evaluate(() => {
        // Use the dedicated imperative hook so we don't also open the
        // legacy MaterialPicker / MaterialsLibrary panels at the same
        // time (they listen to the same tools.materials menu action and
        // would just stack on top of the browser). The browser host also
        // listens to tools.materials, so a real user clicking the menu
        // entry gets every panel — but for the test we want a clean,
        // single-panel surface to assert on.
        if (typeof window.__forgeOpenMaterialsBrowser === 'function') {
            window.__forgeOpenMaterialsBrowser(true);
        } else {
            window.dispatchEvent(new CustomEvent('forge:menu-action', {
                detail: { id: 'tools.materials' },
            }));
        }
    });
    await page.waitForSelector('[data-testid="forge-materials-browser-panel"]', {
        state: 'visible', timeout: 6000,
    });
}

async function closeMaterialsBrowser() {
    const close = page.locator('[data-testid="forge-materials-browser-close"]');
    if (await close.count() > 0) {
        await close.click();
        await pause(300);
    }
    // The dialog is keyed off React state — wait for it to actually
    // unmount before the next step pokes its imperative hooks.
    await page.waitForSelector('[data-testid="forge-materials-browser-panel"]', {
        state: 'detached', timeout: 4000,
    }).catch(() => {});
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
        if (/push-61|material|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);

    // Reset the persistence helper and the legacy Map so a previous run
    // doesn't bleed in. The helper exposes its own `clearBodyMaterials`
    // entry point on window so we can wipe both layers atomically.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.bodyMaterials'); } catch {}
        if (window.__forgeBodyMaterials instanceof Map) {
            window.__forgeBodyMaterials.clear();
        }
        const helper = window.__forgeBodyMaterialsHelper;
        if (helper && typeof helper.clearBodyMaterials === 'function') {
            helper.clearBodyMaterials();
        }
    });
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-61] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-61] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-61] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + seed two native boxes (30³ and 20³)', async () => {
    await cameraTo('iso');
    await shot('boot');

    const seeded = await page.evaluate(() => {
        const out = [];
        const make = (name, id, side) => {
            const h = window.forge?.makeBox?.(side, side, side);
            if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
            window.__forgeAppendBody({
                id, kind: 'native', handle: h,
                toolId: 'solid.box', name,
                params: { width: side, height: side, distance: side },
            });
            return { name, id, handle: h, side };
        };
        out.push(make('Box 30', 'f-box-30', 30));
        out.push(make('Box 20', 'f-box-20', 20));
        return out;
    });
    expect(seeded[0].handle).toBeGreaterThan(0);
    expect(seeded[1].handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('two-bodies-seeded');

    // Stash the handles on the test scope so later steps can re-select.
    test.info().annotations.push({
        type: 'push-61-handles', description: JSON.stringify(seeded),
    });
    // Also stash on the window so we can read them from page.evaluate.
    await page.evaluate((h) => {
        window.__push61Handles = h;
    }, [seeded[0].handle, seeded[1].handle]);
});

test('01 — Mass Properties on body 1 → aluminum → mass = 72.900 g', async () => {
    await cameraTo('front');

    // Activate body 1 (the 30³ box) via the selection contract.
    const [h0] = await page.evaluate(() => window.__push61Handles);
    expect(h0).toBeGreaterThan(0);
    await selectBodyHandle(h0);

    await openMassProps();
    await shot('massprops-body1-open');

    // Sanity — panel points at the 30³ box.
    await expect(page.locator('[data-testid="forge-massprops-body"]'))
        .toContainText(/Box 30|handle/);

    // Default material is steel until we change it.
    const initial = await readMassMaterial();
    expect(initial).toBe('steel');

    // Switch to aluminum, assert exact mass.
    await page.locator('[data-testid="forge-massprops-material"]')
        .selectOption('aluminum');
    await pause(300);
    await shot('massprops-body1-aluminum');

    const m = await readMassRowGrams();
    console.log('[push-61] body1 aluminum mass =', m);
    expect(m).not.toBeNull();
    // 27000 × 2.70e-3 = 72.900 g exact.
    expect(Math.abs(m - 72.900)).toBeLessThan(0.05);

    // Helper recorded the assignment under the kernel handle key.
    const helperState = await page.evaluate(() => {
        const h = window.__forgeBodyMaterialsHelper;
        return h ? h.getAllBodyMaterials() : null;
    });
    console.log('[push-61] helper after body1 assign =', helperState);
    expect(helperState).toMatchObject({ [`h:${h0}`]: 'aluminum' });
});

test('02 — switch selection to body 2 → MassProps shows steel default', async () => {
    await cameraTo('right');

    const [, h1] = await page.evaluate(() => window.__push61Handles);
    expect(h1).toBeGreaterThan(0);
    await selectBodyHandle(h1);

    // Wait for the active-body label to swap to "Box 20" so we know the
    // selection-changed event reached the panel before we read material.
    await expect(page.locator('[data-testid="forge-massprops-body"]'))
        .toContainText(/Box 20|handle/, { timeout: 4000 });

    const mat = await readMassMaterial();
    console.log('[push-61] body2 material =', mat);
    expect(mat).toBe('steel');

    const m = await readMassRowGrams();
    console.log('[push-61] body2 steel mass =', m);
    expect(m).not.toBeNull();
    // 8000 × 7.85e-3 = 62.800 g exact.
    expect(Math.abs(m - 62.800)).toBeLessThan(0.05);
    await shot('massprops-body2-steel');
});

test('03 — switch back to body 1 → MassProps STILL reads aluminum', async () => {
    await cameraTo('top');

    const [h0] = await page.evaluate(() => window.__push61Handles);
    await selectBodyHandle(h0);

    await expect(page.locator('[data-testid="forge-massprops-body"]'))
        .toContainText(/Box 30|handle/, { timeout: 4000 });

    const mat = await readMassMaterial();
    console.log('[push-61] body1 re-selected material =', mat);
    expect(mat).toBe('aluminum');

    const m = await readMassRowGrams();
    console.log('[push-61] body1 re-selected mass =', m);
    expect(Math.abs(m - 72.900)).toBeLessThan(0.05);
    await shot('massprops-body1-persisted-aluminum');
});

test('04 — Materials Browser via tools.materials lists both bodies', async () => {
    await cameraTo('iso');

    // Close MassProps first so the browser stack doesn't fight the
    // panel for focus / overlap the screenshot.
    await closeMassProps();
    await shot('massprops-closed');

    await openMaterialsBrowser();
    await shot('browser-open');

    // Row count chip reflects the two seeded bodies.
    const countChip = page.locator('[data-testid="forge-materials-browser-count"]');
    await expect(countChip).toHaveText('2');

    const rows = page.locator('[data-testid="forge-materials-browser-row"]');
    await expect(rows).toHaveCount(2);

    const names = await page.locator('[data-testid="forge-materials-browser-row-name"]')
        .allTextContents();
    expect(names).toEqual(['Box 30', 'Box 20']);

    // The persisted assignments — body 1 = aluminum, body 2 = steel —
    // are reflected on the row attributes.
    await expect(rows.nth(0)).toHaveAttribute('data-material', 'aluminum');
    await expect(rows.nth(1)).toHaveAttribute('data-material', 'steel');

    // Mass column should already be computed from the persisted material.
    const massCells = page.locator('[data-testid="forge-materials-browser-row-mass"]');
    const m0 = Number((await massCells.nth(0).textContent() || '').trim());
    const m1 = Number((await massCells.nth(1).textContent() || '').trim());
    console.log('[push-61] browser row masses =', m0, m1);
    // body 1: 27000 × 2.70e-3 = 72.900
    // body 2: 8000 × 7.85e-3 = 62.800
    expect(Math.abs(m0 - 72.900)).toBeLessThan(0.05);
    expect(Math.abs(m1 - 62.800)).toBeLessThan(0.05);
});

test('05 — assign titanium to body 2 in the browser → close → MassProps reads titanium', async () => {
    await cameraTo('front');

    // Pick titanium for body 2 (row index 1).
    const sel = page.locator('[data-testid="forge-materials-browser-row-material"]').nth(1);
    await sel.selectOption('titanium');
    await pause(400);
    await shot('browser-body2-titanium');

    // Browser row reflects the new value.
    const rows = page.locator('[data-testid="forge-materials-browser-row"]');
    await expect(rows.nth(1)).toHaveAttribute('data-material', 'titanium');

    // Mass on the browser updates to 8000 × 4.50e-3 = 36.000 g.
    const cell = page.locator('[data-testid="forge-materials-browser-row-mass"]').nth(1);
    const browserMass = Number((await cell.textContent() || '').trim());
    console.log('[push-61] browser body2 titanium mass =', browserMass);
    expect(Math.abs(browserMass - 36.000)).toBeLessThan(0.05);

    // Persisted state — helper sees titanium under body 2's handle key.
    const [, h1] = await page.evaluate(() => window.__push61Handles);
    const helperState = await page.evaluate(() => {
        const h = window.__forgeBodyMaterialsHelper;
        return h ? h.getAllBodyMaterials() : null;
    });
    console.log('[push-61] helper after browser titanium =', helperState);
    expect(helperState).toMatchObject({ [`h:${h1}`]: 'titanium' });

    // localStorage also reflects the persisted JSON.
    const ls = await page.evaluate(() => {
        try { return window.localStorage.getItem('forge.v4.bodyMaterials'); }
        catch { return null; }
    });
    console.log('[push-61] localStorage payload =', ls);
    expect(ls).toBeTruthy();
    const parsed = JSON.parse(ls);
    expect(parsed).toMatchObject({ [`h:${h1}`]: 'titanium' });

    // Close the browser, re-select body 2, re-open MassProps. The panel
    // should now read titanium because it pulls through the same helper.
    await closeMaterialsBrowser();
    await shot('browser-closed');

    await selectBodyHandle(h1);
    await openMassProps();
    await shot('massprops-body2-titanium-open');

    await expect(page.locator('[data-testid="forge-massprops-body"]'))
        .toContainText(/Box 20|handle/, { timeout: 4000 });

    const mat = await readMassMaterial();
    console.log('[push-61] massprops body2 material post-browser =', mat);
    expect(mat).toBe('titanium');

    const massGrams = await readMassRowGrams();
    console.log('[push-61] massprops body2 titanium mass =', massGrams);
    // 8000 × 4.50e-3 = 36.000 g exact.
    expect(Math.abs(massGrams - 36.000)).toBeLessThan(0.05);
});

test('06 — localStorage survives a page reload', async () => {
    await cameraTo('iso');

    // Capture the persisted JSON before the reload.
    const before = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.bodyMaterials'));
    expect(before).toBeTruthy();
    const beforeParsed = JSON.parse(before);

    // Reload — the Electron renderer rehydrates from localStorage.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await pause(2500);
    // Bypass first-launch "Set theme" dialog if present.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await pause(500);

    const after = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.bodyMaterials'));
    expect(after).toBeTruthy();
    expect(JSON.parse(after)).toEqual(beforeParsed);

    // Helper picks the persisted values up on the next call.
    const helperSnap = await page.evaluate(() => {
        const h = window.__forgeBodyMaterialsHelper;
        return h ? h.getAllBodyMaterials() : null;
    });
    console.log('[push-61] helper snapshot post-reload =', helperSnap);
    expect(helperSnap).toEqual(beforeParsed);

    await shot('post-reload');
});
