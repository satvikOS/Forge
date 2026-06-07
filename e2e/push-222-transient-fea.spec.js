// PUSH-222 (Slice-158) — Real Transient Dynamics FEA via Newmark-β.
//
// Drives the TransientFeaPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenTransientFea +
//        window.__forgeTransientFeaHelper install BEFORE the panel mounts.
//        Sanity-check the solver primitives headlessly (assembleK,
//        assembleMass, newmarkStep, LU, buildSdofFixture, etc.).
//   01 — Open the Transient FEA panel via the tools.transientFea menu
//        action. Assert every canonical test-id mounts (dt / T / β / γ /
//        Rayleigh α / Rayleigh β / load type / amp / ω / Run / close).
//   02 — Undamped free vibration. M = 1, K = 4π² → period T_n = 1 s. Run
//        from 0 to 2 s with dt = 0.01. Assert displacement amplitude
//        matches initial (1.0 m) within 5% AND period matches 1 s.
//   03 — Damped vibration (Rayleigh α = 0.5). Assert amplitude decays
//        between the first and last half of the time window.
//   04 — Sinusoidal forcing at resonance (ω = ω_n = 2π). Assert amplitude
//        grows over time (peak in late half >> peak in early half).
//   05 — Close.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (undamped free vibration)
//   - right (damped vibration)
//   - iso   (resonance + close)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — multiple Newmark runs in Electron
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-222-transient-fea');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'transient-fea-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-'
        + label.replace(/[^a-z0-9-_.]/gi, '_');
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

// Wait for the panel to publish the run snapshot on window.
async function waitForLastResult(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const has = await page.evaluate(() => !!window.__forgeTransientFeaLast);
        if (has) {
            return await page.evaluate(() => {
                const r = window.__forgeTransientFeaLast;
                return {
                    dt: r.dt, tEnd: r.tEnd,
                    beta: r.beta, gamma: r.gamma,
                    alphaRayleigh: r.alphaRayleigh,
                    betaRayleigh:  r.betaRayleigh,
                    loadType: r.loadType, loadDof: r.loadDof,
                    loadAmp: r.loadAmp, loadOmega: r.loadOmega,
                    monitorDof: r.monitorDof,
                    N: r.N, nSteps: r.nSteps,
                    maxAbsDisp: r.maxAbsDisp,
                    maxAbsVel:  r.maxAbsVel,
                    maxAbsAcc:  r.maxAbsAcc,
                    elapsedMs:  r.elapsedMs,
                    times:       r.times,
                    dispMonitor: r.dispMonitor,
                    velMonitor:  r.velMonitor,
                    accMonitor:  r.accMonitor,
                    energy:      r.energy,
                    fixture:     r.fixture,
                    finalDisp:   r.finalDisp,
                    finalVel:    r.finalVel,
                    finalAcc:    r.finalAcc,
                };
            });
        }
        await pause(300);
    }
    return null;
}

// Inspect a series to find peak amplitudes in two time windows.
function windowPeakAbs(times, values, tStart, tEnd) {
    let peak = 0;
    for (let i = 0; i < times.length; i++) {
        if (times[i] < tStart || times[i] > tEnd) continue;
        const v = Math.abs(values[i]);
        if (v > peak) peak = v;
    }
    return peak;
}

// Measure the period of an oscillation by finding zero crossings.
function estimatePeriod(times, values) {
    const xings = [];
    for (let i = 1; i < values.length; i++) {
        if ((values[i - 1] > 0 && values[i] <= 0)
            || (values[i - 1] < 0 && values[i] >= 0)) {
            // linear interp t where v crosses zero
            const dv = values[i] - values[i - 1];
            if (Math.abs(dv) < 1e-30) continue;
            const frac = -values[i - 1] / dv;
            xings.push(times[i - 1] + frac * (times[i] - times[i - 1]));
        }
    }
    if (xings.length < 3) return null;
    // Period = 2 × average gap between consecutive zero crossings.
    let sum = 0, count = 0;
    for (let i = 1; i < xings.length; i++) {
        sum += xings[i] - xings[i - 1];
        count++;
    }
    return 2 * (sum / count);
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
        if (/push-222|transient|newmark|fea|damping|rayleigh|error|Error/i.test(t)) {
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

    // Dismiss onboarding (Forge-189) so it doesn't block button clicks.
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
        console.error('[push-222] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin;
    try {
        ffmpegBin = require('ffmpeg-static');
    } catch (err) {
        console.error('[push-222] ffmpeg-static not available, skipping mp4 conversion:',
            err.message);
        return;
    }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-222] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-222] ffmpeg failed:', code,
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
        open:    typeof window.__forgeOpenTransientFea,
        close:   typeof window.__forgeCloseTransientFea,
        helper:  typeof window.__forgeTransientFeaHelper,
        helperKeys: window.__forgeTransientFeaHelper
            ? Object.keys(window.__forgeTransientFeaHelper).sort()
            : [],
        defaults: window.__forgeTransientFeaHelper?.TRANSIENT_DEFAULTS,
        loadTypes: window.__forgeTransientFeaHelper?.LOAD_TYPES,
    }));
    console.log('[push-222] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('assembleK');
    expect(surface.helperKeys).toContain('assembleMass');
    expect(surface.helperKeys).toContain('assembleC');
    expect(surface.helperKeys).toContain('newmarkStep');
    expect(surface.helperKeys).toContain('solveTransient');
    expect(surface.helperKeys).toContain('buildSdofFixture');
    expect(surface.helperKeys).toContain('makeLoadFn');
    expect(surface.helperKeys).toContain('luDecompose');
    expect(surface.helperKeys).toContain('luSolve');
    expect(surface.helperKeys).toContain('conjugateGradient');
    expect(surface.helperKeys).toContain('initialAcceleration');
    expect(surface.helperKeys).toContain('TRANSIENT_DEFAULTS');
    expect(surface.helperKeys).toContain('LOAD_TYPES');
    // Default Newmark parameters.
    expect(surface.defaults.BETA).toBeCloseTo(0.25, 6);
    expect(surface.defaults.GAMMA).toBeCloseTo(0.5,  6);
    // Load type strings.
    expect(surface.loadTypes.IMPULSE).toBe('impulse');
    expect(surface.loadTypes.SINE).toBe('sinusoidal');
    expect(surface.loadTypes.STEP).toBe('step');
    expect(surface.loadTypes.ZERO).toBe('zero');

    // Headless solver smoke — assemble + LU + Newmark step.
    const headless = await page.evaluate(() => {
        const h = window.__forgeTransientFeaHelper;
        const fixture = h.buildSdofFixture({ K: 4 * Math.PI * Math.PI, m: 1 });
        const locals = h.localiseElements(fixture.elements, fixture.nodes);
        const { K, N } = h.assembleK(locals, fixture.nodes, { dofsPerNode: 1 });
        const { M } = h.assembleMass(locals, fixture.nodes, { dofsPerNode: 1 });
        const C = h.assembleC(M, K, 0, 0);
        // Mass at free node = 1, stiffness at free node = 4π².
        const k4pi2 = 4 * Math.PI * Math.PI;
        return {
            N,
            Kfree: K[1 * N + 1],
            Mfree: M[1 * N + 1],
            Cfree: C[1 * N + 1],
            target: k4pi2,
            fixtureFreq: fixture.naturalFreqHz,
            fixturePeriod: fixture.naturalPeriod,
            kfullSize: K.length,
        };
    });
    console.log('[push-222] headless assembly =', JSON.stringify(headless));
    expect(headless.N).toBe(2);
    expect(headless.Kfree).toBeCloseTo(4 * Math.PI * Math.PI, 6);
    expect(headless.Mfree).toBeCloseTo(1.0, 6);
    expect(headless.Cfree).toBeCloseTo(0.0, 6);
    expect(headless.fixtureFreq).toBeCloseTo(1.0, 4);
    expect(headless.fixturePeriod).toBeCloseTo(1.0, 4);
    expect(headless.kfullSize).toBe(4);

    // Headless single Newmark step — verify state advances.
    const stepRes = await page.evaluate(() => {
        const h = window.__forgeTransientFeaHelper;
        const fixture = h.buildSdofFixture();
        const locals = h.localiseElements(fixture.elements, fixture.nodes);
        const { K, N } = h.assembleK(locals, fixture.nodes, { dofsPerNode: 1 });
        const { M } = h.assembleMass(locals, fixture.nodes, { dofsPerNode: 1 });
        const C = h.assembleC(M, K, 0, 0);
        const mask = h.buildFixedMask(fixture.nodes, 1);
        const u = new Float64Array([0, 1.0]);    // free node displaced 1 m
        const v = new Float64Array(N);
        const f = new Float64Array(N);
        const a = h.initialAcceleration(M, C, K, u, v, f, { fixedMask: mask });
        const r = h.newmarkStep(M, C, K, u, v, a, f, 0.01, 0.25, 0.5,
            { fixedMask: mask, solver: 'lu' });
        return {
            initialDisp: u[1], initialVel: v[1], initialAcc: a[1],
            nextDisp:    r.uNext[1],
            nextVel:     r.udotNext[1],
            nextAcc:     r.uddotNext[1],
            // Fixed DOF must stay 0.
            fixedDisp: r.uNext[0],
            fixedVel:  r.udotNext[0],
            fixedAcc:  r.uddotNext[0],
        };
    });
    console.log('[push-222] headless step =', JSON.stringify(stepRes));
    // Initial accel for u=1, K=4π², M=1: ü_0 = -K·u/M = -4π² ≈ -39.48
    expect(stepRes.initialAcc).toBeCloseTo(-4 * Math.PI * Math.PI, 3);
    // After one 10 ms step at f_n = 1 Hz, displacement barely moves
    // (it's on the cosine peak). Should still be close to 1.
    expect(stepRes.nextDisp).toBeLessThan(1.001);
    expect(stepRes.nextDisp).toBeGreaterThan(0.95);
    // Fixed DOFs must stay zero.
    expect(stepRes.fixedDisp).toBe(0);
    expect(stepRes.fixedVel).toBe(0);
    expect(stepRes.fixedAcc).toBe(0);

    await shot('host-surface-ok');
});

test('01 — open transient FEA panel via tools.transientFea', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.transientFea');
    await page.waitForSelector('[data-testid="forge-transient-fea-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-transient-fea-dt"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-tend"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-beta"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-gamma"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-alphaR"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-betaR"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-loadtype"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-loadamp"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-loadomega"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-u0"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-run"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-close"]')).toBeVisible();

    // Default state — dt=0.01, T=2, β=0.25, γ=0.5.
    const defaults = await page.evaluate(() => ({
        dt:    document.querySelector('[data-testid="forge-transient-fea-dt"]').value,
        tEnd:  document.querySelector('[data-testid="forge-transient-fea-tend"]').value,
        beta:  document.querySelector('[data-testid="forge-transient-fea-beta"]').value,
        gamma: document.querySelector('[data-testid="forge-transient-fea-gamma"]').value,
        alphaR: document.querySelector('[data-testid="forge-transient-fea-alphaR"]').value,
        betaR:  document.querySelector('[data-testid="forge-transient-fea-betaR"]').value,
    }));
    console.log('[push-222] defaults =', JSON.stringify(defaults));
    expect(Number(defaults.dt)).toBeCloseTo(0.01, 6);
    expect(Number(defaults.tEnd)).toBeCloseTo(2.0, 6);
    expect(Number(defaults.beta)).toBeCloseTo(0.25, 6);
    expect(Number(defaults.gamma)).toBeCloseTo(0.5, 6);
    expect(Number(defaults.alphaR)).toBeCloseTo(0.0, 6);
    expect(Number(defaults.betaR)).toBeCloseTo(0.0, 6);
});

test('02 — undamped free vibration: amplitude conserved + period ≈ 1 s', async () => {
    await cameraTo('top');
    // Configure: undamped, free vibration starting at u=1.0, no load.
    await page.locator('[data-testid="forge-transient-fea-dt"]').fill('0.01');
    await page.locator('[data-testid="forge-transient-fea-tend"]').fill('2');
    await page.locator('[data-testid="forge-transient-fea-beta"]').fill('0.25');
    await page.locator('[data-testid="forge-transient-fea-gamma"]').fill('0.5');
    await page.locator('[data-testid="forge-transient-fea-alphaR"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-betaR"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-loadtype"]').selectOption('zero');
    await page.locator('[data-testid="forge-transient-fea-loadamp"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-u0"]').fill('1');
    await pause(200);
    await shot('undamped-configured');

    // Reset last-result + kick the run.
    await page.evaluate(() => { try { delete window.__forgeTransientFeaLast; } catch {} });
    await page.locator('[data-testid="forge-transient-fea-run"]').click();

    const snap = await waitForLastResult(60000);
    expect(snap).not.toBeNull();
    console.log('[push-222] undamped snap =', JSON.stringify({
        dt: snap.dt, tEnd: snap.tEnd, nSteps: snap.nSteps,
        beta: snap.beta, gamma: snap.gamma,
        alphaR: snap.alphaRayleigh, betaR: snap.betaRayleigh,
        loadType: snap.loadType, loadAmp: snap.loadAmp,
        maxDisp: snap.maxAbsDisp, maxVel: snap.maxAbsVel,
        maxAcc: snap.maxAbsAcc, elapsedMs: snap.elapsedMs,
        finalDisp: snap.finalDisp, finalVel: snap.finalVel,
    }));
    expect(snap.dt).toBeCloseTo(0.01, 6);
    expect(snap.tEnd).toBeCloseTo(2.0, 6);
    expect(snap.beta).toBeCloseTo(0.25, 6);
    expect(snap.gamma).toBeCloseTo(0.5, 6);
    expect(snap.alphaRayleigh).toBeCloseTo(0.0, 6);
    expect(snap.betaRayleigh).toBeCloseTo(0.0, 6);
    expect(snap.loadType).toBe('zero');
    expect(snap.nSteps).toBe(200);
    expect(snap.fixture.K).toBeCloseTo(4 * Math.PI * Math.PI, 4);
    expect(snap.fixture.m).toBeCloseTo(1.0, 6);

    // ─── AMPLITUDE CONSERVATION ───
    // For Newmark γ=1/2, β=1/4 on an undamped SDOF, amplitude is
    // exactly conserved analytically. Numerically there is a tiny phase
    // / amplitude drift on a coarse dt; the spec calls out a 5% bound.
    expect(snap.maxAbsDisp).toBeGreaterThan(0.95);
    expect(snap.maxAbsDisp).toBeLessThan(1.05);

    // ─── PERIOD MATCH ───
    // Estimate period from zero crossings of the displacement signal.
    // The exact period is 2π / ω_n = 1 s.
    const T_est = estimatePeriod(snap.times, snap.dispMonitor);
    console.log('[push-222] estimated period =', T_est);
    expect(T_est).not.toBeNull();
    // Newmark γ=1/2 β=1/4 has a small period elongation. On dt = 0.01
    // with T_n = 1 s, the relative period error is well under 1%, but
    // we allow 5% to keep the test robust to platform variability.
    expect(Math.abs(T_est - 1.0)).toBeLessThan(0.05);

    // Plot test-id renders.
    await expect(page.locator('[data-testid="forge-transient-fea-plot-disp"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-chip-maxdisp"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-chip-maxvel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-transient-fea-chip-maxacc"]')).toBeVisible();

    // Energy must be approximately conserved (within ~5%).
    const E0 = snap.energy[0];
    const Ef = snap.energy[snap.energy.length - 1];
    console.log('[push-222] energy E0/Ef =', E0, Ef, 'ratio =', Ef / E0);
    // For undamped Newmark, energy is bounded and oscillates ±O(dt²) about
    // the analytic value; we just need it to not grow / decay grossly.
    expect(Math.abs((Ef - E0) / E0)).toBeLessThan(0.1);

    await shot('undamped-solved');
});

test('03 — damped vibration (Rayleigh α = 0.5) → amplitude decays', async () => {
    await cameraTo('right');
    await page.evaluate(() => { try { delete window.__forgeTransientFeaLast; } catch {} });

    await page.locator('[data-testid="forge-transient-fea-dt"]').fill('0.01');
    await page.locator('[data-testid="forge-transient-fea-tend"]').fill('4');
    await page.locator('[data-testid="forge-transient-fea-alphaR"]').fill('0.5');
    await page.locator('[data-testid="forge-transient-fea-betaR"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-loadtype"]').selectOption('zero');
    await page.locator('[data-testid="forge-transient-fea-loadamp"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-u0"]').fill('1');
    await pause(200);
    await shot('damped-configured');

    await page.locator('[data-testid="forge-transient-fea-run"]').click();
    const snap = await waitForLastResult(60000);
    expect(snap).not.toBeNull();
    console.log('[push-222] damped snap =', JSON.stringify({
        alphaR: snap.alphaRayleigh, betaR: snap.betaRayleigh,
        maxDisp: snap.maxAbsDisp, maxVel: snap.maxAbsVel,
        elapsedMs: snap.elapsedMs, nSteps: snap.nSteps,
    }));
    expect(snap.alphaRayleigh).toBeCloseTo(0.5, 6);
    expect(snap.tEnd).toBeCloseTo(4.0, 6);
    expect(snap.nSteps).toBe(400);

    // ─── AMPLITUDE DECAY ───
    // Peak amplitude in the first second vs the last second. With
    // α = 0.5 and ω_n = 2π, the damping ratio is ξ = α / (2·ω_n) ≈ 0.04,
    // i.e. ~4% per cycle. Over 4 cycles (1 → 4 s), envelope shrinks by
    // exp(-α/2 · 3 s) ≈ exp(-0.75) ≈ 0.47, so the late peak should be
    // less than half of the early peak.
    const earlyPeak = windowPeakAbs(snap.times, snap.dispMonitor, 0.0, 1.0);
    const latePeak  = windowPeakAbs(snap.times, snap.dispMonitor, 3.0, 4.0);
    console.log('[push-222] damped peaks early/late =', earlyPeak, latePeak,
        'ratio =', latePeak / earlyPeak);
    expect(earlyPeak).toBeGreaterThan(0.9);
    expect(latePeak).toBeLessThan(earlyPeak * 0.8);

    // Energy should monotonically decrease (Rayleigh damping is
    // dissipative; numerical scheme is conservative-ish but the damping
    // term forces dE/dt < 0).
    const E0 = snap.energy[0];
    const Ef = snap.energy[snap.energy.length - 1];
    console.log('[push-222] damped E0/Ef =', E0, Ef);
    expect(Ef).toBeLessThan(E0 * 0.8);

    await shot('damped-solved');
});

test('04 — sinusoidal forcing at resonance → amplitude grows', async () => {
    await cameraTo('iso');
    await page.evaluate(() => { try { delete window.__forgeTransientFeaLast; } catch {} });

    // Resonant forcing — ω_force = ω_n = 2π so an undamped SDOF has
    // linearly growing amplitude: |u(t)| ~ (F_0 / 2 M ω_n) · t.
    await page.locator('[data-testid="forge-transient-fea-dt"]').fill('0.01');
    await page.locator('[data-testid="forge-transient-fea-tend"]').fill('5');
    await page.locator('[data-testid="forge-transient-fea-alphaR"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-betaR"]').fill('0');
    await page.locator('[data-testid="forge-transient-fea-loadtype"]').selectOption('sinusoidal');
    await page.locator('[data-testid="forge-transient-fea-loadamp"]').fill('1');
    await page.locator('[data-testid="forge-transient-fea-loadomega"]').fill((2 * Math.PI).toString());
    await page.locator('[data-testid="forge-transient-fea-u0"]').fill('0');
    await pause(200);
    await shot('resonance-configured');

    await page.locator('[data-testid="forge-transient-fea-run"]').click();
    const snap = await waitForLastResult(60000);
    expect(snap).not.toBeNull();
    console.log('[push-222] resonance snap =', JSON.stringify({
        loadType: snap.loadType, loadAmp: snap.loadAmp,
        loadOmega: snap.loadOmega,
        maxDisp: snap.maxAbsDisp, maxVel: snap.maxAbsVel,
        elapsedMs: snap.elapsedMs, nSteps: snap.nSteps,
    }));
    expect(snap.loadType).toBe('sinusoidal');
    expect(snap.loadAmp).toBeCloseTo(1.0, 6);
    expect(snap.loadOmega).toBeCloseTo(2 * Math.PI, 4);
    expect(snap.nSteps).toBe(500);

    // ─── RESONANT AMPLIFICATION ───
    // Late-window peak >> early-window peak.
    const earlyPeak = windowPeakAbs(snap.times, snap.dispMonitor, 0.0, 1.0);
    const latePeak  = windowPeakAbs(snap.times, snap.dispMonitor, 4.0, 5.0);
    console.log('[push-222] resonance peaks early/late =', earlyPeak, latePeak,
        'ratio =', latePeak / earlyPeak);
    // Analytic envelope of resonant response of an undamped SDOF with
    // F·sin(ω_n t) starting from rest: u(t) = − (F/(2 M ω_n)) [sin(ω_n t)
    // − ω_n t cos(ω_n t)]. The dominant term grows linearly with t.
    // With F=1, M=1, ω_n=2π, at t=1 s: peak ≈ 1/(2·2π)·1 ≈ 0.08;
    // at t=4 s: peak ≈ 1/(2·2π)·4 ≈ 0.32. So late should be ~3-4× early.
    expect(latePeak).toBeGreaterThan(earlyPeak * 2);

    // Final displacement is non-trivial (not stuck at 0).
    expect(Math.abs(snap.finalDisp) + Math.abs(snap.finalVel)).toBeGreaterThan(0.1);

    await shot('resonance-solved');
});

test('05 — close panel + final shot', async () => {
    await page.locator('[data-testid="forge-transient-fea-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-transient-fea-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
