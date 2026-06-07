// PUSH-99 (Slice-67 / Standard Parts Quick Insert).
//
// PUSH-52 (Slice-21) shipped the full StdPartsLibraryWorkbench: a
// searchable browser over the ISO/ANSI parametric catalogue served by
// the native `stdparts` kernel namespace (Forge-204). The workbench is
// the right surface for parameter-sweeping a catalogue entry — change
// the bolt length, pick a different bearing race width, etc. — but a
// real fastened-assembly session needs a tighter affordance: a *quick*
// picker for the five-or-six fasteners every mechanical drawing reaches
// for first.
//
// PUSH-99 ships exactly that picker — `StdPartsQuickInsertPanel` —
// driven by the `tools.stdPartsQuick` menu action. Eight preset
// buttons, each commits a real scene body at the world origin via the
// native stdparts kernel + OCCT STL round-trip (synthetic-mesh
// fallback).
//
// Proof end-to-end through the real UI:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Assert the host's window surfaces installed at mount time
//      (`__forgeOpenStdPartsQuickInsertPanel`,
//      `__forgeStdPartsQuickInsertHelper`, etc.) — proof the host
//      mounted from App.jsx BEFORE the panel was opened.
//   3. Open the panel via the `tools.stdPartsQuick` menu action.
//      Assert all eight preset buttons are visible.
//   4. Click the M6 × 20 hex bolt button. Assert __forgeBodies length
//      grew by exactly 1, the new body's `name` contains "M6", and
//      the body kind is one of {'native', 'synthetic'} (matching the
//      kernel STL round-trip contract).
//   5. PUSH-52 regression: open the full Standard Parts (parametric)
//      panel via the `tools.stdparts` menu action. Both panels must
//      stay mounted alongside each other — they are portal siblings
//      that must not collide.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + assert global surface)
//   - front (open panel + assert preset buttons)
//   - top   (click M6 bolt button → assert body commit)
//   - right (assert bus event + helper-API path)
//   - iso   (PUSH-52 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-99-std-parts-quick');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'std-parts-quick-session.mp4');

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
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /push-99|stdparts|stdPartsQuick|bolt|forge:std-parts-quick|error|Error|exception|TypeError|crashed/i.test(t)) {
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
        console.error('[push-99] no .webm');
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
                console.log(`[push-99] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-99] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + host surfaces installed + native stdparts available', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The host effect installs the imperative open/close + helper surface
    // at mount time, BEFORE the panel opens. That's the proof
    // StdPartsQuickInsertPanelHost mounted from App.jsx.
    await page.waitForFunction(
        () => typeof window.__forgeOpenStdPartsQuickInsertPanel  === 'function'
           && typeof window.__forgeCloseStdPartsQuickInsertPanel === 'function'
           && typeof window.__forgeStdPartsQuickInsertHelper     === 'object'
           && Array.isArray(window.__forgeStdPartsQuickInsertHelper.CATALOGUE),
        null, { timeout: 8000 });

    // The kernel itself must be reachable — without it, the panel can't
    // generate any mesh. Mirrors push-52's gate.
    const kernelOk = await page.evaluate(() => {
        const sp = window.forge && window.forge.stdparts;
        return !!(sp && typeof sp.makeBolt === 'function'
                     && typeof sp.specForMetricBolt === 'function'
                     && typeof window.__forgeAppendBody === 'function');
    });
    expect(kernelOk).toBe(true);

    const catalogue = await page.evaluate(
        () => window.__forgeStdPartsQuickInsertHelper.CATALOGUE);
    expect(catalogue.length).toBe(8);
    // The contract: there's an M6 × 20 hex bolt preset.
    const m6 = catalogue.find((c) => c.id === 'bolt-m6-20');
    expect(m6).toBeTruthy();
    expect(m6.family).toBe('bolt');
    expect(m6.mCode).toBe(6);
    expect(m6.length).toBe(20);
    expect(m6.name).toMatch(/M6/);
});

test('01 — open panel via tools.stdPartsQuick menu action + assert all 8 buttons', async () => {
    await cameraTo('front');

    await platformMenuAction('tools.stdPartsQuick');
    await page.waitForSelector('[data-testid="forge-stdparts-quick-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All eight preset buttons render.
    const ids = ['bolt-m6-20', 'bolt-m8-25', 'nut-m6', 'nut-m8',
                 'washer-m6', 'washer-m8', 'bearing-6800-2rs', 'gear-m2-z20'];
    for (const id of ids) {
        await expect(page.locator(
            `[data-testid="forge-stdparts-quick-insert-${id}"]`)).toBeVisible();
    }

    // The M6 × 20 button advertises the M6 SKU in its visible label,
    // so manual search-by-name actually works.
    const m6Text = await page.locator(
        '[data-testid="forge-stdparts-quick-insert-bolt-m6-20"]').innerText();
    expect(m6Text).toMatch(/M6/);
});

test('02 — click M6 × 20 bolt → 1 new body commits with name containing "M6"', async () => {
    await cameraTo('top');

    const before = await page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0);

    await page.locator('[data-testid="forge-stdparts-quick-insert-bolt-m6-20"]').click({
        force: true,
    });

    // Wait until the panel reports it remembered the insertion (status
    // chip shows for the latest entry) — that confirms the click handler
    // returned and React committed.
    await page.waitForSelector('[data-testid="forge-stdparts-quick-status"]',
                               { state: 'visible', timeout: 8000 });
    await shot('m6-bolt-inserted');

    // The error chip must NOT be present (no kernel failure path).
    const errCount = await page.locator('[data-testid="forge-stdparts-quick-error"]').count();
    if (errCount > 0) {
        const e = await page.locator('[data-testid="forge-stdparts-quick-error"]').innerText().catch(() => '');
        console.log('[push-99] quick-insert error =', e);
    }
    expect(errCount).toBe(0);

    // __forgeBodies grew by exactly one.
    await expect.poll(async () => page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0),
        { timeout: 10000 }).toBe(before + 1);

    // Inspect the committed body.
    const info = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        const b = arr[arr.length - 1];
        return {
            kind:      b && b.kind,
            handle:    b && b.handle,
            name:      b && b.name,
            family:    b && b.family,
            sourceId:  b && b.sourceId,
            toolId:    b && b.toolId,
            hasMesh:   !!(b && b.mesh && b.mesh.positions && b.mesh.positions.length),
        };
    });
    console.log('[push-99] committed body =', JSON.stringify(info));
    expect(['native', 'synthetic']).toContain(info.kind);
    // Contract: the body name carries the M-code so future selection +
    // grep workflows can resolve "the M6 bolts" without joining tables.
    expect(info.name).toMatch(/M6/);
    expect(info.family).toBe('bolt');
    expect(info.sourceId).toBe('bolt-m6-20');
    expect(info.toolId).toBe('tools.stdPartsQuick');

    // The status chip echoes the kind (panel + helper agree).
    const statusKind = (await page.locator(
        '[data-testid="forge-stdparts-quick-status-kind"]').innerText()).trim();
    expect(['native', 'synthetic']).toContain(statusKind);

    // Renders in the scene.
    const meshes = await page.evaluate(() => {
        try {
            const s = window.__forgeScene;
            let n = 0; s && s.traverse((o) => { if (o.isMesh) n++; });
            return n;
        } catch { return 0; }
    });
    console.log('[push-99] scene mesh count =', meshes);
    expect(meshes).toBeGreaterThan(0);
});

test('03 — helper-API path: bus event fires + native mesh has positive triangle count', async () => {
    await cameraTo('right');

    // The PUSH-99 contract publishes a forge:std-parts-quick-insert
    // CustomEvent each time the panel commits a body. Subscribe before
    // we click the next preset (M8 bolt) so we can assert the event
    // delivered with the right detail.
    await page.evaluate(() => {
        window.__push99Events = [];
        window.__push99Listener = (e) => {
            window.__push99Events.push(e.detail);
        };
        window.addEventListener('forge:std-parts-quick-insert', window.__push99Listener);
    });

    const before = await page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0);

    await page.locator('[data-testid="forge-stdparts-quick-insert-bolt-m8-25"]').click({
        force: true,
    });
    await pause(800);
    await shot('m8-bolt-inserted');

    await expect.poll(async () => page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0),
        { timeout: 10000 }).toBe(before + 1);

    const evDetail = await page.evaluate(() => {
        const evs = window.__push99Events || [];
        return evs.length ? evs[evs.length - 1] : null;
    });
    console.log('[push-99] bus event =', JSON.stringify(evDetail));
    expect(evDetail).toBeTruthy();
    expect(evDetail.entryId).toBe('bolt-m8-25');
    expect(evDetail.family).toBe('bolt');
    expect(evDetail.name).toMatch(/M8/);
    expect(['native', 'synthetic']).toContain(evDetail.kind);

    // Headless helper-API path: __forgeStdPartsQuickInsertHelper exposes
    // the pure generator so plugins + Archie tool calls can drive the
    // same kernel call without React mounted. Sanity-check the mesh
    // has a positive triangle count + a valid vertex array.
    const sanity = await page.evaluate(() => {
        const h = window.__forgeStdPartsQuickInsertHelper;
        const m6 = h.CATALOGUE.find((c) => c.id === 'bolt-m6-20');
        const mesh = h.generatePart(m6);
        return {
            verts: mesh.positions.length / 3,
            tris:  mesh.indices.length / 3,
            indicesOK: mesh.indices.length % 3 === 0,
            positionsOK: mesh.positions.length % 3 === 0,
        };
    });
    console.log('[push-99] headless gen sanity =', JSON.stringify(sanity));
    expect(sanity.verts).toBeGreaterThan(0);
    expect(sanity.tris).toBeGreaterThan(0);
    expect(sanity.indicesOK).toBe(true);
    expect(sanity.positionsOK).toBe(true);

    // The committed body for the M8 bolt also carries "M8" in its name.
    const m8Info = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        const last = arr[arr.length - 1];
        return { name: last && last.name, sourceId: last && last.sourceId };
    });
    expect(m8Info.name).toMatch(/M8/);
    expect(m8Info.sourceId).toBe('bolt-m8-25');
});

test('04 — PUSH-52 regression: full parametric panel still opens alongside Quick Insert', async () => {
    await cameraTo('iso');

    // PUSH-52 (Slice-21) regression: opening the full Standard Parts
    // catalogue via `tools.stdparts` must still mount its panel.
    // Quick Insert is a portal sibling — it must not collide with the
    // parametric browser. Both panels are right-docked, but each is
    // tested independently for visibility (overlap is acceptable; the
    // contract is that both mount + remain reachable).
    await platformMenuAction('tools.stdparts');
    await page.waitForSelector('[data-testid="forge-stdparts-panel"]',
                               { state: 'visible', timeout: 6000 });

    const quickVisible = await page.locator(
        '[data-testid="forge-stdparts-quick-panel"]').isVisible();
    expect(quickVisible).toBe(true);

    const parametricVisible = await page.locator(
        '[data-testid="forge-stdparts-panel"]').isVisible();
    expect(parametricVisible).toBe(true);

    // The full parametric browser still reaches the same kernel — pick
    // any M8 row and assert it's there. Confirms the regression hadn't
    // wiped out the full browser's row generation either.
    await expect(page.locator('[data-testid="forge-stdparts-row-bolt-m8"]'))
        .toBeVisible({ timeout: 4000 });

    await shot('both-panels-open');

    // Both panels track separate state.
    const lastQuickEntry = await page.locator(
        '[data-testid="forge-stdparts-quick-panel"]').getAttribute('data-last-entry');
    // After two inserts (M6 then M8) data-last-entry reflects the M8.
    expect(lastQuickEntry).toBe('bolt-m8-25');
});
