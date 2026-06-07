// PUSH-117 (Slice-85) — CAM Adaptive Clearing strategy panel.
//
// Adaptive clearing is the high-MRR, constant-chip-load roughing
// strategy that replaces conventional zig-zag pocketing in modern HSM
// CAM. forge::cam::adaptiveClear3Axis (CamAdvanced.cpp:145, exposed as
// window.forge.cam.adaptiveClear via electron/preload.js:203) implements
// exactly this: traces an Archimedean spiral whose feedrate is modulated
// by the engagement arc so the chip load stays roughly constant.
//
// PUSH-117 layers the strategy panel on top of that native call:
//   * Pick a stock + part body (forge bodies registry).
//   * Tool Ø (mm), stepover (% of Ø), stepdown (mm).
//   * Generate → calls forge.cam.adaptiveClear(stock, aabb, tool, params,
//     adaptive) → real native toolpath with { moveCount, cycleTimeSec,
//     estCuttingMm }.
//   * Renders a 3-row results table (moveCount, cycle time, cutting
//     length).
//
// Proof end-to-end through the real Electron UI:
//
//   00. Boot Electron and seed a 100×60×20 stock block + a smaller
//       40×40×10 part block via window.forge.makeBox.
//   01. Open the Adaptive Clearing panel via the tools.camAdaptive
//       menu action.
//   02. Pick the seeded stock + part bodies; set Ø=6, stepover=40%,
//       stepdown=3, z-top=20, z-bottom=5.
//   03. Click Generate → assert (a) no error chip, (b) results table
//       visible, (c) move count > 50 (per the kernel smoke test
//       contract), (d) cycle time > 0, (e) cutting length > 0.
//   04. Regression — open PUSH-98 (Drilling Pattern) and confirm the
//       upstream cam.drill batch still works end-to-end. This is the
//       brief's "regression push-98 (drilling)" gate.
//
// No stubs — the moveCount / cycleTimeSec / cuttingLengthMm values come
// from the native kernel toolpath produced by kernel.cam.adaptiveClear.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed stock + assert host surface)
//   - front (open panel + assert testids)
//   - top   (pick bodies + set params)
//   - right (Generate + assert native toolpath shape)
//   - iso   (PUSH-98 drilling regression + final close shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-117-cam-adaptive');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'cam-adaptive-session.mp4');

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
            || /push-117|adaptive|cam-adaptive|cam\.adaptive|cam|error|Error|exception|TypeError|crashed/i.test(t)) {
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
        console.error('[push-117] no .webm');
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
                console.log(`[push-117] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-117] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ──────────────────────────────────────────────── camera 1 / 5 — iso
test('00 — iso: boot + seed 100×60×20 stock + 40×40×10 part + assert host surface', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Seed two real native shapes — a 100×60×20 stock + 40×40×10 part.
    const seeded = await page.evaluate(() => {
        if (!window.forge?.makeBox || typeof window.__forgeAppendBody !== 'function') {
            return { ok: false, why: 'forge surface not ready' };
        }
        // Stock — centred at origin in XY, sitting on z=0 → z=20.
        const stockH = window.forge.makeBox(100, 60, 20);
        const stockId = `cam-adaptive-stock-${Date.now()}`;
        window.__forgeAppendBody({
            id: stockId, kind: 'native', handle: stockH,
            toolId: 'primitive.box',
            name: 'Adaptive Stock 100x60x20',
            aabb: [-50, -30, 0, 50, 30, 20],
        });
        // Part — smaller block centred at origin sitting on z=0 → z=10.
        const partH  = window.forge.makeBox(40, 40, 10);
        const partId = `cam-adaptive-part-${Date.now() + 1}`;
        window.__forgeAppendBody({
            id: partId, kind: 'native', handle: partH,
            toolId: 'primitive.box',
            name: 'Adaptive Part 40x40x10',
            aabb: [-20, -20, 0, 20, 20, 10],
        });
        return { ok: true, stockId, partId };
    });
    expect(seeded.ok).toBe(true);
    console.log('[push-117] seeded =', seeded.stockId, seeded.partId);
    await pause(500);
    await shot('bodies-seeded');

    // The host effect installs the imperative open/close surface +
    // headless helper at mount time — that's the proof CamAdaptivePanelHost
    // mounted from App.jsx.
    await page.waitForFunction(
        () => typeof window.__forgeOpenCamAdaptive === 'function'
              && typeof window.__forgeCloseCamAdaptive === 'function'
              && window.__forgeCamAdaptiveHelper
              && typeof window.__forgeCamAdaptiveHelper.runAdaptive === 'function',
        { timeout: 8000 },
    );

    // forge.cam.adaptiveClear is exposed as a real function (preload.js
    // line 203, guarded behind the kernel.cam.adaptiveClear surface).
    const camOk = await page.evaluate(
        () => typeof window.forge?.cam?.adaptiveClear === 'function',
    );
    expect(camOk).toBe(true);
});

// ──────────────────────────────────────────────── camera 2 / 5 — front
test('01 — front: open the Adaptive Clearing panel via tools.camAdaptive', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.camAdaptive');
    await page.waitForSelector('[data-testid="forge-cam-adaptive-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Sanity — the stock + part pickers and the three core numeric
    // inputs are all in the DOM by the time the panel becomes visible.
    await expect(page.locator('[data-testid="forge-cam-adaptive-stock"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-part"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-diameter"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-stepover"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-stepdown"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-ztop"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-zbottom"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-generate"]')).toBeVisible();
});

// ──────────────────────────────────────────────── camera 3 / 5 — top
test('02 — top: pick stock + part, set params (Ø=6, stepover=40, stepdown=3, z=20..5)', async () => {
    await cameraTo('top');

    // Pick the seeded stock.
    const stockOpt = await page.evaluate(() => {
        const sel = document.querySelector('[data-testid="forge-cam-adaptive-stock"]');
        if (!sel) return null;
        for (const o of sel.options) {
            if (o.value && o.value.startsWith('cam-adaptive-stock-')) return o.value;
        }
        for (const o of sel.options) { if (o.value) return o.value; }
        return null;
    });
    expect(stockOpt).not.toBeNull();
    await page.selectOption('[data-testid="forge-cam-adaptive-stock"]', stockOpt);

    // Pick the seeded part.
    const partOpt = await page.evaluate(() => {
        const sel = document.querySelector('[data-testid="forge-cam-adaptive-part"]');
        if (!sel) return null;
        for (const o of sel.options) {
            if (o.value && o.value.startsWith('cam-adaptive-part-')) return o.value;
        }
        for (const o of sel.options) { if (o.value) return o.value; }
        return null;
    });
    expect(partOpt).not.toBeNull();
    await page.selectOption('[data-testid="forge-cam-adaptive-part"]', partOpt);
    await pause(250);

    // Tool Ø = 6, stepover = 40 %, stepdown = 3 mm.
    await page.locator('[data-testid="forge-cam-adaptive-diameter"]').fill('6');
    await page.locator('[data-testid="forge-cam-adaptive-stepover"]').fill('40');
    await page.locator('[data-testid="forge-cam-adaptive-stepdown"]').fill('3');

    // z-top = 20, z-bottom = 5 (matches the kernel smoke test).
    await page.locator('[data-testid="forge-cam-adaptive-ztop"]').fill('20');
    await page.locator('[data-testid="forge-cam-adaptive-zbottom"]').fill('5');

    await pause(300);
    await shot('params-set');

    // The AABB status chip reports either 'auto · …' or a manual prompt.
    const aabbStatus = await page
        .locator('[data-testid="forge-cam-adaptive-aabb-status"]').innerText();
    console.log('[push-117] aabb status =', aabbStatus);
    expect(aabbStatus).toMatch(/Stock AABB/);
});

// ──────────────────────────────────────────────── camera 4 / 5 — right
test('03 — right: Generate → real native toolpath { moveCount, cycle, cutting } > 0', async () => {
    await cameraTo('right');

    await page.locator('[data-testid="forge-cam-adaptive-generate"]').click();
    await page.waitForSelector('[data-testid="forge-cam-adaptive-results"]',
        { state: 'visible', timeout: 12000 });
    await pause(400);
    await shot('toolpath-generated');

    // No error chip surfaced.
    const errCount = await page.locator('[data-testid="forge-cam-adaptive-error"]').count();
    if (errCount > 0) {
        const errTxt = await page.locator('[data-testid="forge-cam-adaptive-error"]').innerText();
        console.log('[push-117] adaptive error =', errTxt);
    }
    expect(errCount).toBe(0);

    // Three results rows — moveCount / cycleTimeSec / cuttingLength.
    await expect(page.locator('[data-testid="forge-cam-adaptive-row-moveCount"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-row-cycleTimeSec"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cam-adaptive-row-cuttingLength"]')).toBeVisible();

    const movesTxt = await page
        .locator('[data-testid="forge-cam-adaptive-value-moveCount"]').innerText();
    const cycleTxt = await page
        .locator('[data-testid="forge-cam-adaptive-value-cycleTimeSec"]').innerText();
    const cutTxt = await page
        .locator('[data-testid="forge-cam-adaptive-value-cuttingLength"]').innerText();

    const moves = Number(movesTxt.trim());
    const cycle = Number(cycleTxt.trim());
    const cut = Number(cutTxt.trim());

    console.log('[push-117] native moveCount =', moves,
                ' cycle =', cycle, 's',
                ' cuttingLength =', cut, 'mm');

    // Kernel-smoke contract (cam_adaptive_smoke.js): a 100×60×20 box,
    // 6 mm endmill, 4 mm stepover, zMax=20 → zMin=5 produces > 50 moves.
    // Our panel runs the same shape with stepover=40% × Ø=6 = 2.4 mm so
    // we expect even more moves — assert > 50 as the lower bound.
    expect(moves).toBeGreaterThan(50);
    expect(cycle).toBeGreaterThan(0);
    expect(cut).toBeGreaterThan(0);

    // Native window-side proof — the panel published the toolpath on
    // window so a follower can sanity-check it directly.
    const published = await page.evaluate(() => {
        const r = window.__forgeCamAdaptiveResult;
        if (!r || !r.ok) return null;
        return { moves: r.moveCount, cycle: r.cycleTimeSec, cut: r.cuttingLengthMm };
    });
    expect(published).not.toBeNull();
    expect(published.moves).toBeGreaterThan(50);

    // Headless helper end-to-end — runAdaptive() driven straight from the
    // helper surface (no UI) must also return ok with a real toolpath.
    const headless = await page.evaluate(() => {
        const helper = window.__forgeCamAdaptiveHelper;
        if (!helper || typeof helper.runAdaptive !== 'function') return null;
        const bodies = window.__forgeBodies || [];
        const stock = bodies.find((b) => b.id.startsWith('cam-adaptive-stock-')) || bodies[0];
        const part  = bodies.find((b) => b.id.startsWith('cam-adaptive-part-'))  || bodies[1] || bodies[0];
        if (!stock) return null;
        const params = helper.adaptiveDefaults({ diameter: 6 });
        params.zTop = 20; params.zBottom = 5;
        const r = helper.runAdaptive({ stock, part, params });
        return { ok: r.ok, moves: r.moveCount || 0,
                 cycle: r.cycleTimeSec || 0, error: r.error || null };
    });
    expect(headless).not.toBeNull();
    if (!headless.ok) console.log('[push-117] headless error =', headless.error);
    expect(headless.ok).toBe(true);
    expect(headless.moves).toBeGreaterThan(50);
});

// ──────────────────────────────────────────────── camera 5 / 5 — iso
test('04 — iso (close): PUSH-98 drilling regression + final shot', async () => {
    // Close the adaptive clearing panel.
    await page.evaluate(() => {
        window.__forgeCloseCamAdaptive?.();
    });
    await pause(300);

    // Brief mandate: regression PUSH-98 (drilling). Open the Drilling
    // Pattern panel, drop a couple of holes, and confirm the cam.drill
    // batched path still emits real moveCount.
    await platformMenuAction('tools.drillingPattern');
    await page.waitForSelector('[data-testid="forge-drilling-pattern-panel"]',
        { state: 'visible', timeout: 8000 });
    await pause(400);
    await shot('drilling-regression-open');

    // Pick the stock body that's already in the scene.
    const stockOpt = await page.evaluate(() => {
        const sel = document.querySelector('[data-testid="forge-drilling-pattern-stock"]');
        if (!sel) return null;
        for (const o of sel.options) {
            if (o.value && o.value.startsWith('cam-adaptive-stock-')) return o.value;
        }
        for (const o of sel.options) { if (o.value) return o.value; }
        return null;
    });
    expect(stockOpt).not.toBeNull();
    await page.selectOption('[data-testid="forge-drilling-pattern-stock"]', stockOpt);
    await pause(200);

    // Stock is 100×60×20 — z goes 0 → 20. Drill 6 mm holes 10 mm deep
    // from z=20 downward.
    await page.locator('[data-testid="forge-drilling-pattern-diameter"]').fill('6');
    await page.locator('[data-testid="forge-drilling-pattern-depth"]').fill('10');
    await page.locator('[data-testid="forge-drilling-pattern-ztop"]').fill('20');
    await pause(150);

    // Add 2 holes — small but enough to prove cam.drill still works.
    for (let i = 0; i < 2; i++) {
        await page.locator('[data-testid="forge-drilling-pattern-add-hole"]').click();
        await pause(120);
    }
    await page.locator('[data-testid="forge-drilling-pattern-hole-0-x"]').fill('15');
    await page.locator('[data-testid="forge-drilling-pattern-hole-0-y"]').fill('15');
    await page.locator('[data-testid="forge-drilling-pattern-hole-1-x"]').fill('-15');
    await page.locator('[data-testid="forge-drilling-pattern-hole-1-y"]').fill('-15');
    await pause(200);

    await page.locator('[data-testid="forge-drilling-pattern-generate"]').click();
    await page.waitForSelector('[data-testid="forge-drilling-pattern-results"]',
        { state: 'visible', timeout: 10000 });
    await pause(400);
    await shot('drilling-regression-generated');

    const drillErr = await page
        .locator('[data-testid="forge-drilling-pattern-error"]').count();
    expect(drillErr).toBe(0);

    const totalTxt = await page
        .locator('[data-testid="forge-drilling-pattern-total-moves"]').innerText();
    const totalMoves = Number((totalTxt.match(/(\d+)/) || [])[1] || 0);
    console.log('[push-117] PUSH-98 regression total moves =', totalMoves);
    expect(totalMoves).toBeGreaterThan(0);

    // Final iso frame so the .mp4 closes on a meaningful shot.
    await cameraTo('iso');
    await platformMenuAction('view.zoomFit');
    await pause(500);
    await shot('iso-close-final');
});
