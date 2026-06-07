// PUSH-173 (Slice 129) — Inertia Tensor end-to-end.
//
// PUSH-58 ships the basic Mass Properties panel (volume + COM + area +
// density × volume = mass). PUSH-173 adds the missing physics: the full
// 3×3 mass moment of inertia tensor + principal moments + principal axes.
// Every rigid-body dynamics / FEA / multi-body / balance workflow needs
// this — Newton-Euler I·ω̇ + ω × (I·ω) = τ literally cannot be evaluated
// without the tensor.
//
// Proof end-to-end through the real Electron UI:
//   00. Boot Electron. Confirm window.__forgeInertiaTensorHelper +
//       window.__forgeOpenInertiaTensor install BEFORE the panel mounts.
//       Sanity-check inertiaMath against the canonical box closed-form
//       BEFORE touching the kernel — that's the unit test embedded in
//       the e2e so a kernel regression can't mask a math bug.
//   01. Seed a 60×40×30 native box (volume = 72 000 mm³ exact). The
//       analytic mass moment of inertia about the centroid for a
//       uniform-density box with sides (a, b, c) is:
//         Ixx = m/12 · (b² + c²)
//         Iyy = m/12 · (a² + c²)
//         Izz = m/12 · (a² + b²)
//       Steel ρ=7.85 g/cm³ → m = 72 000 mm³ × 7.85e-3 g/mm³ = 565.2 g.
//       With (a,b,c) = (60, 40, 30) mm:
//         Ixx = 565.2/12 · (1600 + 900) = 117 750 g·mm²
//         Iyy = 565.2/12 · (3600 +  900) = 211 950 g·mm²
//         Izz = 565.2/12 · (3600 + 1600) = 244 920 g·mm²
//   02. Open the Inertia Tensor panel via the tools.inertiaTensor menu
//       action. Confirm the panel mounts.
//   03. Pick material steel + click Compute. Assert:
//         - reported volume ≈ 72 000 mm³  (kernel tessellation accuracy)
//         - reported mass   ≈ 565.2 g
//         - Ixx,Iyy,Izz within 2 % of the analytic closed form
//         - principal moments sorted ascending match the diagonal (box
//           principal axes align with world axes within ε)
//         - off-diagonals near zero (box has no products of inertia
//           when the integration is around the centroid)
//   04. Switch to aluminum (ρ=2.70 g/cm³ → m = 194.4 g) + Recompute.
//       The tensor scales linearly with mass; Ixx ~ 40 504 g·mm².
//   05. Verify the global helper window.__forgeInertiaTensorHelper
//       .computeForActiveBody() returns the same result headlessly.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper assertion)
//   - front (seed box)
//   - right (open panel)
//   - top   (compute steel → assert closed-form)
//   - iso   (aluminum + headless helper + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-173-inertia-tensor');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'inertia-tensor-session.mp4');

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

// ── Helpers to read the rendered numerics out of the panel ──────────
async function readCellNumber(testid) {
    const txt = await page.locator(`[data-testid="${testid}"]`).textContent();
    // Numbers can come in fixed or exponential form (the panel switches).
    const m = /(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(txt || '');
    return m ? Number(m[1]) : null;
}

async function readVolume() {
    const txt = await page.locator('[data-testid="forge-inertia-tensor-volume"]').textContent();
    const m = /(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(txt || '');
    return m ? Number(m[1]) : null;
}
async function readMassGrams() {
    const txt = await page.locator('[data-testid="forge-inertia-tensor-mass"]').textContent();
    const m = /(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*g\b/.exec(txt || '');
    return m ? Number(m[1]) : null;
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
        if (/push-173|inertia|forge|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);

    // Same Onboarding / Discard / Set boot dismissal as PUSH-116.
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

    // Clear the per-body material persistence so the dropdown shows the
    // canonical steel default (PUSH-58 / PUSH-61).
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.bodyMaterials'); } catch {}
        if (window.__forgeBodyMaterials instanceof Map) window.__forgeBodyMaterials.clear();
        const helper = window.__forgeBodyMaterialsHelper;
        if (helper && typeof helper.clearBodyMaterials === 'function') helper.clearBodyMaterials();
    });
    await pause(600);
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
        console.error('[push-173] no .webm');
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
                console.log(`[push-173] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-173] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// 00 — boot + assert the helper surface installed BEFORE the panel
//      mounted, and the pure math reproduces the analytic box closed-form
//      when fed a hand-built triangle list. This is the embedded unit
//      test — it catches a regression in inertiaMath.js before any kernel
//      involvement.

test('00 — boot + helper surface + inertiaMath box closed-form', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => {
        const h = window.__forgeInertiaTensorHelper || null;
        const result = {
            open:    typeof window.__forgeOpenInertiaTensor,
            close:   typeof window.__forgeCloseInertiaTensor,
            helper:  typeof h,
            keys:    h ? Object.keys(h).sort() : [],
        };
        if (!h) return result;

        // Hand-build a closed triangulated 60×40×30 box centred on the
        // origin so we can validate inertiaMath without involving the
        // kernel. All 12 triangles, consistent outward winding.
        const a = 60, b = 40, c = 30;
        const hx = a / 2, hy = b / 2, hz = c / 2;
        // 8 corners.
        const V = [
            [-hx, -hy, -hz], [ hx, -hy, -hz], [ hx,  hy, -hz], [-hx,  hy, -hz],
            [-hx, -hy,  hz], [ hx, -hy,  hz], [ hx,  hy,  hz], [-hx,  hy,  hz],
        ];
        // Triangles — winding selected so every face normal points outward.
        const T = [
            // -Z face (z = -hz): normal -z
            [0, 2, 1], [0, 3, 2],
            // +Z face (z = +hz): normal +z
            [4, 5, 6], [4, 6, 7],
            // -Y face (y = -hy): normal -y
            [0, 1, 5], [0, 5, 4],
            // +Y face (y = +hy): normal +y
            [2, 3, 7], [2, 7, 6],
            // -X face (x = -hx): normal -x
            [0, 4, 7], [0, 7, 3],
            // +X face (x = +hx): normal +x
            [1, 2, 6], [1, 6, 5],
        ];
        const positions = [];
        for (const v of V) { positions.push(v[0], v[1], v[2]); }
        const indices = [];
        for (const t of T) { indices.push(t[0], t[1], t[2]); }

        // Steel ρ = 7.85 g/cc.
        const r = h.computeInertiaFromMesh(positions, indices, 7.85);
        return {
            ...result,
            unit: {
                volume:           r.volume,
                mass:             r.mass,
                com:              r.centerOfMass,
                Ixx: r.Ixx, Iyy: r.Iyy, Izz: r.Izz,
                Ixy: r.Ixy, Iyz: r.Iyz, Ixz: r.Ixz,
                principal:        r.principalMoments,
                principalAxes:    r.principalAxes,
                triangleCount:    r.triangleCount,
            },
        };
    });
    console.log('[push-173] helper surface =', JSON.stringify({
        open: surface.open, close: surface.close, helper: surface.helper,
        keys: surface.keys,
    }));
    console.log('[push-173] hand-box unit test =', JSON.stringify(surface.unit));

    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.keys).toContain('computeInertiaFromMesh');
    expect(surface.keys).toContain('DENSITY_G_CC');
    expect(surface.keys).toContain('computeForActiveBody');

    // Closed-form for 60×40×30 box, steel:
    //   V = 72000 mm³, m = 565.2 g
    //   Ixx = 565.2/12 · (40² + 30²) = 117 750 g·mm²
    //   Iyy = 565.2/12 · (60² + 30²) = 211 950 g·mm²
    //   Izz = 565.2/12 · (60² + 40²) = 244 920 g·mm²
    //   Off-diagonals = 0 (box centred on origin → principal axes = world axes)
    const u = surface.unit;
    expect(u.triangleCount).toBe(12);
    expect(Math.abs(u.volume - 72000)).toBeLessThan(1e-6);
    expect(Math.abs(u.mass   - 565.2)).toBeLessThan(1e-4);
    expect(Math.abs(u.com[0])).toBeLessThan(1e-9);
    expect(Math.abs(u.com[1])).toBeLessThan(1e-9);
    expect(Math.abs(u.com[2])).toBeLessThan(1e-9);
    expect(Math.abs(u.Ixx - 117750)).toBeLessThan(1e-3);
    expect(Math.abs(u.Iyy - 211950)).toBeLessThan(1e-3);
    expect(Math.abs(u.Izz - 244920)).toBeLessThan(1e-3);
    expect(Math.abs(u.Ixy)).toBeLessThan(1e-6);
    expect(Math.abs(u.Iyz)).toBeLessThan(1e-6);
    expect(Math.abs(u.Ixz)).toBeLessThan(1e-6);
    // Principal moments are the sorted diagonal (ascending).
    expect(Math.abs(u.principal[0] - 117750)).toBeLessThan(1e-3);
    expect(Math.abs(u.principal[1] - 211950)).toBeLessThan(1e-3);
    expect(Math.abs(u.principal[2] - 244920)).toBeLessThan(1e-3);
});

// ─────────────────────────────────────────────────────────────────────
// 01 — seed the kernel box. forge.makeBox(60, 40, 30) lays it down at
// the origin with corners (0,0,0) → (60,40,30) — NOT centred. The
// analytic moments-of-inertia ABOUT THE CENTROID are independent of
// where the box sits because the integrator shifts to the centroid
// via the parallel-axis theorem. (We re-derive that exact behaviour in
// inertiaMath.js and unit-tested it in step 00.)

test('01 — seed a 60×40×30 native box (vol = 72 000 mm³ exact)', async () => {
    await cameraTo('front');
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(60, 40, 30);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-173', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 60×40×30',
            params: { width: 60, height: 40, distance: 30 },
        });
        // Sanity — kernel volume should be exactly 72 000.
        let v = null;
        try { v = window.forge?.massProps?.(h)?.volume ?? null; } catch {}
        return { handle: h, volume: v };
    });
    console.log('[push-173] seeded box =', JSON.stringify(seeded));
    expect(seeded.handle).toBeGreaterThan(0);
    expect(Math.abs(seeded.volume - 72000)).toBeLessThan(1);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('box-seeded');
});

// ─────────────────────────────────────────────────────────────────────
// 02 — open the Inertia Tensor panel via the tools.inertiaTensor menu
// action.

test('02 — open Inertia Tensor panel via tools.inertiaTensor', async () => {
    await cameraTo('right');
    await platformMenuAction('tools.inertiaTensor');
    await page.waitForSelector('[data-testid="forge-inertia-tensor-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Body label should reference the seeded native box.
    await expect(page.locator('[data-testid="forge-inertia-tensor-body"]'))
        .toContainText(/Box 60×40×30|handle/);
});

// ─────────────────────────────────────────────────────────────────────
// 03 — steel @ default, click Compute, assert closed-form within 2 %.

test('03 — Compute (steel) → tensor matches box closed-form', async () => {
    await cameraTo('top');

    // Pin material to steel + click Compute.
    await page.locator('[data-testid="forge-inertia-tensor-material"]').selectOption('steel');
    await pause(200);
    await page.locator('[data-testid="forge-inertia-tensor-compute"]').click();
    // Computation is synchronous (single JS pass) but the React render
    // takes a tick — wait for the results section to appear.
    await page.waitForSelector('[data-testid="forge-inertia-tensor-results"]',
        { state: 'visible', timeout: 6000 });
    await shot('steel-compute');

    // Mass row.
    const mass = await readMassGrams();
    console.log('[push-173] steel mass =', mass);
    expect(mass).not.toBeNull();
    // Allow ±2 % for the kernel's tessellation accuracy.
    expect(Math.abs(mass - 565.2)).toBeLessThan(565.2 * 0.02);

    // Volume row.
    const vol = await readVolume();
    console.log('[push-173] steel volume =', vol);
    expect(vol).not.toBeNull();
    expect(Math.abs(vol - 72000)).toBeLessThan(72000 * 0.02);

    // Pull the rendered tensor matrix and assert against the analytic
    // closed-form for a 60×40×30 steel box.
    //   Ixx = m/12·(b²+c²) = 565.2/12·(1600+900) = 117 750 g·mm²
    //   Iyy = m/12·(a²+c²) = 565.2/12·(3600+900) = 211 950 g·mm²
    //   Izz = m/12·(a²+b²) = 565.2/12·(3600+1600) = 244 920 g·mm²
    const cells = await page.evaluate(() => {
        function read(i, j) {
            const el = document.querySelector(`[data-testid="forge-inertia-tensor-cell-${i}${j}"]`);
            if (!el) return null;
            const m = /(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(el.textContent || '');
            return m ? Number(m[1]) : null;
        }
        return [
            [read(0, 0), read(0, 1), read(0, 2)],
            [read(1, 0), read(1, 1), read(1, 2)],
            [read(2, 0), read(2, 1), read(2, 2)],
        ];
    });
    console.log('[push-173] tensor =', JSON.stringify(cells));
    const Ixx = cells[0][0];
    const Iyy = cells[1][1];
    const Izz = cells[2][2];
    expect(Ixx).not.toBeNull();
    expect(Iyy).not.toBeNull();
    expect(Izz).not.toBeNull();
    // 2 % tolerance for kernel tessellation accuracy.
    expect(Math.abs(Ixx - 117750)).toBeLessThan(117750 * 0.02);
    expect(Math.abs(Iyy - 211950)).toBeLessThan(211950 * 0.02);
    expect(Math.abs(Izz - 244920)).toBeLessThan(244920 * 0.02);

    // Off-diagonals should be small relative to the diagonal (a centred
    // box, integrated about the centroid, has zero products of inertia).
    // Tessellation noise at the centroid shift can leak a tiny residual.
    const maxOff = Math.max(
        Math.abs(cells[0][1]), Math.abs(cells[1][2]), Math.abs(cells[0][2]),
    );
    console.log('[push-173] max off-diagonal =', maxOff);
    expect(maxOff).toBeLessThan(Math.max(Ixx, Iyy, Izz) * 0.02);

    // Principal moments rendered separately — sorted ascending.
    const principals = await page.evaluate(() => {
        return [0, 1, 2].map((i) => {
            const el = document.querySelector(`[data-testid="forge-inertia-tensor-principal-${i}"]`);
            if (!el) return null;
            const m = /(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/g.exec(el.textContent || '');
            return m ? Number(m[1]) : null;
        });
    });
    console.log('[push-173] principal moments =', JSON.stringify(principals));
    // The label includes "I1 = 117750" or similar; the regex above picks
    // the digit "1" out of "I1 =" — so we drop the FIRST match per cell
    // and re-parse with a more specific selector. Easier: scan all
    // numeric tokens and pick the largest, which should be the moment.
    const principalsClean = await page.evaluate(() => {
        return [0, 1, 2].map((i) => {
            const el = document.querySelector(`[data-testid="forge-inertia-tensor-principal-${i}"]`);
            if (!el) return null;
            const matches = (el.textContent || '').match(/-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g) || [];
            // The label is `I{i+1} = <value>` → second number is the moment.
            const nums = matches.map(Number).filter(Number.isFinite);
            // The first match is the "1", "2", "3" in I1/I2/I3, the
            // second is the real moment value.
            return nums.length >= 2 ? nums[1] : nums[0];
        });
    });
    console.log('[push-173] principal moments (clean) =', JSON.stringify(principalsClean));
    expect(Math.abs(principalsClean[0] - 117750)).toBeLessThan(117750 * 0.02);
    expect(Math.abs(principalsClean[1] - 211950)).toBeLessThan(211950 * 0.02);
    expect(Math.abs(principalsClean[2] - 244920)).toBeLessThan(244920 * 0.02);
});

// ─────────────────────────────────────────────────────────────────────
// 04 — switch material to aluminum, recompute, assert mass-linear scaling
// of the tensor. ρ_al / ρ_st = 2.70 / 7.85 ≈ 0.343949; every component
// of the inertia tensor scales by exactly that ratio (mass is the only
// density-dependent factor — the geometric integrals are unchanged).

test('04 — aluminum recompute → tensor scales linearly with density', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-inertia-tensor-material"]').selectOption('aluminum');
    await pause(200);
    await page.locator('[data-testid="forge-inertia-tensor-compute"]').click();
    await pause(400);
    await shot('aluminum-compute');

    const mass = await readMassGrams();
    console.log('[push-173] aluminum mass =', mass);
    // m = 72 000 × 2.70e-3 = 194.4 g
    expect(Math.abs(mass - 194.4)).toBeLessThan(194.4 * 0.02);

    // Ixx = 194.4/12·(40²+30²) = 40 500 g·mm²
    const cellIxx = await page.locator('[data-testid="forge-inertia-tensor-cell-00"]').textContent();
    const Ixx = Number(/(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(cellIxx || '')?.[1]);
    console.log('[push-173] aluminum Ixx =', Ixx);
    expect(Math.abs(Ixx - 40500)).toBeLessThan(40500 * 0.02);
});

// ─────────────────────────────────────────────────────────────────────
// 05 — headless helper. Drive computeForActiveBody() from the console
// (no UI clicks) and confirm the result matches the panel reading. This
// is the Archie / scripting entrypoint.

test('05 — headless helper computeForActiveBody() returns the same tensor', async () => {
    const headless = await page.evaluate(() => {
        const h = window.__forgeInertiaTensorHelper;
        if (!h || typeof h.computeForActiveBody !== 'function') return { error: 'helper missing' };
        const r = h.computeForActiveBody('aluminum');
        return {
            density: r.density,
            mass: r.result.mass,
            Ixx: r.result.Ixx,
            Iyy: r.result.Iyy,
            Izz: r.result.Izz,
            principal: r.result.principalMoments,
        };
    });
    console.log('[push-173] headless =', JSON.stringify(headless));
    expect(headless.density).toBeCloseTo(2.70, 6);
    expect(Math.abs(headless.mass - 194.4)).toBeLessThan(194.4 * 0.02);
    expect(Math.abs(headless.Ixx - 40500)).toBeLessThan(40500 * 0.02);
    // 194.4/12 · (60²+30²) = 72 900
    expect(Math.abs(headless.Iyy - 72900)).toBeLessThan(72900 * 0.02);
    // 194.4/12 · (60²+40²) = 84 240
    expect(Math.abs(headless.Izz - 84240)).toBeLessThan(84240 * 0.02);

    await shot('headless-final');
});
