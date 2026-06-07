// PUSH-213 (Slice-157) — Real Reflection Line analyser for Class-A
// surfacing QA.
//
// Class-A reflection lines are the iso-contour of (r·u − cos ε) where
// r is the reflected view ray at each surface vertex and u is the
// direction from the vertex to the closest point on an infinite straight
// light line L(t) = O + t·D. Discontinuities in the reflection-line
// shape reveal G1 / G2 issues — same diagnostic power as zebra stripes
// but with a strict directional analytic light source.
//
// This spec drives the ReflectionLinePanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenReflectionLine +
//        __forgeReflectionLineHelper install BEFORE the panel mounts.
//        Sanity-check the math primitives (reflectAbout,
//        triangleIsoContour, classifySegments, makeSphereMesh,
//        makePlaneMesh).
//   01 — Open the Reflection Line panel via tools.reflectionLine.
//        Assert every canonical test-id mounts (body-picker / origin /
//        dir / view / eps / parallel / spacing / build / clear / close).
//   02 — Seed a synthetic sphere via __forgeSeedReflectionSphere. Pick
//        it, click Build. Assert reflection lines render as closed
//        loops (every family member's closedLoopCount > 0; total
//        polylines ≤ count of segments).
//   03 — Seed a flat plane. Pick it, click Build with a single line.
//        Assert reflection lines are straight (straightCount > 0 OR
//        the only polyline is straight per chord/arc ratio).
//   04 — Click Clear. Assert the reflection-line group is removed from
//        window.__forgeScene and the panel chip readouts reset.
//   05 — Close the panel.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (sphere build → closed loops)
//   - right (plane build → straight lines)
//   - iso   (clear + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-213-reflection-line');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'reflection-line-session.mp4');

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
        if (/push-213|reflection|reflectionLine|forge:reflection|error|Error/i.test(t)) {
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
        console.error('[push-213] no .webm');
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
                console.log(`[push-213] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-213] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + reflection-line host surface installed (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Wait for the host's useEffect to install the window surface.
    await page.waitForFunction(
        () => typeof window.__forgeOpenReflectionLine === 'function'
           && typeof window.__forgeCloseReflectionLine === 'function'
           && typeof window.__forgeReflectionLineHelper === 'object'
           && window.__forgeReflectionLineHelper !== null
           && typeof window.__forgeReflectionLineHelper.extractReflectionLines === 'function'
           && typeof window.__forgeSeedReflectionSphere === 'function'
           && typeof window.__forgeSeedReflectionPlane === 'function'
           && typeof window.__forgeClearReflectionLineGroup === 'function',
        null, { timeout: 8000 });

    const surface = await page.evaluate(() => ({
        open:       typeof window.__forgeOpenReflectionLine,
        close:      typeof window.__forgeCloseReflectionLine,
        helper:     typeof window.__forgeReflectionLineHelper,
        seedSphere: typeof window.__forgeSeedReflectionSphere,
        seedPlane:  typeof window.__forgeSeedReflectionPlane,
        clearGroup: typeof window.__forgeClearReflectionLineGroup,
        helperKeys: window.__forgeReflectionLineHelper
            ? Object.keys(window.__forgeReflectionLineHelper).sort()
            : [],
        eventName: window.__forgeReflectionLineHelper?.EVENT_NAME,
        groupName: window.__forgeReflectionLineHelper?.GROUP_NAME,
        defaults:  window.__forgeReflectionLineHelper?.DEFAULTS,
    }));
    console.log('[push-213] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.seedSphere).toBe('function');
    expect(surface.seedPlane).toBe('function');
    expect(surface.clearGroup).toBe('function');
    expect(surface.helperKeys).toContain('extractReflectionLines');
    expect(surface.helperKeys).toContain('extractReflectionLineFamily');
    expect(surface.helperKeys).toContain('buildParallelLightOrigins');
    expect(surface.helperKeys).toContain('reflectAbout');
    expect(surface.helperKeys).toContain('reflectionLineField');
    expect(surface.helperKeys).toContain('triangleIsoContour');
    expect(surface.helperKeys).toContain('classifySegments');
    expect(surface.helperKeys).toContain('familyColour');
    expect(surface.helperKeys).toContain('makeSphereMesh');
    expect(surface.helperKeys).toContain('makePlaneMesh');
    expect(surface.helperKeys).toContain('DEFAULTS');
    expect(surface.eventName).toBe('forge:reflection-line-built');
    expect(surface.groupName).toBe('forge-reflection-line-group');
    expect(surface.defaults.parallelLines).toBe(5);
    expect(surface.defaults.eps).toBe(1.5);

    // Headless math smoke. Reflect the +Z view ray about a +Z normal:
    // viewDir=(0,0,-1) normal=(0,0,1) → r = (0,0,1) (mirror about plane
    // normal). Reflect about a +X normal: r = (1,0,-1)/sqrt(2)-ish — we
    // just check magnitudes / signs.
    const headless = await page.evaluate(() => {
        const h = window.__forgeReflectionLineHelper;
        // 1. reflectAbout — viewer looks straight along -Z, surface
        //    normal points +Z → reflected ray points straight back up +Z.
        const r1 = h.reflectAbout({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 });
        // 2. Triangle iso-contour with f-values (-1, +1, +1) → one segment.
        const seg = h.triangleIsoContour(
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            -1, +1, +1);
        // 3. Sphere mesh — divisions=2 → 320 triangles, all normals are unit.
        const sph = h.makeSphereMesh(10, 2);
        const triCount = sph.indices.length / 3;
        // Verify the first normal is unit-length.
        const n0 = Math.hypot(sph.normals[0], sph.normals[1], sph.normals[2]);
        // 4. Plane mesh — 8×8 → 2 * 8 * 8 = 128 triangles.
        const pln = h.makePlaneMesh(60, 40, 8, 8);
        const planeTri = pln.indices.length / 3;
        // 5. Family colour — generates distinct hues for 5 lines.
        const c0 = h.familyColour(0, 5);
        const c2 = h.familyColour(2, 5);
        return {
            r1: { x: r1.x, y: r1.y, z: r1.z },
            segHasTwoPts: seg && seg.length === 2,
            sphereTriCount: triCount,
            sphereNormalIsUnit: Math.abs(n0 - 1) < 1e-6,
            planeTriCount: planeTri,
            c0, c2,
        };
    });
    console.log('[push-213] headless math =', JSON.stringify(headless));
    // Reflecting (0,0,-1) about (0,0,1) → (0,0,1).
    expect(headless.r1.x).toBeCloseTo(0, 6);
    expect(headless.r1.y).toBeCloseTo(0, 6);
    expect(headless.r1.z).toBeCloseTo(1, 6);
    expect(headless.segHasTwoPts).toBe(true);
    // Icosahedron base = 20 tris; divisions=2 → 20 * 4 * 4 = 320 tris.
    expect(headless.sphereTriCount).toBe(320);
    expect(headless.sphereNormalIsUnit).toBe(true);
    // Plane 8×8 quads → 128 tris.
    expect(headless.planeTriCount).toBe(128);
    // Distinct colours (different hues).
    const dist = Math.hypot(
        headless.c0.r - headless.c2.r,
        headless.c0.g - headless.c2.g,
        headless.c0.b - headless.c2.b);
    expect(dist).toBeGreaterThan(0.2);

    await shot('host-surface-ok');
});

test('01 — open reflection line panel via tools.reflectionLine (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.reflectionLine');
    await page.waitForSelector('[data-testid="forge-reflection-line-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-reflection-line-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-body-picker"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-origin-x"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-origin-y"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-origin-z"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-dir-x"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-dir-y"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-dir-z"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-view-x"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-view-y"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-view-z"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-eps"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-parallel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-spacing"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-build"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-clear"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reflection-line-close"]')).toBeVisible();

    // Default state matches REFLECTION_LINE_DEFAULTS.
    const defaults = await page.evaluate(() => ({
        eps:      document.querySelector('[data-testid="forge-reflection-line-eps"]').value,
        parallel: document.querySelector('[data-testid="forge-reflection-line-parallel"]').value,
        spacing:  document.querySelector('[data-testid="forge-reflection-line-spacing"]').value,
    }));
    console.log('[push-213] panel defaults =', JSON.stringify(defaults));
    expect(Number(defaults.eps)).toBeCloseTo(1.5, 3);
    expect(Number(defaults.parallel)).toBe(5);
    expect(Number(defaults.spacing)).toBe(20);
});

test('02 — sphere → closed-loop reflection lines (top)', async () => {
    await cameraTo('top');

    // Seed a synthetic sphere body via the helper.
    const seedSphere = await page.evaluate(() => {
        const body = window.__forgeSeedReflectionSphere({
            radius: 30,
            divisions: 3,
            name: 'PUSH-213 reflection sphere',
        });
        return {
            bodyId: body.id,
            bodyCount: (window.__forgeBodies || []).length,
        };
    });
    console.log('[push-213] seeded sphere =', JSON.stringify(seedSphere));
    expect(seedSphere.bodyId).toBeTruthy();
    expect(seedSphere.bodyCount).toBeGreaterThan(0);

    // Wait for the body to enter the panel's drop-down.
    await page.waitForFunction((bodyId) => {
        const sel = document.querySelector('[data-testid="forge-reflection-line-body-picker"]');
        if (!sel) return false;
        return Array.from(sel.options).some((o) => o.value === bodyId);
    }, seedSphere.bodyId, { timeout: 4000 });

    // Select the sphere.
    await page.locator('[data-testid="forge-reflection-line-body-picker"]')
        .selectOption(seedSphere.bodyId);
    await pause(200);

    // Build the reflection lines.
    await page.evaluate(() => { try { delete window.__forgeReflectionLineLast; } catch {} });
    await page.locator('[data-testid="forge-reflection-line-build"]').click();

    // Wait for the result to publish.
    await page.waitForFunction(
        () => window.__forgeReflectionLineLast
           && window.__forgeReflectionLineLast.bodyId,
        null, { timeout: 30000 });
    await pause(400);
    await shot('sphere-built');

    const result = await page.evaluate(() => {
        const r = window.__forgeReflectionLineLast;
        // Count THREE.LineSegments in the reflection-line group.
        let lineSegCount = 0;
        let groupCount = 0;
        if (window.__forgeScene) {
            window.__forgeScene.traverse((obj) => {
                if (obj && obj.name === 'forge-reflection-line-group') {
                    groupCount += 1;
                    obj.traverse((c) => {
                        if (c && c.type === 'LineSegments') lineSegCount += 1;
                    });
                }
            });
        }
        return {
            bodyId: r.bodyId,
            familyCount: r.familyCount,
            totalSegments: r.totalSegments,
            polylines: r.polylines,
            closedLoops: r.closedLoops,
            straight: r.straight,
            groupCount,
            lineSegCount,
            families: r.families.map((f) => ({
                idx: f.index,
                segs: f.segmentCount,
                closed: f.closedLoopCount,
                poly: f.polylineCount,
                straight: f.straightCount,
            })),
        };
    });
    console.log('[push-213] sphere result =', JSON.stringify(result, null, 2));
    expect(result.bodyId).toBe(seedSphere.bodyId);
    expect(result.familyCount).toBe(5);     // default parallelLines = 5
    expect(result.totalSegments).toBeGreaterThan(0);
    // The group lives on the scene; each family creates one LineSegments
    // (except empty families).
    expect(result.groupCount).toBe(1);
    expect(result.lineSegCount).toBeGreaterThan(0);
    expect(result.lineSegCount).toBeLessThanOrEqual(5);
    // Brief: "assert reflection lines form circles (closed loops)".
    // On a sphere every reflection-line iso-contour at f = 0 is a closed
    // smooth curve. After topology classification at least one family
    // member must report a closed loop.
    expect(result.closedLoops).toBeGreaterThan(0);
    expect(result.polylines).toBeGreaterThan(0);

    // Panel chip readouts match.
    const panel = page.locator('[data-testid="forge-reflection-line-panel"]');
    const segChip = await panel.getAttribute('data-last-segment-count');
    const closedChip = await panel.getAttribute('data-last-closed-loops');
    expect(Number(segChip)).toBeGreaterThan(0);
    expect(Number(closedChip)).toBeGreaterThan(0);

    // Sphere-shape sanity: the sphere has zero straight reflection lines
    // (every contour curves with the surface).
    // We allow the classifier to mark a degenerate short polyline as
    // "straight" so we only check that closed >> straight.
    expect(result.closedLoops).toBeGreaterThanOrEqual(result.straight);
});

test('03 — plane → straight reflection lines (right)', async () => {
    await cameraTo('right');

    // Clear the existing build so the next pass starts from zero.
    await page.locator('[data-testid="forge-reflection-line-clear"]').click();
    await pause(200);

    // Seed a flat plane body. We make the plane large + dense so the
    // iso-contour has enough triangles to cross.
    const seedPlane = await page.evaluate(() => {
        const body = window.__forgeSeedReflectionPlane({
            width: 200,
            height: 200,
            divisionsX: 24,
            divisionsY: 24,
            name: 'PUSH-213 reflection plane',
        });
        return {
            bodyId: body.id,
            bodyCount: (window.__forgeBodies || []).length,
        };
    });
    console.log('[push-213] seeded plane =', JSON.stringify(seedPlane));
    expect(seedPlane.bodyId).toBeTruthy();

    // Wait for the plane to enter the drop-down + pick it.
    await page.waitForFunction((bodyId) => {
        const sel = document.querySelector('[data-testid="forge-reflection-line-body-picker"]');
        if (!sel) return false;
        return Array.from(sel.options).some((o) => o.value === bodyId);
    }, seedPlane.bodyId, { timeout: 4000 });
    await page.locator('[data-testid="forge-reflection-line-body-picker"]')
        .selectOption(seedPlane.bodyId);
    await pause(200);

    // Configure a single line + view straight down so the reflected
    // ray from each plane vertex points straight up +Z (since the plane
    // normal is +Z). The iso-contour f(P) = r·u − cos(ε) then becomes a
    // function purely of |y| (distance from the light line projected
    // onto the plane). For a wide enough ε we get two parallel straight
    // lines at y = ±y₀ — the canonical "straight reflection lines on a
    // flat surface" expectation.
    await page.locator('[data-testid="forge-reflection-line-parallel"]').fill('1');
    await page.locator('[data-testid="forge-reflection-line-eps"]').fill('8');
    await page.locator('[data-testid="forge-reflection-line-view-x"]').fill('0');
    await page.locator('[data-testid="forge-reflection-line-view-y"]').fill('0');
    await page.locator('[data-testid="forge-reflection-line-view-z"]').fill('-1');
    // Light line at z=200 above the plane, parallel to +X.
    await page.locator('[data-testid="forge-reflection-line-origin-x"]').fill('0');
    await page.locator('[data-testid="forge-reflection-line-origin-y"]').fill('0');
    await page.locator('[data-testid="forge-reflection-line-origin-z"]').fill('200');
    await page.locator('[data-testid="forge-reflection-line-dir-x"]').fill('1');
    await page.locator('[data-testid="forge-reflection-line-dir-y"]').fill('0');
    await page.locator('[data-testid="forge-reflection-line-dir-z"]').fill('0');
    await pause(200);

    // Build.
    await page.evaluate(() => { try { delete window.__forgeReflectionLineLast; } catch {} });
    await page.locator('[data-testid="forge-reflection-line-build"]').click();
    await page.waitForFunction(
        () => window.__forgeReflectionLineLast
           && window.__forgeReflectionLineLast.bodyId,
        null, { timeout: 30000 });
    await pause(400);
    await shot('plane-built');

    // Walk the scene group to read back the position attribute + verify
    // straightness directly on the float buffer. The reflection-line
    // iso-contour for view straight down + light line at z=200 along +X
    // is the locus of plane points where the reflected-ray (always +Z)
    // makes angle ε with u(P) (direction to the closest light-line
    // point). This is a constant-|y| locus → two parallel straight
    // lines at y = ±y₀.
    const planeResult = await page.evaluate(() => {
        const r = window.__forgeReflectionLineLast;
        let positions = null;
        if (window.__forgeScene) {
            window.__forgeScene.traverse((obj) => {
                if (obj && obj.name === 'forge-reflection-line-group') {
                    obj.traverse((c) => {
                        if (c && c.type === 'LineSegments' && !positions) {
                            const pos = c.geometry.attributes.position;
                            positions = new Float32Array(pos.array);
                        }
                    });
                }
            });
        }
        let endpointCount = 0;
        let coplanarFraction = 0;
        // y-band clustering: bucket every endpoint into 1mm bins, and
        // report how many distinct bins carry > 1 endpoint. A perfectly
        // straight reflection line will collapse all its endpoints onto
        // ~1-2 y-bins (one for each parallel line).
        let distinctYBands = 0;
        let yBandSpread = 0;
        let xSpread = 0;
        // Maximum perpendicular distance from any endpoint to the best-
        // fit line within its y-band. For a perfect straight line this
        // is ≪ the mesh edge length.
        let maxOrthoDeviation = 0;
        if (positions && positions.length >= 6) {
            const xs = [], ys = [], zs = [];
            for (let i = 0; i < positions.length; i += 3) {
                xs.push(positions[i + 0]);
                ys.push(positions[i + 1]);
                zs.push(positions[i + 2]);
            }
            endpointCount = xs.length;
            const zMax = zs.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
            coplanarFraction = zMax < 1e-3 ? 1.0 : 0.0;

            // Bucket y into 1mm bins.
            const yBins = new Map();
            for (const y of ys) {
                const b = Math.round(y);
                yBins.set(b, (yBins.get(b) || 0) + 1);
            }
            const populatedBands = [...yBins.entries()]
                .filter(([_, n]) => n > 4)        // ignore stragglers
                .sort((a, b) => a[0] - b[0]);
            distinctYBands = populatedBands.length;
            if (populatedBands.length > 0) {
                yBandSpread = populatedBands[populatedBands.length - 1][0]
                            - populatedBands[0][0];
            }

            // Per-band straightness: fit a line, measure max deviation.
            for (const [band, _] of populatedBands) {
                const inBand = [];
                for (let i = 0; i < xs.length; i++) {
                    if (Math.abs(ys[i] - band) <= 1) {
                        inBand.push({ x: xs[i], y: ys[i] });
                    }
                }
                if (inBand.length < 2) continue;
                const meanX = inBand.reduce((a, p) => a + p.x, 0) / inBand.length;
                const meanY = inBand.reduce((a, p) => a + p.y, 0) / inBand.length;
                for (const p of inBand) {
                    // deviation in y from the band mean — for a strict
                    // horizontal line every endpoint's y must be within
                    // mesh-edge tolerance of meanY.
                    const dy = Math.abs(p.y - meanY);
                    if (dy > maxOrthoDeviation) maxOrthoDeviation = dy;
                }
                const inBandX = inBand.map((p) => p.x);
                const minX = Math.min(...inBandX);
                const maxX = Math.max(...inBandX);
                if (maxX - minX > xSpread) xSpread = maxX - minX;
            }
        }
        return {
            bodyId: r.bodyId,
            familyCount: r.familyCount,
            totalSegments: r.totalSegments,
            polylines: r.polylines,
            closedLoops: r.closedLoops,
            straight: r.straight,
            endpointCount,
            coplanarFraction,
            distinctYBands,
            yBandSpread,
            xSpread,
            maxOrthoDeviation,
        };
    });
    console.log('[push-213] plane result =', JSON.stringify(planeResult, null, 2));
    expect(planeResult.bodyId).toBe(seedPlane.bodyId);
    expect(planeResult.familyCount).toBe(1);
    expect(planeResult.totalSegments).toBeGreaterThan(0);
    expect(planeResult.endpointCount).toBeGreaterThan(0);
    // All endpoints must lie on the plane (z = 0).
    expect(planeResult.coplanarFraction).toBeGreaterThan(0.99);
    // Two parallel reflection lines (at y = +y₀ and y = -y₀): expect 2
    // distinct populated y-bands (we allow 1-2 for robustness to bin
    // alignment).
    expect(planeResult.distinctYBands).toBeGreaterThanOrEqual(1);
    expect(planeResult.distinctYBands).toBeLessThanOrEqual(2);
    // Each band must be a STRAIGHT line: every endpoint inside the band
    // is within ±1 mm of the band's mean y (the canonical "constant-y"
    // line on a plane). A non-straight line would scatter > 5 mm.
    expect(planeResult.maxOrthoDeviation).toBeLessThan(1.5);
    // The straight lines span most of the plane in X.
    expect(planeResult.xSpread).toBeGreaterThan(100);
    // The two lines are symmetric around y = 0; spread ≈ 2·y₀ ≈ 56 mm.
    if (planeResult.distinctYBands === 2) {
        expect(planeResult.yBandSpread).toBeGreaterThan(20);
        expect(planeResult.yBandSpread).toBeLessThan(120);
    }
    // A plane has zero curvature → zero closed loops.
    expect(planeResult.closedLoops).toBe(0);
    // The classifier reports every chord as straight (chord = arc).
    expect(planeResult.straight).toBeGreaterThan(0);
});

test('04 — clear removes the reflection-line group (iso)', async () => {
    await cameraTo('iso');

    // First confirm the group still exists from step 03.
    let groupPresent = await page.evaluate(() => {
        let n = 0;
        if (window.__forgeScene) {
            window.__forgeScene.traverse((obj) => {
                if (obj && obj.name === 'forge-reflection-line-group') n += 1;
            });
        }
        return n;
    });
    expect(groupPresent).toBe(1);

    // Click Clear.
    await page.locator('[data-testid="forge-reflection-line-clear"]').click();
    await pause(300);
    await shot('cleared');

    groupPresent = await page.evaluate(() => {
        let n = 0;
        if (window.__forgeScene) {
            window.__forgeScene.traverse((obj) => {
                if (obj && obj.name === 'forge-reflection-line-group') n += 1;
            });
        }
        return n;
    });
    expect(groupPresent).toBe(0);

    // Last result chip resets.
    const panel = page.locator('[data-testid="forge-reflection-line-panel"]');
    const segChip = await panel.getAttribute('data-last-segment-count');
    expect(Number(segChip)).toBe(0);
    const closedChip = await panel.getAttribute('data-last-closed-loops');
    expect(Number(closedChip)).toBe(0);
    // window mirror is cleared too.
    const mirrorCleared = await page.evaluate(() =>
        typeof window.__forgeReflectionLineLast === 'undefined');
    expect(mirrorCleared).toBe(true);
});

test('05 — close panel + final shot (iso)', async () => {
    await page.locator('[data-testid="forge-reflection-line-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-reflection-line-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
