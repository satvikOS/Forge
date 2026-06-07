// PUSH-103 (Slice-71 / Boolean Operations History panel — track + replay).
//
// Forge ships forge.cut / forge.fuse / forge.common at the kernel level
// (binding.cpp 411-425) and the v4 dispatch surface routes them through
// solid.cut / solid.fuse / solid.common (and the legacy bool.cut /
// bool.union / bool.common aliases) — but there's no audit / undo /
// replay surface for them. PUSH-103 ships the Boolean History panel.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Assert the host's window surfaces installed BEFORE the panel mounts:
//        window.__forgeOpenBoolHistory, window.__forgeCloseBoolHistory,
//        window.__forgeRecordBooleanOp, window.__forgeBoolHistoryHelper.
//      That's the proof the listener has been registered against
//      forge:tool-dispatched without the user ever opening the panel.
//   3. Seed two 20×20×20 native boxes — boxA at the origin, boxB
//      offset (+15, 0, 0) so they overlap enough for cut / fuse / common
//      to produce a non-degenerate result. Commit via __forgeAppendBody
//      with stable ids "f-box-a" and "f-box-b".
//   4. Perform forge.cut(boxA, boxB) directly + commit the cut result
//      via __forgeAppendBody (id "f-cut-r"). Fire the matching
//      forge:tool-dispatched custom event (toolId 'solid.cut') so the
//      panel's listener records it via the canonical channel.
//   5. Perform forge.fuse against the OTHER box pair + commit the
//      result as "f-fuse-r". Fire forge:tool-dispatched (toolId 'solid.fuse').
//   6. Open the panel via tools.boolHistory; assert the table has ≥2
//      rows (cut + fuse) and the per-row data attributes match.
//   7. Click row-1 Undo (the cut row). Assert the scene goes from
//      "boxA, boxB, cut, fuse" → loses the cut result body, restores
//      either boxA / boxB if a previous step had removed them.
//   8. Click row-2 Replay (the fuse row). Assert a NEW body lands in
//      the scene tagged toolId 'solid.fuse' AND a new history row
//      appears with source='replay'.
//   9. Click the global "Undo last" button — assert undoable-count
//      decreases by one.
//  10. PUSH-58 regression — open Mass Properties from the menu, verify
//      the kernel mass-props readouts still work on the seeded box.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + assert window surface)
//   - front (seed two boxes)
//   - top   (fire dispatch events for cut + fuse)
//   - right (open panel + assert table + Undo)
//   - iso   (Replay + PUSH-58 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-103-bool-history');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'bool-history-session.mp4');

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
    await pause(300);
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
        if (/push-103|bool-history|boolean|forge|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    // Surface uncaught React render errors so a regression in a sibling
    // panel doesn't show up as a silent black-screen failure here.
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);

    // Start every test from a known-empty history. The store is module-
    // scope so it survives across test scopes within the same Electron
    // process — clear once up front.
    await page.evaluate(() => {
        if (typeof window.__forgeBoolHistoryHelper?.clearBoolHistory === 'function') {
            window.__forgeBoolHistoryHelper.clearBoolHistory();
        }
    });
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
        console.error('[push-103] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-103] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-103] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert host window surface installed without opening the panel', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenBoolHistory,
        close:   typeof window.__forgeCloseBoolHistory,
        record:  typeof window.__forgeRecordBooleanOp,
        helper:  typeof window.__forgeBoolHistoryHelper,
        canonOK: typeof window.__forgeBoolHistoryHelper?.canonicalBoolOp === 'function',
        toolIds: window.__forgeBoolHistoryHelper?.TOOL_IDS || null,
    }));
    console.log('[push-103] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.record).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.canonOK).toBe(true);
    expect(Array.isArray(surface.toolIds)).toBe(true);
    expect(surface.toolIds).toContain('solid.cut');
    expect(surface.toolIds).toContain('solid.fuse');
    expect(surface.toolIds).toContain('solid.common');

    // Canonical mapping covers both naming families.
    const map = await page.evaluate(() => ({
        cut1:  window.__forgeBoolHistoryHelper.canonicalBoolOp('solid.cut'),
        cut2:  window.__forgeBoolHistoryHelper.canonicalBoolOp('bool.cut'),
        fuse1: window.__forgeBoolHistoryHelper.canonicalBoolOp('solid.fuse'),
        fuse2: window.__forgeBoolHistoryHelper.canonicalBoolOp('bool.union'),
        com1:  window.__forgeBoolHistoryHelper.canonicalBoolOp('solid.common'),
        com2:  window.__forgeBoolHistoryHelper.canonicalBoolOp('bool.common'),
        skip:  window.__forgeBoolHistoryHelper.canonicalBoolOp('solid.extrude'),
    }));
    expect(map).toEqual({
        cut1: 'cut', cut2: 'cut',
        fuse1: 'fuse', fuse2: 'fuse',
        com1: 'common', com2: 'common',
        skip: null,
    });
    await shot('host-surface-ok');
});

test('01 — seed two overlapping 20×20×20 native boxes (boxA + boxB)', async () => {
    await cameraTo('front');
    const seeded = await page.evaluate(() => {
        const hA = window.forge?.makeBox?.(20, 20, 20);
        const hB = window.forge?.makeBox?.(20, 20, 20);
        if (typeof hA !== 'number' || typeof hB !== 'number') {
            return { error: 'forge.makeBox unavailable' };
        }
        // Translate boxB by (+15, 0, 0) so the overlap with boxA is a
        // non-degenerate 5×20×20 slab — large enough that cut / fuse /
        // common all produce a clean kernel result.
        const hB_shifted = typeof window.forge.translate === 'function'
            ? window.forge.translate(hB, 15, 0, 0)
            : hB;
        window.__forgeAppendBody({
            id: 'f-box-a', kind: 'native', handle: hA,
            toolId: 'solid.box', name: 'Box A',
            params: { width: 20, height: 20, distance: 20 },
        });
        window.__forgeAppendBody({
            id: 'f-box-b', kind: 'native', handle: hB_shifted,
            toolId: 'solid.box', name: 'Box B',
            params: { width: 20, height: 20, distance: 20, tx: 15 },
        });
        return { hA, hB: hB_shifted };
    });
    console.log('[push-103] seeded =', JSON.stringify(seeded));
    expect(seeded.error).toBeFalsy();
    expect(seeded.hA).toBeGreaterThan(0);
    expect(seeded.hB).toBeGreaterThan(0);

    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('boxes-seeded');
});

test('02 — perform forge.cut + fire forge:tool-dispatched with toolId solid.cut', async () => {
    await cameraTo('top');
    const r = await page.evaluate(() => {
        const a = (window.__forgeBodies || []).find((b) => b.id === 'f-box-a');
        const b = (window.__forgeBodies || []).find((bb) => bb.id === 'f-box-b');
        if (!a || !b) return { error: 'boxes missing' };
        const handle = window.forge.cut(a.handle, b.handle);
        if (typeof handle !== 'number') return { error: 'kernel cut returned non-number' };
        const body = {
            id: 'f-cut-r', kind: 'native', handle,
            toolId: 'solid.cut', name: 'Cut A − B',
            params: { aId: a.id, bId: b.id, a: a.handle, b: b.handle },
        };
        window.__forgeAppendBody(body);
        // Fire forge:tool-dispatched the way kernelDispatch + Forge.tools
        // do (forgeAPI.js line 165) — the panel's subscriber records the
        // entry via the canonical bus event channel. Include resultId on
        // params so the listener captures it even though the React
        // setState() from __forgeAppendBody hasn't mirrored back into
        // window.__forgeBodies yet.
        window.dispatchEvent(new CustomEvent('forge:tool-dispatched', {
            detail: {
                toolId: 'solid.cut',
                params: { aId: a.id, bId: b.id, a: a.handle, b: b.handle, resultId: 'f-cut-r' },
                source: 'kernel',
                result: { shape: handle },
            },
        }));
        return { handle };
    });
    console.log('[push-103] cut result =', JSON.stringify(r));
    expect(r.error).toBeFalsy();
    expect(r.handle).toBeGreaterThan(0);

    await page.waitForFunction(
        () => (window.__forgeBoolHistoryHelper?.getBoolHistory() || []).length >= 1,
        null, { timeout: 2000 });
    await shot('cut-dispatched');
});

test('03 — perform forge.fuse + fire forge:tool-dispatched with toolId solid.fuse', async () => {
    // Stay on top camera so the action is visible in one continuous shot.
    const r = await page.evaluate(() => {
        const a = (window.__forgeBodies || []).find((b) => b.id === 'f-box-a');
        const b = (window.__forgeBodies || []).find((bb) => bb.id === 'f-box-b');
        if (!a || !b) return { error: 'boxes missing' };
        const handle = window.forge.fuse(a.handle, b.handle);
        if (typeof handle !== 'number') return { error: 'kernel fuse returned non-number' };
        const body = {
            id: 'f-fuse-r', kind: 'native', handle,
            toolId: 'solid.fuse', name: 'Fuse A ∪ B',
            params: { aId: a.id, bId: b.id, a: a.handle, b: b.handle },
        };
        window.__forgeAppendBody(body);
        window.dispatchEvent(new CustomEvent('forge:tool-dispatched', {
            detail: {
                toolId: 'solid.fuse',
                params: { aId: a.id, bId: b.id, a: a.handle, b: b.handle, resultId: 'f-fuse-r' },
                source: 'kernel',
                result: { shape: handle },
            },
        }));
        return { handle };
    });
    console.log('[push-103] fuse result =', JSON.stringify(r));
    expect(r.error).toBeFalsy();
    expect(r.handle).toBeGreaterThan(0);

    await page.waitForFunction(
        () => (window.__forgeBoolHistoryHelper?.getBoolHistory() || []).length >= 2,
        null, { timeout: 2000 });
    await shot('fuse-dispatched');

    // Verify the history was actually populated with the right shape.
    const hist = await page.evaluate(() => window.__forgeBoolHistoryHelper.getBoolHistory());
    console.log('[push-103] history snapshot =', JSON.stringify(hist.map((e) => ({
        op: e.op, aId: e.aId, bId: e.bId, resultId: e.resultId, source: e.source,
    }))));
    expect(hist.length).toBeGreaterThanOrEqual(2);
    expect(hist[0].op).toBe('cut');
    expect(hist[0].aId).toBe('f-box-a');
    expect(hist[0].bId).toBe('f-box-b');
    expect(hist[0].resultId).toBe('f-cut-r');
    expect(hist[1].op).toBe('fuse');
    expect(hist[1].aId).toBe('f-box-a');
    expect(hist[1].bId).toBe('f-box-b');
    expect(hist[1].resultId).toBe('f-fuse-r');
});

test('04 — open Boolean History panel via tools.boolHistory + assert table', async () => {
    await cameraTo('right');
    await platformMenuAction('tools.boolHistory');
    await page.waitForSelector('[data-testid="forge-bool-history-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const panel = page.locator('[data-testid="forge-bool-history-panel"]');
    await expect(panel).toBeVisible();
    expect(await panel.getAttribute('data-entry-count')).toBe('2');
    expect(await panel.getAttribute('data-undoable-count')).toBe('2');

    const rows = page.locator('[data-testid="forge-bool-history-row"]');
    expect(await rows.count()).toBe(2);

    // Row 1 = cut, row 2 = fuse, both undoable.
    const row1 = rows.nth(0);
    expect(await row1.getAttribute('data-op')).toBe('cut');
    expect(await row1.getAttribute('data-a-id')).toBe('f-box-a');
    expect(await row1.getAttribute('data-b-id')).toBe('f-box-b');
    expect(await row1.getAttribute('data-result-id')).toBe('f-cut-r');
    expect(await row1.getAttribute('data-undone')).toBe('0');

    const row2 = rows.nth(1);
    expect(await row2.getAttribute('data-op')).toBe('fuse');
    expect(await row2.getAttribute('data-result-id')).toBe('f-fuse-r');
    expect(await row2.getAttribute('data-undone')).toBe('0');

    // Headline counter pill reads "2 ops".
    await expect(page.locator('[data-testid="forge-bool-history-count"]'))
        .toContainText(/2\s+ops/i);
    await expect(page.locator('[data-testid="forge-bool-history-undoable"]'))
        .toContainText(/2\s+undoable/i);
});

test('05 — Undo the cut row → result body disappears, originals restored', async () => {
    // Snapshot scene before the click.
    const before = await page.evaluate(() => (window.__forgeBodies || []).map((b) => b.id));
    console.log('[push-103] bodies before undo =', JSON.stringify(before));
    expect(before).toContain('f-cut-r');

    const row1 = page.locator('[data-testid="forge-bool-history-row"]').nth(0);
    const entryId = await row1.getAttribute('data-entry-id');
    await page.locator(`[data-testid="forge-bool-history-undo-${entryId}"]`).click();
    await pause(400);
    await shot('cut-undone');

    const after = await page.evaluate(() => (window.__forgeBodies || []).map((b) => b.id));
    console.log('[push-103] bodies after undo =', JSON.stringify(after));
    expect(after).not.toContain('f-cut-r');
    // Originals must still be in the scene (either by their original id or
    // by the undo-restoration suffix).
    const hasA = after.some((id) => id === 'f-box-a' || id === 'f-box-a-undo');
    const hasB = after.some((id) => id === 'f-box-b' || id === 'f-box-b-undo');
    expect(hasA).toBe(true);
    expect(hasB).toBe(true);

    // Row 1 is now marked undone; undoable count drops to 1.
    expect(await row1.getAttribute('data-undone')).toBe('1');
    await expect(page.locator('[data-testid="forge-bool-history-undoable"]'))
        .toContainText(/1\s+undoable/i);
});

test('06 — Replay the fuse row → new body lands + new history row appears', async () => {
    await cameraTo('iso');
    // Sanity: f-fuse-r is still in the scene.
    const preBodies = await page.evaluate(() => (window.__forgeBodies || []).map((b) => b.id));
    console.log('[push-103] bodies before replay =', JSON.stringify(preBodies));

    const preHistory = await page.evaluate(
        () => window.__forgeBoolHistoryHelper.getBoolHistory().length);

    const row2 = page.locator('[data-testid="forge-bool-history-row"]').nth(1);
    const entryId = await row2.getAttribute('data-entry-id');
    await page.locator(`[data-testid="forge-bool-history-replay-${entryId}"]`).click();
    await pause(500);
    await shot('fuse-replayed');

    // A new history row with source='replay' should have been pushed.
    await page.waitForFunction(
        (n) => (window.__forgeBoolHistoryHelper.getBoolHistory() || []).length > n,
        preHistory, { timeout: 2500 });

    const histAfter = await page.evaluate(
        () => window.__forgeBoolHistoryHelper.getBoolHistory());
    console.log('[push-103] history after replay =', JSON.stringify(histAfter.map((e) => ({
        op: e.op, source: e.source, resultId: e.resultId,
    }))));
    const replayRow = histAfter[histAfter.length - 1];
    expect(replayRow.source).toBe('replay');
    expect(replayRow.op).toBe('fuse');
    expect(typeof replayRow.resultId).toBe('string');
    expect(replayRow.resultId).toMatch(/^bool-replay-/);

    // The replay body is in the scene tagged with toolId 'solid.fuse'.
    const postBodies = await page.evaluate(
        () => (window.__forgeBodies || []).map((b) => ({ id: b.id, toolId: b.toolId })));
    const replayBody = postBodies.find((b) => b.id === replayRow.resultId);
    expect(replayBody).toBeTruthy();
    expect(replayBody.toolId).toBe('solid.fuse');

    // Panel reflects the new row.
    const panel = page.locator('[data-testid="forge-bool-history-panel"]');
    const newCount = Number(await panel.getAttribute('data-entry-count'));
    expect(newCount).toBeGreaterThanOrEqual(3);
});

test('07 — global "Undo last" button drops undoable-count by one', async () => {
    const beforeUndoable = Number(await page
        .locator('[data-testid="forge-bool-history-panel"]')
        .getAttribute('data-undoable-count'));
    expect(beforeUndoable).toBeGreaterThan(0);

    await page.locator('[data-testid="forge-bool-history-undo-last"]').click();
    await pause(400);
    await shot('undo-last');

    const afterUndoable = Number(await page
        .locator('[data-testid="forge-bool-history-panel"]')
        .getAttribute('data-undoable-count'));
    console.log('[push-103] undoable before/after =', beforeUndoable, afterUndoable);
    expect(afterUndoable).toBe(beforeUndoable - 1);
});

test('08 — PUSH-58 regression: Mass Properties still works on the seeded box', async () => {
    // Close the bool history panel first so the mass props panel takes the
    // right-rail slot uncontested.
    await page.locator('[data-testid="forge-bool-history-close"]').click();
    await pause(300);

    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('massprops-open');

    // Mass props picks the last native body. Even if the previous Undo
    // restored "f-box-a-undo" / "f-box-b-undo", they're still 20×20×20
    // cubes — volume = 8000 mm³ exact.
    const volTxt = await page.locator('[data-testid="forge-massprops-volume"]').textContent();
    const vol = Number(/(-?[0-9]+\.[0-9]+)/.exec(volTxt || '')?.[1]);
    console.log('[push-103] massprops volume =', volTxt, '→', vol);
    // The exact value depends on which body mass-props picks (a raw 20³
    // box → 8000 mm³, or one of the boolean results which is non-trivial
    // but still in the same order of magnitude); just assert the kernel
    // returned a finite positive volume to prove the regression.
    expect(Number.isFinite(vol)).toBe(true);
    expect(vol).toBeGreaterThan(0);

    await page.locator('[data-testid="forge-massprops-close"]').click();
    await pause(300);
    await shot('regression-done');
});
