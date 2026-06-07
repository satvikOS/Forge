// PUSH-221 (Slice-153) — Real frictionless penalty-method node-to-surface
// contact analysis between two linear-elastic FEA bodies.
//
//   00 — Boot. Confirm window.__forgeOpenContactFea +
//        window.__forgeContactFeaHelper install BEFORE the panel mounts.
//        Sanity-check the solver primitives headlessly (makeCubeTetMesh,
//        makeSphereTetMesh, extractBoundaryFacets, hertzAnalytic,
//        closestPointOnTriangle, etc.).
//   01 — Open the Contact FEA panel via the tools.contactFea menu action.
//        Assert every canonical test-id mounts (mode, eps, solve, close,
//        2 material cards, cube/sphere config inputs).
//   02 — Two cubes pressed together → assert non-zero contact force, max
//        gap is negative (penetration), active pairs > 0, and the
//        contact-force total matches the structural stiffness scale.
//   03 — Two spheres Hertz benchmark → assert contact radius matches the
//        Hertz analytical prediction (at the simulated force) within 15%.
//   04 — Pull bodies apart → assert zero active contact pairs.
//   05 — Close the panel.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (cubes pressed solve + chip read)
//   - right (Hertz benchmark + analytic compare)
//   - iso   (apart + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(900000); // 15 min — Hertz w/ 19-node patch is ~5 s on M4 Max
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-221-contact-fea');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'contact-fea-session.mp4');

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

async function waitForLastResult(timeoutMs = 180000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const has = await page.evaluate(() => !!window.__forgeContactFeaLast);
        if (has) return await page.evaluate(() => {
            const r = window.__forgeContactFeaLast;
            return {
                mode: r.mode,
                bodyA: r.bodyA, bodyB: r.bodyB,
                eps: r.eps,
                iterations: r.iterations,
                activeCount: r.activeCount,
                totalActivePairs: r.totalActivePairs,
                maxGap: r.maxGap,
                maxContactF: r.maxContactF,
                totalContactForce: r.totalContactForce,
                contactRadius: r.contactRadius,
                converged: r.converged,
                activeHistory: r.activeHistory,
                residualHistory: r.residualHistory,
                hertz: r.hertz,
                aSim: r.aSim,
                aAnalyticTargetF: r.aAnalyticTargetF,
                aAnalyticSimF: r.aAnalyticSimF,
                errVsTargetF: r.errVsTargetF,
                errVsSimF: r.errVsSimF,
                Fnumeric: r.Fnumeric,
                activeSet: r.activeSet,
            };
        });
        await pause(500);
    }
    return null;
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
        if (/push-221|contactfea|contact|penalty|hertz|gap|active|newton/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});

    // Dismiss onboarding so it doesn't block button clicks.
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
        console.error('[push-221] no .webm');
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
                console.log(`[push-221] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-221] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert host window surface + helper API installed', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenContactFea,
        close:   typeof window.__forgeCloseContactFea,
        helper:  typeof window.__forgeContactFeaHelper,
        helperKeys: window.__forgeContactFeaHelper
            ? Object.keys(window.__forgeContactFeaHelper).sort()
            : [],
        defaults: window.__forgeContactFeaHelper?.CONTACT_DEFAULTS,
        materials: window.__forgeContactFeaHelper?.MATERIAL_PRESETS
            ? Object.keys(window.__forgeContactFeaHelper.MATERIAL_PRESETS).sort()
            : [],
    }));
    console.log('[push-221] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('makeCubeTetMesh');
    expect(surface.helperKeys).toContain('makeSphereTetMesh');
    expect(surface.helperKeys).toContain('extractBoundaryFacets');
    expect(surface.helperKeys).toContain('buildElasticD');
    expect(surface.helperKeys).toContain('tet4StiffnessAndVolume');
    expect(surface.helperKeys).toContain('makeContactSystem');
    expect(surface.helperKeys).toContain('solveContact');
    expect(surface.helperKeys).toContain('driveTwoCubes');
    expect(surface.helperKeys).toContain('driveTwoSpheresHertz');
    expect(surface.helperKeys).toContain('driveBodiesApart');
    expect(surface.helperKeys).toContain('hertzAnalytic');
    expect(surface.helperKeys).toContain('closestPointOnTriangle');
    expect(surface.helperKeys).toContain('detectContactPairs');
    expect(surface.helperKeys).toContain('assemblePenaltyContribution');
    expect(surface.helperKeys).toContain('buildFacetBVH');
    expect(surface.helperKeys).toContain('queryFacetBVH');
    expect(surface.helperKeys).toContain('pcg');
    expect(surface.materials).toContain('STEEL');
    expect(surface.materials).toContain('ALU_6061');
    expect(surface.materials).toContain('TI_6AL4V');
    expect(surface.materials).toContain('RUBBER');
    expect(surface.defaults.PENALTY_DEFAULT).toBeGreaterThan(0);
    expect(surface.defaults.MAX_NEWTON_ITERATIONS).toBeGreaterThan(0);

    // Headless smoke: build a small cube tet mesh, extract boundary
    // facets, and verify the count matches the analytical expectation.
    const headless = await page.evaluate(() => {
        const h = window.__forgeContactFeaHelper;
        const m = h.makeCubeTetMesh(2, 2, 2, 1, 1, 1);
        const N = m.nodes.length / 3;
        const T = m.tets.length / 4;
        const facets = h.extractBoundaryFacets(m.nodes, m.tets);
        const F = facets.length / 3;
        // Hertz analytic: equal steel spheres, F = 200 N, R = 0.02 m.
        const ha = h.hertzAnalytic({
            R1: 0.02, R2: 0.02,
            E1: h.MATERIAL_PRESETS.STEEL.E, nu1: h.MATERIAL_PRESETS.STEEL.nu,
            E2: h.MATERIAL_PRESETS.STEEL.E, nu2: h.MATERIAL_PRESETS.STEEL.nu,
            F: 200,
        });
        // Closest point smoke.
        const cp = h.closestPointOnTriangle(0.5, 0.5, 1,  0, 0, 0,  1, 0, 0,  0, 1, 0);
        return { N, T, F, a: ha.a, p0: ha.p0, delta: ha.delta,
                 cpZ: cp.z, cpBa: cp.ba, cpBb: cp.bb, cpBc: cp.bc };
    });
    console.log('[push-221] headless =', JSON.stringify(headless));
    // 2³ = 8 cells × 8 corner nodes shared → (2+1)³ = 27 nodes.
    expect(headless.N).toBe(27);
    // 8 cells × 6 tets/cell = 48 tets.
    expect(headless.T).toBe(48);
    // 6 cube faces × 2 tris/face × 4 cells/face = 48 boundary tris.
    expect(headless.F).toBe(48);
    // Hertz analytic at 200 N, R = 20 mm, steel.
    expect(headless.a).toBeGreaterThan(0);
    expect(headless.a).toBeLessThan(1e-3);
    expect(headless.p0).toBeGreaterThan(1e8);
    expect(headless.delta).toBeGreaterThan(0);
    expect(headless.delta).toBeLessThan(1e-4);
    // Closest point on z=0 triangle from (0.5, 0.5, 1) is the same xy.
    expect(headless.cpZ).toBeCloseTo(0, 5);

    await shot('host-surface-ok');
});

test('01 — open Contact FEA panel via tools.contactFea', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.contactFea');
    await page.waitForSelector('[data-testid="forge-contactfea-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('contactfea-open');

    // Canonical control test-ids.
    await expect(page.locator('[data-testid="forge-contactfea-mat-a-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-mat-b-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-mat-a-preset"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-mat-b-preset"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-mode"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-eps"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-max-newton"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-solve"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-close"]')).toBeVisible();
    // In default (cubes) mode the cube inputs are visible.
    await expect(page.locator('[data-testid="forge-contactfea-cube-sub"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-cube-overlap"]')).toBeVisible();
});

test('02 — two cubes pressed together → non-zero contact force', async () => {
    await cameraTo('top');
    // Configure: stay on default cubes mode with small subdivisions.
    await page.locator('[data-testid="forge-contactfea-cube-sub"]').fill('2');
    await page.locator('[data-testid="forge-contactfea-cube-overlap"]').fill('0.005');
    await page.locator('[data-testid="forge-contactfea-max-newton"]').fill('15');
    await pause(200);
    await shot('cubes-configured');

    // Reset last-result + kick the solve.
    await page.evaluate(() => { try { delete window.__forgeContactFeaLast; } catch {} });
    await page.locator('[data-testid="forge-contactfea-solve"]').click();

    const snap = await waitForLastResult(180000);
    expect(snap).not.toBeNull();
    console.log('[push-221] cubes snap =', JSON.stringify({
        mode: snap.mode,
        active: snap.activeCount,
        totalActivePairs: snap.totalActivePairs,
        maxGap: snap.maxGap,
        maxContactF: snap.maxContactF,
        totalContactForce: snap.totalContactForce,
        iters: snap.iterations,
        converged: snap.converged,
        activeHistory: snap.activeHistory,
    }));
    expect(snap.mode).toBe('cubes');
    expect(snap.iterations).toBeGreaterThan(0);
    // Contact must be DETECTED — non-zero active set after the press.
    expect(snap.activeCount).toBeGreaterThan(0);
    // Max gap should be negative (penetration) at active nodes.
    expect(snap.maxGap).toBeLessThan(0);
    // Contact force must be non-zero.
    expect(snap.maxContactF).toBeGreaterThan(0);
    expect(snap.totalContactForce).toBeGreaterThan(0);
    // Sanity: force magnitude is in the right ballpark for steel cubes
    // pressed by 5 mm (E·A·δ/L ≈ 2.1e11 × 0.01 × 5e-3 / 0.1 ≈ 1e8 N
    // is the bulk-compression limit; penalty contact gives less than
    // that since gap > 0).  Must be at least 100 N to count as
    // "non-zero", capped at 1e10 to catch the no-damping NaN bug.
    expect(snap.totalContactForce).toBeGreaterThan(100);
    expect(snap.totalContactForce).toBeLessThan(1e10);

    // Newton should have converged or at least driven the residual
    // down significantly.
    const r0 = snap.residualHistory[0];
    const rLast = snap.residualHistory[snap.residualHistory.length - 1];
    console.log('[push-221] cubes residual drop:', rLast / r0);
    expect(rLast).toBeLessThan(r0); // monotonic drop OK
    expect(rLast / r0).toBeLessThan(0.1); // dropped at least 10x

    // Active set count was tracked across iterations.
    expect(snap.activeHistory.length).toBe(snap.iterations);

    // UI: active-set table rendered with rows.
    await expect(page.locator('[data-testid="forge-contactfea-results"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-chip-active"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-chip-maxgap"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-chip-maxforce"]')).toBeVisible();
    const activeRows = await page.locator('[data-testid="forge-contactfea-active-row"]').count();
    expect(activeRows).toBe(Math.min(snap.activeSet.length, snap.totalActivePairs));
    expect(activeRows).toBeGreaterThan(0);
    await shot('cubes-solved');
});

test('03 — two spheres Hertz benchmark → contact radius within 15 % of analytic', async () => {
    await cameraTo('right');
    // Switch to Hertz mode.
    await page.locator('[data-testid="forge-contactfea-mode"]').selectOption('hertz');
    await pause(200);
    // Default Hertz settings (handled by the driver).  Use the panel's
    // visible defaults — they map to driveTwoSpheresHertz({}).
    await expect(page.locator('[data-testid="forge-contactfea-sphere-r"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-hertz-f"]')).toBeVisible();
    await shot('hertz-configured');

    await page.evaluate(() => { try { delete window.__forgeContactFeaLast; } catch {} });
    await page.locator('[data-testid="forge-contactfea-solve"]').click();

    const snap = await waitForLastResult(300000);
    expect(snap).not.toBeNull();
    console.log('[push-221] hertz snap =', JSON.stringify({
        mode: snap.mode,
        active: snap.activeCount,
        iters: snap.iterations,
        converged: snap.converged,
        aSim: snap.aSim,
        aAnalyticSimF: snap.aAnalyticSimF,
        errVsSimF: snap.errVsSimF,
        Fnumeric: snap.Fnumeric,
        hertzAEstar: snap.hertz?.Estar,
        hertzRstar: snap.hertz?.Rstar,
    }));
    expect(snap.mode).toBe('hertz');
    expect(snap.activeCount).toBeGreaterThan(2); // multiple nodes in contact patch
    expect(snap.hertz).not.toBeNull();
    expect(snap.hertz.Estar).toBeGreaterThan(0);
    expect(snap.hertz.Rstar).toBeCloseTo(0.01, 5);
    expect(snap.aSim).toBeGreaterThan(0);
    expect(snap.aAnalyticSimF).toBeGreaterThan(0);
    expect(snap.Fnumeric).toBeGreaterThan(0);

    // BENCHMARK ASSERTION: the simulated contact radius must match the
    // Hertz analytic prediction at the simulation-developed force F_sim
    // within 15 %.  This is the textbook validation: given the integrated
    // contact force, Hertz predicts a, and the simulation's geometric
    // patch radius must agree.
    //
    // We use errVsSimF (Hertz a at F_sim) rather than errVsTargetF
    // because:
    //   - the simulation's effective δ is bounded by the bulk
    //     compression of the bodies (finite-sphere effect),
    //   - Hertz theory assumes infinite half-spaces, which our
    //     pinned-far-pole tet spheres approximate but don't match
    //     exactly,
    //   - the AT-F_SIM comparison eliminates the half-space modelling
    //     error and is the cleanest internal consistency check.
    console.log('[push-221] Hertz errVsSimF =', snap.errVsSimF,
                'aSim =', snap.aSim, 'aAnalyticSimF =', snap.aAnalyticSimF);
    expect(snap.errVsSimF).toBeLessThan(0.15);

    // UI: Hertz comparison section renders.
    await expect(page.locator('[data-testid="forge-contactfea-hertz"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-hertz-asim"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-hertz-aana-sim"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-hertz-err-sim"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-contactfea-hertz-estar"]')).toBeVisible();

    await shot('hertz-validated');
});

test('04 — pull bodies apart → zero active contact pairs', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-contactfea-mode"]').selectOption('apart');
    await pause(200);
    await expect(page.locator('[data-testid="forge-contactfea-apart-gap"]')).toBeVisible();
    await page.locator('[data-testid="forge-contactfea-apart-gap"]').fill('0.05');

    await page.evaluate(() => { try { delete window.__forgeContactFeaLast; } catch {} });
    await page.locator('[data-testid="forge-contactfea-solve"]').click();

    const snap = await waitForLastResult(120000);
    expect(snap).not.toBeNull();
    console.log('[push-221] apart snap =', JSON.stringify({
        mode: snap.mode,
        active: snap.activeCount,
        maxGap: snap.maxGap,
        maxContactF: snap.maxContactF,
        converged: snap.converged,
    }));
    expect(snap.mode).toBe('apart');
    // Bodies separated by 50 mm → no contact whatsoever.
    expect(snap.activeCount).toBe(0);
    expect(snap.maxGap).toBe(0);
    expect(snap.maxContactF).toBe(0);
    expect(snap.totalContactForce).toBe(0);
    expect(snap.converged).toBe(true);

    // UI: empty active-set row visible.
    await expect(page.locator('[data-testid="forge-contactfea-active-empty"]')).toBeVisible();

    await shot('apart-validated');
});

test('05 — close panel + final shot', async () => {
    await page.locator('[data-testid="forge-contactfea-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-contactfea-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
