// PUSH-98 (Slice-66) — CAM Drilling Pattern panel.
//
// PUSH-46 wired the basic CAM Manufacturing workbench: stock → strategy
// op → generate → toolpath moves > 0. Driving a batched drilling op from
// that flow requires walking the strategy picker → Add Op → tweak holes
// table → Generate cycle for every single hole. PUSH-98 collapses that
// to a single panel: pick a stock body, fill in N (x, y, depth, dia)
// rows, optionally Auto-Import every circular edge from the body via
// forge.direct.edgeSegments, then one click runs forge.cam.drill on the
// whole batch and emits real native G-code via forge.cam.gcode.toGcode.
//
// Proof end-to-end through the real UI:
//   1. Boot Electron and seed a 100×100×30 stock block via window.forge.makeBox.
//   2. Open the Drilling Pattern panel via the tools.drillingPattern menu action.
//   3. Pick the seeded block as stock; set default Ø=6, depth=10, zTop=30.
//   4. Add 4 holes at the brief-specified corners (15,15)/(85,15)/(85,85)/(15,85).
//   5. Click Generate → a real toolpath comes back from the native
//      forge.cam.drill kernel call with moveCount > 0 per hole row.
//   6. Regression — also bring up the original CAM (Manufacturing) workbench
//      (PUSH-46) and assert the existing Profile op + Generate still works
//      so we haven't broken the upstream surface.
//
// No stubs: moveCount comes from the native kernel toolpath produced by
// kernel.cam.drill (preload.js:197 → window.forge.cam.drill).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso     (boot + assert global surface)
//   - front   (open panel + assert host wired)
//   - top     (pick stock + fill hole table)
//   - right   (Generate + assert per-row moveCount > 0)
//   - iso     (PUSH-46 regression + final shot, framed close)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-98-drilling-pattern');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'drilling-pattern-session.mp4');

const HOLES = [
    { x: 15, y: 15 }, { x: 85, y: 15 },
    { x: 85, y: 85 }, { x: 15, y: 85 },
];
const DIAMETER = 6;
const DEPTH    = 10;
const Z_TOP    = 30;

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
            || /push-98|drilling|drill|cam|error|Error|exception|TypeError|crashed/i.test(t)) {
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
        console.error('[push-98] no .webm');
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
                console.log(`[push-98] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-98] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ────────────────────────────────────────────────────── camera 1 / 5 — iso
test('00 — iso: boot + seed 100×100×30 stock block + assert host surface', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Seed the stock as a real native box via window.forge.makeBox.
    const stockSeeded = await page.evaluate(() => {
        if (!window.forge?.makeBox || typeof window.__forgeAppendBody !== 'function') {
            return { ok: false, why: 'forge surface not ready' };
        }
        const h = window.forge.makeBox(100, 100, 30);
        const id = `drilling-stock-${Date.now()}`;
        window.__forgeAppendBody({
            id, kind: 'native', handle: h,
            toolId: 'primitive.box', name: 'Drilling Stock 100x100x30',
        });
        return { ok: true, id };
    });
    expect(stockSeeded.ok).toBe(true);
    await pause(500);
    await shot('stock-seeded');

    // The host effect installs the imperative open/close surface at mount
    // time — that's the proof DrillingPatternPanelHost mounted from App.jsx.
    await page.waitForFunction(
        () => typeof window.__forgeOpenDrillingPattern === 'function'
              && typeof window.__forgeCloseDrillingPattern === 'function',
        { timeout: 8000 },
    );
});

// ────────────────────────────────────────────────────── camera 2 / 5 — front
test('01 — front: open the Drilling Pattern panel via the tools.drillingPattern action', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.drillingPattern');
    await page.waitForSelector('[data-testid="forge-drilling-pattern-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Sanity — the stock picker, hole-count badge, and three numeric inputs
    // are all in the DOM by the time the panel becomes visible.
    await expect(page.locator('[data-testid="forge-drilling-pattern-stock"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drilling-pattern-diameter"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drilling-pattern-depth"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drilling-pattern-ztop"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drilling-pattern-add-hole"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drilling-pattern-generate"]')).toBeVisible();
});

// ────────────────────────────────────────────────────── camera 3 / 5 — top
test('02 — top: pick stock + set defaults + add 4 corner holes', async () => {
    await cameraTo('top');

    // The select auto-populates from window.__forgeBodies. Force the
    // freshly seeded stock to be the active option.
    const stockOptVal = await page.evaluate(() => {
        const sel = document.querySelector('[data-testid="forge-drilling-pattern-stock"]');
        if (!sel) return null;
        // Pick the first non-empty option (the seeded stock).
        for (const o of sel.options) {
            if (o.value && o.value.startsWith('drilling-stock-')) return o.value;
        }
        // Fall back to anything that isn't the empty placeholder.
        for (const o of sel.options) { if (o.value) return o.value; }
        return null;
    });
    expect(stockOptVal).not.toBeNull();
    await page.selectOption('[data-testid="forge-drilling-pattern-stock"]', stockOptVal);
    await pause(200);

    // Defaults — Ø = 6, depth = 10, z-top = 30.
    await page.locator('[data-testid="forge-drilling-pattern-diameter"]')
              .fill(String(DIAMETER));
    await page.locator('[data-testid="forge-drilling-pattern-depth"]')
              .fill(String(DEPTH));
    await page.locator('[data-testid="forge-drilling-pattern-ztop"]')
              .fill(String(Z_TOP));
    await pause(150);
    await shot('defaults-set');

    // Add 4 holes at the brief-specified corners.
    for (let i = 0; i < HOLES.length; i++) {
        await page.locator('[data-testid="forge-drilling-pattern-add-hole"]').click();
        await pause(120);
    }
    // Fill in the X / Y values for each row. The depth + Ø were already
    // applied from the defaults at row-add time.
    for (let i = 0; i < HOLES.length; i++) {
        await page.locator(`[data-testid="forge-drilling-pattern-hole-${i}-x"]`)
                  .fill(String(HOLES[i].x));
        await page.locator(`[data-testid="forge-drilling-pattern-hole-${i}-y"]`)
                  .fill(String(HOLES[i].y));
    }
    await pause(200);
    await shot('holes-filled');

    // The hole count + row count both report 4 by the end.
    const txt = await page.locator('[data-testid="forge-drilling-pattern-hole-count"]')
                          .innerText();
    expect(txt).toMatch(/Holes:\s*4/);
    const rows = await page.locator('[data-testid^="forge-drilling-pattern-hole-row-"]').count();
    expect(rows).toBe(4);
});

// ────────────────────────────────────────────────────── camera 4 / 5 — right
test('03 — right: Generate → 4 native toolpaths each with moveCount > 0', async () => {
    await cameraTo('right');

    await page.locator('[data-testid="forge-drilling-pattern-generate"]').click();
    await page.waitForSelector('[data-testid="forge-drilling-pattern-results"]',
        { state: 'visible', timeout: 10000 });
    await pause(400);
    await shot('toolpaths-generated');

    // No error chip surfaced after a successful Generate.
    const errCount = await page.locator('[data-testid="forge-drilling-pattern-error"]')
                                .count();
    if (errCount > 0) {
        const errTxt = await page.locator('[data-testid="forge-drilling-pattern-error"]')
                                 .innerText();
        console.log('[push-98] drill error =', errTxt);
    }
    expect(errCount).toBe(0);

    // Results table — assert exactly 4 rows back, each with moveCount > 0.
    const resultRows = await page
        .locator('[data-testid^="forge-drilling-pattern-result-row-"]').count();
    expect(resultRows).toBe(HOLES.length);

    for (let i = 0; i < HOLES.length; i++) {
        const movesTxt = await page
            .locator(`[data-testid="forge-drilling-pattern-result-${i}-moves"]`)
            .innerText();
        const moves = Number(movesTxt.trim());
        console.log(`[push-98] hole ${i + 1} moveCount = ${moves}`);
        expect(moves).toBeGreaterThan(0);
    }

    // Native window-side proof — the panel published the per-hole results
    // on window so a follower can sanity-check them.
    const published = await page.evaluate(
        () => Array.isArray(window.__forgeDrillingPatternResults)
                ? window.__forgeDrillingPatternResults.length : -1,
    );
    expect(published).toBe(HOLES.length);

    // The aggregate "total moves" chip reads back with a non-zero value.
    const totalTxt = await page
        .locator('[data-testid="forge-drilling-pattern-total-moves"]').innerText();
    const totalMoves = Number((totalTxt.match(/(\d+)/) || [])[1] || 0);
    expect(totalMoves).toBeGreaterThan(0);

    // G-code emitted by forge.cam.gcode.toGcode — at least one G-code line.
    const gcodeVisible = await page
        .locator('[data-testid="forge-drilling-pattern-gcode"]').count();
    expect(gcodeVisible).toBeGreaterThan(0);
    const gcodeTxt = await page
        .locator('[data-testid="forge-drilling-pattern-gcode"]').innerText();
    expect(gcodeTxt.length).toBeGreaterThan(0);
    console.log('[push-98] gcode preview (first 120 chars) =', gcodeTxt.slice(0, 120));
});

// ────────────────────────────────────────────────────── camera 5 / 5 — iso
test('04 — iso (close): PUSH-46 CAM regression + final shot', async () => {
    // Close the drilling pattern panel first to avoid overlap.
    await page.evaluate(() => {
        window.__forgeCloseDrillingPattern?.();
    });
    await pause(300);

    // Open the original CAM Manufacturing workbench from PUSH-46 — assert
    // the long-standing Profile op pipeline is still intact.
    await platformMenuAction('tools.cam');
    await page.waitForSelector('[data-testid="forge-cam-panel"]',
        { state: 'visible', timeout: 8000 });
    await pause(400);
    await shot('cam-panel-regression');

    // Switch to the Ops tab, add a Profile, Generate.
    const opsTab = page.locator('button:has-text("Ops")');
    if (await opsTab.count() > 0) {
        await opsTab.first().click().catch(() => {});
        await pause(300);
    }
    await page.locator('[data-testid="forge-cam-add-profile"]').click();
    await pause(400);
    await page.locator('[data-testid="forge-cam-generate"]').click();
    await pause(800);

    const summary = page.locator('[data-testid="forge-cam-op-summary"]');
    await expect(summary).toBeVisible();
    const txt = await summary.innerText();
    console.log('[push-98] PUSH-46 regression summary =', txt);
    const moves = Number((txt.match(/(\d+)\s*moves/) || [])[1] || 0);
    expect(moves).toBeGreaterThan(0);

    // Final iso frame (close-up) so the .mp4 closes on a meaningful shot.
    await cameraTo('iso');
    await platformMenuAction('view.zoomFit');
    await pause(500);
    await shot('iso-close-final');
});
