// PUSH-73 (Slice-41 / Activity Log panel — bus event stream).
//
// Up through PUSH-72 there was no aggregated view of the forge:* bus.
// Each panel listened for the slice of the bus it cared about, and the
// only way to debug "what fired when?" was to open devtools and grep
// `window.dispatchEvent` call sites. PUSH-73 lights up an Activity Log
// dock that:
//   • Captures EVERY forge:* CustomEvent through a single window-level
//     capture-phase listener installed at host mount time.
//   • Holds the last 500 entries in a ring buffer, newest at the top.
//   • Each entry stores { id, ts, name, detail-truncated-to-100-chars }.
//   • Filter by event name OR detail (case-insensitive substring).
//   • Clear button drops the ring buffer back to empty.
//   • Export to .json via forge.dialog.saveFile + writeBlob (optional).
//   • Reachable through the standard `tools.activityLog` menu action.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Assert the global ring buffer surface (window.__forgeActivityLogRead)
//      is installed by the host effect on mount — that's the proof the
//      bus capture is running even before the panel is opened.
//   3. Open the Activity Log panel via tools.activityLog menu action.
//      Panel mounts; the ready-seed entry is visible; counts pill is sane.
//   4. Trigger a sequence of synthetic forge:* events:
//        • forge:menu-action with detail { id: 'view.iso' }
//        • forge:body-added with a body-spec detail
//        • forge:selection-changed with a selection detail
//      Assert each one shows up in the visible list as a row with the
//      correct event name, and the buffer count is monotonically rising.
//   5. Trigger the canonical real-world path too: a real menu-action via
//      the bus + a real __forgeAppendBody (the same path push-65 uses to
//      seed bodies). Assert the entries are recorded.
//   6. Filter by a substring of an event name (e.g. "body-added") and
//      assert the visible rows are reduced to only matching entries; the
//      total count is unchanged but the visible count is filtered.
//   7. Clear filter, click Clear button; assert buffer drops to empty
//      (the seed entry is gone; subsequent events refill it).
//   8. PUSH-65 regression: open Section Plane via tools.sectionPlane and
//      assert its panel still mounts — Activity Log is a portal sibling
//      and must not collide with other right-docked panels.
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + assert mount + global surface)
//   - front (open panel + verify mount)
//   - top   (trigger synthetic events + assert visible rows)
//   - right (real menu-action + real __forgeAppendBody + filter)
//   - iso   (clear + push-65 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-73-activity-log');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'activity-log-session.mp4');

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
        if (/push-73|activityLog|ActivityLog|forge:activity-log|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen overlay; flip the
    // seen flag so it stays dormant for the whole run, then explicitly
    // skip if it raced in.
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
        console.error('[push-73] no .webm');
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
                console.log(`[push-73] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-73] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global ring buffer surface installed + capture active', async () => {
    await cameraTo('iso');
    await shot('boot');
    // The host effect installs window.__forgeActivityLogRead + Record + Clear
    // even before the panel opens — that's the proof the capture is hot.
    await page.waitForFunction(
        () => typeof window.__forgeActivityLogRead === 'function'
           && typeof window.__forgeActivityLogRecord === 'function'
           && typeof window.__forgeActivityLogClear === 'function'
           && typeof window.__forgeOpenActivityLog === 'function',
        null, { timeout: 8000 });
    // The capture install flag is also published — that's the idempotency
    // guard, and an extra signal for diagnostics.
    const flagSet = await page.evaluate(() => !!window.__forgeActivityLogInstalled_v1);
    expect(flagSet).toBe(true);
    // The buffer has the ready-seed entry at minimum.
    const initial = await page.evaluate(() => window.__forgeActivityLogRead());
    expect(Array.isArray(initial)).toBe(true);
    expect(initial.length).toBeGreaterThan(0);
    // The seed entry's name is the canonical ready marker.
    const seedNames = initial.map((e) => e.name);
    expect(seedNames).toContain('forge:activity-log-ready');
    // Each entry has the contract shape: id (number), ts (number), name
    // (string), detail (string, possibly empty).
    for (const e of initial) {
        expect(typeof e.id).toBe('number');
        expect(typeof e.ts).toBe('number');
        expect(typeof e.name).toBe('string');
        expect(typeof e.detail).toBe('string');
    }
});

test('01 — open Activity Log via tools.activityLog menu action', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.activityLog');
    await page.waitForSelector('[data-testid="forge-activity-log-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel publishes its current entry count + visible count on
    // data-* attributes. Both must be parseable ints, and visible should
    // equal total when the filter is empty (which it is on first open).
    const entryCount   = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    const visibleCount = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-visible-count'));
    expect(Number.isFinite(entryCount)).toBe(true);
    expect(Number.isFinite(visibleCount)).toBe(true);
    expect(entryCount).toBeGreaterThan(0);
    expect(visibleCount).toBe(entryCount);

    // The seed entry's row is in the list — find by event-name attribute.
    const seedRow = page.locator(
        '[data-testid="forge-activity-log-list"] '
        + '[data-event-name="forge:activity-log-ready"]');
    expect(await seedRow.count()).toBeGreaterThan(0);
});

test('02 — synthetic forge:* events appear in the list, newest at top', async () => {
    await cameraTo('top');

    // Pre-trigger snapshot of the buffer count.
    const beforeTotal = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));

    // Fire three distinct events. We use dispatchEvent so the named
    // capture-phase listener installed by the host fires directly — this
    // is the "kernel + UI events" path the spec calls out.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
            { detail: { id: 'view.iso' } }));
        window.dispatchEvent(new CustomEvent('forge:body-added',
            { detail: { id: 'synthetic-body-73', kind: 'native',
                        handle: 12345, toolId: 'solid.box',
                        name: 'Synthetic Body 73' } }));
        window.dispatchEvent(new CustomEvent('forge:selection-changed',
            { detail: { selection: { bodyHandle: 12345,
                                     bodyId: 'synthetic-body-73' } } }));
    });
    await pause(400);
    await shot('three-events-logged');

    // The buffer should have grown by at least 3.
    const afterTotal = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    console.log('[push-73] entry count', beforeTotal, '→', afterTotal);
    expect(afterTotal).toBeGreaterThanOrEqual(beforeTotal + 3);

    // The three event names should be present in the visible list. We
    // grep the rendered list (not the JS buffer) to prove the panel is
    // actually rendering what the buffer holds.
    const list = page.locator('[data-testid="forge-activity-log-list"]');
    const menuRow = list.locator('[data-event-name="forge:menu-action"]');
    const bodyRow = list.locator('[data-event-name="forge:body-added"]');
    const selRow  = list.locator('[data-event-name="forge:selection-changed"]');
    expect(await menuRow.count()).toBeGreaterThan(0);
    expect(await bodyRow.count()).toBeGreaterThan(0);
    expect(await selRow.count()).toBeGreaterThan(0);

    // The body-added detail row should carry the truncated JSON of the
    // detail object. The synthetic body id ("synthetic-body-73") is
    // distinctive enough to confirm the detail was captured, and it sits
    // at the start of the JSON so it survives the 100-char truncation
    // regardless of how many other keys we pile on.
    const bodyRowFirst = bodyRow.first();
    const bodyEntryId  = await bodyRowFirst.getAttribute('data-entry-id');
    expect(bodyEntryId).toMatch(/^\d+$/);
    const bodyDetail = await page.locator(
        `[data-testid="forge-activity-log-detail-${bodyEntryId}"]`).textContent();
    expect(bodyDetail || '').toContain('synthetic-body-73');
    // Detail must be ≤100 chars (the spec's truncation limit). When the
    // source JSON overflows we replace the last char with '…', so the
    // visible string lands at exactly 100 chars including the ellipsis.
    const detailLen = Number(await page.locator(
        `[data-testid="forge-activity-log-detail-${bodyEntryId}"]`)
        .getAttribute('data-detail-len'));
    expect(Number.isFinite(detailLen)).toBe(true);
    expect(detailLen).toBeLessThanOrEqual(100);

    // Newest-at-top contract: the first row in the list should have an
    // entry-id greater than all subsequent rows' entry-ids. We grab the
    // first two rows and check the relation.
    const firstRow  = list.locator('[data-entry-id]').first();
    const secondRow = list.locator('[data-entry-id]').nth(1);
    const firstId   = Number(await firstRow.getAttribute('data-entry-id'));
    const secondId  = Number(await secondRow.getAttribute('data-entry-id'));
    expect(Number.isFinite(firstId)).toBe(true);
    expect(Number.isFinite(secondId)).toBe(true);
    expect(firstId).toBeGreaterThan(secondId);
});

test('03 — real-world: menu action via bus + __forgeAppendBody both logged + filter narrows visible rows', async () => {
    await cameraTo('right');

    // The canonical app paths the user actually walks. Both should be
    // captured by the bus listener — menu-action because it's a real bus
    // event, body-added because we dispatch it explicitly after the
    // append (the shell's __forgeAppendBody doesn't auto-emit; the real
    // emitters live in workbenches / drag-drop / Forge.scene.addBody).
    const beforeTotal = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    await page.evaluate(() => {
        // Step 1: real menu-action bus event.
        window.dispatchEvent(new CustomEvent('forge:menu-action',
            { detail: { id: 'view.shaded' } }));
        // Step 2: append a real synthesised body record AND fire the
        // body-added event, exactly the pattern Forge.scene.addBody uses.
        const body = {
            id: 'push-73-real-body', kind: 'synthetic',
            toolId: 'solid.box',
            name: 'Push-73 Real Body',
            params: { width: 10, height: 10, distance: 10 },
        };
        if (typeof window.__forgeAppendBody === 'function') {
            window.__forgeAppendBody(body);
        }
        window.dispatchEvent(new CustomEvent('forge:body-added',
            { detail: body }));
    });
    await pause(400);
    await shot('real-world-events');

    const afterTotal = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    expect(afterTotal).toBeGreaterThanOrEqual(beforeTotal + 2);

    // Filter: type "body-added" into the filter input. The visible count
    // should drop below the total, all visible rows should carry the
    // body-added event name, and the total count should NOT change.
    const filterInput = page.locator('[data-testid="forge-activity-log-filter"]');
    await filterInput.fill('body-added');
    await pause(300);
    await shot('filtered-body-added');

    const filteredVisible = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-visible-count'));
    const filteredTotal = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    expect(filteredTotal).toBe(afterTotal); // unchanged by filtering
    expect(filteredVisible).toBeLessThan(filteredTotal);
    expect(filteredVisible).toBeGreaterThan(0);

    // Every visible row must carry body-added (the substring filter).
    const visibleRows = page.locator(
        '[data-testid="forge-activity-log-list"] [data-event-name]');
    const visCount = await visibleRows.count();
    expect(visCount).toBeGreaterThan(0);
    for (let i = 0; i < visCount; i += 1) {
        const n = await visibleRows.nth(i).getAttribute('data-event-name');
        expect((n || '').toLowerCase()).toContain('body-added');
    }

    // Filter that doesn't match anything yields the empty-state hint.
    await filterInput.fill('zzz-no-such-event-zzz');
    await pause(250);
    const empty = page.locator('[data-testid="forge-activity-log-empty"]');
    await expect(empty).toBeVisible();
    const emptyTxt = await empty.textContent();
    expect((emptyTxt || '').toLowerCase()).toContain('no entries match');

    // Reset filter for the next test.
    await filterInput.fill('');
    await pause(200);
});

test('04 — Clear button empties the buffer + push-65 regression', async () => {
    await cameraTo('iso');

    // Click Clear. After the click the data-entry-count should drop to
    // either 0 or a small number (a new event might race in between the
    // setState and the read — but our click should at minimum drop us
    // below the previous count).
    const beforeClear = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    expect(beforeClear).toBeGreaterThan(0);

    await page.locator('[data-testid="forge-activity-log-clear"]').click();
    await pause(300);
    await shot('after-clear');

    const afterClear = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    expect(afterClear).toBeLessThan(beforeClear);
    // After a clear with no subsequent events fired, the count should be 0.
    expect(afterClear).toBe(0);

    // Empty list hint is visible (filter is empty).
    const empty = page.locator('[data-testid="forge-activity-log-empty"]');
    await expect(empty).toBeVisible();
    const emptyTxt = await empty.textContent();
    expect((emptyTxt || '').toLowerCase()).toContain('no events captured');

    // Fire one more event to confirm the capture is still hot post-clear.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
            { detail: { id: 'view.front', source: 'post-clear' } }));
    });
    await pause(300);
    const afterRecapture = Number(
        await page.locator('[data-testid="forge-activity-log-panel"]')
                  .getAttribute('data-entry-count'));
    expect(afterRecapture).toBeGreaterThan(0);

    // PUSH-65 regression: opening the Section Plane panel via tools.sectionPlane
    // must still work — the Activity Log host is a portal sibling and must
    // not collide with other right-docked panels.
    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });
    // Activity Log must still be visible alongside Section Plane.
    const logVisible = await page.locator(
        '[data-testid="forge-activity-log-panel"]').isVisible();
    expect(logVisible).toBe(true);

    // Sanity: triggering the tools.sectionPlane menu-action above ALSO
    // got logged into the activity buffer (it's a forge:menu-action event
    // — exactly what we're trying to capture). Find its row.
    const list = page.locator('[data-testid="forge-activity-log-list"]');
    const menuRows = list.locator('[data-event-name="forge:menu-action"]');
    expect(await menuRows.count()).toBeGreaterThan(0);

    await shot('section-plane-coexists');
});
