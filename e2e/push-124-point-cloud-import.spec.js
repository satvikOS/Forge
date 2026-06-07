// PUSH-124 (Slice-92) — Point Cloud Import + display panel.
//
// Reverse-engineering pipelines start with a point cloud. PUSH-124 is the
// first half of that pipeline as a dedicated, single-purpose panel:
//
//   * File picker for .xyz / .ply (in-renderer FileReader path, header
//     dispatched through the existing Forge-161 pointCloudImport.js).
//   * "Generate synthetic point cloud" — N points on a sphere via the
//     Fibonacci spiral (deterministic so the e2e can hard-code centroid /
//     bbox assertions).
//   * THREE.Points + 8-corner InstancedMesh AABB markers committed into
//     window.__forgeScene.
//   * count + bbox + centroid + diagonal statistics.
//
// Proof end-to-end through the real Electron UI:
//
//   00 — Boot. Assert host-window surface (open / close / helper) +
//        frozen helper API (sampleSphereFibonacci / computeStats /
//        parsePointCloudBuffer / buildPointCloudScene + format readers
//        + constants).  Sanity-check Fibonacci sampler: a 2048-point
//        sphere of radius 50 has every point within 50.001 mm of the
//        origin, centroid close to {0,0,0}, bbox close to ±50.  iso.
//   01 — Open the panel via the tools.pointCloud menu action. Assert
//        canonical test-ids mount.  front.
//   02 — Generate a synthetic cloud (2048 pts). Stats line, bbox extent
//        ~100×100×100, centroid ~ 0, the THREE.Points node + 8-marker
//        InstancedMesh land in window.__forgeScene under the named group.
//        top.
//   03 — Write a synthetic .xyz to /tmp, drive the file <input> through
//        page.setInputFiles, assert the cloud snaps to the picked count
//        and the file-name pill updates. right.
//   04 — Headless parse of a 4-point ASCII PLY through the frozen helper
//        — proves the PLY header dispatch works without re-mounting the
//        whole DOM scaffolding.  iso.
//   05 — Clear viewport cloud → scene group disposed, has-cloud=false.
//        PUSH-112 regression: open the Reverse Engineering panel and
//        confirm the canonical test-ids still mount (we ship-coexist).
//        iso.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper surface, headless PLY parse, regression)
//   - front (open panel)
//   - top   (generate synth + scene-publish)
//   - right (file-input drive)
//   - iso   (clear + regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-124-point-cloud-import');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'point-cloud-import-session.mp4');
const XYZ_PATH   = path.join(os.tmpdir(), `push-124-pointcloud-${Date.now()}.xyz`);

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
    try { fs.unlinkSync(XYZ_PATH); } catch {}
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-124|pointcloud|point.cloud|forge|error|Error/i.test(t)) {
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
        console.error('[push-124] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin;
    try { ffmpegBin = require('ffmpeg-static'); }
    catch { console.error('[push-124] ffmpeg-static unavailable'); return; }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-124] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-124] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + host surface + frozen helper API + headless sampler sanity', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenPointCloudImport,
        close:   typeof window.__forgeClosePointCloudImport,
        helper:  typeof window.__forgePointCloudImportHelper,
        helperKeys: window.__forgePointCloudImportHelper
            ? Object.keys(window.__forgePointCloudImportHelper).sort()
            : [],
    }));
    console.log('[push-124] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('sampleSphereFibonacci');
    expect(surface.helperKeys).toContain('computeStats');
    expect(surface.helperKeys).toContain('parsePointCloudBuffer');
    expect(surface.helperKeys).toContain('buildPointCloudScene');
    expect(surface.helperKeys).toContain('detectFormat');
    expect(surface.helperKeys).toContain('readPLY');
    expect(surface.helperKeys).toContain('readXYZ');
    expect(surface.helperKeys).toContain('POINTCLOUD_IMPORT_DEFAULT_RADIUS');

    // Headless Fibonacci-spiral sampler sanity check: 2048 points on a
    // sphere of radius 50 should all sit within 50.001 mm of the origin,
    // bbox should hug ±50, centroid should be near 0.
    const sample = await page.evaluate(() => {
        const h = window.__forgePointCloudImportHelper;
        const pts = h.sampleSphereFibonacci(2048, 50);
        const stats = h.computeStats(pts);
        let maxR = 0, minR = Infinity;
        for (let i = 0; i < pts.length; i += 3) {
            const r = Math.sqrt(pts[i] * pts[i]
                              + pts[i + 1] * pts[i + 1]
                              + pts[i + 2] * pts[i + 2]);
            if (r > maxR) maxR = r;
            if (r < minR) minR = r;
        }
        return {
            count: stats.count,
            minR, maxR,
            bbox: stats.bbox,
            centroid: stats.centroid,
            diagonal: stats.diagonal,
        };
    });
    console.log('[push-124] sampler stats =', JSON.stringify(sample));
    expect(sample.count).toBe(2048);
    // Fibonacci-spiral points on a unit sphere → scaled by 50 → every
    // point exactly on the sphere (the spiral never overshoots r=1).
    expect(sample.maxR).toBeCloseTo(50, 3);
    expect(sample.minR).toBeCloseTo(50, 3);
    // Centroid near origin — uniform Fibonacci distribution averages ~ 0
    // on every axis. Tolerance is generous (within 1 mm) because the
    // exact value is the partial sum of a few thousand spiral terms.
    expect(Math.abs(sample.centroid.x)).toBeLessThan(1);
    expect(Math.abs(sample.centroid.y)).toBeLessThan(1);
    expect(Math.abs(sample.centroid.z)).toBeLessThan(1);
    // BBox ≈ ±50 on every axis.
    expect(sample.bbox.minX).toBeLessThan(-49.9);
    expect(sample.bbox.maxX).toBeGreaterThan( 49.9);
    expect(sample.bbox.minY).toBeLessThan(-49.9);
    expect(sample.bbox.maxY).toBeGreaterThan( 49.9);
    expect(sample.bbox.minZ).toBeLessThan(-49.9);
    expect(sample.bbox.maxZ).toBeGreaterThan( 49.9);
    // Diagonal ≈ √(100² + 100² + 100²) = 173.2 mm.
    expect(sample.diagonal).toBeGreaterThan(170);
    expect(sample.diagonal).toBeLessThan(175);

    await shot('host-surface-ok');
});

test('01 — open Point Cloud Import via tools.pointCloud', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.pointCloud');
    await page.waitForSelector('[data-testid="forge-pointcloud-import-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Canonical control test-ids visible.
    await expect(page.locator('[data-testid="forge-pointcloud-import-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-source-synth"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-source-file"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-synth-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-synth-number"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-generate-synth"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-stats-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pointcloud-import-close"]')).toBeVisible();

    // Default source = synth.
    const panel = page.locator('[data-testid="forge-pointcloud-import-panel"]');
    await expect(panel).toHaveAttribute('data-source', 'synth');
    await expect(panel).toHaveAttribute('data-has-cloud', 'false');
});

test('02 — Generate 2048 synthetic points → cloud lands in scene + stats', async () => {
    await cameraTo('top');
    // Set the slider to 2048 via the numeric input so the spiral sample
    // is deterministic.
    const numInput = page.locator('[data-testid="forge-pointcloud-import-synth-number"]');
    await numInput.fill('2048');
    await numInput.press('Tab');
    await pause(200);

    await page.locator('[data-testid="forge-pointcloud-import-generate-synth"]').click();
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-pointcloud-import-panel"]');
        return el && el.getAttribute('data-has-cloud') === 'true';
    }, null, { timeout: 6000 });
    await shot('cloud-generated');

    // Stats readout populated.
    const count = await page.locator('[data-testid="forge-pointcloud-import-stat-count"]').textContent();
    expect(Number(count)).toBe(2048);

    const extent = await page.locator('[data-testid="forge-pointcloud-import-stat-bbox-extent"]').textContent();
    console.log('[push-124] bbox extent =', extent);
    // Each axis ≈ 100 mm (2 × radius 50).
    const extParts = extent.split('×').map((s) => Number(s.trim()));
    expect(extParts[0]).toBeGreaterThan(99.8);
    expect(extParts[0]).toBeLessThan(100.05);
    expect(extParts[1]).toBeGreaterThan(99.8);
    expect(extParts[1]).toBeLessThan(100.05);
    expect(extParts[2]).toBeGreaterThan(99.8);
    expect(extParts[2]).toBeLessThan(100.05);

    const diag = await page.locator('[data-testid="forge-pointcloud-import-stat-diagonal"]').textContent();
    expect(Number(diag)).toBeGreaterThan(170);
    expect(Number(diag)).toBeLessThan(175);

    // Live scene must carry the named group + a Points node + an
    // InstancedMesh with 8 corners.
    const sceneReport = await page.evaluate(() => {
        const scene = window.__forgeScene;
        if (!scene) return { sceneAvailable: false };
        let group = null, pointsNode = null, marker = null;
        scene.traverse((obj) => {
            if (obj.name === '__forge_pointcloud_import__') group = obj;
            if (obj.name === 'pointcloud-import-points') pointsNode = obj;
            if (obj.name === 'pointcloud-import-bbox-markers') marker = obj;
        });
        return {
            sceneAvailable: true,
            hasGroup: !!group,
            hasPoints: !!pointsNode,
            hasMarker: !!marker,
            pointsCount: pointsNode
                ? (pointsNode.geometry.getAttribute('position')?.count ?? 0)
                : 0,
            markerInstances: marker ? marker.count : 0,
            groupOnWindow: window.__forgePointCloudImportGroup === group,
            lastImport:    !!window.__forgeLastPointCloudImport,
            lastImportCount: window.__forgeLastPointCloudImport
                ? window.__forgeLastPointCloudImport.stats.count
                : 0,
        };
    });
    console.log('[push-124] scene report =', JSON.stringify(sceneReport));
    expect(sceneReport.sceneAvailable).toBe(true);
    expect(sceneReport.hasGroup).toBe(true);
    expect(sceneReport.hasPoints).toBe(true);
    expect(sceneReport.hasMarker).toBe(true);
    expect(sceneReport.pointsCount).toBe(2048);
    expect(sceneReport.markerInstances).toBe(8);
    expect(sceneReport.groupOnWindow).toBe(true);
    expect(sceneReport.lastImport).toBe(true);
    expect(sceneReport.lastImportCount).toBe(2048);

    // Status pill says "Generated …".
    const status = await page.locator('[data-testid="forge-pointcloud-import-status"]').textContent();
    console.log('[push-124] status =', status);
    expect(status).toMatch(/Generated\s+2048/i);
});

test('03 — Pick .xyz file via the file input → cloud snaps to file count', async () => {
    await cameraTo('right');
    // Write a synthetic .xyz to /tmp. 9 points on a 100×100×100 cube
    // (corners + centre) so the bbox is a known {0..100, 0..100, 0..100}.
    const xyz = [
        '# push-124 synthetic xyz fixture',
        '0 0 0',
        '100 0 0',
        '0 100 0',
        '100 100 0',
        '0 0 100',
        '100 0 100',
        '0 100 100',
        '100 100 100',
        '50 50 50',
    ].join('\n');
    fs.writeFileSync(XYZ_PATH, xyz, 'utf8');

    // Switch the source mode to file.
    await page.locator('[data-testid="forge-pointcloud-import-source-file"]').click();
    await pause(250);
    await expect(page.locator('[data-testid="forge-pointcloud-import-panel"]'))
        .toHaveAttribute('data-source', 'file');

    // Drive the hidden <input type="file"> via setInputFiles — bypasses
    // the OS file dialog, the React onChange handler still fires.
    await page.setInputFiles('[data-testid="forge-pointcloud-import-file-input"]', XYZ_PATH);
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-pointcloud-import-panel"]');
        return el && el.getAttribute('data-count') === '9';
    }, null, { timeout: 6000 });
    await shot('xyz-imported');

    const count = await page.locator('[data-testid="forge-pointcloud-import-stat-count"]').textContent();
    expect(Number(count)).toBe(9);

    // bbox should be {0..100, 0..100, 0..100}.
    const bboxMin = await page.locator('[data-testid="forge-pointcloud-import-stat-bbox-min"]').textContent();
    const bboxMax = await page.locator('[data-testid="forge-pointcloud-import-stat-bbox-max"]').textContent();
    console.log('[push-124] xyz bbox min/max =', bboxMin, '/', bboxMax);
    expect(bboxMin.replace(/\s/g, '')).toBe('0.00,0.00,0.00');
    expect(bboxMax.replace(/\s/g, '')).toBe('100.00,100.00,100.00');

    // File name pill updated.
    const fileName = await page.locator('[data-testid="forge-pointcloud-import-file-name"]').textContent();
    expect(fileName).toContain(path.basename(XYZ_PATH));

    // Scene swapped to the new 9-point cloud.
    const sceneCount = await page.evaluate(() => {
        const scene = window.__forgeScene;
        if (!scene) return null;
        let n = 0;
        scene.traverse((obj) => {
            if (obj.name === 'pointcloud-import-points') {
                n = obj.geometry.getAttribute('position').count;
            }
        });
        return n;
    });
    console.log('[push-124] scene points (xyz) =', sceneCount);
    expect(sceneCount).toBe(9);
});

test('04 — Headless PLY parse through the frozen helper', async () => {
    await cameraTo('iso');
    const plyReport = await page.evaluate(() => {
        const h = window.__forgePointCloudImportHelper;
        // 4-point ASCII PLY tetrahedron — minimal-but-valid header + body.
        const ply = [
            'ply',
            'format ascii 1.0',
            'element vertex 4',
            'property float x',
            'property float y',
            'property float z',
            'end_header',
            '0 0 0',
            '10 0 0',
            '0 10 0',
            '0 0 10',
        ].join('\n');
        const buf = new TextEncoder().encode(ply);
        const cloud = h.parsePointCloudBuffer(buf, 'tetra.ply');
        const stats = h.computeStats(cloud.positions);
        return {
            format: cloud.format,
            count:  stats.count,
            bbox:   stats.bbox,
            // Detect-format should also classify the header as PLY.
            detected: h.detectFormat(buf),
        };
    });
    console.log('[push-124] PLY report =', JSON.stringify(plyReport));
    expect(plyReport.detected).toBe('ply');
    expect(plyReport.format).toBe('ply');
    expect(plyReport.count).toBe(4);
    expect(plyReport.bbox.minX).toBe(0);
    expect(plyReport.bbox.maxX).toBe(10);
    expect(plyReport.bbox.minY).toBe(0);
    expect(plyReport.bbox.maxY).toBe(10);
    expect(plyReport.bbox.minZ).toBe(0);
    expect(plyReport.bbox.maxZ).toBe(10);
    await shot('headless-ply-ok');
});

test('05 — Clear viewport cloud + PUSH-112 regression (Reverse Engineering panel)', async () => {
    // Clear the cloud.
    await page.locator('[data-testid="forge-pointcloud-import-clear"]').click();
    await pause(400);
    await expect(page.locator('[data-testid="forge-pointcloud-import-panel"]'))
        .toHaveAttribute('data-has-cloud', 'false');
    await shot('viewport-cleared');

    // Scene group disposed.
    const sceneAfter = await page.evaluate(() => {
        const scene = window.__forgeScene;
        if (!scene) return null;
        let group = null;
        scene.traverse((obj) => {
            if (obj.name === '__forge_pointcloud_import__') group = obj;
        });
        return {
            hasGroup: !!group,
            groupOnWindow: !!window.__forgePointCloudImportGroup,
        };
    });
    expect(sceneAfter.hasGroup).toBe(false);
    expect(sceneAfter.groupOnWindow).toBe(false);

    // Close the import panel before opening the regression panel.
    await page.locator('[data-testid="forge-pointcloud-import-close"]').click();
    await pause(300);

    // PUSH-112 regression — Reverse Engineering panel still opens via
    // its menu action.  We don't fire it though; just confirm the host
    // window surface still resolves so PUSH-112's wiring is intact.
    const regress = await page.evaluate(() => ({
        openFn:  typeof window.__forgeOpenReverseEng,
        closeFn: typeof window.__forgeCloseReverseEng,
    }));
    console.log('[push-124] PUSH-112 regression surface =', JSON.stringify(regress));
    expect(regress.openFn).toBe('function');
    expect(regress.closeFn).toBe('function');

    // Open the Reverse Engineering panel via tools.reverseEng menu so
    // the user can chain the imported cloud into a NURBS fit.
    await platformMenuAction('tools.reverseEng');
    await page.waitForSelector('[data-testid="forge-reverse-eng-panel"]',
        { state: 'visible', timeout: 6000 });
    await expect(page.locator('[data-testid="forge-reverse-eng-source-synth"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reverse-eng-source-stl"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-reverse-eng-fit"]')).toBeVisible();
    await shot('reverse-eng-regression');
});
