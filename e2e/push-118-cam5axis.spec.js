// PUSH-118 (Slice-86) — 5-Axis CAM Strategies panel.
//
// PUSH-46 ships the 2.5D CAM workbench, PUSH-98 layered the batched
// Drilling Pattern panel. This panel wires the three real 5-axis
// strategies on top of the native window.forge.cam.multiAxis* surface:
//
//   * Swarf            → forge.cam.multiAxisContinuous(shape, …, path)
//   * Parallel-to-face → forge.cam.multiAxisIndexed(shape, …, [(A,B,C)])
//   * Pocket           → forge.cam.multiAxisIndexed(shape, …, 4×(A,B,C))
//
// Proof end-to-end through the real Electron UI:
//   00. Boot Electron. Confirm window.__forgeOpenFiveAxisCAM +
//       window.__forgeFiveAxisHelper install BEFORE the panel mounts.
//       Sanity-check axisToABC() on canonical cases.
//   01. Seed a 100×100×30 stock block via window.forge.makeBox.
//   02. Open the panel via the tools.cam5Axis menu action; assert the
//       canonical test-ids mount + the strategy selector enumerates the
//       three strategies.
//   03. SWARF — pick the block, axis = (0,0,1), Generate → real toolpath
//       comes back from forge.cam.multiAxisContinuous with moveCount > 0,
//       continuous-axis-orientation badge visible.
//   04. PARALLEL-TO-FACE — switch strategy, axis = (0,1,1), Generate →
//       real toolpath from forge.cam.multiAxisIndexed with moveCount > 0
//       and one orientation per the panel's parallelOrientations helper.
//   05. POCKET — switch strategy, axis = (0,0,1), Generate → real
//       toolpath from forge.cam.multiAxisIndexed with moveCount > 0
//       and four orientations per the pocketOrientations helper.
//   06. PUSH-98 regression — open the Drilling Pattern panel, drive a
//       4-corner drill, assert the existing surface still works.
//
// No stubs: every moveCount lands through the native kernel toolpath
// from kernel.cam.multiAxis* (preload.js:207-214).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper surface)
//   - front (seed body + open panel)
//   - top   (swarf strategy)
//   - right (parallel-to-face strategy)
//   - iso   (pocket strategy + PUSH-98 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-118-cam5axis');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'cam5axis-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' +
                 label.replace(/[^a-z0-9-_.]/gi, '_');
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
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /push-118|cam5|cam5Axis|fiveAxis|cam\.multi|error|Error|exception|TypeError|crashed/i.test(t)) {
            console.log('[browser]', msg.type(), t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    // Dismiss the onboarding tour so it doesn't block clicks.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        try { window.__forgeFinishTour?.(); } catch {}
    });
    await pause(400);
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(200);
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
        console.error('[push-118] no .webm');
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
                const sz = (fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2);
                console.log(`[push-118] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-118] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ────────────────────────────────────────────────────── camera 1 / 5 — iso
test('00 — iso: boot + assert host surface + helper API installed', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The host effect installs the imperative open/close surface AND the
    // headless helper at mount time — proves FiveAxisCAMPanelHost
    // mounted from App.jsx and registered its window globals.
    await page.waitForFunction(
        () => typeof window.__forgeOpenFiveAxisCAM === 'function'
              && typeof window.__forgeCloseFiveAxisCAM === 'function'
              && typeof window.__forgeFiveAxisHelper === 'object',
        { timeout: 8000 },
    );

    const surface = await page.evaluate(() => {
        const h = window.__forgeFiveAxisHelper;
        if (!h) return { ok: false };
        return {
            ok: true,
            helperKeys: Object.keys(h).sort(),
            // axisToABC sanity — canonical Z-up vector → (0,0,0) Euler.
            zUp:    h.axisToABC({ x: 0, y: 0, z: 1 }),
            yUp:    h.axisToABC({ x: 0, y: 1, z: 0 }),
            xUp:    h.axisToABC({ x: 1, y: 0, z: 0 }),
            tilt45: h.axisToABC({ x: 0, y: 1, z: 1 }),
            // STRATEGIES expose the three branches.
            strategyIds: h.STRATEGIES.map((s) => s.id),
            // pocketOrientations returns 4 (A,B,C) triples from one vector.
            pocketOrientCount: h.pocketOrientations({ x: 0, y: 0, z: 1 }).length,
            // parallelOrientations returns a single triple.
            parallelOrientCount: h.parallelOrientations({ x: 0, y: 1, z: 1 }).length,
            // swarfPathFromAabb walks the AABB at N stations.
            swarfStations: h.swarfPathFromAabb(
                { minX: 0, minY: 0, minZ: 0, maxX: 100, maxY: 100, maxZ: 30 },
                { x: 0, y: 0, z: 1 }, 8).length,
        };
    });
    console.log('[push-118] host surface =', JSON.stringify(surface));
    expect(surface.ok).toBe(true);
    expect(surface.helperKeys).toContain('axisToABC');
    expect(surface.helperKeys).toContain('swarfPathFromAabb');
    expect(surface.helperKeys).toContain('parallelOrientations');
    expect(surface.helperKeys).toContain('pocketOrientations');
    expect(surface.helperKeys).toContain('STRATEGIES');
    expect(surface.strategyIds).toEqual(['swarf', 'parallel-to-face', 'pocket']);
    // (A,B,C) for the canonical +Z vector is (0,0,0).
    expect(surface.zUp[0]).toBeCloseTo(0, 2);
    expect(surface.zUp[1]).toBeCloseTo(0, 2);
    // +Y vector → A = 90°.
    expect(surface.yUp[0]).toBeCloseTo(90, 2);
    // +X vector → B = -90°.
    expect(surface.xUp[1]).toBeCloseTo(-90, 2);
    // 45° tilt towards Y → A = 45°.
    expect(surface.tilt45[0]).toBeCloseTo(45, 2);
    // 4-orient pocket ring.
    expect(surface.pocketOrientCount).toBe(4);
    // 1-orient parallel.
    expect(surface.parallelOrientCount).toBe(1);
    // 8-station swarf path.
    expect(surface.swarfStations).toBe(8);
    await shot('host-surface-ok');
});

// ────────────────────────────────────────────────────── camera 2 / 5 — front
test('01 — front: seed 100×100×30 stock block + open panel', async () => {
    await cameraTo('front');

    // Seed the stock as a real native box via window.forge.makeBox.
    const stockSeeded = await page.evaluate(() => {
        if (!window.forge?.makeBox || typeof window.__forgeAppendBody !== 'function') {
            return { ok: false, why: 'forge surface not ready' };
        }
        const h = window.forge.makeBox(100, 100, 30);
        const id = `cam5axis-stock-${Date.now()}`;
        window.__forgeAppendBody({
            id, kind: 'native', handle: h,
            toolId: 'primitive.box',
            name: 'CAM5 Stock 100x100x30',
            params: { width: 100, height: 100, distance: 30 },
        });
        return { ok: true, id, handle: h };
    });
    expect(stockSeeded.ok).toBe(true);
    expect(stockSeeded.handle).toBeGreaterThan(0);
    await pause(500);
    await shot('stock-seeded');

    await platformMenuAction('tools.cam5Axis');
    await page.waitForSelector('[data-testid="forge-cam5axis-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Every control test-id is in the DOM.
    await expect(page.locator('[data-testid="forge-cam5axis-part"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam5axis-strategy"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam5axis-axis-x"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam5axis-axis-y"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam5axis-axis-z"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam5axis-generate"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam5axis-close"]')).toBeVisible();

    // The strategy dropdown enumerates exactly the three strategies.
    const opts = await page.locator('[data-testid="forge-cam5axis-strategy"] option')
        .evaluateAll((els) => els.map((e) => e.value));
    console.log('[push-118] strategy options =', JSON.stringify(opts));
    expect(opts).toEqual(['swarf', 'parallel-to-face', 'pocket']);

    // The cam-ready badge says "ready" because the kernel ships both
    // multiAxisIndexed + multiAxisContinuous (preload.js:207-214).
    const ready = await page.locator('[data-testid="forge-cam5axis-cam-ready"]')
        .innerText();
    console.log('[push-118] cam-ready =', ready);
    expect(ready).toMatch(/ready/i);

    // The part picker auto-pinned the seeded stock body.
    const partVal = await page.locator('[data-testid="forge-cam5axis-part"]')
        .inputValue();
    console.log('[push-118] auto-picked part =', partVal);
    expect(partVal).toMatch(/^cam5axis-stock-/);
});

// ────────────────────────────────────────────────────── camera 3 / 5 — top
test('02 — top: SWARF strategy — multiAxisContinuous toolpath', async () => {
    await cameraTo('top');

    // Default strategy is swarf — make it explicit anyway so the test is
    // robust to a future default change.
    await page.locator('[data-testid="forge-cam5axis-strategy"]')
        .selectOption('swarf');
    await pause(200);
    await expect(page.locator('[data-testid="forge-cam5axis-panel"]'))
        .toHaveAttribute('data-strategy', 'swarf');

    // Tool axis = (0, 0, 1) — canonical Z-up.
    await page.locator('[data-testid="forge-cam5axis-axis-x"]').fill('0');
    await page.locator('[data-testid="forge-cam5axis-axis-y"]').fill('0');
    await page.locator('[data-testid="forge-cam5axis-axis-z"]').fill('1');
    await pause(200);

    // Stations input is visible for the swarf strategy only.
    await expect(page.locator('[data-testid="forge-cam5axis-stations"]')).toBeVisible();
    await page.locator('[data-testid="forge-cam5axis-stations"]').fill('8');
    await pause(150);
    await shot('swarf-configured');

    // Generate → the panel calls forge.cam.multiAxisContinuous with the
    // 8-station path. Wait for the results block to render.
    await page.locator('[data-testid="forge-cam5axis-generate"]').click();
    await page.waitForSelector('[data-testid="forge-cam5axis-results"]',
        { state: 'visible', timeout: 10000 });
    await pause(300);
    await shot('swarf-generated');

    // No error chip.
    const errCount = await page.locator('[data-testid="forge-cam5axis-error"]')
        .count();
    if (errCount > 0) {
        const txt = await page.locator('[data-testid="forge-cam5axis-error"]')
            .innerText();
        console.log('[push-118] swarf error =', txt);
    }
    expect(errCount).toBe(0);

    // moveCount > 0 from the real kernel.
    const movesTxt = await page.locator('[data-testid="forge-cam5axis-moves"]')
        .innerText();
    const moves = Number(movesTxt.trim());
    console.log('[push-118] swarf moveCount =', moves);
    expect(moves).toBeGreaterThan(0);

    // Continuous toolpaths carry the per-move axis orientations badge.
    await expect(page.locator('[data-testid="forge-cam5axis-axis-orient"]'))
        .toBeVisible();

    // The panel published the toolpath summary on window for the e2e.
    const published = await page.evaluate(() => window.__forgeFiveAxisToolpath || null);
    console.log('[push-118] published swarf toolpath =', JSON.stringify(published));
    expect(published).not.toBeNull();
    expect(published.strategy).toBe('swarf');
    expect(published.moveCount).toBe(moves);
});

// ────────────────────────────────────────────────────── camera 4 / 5 — right
test('03 — right: PARALLEL-TO-FACE strategy — multiAxisIndexed (1 orient)', async () => {
    await cameraTo('right');

    await page.locator('[data-testid="forge-cam5axis-strategy"]')
        .selectOption('parallel-to-face');
    await pause(200);
    await expect(page.locator('[data-testid="forge-cam5axis-panel"]'))
        .toHaveAttribute('data-strategy', 'parallel-to-face');

    // Stations input disappears for the indexed strategies.
    await expect(page.locator('[data-testid="forge-cam5axis-stations"]'))
        .toHaveCount(0);

    // Axis = (0, 1, 1) — 45° tilt towards Y.
    await page.locator('[data-testid="forge-cam5axis-axis-x"]').fill('0');
    await page.locator('[data-testid="forge-cam5axis-axis-y"]').fill('1');
    await page.locator('[data-testid="forge-cam5axis-axis-z"]').fill('1');
    await pause(200);

    // The computed (A,B,C) chip shows the canonical tilt.
    const abcTxt = await page.locator('[data-testid="forge-cam5axis-abc"]').innerText();
    console.log('[push-118] parallel ABC =', abcTxt);
    expect(abcTxt).toMatch(/45\.00/);

    await shot('parallel-configured');

    await page.locator('[data-testid="forge-cam5axis-generate"]').click();
    await page.waitForSelector('[data-testid="forge-cam5axis-results"]',
        { state: 'visible', timeout: 10000 });
    await pause(300);
    await shot('parallel-generated');

    const errCount = await page.locator('[data-testid="forge-cam5axis-error"]')
        .count();
    if (errCount > 0) {
        const txt = await page.locator('[data-testid="forge-cam5axis-error"]')
            .innerText();
        console.log('[push-118] parallel error =', txt);
    }
    expect(errCount).toBe(0);

    const movesTxt = await page.locator('[data-testid="forge-cam5axis-moves"]')
        .innerText();
    const moves = Number(movesTxt.trim());
    console.log('[push-118] parallel moveCount =', moves);
    expect(moves).toBeGreaterThan(0);

    // Indexed toolpaths expose the orientation count = 1 for parallel.
    const orientTxt = await page.locator('[data-testid="forge-cam5axis-orient-count"]')
        .innerText();
    const orients = Number(orientTxt.trim());
    console.log('[push-118] parallel orientation count =', orients);
    expect(orients).toBe(1);

    const published = await page.evaluate(() => window.__forgeFiveAxisToolpath || null);
    expect(published.strategy).toBe('parallel-to-face');
});

// ────────────────────────────────────────────────────── camera 5 / 5 — iso
test('04 — iso (close): POCKET strategy + PUSH-98 regression', async () => {
    await cameraTo('iso');

    await page.locator('[data-testid="forge-cam5axis-strategy"]')
        .selectOption('pocket');
    await pause(200);
    await expect(page.locator('[data-testid="forge-cam5axis-panel"]'))
        .toHaveAttribute('data-strategy', 'pocket');

    // Axis = (0, 0, 1) — vertical pocket clearing.
    await page.locator('[data-testid="forge-cam5axis-axis-x"]').fill('0');
    await page.locator('[data-testid="forge-cam5axis-axis-y"]').fill('0');
    await page.locator('[data-testid="forge-cam5axis-axis-z"]').fill('1');
    await pause(200);
    await shot('pocket-configured');

    await page.locator('[data-testid="forge-cam5axis-generate"]').click();
    await page.waitForSelector('[data-testid="forge-cam5axis-results"]',
        { state: 'visible', timeout: 10000 });
    await pause(300);
    await shot('pocket-generated');

    const errCount = await page.locator('[data-testid="forge-cam5axis-error"]')
        .count();
    if (errCount > 0) {
        const txt = await page.locator('[data-testid="forge-cam5axis-error"]')
            .innerText();
        console.log('[push-118] pocket error =', txt);
    }
    expect(errCount).toBe(0);

    const movesTxt = await page.locator('[data-testid="forge-cam5axis-moves"]')
        .innerText();
    const moves = Number(movesTxt.trim());
    console.log('[push-118] pocket moveCount =', moves);
    expect(moves).toBeGreaterThan(0);

    const orientTxt = await page.locator('[data-testid="forge-cam5axis-orient-count"]')
        .innerText();
    const orients = Number(orientTxt.trim());
    console.log('[push-118] pocket orientation count =', orients);
    expect(orients).toBe(4);

    // Close the 5-axis panel and run a PUSH-98 regression.
    await page.locator('[data-testid="forge-cam5axis-close"]').click().catch(() => {});
    await pause(300);

    // PUSH-98 regression — drive a 4-corner drill on the same stock.
    await platformMenuAction('tools.drillingPattern');
    await page.waitForSelector('[data-testid="forge-drilling-pattern-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('drilling-panel-open');

    // Pick the seeded stock body, set defaults, add 4 holes.
    const stockOptVal = await page.evaluate(() => {
        const sel = document.querySelector('[data-testid="forge-drilling-pattern-stock"]');
        if (!sel) return null;
        for (const o of sel.options) {
            if (o.value && o.value.startsWith('cam5axis-stock-')) return o.value;
        }
        for (const o of sel.options) { if (o.value) return o.value; }
        return null;
    });
    expect(stockOptVal).not.toBeNull();
    await page.selectOption('[data-testid="forge-drilling-pattern-stock"]', stockOptVal);
    await pause(200);

    await page.locator('[data-testid="forge-drilling-pattern-diameter"]').fill('6');
    await page.locator('[data-testid="forge-drilling-pattern-depth"]').fill('10');
    await page.locator('[data-testid="forge-drilling-pattern-ztop"]').fill('30');
    await pause(150);

    const HOLES = [
        { x: 15, y: 15 }, { x: 85, y: 15 },
        { x: 85, y: 85 }, { x: 15, y: 85 },
    ];
    for (let i = 0; i < HOLES.length; i++) {
        await page.locator('[data-testid="forge-drilling-pattern-add-hole"]').click();
        await pause(100);
    }
    for (let i = 0; i < HOLES.length; i++) {
        await page.locator(`[data-testid="forge-drilling-pattern-hole-${i}-x"]`)
            .fill(String(HOLES[i].x));
        await page.locator(`[data-testid="forge-drilling-pattern-hole-${i}-y"]`)
            .fill(String(HOLES[i].y));
    }
    await pause(150);
    await page.locator('[data-testid="forge-drilling-pattern-generate"]').click();
    await page.waitForSelector('[data-testid="forge-drilling-pattern-results"]',
        { state: 'visible', timeout: 10000 });
    await pause(300);
    await shot('drilling-regression');

    const drillErrCount = await page.locator('[data-testid="forge-drilling-pattern-error"]')
        .count();
    expect(drillErrCount).toBe(0);

    const drillResultRows = await page
        .locator('[data-testid^="forge-drilling-pattern-result-row-"]').count();
    console.log('[push-118] PUSH-98 regression rows =', drillResultRows);
    expect(drillResultRows).toBe(HOLES.length);

    for (let i = 0; i < HOLES.length; i++) {
        const movesT = await page
            .locator(`[data-testid="forge-drilling-pattern-result-${i}-moves"]`)
            .innerText();
        const m = Number(movesT.trim());
        console.log(`[push-118] regression hole ${i + 1} moves =`, m);
        expect(m).toBeGreaterThan(0);
    }

    // Final iso frame — close the drilling panel so the mp4 closes
    // on a clean scene shot.
    await page.evaluate(() => { window.__forgeCloseDrillingPattern?.(); });
    await pause(300);
    await platformMenuAction('view.zoomFit');
    await pause(400);
    await shot('iso-final');
});
