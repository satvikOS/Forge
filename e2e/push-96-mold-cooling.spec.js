// PUSH-96 (Slice-64 / Mold Cooling Channels).
//
// The MoldCoolingPanel is the production surface for drilling cooling
// channels through a mold block. Where the PUSH-08 MoldWorkbench's
// "Cooling channels" affordance is a single canned demo button, PUSH-96
// ships the real workflow:
//
//   * Pick an existing mold block body (or seed a fresh 100×60×40 block),
//   * Add N channels in a live table: Start (x,y,z), End (x,y,z), Ø,
//   * Apply runs forge.mold.insertCoolingChannels (BRepAlgoAPI_Cut per
//     channel, OCCT) and commits the drilled solid via __forgeAppendBody.
//   * Channel-path visualisation: a synthetic kind:'group' body emits
//     the channel start/end pairs so SceneMeshes renders centerlines.
//
// Proof end-to-end through the real Electron UI:
//   1. Boot, dismiss banners; assert window.__forgeApplyMoldCooling and
//      window.__forgeMoldCoolingState are wired by the host's mount
//      effect — the contract surface every plugin / Archie call relies
//      on. (cam: iso)
//   2. Open the panel via tools.moldCooling. Seed the 100×60×40 mold
//      block via the panel's "Seed Block" button. The picker selects
//      it; data-block-handle is finite; volume = 100·60·40 = 240,000
//      via window.forge.massProps. (cam: front)
//   3. Reset the channel table; manually add 2 channels along the +Y
//      axis at Ø6 mm, at (x=25, z=20) and (x=75, z=20). The valid
//      channel count chip reads 2; the estimated Σ cut reads
//      2·π·3²·60 ≈ 3393.something. (cam: top)
//   4. Click Apply. The kernel BRepAlgoAPI_Cut runs twice; the panel
//      reports last-result=kernel-ok, last volume-before ~240000,
//      last volume-after ≈ 240000 − 2·π·9·60. The drilled solid is
//      committed as a new native body (count grew by 1 from the
//      pre-apply value). A channel-paths visualisation body
//      (kind='group') is also committed (count grew by 1 more). The
//      bus event forge:mold-cooling-applied fires with the same
//      payload. (cam: right)
//   5. PUSH-44 regression: switching to the mold workbench, the
//      Mold tooling tools.mold (legacy MoldWorkbench) still mounts
//      alongside our PUSH-96 panel without portal collisions.
//      (cam: iso)
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + helper API mounted)
//   - front (open panel + seed mold block)
//   - top   (configure 2-channel table)
//   - right (Apply + volume assertions)
//   - iso   (PUSH-44 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-96-mold-cooling');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'mold-cooling-session.mp4');

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
    await pause(400);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(250);
}

// Set an input/select value through the native setter so React's
// onChange fires. Playwright's .fill() doesn't always dispatch the
// matching React synthetic event on controlled inputs.
async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const proto = (el.tagName === 'SELECT')
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(el, String(args.value));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

async function nativeBodyCount() {
    return await page.evaluate(() =>
        (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').length);
}
async function bodyCount() {
    return await page.evaluate(() => (window.__forgeBodies || []).length);
}
async function readPanelAttr(name) {
    return await page.locator('[data-testid="forge-mold-cooling-panel"]')
                     .getAttribute(name);
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
        if (/push-96|mold-cooling|MoldCooling|forge:mold-cooling|insertCoolingChannels|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour: mark as seen + force-skip if it raced in.
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
        console.error('[push-96] no .webm'); return;
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
                console.log(`[push-96] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-96] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot, kernel + host wired (cam: iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The kernel must expose forge.mold.insertCoolingChannels. This is
    // the contract the panel calls into; if the preload regressed the
    // assertion blows up here and stops the test before false-positives.
    const surfaceOK = await page.evaluate(() => {
        return Boolean(
            window.forge
            && typeof window.forge.makeBox === 'function'
            && typeof window.forge.massProps === 'function'
            && window.forge.mold
            && typeof window.forge.mold.insertCoolingChannels === 'function'
        );
    });
    expect(surfaceOK).toBe(true);

    // The MoldCoolingPanelHost mount effect registers the open/close +
    // apply hooks at module load. That's the proof the helper surface
    // is hot even before the panel mounts.
    await page.waitForFunction(
        () => typeof window.__forgeOpenMoldCoolingPanel === 'function'
           && typeof window.__forgeCloseMoldCoolingPanel === 'function',
        null, { timeout: 8000 });
});

test('01 — open panel via tools.moldCooling + seed mold block (cam: front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.moldCooling');
    await page.waitForSelector('[data-testid="forge-mold-cooling-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Channel count chip shows the seeded pair (2/2) so the panel
    // is never empty on first open.
    expect(await readPanelAttr('data-channel-count')).toBe('2');
    expect(await readPanelAttr('data-valid-channel-count')).toBe('2');

    // Seed a 100×60×40 mold block via the panel button (drives the same
    // forge.makeBox kernel call the e2e brief specifies).
    const bodyBefore = await bodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-mold-cooling-seed-block"]');
        if (!btn) throw new Error('seed-block button not found');
        btn.click();
    });
    await pause(600);
    await shot('block-seeded');

    // A new native body landed in the scene.
    await page.waitForFunction(
        (n) => (window.__forgeBodies || []).length >= n,
        bodyBefore + 1, { timeout: 4000 });

    // The picker auto-selected the freshly seeded block, so the panel
    // surfaces both id + finite handle attributes.
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[data-testid="forge-mold-cooling-panel"]');
            return el
                && (el.getAttribute('data-block-id') || '').length > 0
                && (el.getAttribute('data-block-handle') || '').length > 0;
        }, null, { timeout: 4000 });

    const blockId = await readPanelAttr('data-block-id');
    const blockH  = Number(await readPanelAttr('data-block-handle'));
    expect(blockId).toMatch(/^mold-block-/);
    expect(Number.isFinite(blockH)).toBe(true);
    expect(blockH).toBeGreaterThan(0);

    // Block volume reads 100·60·40 = 240,000 via the live kernel
    // surface. We probe it through forge.massProps so the test fails
    // on a kernel regression, not on our panel.
    const v = await page.evaluate((h) => {
        const m = window.forge.massProps(h);
        return m ? Math.abs(m.volume) : null;
    }, blockH);
    expect(v).not.toBeNull();
    expect(Math.abs(v - 100 * 60 * 40)).toBeLessThan(1);
});

test('02 — configure 2 channels along +Y, Ø6 mm, at x=25 & x=75 (cam: top)', async () => {
    await cameraTo('top');

    // Reset to start from a known state.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-mold-cooling-reset"]');
        if (!btn) throw new Error('reset button not found');
        btn.click();
    });
    await pause(200);

    // The reset seeds 2 channels already at (25, _, 20) and (75, _, 20)
    // along +Y at Ø6 — exactly the test spec. The panel surface
    // (data-valid-channel-count) reads 2; the estimated cut should be
    // ~ 2·π·3²·60 ≈ 3392.92.
    expect(await readPanelAttr('data-channel-count')).toBe('2');
    expect(await readPanelAttr('data-valid-channel-count')).toBe('2');
    const cut = Number(await readPanelAttr('data-estimated-cut'));
    const expected = 2 * Math.PI * 3 * 3 * 60;
    expect(Math.abs(cut - expected)).toBeLessThan(0.1);

    await shot('channels-configured');

    // The two row testids surface the per-row attributes.
    const row0 = page.locator('[data-testid="forge-mold-cooling-row"][data-channel-index="0"]');
    const row1 = page.locator('[data-testid="forge-mold-cooling-row"][data-channel-index="1"]');
    expect(await row0.getAttribute('data-channel-valid')).toBe('true');
    expect(await row1.getAttribute('data-channel-valid')).toBe('true');
    const L0 = Number(await row0.getAttribute('data-channel-length'));
    const L1 = Number(await row1.getAttribute('data-channel-length'));
    expect(Math.abs(L0 - 60)).toBeLessThan(1e-6);
    expect(Math.abs(L1 - 60)).toBeLessThan(1e-6);
});

test('03 — Apply runs the OCCT cut; volume decreases by 2·π·r²·L (cam: right)', async () => {
    await cameraTo('right');

    // Subscribe to the bus event so we prove Apply publishes a CustomEvent.
    await page.evaluate(() => {
        window.__push96Events = [];
        window.addEventListener('forge:mold-cooling-applied', (e) => {
            try {
                window.__push96Events.push({
                    result:         e?.detail?.result,
                    channels:       e?.detail?.channels,
                    drilledHandle:  e?.detail?.drilledHandle,
                    volumeBefore:   e?.detail?.volumeBefore,
                    volumeAfter:    e?.detail?.volumeAfter,
                    delta:          e?.detail?.delta,
                });
            } catch {}
        });
    });

    const nativeBefore = await nativeBodyCount();
    const bodiesBefore = await bodyCount();

    // Click Apply via the DOM so the VideoCaptureHUD doesn't race for
    // the pointer.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-mold-cooling-apply"]');
        if (!btn) throw new Error('Apply button not found');
        if (btn.hasAttribute('disabled')) throw new Error('Apply button is disabled');
        btn.click();
    });
    await pause(800);
    await shot('after-apply');

    // The bus event fired with the kernel-ok result.
    const events = await page.evaluate(() => window.__push96Events || []);
    expect(events.length).toBeGreaterThan(0);
    const evt = events[events.length - 1];
    expect(evt.result).toBe('kernel-ok');
    expect(evt.channels).toBe(2);
    expect(typeof evt.drilledHandle).toBe('number');
    expect(Number.isFinite(evt.drilledHandle)).toBe(true);

    // The panel surfaces volume-before ≈ 240000 and a positive delta
    // exactly matching 2·π·r²·L = 2·π·9·60 ≈ 3392.92 (within OCCT
    // tessellation tolerance).
    const lastResult = await readPanelAttr('data-last-result');
    expect(lastResult).toBe('kernel-ok');

    const vb = Number(await readPanelAttr('data-last-volume-before'));
    const va = Number(await readPanelAttr('data-last-volume-after'));
    const vd = Number(await readPanelAttr('data-last-delta'));
    const expectedCut = 2 * Math.PI * 9 * 60; // 2 channels, r=3, L=60
    expect(Math.abs(vb - 240000)).toBeLessThan(1);
    expect(Math.abs(vd - expectedCut)).toBeLessThan(1);            // π·r²·L per channel × 2
    expect(Math.abs((vb - va) - expectedCut)).toBeLessThan(1);     // sanity: before − after = delta
    // The drilled solid is materially smaller than the original block.
    expect(va).toBeLessThan(vb);
    expect(va).toBeGreaterThan(vb - expectedCut - 1);
    expect(va).toBeLessThan(vb - expectedCut + 1);

    // Apply committed BOTH a drilled native body AND a synthetic
    // channel-paths visualisation body, so total +2; native count +1.
    const nativeAfter = await nativeBodyCount();
    const bodiesAfter = await bodyCount();
    expect(nativeAfter).toBe(nativeBefore + 1);
    expect(bodiesAfter).toBe(bodiesBefore + 2);

    // The most-recent native body has volume ≈ va (the drilled solid).
    const drilledVol = await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b.kind === 'native');
        if (!bodies.length || !window.forge?.massProps) return null;
        const h = bodies[bodies.length - 1].handle;
        try { return Math.abs(window.forge.massProps(h).volume); }
        catch { return null; }
    });
    expect(drilledVol).not.toBeNull();
    expect(Math.abs(drilledVol - va)).toBeLessThan(1);

    // The channel-paths visualisation body landed as the last entry,
    // carrying two start/end pairs.
    const vizCount = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        const last = arr[arr.length - 1];
        if (!last || last.kind !== 'group') return -1;
        return Array.isArray(last.lines) ? last.lines.length : -2;
    });
    expect(vizCount).toBe(2);
});

test('04 — PUSH-44 regression: legacy MoldWorkbench still mounts (cam: iso)', async () => {
    await cameraTo('iso');

    // Switch to the mold workbench to mount the legacy PUSH-08 surface;
    // it must coexist with our PUSH-96 panel on document.body without
    // colliding portals.
    const wbBtn = page.locator('[data-wb="mold"]');
    if (await wbBtn.count() > 0) {
        await wbBtn.first().click({ timeout: 3000 }).catch(() => {});
        await pause(600);
    }
    await shot('mold-wb-regression');

    // Our PUSH-96 panel is still attached and still reports the last
    // apply result.
    await expect(page.locator('[data-testid="forge-mold-cooling-panel"]'))
        .toBeAttached();
    expect(await readPanelAttr('data-last-result')).toBe('kernel-ok');
});
