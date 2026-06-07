// PUSH-69 (Slice-37 / Layers — Body visibility groups panel).
//
// Up through PUSH-67 visibility was per-body only (RightPanel BodyList).
// PUSH-69 adds named layer groups: every body sits on a layer; toggling
// a layer's V flag hides every member body via the existing
// __forgeSetBodies pattern. Locked layers prevent selection. Membership
// persists in localStorage key `forge.v4.bodyLayers`.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner; clear the persisted
//      layer store so the suite starts from a clean Default-only state.
//   2. Seed 3 native OCCT boxes (10×10×10 / 20×20×20 / 30×30×30 at
//      origin, +50 X, +100 X) so each box has a distinct kernel handle.
//   3. Open Layers via the `tools.layers` menu action. The panel mounts
//      with one row labelled "Default" and the Default row reports 3
//      members (all 3 seeded boxes auto-land on Default).
//   4. Create a new layer "L1" via the "+ Layer" button. The window
//      prompt that the panel pops is monkey-patched up-front so the
//      handler returns "L1" synchronously and the new row appears with
//      0 members.
//   5. Move body 1 (the first seeded box) to L1 via the per-row "Move
//      to layer" dropdown. L1's member count flips to 1; Default's
//      drops to 2. Live `window.__forgeBodies[0].layerName` is NOT
//      a thing — the contract is the localStorage membership map, so
//      we assert that map directly.
//   6. Toggle L1's visibility OFF. Body 1's `visible` flag flips to
//      `false` (this is what Viewport.jsx reads when deciding whether
//      to render the mesh — see Viewport.jsx line 608: `if (m.body &&
//      m.body.visible === false) return null;`).
//   7. Toggle L1's lock ON. Attempt to select body 1 — the selection
//      effect inside the LayersPanel unwinds the pick and clears
//      window.__forgeSelection. Body 2 (on Default) is still pickable.
//   8. Regression on PUSH-58: opening the Mass Properties panel after
//      Layers still works — both panels are right-docked and must not
//      collide on the menu-action bus.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel, view default layer)
//   - top   (create L1, move body 1 to L1)
//   - right (hide L1 → body 1 invisible)
//   - iso   (lock L1, attempt selection, regression on PUSH-58)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-69-layers');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'layers-session.mp4');

let app, page;
let stepIndex = 0;
let handle1 = null;
let handle2 = null;
let handle3 = null;

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-69|layers|Layer|forge|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour intercepts pointer events on every panel
    // button. Mark it seen and dismiss any racing skip button.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    // Clear any persisted layer state from a previous suite run so this
    // test starts from the "Default only" baseline the spec promises.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.bodyLayers'); } catch {}
    });
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
        console.error('[push-69] no .webm'); return;
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
                console.log(`[push-69] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-69] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed 3 native boxes (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        const h1 = f.makeBox(10, 10, 10);
        const h2raw = f.makeBox(20, 20, 20);
        const h2 = f.translate(h2raw, 50, 0, 0);
        const h3raw = f.makeBox(30, 30, 30);
        const h3 = f.translate(h3raw, 100, 0, 0);
        if (typeof h1 !== 'number' || typeof h2 !== 'number' || typeof h3 !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-69-1', kind: 'native', handle: h1,
            toolId: 'solid.box', name: 'Box 1 (10)',
            params: { width: 10, height: 10, distance: 10 },
        });
        window.__forgeAppendBody({
            id: 'f-box-69-2', kind: 'native', handle: h2,
            toolId: 'solid.box', name: 'Box 2 (20 @ +50 X)',
            params: { width: 20, height: 20, distance: 20 },
        });
        window.__forgeAppendBody({
            id: 'f-box-69-3', kind: 'native', handle: h3,
            toolId: 'solid.box', name: 'Box 3 (30 @ +100 X)',
            params: { width: 30, height: 30, distance: 30 },
        });
        return { h1, h2, h3 };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h1).toBeGreaterThan(0);
    expect(seeded.h2).toBeGreaterThan(0);
    expect(seeded.h3).toBeGreaterThan(0);
    handle1 = seeded.h1;
    handle2 = seeded.h2;
    handle3 = seeded.h3;
    console.log('[push-69] seeded handles =', handle1, handle2, handle3);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 3,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Layers via tools.layers, Default has 3 members (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.layers');
    await page.waitForSelector('[data-testid="forge-layers-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');
    // Default row visible, with member count 3.
    const defaultRow = page.locator('[data-testid="forge-layers-row-Default"]');
    await expect(defaultRow).toBeVisible();
    const defCount = await page.locator('[data-testid="forge-layers-count-Default"]')
                                .textContent();
    expect((defCount || '').trim()).toBe('3');
    // Total layer count chip shows 1 (only Default).
    const headerCount = await page.locator('[data-testid="forge-layers-count"]')
                                   .textContent();
    expect((headerCount || '').trim()).toBe('1');
});

test('02 — create L1 via "+ Layer", move body 1 to L1, member counts shift (top)', async () => {
    await cameraTo('top');
    // The panel uses window.prompt to name the new layer. Monkey-patch
    // it to return "L1" before we click the button.
    await page.evaluate(() => {
        window.__forgePromptOriginal = window.prompt;
        window.prompt = () => 'L1';
    });
    await page.locator('[data-testid="forge-layers-new"]').click();
    await pause(400);
    // Restore the original prompt so later tests don't see the stub.
    await page.evaluate(() => {
        if (typeof window.__forgePromptOriginal === 'function') {
            window.prompt = window.__forgePromptOriginal;
        }
    });
    // L1 row should exist now with 0 members.
    await expect(page.locator('[data-testid="forge-layers-row-L1"]'))
        .toBeVisible({ timeout: 4000 });
    const l1CountBefore = await page.locator('[data-testid="forge-layers-count-L1"]')
                                     .textContent();
    expect((l1CountBefore || '').trim()).toBe('0');
    await shot('L1-created');

    // Move body 1 (handle1) to L1 via the per-row dropdown.
    const selector = `[data-testid="forge-layers-body-select-${handle1}"]`;
    await expect(page.locator(selector)).toBeVisible({ timeout: 4000 });
    await page.locator(selector).selectOption('L1');
    await pause(400);
    await shot('body1-moved-to-L1');

    // L1 should have 1 member; Default should have 2.
    const l1Count = await page.locator('[data-testid="forge-layers-count-L1"]')
                               .textContent();
    expect((l1Count || '').trim()).toBe('1');
    const defCount = await page.locator('[data-testid="forge-layers-count-Default"]')
                                .textContent();
    expect((defCount || '').trim()).toBe('2');

    // The persistence layer (localStorage) should reflect body 1's
    // layer assignment immediately, not after a reload.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.bodyLayers') || '{}');
        } catch { return null; }
    });
    console.log('[push-69] persisted store after move =', persisted);
    expect(persisted).not.toBeNull();
    expect(persisted.membership['f-box-69-1']).toBe('L1');
    // Body 2 + 3 should be on Default (no membership row OR Default).
    const m2 = persisted.membership['f-box-69-2'];
    const m3 = persisted.membership['f-box-69-3'];
    expect(m2 === undefined || m2 === 'Default').toBe(true);
    expect(m3 === undefined || m3 === 'Default').toBe(true);
});

test('03 — hide L1 → body 1 visible=false (right)', async () => {
    await cameraTo('right');
    // Read body 1's visible flag before hiding.
    const before = await page.evaluate((h) => {
        const b = (window.__forgeBodies || []).find((x) => x.handle === h);
        return b ? (b.visible !== false) : null;
    }, handle1);
    expect(before).toBe(true);
    // Click L1's visibility toggle to hide.
    await page.locator('[data-testid="forge-layers-visible-L1"]').click();
    await pause(400);
    await shot('L1-hidden');
    // Body 1's visible flag should now be false. Bodies 2 + 3 on Default
    // should still be true.
    const states = await page.evaluate(() => {
        const bodies = window.__forgeBodies || [];
        return bodies.map((b) => ({
            handle: b.handle,
            id: b.id,
            visible: b.visible !== false,
        }));
    });
    console.log('[push-69] body visibility after L1 hide =', states);
    const b1 = states.find((s) => s.handle === handle1);
    const b2 = states.find((s) => s.handle === handle2);
    const b3 = states.find((s) => s.handle === handle3);
    expect(b1?.visible).toBe(false);
    expect(b2?.visible).toBe(true);
    expect(b3?.visible).toBe(true);

    // The L1 row should also surface the hidden state via its data attrs.
    const l1Visible = await page.locator('[data-testid="forge-layers-row-L1"]')
                                 .getAttribute('data-visible');
    expect(l1Visible).toBe('false');

    // Toggle L1 back ON so subsequent tests see body 1 visible again
    // and we can exercise the lock path on a normally-visible body.
    await page.locator('[data-testid="forge-layers-visible-L1"]').click();
    await pause(300);
    const afterShow = await page.evaluate((h) => {
        const b = (window.__forgeBodies || []).find((x) => x.handle === h);
        return b ? (b.visible !== false) : null;
    }, handle1);
    expect(afterShow).toBe(true);
});

test('04 — lock L1 → selecting body 1 is rejected; PUSH-58 regression (iso)', async () => {
    await cameraTo('iso');
    // Click L1's lock toggle.
    await page.locator('[data-testid="forge-layers-lock-L1"]').click();
    await pause(400);
    await shot('L1-locked');
    // The L1 row should report locked=true and the locked-handles set
    // should contain body 1's handle.
    const l1Locked = await page.locator('[data-testid="forge-layers-row-L1"]')
                                .getAttribute('data-locked');
    expect(l1Locked).toBe('true');
    const lockedHas1 = await page.evaluate((h) => {
        const s = window.__forgeLockedHandles;
        return s instanceof Set ? s.has(h) : false;
    }, handle1);
    expect(lockedHas1).toBe(true);

    // Attempt to set the active selection to body 1. The panel's
    // selection-enforcement effect should unwind the pick.
    await page.evaluate((h) => {
        const sel = { kind: 'body', bodyHandle: h, ids: [h] };
        window.__forgeSelection = sel;
        window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: sel }));
    }, handle1);
    await pause(400);
    const rejected = await page.evaluate(() => {
        const sel = window.__forgeSelection;
        return !sel || sel.kind === 'none' || !Array.isArray(sel.ids) || sel.ids.length === 0;
    });
    expect(rejected).toBe(true);
    await shot('lock-enforced');

    // A pick on body 2 (on Default — unlocked) should succeed.
    await page.evaluate((h) => {
        const sel = { kind: 'body', bodyHandle: h, ids: [h] };
        window.__forgeSelection = sel;
        window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: sel }));
    }, handle2);
    await pause(400);
    const stillSelected = await page.evaluate((h) => {
        const sel = window.__forgeSelection;
        return sel && sel.bodyHandle === h;
    }, handle2);
    expect(stillSelected).toBe(true);

    // PUSH-58 regression: opening MassProps still mounts (the menu-action
    // bus is shared and neither panel may swallow the event).
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('massprops-regression');
    // The Layers panel should still be mounted — they coexist (both
    // right-docked, both at z-index 1330; the panel that mounted last
    // wins the painting order but both remain in the DOM).
    await expect(page.locator('[data-testid="forge-layers-panel"]'))
        .toBeAttached();
});
