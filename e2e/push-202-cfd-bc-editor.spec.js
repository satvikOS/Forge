// PUSH-202 (Slice-159) — CFD Boundary Condition Editor.
//
// Drives the Cfd3dBcEditorPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenCfd3dBcEditor installs as a
//        function BEFORE the panel mounts, and the
//        window.__forgeCfd3dBcEditor public surface (FACES, TYPES,
//        applyToFace, countBCs) is wired up. Sanity-check the BC enum
//        the editor exposes mirrors the PUSH-200 solver enum.
//   01 — Open the BC editor panel via the tools.cfd3dBcEditor menu
//        action. Assert every canonical face button + BC-type radio
//        renders.
//   02 — Build a fresh 12³ grid via the helper. Walk every face button
//        and apply "Wall". Assert bcType count of WALL equals the
//        perimeter-cell count (12³ - 10³ = 728) and that no other tag
//        survived.
//   03 — Switch BC type to "Lid", set Ux = 1.0 (Uy = Uz = 0), select +Z,
//        click Apply. Assert bcType[+Z face] === BC.LID enum, bcValue
//        Ux === 1, and applyBCs has already pushed u = 1 onto the +Z
//        face cells (so the field reflects the new BC immediately).
//   04 — Click "Re-solve 50 steps". Assert max divergence stays bounded
//        after the BC change (no NaN / Inf, |∇·u|_∞ < 5).
//   05 — Close panel + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + surface check)
//   - front (open panel)
//   - top   (build grid + paint walls on all six faces)
//   - right (paint lid on +Z + apply)
//   - iso   (re-solve + headless smoke + final close shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(900000); // 15 min — 12³×50 SIMPLE steps inside Electron
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-202-cfd-bc-editor');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'cfd-bc-editor-session.mp4');

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
        if (/push-202|cfd3d|cfd|navier|bc|boundary|wall|inlet|outlet|lid|residual|divergence|error|Error/i.test(t)) {
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
        console.error('[push-202] no .webm');
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
                console.log(`[push-202] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-202] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert window surface (__forgeOpenCfd3dBcEditor function)', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        openFn:    typeof window.__forgeOpenCfd3dBcEditor,
        closeFn:   typeof window.__forgeCloseCfd3dBcEditor,
        editorObj: typeof window.__forgeCfd3dBcEditor,
        helper:    typeof window.__forgeCfd3dHelper,
        helperBcInterior: window.__forgeCfd3dHelper?.BC?.INTERIOR,
        helperBcWall:     window.__forgeCfd3dHelper?.BC?.WALL,
        helperBcInlet:    window.__forgeCfd3dHelper?.BC?.INLET,
        helperBcOutlet:   window.__forgeCfd3dHelper?.BC?.OUTLET,
        helperBcLid:      window.__forgeCfd3dHelper?.BC?.LID,
        editorBcInterior: window.__forgeCfd3dBcEditor?.BC?.INTERIOR,
        editorBcWall:     window.__forgeCfd3dBcEditor?.BC?.WALL,
        editorBcInlet:    window.__forgeCfd3dBcEditor?.BC?.INLET,
        editorBcOutlet:   window.__forgeCfd3dBcEditor?.BC?.OUTLET,
        editorBcLid:      window.__forgeCfd3dBcEditor?.BC?.LID,
        applyFn:    typeof window.__forgeCfd3dBcEditor?.applyToFace,
        countFn:    typeof window.__forgeCfd3dBcEditor?.countBCs,
        faceIds:    (window.__forgeCfd3dBcEditor?.FACES || []).map((f) => f.id),
        typeIds:    (window.__forgeCfd3dBcEditor?.TYPES || []).map((t) => t.id),
    }));
    console.log('[push-202] surface =', JSON.stringify(surface));

    // Brief mandate: __forgeOpenCfd3dBcEditor is a function.
    expect(surface.openFn).toBe('function');
    expect(surface.closeFn).toBe('function');
    expect(surface.editorObj).toBe('object');

    // Helper still wired (the editor depends on Cfd3dPanelHost OR its own
    // makeNavierStokes3DHelper init, either way it's installed).
    expect(surface.helper).toBe('object');

    // BC enum mirrors the PUSH-200 solver enum.
    expect(surface.helperBcInterior).toBe(0);
    expect(surface.helperBcWall).toBe(1);
    expect(surface.helperBcInlet).toBe(2);
    expect(surface.helperBcOutlet).toBe(3);
    expect(surface.helperBcLid).toBe(4);

    expect(surface.editorBcInterior).toBe(0);
    expect(surface.editorBcWall).toBe(1);
    expect(surface.editorBcInlet).toBe(2);
    expect(surface.editorBcOutlet).toBe(3);
    expect(surface.editorBcLid).toBe(4);

    // Editor public surface — applyToFace + countBCs are functions, all
    // six face ids are present, all four BC type ids are present.
    expect(surface.applyFn).toBe('function');
    expect(surface.countFn).toBe('function');
    expect(surface.faceIds.sort()).toEqual(['+X', '+Y', '+Z', '-X', '-Y', '-Z']);
    expect(surface.typeIds.sort()).toEqual(['inlet', 'lid', 'outlet', 'wall']);

    await shot('surface-ok');
});

test('01 — open BC editor panel via tools.cfd3dBcEditor menu action', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.cfd3dBcEditor');
    await page.waitForSelector('[data-testid="forge-cfd3d-bc-editor-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All six face buttons + four BC-type radios are visible.
    for (const id of ['-X', '+X', '-Y', '+Y', '-Z', '+Z']) {
        await expect(page.locator(`[data-testid="forge-cfd3d-bc-face-${id}"]`)).toBeVisible();
    }
    for (const id of ['wall', 'inlet', 'outlet', 'lid']) {
        await expect(page.locator(`[data-testid="forge-cfd3d-bc-type-${id}"]`)).toBeVisible();
    }

    await expect(page.locator('[data-testid="forge-cfd3d-bc-build-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3d-bc-apply"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3d-bc-resolve"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3d-bc-editor-close"]')).toBeVisible();

    // Default grid is 12³ — the editor builds it on open.
    const dims = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-cfd3d-bc-editor-panel"]');
        return {
            nx: el?.dataset.gridNx, ny: el?.dataset.gridNy, nz: el?.dataset.gridNz,
        };
    });
    console.log('[push-202] default grid dims =', JSON.stringify(dims));
    expect(Number(dims.nx)).toBe(12);
    expect(Number(dims.ny)).toBe(12);
    expect(Number(dims.nz)).toBe(12);
});

test('02 — build 12³ grid + paint Wall on all six faces, verify perimeter count', async () => {
    await cameraTo('top');

    // Build a fresh grid through __forgeCfd3dHelper.makeGrid then have
    // the editor pick it up via Build grid. We want the panel + the
    // helper-built grid to round-trip, so we use the panel's own
    // build button (which calls helper.makeGrid internally).
    // First check the build button refreshes a clean grid.
    await page.locator('[data-testid="forge-cfd3d-bc-build-grid"]').click();
    await pause(300);

    // Confirm the editor exposes the fresh grid + applyToFace works.
    const gridSurface = await page.evaluate(() => {
        const ed = window.__forgeCfd3dBcEditor;
        return {
            hasGrid: !!ed?.grid,
            gridDims: ed?.grid ? { nx: ed.grid.nx, ny: ed.grid.ny, nz: ed.grid.nz } : null,
            N: ed?.grid?.N,
            bcTypeLen: ed?.grid?.bcType?.length,
            bcValueLen: ed?.grid?.bcValue?.length,
            interiorCount: ed?.grid
                ? Array.from(ed.grid.bcType).filter((v) => v === ed.BC.INTERIOR).length
                : 0,
        };
    });
    console.log('[push-202] fresh grid =', JSON.stringify(gridSurface));
    expect(gridSurface.hasGrid).toBe(true);
    expect(gridSurface.gridDims).toEqual({ nx: 12, ny: 12, nz: 12 });
    expect(gridSurface.N).toBe(12 * 12 * 12);
    expect(gridSurface.bcTypeLen).toBe(12 * 12 * 12);
    expect(gridSurface.bcValueLen).toBe(12 * 12 * 12 * 3);
    // initFields zeroes bcType → INTERIOR for every cell.
    expect(gridSurface.interiorCount).toBe(12 * 12 * 12);

    // Switch to Wall BC type (default; assert it).
    await page.locator('[data-testid="forge-cfd3d-bc-type-wall"] input').check();
    await shot('wall-selected');

    // Walk every face button + click Apply for each.
    for (const id of ['-X', '+X', '-Y', '+Y', '-Z', '+Z']) {
        await page.locator(`[data-testid="forge-cfd3d-bc-face-${id}"]`).click();
        await pause(80);
        await page.locator('[data-testid="forge-cfd3d-bc-apply"]').click();
        await pause(80);
    }
    await shot('all-faces-walled');

    // Inspect the live grid: bcType WALL count must equal the perimeter
    // cells of a 12³ grid = total - interior^3 = 12³ − 10³ = 1728 − 1000 = 728.
    const counts = await page.evaluate(() => {
        const ed = window.__forgeCfd3dBcEditor;
        const g = ed.grid;
        return ed.countBCs(g);
    });
    console.log('[push-202] post-wall counts =', JSON.stringify(counts));
    const perimeter = 12 * 12 * 12 - 10 * 10 * 10;
    expect(perimeter).toBe(728);
    expect(counts.WALL).toBe(perimeter);
    expect(counts.INLET).toBe(0);
    expect(counts.OUTLET).toBe(0);
    expect(counts.LID).toBe(0);
    expect(counts.INTERIOR).toBe(10 * 10 * 10);
    expect(counts.TOTAL).toBe(12 * 12 * 12);

    // Read-out chip shows the latest face touched (= +Z, the last in the
    // loop above) and the BC id (= wall).
    const lastFaceText = await page.locator('[data-testid="forge-cfd3d-bc-chip-last-face"]').textContent();
    const lastBcText   = await page.locator('[data-testid="forge-cfd3d-bc-chip-last-bc"]').textContent();
    expect(lastFaceText).toContain('+Z');
    expect(lastBcText).toContain('wall');

    await shot('counts-walled');
});

test('03 — paint Lid on +Z face with Ux = 1.0; assert bcType + bcValue', async () => {
    await cameraTo('right');

    // Select +Z face.
    await page.locator('[data-testid="forge-cfd3d-bc-face-+Z"]').click();
    // Switch BC type to Lid.
    await page.locator('[data-testid="forge-cfd3d-bc-type-lid"] input').check();
    await pause(120);

    // Velocity inputs only appear once Lid (or Inlet) is selected.
    await expect(page.locator('[data-testid="forge-cfd3d-bc-velocity"]')).toBeVisible();
    await page.locator('[data-testid="forge-cfd3d-bc-ux"]').fill('1');
    await page.locator('[data-testid="forge-cfd3d-bc-uy"]').fill('0');
    await page.locator('[data-testid="forge-cfd3d-bc-uz"]').fill('0');
    await pause(120);
    await shot('lid-config');

    // Apply.
    await page.locator('[data-testid="forge-cfd3d-bc-apply"]').click();
    await pause(200);

    // Verify the +Z face cells are tagged LID, their bcValue Ux = 1, and
    // the field already reflects the new BC (applyBCs was called).
    const inspection = await page.evaluate(() => {
        const ed = window.__forgeCfd3dBcEditor;
        const g  = ed.grid;
        const LID = ed.BC.LID;
        const { nx, ny, nz } = g;
        const kTop = nz - 1;
        let lidCount = 0;
        let nonLidCount = 0;
        let uxAtOneCount = 0;
        let uAtOneCount = 0;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const idx = i + nx * j + nx * ny * kTop;
                if (g.bcType[idx] === LID) lidCount += 1;
                else nonLidCount += 1;
                if (Math.abs(g.bcValue[3 * idx + 0] - 1.0) < 1e-12) uxAtOneCount += 1;
                if (Math.abs(g.u[idx] - 1.0) < 1e-12) uAtOneCount += 1;
            }
        }
        // Sanity: BC counts should now have LID > 0.
        const counts = ed.countBCs(g);
        return {
            lidCount, nonLidCount, uxAtOneCount, uAtOneCount,
            faceCells: nx * ny,
            counts,
        };
    });
    console.log('[push-202] +Z lid inspection =', JSON.stringify(inspection));

    // Every cell on +Z face is tagged LID.
    expect(inspection.lidCount).toBe(inspection.faceCells);
    expect(inspection.nonLidCount).toBe(0);
    // Every cell's bcValue Ux = 1.
    expect(inspection.uxAtOneCount).toBe(inspection.faceCells);
    // applyBCs pushed u = 1 onto the field for every +Z face cell.
    expect(inspection.uAtOneCount).toBe(inspection.faceCells);
    // LID count grew by the face cell count from the 0 we had at the
    // end of test 02. Faces -X / +X / -Y / +Y / -Z still hold their
    // Wall tag (from test 02). +Z was Wall (12*12 = 144 cells) and is
    // now LID, so LID = 144 and WALL = 728 - 144 = 584.
    expect(inspection.counts.LID).toBe(144);
    expect(inspection.counts.WALL).toBe(728 - 144);
    expect(inspection.counts.TOTAL).toBe(12 * 12 * 12);

    // Read-out: last face = +Z, last BC = lid.
    const lastFaceText = await page.locator('[data-testid="forge-cfd3d-bc-chip-last-face"]').textContent();
    const lastBcText   = await page.locator('[data-testid="forge-cfd3d-bc-chip-last-bc"]').textContent();
    expect(lastFaceText).toContain('+Z');
    expect(lastBcText).toContain('lid');

    await shot('lid-applied');
});

test('04 — re-solve 50 SIMPLE steps; divergence stays bounded after BC change', async () => {
    await cameraTo('iso');

    // Default steps = 50, ν = 1e-2; confirm them and click Re-solve.
    await page.locator('[data-testid="forge-cfd3d-bc-solve-steps"]').fill('50');
    await page.locator('[data-testid="forge-cfd3d-bc-nu"]').fill('0.01');
    await pause(120);

    await page.locator('[data-testid="forge-cfd3d-bc-resolve"]').click();
    await shot('resolve-clicked');

    // Wait for the solve result to publish.
    const result = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 240000) {
            const r = await page.evaluate(() => {
                const ed = window.__forgeCfd3dBcEditor;
                if (!ed?.lastSolveResult) return null;
                const r = ed.lastSolveResult;
                return {
                    steps: r.steps,
                    totalTime: r.totalTime,
                    residualLast: r.residualLast,
                    residualFirst: r.residualFirst,
                    divergenceLast: r.divergenceLast,
                    divergenceFirst: r.divergenceFirst,
                    maxDivergence: r.maxDivergence,
                    historyLen: r.divergenceHistory?.length,
                    nu: r.nu,
                };
            });
            if (r) return r;
            await pause(500);
        }
        return null;
    })();
    expect(result).not.toBeNull();
    console.log('[push-202] resolve result =', JSON.stringify(result));

    expect(result.steps).toBe(50);
    expect(result.historyLen).toBe(50);
    expect(Number.isFinite(result.totalTime)).toBe(true);
    expect(result.totalTime).toBeGreaterThan(0);
    expect(Number.isFinite(result.residualLast)).toBe(true);
    expect(Number.isFinite(result.divergenceLast)).toBe(true);
    expect(Number.isFinite(result.maxDivergence)).toBe(true);
    // BC change must not blow up the solver — divergence stays bounded.
    // We allow 5.0 to match the PUSH-200 e2e tolerance (lid-corner
    // discrete-Laplacian singularity dominates the L∞ on coarse grids).
    expect(result.maxDivergence).toBeLessThan(5.0);

    // Chip should be visible with the live max-divergence number.
    await expect(page.locator('[data-testid="forge-cfd3d-bc-chip-divmax"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3d-bc-chip-residual"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3d-bc-solve-result"]')).toBeVisible();

    // Lid is still in place on +Z: at least one cell has u = 1 after
    // 50 steps because applyBCs re-applies the LID Dirichlet every
    // sub-step inside step().
    const lidStillHolds = await page.evaluate(() => {
        const ed = window.__forgeCfd3dBcEditor;
        const g  = ed.grid;
        const { nx, ny, nz } = g;
        const kTop = nz - 1;
        let n = 0;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const idx = i + nx * j + nx * ny * kTop;
                if (Math.abs(g.u[idx] - 1.0) < 1e-9) n += 1;
            }
        }
        return n;
    });
    console.log('[push-202] +Z lid u=1 count after solve =', lidStillHolds);
    expect(lidStillHolds).toBe(12 * 12);

    await shot('resolved');
});

test('05 — close panel + final shot', async () => {
    await page.locator('[data-testid="forge-cfd3d-bc-editor-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-cfd3d-bc-editor-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
