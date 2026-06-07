// PUSH-90 (Slice-58 / Dimension Chains panel — Ordinate + Baseline + Chain).
//
// PUSH-67 added a point-to-point Measure tool that uses
// window.__forgeSelection to capture A→B distance, dx/dy/dz, and a
// 3-point angle. PUSH-90 builds the *multi-point* class on top of the
// same selection-capture UX:
//
//   • **Ordinate** — picked points reported as (x_i, y_i, z_i) deltas
//     from a chosen origin (the first picked point).
//   • **Baseline** — every dimension is P0 → P_i for i ≥ 1.
//   • **Chain**    — incremental dimensions P_(i-1) → P_i.
//
// Proof end-to-end:
//   1. Boot Electron; dismiss any first-run banner; assert the headless
//      helper API (window.__forgeDimChainsHelper) is wired by the
//      Host's mount effect.
//   2. Seed 3 native OCCT 20×20×20 boxes at well-known origins so we
//      know the COMs exactly:
//        - Box A at origin       → COM (10, 10, 10)
//        - Box B translated +50X → COM (60, 10, 10)
//        - Box C translated +120X→ COM (130, 10, 10)
//      We pick the body COMs as the chain points so the math is
//      deterministic and we can assert against ground truth.
//   3. Open Dimension Chains via tools.dimChains menu action. Assert the
//      panel mounts, the empty-state line is shown, and the Generate
//      button is disabled (we have 0 < 3 points).
//   4. Capture P0 = body-A COM (10, 10, 10).
//      Press "Add Point", fire forge:selection-changed → P0 lands.
//      Repeat for P1 = body-B COM, P2 = body-C COM.
//      Assert points-list shows 3 rows with the expected data attrs.
//   5. Pick chain type = "ordinate" (it's the default). Click Generate.
//      Assert the table renders 3 rows:
//        - Origin row: value = 0
//        - P1: value = sqrt(50² + 0² + 0²) = 50
//        - P2: value = sqrt(120² + 0² + 0²) = 120
//   6. Switch to "baseline". Click Generate. Assert 2 rows:
//        - B1: P0→P1 = 50
//        - B2: P0→P2 = 120
//   7. Switch to "chain". Click Generate. Assert 2 rows:
//        - C1: P0→P1 = 50
//        - C2: P1→P2 = 70
//   8. Sort the table by Value descending; assert row order flips.
//   9. Click a header to sort by Label; assert ordering swaps.
//  10. Assert window.__forgeDimChains was populated after the most
//      recent Generate (snapshot mirrors the type + points + entries
//      and matches what the table renders).
//  11. PUSH-67 regression — open the Measure panel and confirm the
//      Dimension Chains panel is still mounted (portal siblings, both
//      listen to forge:selection-changed without colliding).
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + assert headless helper + seed bodies)
//   - front (open panel + verify empty state)
//   - top   (capture all 3 points)
//   - right (ordinate → baseline → chain Generate + sort + global mirror)
//   - iso   (PUSH-67 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-90-dim-chains');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'dim-chains-session.mp4');

let app, page;
let stepIndex = 0;
let handleA = null;
let handleB = null;
let handleC = null;

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

// Replace window.__forgeSelection wholesale and fire the bus event the
// DimensionChainsPanel listens for. Mirrors what aisSelection.js +
// the CommandPalette do internally; same pattern as push-67-measure.
async function setSelection(sel) {
    await page.evaluate((s) => {
        window.__forgeSelection = s;
        window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: s }));
    }, sel);
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
        if (/push-90|dim-chain|DimChain|forge|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts an overlay that intercepts
    // clicks. Flip the localStorage flag so it stays dormant, then
    // explicitly skip if it raced in.
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
        console.error('[push-90] no .webm');
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
                console.log(`[push-90] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-90] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API + seed 3 boxes at (0/50/120) X offsets', async () => {
    await cameraTo('iso');
    await shot('boot');

    // 1) The Host's mount effect must wire __forgeDimChainsHelper. We
    //    assert here so the test fails loudly if App.jsx forgot the mount.
    await page.waitForFunction(
        () => typeof window.__forgeDimChainsHelper === 'object'
              && window.__forgeDimChainsHelper !== null,
        null, { timeout: 8000 });
    const helperShape = await page.evaluate(() => {
        const h = window.__forgeDimChainsHelper;
        return {
            hasOrdinate:    typeof h.ordinateChain === 'function',
            hasBaseline:    typeof h.baselineChain === 'function',
            hasIncremental: typeof h.incrementalChain === 'function',
            hasGenerate:    typeof h.generateChain === 'function',
            hasSort:        typeof h.sortEntries === 'function',
            hasPublish:     typeof h.publishChain === 'function',
            chainTypes:     Array.isArray(h.CHAIN_TYPES) ? h.CHAIN_TYPES.slice() : null,
            evt:            h.EVENT_NAME,
            globalName:     h.GLOBAL_NAME,
        };
    });
    expect(helperShape.hasOrdinate).toBe(true);
    expect(helperShape.hasBaseline).toBe(true);
    expect(helperShape.hasIncremental).toBe(true);
    expect(helperShape.hasGenerate).toBe(true);
    expect(helperShape.hasSort).toBe(true);
    expect(helperShape.hasPublish).toBe(true);
    expect(helperShape.chainTypes).toEqual(['ordinate', 'baseline', 'chain']);
    expect(helperShape.evt).toBe('forge:dim-chain-generated');
    expect(helperShape.globalName).toBe('__forgeDimChains');

    // 2) Headless math sanity-check on simple inputs before we touch the
    //    real kernel. This ensures the helpers themselves are right —
    //    so when the panel-driven path matches, we know the wiring is right too.
    const mathCheck = await page.evaluate(() => {
        const h = window.__forgeDimChainsHelper;
        const pts = [[0, 0, 0], [3, 4, 0], [3, 4, 12]];
        return {
            ordinate: h.ordinateChain(pts).map((e) => ({ label: e.label, value: e.value })),
            baseline: h.baselineChain(pts).map((e) => ({ label: e.label, value: e.value })),
            chain:    h.incrementalChain(pts).map((e) => ({ label: e.label, value: e.value })),
        };
    });
    console.log('[push-90] headless math check =', JSON.stringify(mathCheck));
    expect(mathCheck.ordinate).toEqual([
        { label: 'Origin', value: 0 },
        { label: 'P1', value: 5 },     // sqrt(3² + 4² + 0²)
        { label: 'P2', value: 13 },    // sqrt(3² + 4² + 12²)
    ]);
    expect(mathCheck.baseline).toEqual([
        { label: 'B1', value: 5 },
        { label: 'B2', value: 13 },
    ]);
    expect(mathCheck.chain).toEqual([
        { label: 'C1', value: 5 },     // (0,0,0) → (3,4,0)
        { label: 'C2', value: 12 },    // (3,4,0) → (3,4,12)
    ]);

    // 3) Seed the bodies. We pick 20×20×20 boxes so the COMs land on
    //    the integers we can match exactly in the assertions.
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        if (typeof f.massProps !== 'function') return { error: 'forge.massProps unavailable' };
        // Box A — at origin. COM (10, 10, 10).
        const a = f.makeBox(20, 20, 20);
        // Box B — translated +50 X. COM (60, 10, 10).
        const b0 = f.makeBox(20, 20, 20);
        const b  = f.translate(b0, 50, 0, 0);
        // Box C — translated +120 X. COM (130, 10, 10).
        const c0 = f.makeBox(20, 20, 20);
        const c  = f.translate(c0, 120, 0, 0);
        if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-90-a', kind: 'native', handle: a,
            toolId: 'solid.box', name: 'Box A 20',
            params: { width: 20, height: 20, distance: 20 },
        });
        window.__forgeAppendBody({
            id: 'f-box-90-b', kind: 'native', handle: b,
            toolId: 'solid.box', name: 'Box B 20 @ +50 X',
            params: { width: 20, height: 20, distance: 20 },
        });
        window.__forgeAppendBody({
            id: 'f-box-90-c', kind: 'native', handle: c,
            toolId: 'solid.box', name: 'Box C 20 @ +120 X',
            params: { width: 20, height: 20, distance: 20 },
        });
        return {
            handleA: a, handleB: b, handleC: c,
            comA: f.massProps(a)?.centerOfMass,
            comB: f.massProps(b)?.centerOfMass,
            comC: f.massProps(c)?.centerOfMass,
        };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handleA).toBeGreaterThan(0);
    expect(seeded.handleB).toBeGreaterThan(0);
    expect(seeded.handleC).toBeGreaterThan(0);
    handleA = seeded.handleA;
    handleB = seeded.handleB;
    handleC = seeded.handleC;
    console.log('[push-90] COMs A/B/C =', seeded.comA, seeded.comB, seeded.comC);
    expect(Math.abs(seeded.comA[0] - 10)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comB[0] - 60)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comC[0] - 130)).toBeLessThan(0.1);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 3,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Dimension Chains panel via tools.dimChains', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.dimChains');
    await page.waitForSelector('[data-testid="forge-dim-chains-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Empty state: 0 points, 0 entries, type = ordinate by default.
    const ptCount = await page.locator('[data-testid="forge-dim-chains-panel"]')
                              .getAttribute('data-point-count');
    const entryCount = await page.locator('[data-testid="forge-dim-chains-panel"]')
                                 .getAttribute('data-entry-count');
    const type = await page.locator('[data-testid="forge-dim-chains-panel"]')
                           .getAttribute('data-chain-type');
    expect(ptCount).toBe('0');
    expect(entryCount).toBe('0');
    expect(type).toBe('ordinate');

    // Generate button should be disabled with 0 points.
    const genDisabled = await page.locator('[data-testid="forge-dim-chains-generate"]')
                                  .isDisabled();
    expect(genDisabled).toBe(true);
});

test('02 — capture P0/P1/P2 from body-A/B/C COMs (top cam)', async () => {
    await cameraTo('top');

    // ── P0 = body A COM (10, 10, 10).
    await page.locator('[data-testid="forge-dim-chains-add-point"]').click();
    await pause(150);
    const armed = await page.locator('[data-testid="forge-dim-chains-add-point"]')
                            .getAttribute('data-armed');
    expect(armed).toBe('true');
    await setSelection({ kind: 'body', bodyHandle: handleA, ids: [handleA] });
    await page.waitForSelector('[data-testid="forge-dim-chains-point-0"]',
                               { state: 'visible', timeout: 4000 });
    // After capture the arm should auto-disarm.
    const armedAfter0 = await page.locator('[data-testid="forge-dim-chains-add-point"]')
                                  .getAttribute('data-armed');
    expect(armedAfter0).toBe('false');

    // ── P1 = body B COM (60, 10, 10).
    await page.locator('[data-testid="forge-dim-chains-add-point"]').click();
    await pause(150);
    await setSelection({ kind: 'body', bodyHandle: handleB, ids: [handleB] });
    await page.waitForSelector('[data-testid="forge-dim-chains-point-1"]',
                               { state: 'visible', timeout: 4000 });

    // ── P2 = body C COM (130, 10, 10).
    await page.locator('[data-testid="forge-dim-chains-add-point"]').click();
    await pause(150);
    await setSelection({ kind: 'body', bodyHandle: handleC, ids: [handleC] });
    await page.waitForSelector('[data-testid="forge-dim-chains-point-2"]',
                               { state: 'visible', timeout: 4000 });
    await shot('three-points-captured');

    // Assert the row data attrs match the expected COMs.
    const p0x = Number(await page.locator('[data-testid="forge-dim-chains-point-0"]')
                                 .getAttribute('data-point-x'));
    const p1x = Number(await page.locator('[data-testid="forge-dim-chains-point-1"]')
                                 .getAttribute('data-point-x'));
    const p2x = Number(await page.locator('[data-testid="forge-dim-chains-point-2"]')
                                 .getAttribute('data-point-x'));
    expect(Math.abs(p0x - 10)).toBeLessThan(0.1);
    expect(Math.abs(p1x - 60)).toBeLessThan(0.1);
    expect(Math.abs(p2x - 130)).toBeLessThan(0.1);

    // Count chip on the panel should show 3.
    const ptCount = await page.locator('[data-testid="forge-dim-chains-panel"]')
                              .getAttribute('data-point-count');
    expect(ptCount).toBe('3');

    // With 3 points captured, Generate should be enabled.
    const genDisabled = await page.locator('[data-testid="forge-dim-chains-generate"]')
                                  .isDisabled();
    expect(genDisabled).toBe(false);
});

test('03 — ordinate / baseline / chain Generate + sort + global mirror', async () => {
    await cameraTo('right');

    // ── ORDINATE (default radio selection).
    await page.locator('[data-testid="forge-dim-chains-generate"]').click();
    await page.waitForSelector('[data-testid="forge-dim-chains-table"]',
                               { state: 'visible', timeout: 4000 });
    await shot('ordinate-generated');

    // 3 rows: Origin + P1 + P2. Values: 0, 50, 120.
    const row0Val = Number(await page.locator('[data-testid="forge-dim-chains-row-0"]')
                                     .getAttribute('data-value-mm'));
    const row1Val = Number(await page.locator('[data-testid="forge-dim-chains-row-1"]')
                                     .getAttribute('data-value-mm'));
    const row2Val = Number(await page.locator('[data-testid="forge-dim-chains-row-2"]')
                                     .getAttribute('data-value-mm'));
    console.log('[push-90] ordinate values =', row0Val, row1Val, row2Val);
    expect(Math.abs(row0Val - 0)).toBeLessThan(0.1);
    expect(Math.abs(row1Val - 50)).toBeLessThan(0.1);
    expect(Math.abs(row2Val - 120)).toBeLessThan(0.1);
    // From / To attrs should mark every row's from as "Origin".
    const row1From = await page.locator('[data-testid="forge-dim-chains-row-1"]')
                               .getAttribute('data-from');
    const row2From = await page.locator('[data-testid="forge-dim-chains-row-2"]')
                               .getAttribute('data-from');
    expect(row1From).toBe('Origin');
    expect(row2From).toBe('Origin');

    // ── BASELINE.
    await page.locator('[data-testid="forge-dim-chains-type-baseline"]').check();
    await pause(150);
    // Switching type clears entries — Generate button should re-enable
    // immediately because the points are still here.
    await page.locator('[data-testid="forge-dim-chains-generate"]').click();
    await pause(250);
    await shot('baseline-generated');
    // 2 rows: B1 = 50, B2 = 120. Both from P0.
    const b1Val = Number(await page.locator('[data-testid="forge-dim-chains-row-1"]')
                                   .getAttribute('data-value-mm'));
    const b2Val = Number(await page.locator('[data-testid="forge-dim-chains-row-2"]')
                                   .getAttribute('data-value-mm'));
    console.log('[push-90] baseline values =', b1Val, b2Val);
    expect(Math.abs(b1Val - 50)).toBeLessThan(0.1);
    expect(Math.abs(b2Val - 120)).toBeLessThan(0.1);
    const b1From = await page.locator('[data-testid="forge-dim-chains-row-1"]')
                             .getAttribute('data-from');
    const b2From = await page.locator('[data-testid="forge-dim-chains-row-2"]')
                             .getAttribute('data-from');
    expect(b1From).toBe('P0');
    expect(b2From).toBe('P0');

    // ── CHAIN (incremental).
    await page.locator('[data-testid="forge-dim-chains-type-chain"]').check();
    await pause(150);
    await page.locator('[data-testid="forge-dim-chains-generate"]').click();
    await pause(250);
    await shot('chain-generated');
    // 2 rows: C1 = 50 (P0→P1), C2 = 70 (P1→P2).
    const c1Val = Number(await page.locator('[data-testid="forge-dim-chains-row-1"]')
                                   .getAttribute('data-value-mm'));
    const c2Val = Number(await page.locator('[data-testid="forge-dim-chains-row-2"]')
                                   .getAttribute('data-value-mm'));
    console.log('[push-90] chain values =', c1Val, c2Val);
    expect(Math.abs(c1Val - 50)).toBeLessThan(0.1);
    expect(Math.abs(c2Val - 70)).toBeLessThan(0.1);
    const c1From = await page.locator('[data-testid="forge-dim-chains-row-1"]')
                             .getAttribute('data-from');
    const c2From = await page.locator('[data-testid="forge-dim-chains-row-2"]')
                             .getAttribute('data-from');
    expect(c1From).toBe('P0');
    expect(c2From).toBe('P1');

    // ── Sort by Value: first click = asc (already in asc), second = desc.
    await page.locator('[data-testid="forge-dim-chains-th-value"]').click();
    await pause(150);
    await page.locator('[data-testid="forge-dim-chains-th-value"]').click();
    await pause(250);
    await shot('sorted-by-value-desc');
    // The visible row order should now have the largest value first.
    // Read the first tbody row's data-value-mm and assert it's the bigger one (70).
    const tableRowsDesc = await page.evaluate(() => {
        const rows = document.querySelectorAll(
            '[data-testid="forge-dim-chains-table"] tbody tr');
        return Array.from(rows).map((r) => Number(r.getAttribute('data-value-mm')));
    });
    console.log('[push-90] chain sorted desc =', tableRowsDesc);
    expect(tableRowsDesc.length).toBe(2);
    expect(tableRowsDesc[0]).toBeGreaterThanOrEqual(tableRowsDesc[1]);
    expect(Math.abs(tableRowsDesc[0] - 70)).toBeLessThan(0.1);

    // Click Label header → switches sort key. asc by label means C1 first.
    await page.locator('[data-testid="forge-dim-chains-th-label"]').click();
    await pause(250);
    const tableRowsByLabel = await page.evaluate(() => {
        const rows = document.querySelectorAll(
            '[data-testid="forge-dim-chains-table"] tbody tr');
        return Array.from(rows).map((r) => r.getAttribute('data-label'));
    });
    console.log('[push-90] chain sorted by label asc =', tableRowsByLabel);
    expect(tableRowsByLabel).toEqual(['C1', 'C2']);

    // ── Global mirror — window.__forgeDimChains must reflect the last
    //    Generate (type "chain"), 3 captured points, 2 entries.
    const mirror = await page.evaluate(() => {
        const m = window.__forgeDimChains;
        if (!m) return null;
        return {
            type: m.type,
            pointCount: Array.isArray(m.points) ? m.points.length : null,
            entryCount: Array.isArray(m.entries) ? m.entries.length : null,
            firstEntryValue: m.entries?.[0]?.value,
            lastEntryValue:  m.entries?.[m.entries.length - 1]?.value,
        };
    });
    console.log('[push-90] window.__forgeDimChains =', JSON.stringify(mirror));
    expect(mirror).not.toBeNull();
    expect(mirror.type).toBe('chain');
    expect(mirror.pointCount).toBe(3);
    expect(mirror.entryCount).toBe(2);
    expect(Math.abs(mirror.firstEntryValue - 50)).toBeLessThan(0.1);
    expect(Math.abs(mirror.lastEntryValue - 70)).toBeLessThan(0.1);
});

test('04 — PUSH-67 Measure regression: both panels coexist on selection bus', async () => {
    await cameraTo('iso');
    // Open the PUSH-67 Measure panel while Dimension Chains is still up.
    // The two panels both listen to forge:selection-changed; neither
    // mutates the global, so they must coexist.
    await platformMenuAction('tools.measure');
    await page.waitForSelector('[data-testid="forge-measure-panel"]',
                               { state: 'visible', timeout: 6000 });
    // Dimension Chains should still be on screen — they're portal siblings.
    const dimStill = await page.locator('[data-testid="forge-dim-chains-panel"]')
                               .isVisible();
    expect(dimStill).toBe(true);

    // Arm Point A on the measure panel and capture body A's COM. That
    // should not push another point onto the dimension-chains list
    // because we never re-armed the chains panel; the chains panel's
    // captureArmed bails when its own `armed` flag is false.
    await page.locator('[data-testid="forge-measure-set-a"]').click();
    await pause(150);
    await setSelection({ kind: 'body', bodyHandle: handleA, ids: [handleA] });
    await page.waitForSelector('[data-testid="forge-measure-a-readout"]',
                               { state: 'visible', timeout: 4000 });
    await shot('measure-regression');

    const measureA = await page.locator('[data-testid="forge-measure-a-readout"]')
                               .textContent();
    console.log('[push-90] measure A readout =', measureA);
    expect(measureA || '').toMatch(/10\.00/);

    // The chains panel should still report 3 points (unchanged by the
    // measure-capture event because chains panel wasn't armed).
    const ptCount = await page.locator('[data-testid="forge-dim-chains-panel"]')
                              .getAttribute('data-point-count');
    expect(ptCount).toBe('3');
});
