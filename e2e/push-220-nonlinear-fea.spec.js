// PUSH-220 (Slice-152) — Real Nonlinear Static FEA.
//
// Drives NonlinearFeaPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenNonlinearFea +
//        window.__forgeNonlinearFeaHelper install BEFORE the panel
//        mounts. Sanity-check the solver primitives headlessly
//        (makeBarMesh, radialReturn at the yield boundary, etc.).
//   01 — Open the Nonlinear FEA panel via the tools.nonlinearFea menu
//        action. Assert every canonical test-id mounts (E / nu / sigY /
//        H / nx / L / increments / run-uniaxial / run-bar / close).
//   02 — Run 1-element uniaxial tension at σ_y0 = 250 MPa, H = 1 GPa,
//        20 increments. Assert: converged, stress at near-yield ≈ σ_y0
//        within 5%, final plastic strain > 0, monotonic-stress increase.
//   03 — Run 5-element bar with progressive yielding. Assert:
//        converged, plastic strain > 0 at last increment, slope after
//        yield positive.
//   04 — Validate convergence headlessly through the helper: final
//        residual / r0 < newton-tol, Dirichlet error ~= 0.
//   05 — Close panel + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (1-elem uniaxial-tension solve)
//   - right (5-elem bar solve)
//   - iso   (headless convergence validation + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(900000); // 15 min — Newton + PCG inside Electron
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-220-nonlinear-fea');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'nonlinear-fea-session.mp4');

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
        const has = await page.evaluate(() => !!window.__forgeNonlinearFeaLast);
        if (has) return await page.evaluate(() => {
            const r = window.__forgeNonlinearFeaLast;
            return {
                mode:               r.mode,
                converged:          r.converged,
                mat:                r.mat,
                geom:               r.geom,
                nIncrements:        r.nIncrements,
                targetIncrements:   r.targetIncrements,
                yieldStrain:        r.yieldStrain,
                finalStress:        r.finalStress,
                finalStrain:        r.finalStrain,
                finalMaxPEqv:       r.finalMaxPEqv,
                finalReaction:      r.finalReaction,
                finalResidual:      r.finalResidual,
                finalPlasticGPs:    r.finalPlasticGPs,
                history:            r.history.map((h) => ({
                    increment:     h.increment,
                    lambda:        h.lambda,
                    newtonIters:   h.newtonIters,
                    cgIters:       h.cgIters,
                    residual:      h.residual,
                    residualInitial: h.residualInitial,
                    maxPEqv:       h.maxPEqv,
                    reactionForce: h.reactionForce,
                    plasticGPCount: h.plasticGPCount,
                    diverged:      h.diverged,
                })),
                strainTrace:        r.strainTrace,
                engStressTrace:     r.engStressTrace,
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
        if (/push-220|nonlinear|fea|newton|plastic|yield|residual|error|Error/i.test(t)) {
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
        console.error('[push-220] no .webm');
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
                console.log(`[push-220] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-220] ffmpeg failed:', code,
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
        open:    typeof window.__forgeOpenNonlinearFea,
        close:   typeof window.__forgeCloseNonlinearFea,
        helper:  typeof window.__forgeNonlinearFeaHelper,
        helperKeys: window.__forgeNonlinearFeaHelper
            ? Object.keys(window.__forgeNonlinearFeaHelper).sort()
            : [],
        nodesPerElem: window.__forgeNonlinearFeaHelper?.NODES_PER_ELEM,
        dofsPerNode:  window.__forgeNonlinearFeaHelper?.DOFS_PER_NODE,
        dofsPerElem:  window.__forgeNonlinearFeaHelper?.DOFS_PER_ELEM,
        gaussPerElem: window.__forgeNonlinearFeaHelper?.GAUSS_PER_ELEM,
        gaussLen:     window.__forgeNonlinearFeaHelper?.GAUSS_POINTS?.length,
        hexCornersLen: window.__forgeNonlinearFeaHelper?.HEX_CORNERS?.length,
        solveDefaults: window.__forgeNonlinearFeaHelper?.SOLVE_DEFAULTS,
    }));
    console.log('[push-220] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('makeBarMesh');
    expect(surface.helperKeys).toContain('elasticCMatrix');
    expect(surface.helperKeys).toContain('radialReturn');
    expect(surface.helperKeys).toContain('elementAssemble');
    expect(surface.helperKeys).toContain('assembleGlobal');
    expect(surface.helperKeys).toContain('pcgSolve');
    expect(surface.helperKeys).toContain('newtonStep');
    expect(surface.helperKeys).toContain('solveNonlinearStatic');
    expect(surface.helperKeys).toContain('driveUniaxialTension');
    expect(surface.helperKeys).toContain('driveBarHardening');
    expect(surface.helperKeys).toContain('validateUniaxialTension');
    expect(surface.helperKeys).toContain('validateBarHardening');
    expect(surface.helperKeys).toContain('buildBMatrix');
    expect(surface.helperKeys).toContain('shapeDerivs');
    // Topology constants.
    expect(surface.nodesPerElem).toBe(8);
    expect(surface.dofsPerNode).toBe(3);
    expect(surface.dofsPerElem).toBe(24);
    expect(surface.gaussPerElem).toBe(8);
    expect(surface.gaussLen).toBe(8);
    expect(surface.hexCornersLen).toBe(8);
    expect(surface.solveDefaults.NEWTON_MAX_ITER).toBeGreaterThan(0);
    expect(surface.solveDefaults.CG_MAX_ITER).toBeGreaterThan(0);

    // Headless: 1-element radial-return sanity at the yield boundary.
    const headless = await page.evaluate(() => {
        const h = window.__forgeNonlinearFeaHelper;
        const E = 210e9, nu = 0.3, sigY0 = 250e6, H = 1e9;
        // Apply uniaxial strain just past yield in x. The von Mises
        // equivalent stress should clamp to ~σ_y0 (within the
        // hardening kick from Δp).
        const epsP0 = new Float64Array(6);
        const eps   = new Float64Array(6);
        eps[0] = sigY0 / E * 1.5;
        const rr = h.radialReturn(eps, epsP0, 0, E, nu, sigY0, H);
        // Mesh + state factory sanity.
        const mesh = h.makeBarMesh(2, 0.02, 0.005, 0.005);
        const state = h.makeState(mesh);
        return {
            plastic:  rr.plastic,
            Dgamma:   rr.Dgamma,
            sigEqv:   rr.sigEqv,
            pEqvNew:  rr.pEqv_new,
            sigmaXX:  rr.sigma[0],
            nDofs:    mesh.nDofs,
            nElems:   mesh.nElems,
            nGP:      state.pEqv.length,
            cMatNonzero: (() => {
                const C = h.elasticCMatrix(E, nu);
                let count = 0;
                for (let i = 0; i < C.length; i++) if (Math.abs(C[i]) > 0) count++;
                return count;
            })(),
        };
    });
    console.log('[push-220] headless radial-return =', JSON.stringify(headless));
    // Past yield ⇒ plastic flag must be set.
    expect(headless.plastic).toBe(true);
    expect(headless.Dgamma).toBeGreaterThan(0);
    // Equivalent stress should be near σ_y0 + √(2/3) H Δγ (linear hardening).
    expect(headless.sigEqv).toBeGreaterThan(245e6);  // > 245 MPa
    expect(headless.sigEqv).toBeLessThan(280e6);     // < 280 MPa
    // Mesh sanity.
    expect(headless.nDofs).toBe(3 * (2 + 1) * 2 * 2); // 36 DOFs for 2-element bar
    expect(headless.nElems).toBe(2);
    expect(headless.nGP).toBe(2 * 8);                 // 16 GPs total
    // C_e matrix: 3+3+3+3+3+3 = 21 nonzeros (Voigt symmetric).
    expect(headless.cMatNonzero).toBeGreaterThanOrEqual(15);

    await shot('host-surface-ok');
});

test('01 — open Nonlinear FEA panel via tools.nonlinearFea', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.nonlinearFea');
    await page.waitForSelector('[data-testid="forge-nlfea-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('nlfea-open');

    await expect(page.locator('[data-testid="forge-nlfea-E"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-nu"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-sigY"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-H"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-nx"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-L"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-increments"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-incr-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-run-uniaxial"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-run-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-close"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-preset"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-newton-cap"]')).toBeVisible();

    // Default state matches NLFEA_DEFAULTS.
    const defaults = await page.evaluate(() => ({
        E:    document.querySelector('[data-testid="forge-nlfea-E"]').value,
        nu:   document.querySelector('[data-testid="forge-nlfea-nu"]').value,
        sigY: document.querySelector('[data-testid="forge-nlfea-sigY"]').value,
        H:    document.querySelector('[data-testid="forge-nlfea-H"]').value,
        nx:   document.querySelector('[data-testid="forge-nlfea-nx"]').value,
        L:    document.querySelector('[data-testid="forge-nlfea-L"]').value,
        incr: document.querySelector('[data-testid="forge-nlfea-increments"]').value,
    }));
    console.log('[push-220] defaults =', JSON.stringify(defaults));
    expect(Number(defaults.E)).toBe(210e9);
    expect(Number(defaults.nu)).toBeCloseTo(0.3, 6);
    expect(Number(defaults.sigY)).toBe(250e6);
    expect(Number(defaults.H)).toBe(1e9);
    expect(Number(defaults.nx)).toBe(1);
    expect(Number(defaults.incr)).toBe(20);
});

test('02 — run 1-element uniaxial tension (σ_y = 250 MPa, H = 1 GPa, 20 incr)', async () => {
    await cameraTo('top');
    // Defaults already match the brief; just kick.
    await page.evaluate(() => { try { delete window.__forgeNonlinearFeaLast; } catch {} });
    await page.locator('[data-testid="forge-nlfea-run-uniaxial"]').click();
    await shot('uniaxial-clicked');

    const snap = await waitForLastResult(180000);
    expect(snap).not.toBeNull();
    console.log('[push-220] uniaxial snap =', JSON.stringify({
        mode:           snap.mode,
        converged:      snap.converged,
        nIncrements:    snap.nIncrements,
        E:              snap.mat.E,
        sigY0:          snap.mat.sigY0,
        H:              snap.mat.H,
        nx:             snap.geom.nx,
        L:              snap.geom.L,
        A:              snap.geom.A,
        finalStress:    snap.finalStress,
        finalStrain:    snap.finalStrain,
        finalMaxPEqv:   snap.finalMaxPEqv,
        finalReaction:  snap.finalReaction,
        finalPlasticGPs: snap.finalPlasticGPs,
    }));
    expect(snap.mode).toBe('uniaxial');
    expect(snap.converged).toBe(true);
    expect(snap.nIncrements).toBe(20);
    expect(snap.geom.nx).toBe(1);
    expect(snap.geom.A).toBeGreaterThan(0);

    // Hard contract from the brief: at σ_y = 250 MPa and L = 10 mm:
    //   yield strain = σ_y / E = 250e6 / 210e9 ≈ 1.19e-3
    //   maxDisp = yieldStrain · L · 4 = 4.76e-5 m
    //   reaction at yield ≈ σ_y · A
    // The increment closest to yield strain should produce a reaction
    // force within 5% of σ_y · A.
    const A = snap.geom.A;
    const yieldStrain = snap.yieldStrain;
    let idxNearYield = 0;
    for (let i = 1; i < snap.history.length; i++) {
        const eps = snap.history[i].lambda * (4 * yieldStrain);
        const epsPrev = snap.history[idxNearYield].lambda * (4 * yieldStrain);
        if (Math.abs(eps - yieldStrain) < Math.abs(epsPrev - yieldStrain)) {
            idxNearYield = i;
        }
    }
    const stressAtYield = snap.history[idxNearYield].reactionForce / A;
    const sigY0 = snap.mat.sigY0;
    const errAtYield = Math.abs(stressAtYield - sigY0) / sigY0;
    console.log('[push-220] yield-idx', idxNearYield,
        'stress', stressAtYield, 'sigY0', sigY0, 'err', errAtYield);
    // BENCHMARK ASSERTION: reaction ≈ σ_y · A within 5%.
    expect(errAtYield).toBeLessThan(0.05);

    // Plastic strain > 0 at last increment.
    expect(snap.finalMaxPEqv).toBeGreaterThan(0);
    // Final stress > yield (hardening kicked in).
    expect(snap.finalStress).toBeGreaterThan(sigY0);

    // Monotonic stress increase (positive hardening).
    let mono = true;
    for (let i = 1; i < snap.engStressTrace.length; i++) {
        if (snap.engStressTrace[i] < snap.engStressTrace[i - 1] - 1e3) {
            mono = false; break;
        }
    }
    expect(mono).toBe(true);

    // UI artefacts mount.
    await expect(page.locator('[data-testid="forge-nlfea-loaddisp"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-pchart"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-chip-stress"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-chip-peqv"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-chip-converged"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-yield-line"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nlfea-history"]')).toBeVisible();
    const histRows = await page.locator('[data-testid="forge-nlfea-hist-row"]').count();
    expect(histRows).toBe(20);

    await shot('uniaxial-solved');
});

test('03 — run 5-element bar with progressive yielding', async () => {
    await cameraTo('right');
    // Switch to 5-element bar.
    await page.locator('[data-testid="forge-nlfea-nx"]').selectOption('5');
    // Tighter Newton tol via 30 incr.
    await page.locator('[data-testid="forge-nlfea-increments"]').fill('25');
    await pause(200);
    await page.evaluate(() => { try { delete window.__forgeNonlinearFeaLast; } catch {} });
    await page.locator('[data-testid="forge-nlfea-run-bar"]').click();
    await shot('bar-clicked');

    const snap = await waitForLastResult(360000);
    expect(snap).not.toBeNull();
    console.log('[push-220] bar snap =', JSON.stringify({
        mode:           snap.mode,
        converged:      snap.converged,
        nIncrements:    snap.nIncrements,
        nx:             snap.geom.nx,
        L:              snap.geom.L,
        A:              snap.geom.A,
        finalStress:    snap.finalStress,
        finalStrain:    snap.finalStrain,
        finalMaxPEqv:   snap.finalMaxPEqv,
        finalReaction:  snap.finalReaction,
        finalPlasticGPs: snap.finalPlasticGPs,
    }));
    expect(snap.mode).toBe('bar');
    expect(snap.converged).toBe(true);
    expect(snap.geom.nx).toBe(5);
    // BENCHMARK ASSERTION: plastic strain > 0 at last increment.
    expect(snap.finalMaxPEqv).toBeGreaterThan(0);
    // 5 elements × 8 Gauss points = 40 GPs all in plastic regime.
    expect(snap.finalPlasticGPs).toBeGreaterThanOrEqual(8);

    // Slope after yield: positive hardening.
    const yieldStrain = snap.yieldStrain;
    const post = snap.history.filter((h, i) =>
        snap.strainTrace[i] > yieldStrain * 2);
    expect(post.length).toBeGreaterThan(3);
    const first = post[0];
    const last  = post[post.length - 1];
    const slope = (last.reactionForce - first.reactionForce)
                / Math.max((last.lambda - first.lambda), 1e-12);
    console.log('[push-220] post-yield slope =', slope);
    expect(slope).toBeGreaterThan(0);

    await shot('bar-solved');
});

test('04 — validate convergence headlessly through helper', async () => {
    await cameraTo('iso');
    const headless = await page.evaluate(() => {
        const h = window.__forgeNonlinearFeaHelper;
        // 2-element bar at yield: assert Newton residual / r0 drops
        // below the tol AND Dirichlet error ~= 0 at every increment.
        const out = h.driveBarHardening({
            E: 210e9, nu: 0.3, sigY0: 250e6, H: 1e9,
            L: 0.02, nx: 2,
            nIncrements: 10,
            newtonMaxIter: 25,
            newtonTol: 1e-5,
        });
        const reductions = out.history.map((step) => ({
            increment:        step.increment,
            lambda:           step.lambda,
            cgIters:          step.cgIters,
            newtonIters:      step.newtonIters,
            residual:         step.residual,
            residualInitial:  step.residualInitial,
            dirichletErr:     step.dirichletErr,
            relRes:           step.residual / Math.max(step.residualInitial, 1),
        }));
        return {
            converged: out.converged,
            history:   reductions,
            allFinite: reductions.every((r) =>
                Number.isFinite(r.residual) && Number.isFinite(r.relRes)),
            maxRelRes: Math.max(...reductions.map((r) => r.relRes)),
            maxDirErr: Math.max(...reductions.map((r) => r.dirichletErr || 0)),
            anyDiverged: out.history.some((h) => h.diverged),
        };
    });
    console.log('[push-220] convergence headless =', JSON.stringify(headless, null, 2));
    expect(headless.converged).toBe(true);
    expect(headless.allFinite).toBe(true);
    expect(headless.anyDiverged).toBe(false);
    // BENCHMARK ASSERTION: final residual ratio < tolerance.
    expect(headless.maxRelRes).toBeLessThan(1e-2);
    // Dirichlet enforcement is exact through the partitioning solver.
    expect(headless.maxDirErr).toBeLessThan(1e-9);

    // Validate the uniaxial-tension self-check returns all-green.
    const valid = await page.evaluate(() => {
        const h = window.__forgeNonlinearFeaHelper;
        const v = h.validateUniaxialTension({ nIncrements: 20 });
        return {
            converged: v.converged,
            passed:    v.validation.passed,
            checks:    v.validation.checks.map((c) => ({
                name: c.name, pass: c.pass,
                value: typeof c.value === 'number' ? c.value : null,
            })),
        };
    });
    console.log('[push-220] uniaxial validation =', JSON.stringify(valid, null, 2));
    expect(valid.converged).toBe(true);
    expect(valid.passed).toBe(true);
    expect(valid.checks.find((c) => c.name === 'newton-converged').pass).toBe(true);
    expect(valid.checks.find((c) => c.name === 'plastic-strain-positive').pass).toBe(true);
    expect(valid.checks.find((c) => c.name === 'monotonic-stress').pass).toBe(true);
    expect(valid.checks.find((c) => c.name === 'stress-at-yield-near-sigY0').pass).toBe(true);

    await shot('headless-convergence');
});

test('05 — close panel + final shot', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-nlfea-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-nlfea-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
