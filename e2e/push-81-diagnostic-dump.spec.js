// PUSH-81 (Slice-49 / Diagnostic state dump panel).
//
// Up through PUSH-80 there was no support-friendly snapshot of "what
// Forge currently thinks it is" — the renderer hangs hundreds of
// `window.__forge*` globals (selection, camera, bodies, layers, sketch
// session, autosave state, …) but a bug report can't easily ship all
// of them in one file. PUSH-81 ships the Diagnostic State Dump panel:
// one big button → JSON snapshot of every `window.__forge*` global +
// the live viewport camera + the kernel version + the active selection,
// written to disk via the existing forge.dialog.saveFile + writeBlob
// bridge that BodyColors / ProjectFile / ActivityLog already use.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Assert the global surfaces are installed at host mount time:
//        - window.__forgeBuildDiagnosticReport (returns a snapshot)
//        - window.__forgeOpenDiagnosticDump / __forgeCloseDiagnosticDump
//      That's the proof the host effect ran even before the panel is
//      open.
//   3. Seed 1 real OCCT box via forge.makeBox so the diagnostic report
//      has a `bodiesCount === 1` and a non-empty globals['__forgeBodies'].
//   4. Override window.forge.dialog.saveFile to deterministically return
//      /tmp/push81.json (the writeBlob bridge stays real — we want to
//      prove the file actually lands on disk).
//   5. Open the panel via the tools.diagnostic menu action; the panel
//      mounts with data-has-report=false.
//   6. Click "Generate diagnostic report"; wait for the status text to
//      transition to "Saved → …", data-has-report flips to 'true', and
//      window.__forgeLastDiagnosticPath equals /tmp/push81.json.
//   7. Read the file from disk + parse as JSON; assert:
//        - report.version === 1
//        - report.bridges.hasSaveFile === true
//        - report.kernel.version is a non-empty string (the OCCT addon
//          publishes a semver-shaped string from kernel.version())
//        - report.bodiesCount === 1 (the one seeded box)
//        - globals['__forgeBodies'] is an Array with length 1
//        - report.camera.position is a length-3 finite number tuple
//        - report.diagnostics.windowForgeKeysScanned >= 20 (the shell
//          publishes many of them on bootstrap)
//        - report.ua is a non-empty string
//        - report.capturedAt parses as an ISO timestamp
//   8. Imperative-build path: call window.__forgeBuildDiagnosticReport()
//      and assert the returned shape matches the file's report — proves
//      the panel + the imperative surface walk the same window state.
//   9. PUSH-67 regression: open Measure via tools.measure and assert its
//      panel still mounts — DiagnosticDump is a portal sibling and must
//      not collide with other right-docked panels.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + assert global surface)
//   - front (seed box + assert bodies seeded)
//   - top   (open panel + override saveFile)
//   - right (click Generate + assert file lands on disk + parse JSON)
//   - iso   (imperative-build assertion + push-67 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-81-diagnostic-dump');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'diagnostic-dump-session.mp4');
const TARGET_PATH = '/tmp/push81.json';

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
    // Pre-clean the target so the existence assertion below is unambiguous.
    try { fs.unlinkSync(TARGET_PATH); } catch {}
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-81|diagnostic|Diagnostic|forge|error|Error/i.test(t)) {
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
        console.error('[push-81] no .webm');
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
                console.log(`[push-81] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-81] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global host surface installed', async () => {
    await cameraTo('iso');
    await shot('boot');
    // The host effect installs the imperative surfaces at mount time so
    // Archie / plugins / e2e can build a report without the panel being
    // visible. That's the proof the host mounted.
    await page.waitForFunction(
        () => typeof window.__forgeBuildDiagnosticReport === 'function'
           && typeof window.__forgeOpenDiagnosticDump === 'function'
           && typeof window.__forgeCloseDiagnosticDump === 'function',
        null, { timeout: 8000 });
    // The imperative builder works even before the panel is opened.
    const sanity = await page.evaluate(() => {
        const r = window.__forgeBuildDiagnosticReport();
        return {
            ok: !!r && r.version === 1,
            keysIncluded: r?.diagnostics?.windowForgeKeysIncluded ?? 0,
            keysScanned: r?.diagnostics?.windowForgeKeysScanned ?? 0,
            hasGlobals: r && typeof r.globals === 'object' && r.globals !== null,
        };
    });
    expect(sanity.ok).toBe(true);
    expect(sanity.hasGlobals).toBe(true);
    // The shell publishes a generous number of globals on bootstrap —
    // bodies / featureTree / selection / activeWb / theme / datums /
    // configurations / camera / scene / renderer / autosave / activity
    // log / sketch / + workbench close handles. 20 is a conservative
    // floor; the real count is in the hundreds.
    expect(sanity.keysScanned).toBeGreaterThan(20);
    expect(sanity.keysIncluded).toBeGreaterThan(0);
});

test('01 — seed 1 real OCCT box so the report has a non-trivial body count', async () => {
    await cameraTo('front');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') {
            return { error: 'forge.makeBox unavailable' };
        }
        const h = f.makeBox(50, 50, 50);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id: 'f-box-81', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 81',
            params: { width: 50, height: 50, distance: 50 },
        });
        return { handle: h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => Array.isArray(window.__forgeBodies)
           && window.__forgeBodies.filter((b) => b.kind === 'native').length >= 1,
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('02 — open Diagnostic Dump via tools.diagnostic menu action + override saveFile', async () => {
    await cameraTo('top');

    // Override the saveFile dialog to a deterministic path. The
    // writeBlob bridge stays real — we want the file to actually land
    // on /tmp so we can read it back from disk and parse the JSON.
    await page.evaluate((target) => {
        const f = window.forge || {};
        f.dialog = f.dialog || {};
        f.dialog.saveFile = async () => target;
        window.forge = f;
    }, TARGET_PATH);

    await platformMenuAction('tools.diagnostic');
    await page.waitForSelector('[data-testid="forge-diagnostic-dump-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Before clicking Generate, the panel should report has-report=false.
    const hasReportBefore = await page.locator(
        '[data-testid="forge-diagnostic-dump-panel"]').getAttribute('data-has-report');
    expect(hasReportBefore).toBe('false');

    // The generate button is enabled and reads the idle label.
    const btn = page.locator('[data-testid="forge-diagnostic-dump-generate"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('Generate diagnostic report');
});

test('03 — click Generate → file lands at /tmp/push81.json + parses as JSON + contains bodies', async () => {
    await cameraTo('right');

    // Pre-fire cleanup so the existence assertion is unambiguous.
    try { fs.unlinkSync(TARGET_PATH); } catch {}

    // Defensive re-install of the saveFile override — between tests the
    // page state survives, but other parallel beforeAll bootstraps or a
    // late-loading plugin might rewrite window.forge.dialog after our
    // test 02 set it. We restore the override here so the click below
    // hits the deterministic /tmp/push81.json path regardless.
    await page.evaluate((target) => {
        const f = window.forge || {};
        f.dialog = f.dialog || {};
        f.dialog.saveFile = async () => target;
        window.forge = f;
    }, TARGET_PATH);

    const btn = page.locator('[data-testid="forge-diagnostic-dump-generate"]');
    await expect(btn).toBeVisible();
    await btn.click();

    // The panel transitions through "Picking destination…" → "Writing…"
    // → "Saved → …". We wait for either Saved or an Error and bail
    // hard on the error path to surface the failure message.
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-diagnostic-dump-status"]');
        const s = el?.getAttribute('data-status-text') || '';
        return s.startsWith('Saved') || s.startsWith('Error');
    }, null, { timeout: 25000 });

    const statusText = await page.locator(
        '[data-testid="forge-diagnostic-dump-status"]')
        .getAttribute('data-status-text');
    console.log('[push-81] final status =', statusText);
    expect(statusText).toMatch(/^Saved →/);

    // Panel flips has-report → 'true' once the report has been built.
    const hasReportAfter = await page.locator(
        '[data-testid="forge-diagnostic-dump-panel"]')
        .getAttribute('data-has-report');
    expect(hasReportAfter).toBe('true');

    // The renderer publishes the last-written path on window.
    const publishedPath = await page.evaluate(() => window.__forgeLastDiagnosticPath || null);
    console.log('[push-81] window.__forgeLastDiagnosticPath =', publishedPath);
    expect(publishedPath).toBe(TARGET_PATH);

    // The file exists on disk. We allow a brief grace for the IPC
    // round-trip — same pattern as v4-project-roundtrip.spec.
    let appeared = false;
    for (let i = 0; i < 40; i += 1) {
        if (fs.existsSync(TARGET_PATH)) { appeared = true; break; }
        await new Promise((r) => setTimeout(r, 100));
    }
    expect(appeared, `${TARGET_PATH} should exist after Generate`).toBe(true);
    await shot('file-written');

    const raw = fs.readFileSync(TARGET_PATH, 'utf8');
    expect(raw.length).toBeGreaterThan(64);

    // Parse must succeed — that's the contract the support workflow relies on.
    let report;
    expect(() => { report = JSON.parse(raw); }).not.toThrow();

    // Schema assertions per the PUSH-81 brief.
    expect(report.version).toBe(1);
    expect(report.bridges).toBeTruthy();
    expect(report.bridges.hasSaveFile).toBe(true);
    expect(report.bridges.hasWriteBlob).toBe(true);

    // Kernel version came back from the OCCT addon via window.forge.version().
    expect(report.kernel).toBeTruthy();
    expect(report.kernel.available).toBe(true);
    expect(typeof report.kernel.version).toBe('string');
    expect(report.kernel.version.length).toBeGreaterThan(0);

    // The seeded body shows up.
    expect(report.bodiesCount).toBe(1);

    // The globals walk found __forgeBodies and it's an Array length 1.
    expect(report.globals).toBeTruthy();
    expect(Array.isArray(report.globals.__forgeBodies)).toBe(true);
    expect(report.globals.__forgeBodies.length).toBe(1);
    expect(report.globals.__forgeBodies[0].id).toBe('f-box-81');
    expect(report.globals.__forgeBodies[0].kind).toBe('native');
    expect(report.globals.__forgeBodies[0].handle).toBeGreaterThan(0);

    // The camera snapshot is present (the viewport publishes
    // window.__forgeCamera once the Three RendererPublisher mounts).
    expect(report.camera).toBeTruthy();
    if (report.camera.available) {
        expect(Array.isArray(report.camera.position)).toBe(true);
        expect(report.camera.position.length).toBe(3);
        for (const v of report.camera.position) {
            expect(Number.isFinite(v)).toBe(true);
        }
    }

    // Diagnostics block.
    expect(report.diagnostics).toBeTruthy();
    expect(report.diagnostics.windowForgeKeysScanned).toBeGreaterThan(20);
    expect(report.diagnostics.windowForgeKeysIncluded).toBeGreaterThan(0);
    expect(report.diagnostics.perKeyMaxChars).toBeGreaterThan(0);
    expect(report.diagnostics.keyLimit).toBeGreaterThan(0);
    expect(typeof report.diagnostics.buildTimeMs).toBe('number');

    // Capture metadata.
    expect(typeof report.ua).toBe('string');
    expect(report.ua.length).toBeGreaterThan(0);
    expect(typeof report.capturedAt).toBe('string');
    // ISO timestamp should parse to a valid Date.
    const iso = new Date(report.capturedAt);
    expect(Number.isFinite(iso.getTime())).toBe(true);
});

test('04 — imperative __forgeBuildDiagnosticReport walks the same state + push-67 regression', async () => {
    await cameraTo('iso');

    // Imperative-build path. The returned object should carry the same
    // bodies count + version as the file we just parsed. We don't
    // expect byte equality (camera quaternion / capturedAt tick along)
    // but the structural invariants should hold.
    const imperative = await page.evaluate(() => {
        const r = window.__forgeBuildDiagnosticReport();
        return {
            version: r.version,
            bodiesCount: r.bodiesCount,
            kernelAvailable: r.kernel?.available,
            kernelVersion: r.kernel?.version,
            cameraAvailable: r.camera?.available,
            bodiesLen: Array.isArray(r.globals?.__forgeBodies) ? r.globals.__forgeBodies.length : -1,
            keysScanned: r.diagnostics?.windowForgeKeysScanned ?? 0,
            keysIncluded: r.diagnostics?.windowForgeKeysIncluded ?? 0,
            bridgesSaveFile: r.bridges?.hasSaveFile,
        };
    });
    expect(imperative.version).toBe(1);
    expect(imperative.bodiesCount).toBe(1);
    expect(imperative.kernelAvailable).toBe(true);
    expect(typeof imperative.kernelVersion).toBe('string');
    expect(imperative.kernelVersion.length).toBeGreaterThan(0);
    expect(imperative.bodiesLen).toBe(1);
    expect(imperative.keysScanned).toBeGreaterThan(20);
    expect(imperative.keysIncluded).toBeGreaterThan(0);
    // saveFile was overridden in test 02 to a function returning TARGET_PATH,
    // so the bridges.hasSaveFile probe must still resolve to true.
    expect(imperative.bridgesSaveFile).toBe(true);

    // PUSH-67 regression: opening Measure via tools.measure must still
    // mount its panel — DiagnosticDumpPanelHost is a portal sibling and
    // must not collide with other right-docked panels.
    await platformMenuAction('tools.measure');
    await page.waitForSelector('[data-testid="forge-measure-panel"]',
                               { state: 'visible', timeout: 6000 });
    // Diagnostic dump panel must still be visible alongside Measure.
    const diagVisible = await page.locator(
        '[data-testid="forge-diagnostic-dump-panel"]').isVisible();
    expect(diagVisible).toBe(true);

    await shot('measure-coexists');
});
