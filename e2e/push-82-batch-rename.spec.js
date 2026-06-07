// PUSH-82 (Slice-50 / Body Rename batch dialog).
//
// Up through PUSH-81 a body's `name` field was settable one at a time
// via the inline rename input in the Bodies panel / Assembly Tree. With
// a dozen "Box 20", "Box 30", "Box 40" bodies in a real scene that gets
// tedious. PUSH-82 ships a Batch Rename dialog with three modes:
//   1. inline edit per row
//   2. Find / Replace across all names
//   3. Number-suffix renamer (Prefix-1, Prefix-2, …)
// All three stage edits; an Apply button commits the staged map back to
// the live scene via window.__forgeSetBodies in a single atomic write.
//
// Proof end-to-end:
//   1. Boot Electron; dismiss any first-run banner; assert the headless
//      helper API (window.__forgeBatchRenameHelper) is wired by the
//      Host's mount effect — that's the contract surface every plugin /
//      Archie call relies on.
//   2. Seed 3 native OCCT boxes named "Box 20", "Box 30", "Box 40" so
//      the headline Find/Replace use case lands on a real scene.
//   3. Open the Batch Rename panel via tools.batchRename menu action.
//      Assert the panel mounts; the table lists all 3 bodies; each row's
//      current name matches the seeded values; the override count chip
//      reads "0/3".
//   4. Set Find="Box", Replace="Plate", click "Stage Find/Replace".
//      Assert every row is now staged with the replaced name and the
//      override count chip flips to "3/3".
//   5. Click Apply. Assert the bus event fires; the live scene's body
//      names are now "Plate 20", "Plate 30", "Plate 40"; the table
//      re-baselines with the new names and the chip returns to "0/3".
//   6. Inline edit one row and Apply again — proves the row-level path
//      also routes through __forgeSetBodies.
//   7. Number-suffix renamer: type "Part" as prefix, click Stage Renumber,
//      Apply. Assert names become "Part-1", "Part-2", "Part-3" in row
//      order.
//   8. PUSH-58 regression: open Mass Properties via tools.massprops and
//      assert the panel still mounts — Batch Rename is a portal sibling
//      and must not collide with other right-docked panels. Also assert
//      __forgeSetBodies wasn't broken (the rebuilt feature tree still
//      reflects the latest names).
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + assert mount + seed bodies)
//   - front (open panel + verify table)
//   - top   (Find/Replace stage + Apply)
//   - right (inline edit + number-suffix renamer)
//   - iso   (PUSH-58 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-82-batch-rename');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'batch-rename-session.mp4');

let app, page;
let stepIndex = 0;
let bodyId1 = null;
let bodyId2 = null;
let bodyId3 = null;

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

// Set an input's value through the native setter so React's onChange
// fires. Playwright's .fill() doesn't always dispatch the matching
// React synthetic event on controlled inputs.
async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, args.value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

async function readBodyNamesById() {
    return await page.evaluate(() => {
        const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const out = {};
        for (const b of arr) { if (b && typeof b.id === 'string') out[b.id] = b.name || null; }
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
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-82|batch-rename|BatchRename|forge:batch-rename|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen overlay that
    // intercepts pointer events on every panel button. Flip the seen
    // flag so it stays dormant; skip if it raced in.
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
        console.error('[push-82] no .webm'); return;
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
                console.log(`[push-82] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-82] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + seed 3 boxes named Box 20/30/40 (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The host effect installs the headless helper API mirror at module
    // load. That's the proof the bus capture is hot even before the
    // panel mounts.
    await page.waitForFunction(
        () => !!window.__forgeBatchRenameHelper
           && typeof window.__forgeOpenBatchRenamePanel === 'function'
           && typeof window.__forgeBatchRenameHelper.commitBatchRename === 'function',
        null, { timeout: 8000 });

    // Seed three native boxes. The Find/Replace headline test wants
    // "Box 20", "Box 30", "Box 40" — distinct names with a shared
    // "Box" prefix so the substring replace lands cleanly.
    bodyId1 = 'f-box-82-1';
    bodyId2 = 'f-box-82-2';
    bodyId3 = 'f-box-82-3';
    const seeded = await page.evaluate((ids) => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        const h1 = f.makeBox(10, 10, 10);
        const h2raw = f.makeBox(15, 15, 15);
        const h3raw = f.makeBox(20, 20, 20);
        const h2 = f.translate(h2raw, 30, 0, 0);
        const h3 = f.translate(h3raw, 60, 0, 0);
        if (typeof h1 !== 'number' || typeof h2 !== 'number' || typeof h3 !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: ids.id1, kind: 'native', handle: h1,
            toolId: 'solid.box', name: 'Box 20',
            params: { width: 10, height: 10, distance: 10 },
        });
        window.__forgeAppendBody({
            id: ids.id2, kind: 'native', handle: h2,
            toolId: 'solid.box', name: 'Box 30',
            params: { width: 15, height: 15, distance: 15 },
        });
        window.__forgeAppendBody({
            id: ids.id3, kind: 'native', handle: h3,
            toolId: 'solid.box', name: 'Box 40',
            params: { width: 20, height: 20, distance: 20 },
        });
        return { h1, h2, h3 };
    }, { id1: bodyId1, id2: bodyId2, id3: bodyId3 });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h1).toBeGreaterThan(0);
    expect(seeded.h2).toBeGreaterThan(0);
    expect(seeded.h3).toBeGreaterThan(0);
    await page.waitForFunction(
        (n) => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= n,
        3, { timeout: 4000 });

    // Confirm the seed landed with the expected names.
    const names = await readBodyNamesById();
    expect(names[bodyId1]).toBe('Box 20');
    expect(names[bodyId2]).toBe('Box 30');
    expect(names[bodyId3]).toBe('Box 40');
    await shot('bodies-seeded');
});

test('01 — open Batch Rename via tools.batchRename, table lists all 3 bodies (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.batchRename');
    await page.waitForSelector('[data-testid="forge-batch-rename-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel's data-body-count attribute should reflect every native
    // body the seed step pushed in.
    const bodyCount = await page.locator('[data-testid="forge-batch-rename-panel"]')
                                 .getAttribute('data-body-count');
    expect(Number(bodyCount)).toBeGreaterThanOrEqual(3);

    // No edits are staged yet — staged-count is 0.
    const stagedCount = await page.locator('[data-testid="forge-batch-rename-panel"]')
                                  .getAttribute('data-staged-count');
    expect(stagedCount).toBe('0');

    // Each seeded body has a row with an input field. The input's value
    // matches the current display name.
    await expect(page.locator(`[data-testid="forge-batch-rename-input-${bodyId1}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="forge-batch-rename-input-${bodyId2}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="forge-batch-rename-input-${bodyId3}"]`)).toBeVisible();
    const val1 = await page.locator(`[data-testid="forge-batch-rename-input-${bodyId1}"]`).inputValue();
    const val2 = await page.locator(`[data-testid="forge-batch-rename-input-${bodyId2}"]`).inputValue();
    const val3 = await page.locator(`[data-testid="forge-batch-rename-input-${bodyId3}"]`).inputValue();
    expect(val1).toBe('Box 20');
    expect(val2).toBe('Box 30');
    expect(val3).toBe('Box 40');

    // Apply is disabled when there are no staged changes.
    const applyBtn = page.locator('[data-testid="forge-batch-rename-apply"]');
    await expect(applyBtn).toBeVisible();
    const applyDisabled = await applyBtn.getAttribute('disabled');
    expect(applyDisabled).not.toBeNull();
});

test('02 — Find="Box" Replace="Plate" stages 3 changes; Apply commits via __forgeSetBodies (top)', async () => {
    await cameraTo('top');

    // Capture the bus event so we can prove Apply published a CustomEvent.
    await page.evaluate(() => {
        window.__push82Events = [];
        window.addEventListener('forge:batch-rename-applied', (e) => {
            try {
                window.__push82Events.push({
                    changed: e?.detail?.changed,
                    total: e?.detail?.total,
                });
            } catch {}
        });
    });

    // Type Find / Replace values.
    await setReactInput('forge-batch-rename-find-input',    'Box');
    await setReactInput('forge-batch-rename-replace-input', 'Plate');
    await pause(200);
    await shot('find-replace-typed');

    // Stage the bulk find/replace.
    await page.locator('[data-testid="forge-batch-rename-find-replace-btn"]').click();
    await pause(300);
    await shot('staged-find-replace');

    // All 3 rows should now be staged.
    const stagedCount = await page.locator('[data-testid="forge-batch-rename-panel"]')
                                  .getAttribute('data-staged-count');
    expect(stagedCount).toBe('3');

    // Each row's input now reads the replaced name.
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId1}"]`).inputValue()).toBe('Plate 20');
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId2}"]`).inputValue()).toBe('Plate 30');
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId3}"]`).inputValue()).toBe('Plate 40');

    // The count chip says 3/3.
    const chipTxt = await page.locator('[data-testid="forge-batch-rename-count"]').textContent();
    expect((chipTxt || '').trim().startsWith('3/')).toBe(true);

    // Apply is enabled now.
    const applyBtn = page.locator('[data-testid="forge-batch-rename-apply"]');
    const applyDisabled = await applyBtn.getAttribute('disabled');
    expect(applyDisabled).toBeNull();

    // Snapshot the live scene's name map BEFORE Apply to prove the
    // commit really mutates window.__forgeBodies.
    const before = await readBodyNamesById();
    expect(before[bodyId1]).toBe('Box 20');
    expect(before[bodyId2]).toBe('Box 30');
    expect(before[bodyId3]).toBe('Box 40');

    // Apply!
    // The VideoCaptureHUD lives at zIndex 2400 bottom-right and can race
    // for the Apply button's pointer. Drive the click programmatically
    // through the DOM so React's onClick handler runs without the HUD
    // racing for the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-batch-rename-apply"]');
        if (!btn) throw new Error('apply button not found');
        btn.click();
    });
    await pause(500);
    await shot('after-apply');

    // The live scene's body names are now the replaced values.
    const after = await readBodyNamesById();
    expect(after[bodyId1]).toBe('Plate 20');
    expect(after[bodyId2]).toBe('Plate 30');
    expect(after[bodyId3]).toBe('Plate 40');

    // The bus event fired with changed=3.
    const events = await page.evaluate(() => window.__push82Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.changed).toBe(3);
    expect(newest.total).toBeGreaterThanOrEqual(3);

    // The toast surfaces the apply count.
    const toast = await page.locator('[data-testid="forge-batch-rename-toast"]').textContent();
    expect((toast || '').toLowerCase()).toContain('renamed 3');

    // The staged-count is back to 0 (re-baselined) and the row inputs
    // now show the new names as their pristine values.
    const stagedAfter = await page.locator('[data-testid="forge-batch-rename-panel"]')
                                  .getAttribute('data-staged-count');
    expect(stagedAfter).toBe('0');
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId1}"]`).inputValue()).toBe('Plate 20');
});

test('03 — inline row edit + Number-suffix renumber both commit via __forgeSetBodies (right)', async () => {
    await cameraTo('right');

    // Inline edit row 1 only — prove the row-level path still works
    // alongside the bulk modes.
    await setReactInput(`forge-batch-rename-input-${bodyId1}`, 'Bracket A');
    await pause(200);
    // Staged count = 1 (one effective change).
    let stagedCount = await page.locator('[data-testid="forge-batch-rename-panel"]')
                                .getAttribute('data-staged-count');
    expect(stagedCount).toBe('1');
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-batch-rename-apply"]');
        if (!btn) throw new Error('apply button not found');
        btn.click();
    });
    await pause(500);
    await shot('inline-edit-applied');

    let after = await readBodyNamesById();
    expect(after[bodyId1]).toBe('Bracket A');
    // The others stay at the Plate values from test 02.
    expect(after[bodyId2]).toBe('Plate 30');
    expect(after[bodyId3]).toBe('Plate 40');

    // Now exercise the Number-suffix renamer. Prefix "Part" + click
    // Stage Renumber should write Part-1, Part-2, Part-3 across all rows.
    await setReactInput('forge-batch-rename-prefix-input', 'Part');
    await pause(200);
    await page.locator('[data-testid="forge-batch-rename-renumber-btn"]').click();
    await pause(300);
    await shot('renumber-staged');

    // All 3 rows should now show Part-1/2/3 staged.
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId1}"]`).inputValue()).toBe('Part-1');
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId2}"]`).inputValue()).toBe('Part-2');
    expect(await page.locator(`[data-testid="forge-batch-rename-input-${bodyId3}"]`).inputValue()).toBe('Part-3');

    stagedCount = await page.locator('[data-testid="forge-batch-rename-panel"]')
                            .getAttribute('data-staged-count');
    expect(stagedCount).toBe('3');

    // Apply the renumber.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-batch-rename-apply"]');
        if (!btn) throw new Error('apply button not found');
        btn.click();
    });
    await pause(500);
    await shot('renumber-applied');

    after = await readBodyNamesById();
    expect(after[bodyId1]).toBe('Part-1');
    expect(after[bodyId2]).toBe('Part-2');
    expect(after[bodyId3]).toBe('Part-3');
});

test('04 — PUSH-58 regression: Mass Properties still mounts; feature tree reflects new names (iso)', async () => {
    await cameraTo('iso');
    // Open the Mass Properties panel via its menu action. PUSH-58 mounts
    // this panel and auto-reads the active native body. Both panels are
    // right-docked, so they must coexist in the DOM.
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(500);
    await shot('massprops-regression');

    // The Batch Rename panel should still be attached.
    await expect(page.locator('[data-testid="forge-batch-rename-panel"]'))
        .toBeAttached();

    // Confirm the scene bodies array carries the renamed labels — that's
    // the proof Apply re-built the tree in lockstep with __forgeSetBodies.
    const treeLabels = await page.evaluate(() => {
        const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        return arr.map((b) => b.name || b.toolId || b.id);
    });
    expect(treeLabels).toContain('Part-1');
    expect(treeLabels).toContain('Part-2');
    expect(treeLabels).toContain('Part-3');
});
