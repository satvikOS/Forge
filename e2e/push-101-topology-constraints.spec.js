// PUSH-101 (Slice-69) — Topology Optimisation smart-constraints panel.
//
// Up through PUSH-49 the SIMP solver could optimise a density field +
// materialise an iso-surface body, but the design domain had no concept
// of KEEP / REMOVE regions and the only knob exposed was the volume
// fraction. This slice ships a dedicated Topology Constraints panel
// that gathers the four real-world TO inputs into one config:
//
//   1. **Active body** — the design domain (an existing native body).
//   2. **Keep zones** — voxels that MUST stay solid (load + boundary
//      footprints). Specified as bbox(min,max) or sphere(center,radius).
//   3. **Remove zones** — voxels that MUST stay void (bolt-hole
//      envelopes, hand-clearance pockets). Same shape as keep zones.
//   4. **Filter radius / volume fraction / target compliance** — the
//      three numerical knobs that drive the OC update.
//
// On Save the validated record is published verbatim on
// `window.__forgeTopologyConstraints` and a `forge:topology-constraints-set`
// event is fired so the SIMP runner (or future native binding) can
// pick it up.
//
// End-to-end proof:
//   1. Boot Electron; assert the host's window surfaces are installed
//      (helper, open/close hooks).
//   2. Open the panel via `tools.topologyConstraints` menu action.
//   3. Add ONE keep zone (bbox 0..10) and ONE remove zone (sphere r=4).
//   4. Drive the volFrac slider to 0.3 (the brief's specified target).
//      Set filter radius + compliance for completeness.
//   5. Click Save → assert window.__forgeTopologyConstraints matches the
//      panel's staged record (bodyId, keep.length === 1, remove.length === 1,
//      volFrac === 0.3) AND that the forge:topology-constraints-set event
//      fired with the same payload.
//   6. PUSH-49 regression: open the SIMP workbench afterwards; it must
//      mount cleanly alongside the constraints panel (both portal siblings).
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + assert globals)
//   - front (open panel + assert mount)
//   - top   (add keep zone)
//   - right (add remove zone + drive sliders)
//   - iso   (click Save + assert global + PUSH-49 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-101-topology-constraints');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'topology-constraints-session.mp4');

const TARGET_VOLFRAC = 0.3;
const TARGET_FILTER_RADIUS = 8.5;
const TARGET_COMPLIANCE = 12.5;

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

// Seed at least one native body so the design-domain picker has
// something to bind to. The constraints panel doesn't require a body
// (the saved record will publish bodyId === '' if there isn't one) —
// but the real-world flow always has one, so we exercise that path.
async function seedNativeBody() {
    const seeded = await page.evaluate(() => {
        const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const synthetic = {
            id: `push-101-seed-${Date.now()}`,
            kind: 'native',
            handle: 9000 + Math.floor(Math.random() * 1000),
            toolId: 'tools.topology',
            name: 'push-101-seed-box',
        };
        const next = [...all, synthetic];
        if (typeof window.__forgeSetBodies === 'function') {
            window.__forgeSetBodies(next);
        } else {
            window.__forgeBodies = next;
        }
        try {
            window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
                detail: { bodies: next },
            }));
        } catch {}
        return { id: synthetic.id, handle: synthetic.handle };
    });
    return seeded;
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')],
        timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /push-101|topology-constraints|TopologyConstraints|forge:topology-constraints|error|Error|exception|TypeError|crashed/i.test(t)) {
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
        console.error('[push-101] no .webm');
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
                console.log(`[push-101] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-101] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global host surface installed', async () => {
    await cameraTo('iso');
    await shot('boot');
    // The TopologyConstraintsPanelHost effect installs the imperative
    // open/close hooks + the helper mirror at mount time, BEFORE the
    // panel is opened. That's the proof App.jsx mounted the host.
    await page.waitForFunction(
        () => typeof window.__forgeOpenTopologyConstraintsPanel === 'function'
           && typeof window.__forgeCloseTopologyConstraintsPanel === 'function'
           && typeof window.__forgeTopologyConstraintsHelper === 'object'
           && window.__forgeTopologyConstraintsHelper !== null
           && typeof window.__forgeTopologyConstraintsHelper.publishConstraints === 'function',
        null, { timeout: 8000 });

    // The pure helpers work without the panel mounted — sanity-check
    // a bbox + sphere zone construction.
    const sanity = await page.evaluate(() => {
        const h = window.__forgeTopologyConstraintsHelper;
        const b = h.makeBboxZone('test-bbox', [0, 0, 0], [10, 20, 30]);
        const s = h.makeSphereZone('test-sphere', [5, 5, 5], 4);
        return {
            bboxKind: b.kind,
            bboxVolume: h.bboxVolume(b),
            sphereKind: s.kind,
            sphereVolume: h.sphereVolume(s),
            menuId: h.MENU_ID,
            eventName: h.EVENT_NAME,
            globalKey: h.GLOBAL_KEY,
            zoneKinds: h.ZONE_KINDS,
        };
    });
    expect(sanity.bboxKind).toBe('bbox');
    // bbox 0..10×0..20×0..30 = 6000 mm³
    expect(sanity.bboxVolume).toBeCloseTo(6000, 4);
    expect(sanity.sphereKind).toBe('sphere');
    // sphere r=4 → 4/3·π·64 = 268.0825…
    expect(sanity.sphereVolume).toBeCloseTo((4 / 3) * Math.PI * 64, 4);
    expect(sanity.menuId).toBe('tools.topologyConstraints');
    expect(sanity.eventName).toBe('forge:topology-constraints-set');
    expect(sanity.globalKey).toBe('__forgeTopologyConstraints');
    expect(sanity.zoneKinds).toEqual(['bbox', 'sphere']);

    // Validation rejects an empty record outright.
    const validation = await page.evaluate(() => {
        const h = window.__forgeTopologyConstraintsHelper;
        const empty = h.validateConstraints({});
        const good = h.validateConstraints({
            bodyId: 'x',
            keep: [],
            remove: [],
            filterRadius: 5,
            volFrac: 0.4,
            targetCompliance: 0,
        });
        return { empty, good };
    });
    expect(validation.empty.length).toBeGreaterThan(0);
    expect(validation.good).toEqual([]);
});

test('01 — open panel via tools.topologyConstraints menu action', async () => {
    await cameraTo('front');

    // Seed a native body so the design-domain picker has something
    // to bind to.
    const seed = await seedNativeBody();
    console.log('[push-101] seeded native body =', JSON.stringify(seed));

    await platformMenuAction('tools.topologyConstraints');
    await page.waitForSelector('[data-testid="forge-topology-constraints-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const panel = page.locator('[data-testid="forge-topology-constraints-panel"]');
    // Fresh panel state — no zones yet.
    expect(await panel.getAttribute('data-keep-count')).toBe('0');
    expect(await panel.getAttribute('data-remove-count')).toBe('0');
    // The body picker selected our seeded body (it was the last one
    // committed, which is the panel's fallback when there's no
    // window.__forgeSelection).
    expect(await panel.getAttribute('data-body-id')).toBe(seed.id);

    // The Save button is always available (zones are optional —
    // sometimes a user just wants to publish the volFrac alone).
    const saveBtn = page.locator('[data-testid="forge-topology-constraints-save"]');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();

    // The two zone lists are empty.
    await expect(page.locator(
        '[data-testid="forge-topology-constraints-keep-empty"]')).toBeVisible();
    await expect(page.locator(
        '[data-testid="forge-topology-constraints-remove-empty"]')).toBeVisible();
});

test('02 — add ONE keep zone (bbox 0..10) and assert the list updates', async () => {
    await cameraTo('top');

    const panel = page.locator('[data-testid="forge-topology-constraints-panel"]');

    // Type a distinctive label so we can assert it survived the round-trip.
    const labelInput = page.locator('[data-testid="forge-topology-constraints-keep-label"]');
    await labelInput.fill('load-patch-A');
    // bbox 0..10 on every axis (the default min/min already starts at 0,0,0
    // — set max explicitly).
    await page.locator('[data-testid="forge-topology-constraints-keep-maxX"]').fill('10');
    await page.locator('[data-testid="forge-topology-constraints-keep-maxY"]').fill('10');
    await page.locator('[data-testid="forge-topology-constraints-keep-maxZ"]').fill('10');

    // Click Add Keep Zone → list should grow by 1, empty placeholder gone.
    await page.locator('[data-testid="forge-topology-constraints-keep-add"]').click();
    await pause(200);
    await shot('keep-added');

    expect(await panel.getAttribute('data-keep-count')).toBe('1');
    // The empty placeholder is gone, a single row is in.
    expect(await page.locator(
        '[data-testid="forge-topology-constraints-keep-empty"]').count()).toBe(0);
    const keepRow = page.locator(
        '[data-testid="forge-topology-constraints-keep-row"]').first();
    await expect(keepRow).toBeVisible();
    expect(await keepRow.getAttribute('data-zone-kind')).toBe('bbox');
    expect(await keepRow.getAttribute('data-zone-label')).toBe('load-patch-A');
});

test('03 — switch kind to sphere, add ONE remove zone (sphere r=4) + drive sliders', async () => {
    await cameraTo('right');

    const panel = page.locator('[data-testid="forge-topology-constraints-panel"]');

    // Switch the remove-zone draft to a sphere kind.
    const kindSelect = page.locator(
        '[data-testid="forge-topology-constraints-remove-kind"]');
    await kindSelect.selectOption('sphere');
    await pause(150);

    // Configure the sphere: label + centre (5,5,5) + radius 4.
    await page.locator('[data-testid="forge-topology-constraints-remove-label"]')
        .fill('bolt-clearance-B');
    await page.locator('[data-testid="forge-topology-constraints-remove-cx"]').fill('5');
    await page.locator('[data-testid="forge-topology-constraints-remove-cy"]').fill('5');
    await page.locator('[data-testid="forge-topology-constraints-remove-cz"]').fill('5');
    await page.locator('[data-testid="forge-topology-constraints-remove-radius"]').fill('4');

    await page.locator('[data-testid="forge-topology-constraints-remove-add"]').click();
    await pause(200);

    expect(await panel.getAttribute('data-remove-count')).toBe('1');
    const removeRow = page.locator(
        '[data-testid="forge-topology-constraints-remove-row"]').first();
    await expect(removeRow).toBeVisible();
    expect(await removeRow.getAttribute('data-zone-kind')).toBe('sphere');
    expect(await removeRow.getAttribute('data-zone-label')).toBe('bolt-clearance-B');

    // Drive the volume-fraction slider to the brief's target 0.3.
    const volFracSlider = page.locator(
        '[data-testid="forge-topology-constraints-volfrac-slider"]');
    await expect(volFracSlider).toBeVisible();
    await volFracSlider.fill(String(TARGET_VOLFRAC));
    await pause(150);
    // The panel mirrors volFrac on the data attribute (React commit).
    expect(parseFloat(await panel.getAttribute('data-vol-frac')))
        .toBeCloseTo(TARGET_VOLFRAC, 3);

    // Filter radius slider → TARGET_FILTER_RADIUS.
    const filterSlider = page.locator(
        '[data-testid="forge-topology-constraints-filter-slider"]');
    await filterSlider.fill(String(TARGET_FILTER_RADIUS));
    await pause(150);
    expect(parseFloat(await panel.getAttribute('data-filter-radius')))
        .toBeCloseTo(TARGET_FILTER_RADIUS, 3);

    // Target compliance is a numeric input (no slider).
    const complianceInput = page.locator(
        '[data-testid="forge-topology-constraints-compliance"]');
    await complianceInput.fill(String(TARGET_COMPLIANCE));
    await pause(150);
    expect(parseFloat(await panel.getAttribute('data-target-compliance')))
        .toBeCloseTo(TARGET_COMPLIANCE, 3);

    await shot('sliders-driven');
});

test('04 — Save → window.__forgeTopologyConstraints matches + PUSH-49 regression', async () => {
    await cameraTo('iso');

    // Arm a listener for the published event BEFORE clicking Save so the
    // payload can be sampled after the click.
    await page.evaluate(() => {
        window.__push101EventPayload = null;
        window.__push101EventCount = 0;
        window.addEventListener('forge:topology-constraints-set', (e) => {
            window.__push101EventPayload = e?.detail || null;
            window.__push101EventCount += 1;
        });
    });

    // The bottom-right corner of the panel sits beneath the global
    // FPS / video-capture HUD chips, so a real DOM click via Playwright
    // can be intercepted by an overlay. Dispatch the click directly on
    // the Save button via JS — same React onClick handler is invoked,
    // no overlay interception.
    await page.evaluate(() => {
        const btn = document.querySelector(
            '[data-testid="forge-topology-constraints-save"]');
        if (btn) btn.click();
    });
    await pause(400);
    await shot('saved');

    // Toast surfaces — success branch carries data-ok='1'.
    const toast = page.locator('[data-testid="forge-topology-constraints-toast"]');
    await expect(toast).toBeVisible();
    expect(await toast.getAttribute('data-ok')).toBe('1');

    // The global record reflects every staged input.
    const saved = await page.evaluate(() => {
        const rec = window.__forgeTopologyConstraints;
        if (!rec || typeof rec !== 'object') return null;
        return {
            bodyId: rec.bodyId,
            keepCount: Array.isArray(rec.keep) ? rec.keep.length : -1,
            removeCount: Array.isArray(rec.remove) ? rec.remove.length : -1,
            keepFirst: Array.isArray(rec.keep) && rec.keep[0]
                ? {
                    kind: rec.keep[0].kind,
                    label: rec.keep[0].label,
                    min: rec.keep[0].min,
                    max: rec.keep[0].max,
                  } : null,
            removeFirst: Array.isArray(rec.remove) && rec.remove[0]
                ? {
                    kind: rec.remove[0].kind,
                    label: rec.remove[0].label,
                    center: rec.remove[0].center,
                    radius: rec.remove[0].radius,
                  } : null,
            filterRadius: rec.filterRadius,
            volFrac: rec.volFrac,
            targetCompliance: rec.targetCompliance,
            hasSavedAt: typeof rec.savedAt === 'number',
        };
    });
    console.log('[push-101] saved constraints =', JSON.stringify(saved, null, 2));
    expect(saved).not.toBeNull();
    expect(typeof saved.bodyId).toBe('string');
    expect(saved.bodyId.length).toBeGreaterThan(0);
    expect(saved.keepCount).toBe(1);
    expect(saved.removeCount).toBe(1);
    expect(saved.keepFirst).not.toBeNull();
    expect(saved.keepFirst.kind).toBe('bbox');
    expect(saved.keepFirst.label).toBe('load-patch-A');
    expect(saved.keepFirst.min).toEqual([0, 0, 0]);
    expect(saved.keepFirst.max).toEqual([10, 10, 10]);
    expect(saved.removeFirst).not.toBeNull();
    expect(saved.removeFirst.kind).toBe('sphere');
    expect(saved.removeFirst.label).toBe('bolt-clearance-B');
    expect(saved.removeFirst.center).toEqual([5, 5, 5]);
    expect(saved.removeFirst.radius).toBeCloseTo(4, 6);
    expect(saved.filterRadius).toBeCloseTo(TARGET_FILTER_RADIUS, 3);
    expect(saved.volFrac).toBeCloseTo(TARGET_VOLFRAC, 3);
    expect(saved.targetCompliance).toBeCloseTo(TARGET_COMPLIANCE, 3);
    expect(saved.hasSavedAt).toBe(true);

    // The bus event fired with the same payload.
    const evt = await page.evaluate(() => ({
        count: window.__push101EventCount,
        payload: window.__push101EventPayload
            ? {
                bodyId: window.__push101EventPayload.bodyId,
                keepLen: Array.isArray(window.__push101EventPayload.keep)
                    ? window.__push101EventPayload.keep.length : -1,
                removeLen: Array.isArray(window.__push101EventPayload.remove)
                    ? window.__push101EventPayload.remove.length : -1,
                volFrac: window.__push101EventPayload.volFrac,
              } : null,
    }));
    expect(evt.count).toBe(1);
    expect(evt.payload).not.toBeNull();
    expect(evt.payload.keepLen).toBe(1);
    expect(evt.payload.removeLen).toBe(1);
    expect(evt.payload.volFrac).toBeCloseTo(TARGET_VOLFRAC, 3);

    // PUSH-49 regression: the SIMP workbench still opens cleanly via
    // tools.topoOpt with the constraints panel still mounted. The
    // panels are portal siblings so the renderer must keep both alive.
    await platformMenuAction('tools.topoOpt');
    await page.waitForSelector('[data-testid="forge-topology-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('push-49-regression');
    const topoPanelVisible = await page.locator(
        '[data-testid="forge-topology-panel"]').isVisible();
    expect(topoPanelVisible).toBe(true);
    const constraintsPanelVisible = await page.locator(
        '[data-testid="forge-topology-constraints-panel"]').isVisible();
    expect(constraintsPanelVisible).toBe(true);
    // The PUSH-49 SIMP run button is reachable + enabled (the workbench
    // didn't load with its inputs disabled).
    const runBtn = page.locator('[data-testid="forge-topo-run"]');
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toBeEnabled();

    // Sanity: the published constraints record survived the SIMP
    // workbench mount (no one wiped the global).
    const stillThere = await page.evaluate(() => {
        const r = window.__forgeTopologyConstraints;
        return r && typeof r === 'object' && Array.isArray(r.keep)
            && r.keep.length === 1 && Array.isArray(r.remove)
            && r.remove.length === 1;
    });
    expect(stillThere).toBe(true);
});
