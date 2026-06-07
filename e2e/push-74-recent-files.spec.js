// PUSH-74 (Slice-42 / Recent Files panel — last 20 paths opened via
// File > Open).
//
// Up through PUSH-73 the File menu shipped Open / Save / Save As / Open
// Project / Save Project plus four Import slots (STEP / IGES / BREP /
// STL), but nothing tracked WHICH files had been opened. PUSH-74 lights
// up a Recent Files dock that:
//   • Subscribes to the global `forge:file-opened` window event.
//   • Keeps the last 20 entries (newest at top), each as
//     { id, path, name, kind, ts, pinned }.
//   • Renders rows with filename, full path, timestamp, kind chip,
//     Open button, Pin button, Remove button.
//   • Open button dispatches `forge:menu-action` with
//     { id: 'file.openProject', path, ... } so the existing File >
//     Open Project handler picks up the path.
//   • Persists to localStorage `forge.v4.recentFiles`.
//   • Mirrors live snapshot onto `window.__forgeRecentFiles`.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner. Confirm the host
//      installed `window.__forgeRecentFilesInstalled_v1` + the
//      imperative entry points.
//   2. Fire 3 distinct forge:file-opened events:
//        • {path: '/tmp/forge/projA.forge', kind: 'project'}
//        • {path: '/tmp/forge/partB.step',  kind: 'step'}
//        • {path: '/tmp/forge/meshC.stl',   kind: 'stl'}
//      Assert window.__forgeRecentFiles grew to 3, persisted to
//      localStorage 'forge.v4.recentFiles'.
//   3. Open the Recent Files panel via the `file.recent` menu action.
//      Assert the panel mounts, 3 rows visible, newest at top.
//      Assert the filename + path + kind chip render for each row.
//   4. Click the Open button on the projA.forge row. Confirm a new
//      forge:menu-action fires with id 'file.openProject' + the path
//      attached, and that the row bubbles back to the top of the list
//      with a fresh timestamp.
//   5. Pin one of the rows. Clear the list. Confirm pinned entry
//      survives, the others got dropped.
//   6. Filter by 'partB'. Assert visible count drops to (zero with
//      pinned projA = 0 if pinned projA didn't match), or 1 if partB
//      is back in the list (we'll re-seed partB to test this path).
//   7. PUSH-67 regression: open Measure via tools.measure menu action
//      and assert its panel mounts — Recent Files is a portal sibling
//      and must not collide with other right-docked panels.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + imperative-surface install confirmed)
//   - front (3 forge:file-opened events + mirror + localStorage assert)
//   - top   (open panel via file.recent + 3-row assert)
//   - right (Open button click + re-open dispatch + pin + clear)
//   - iso   (filter + push-67 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-74-recent-files');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'recent-files-session.mp4');

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
        if (/push-74|recent|RecentFiles|forge:file-opened|error|Error/i.test(t)) {
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
    // flag so it stays dormant for the whole run, then explicitly skip
    // if it raced in.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        // Pre-clear the recent files key so the test is deterministic.
        // Any leftover from a prior run would skew the row counts.
        try { window.localStorage.removeItem('forge.v4.recentFiles'); } catch {}
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
        console.error('[push-74] no .webm');
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
                console.log(`[push-74] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-74] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + imperative recent-files surface installed', async () => {
    await cameraTo('iso');
    await shot('boot');
    // The host effect installs the imperative entry points + the
    // install flag synchronously on first render, well before any user
    // event has fired.
    await page.waitForFunction(
        () => typeof window.__forgeOpenRecentFiles    === 'function'
           && typeof window.__forgeCloseRecentFiles   === 'function'
           && typeof window.__forgeRecentFilesRecord  === 'function'
           && typeof window.__forgeRecentFilesClear   === 'function'
           && typeof window.__forgeRecentFilesRead    === 'function'
           && window.__forgeRecentFilesInstalled_v1 === true,
        null, { timeout: 8000 });
    // The mirror array exists at first render too — empty because we
    // cleared localStorage in beforeAll.
    const initial = await page.evaluate(() => window.__forgeRecentFilesRead());
    expect(Array.isArray(initial)).toBe(true);
    expect(initial.length).toBe(0);
});

test('01 — fire 3 forge:file-opened events + assert mirror + localStorage', async () => {
    await cameraTo('front');
    await page.evaluate(() => {
        // Three distinct paths, three distinct kinds — the panel will
        // assign a kind chip per row from the inferred extension when
        // the dispatcher omits `kind`. We supply `kind` explicitly here
        // to also exercise the explicit-kind path.
        window.dispatchEvent(new CustomEvent('forge:file-opened', {
            detail: { path: '/tmp/forge/projA.forge', name: 'projA.forge',
                      kind: 'project', ts: Date.now() },
        }));
        window.dispatchEvent(new CustomEvent('forge:file-opened', {
            detail: { path: '/tmp/forge/partB.step', name: 'partB.step',
                      kind: 'step', ts: Date.now() + 1 },
        }));
        window.dispatchEvent(new CustomEvent('forge:file-opened', {
            detail: { path: '/tmp/forge/meshC.stl', name: 'meshC.stl',
                      kind: 'stl', ts: Date.now() + 2 },
        }));
    });
    await pause(400);

    // The mirror array must reflect all 3.
    const mirror = await page.evaluate(() => window.__forgeRecentFilesRead());
    expect(Array.isArray(mirror)).toBe(true);
    expect(mirror.length).toBe(3);
    const paths = mirror.map((e) => e.path).sort();
    expect(paths).toEqual([
        '/tmp/forge/meshC.stl',
        '/tmp/forge/partB.step',
        '/tmp/forge/projA.forge',
    ]);

    // localStorage round-trip must match the mirror.
    const stored = await page.evaluate(() => {
        try { return JSON.parse(window.localStorage.getItem('forge.v4.recentFiles')); }
        catch { return null; }
    });
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBe(3);
    const storedPaths = stored.map((e) => e.path).sort();
    expect(storedPaths).toEqual(paths);

    // Newest-at-top contract: meshC was the *last* event fired, so it
    // must sit at index 0 in the mirror array.
    expect(mirror[0].path).toBe('/tmp/forge/meshC.stl');
    expect(mirror[1].path).toBe('/tmp/forge/partB.step');
    expect(mirror[2].path).toBe('/tmp/forge/projA.forge');
});

test('02 — open Recent Files panel via file.recent menu action; 3 rows visible', async () => {
    await cameraTo('top');
    await platformMenuAction('file.recent');
    await page.waitForSelector('[data-testid="forge-recent-files-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel exposes total + visible count on data-* attributes.
    const entryCount   = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-entry-count'));
    const visibleCount = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-visible-count'));
    expect(entryCount).toBe(3);
    expect(visibleCount).toBe(3);

    // Each of the 3 paths has a row in the list with a kind chip + path
    // sub-row + Open button.
    const list = page.locator('[data-testid="forge-recent-files-list"]');
    const rows = list.locator('[data-entry-id]');
    const visRowCount = await rows.count();
    expect(visRowCount).toBe(3);

    // Map row data-entry-path -> chip / Open button visibility.
    for (let i = 0; i < visRowCount; i += 1) {
        const row = rows.nth(i);
        const rowPath = await row.getAttribute('data-entry-path');
        const rowKind = await row.getAttribute('data-entry-kind');
        const rowName = await row.getAttribute('data-entry-name');
        expect(rowPath).toBeTruthy();
        expect(rowKind).toBeTruthy();
        expect(rowName).toBeTruthy();
        const id = await row.getAttribute('data-entry-id');
        // Chip + Open + Pin + Remove + Path + Meta all carry the entry id.
        await expect(page.locator(`[data-testid="forge-recent-files-chip-${id}"]`))   .toBeVisible();
        await expect(page.locator(`[data-testid="forge-recent-files-open-${id}"]`))   .toBeVisible();
        await expect(page.locator(`[data-testid="forge-recent-files-pin-${id}"]`))    .toBeVisible();
        await expect(page.locator(`[data-testid="forge-recent-files-remove-${id}"]`)) .toBeVisible();
        await expect(page.locator(`[data-testid="forge-recent-files-path-${id}"]`))   .toBeVisible();
        // Path sub-row text should equal the data-entry-path attribute.
        const pathText = await page.locator(
            `[data-testid="forge-recent-files-path-${id}"]`).textContent();
        expect((pathText || '').trim()).toBe(rowPath);
    }

    // First (newest) row must be meshC — that was the last forge:file-opened
    // event fired in test 01.
    const firstRowPath = await rows.first().getAttribute('data-entry-path');
    expect(firstRowPath).toBe('/tmp/forge/meshC.stl');
});

test('03 — click Open re-dispatches forge:menu-action + bubbles row to top', async () => {
    await cameraTo('right');

    // Install a synthetic listener on forge:menu-action that captures
    // the most recent dispatch (we want the Open button's emitted
    // action to be observable from the test).
    await page.evaluate(() => {
        window.__push74LastMenuAction = null;
        window.__push74OnMenuAction = (e) => {
            if (e?.detail?.source === 'recent-files') {
                window.__push74LastMenuAction = {
                    id: e.detail.id,
                    path: e.detail.path,
                    name: e.detail.name,
                    kind: e.detail.kind,
                    source: e.detail.source,
                };
            }
        };
        window.addEventListener('forge:menu-action', window.__push74OnMenuAction);
    });

    // Find the projA.forge row's Open button and click it. projA was
    // the *first* event fired, so it sits at index 2 (third row) in the
    // newest-at-top list.
    const list = page.locator('[data-testid="forge-recent-files-list"]');
    const projARow = list.locator('[data-entry-path="/tmp/forge/projA.forge"]').first();
    const projAId  = await projARow.getAttribute('data-entry-id');
    await page.locator(`[data-testid="forge-recent-files-open-${projAId}"]`).click();
    await pause(400);
    await shot('after-open-click');

    // The Open button must have dispatched forge:menu-action with the
    // canonical re-open id (file.openProject for kind=project) + the
    // path attached + source='recent-files' for downstream filtering.
    const captured = await page.evaluate(() => window.__push74LastMenuAction);
    expect(captured).not.toBeNull();
    expect(captured.id).toBe('file.openProject');
    expect(captured.path).toBe('/tmp/forge/projA.forge');
    expect(captured.source).toBe('recent-files');
    expect(captured.kind).toBe('project');

    // The row's timestamp was bumped, so projA must now be at the top
    // of the list (newest-at-top contract).
    const firstRow = list.locator('[data-entry-id]').first();
    const firstRowPath = await firstRow.getAttribute('data-entry-path');
    expect(firstRowPath).toBe('/tmp/forge/projA.forge');

    // The mirror Array reflects the same reordering.
    const mirrorPaths = await page.evaluate(() =>
        window.__forgeRecentFilesRead().map((e) => e.path));
    expect(mirrorPaths[0]).toBe('/tmp/forge/projA.forge');

    // Total count is still 3 — re-opening must NOT duplicate the entry.
    expect(mirrorPaths.length).toBe(3);

    await page.evaluate(() => {
        window.removeEventListener('forge:menu-action', window.__push74OnMenuAction);
    });
});

test('04 — Pin an entry; Clear drops everything else; pinned survives', async () => {
    // Pin meshC.stl. We grab the live id off the DOM because the host
    // sometimes assigns a fresh id when the entry is recorded.
    const list = page.locator('[data-testid="forge-recent-files-list"]');
    const meshCRow = list.locator('[data-entry-path="/tmp/forge/meshC.stl"]').first();
    const meshCId  = await meshCRow.getAttribute('data-entry-id');
    await page.locator(`[data-testid="forge-recent-files-pin-${meshCId}"]`).click();
    await pause(300);
    await shot('pinned-meshC');

    // The data-entry-pinned attribute on the row updates synchronously.
    const pinned = await meshCRow.getAttribute('data-entry-pinned');
    expect(pinned).toBe('1');
    // Panel-level data-pinned-count should equal 1.
    const pinnedCount = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-pinned-count'));
    expect(pinnedCount).toBe(1);

    // Click Clear. Pinned entries survive; everything else drops.
    await page.locator('[data-testid="forge-recent-files-clear"]').click();
    await pause(300);
    await shot('after-clear');

    const afterCount = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-entry-count'));
    expect(afterCount).toBe(1);

    // The surviving entry is meshC.
    const remainingRows = list.locator('[data-entry-id]');
    expect(await remainingRows.count()).toBe(1);
    const survivorPath = await remainingRows.first().getAttribute('data-entry-path');
    expect(survivorPath).toBe('/tmp/forge/meshC.stl');

    // Mirror Array round-trip.
    const mirror = await page.evaluate(() => window.__forgeRecentFilesRead());
    expect(mirror.length).toBe(1);
    expect(mirror[0].path).toBe('/tmp/forge/meshC.stl');
    expect(mirror[0].pinned).toBe(true);
});

test('05 — filter narrows visible rows; push-67 regression', async () => {
    await cameraTo('iso');

    // Re-seed two fresh paths so we have material to filter.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:file-opened', {
            detail: { path: '/tmp/forge/partD.step', name: 'partD.step',
                      kind: 'step', ts: Date.now() },
        }));
        window.dispatchEvent(new CustomEvent('forge:file-opened', {
            detail: { path: '/tmp/forge/assemblyE.iges', name: 'assemblyE.iges',
                      kind: 'iges', ts: Date.now() + 1 },
        }));
    });
    await pause(400);

    // Total: 1 (pinned meshC) + 2 (just-fired) = 3 entries.
    const totalCount = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-entry-count'));
    expect(totalCount).toBe(3);

    // Filter by 'partD' — only the partD.step row should remain visible,
    // the total stays at 3.
    const filterInput = page.locator('[data-testid="forge-recent-files-filter"]');
    await filterInput.fill('partD');
    await pause(300);
    await shot('filtered-partD');

    const filteredVisible = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-visible-count'));
    const filteredTotal = Number(
        await page.locator('[data-testid="forge-recent-files-panel"]')
                  .getAttribute('data-entry-count'));
    expect(filteredTotal).toBe(totalCount); // unchanged by filtering
    expect(filteredVisible).toBe(1);

    // The single visible row carries the partD path.
    const visibleRows = page.locator(
        '[data-testid="forge-recent-files-list"] [data-entry-id]');
    expect(await visibleRows.count()).toBe(1);
    const visiblePath = await visibleRows.first().getAttribute('data-entry-path');
    expect(visiblePath).toBe('/tmp/forge/partD.step');

    // Filter that doesn't match anything yields the empty-state hint.
    await filterInput.fill('zzz-no-such-file-zzz');
    await pause(250);
    const empty = page.locator('[data-testid="forge-recent-files-empty"]');
    await expect(empty).toBeVisible();
    const emptyTxt = await empty.textContent();
    expect((emptyTxt || '').toLowerCase()).toContain('no entries match');

    // Reset filter.
    await filterInput.fill('');
    await pause(200);

    // PUSH-67 regression: opening Measure via tools.measure menu action
    // must still work — Recent Files is a portal sibling and must not
    // collide with other right-docked panels.
    await platformMenuAction('tools.measure');
    await page.waitForSelector('[data-testid="forge-measure-panel"]',
                               { state: 'visible', timeout: 6000 });
    // Recent Files must still be visible alongside Measure.
    const recentVisible = await page.locator(
        '[data-testid="forge-recent-files-panel"]').isVisible();
    expect(recentVisible).toBe(true);

    await shot('measure-coexists');
});
