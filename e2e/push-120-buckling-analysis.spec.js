// PUSH-120 (Slice-88) — Buckling Analysis panel.
//
// PUSH-48 wired the omnibus Simulation workbench (10 study types) and
// PUSH-114 + PUSH-115 factored Modal and Thermal out into dedicated
// single-purpose panels. PUSH-120 does the same for linearised buckling:
// pick a body, apply a compressive axial load on one AABB face, pin the
// opposite (clamp) face, then Run → λ₁ (first critical buckling factor)
// and P_cr = λ₁ × F_applied off forge.fea.solveBuckling.
//
// Proof end-to-end through the real Electron UI:
//
//   00 — Boot, seed a real OCCT 100×10×10 mm column (SI metres on the
//        kernel hop), confirm the panel host exposes
//        window.__forgeOpenBucklingAnalysis + window.__forgeBucklingAnalysisHelper
//        before the panel mounts. iso view.
//   01 — Open PUSH-109 Material Properties, pick Steel A36 (E = 200 GPa,
//        ρ = 7.85 g/cc), Apply. Verifies the panel reads
//        window.__forgeMaterialProperties for E + ρ. iso view.
//   02 — Open Buckling Analysis via tools.bucklingAnalysis menu action.
//        Panel + body picker + material readout + load inputs + faces
//        + nModes are visible. Material readout shows E = 200 GPa, ρ =
//        7.85 g/cc. front view.
//   03 — Configure the canonical fixed-free column: 1000 N applied along
//        -X on face 1 (+X), clamp face 0 (-X). Run. Assert the kernel
//        returns a real positive λ₁ and a non-empty modes table. Mirror
//        on window.__forgeBucklingAnalysis confirms the same. top view.
//   04 — Cross-check the kernel directly with the same geometry +
//        material, compare against the panel-driven λ₁ (tolerance ±25%).
//        right view.
//   05 — PUSH-48 regression: Simulation workbench still meshes + solves
//        Static. iso view.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface + material)
//   - front (open Buckling panel)
//   - top   (configure + Run)
//   - right (kernel cross-check)
//   - iso   (regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-120-buckling-analysis');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'buckling-analysis-session.mp4');

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-120|buckling|matprops|material|fea|solve|error|Error/i.test(t)) {
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

    // Persistently dismiss the onboarding tour (Forge-189) — it blocks
    // button clicks for the rest of the session if left up.
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

    // Reset PUSH-109 materialProps so stale records don't bleed in.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.materialProps'); } catch {}
        try { window.localStorage.removeItem('forge.v4.bodyMaterials'); } catch {}
        const mp = window.__forgeMaterialPropertiesHelper;
        if (mp && typeof mp.clearMaterialProperties === 'function') {
            mp.clearMaterialProperties();
        }
    });
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
        console.error('[push-120] no .webm');
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
                console.log(`[push-120] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-120] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + seed a 100×10×10 mm column (SI metres) + assert helper surface', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Helper + open hook must be wired BEFORE the user opens the panel.
    const surface = await page.evaluate(() => ({
        hasOpen:    typeof window.__forgeOpenBucklingAnalysis === 'function',
        hasClose:   typeof window.__forgeCloseBucklingAnalysis === 'function',
        hasHelper:  typeof window.__forgeBucklingAnalysisHelper === 'object'
                    && window.__forgeBucklingAnalysisHelper !== null,
        runFn:      typeof window.__forgeBucklingAnalysisHelper?.runBucklingAnalysis === 'function',
        materialFn: typeof window.__forgeBucklingAnalysisHelper?.readBucklingMaterialForHandle === 'function',
        faces:      (window.__forgeBucklingAnalysisHelper?.FACE_LABELS || []).length,
        dirs:       (window.__forgeBucklingAnalysisHelper?.DIRECTIONS || []).length,
        keyKernel:  typeof window.forge?.fea?.solveBuckling === 'function',
        keyMesh:    typeof window.forge?.fea?.meshFromBrep === 'function',
    }));
    console.log('[push-120] surface =', JSON.stringify(surface));
    expect(surface.hasOpen).toBe(true);
    expect(surface.hasClose).toBe(true);
    expect(surface.hasHelper).toBe(true);
    expect(surface.runFn).toBe(true);
    expect(surface.materialFn).toBe(true);
    expect(surface.faces).toBe(6);
    expect(surface.dirs).toBe(6);
    expect(surface.keyKernel).toBe(true);
    expect(surface.keyMesh).toBe(true);

    // 100×10×10 mm → 0.1×0.01×0.01 m, identical aspect ratio to the
    // forge-kernel buckling smoke (which clamps -X, loads +X).
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(0.1, 0.01, 0.01);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-buckling-column', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Buckling Column',
            params: { width: 0.1, height: 0.01, distance: 0.01 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');

    await page.evaluate((h) => { window.__push120Handle = h; }, seeded.handle);
});

test('01 — apply Steel A36 material so E = 200 GPa, ρ = 7.85 g/cc lands on the window mirror', async () => {
    await cameraTo('iso');
    await platformMenuAction('tools.materialProperties');
    await page.waitForSelector('[data-testid="forge-matprops-panel"]', {
        state: 'visible', timeout: 6000,
    });
    await shot('matprops-open');

    await page.locator('[data-testid="forge-matprops-preset"]')
        .selectOption('Steel A36');
    await pause(300);

    await page.locator('[data-testid="forge-matprops-apply"]').click();
    await pause(300);
    await shot('matprops-steel-applied');

    const handle = await page.evaluate(() => window.__push120Handle);
    const rec = await page.evaluate((h) => {
        const map = window.__forgeMaterialProperties;
        return (map && typeof map === 'object') ? (map[h] || null) : null;
    }, handle);
    console.log('[push-120] mat record =', rec);
    expect(rec).not.toBeNull();
    expect(rec.E).toBeCloseTo(200, 2);
    expect(rec.density).toBeCloseTo(7.85, 2);

    // Close the matprops panel so it doesn't shadow the buckling panel.
    await page.locator('[data-testid="forge-matprops-close"]').click();
    await pause(300);
});

test('02 — open Buckling Analysis via tools.bucklingAnalysis menu action', async () => {
    await cameraTo('front');

    await platformMenuAction('tools.bucklingAnalysis');
    await page.waitForSelector('[data-testid="forge-buckling-panel"]', {
        state: 'visible', timeout: 6000,
    });
    await shot('buckling-panel-open');

    // Body picker auto-selects the seeded column.
    const bodyVal = await page.locator('[data-testid="forge-buckling-body"]').inputValue();
    expect(Number(bodyVal)).toBeGreaterThan(0);

    // Material readout — E = 200 GPa, ρ = 7.85 g/cc straight off PUSH-109.
    const eTxt = await page.locator('[data-testid="forge-buckling-material-E"]').innerText();
    const dTxt = await page.locator('[data-testid="forge-buckling-material-density"]').innerText();
    console.log('[push-120] material readout =', eTxt, '·', dTxt);
    expect(eTxt).toMatch(/200\.0\s*GPa/);
    expect(dTxt).toMatch(/7\.85\s*g\/cc/);

    // Every control test-id is present.
    await expect(page.locator('[data-testid="forge-buckling-magnitude"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-buckling-direction"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-buckling-loaded-face"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-buckling-clamp-face"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-buckling-nmodes"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-buckling-mesh-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-buckling-run"]')).toBeVisible();

    // Defaults: load 1000 N along -X on face 1 (+X), clamp face 0 (-X),
    // 3 modes. Canonical fixed-free axial-compression column.
    const magnVal = await page.locator('[data-testid="forge-buckling-magnitude"]').inputValue();
    expect(Number(magnVal)).toBeCloseTo(1000, 0);
    const dirVal = await page.locator('[data-testid="forge-buckling-direction"]').inputValue();
    expect(dirVal).toBe('-X');
    const loadedVal = await page.locator('[data-testid="forge-buckling-loaded-face"]').inputValue();
    expect(Number(loadedVal)).toBe(1);
    const clampVal = await page.locator('[data-testid="forge-buckling-clamp-face"]').inputValue();
    expect(Number(clampVal)).toBe(0);
    const modesVal = await page.locator('[data-testid="forge-buckling-nmodes"]').inputValue();
    expect(Number(modesVal)).toBe(3);
});

test('03 — 1000 N axial compression on +X face, clamp -X face → real positive λ₁', async () => {
    await cameraTo('top');

    // Mesh at 5 mm — same coarseness the PUSH-48 spec uses on a 60×20×20
    // block. A 100×10×10 column at 5 mm gives a ~21×3×3 hex grid (~189
    // nodes ≈ 567 DOF) which is well inside the dense-eigen cap (4000).
    await page.locator('[data-testid="forge-buckling-mesh-slider"]').fill('5');
    await pause(200);

    // Reaffirm the canonical column-compression config (defaults match
    // but we re-write so the test is robust to future default changes).
    await page.locator('[data-testid="forge-buckling-magnitude"]').fill('1000');
    await page.locator('[data-testid="forge-buckling-direction"]').selectOption('-X');
    await page.locator('[data-testid="forge-buckling-loaded-face"]').selectOption('1');
    await page.locator('[data-testid="forge-buckling-clamp-face"]').selectOption('0');
    await page.locator('[data-testid="forge-buckling-nmodes"]').fill('3');
    await pause(200);
    await shot('params-set');

    // Dismiss any stale autosave banner before clicking Run.
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 2000 }).catch(() => {});

    await page.locator('[data-testid="forge-buckling-run"]').click({
        force: true, noWaitAfter: true,
    });
    // The dense eigensolver on ~600 DOFs is well under a second on M4 Max
    // but we give it a generous budget to avoid flakes in CI.
    await page.waitForSelector('[data-testid="forge-buckling-modes-table"]',
        { state: 'visible', timeout: 30000 });
    await pause(400);
    await shot('solved');

    // Surface any error message that might have come back.
    const errCount = await page.locator('[data-testid="forge-buckling-error"]').count();
    if (errCount > 0) {
        const errTxt = await page.locator('[data-testid="forge-buckling-error"]').innerText().catch(() => '');
        if (errTxt.trim()) console.log('[push-120] panel error =', errTxt);
    }

    // Stats panel reads the actual kernel result.
    await expect(page.locator('[data-testid="forge-buckling-stats"]')).toBeVisible({ timeout: 15000 });
    const lambdaTxt = await page.locator('[data-testid="forge-buckling-lambda1"]').innerText();
    const fTxt      = await page.locator('[data-testid="forge-buckling-f-applied"]').innerText();
    const pcrTxt    = await page.locator('[data-testid="forge-buckling-p-cr"]').innerText();
    const lambda1   = Number(/([-+]?\d+\.\d+e[+-]?\d+|\d+\.?\d*)/.exec(lambdaTxt)?.[1]);
    const F_applied = Number(/([-+]?\d+\.\d+e[+-]?\d+|\d+\.?\d*)/.exec(fTxt)?.[1]);
    const P_cr      = Number(/([-+]?\d+\.\d+e[+-]?\d+|\d+\.?\d*)/.exec(pcrTxt)?.[1]);
    console.log('[push-120] stats: λ₁ =', lambda1, 'F =', F_applied, 'P_cr =', P_cr);

    // λ₁ must be a real positive finite number — a real critical
    // buckling factor.
    expect(Number.isFinite(lambda1)).toBe(true);
    expect(lambda1).toBeGreaterThan(0);
    // F_applied is the magnitude we configured.
    expect(F_applied).toBeCloseTo(1000, 0);
    // P_cr = λ₁ × F.
    expect(P_cr).toBeCloseTo(lambda1 * F_applied, -2);

    // Modes table — count rows, every λᵢ must be finite & > 0.
    const rowCount = await page.locator('[data-testid^="forge-buckling-row-"]').count();
    console.log('[push-120] modes table row count =', rowCount);
    expect(rowCount).toBeGreaterThanOrEqual(1);

    let positiveLambdas = 0;
    for (let i = 1; i <= rowCount; i++) {
        const lTxt = await page.locator(`[data-testid="forge-buckling-lambda-${i}"]`)
            .innerText().catch(() => '');
        const lam = Number(/([-+]?\d+\.\d+e[+-]?\d+|\d+\.?\d*)/.exec(lTxt)?.[1]);
        if (Number.isFinite(lam) && lam > 0) positiveLambdas += 1;
    }
    console.log('[push-120] positive-λ rows =', positiveLambdas, '/', rowCount);
    expect(positiveLambdas).toBeGreaterThan(0);

    // Helper-side mirror — the run published its summary onto
    // window.__forgeBucklingAnalysis (no DOM scraping required).
    const mirror = await page.evaluate(() => window.__forgeBucklingAnalysis || null);
    console.log('[push-120] window.__forgeBucklingAnalysis =', mirror && {
        handle: mirror.bodyHandle,
        meshMm: mirror.meshSize_mm,
        F_applied: mirror.F_applied,
        lambda1: mirror.lambda1,
        P_cr: mirror.P_cr,
        modes: mirror.modes.length,
        loadInfo: mirror.loadInfo,
    });
    expect(mirror).not.toBeNull();
    expect(mirror.bodyHandle).toBeGreaterThan(0);
    expect(mirror.lambda1).toBeGreaterThan(0);
    expect(mirror.F_applied).toBeCloseTo(1000, 0);
    expect(mirror.P_cr).toBeCloseTo(mirror.lambda1 * mirror.F_applied, -2);
    expect(mirror.modes.length).toBeGreaterThanOrEqual(1);
    expect(mirror.loadInfo.loadedFaceId).toBe(1);
    expect(mirror.loadInfo.clampFaceId).toBe(0);
    expect(mirror.loadInfo.directionId).toBe('-X');
    expect(mirror.loadInfo.loadedNodes).toBeGreaterThan(0);
    expect(mirror.loadInfo.clampNodes).toBeGreaterThan(0);

    // Mesh info ribbon renders > 0 nodes + > 0 elements.
    const meshTxt = await page.locator('[data-testid="forge-buckling-mesh-info"]').innerText();
    console.log('[push-120] mesh info =', meshTxt);
    const nums = (meshTxt.match(/(\d[\d,]*)/g) || []).map((s) => Number(s.replace(/,/g, '')));
    const big = nums.filter((n) => n > 0);
    expect(big.length).toBeGreaterThan(0);
});

test('04 — kernel cross-check: direct forge.fea.solveBuckling agrees with panel λ₁', async () => {
    await cameraTo('right');

    // Drive the kernel directly with the same geometry + material + BCs +
    // loads the panel just used. The two λ₁ values must agree (we built
    // the loads + BCs from the same nodeToFace expansion).
    const r = await page.evaluate(() => {
        const f = window.forge;
        // Fresh 100×10×10 mm column — kernel uses metres.
        const h = f.makeBox(0.1, 0.01, 0.01);
        const mesh = f.fea.meshFromBrep(h, 0.005); // 5 mm
        const nNodes = mesh.nodeCount;
        const bcs = [], loads = [];
        // -X clamp face = bit 0; +X loaded face = bit 1.
        const loadedNodes = [];
        for (let i = 0; i < nNodes; i++) {
            if (mesh.nodeToFace[i] & 1) {
                bcs.push({ nodeId: i, fx: true, fy: true, fz: true });
            }
            if (mesh.nodeToFace[i] & 2) loadedNodes.push(i);
        }
        const F_total = 1000;
        const perNode = -F_total / loadedNodes.length; // -X compressive
        for (const id of loadedNodes) {
            loads.push({ nodeId: id, fx: perNode, fy: 0, fz: 0 });
        }
        const mat = { E: 200e9, nu: 0.26, rho: 7850 };
        const raw = f.fea.solveBuckling(mesh, mat, loads, bcs, 3);
        // λ_kernel = firstCriticalLoad / sum |F_i| = firstCriticalLoad / F_total
        // (because sign of each fx is uniform).
        let sumAbs = 0;
        for (const l of loads) sumAbs += Math.abs(l.fx) + Math.abs(l.fy) + Math.abs(l.fz);
        const lambda1 = raw.firstCriticalLoad / sumAbs;
        return {
            nNodes,
            nElems: mesh.elemCount,
            loadFactors: Array.from(raw.loadFactors),
            firstCriticalLoad: raw.firstCriticalLoad,
            lambda1,
            sumAbs,
        };
    });
    console.log('[push-120] direct kernel cross-check =', JSON.stringify(r));
    expect(r.nNodes).toBeGreaterThan(0);
    expect(r.lambda1).toBeGreaterThan(0);
    expect(r.firstCriticalLoad).toBeGreaterThan(0);

    // Compare against the panel's λ₁. The same mesh + same BC/load
    // expansion produces the same numerical eigenproblem ⇒ same λ.
    const mirror = await page.evaluate(() => window.__forgeBucklingAnalysis);
    const panelLambda1 = mirror.lambda1;
    const kernelLambda1 = r.lambda1;
    const relErr = Math.abs(panelLambda1 - kernelLambda1) / kernelLambda1;
    console.log('[push-120] panel λ₁ =', panelLambda1,
                'kernel λ₁ =', kernelLambda1,
                'relErr =', relErr);
    expect(relErr).toBeLessThan(0.25);

    await shot('kernel-cross-check');
});

test('05 — PUSH-48 regression: Simulation workbench still meshes + solves Static', async () => {
    await cameraTo('iso');

    // Close the buckling panel.
    const bClose = page.locator('[data-testid="forge-buckling-close"]');
    if (await bClose.count() > 0) await bClose.first().click({ timeout: 2000 }).catch(() => {});
    await pause(300);

    await platformMenuAction('tools.simulation');
    await page.waitForSelector('[data-testid="forge-sim-workbench"]', {
        state: 'visible', timeout: 6000,
    });
    await shot('sim-panel');

    // Coarsen the mesh — same trick as the PUSH-48 spec.
    await page.locator('[data-testid="forge-sim-elem-size-slider"]').fill('5');
    await pause(200);
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 2000 }).catch(() => {});
    await pause(200);
    await page.locator('[data-testid="forge-sim-mesh-now"]')
        .click({ force: true, noWaitAfter: true });
    await pause(2500);
    const info = page.locator('[data-testid="forge-sim-mesh-info"]');
    await expect(info).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="forge-sim-solve"]')
        .click({ force: true, noWaitAfter: true });
    await pause(3000);
    await shot('sim-solved');

    // Cross-check the kernel directly — identical to PUSH-48 + PUSH-114
    // regression: a cantilever under load must deflect (max |u| > 0) and
    // develop stress (max von Mises > 0). PUSH-120 must not break this.
    const rr = await page.evaluate(() => {
        const f = window.forge;
        const h = f.makeBox(60, 20, 20);
        const mesh = f.fea.meshFromBrep(h, 8);
        const nodes = mesh.nodes || mesh.coords || [];
        const nNodes = mesh.nodeCount ?? (Array.isArray(nodes) ? nodes.length / 3 : 0);
        const bcs = []; const loads = [];
        for (let i = 0; i < nNodes; i++) {
            const x = nodes[i * 3 + 0];
            if (x <= 0.001) bcs.push({ node: i, dof: [true, true, true] });
            if (x >= 59.999) loads.push({ node: i, fx: 0, fy: -50, fz: 0 });
        }
        const mat = { E: 210e9, nu: 0.3, rho: 7850, yield: 250e6 };
        const res = f.fea.solveStatic(mesh, mat, loads, [], bcs);
        let maxU = 0, maxVm = 0;
        const disp = res.displacements || res.u || [];
        for (let i = 0; i < disp.length; i++) maxU = Math.max(maxU, Math.abs(disp[i]));
        const vm = res.vonMises || res.stress || [];
        for (let i = 0; i < vm.length; i++) maxVm = Math.max(maxVm, vm[i]);
        return { nNodes, maxU, maxVm };
    });
    console.log('[push-120] PUSH-48 regression cross-check =', JSON.stringify(rr));
    expect(rr.nNodes).toBeGreaterThan(0);
    expect(rr.maxU).toBeGreaterThan(0);
    expect(rr.maxVm).toBeGreaterThan(0);
});
