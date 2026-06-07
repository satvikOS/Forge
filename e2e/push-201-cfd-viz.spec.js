// PUSH-201 (Slice-151) — CFD result visualisation panel e2e.
//
// Drives the Cfd3dVizPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenCfd3dViz + window.__forgeCfdVizHelper
//        + window.__forgeScene + window.__forgeThree all install. Sanity-
//        check the math primitives headlessly (jet ramp, RK4 path,
//        trilinear sampling, decimation, builder construction).
//   01 — Open the CFD viz panel via tools.cfd3dViz. Assert canonical
//        test-ids mount (solve / vectors / pressure / streamlines / clear).
//   02 — Click "Solve cavity Re=100". Wait for the panel to publish
//        window.__forgeCfdVizLast with |U|_max > 0 + finite divergence.
//   03 — Click "Show vectors". Assert a new group with userData.cfdViz =
//        'vectors' is parented under window.__forgeScene and contains
//        InstancedMesh children (shaft + head).
//   04 — Click "Show streamlines". Assert another group with userData.
//        cfdViz = 'streamlines' is mounted and has > 0 line children.
//   05 — Click "Show pressure". Assert pressure group is mounted with a
//        Mesh child whose geometry carries a real vertex-colour
//        attribute (BufferGeometry.attributes.color.itemSize === 3).
//   06 — Click "Clear all". Assert all three groups are unmounted.
//   07 — Final shot + close.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + headless sanity)
//   - front (panel open + solve)
//   - top   (vectors)
//   - right (streamlines)
//   - iso   (pressure + clear + final)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — solver + scene wiring
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-201-cfd-viz');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'cfd-viz-session.mp4');

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

// Wait for the panel to publish solve stats on window.
async function waitForVizResult(timeoutMs = 180000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const has = await page.evaluate(() => !!window.__forgeCfdVizLast);
        if (has) return await page.evaluate(() => ({ ...window.__forgeCfdVizLast }));
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
        if (/push-201|cfdviz|cfd-viz|cfd3d|cavity|streamline|vector|pressure|error|Error/i.test(t)) {
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

    // Dismiss onboarding (Forge-189).
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
    // Need the viewport canvas mounted before the scene can be addressed.
    await page.waitForSelector('[data-testid="forge-v4-canvas"]',
        { state: 'visible', timeout: 30000 }).catch(() => {});
    // Give r3f a couple of frames to publish window.__forgeScene/__forgeThree.
    await page.waitForFunction(() => !!window.__forgeScene && !!window.__forgeThree, {
        timeout: 30000,
    });
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
        console.error('[push-201] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin = null;
    try { ffmpegBin = require('ffmpeg-static'); }
    catch { console.error('[push-201] ffmpeg-static missing'); return; }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-201] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-201] ffmpeg failed:', code,
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
        open:   typeof window.__forgeOpenCfd3dViz,
        close:  typeof window.__forgeCloseCfd3dViz,
        helper: typeof window.__forgeCfdVizHelper,
        helperKeys: window.__forgeCfdVizHelper
            ? Object.keys(window.__forgeCfdVizHelper).sort()
            : [],
        sceneType: typeof window.__forgeScene,
        threeType: typeof window.__forgeThree,
        cfd3dHelper: typeof window.__forgeCfd3dHelper,
    }));
    console.log('[push-201] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('jetColor');
    expect(surface.helperKeys).toContain('viridisColor');
    expect(surface.helperKeys).toContain('sampleVelocity');
    expect(surface.helperKeys).toContain('sampleScalar');
    expect(surface.helperKeys).toContain('decimateVectorField');
    expect(surface.helperKeys).toContain('rk4Streamline');
    expect(surface.helperKeys).toContain('seedStreamlineGrid');
    expect(surface.helperKeys).toContain('buildVelocityVectorField');
    expect(surface.helperKeys).toContain('buildPressureMidplane');
    expect(surface.helperKeys).toContain('buildStreamlines');
    expect(surface.helperKeys).toContain('removeCfdGroups');
    expect(surface.helperKeys).toContain('fieldStats');
    expect(surface.sceneType).toBe('object');
    expect(surface.threeType).toBe('object');
    expect(surface.cfd3dHelper).toBe('object');

    // ─── Headless math smoke ──────────────────────────────────────
    // Jet ramp endpoints + sampling identity + RK4 path length.
    const math = await page.evaluate(() => {
        const h = window.__forgeCfdVizHelper;
        // Jet ramp.
        const rgb0 = h.jetColor(0.0);
        const rgb1 = h.jetColor(1.0);
        const rgbMid = h.jetColor(0.5);
        // Sampling on a uniform constant field — should equal the constant.
        const ns = window.__forgeCfd3dHelper;
        const g = ns.makeGrid(8, 8, 8, 1, 1, 1);
        ns.initFields(g);
        // Set u = 1.5 everywhere, v = 0, w = 0.
        for (let n = 0; n < g.N; n++) { g.u[n] = 1.5; g.p[n] = 0.25 * n / g.N; }
        const sampMid = h.sampleVelocity(g, 0.5, 0.5, 0.5);
        const sampLow = h.sampleVelocity(g, 0.01, 0.01, 0.01);
        // Decimation count.
        const samples2 = h.decimateVectorField(g, 2);
        const samples1 = h.decimateVectorField(g, 1);
        // RK4 path from a seed in the middle of the constant-flow domain.
        const path = h.rk4Streamline(g, [0.1, 0.5, 0.5], { maxSteps: 50 });
        // Pressure stats.
        const pStats = h.fieldStats(g.p);
        // Seed grid count.
        const seeds = h.seedStreamlineGrid(g, { face: 'lid', seedsW: 5, seedsH: 5 });
        return {
            rgb0, rgb1, rgbMid,
            sampMid, sampLow,
            decimEvery2Count: samples2.length,
            decimEvery1Count: samples1.length,
            pathLen: path.length,
            pathLast: path[path.length - 1],
            pStats,
            seedsCount: seeds.length,
            seedsFirst: seeds[0],
            seedsLastY: seeds[seeds.length - 1][1],
        };
    });
    console.log('[push-201] headless math =', JSON.stringify(math));
    // Jet ramp endpoints.
    expect(Array.isArray(math.rgb0)).toBe(true);
    expect(math.rgb0.length).toBe(3);
    expect(math.rgb0[2]).toBeGreaterThan(0); // dark-blue end
    expect(math.rgb1[0]).toBeGreaterThan(0); // dark-red end
    expect(math.rgb1[2]).toBe(0);
    // Sampling a constant field returns the constant.
    expect(math.sampMid[0]).toBeCloseTo(1.5, 5);
    expect(math.sampMid[1]).toBeCloseTo(0.0, 5);
    expect(math.sampLow[0]).toBeCloseTo(1.5, 5);
    // Decimation cell count.
    expect(math.decimEvery1Count).toBe(8 * 8 * 8);
    // every=2 with 8 cells → ceil(8/2) = 4 → 64 samples.
    expect(math.decimEvery2Count).toBe(4 * 4 * 4);
    // RK4 path must include the seed + at least one integrated step.
    expect(math.pathLen).toBeGreaterThanOrEqual(2);
    // With constant u = 1.5 +x direction, the path should march in +x.
    expect(math.pathLast[0]).toBeGreaterThan(0.1);
    // Pressure stats finite.
    expect(Number.isFinite(math.pStats.min)).toBe(true);
    expect(Number.isFinite(math.pStats.max)).toBe(true);
    expect(math.pStats.max).toBeGreaterThanOrEqual(math.pStats.min);
    // Seeds on lid → y near top.
    expect(math.seedsCount).toBe(5 * 5);
    expect(math.seedsFirst[1]).toBeGreaterThan(0.9); // near Ly = 1
    expect(math.seedsLastY).toBeGreaterThan(0.9);

    await shot('host-surface-ok');
});

test('01 — open CFD viz panel via tools.cfd3dViz', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.cfd3dViz');
    await page.waitForSelector('[data-testid="forge-cfd3dviz-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('viz-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-cfd3dviz-solve-cavity"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3dviz-vectors"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3dviz-pressure"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3dviz-streamlines"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3dviz-clear"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-cfd3dviz-close"]')).toBeVisible();

    // Defaults present in the panel data attributes.
    const panel = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-cfd3dviz-panel"]');
        return {
            hasGrid: el.getAttribute('data-has-grid'),
            mv: el.getAttribute('data-mounted-vectors'),
            mp: el.getAttribute('data-mounted-pressure'),
            ms: el.getAttribute('data-mounted-streamlines'),
        };
    });
    console.log('[push-201] panel state =', JSON.stringify(panel));
    expect(panel.hasGrid).toBe('0');
    expect(panel.mv).toBe('0');
    expect(panel.mp).toBe('0');
    expect(panel.ms).toBe('0');
});

test('02 — solve cavity Re=100 16³ 120 steps via the viz panel', async () => {
    // Reset prior result.
    await page.evaluate(() => { try { delete window.__forgeCfdVizLast; } catch {} });
    await page.locator('[data-testid="forge-cfd3dviz-solve-cavity"]').click();
    await shot('solve-clicked');

    const snap = await waitForVizResult(360000);
    expect(snap).not.toBeNull();
    console.log('[push-201] solve snap =', JSON.stringify({
        nx: snap.nx, Re: snap.Re, steps: snap.steps,
        totalTime: snap.totalTime, umax: snap.umax,
        pmin: snap.pmin, pmax: snap.pmax,
        lastDivergence: snap.lastDivergence,
        lastResidual: snap.lastResidual,
    }));
    expect(snap.nx).toBe(16);
    expect(snap.Re).toBe(100);
    expect(snap.steps).toBe(120);
    expect(Number.isFinite(snap.totalTime)).toBe(true);
    expect(snap.totalTime).toBeGreaterThan(0);
    expect(Number.isFinite(snap.umax)).toBe(true);
    expect(snap.umax).toBeGreaterThan(0);
    expect(snap.umax).toBeLessThan(2.0);  // lid travels at U=1
    expect(Number.isFinite(snap.lastDivergence)).toBe(true);
    expect(snap.lastDivergence).toBeLessThan(5.0);
    expect(snap.pmax).toBeGreaterThanOrEqual(snap.pmin);

    // Panel published a stats chip strip with the values too.
    await expect(page.locator('[data-testid="forge-cfd3dviz-solve-stats"]')).toBeVisible();
    const panelHasGrid = await page.evaluate(() => document
        .querySelector('[data-testid="forge-cfd3dviz-panel"]')
        ?.getAttribute('data-has-grid'));
    expect(panelHasGrid).toBe('1');

    await shot('solve-complete');
});

test('03 — show vectors → assert scene has group with userData.cfdViz=vectors', async () => {
    await cameraTo('top');
    // Count cfd-viz children on the scene BEFORE the click.
    const beforeCount = await page.evaluate(() => {
        const s = window.__forgeScene;
        let n = 0;
        s.traverse((o) => { if (o.userData?.cfdViz === 'vectors') n += 1; });
        return n;
    });
    expect(beforeCount).toBe(0);

    await page.locator('[data-testid="forge-cfd3dviz-vectors"]').click();
    await pause(500);
    await shot('vectors-mounted');

    const sceneInfo = await page.evaluate(() => {
        const s = window.__forgeScene;
        const all = [];
        s.traverse((o) => { if (o.userData?.cfdViz) all.push({
            type: o.type,
            tag: o.userData.cfdViz,
            name: o.name,
            childCount: o.children ? o.children.length : 0,
        }); });
        // Find the top-level vectors group (direct child of scene).
        const topVec = s.children.find((c) => c.userData?.cfdViz === 'vectors');
        const instancedMeshChildren = topVec
            ? topVec.children.filter((c) => c.type === 'Mesh' || c.type === 'InstancedMesh').length
            : 0;
        const sampleCount = topVec?.userData?.sampleCount ?? 0;
        return { allCount: all.length, all, instancedMeshChildren, sampleCount };
    });
    console.log('[push-201] scene after vectors =', JSON.stringify(sceneInfo));
    // At least one vectors-tagged node.
    expect(sceneInfo.allCount).toBeGreaterThanOrEqual(1);
    // The vectors group must have InstancedMesh children (shaft + head).
    expect(sceneInfo.instancedMeshChildren).toBeGreaterThanOrEqual(2);
    // Sample count must be > 0 (some cells should have nonzero velocity
    // after a 120-step cavity solve).
    expect(sceneInfo.sampleCount).toBeGreaterThan(0);

    // window.__forgeCfdVizGroups reflects the mount.
    const groups = await page.evaluate(() => ({
        hasVectors: !!window.__forgeCfdVizGroups?.vectors,
        hasPressure: !!window.__forgeCfdVizGroups?.pressure,
        hasStreamlines: !!window.__forgeCfdVizGroups?.streamlines,
    }));
    expect(groups.hasVectors).toBe(true);
});

test('04 — show streamlines → assert group + RK4 lines', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-cfd3dviz-streamlines"]').click();
    await pause(500);
    await shot('streamlines-mounted');

    const sceneInfo = await page.evaluate(() => {
        const s = window.__forgeScene;
        const topStream = s.children.find((c) => c.userData?.cfdViz === 'streamlines');
        if (!topStream) return null;
        const lineChildren = topStream.children.filter(
            (c) => c.type === 'Line' || c.type === 'LineSegments');
        let totalSamplePoints = 0;
        let longestLine = 0;
        for (const ln of lineChildren) {
            const sc = ln.userData?.sampleCount ?? 0;
            totalSamplePoints += sc;
            if (sc > longestLine) longestLine = sc;
        }
        return {
            seedCount: topStream.userData?.seedCount ?? 0,
            lineChildren: lineChildren.length,
            totalSamplePoints,
            longestLine,
            umax: topStream.userData?.umax ?? 0,
        };
    });
    console.log('[push-201] scene after streamlines =', JSON.stringify(sceneInfo));
    expect(sceneInfo).not.toBeNull();
    // Default seeds: 8 × 8 = 64 (set by the panel default seedsW state).
    expect(sceneInfo.seedCount).toBe(8 * 8);
    // Each seed produces a Line — but trivial seeds (path length < 2)
    // get filtered. After a 120-step Re=100 solve the lid-driven flow
    // moves enough to generate non-trivial paths from at least half
    // the seeds.
    expect(sceneInfo.lineChildren).toBeGreaterThanOrEqual(8);
    expect(sceneInfo.totalSamplePoints).toBeGreaterThan(sceneInfo.lineChildren);
    expect(sceneInfo.longestLine).toBeGreaterThanOrEqual(3);

    // window.__forgeCfdVizGroups updated.
    const groups = await page.evaluate(() => ({
        hasVectors: !!window.__forgeCfdVizGroups?.vectors,
        hasStreamlines: !!window.__forgeCfdVizGroups?.streamlines,
    }));
    expect(groups.hasStreamlines).toBe(true);
    expect(groups.hasVectors).toBe(true);  // still up from step 03
});

test('05 — show pressure → assert vertex-coloured midplane mesh', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-cfd3dviz-pressure"]').click();
    await pause(500);
    await shot('pressure-mounted');

    const sceneInfo = await page.evaluate(() => {
        const s = window.__forgeScene;
        const topP = s.children.find((c) => c.userData?.cfdViz === 'pressure');
        if (!topP) return null;
        const meshChild = topP.children.find(
            (c) => c.type === 'Mesh' && c.geometry);
        if (!meshChild) return { found: true, mesh: null };
        const geom = meshChild.geometry;
        const posAttr = geom.attributes?.position;
        const colAttr = geom.attributes?.color;
        return {
            found: true,
            mesh: {
                hasPosition: !!posAttr,
                positionCount: posAttr ? posAttr.count : 0,
                hasColor: !!colAttr,
                colorItemSize: colAttr ? colAttr.itemSize : 0,
                colorCount: colAttr ? colAttr.count : 0,
                vertexColorsMaterial: !!meshChild.material?.vertexColors,
            },
            axis: topP.userData?.axis,
            planeIndex: topP.userData?.planeIndex,
            widthCells: topP.userData?.widthCells,
            heightCells: topP.userData?.heightCells,
            pMin: topP.userData?.pMin,
            pMax: topP.userData?.pMax,
        };
    });
    console.log('[push-201] scene after pressure =', JSON.stringify(sceneInfo));
    expect(sceneInfo).not.toBeNull();
    expect(sceneInfo.found).toBe(true);
    expect(sceneInfo.mesh).not.toBeNull();
    // Vertex colours: real, per-vertex, 3-component.
    expect(sceneInfo.mesh.hasColor).toBe(true);
    expect(sceneInfo.mesh.colorItemSize).toBe(3);
    // Position + color counts must match (one colour per vertex).
    expect(sceneInfo.mesh.colorCount).toBe(sceneInfo.mesh.positionCount);
    // Material has vertexColors enabled (no flat tint).
    expect(sceneInfo.mesh.vertexColorsMaterial).toBe(true);
    // Default axis is z (mid-plane (x,y)).
    expect(sceneInfo.axis).toBe('z');
    // 16³ grid → 16 × 16 cells on the z mid-plane → 4 verts per cell.
    expect(sceneInfo.widthCells).toBe(16);
    expect(sceneInfo.heightCells).toBe(16);
    expect(sceneInfo.mesh.positionCount).toBe(16 * 16 * 4);

    // window.__forgeCfdVizGroups updated.
    const groups = await page.evaluate(() => ({
        hasVectors: !!window.__forgeCfdVizGroups?.vectors,
        hasPressure: !!window.__forgeCfdVizGroups?.pressure,
        hasStreamlines: !!window.__forgeCfdVizGroups?.streamlines,
    }));
    expect(groups.hasPressure).toBe(true);
    expect(groups.hasVectors).toBe(true);
    expect(groups.hasStreamlines).toBe(true);
});

test('06 — clear all → assert every group is unmounted', async () => {
    // Snapshot before for diagnostic.
    const before = await page.evaluate(() => {
        const s = window.__forgeScene;
        let v = 0, p = 0, sl = 0;
        for (const c of s.children) {
            if (c.userData?.cfdViz === 'vectors') v += 1;
            if (c.userData?.cfdViz === 'pressure') p += 1;
            if (c.userData?.cfdViz === 'streamlines') sl += 1;
        }
        return { v, p, sl };
    });
    console.log('[push-201] scene before clear =', JSON.stringify(before));
    expect(before.v + before.p + before.sl).toBeGreaterThanOrEqual(3);

    await page.locator('[data-testid="forge-cfd3dviz-clear"]').click();
    await pause(400);
    await shot('cleared');

    const after = await page.evaluate(() => {
        const s = window.__forgeScene;
        let n = 0;
        s.traverse((o) => { if (o.userData?.cfdViz) n += 1; });
        return { totalCfdNodes: n,
                 groups: {
                    hasVectors: !!window.__forgeCfdVizGroups?.vectors,
                    hasPressure: !!window.__forgeCfdVizGroups?.pressure,
                    hasStreamlines: !!window.__forgeCfdVizGroups?.streamlines,
                 } };
    });
    console.log('[push-201] scene after clear =', JSON.stringify(after));
    expect(after.totalCfdNodes).toBe(0);
    expect(after.groups.hasVectors).toBe(false);
    expect(after.groups.hasPressure).toBe(false);
    expect(after.groups.hasStreamlines).toBe(false);
});

test('07 — close panel + final shot', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-cfd3dviz-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-cfd3dviz-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
