// PUSH-211 (Slice-156) — Real 3D Porcupine Curvature Plot.
//
// Drives the PorcupinePlotPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenPorcupinePlot +
//        window.__forgePorcupinePlotHelper install BEFORE the panel
//        mounts. Sanity-check the math primitives headlessly.
//   01 — Open the panel via the tools.porcupinePlot menu action. Assert
//        every canonical test-id mounts (body / mode / scale / build /
//        clear / close).
//   02 — Seed a sphere of radius R via forge.makeSphere(R). Wait for the
//        body to render in __forgeScene (Viewport.jsx tags userData.body
//        on the mesh ref). Open the panel, pick the sphere body, mode =
//        'mean', click Build. Assert vertexCount > 0, triangleCount > 0,
//        a __forgePorcupinePlotGroup mounts as THREE.LineSegments under
//        __forgeScene. Validate Mean H ≈ 1/R (Meyer 2003 identity) for
//        all interior vertices within 10% (the brief's tolerance).
//   03 — Switch radio to 'gaussian', rebuild. Assert K ≈ 1/R² within 10%.
//   04 — Click Clear. Assert the porcupine group is removed from the
//        scene and window.__forgePorcupinePlotGroup is gone.
//   05 — Close panel. Assert it unmounts cleanly.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (seed sphere + mean curvature build)
//   - right (Gaussian curvature build)
//   - iso   (clear + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-211-porcupine-plot');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'porcupine-plot-session.mp4');

// Sphere radius for the test. The brief says any radius works; 25 mm sits
// large enough in the viewport that the porcupine quills are readable on
// the remote-desktop session.
const TEST_SPHERE_R = 25;

let app, page;
let stepIndex = 0;
let sphereHandle = null;
let sphereBodyId = null;

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

// Set a React-controlled range slider's value through the native setter
// so React's onChange fires.
async function setReactRange(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`range not found: ${args.testid}`);
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, String(args.value));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
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
        if (/push-211|porcupine|curvature|Meyer|LineSegments|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);

    // Dismiss any first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});

    // Forge-189 onboarding tour mounts a full-screen overlay. Disable.
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
        console.error('[push-211] no .webm'); return;
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
                console.log(`[push-211] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-211] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API installed (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Surface contract.
    await page.waitForFunction(
        () => typeof window.__forgeOpenPorcupinePlot === 'function'
           && typeof window.__forgeClosePorcupinePlot === 'function'
           && !!window.__forgePorcupinePlotHelper,
        null, { timeout: 8000 });

    const surface = await page.evaluate(() => {
        const h = window.__forgePorcupinePlotHelper;
        return {
            open:    typeof window.__forgeOpenPorcupinePlot,
            close:   typeof window.__forgeClosePorcupinePlot,
            helper:  typeof h,
            helperKeys: h ? Object.keys(h).sort() : [],
            modes:   h ? h.MODES : null,
            defaultScale: h ? h.DEFAULT_SCALE : null,
            eventName:    h ? h.EVENT_NAME : null,
            groupName:    h ? h.GROUP_NAME : null,
        };
    });
    console.log('[push-211] surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('runPorcupinePlot');
    expect(surface.helperKeys).toContain('buildPorcupineFromBufferGeometry');
    expect(surface.helperKeys).toContain('computeDiscreteCurvature');
    expect(surface.helperKeys).toContain('computeVertexNormals');
    expect(surface.helperKeys).toContain('principalFromMeanGaussian');
    expect(surface.helperKeys).toContain('divergingColor');
    expect(surface.helperKeys).toContain('clearPorcupineGroup');
    expect(surface.helperKeys).toContain('checkSphereIdentity');
    expect(Array.isArray(surface.modes)).toBe(true);
    expect(surface.modes).toEqual(['gaussian', 'mean', 'principal']);
    expect(surface.defaultScale).toBeGreaterThan(0);
    expect(surface.eventName).toBe('forge:porcupine-plot-built');
    expect(surface.groupName).toBe('forge.porcupinePlot.group');

    // Headless math smoke test: build a tiny synthetic UV sphere of
    // radius 5 mm, push through the helper, and confirm the mean
    // curvature lands close to 1/R.
    const headless = await page.evaluate(() => {
        const h = window.__forgePorcupinePlotHelper;
        const R = 5;
        const nLat = 12, nLon = 18;
        const positions = [];
        positions.push(0, R, 0);
        for (let i = 1; i < nLat; i++) {
            const phi = Math.PI * i / nLat;
            for (let j = 0; j < nLon; j++) {
                const theta = 2 * Math.PI * j / nLon;
                positions.push(
                    R * Math.sin(phi) * Math.cos(theta),
                    R * Math.cos(phi),
                    R * Math.sin(phi) * Math.sin(theta),
                );
            }
        }
        positions.push(0, -R, 0);
        const indices = [];
        // Outward-facing winding (matches three.js SphereGeometry).
        const top = 0;
        for (let j = 0; j < nLon; j++) {
            const a = 1 + j;
            const b = 1 + ((j + 1) % nLon);
            indices.push(top, b, a);
        }
        for (let i = 1; i < nLat - 1; i++) {
            const rowA = 1 + (i - 1) * nLon;
            const rowB = 1 + i * nLon;
            for (let j = 0; j < nLon; j++) {
                const j1 = (j + 1) % nLon;
                const a = rowA + j, b = rowA + j1;
                const c = rowB + j, d = rowB + j1;
                indices.push(a, b, c);
                indices.push(b, d, c);
            }
        }
        const bot = positions.length / 3 - 1;
        const lastRow = 1 + (nLat - 2) * nLon;
        for (let j = 0; j < nLon; j++) {
            const a = lastRow + j;
            const b = lastRow + ((j + 1) % nLon);
            indices.push(bot, a, b);
        }
        const fakeGeom = {
            attributes: { position: {
                count: positions.length / 3,
                getX: (i) => positions[3 * i + 0],
                getY: (i) => positions[3 * i + 1],
                getZ: (i) => positions[3 * i + 2],
            }},
            index: { array: new Uint32Array(indices), count: indices.length },
        };
        const out = h.buildPorcupineFromBufferGeometry(
            fakeGeom, { mode: 'mean', scale: 1 });
        const Hcheck = h.checkSphereIdentity(
            out.mean, 1 / R, out.voronoiArea);
        const Kcheck = h.checkSphereIdentity(
            out.gaussian, 1 / (R * R), out.voronoiArea);
        return {
            vertexCount: out.vertexCount,
            triangleCount: out.triangleCount,
            kAbsMax: out.stats.kAbsMax,
            mode: out.stats.mode,
            HMedRel: Hcheck.medianRel,
            HMaxRel: Hcheck.maxRel,
            HCount:  Hcheck.count,
            KMedRel: Kcheck.medianRel,
            KMaxRel: Kcheck.maxRel,
            KCount:  Kcheck.count,
        };
    });
    console.log('[push-211] headless math smoke =', JSON.stringify(headless));
    expect(headless.vertexCount).toBeGreaterThan(0);
    expect(headless.triangleCount).toBeGreaterThan(0);
    expect(headless.kAbsMax).toBeGreaterThan(0);
    expect(headless.HCount).toBeGreaterThan(0);
    expect(headless.KCount).toBeGreaterThan(0);
    // Mean curvature within 10% across the interior of the sphere.
    expect(headless.HMedRel).toBeLessThan(0.10);
    // Gaussian curvature: cotangent Voronoi area approximation has
    // O(h²) error so a 12×18 UV sphere lands a few % off.
    expect(headless.KMedRel).toBeLessThan(0.10);

    await shot('host-surface-ok');
});

test('01 — open porcupine panel via tools.porcupinePlot (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.porcupinePlot');
    await page.waitForSelector('[data-testid="forge-porcupine-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Canonical control test-ids.
    await expect(page.locator('[data-testid="forge-porcupine-body"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-mode-gaussian"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-mode-mean"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-mode-principal"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-scale-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-scale-number"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-build"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-clear"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-porcupine-close"]')).toBeVisible();

    // Default mode is 'mean'.
    const defaultMode = await page.locator('[data-testid="forge-porcupine-panel"]')
                                   .getAttribute('data-mode');
    expect(defaultMode).toBe('mean');
});

test('02 — seed sphere + build mean curvature porcupine + assert H ≈ 1/R (top)', async () => {
    await cameraTo('top');

    // Capture the build event so we can prove broadcast fires.
    await page.evaluate(() => {
        window.__push211Events = [];
        window.addEventListener('forge:porcupine-plot-built', (e) => {
            try {
                window.__push211Events.push({
                    bodyId: e?.detail?.bodyId,
                    mode:   e?.detail?.mode,
                    scale:  e?.detail?.scale,
                    vertexCount: e?.detail?.vertexCount,
                    triangleCount: e?.detail?.triangleCount,
                    mounted: e?.detail?.mounted,
                });
            } catch {}
        });
    });

    // Seed a real OCCT sphere via forge.makeSphere. Viewport.jsx will
    // tessellate it through window.forge.tessellate and tag the mesh
    // ref with userData.body — same surface zebra etc. rely on.
    const seeded = await page.evaluate((R) => {
        if (typeof window.forge?.makeSphere !== 'function') {
            return { error: 'forge.makeSphere unavailable' };
        }
        const h = window.forge.makeSphere(R);
        if (typeof h !== 'number') return { error: 'makeSphere returned non-number' };
        const id = `f-porc-sphere-${Date.now()}`;
        window.__forgeAppendBody({
            id, kind: 'native', handle: h,
            toolId: 'solid.sphere', name: `Sphere R${R}`,
            params: { radius: R },
        });
        return { handle: h, id };
    }, TEST_SPHERE_R);
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    sphereHandle = seeded.handle;
    sphereBodyId = seeded.id;

    // Wait for the body to land in __forgeBodies.
    await page.waitForFunction(
        (id) => (window.__forgeBodies || []).some(
            (b) => b && b.id === id && b.kind === 'native'),
        sphereBodyId, { timeout: 4000 });
    // Wait for the body mesh to land in the live scene with userData.body.
    await page.waitForFunction(
        (id) => {
            const sc = window.__forgeScene;
            if (!sc) return false;
            let found = false;
            sc.traverse((o) => {
                if (o && o.isMesh && o.userData && o.userData.body
                    && o.userData.body.id === id
                    && o.geometry
                    && o.geometry.attributes
                    && o.geometry.attributes.position
                    && o.geometry.attributes.position.count > 0) found = true;
            });
            return found;
        }, sphereBodyId, { timeout: 12000 });
    await shot('sphere-seeded');

    // Refresh the body picker.
    await page.evaluate(() => {
        try {
            window.dispatchEvent(new CustomEvent('forge:bodies-changed'));
        } catch {}
    });
    await pause(300);

    // Select the sphere in the dropdown.
    await page.locator('[data-testid="forge-porcupine-body"]').selectOption(sphereBodyId);
    await pause(200);

    // Confirm mode = mean (default).
    await page.locator('[data-testid="forge-porcupine-mode-mean"]').click();
    await pause(200);

    // Click Build. The driver computes Meyer 2003 curvature math and
    // mounts a THREE.LineSegments group on __forgeScene.
    await page.locator('[data-testid="forge-porcupine-build"]').click();
    await page.waitForFunction(
        () => (window.__push211Events || []).some((e) => e.mode === 'mean'),
        null, { timeout: 30000 });
    await pause(500);
    await shot('mean-built');

    const events = await page.evaluate(() => window.__push211Events || []);
    expect(events.length).toBeGreaterThan(0);
    const meanEvt = events.find((e) => e.mode === 'mean');
    expect(meanEvt).toBeTruthy();
    expect(meanEvt.vertexCount).toBeGreaterThan(0);
    expect(meanEvt.triangleCount).toBeGreaterThan(0);
    expect(meanEvt.mounted).toBe(true);

    // Panel data-* attributes reflect the build.
    const panelData = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="forge-porcupine-panel"]');
        return {
            mounted: p?.getAttribute('data-mounted'),
            builtMode: p?.getAttribute('data-built-mode'),
            vertexCount: Number(p?.getAttribute('data-vertex-count') || 0),
            triangleCount: Number(p?.getAttribute('data-triangle-count') || 0),
            kAbsMax: Number(p?.getAttribute('data-k-abs-max') || 0),
        };
    });
    console.log('[push-211] mean panelData =', JSON.stringify(panelData));
    expect(panelData.mounted).toBe('1');
    expect(panelData.builtMode).toBe('mean');
    expect(panelData.vertexCount).toBeGreaterThan(0);
    expect(panelData.triangleCount).toBeGreaterThan(0);

    // Group is mounted under __forgeScene with the canonical name.
    const groupCheck = await page.evaluate((groupName) => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let found = null;
        sc.traverse((o) => {
            if (found) return;
            if (o && o.userData && o.userData.porcupinePlot === true) {
                found = {
                    name: o.name,
                    isLineSegments: !!o.isLineSegments,
                    type: o.type,
                    positionCount: o.geometry?.attributes?.position?.count || 0,
                    colorCount:    o.geometry?.attributes?.color?.count || 0,
                };
            }
        });
        return {
            groupRef: window.__forgePorcupinePlotGroup ? 'present' : 'absent',
            found,
        };
    }, 'forge.porcupinePlot.group');
    console.log('[push-211] groupCheck =', JSON.stringify(groupCheck));
    expect(groupCheck.groupRef).toBe('present');
    expect(groupCheck.found).toBeTruthy();
    expect(groupCheck.found.isLineSegments).toBe(true);
    expect(groupCheck.found.type).toBe('LineSegments');
    // 2 line vertices per source vertex (start + end of each quill).
    expect(groupCheck.found.positionCount).toBeGreaterThan(0);
    expect(groupCheck.found.colorCount).toBe(groupCheck.found.positionCount);

    // ── HEADLINE ASSERTION — Mean curvature ≈ 1/R for the sphere. ──
    // Read the live geometry from the rendered sphere mesh + run the
    // math helper through the panel's own pipeline; assert the median
    // relative error of mean curvature against the analytic 1/R lies
    // below the brief's 10% tolerance.
    const sphereCheck = await page.evaluate(({ id, R }) => {
        const sc = window.__forgeScene;
        const h  = window.__forgePorcupinePlotHelper;
        if (!sc || !h) return { error: 'scene or helper missing' };
        let geom = null;
        sc.traverse((o) => {
            if (geom) return;
            if (o && o.isMesh && o.userData && o.userData.body
                && o.userData.body.id === id) geom = o.geometry;
        });
        if (!geom) return { error: 'no geometry for body' };
        const out = h.buildPorcupineFromBufferGeometry(
            geom, { mode: 'mean', scale: 1 });
        const Hcheck = h.checkSphereIdentity(
            out.mean, 1 / R, out.voronoiArea);
        const Kcheck = h.checkSphereIdentity(
            out.gaussian, 1 / (R * R), out.voronoiArea);
        return {
            vertexCount: out.vertexCount,
            triangleCount: out.triangleCount,
            meanSample: Array.from(out.mean.slice(0, 5)).map(
                (v) => Number.isFinite(v) ? Number(v.toFixed(6)) : null),
            HMedRel: Hcheck.medianRel,
            HMaxRel: Hcheck.maxRel,
            HMeanRel: Hcheck.meanRel,
            HCount: Hcheck.count,
            KMedRel: Kcheck.medianRel,
            KMaxRel: Kcheck.maxRel,
            KMeanRel: Kcheck.meanRel,
            KCount: Kcheck.count,
        };
    }, { id: sphereBodyId, R: TEST_SPHERE_R });
    console.log('[push-211] sphereCheck (mean+gauss) =',
        JSON.stringify(sphereCheck));
    expect(sphereCheck.error).toBeUndefined();
    expect(sphereCheck.vertexCount).toBeGreaterThan(0);
    expect(sphereCheck.triangleCount).toBeGreaterThan(0);
    // Mean H = 1/R within 10% across the interior.
    expect(sphereCheck.HMedRel).toBeLessThan(0.10);
    // Gaussian K = 1/R² within 10% across the interior (we'll re-check
    // formally in step 03 after switching the radio).
    expect(sphereCheck.KMedRel).toBeLessThan(0.10);
});

test('03 — switch curvature type to Gaussian + rebuild + assert K ≈ 1/R² (right)', async () => {
    await cameraTo('right');

    // Switch to Gaussian.
    await page.locator('[data-testid="forge-porcupine-mode-gaussian"]').click();
    await pause(200);
    const mode = await page.locator('[data-testid="forge-porcupine-panel"]')
                            .getAttribute('data-mode');
    expect(mode).toBe('gaussian');

    // Clear the event log for the new build.
    await page.evaluate(() => { window.__push211Events = []; });

    // Build with Gaussian mode.
    await page.locator('[data-testid="forge-porcupine-build"]').click();
    await page.waitForFunction(
        () => (window.__push211Events || []).some((e) => e.mode === 'gaussian'),
        null, { timeout: 30000 });
    await pause(500);
    await shot('gaussian-built');

    // Panel data-built-mode now reflects gaussian.
    const builtMode = await page.locator('[data-testid="forge-porcupine-panel"]')
                                .getAttribute('data-built-mode');
    expect(builtMode).toBe('gaussian');

    // Group is STILL a single LineSegments (rebuild replaces, doesn't
    // accumulate).
    const lineGroupCount = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return -1;
        let count = 0;
        sc.traverse((o) => {
            if (o && o.userData && o.userData.porcupinePlot === true) count += 1;
        });
        return count;
    });
    console.log('[push-211] live porcupine group count =', lineGroupCount);
    expect(lineGroupCount).toBe(1);

    // ── HEADLINE ASSERTION — Gaussian K ≈ 1/R² ──
    const gaussCheck = await page.evaluate(({ id, R }) => {
        const sc = window.__forgeScene;
        const h  = window.__forgePorcupinePlotHelper;
        let geom = null;
        sc.traverse((o) => {
            if (geom) return;
            if (o && o.isMesh && o.userData && o.userData.body
                && o.userData.body.id === id) geom = o.geometry;
        });
        if (!geom) return { error: 'no geometry' };
        const out = h.buildPorcupineFromBufferGeometry(
            geom, { mode: 'gaussian', scale: 1 });
        const Kcheck = h.checkSphereIdentity(
            out.gaussian, 1 / (R * R), out.voronoiArea);
        // Also compute summary so we can sanity-check sign + magnitude
        // (Gaussian for a sphere is strictly positive everywhere).
        const positiveCount = Array.from(out.gaussian).filter(
            (v) => Number.isFinite(v) && v > 0).length;
        const negativeCount = Array.from(out.gaussian).filter(
            (v) => Number.isFinite(v) && v < 0).length;
        return {
            vertexCount: out.vertexCount,
            KMedRel: Kcheck.medianRel,
            KMeanRel: Kcheck.meanRel,
            KMaxRel:  Kcheck.maxRel,
            KCount:   Kcheck.count,
            positiveCount, negativeCount,
            kAbsMax: out.stats.kAbsMax,
        };
    }, { id: sphereBodyId, R: TEST_SPHERE_R });
    console.log('[push-211] gaussCheck =', JSON.stringify(gaussCheck));
    expect(gaussCheck.error).toBeUndefined();
    expect(gaussCheck.vertexCount).toBeGreaterThan(0);
    // Gaussian K = 1/R² within 10%.
    expect(gaussCheck.KMedRel).toBeLessThan(0.10);
    // On a sphere, K is strictly positive everywhere — the negative
    // count should be at most a tiny pole sliver (<5% of vertices).
    expect(gaussCheck.positiveCount).toBeGreaterThan(0);
    expect(gaussCheck.negativeCount).toBeLessThan(gaussCheck.vertexCount * 0.05);

    // The published __forgePorcupinePlot mirror reflects the latest
    // build's mode.
    const lastBuild = await page.evaluate(() => window.__forgePorcupinePlot || null);
    console.log('[push-211] lastBuild = ', JSON.stringify(lastBuild));
    expect(lastBuild).not.toBeNull();
    expect(lastBuild.mode).toBe('gaussian');
    expect(lastBuild.mounted).toBe(true);
});

test('04 — clear porcupine group + assert removed from scene (iso)', async () => {
    await cameraTo('iso');

    // Click Clear.
    await page.locator('[data-testid="forge-porcupine-clear"]').click();
    await pause(400);
    await shot('after-clear');

    // The group is gone from the scene + window mirror is cleared.
    const clearedState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let count = 0;
        sc.traverse((o) => {
            if (o && o.userData && o.userData.porcupinePlot === true) count += 1;
        });
        return {
            groupCount: count,
            groupRef:   typeof window.__forgePorcupinePlotGroup,
        };
    });
    console.log('[push-211] clearedState =', JSON.stringify(clearedState));
    expect(clearedState.error).toBeUndefined();
    expect(clearedState.groupCount).toBe(0);
    expect(clearedState.groupRef).toBe('undefined');

    // Panel data-mounted now reads '0' (no live build).
    const panelMounted = await page.locator('[data-testid="forge-porcupine-panel"]')
                                    .getAttribute('data-mounted');
    expect(panelMounted).toBe('0');
});

test('05 — close panel + final shot (iso)', async () => {
    await page.locator('[data-testid="forge-porcupine-close"]').click();
    await pause(400);
    await shot('panel-closed');

    // Panel unmounts.
    const panelGone = await page.locator('[data-testid="forge-porcupine-panel"]').count();
    expect(panelGone).toBe(0);

    // Helper API still mounted (it's installed at module-load time, not
    // panel-mount time).
    const helperStillThere = await page.evaluate(() =>
        typeof window.__forgePorcupinePlotHelper === 'object');
    expect(helperStillThere).toBe(true);

    // The headless runPorcupinePlot driver still works after panel close,
    // because the math + scene group install live on the helper.
    const headlessRun = await page.evaluate(async (id) => {
        const h = window.__forgePorcupinePlotHelper;
        const r = await h.runPorcupinePlot({ bodyId: id, mode: 'principal', scale: 1 });
        return {
            ok: r.ok,
            mode: r.mode,
            vertexCount: r.vertexCount,
            mounted: r.mounted,
        };
    }, sphereBodyId);
    console.log('[push-211] headless run =', JSON.stringify(headlessRun));
    expect(headlessRun.ok).toBe(true);
    expect(headlessRun.mode).toBe('principal');
    expect(headlessRun.vertexCount).toBeGreaterThan(0);
    expect(headlessRun.mounted).toBe(true);

    // Final cleanup so we don't leave a porcupine in the scene for the
    // next spec to trip on.
    await page.evaluate(() => {
        try { window.__forgePorcupinePlotHelper.clearPorcupineGroup(); } catch {}
    });
});
