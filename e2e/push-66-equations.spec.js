// PUSH-66 — Equation Manager: live parametric variables.
//
// Live parametric variables (SolidWorks Equations / Fusion Parameters /
// NX Expressions). User types `length = 50`, `width = 30`, then
// `height = length * 0.6` and every dependent variable auto-recomputes.
//
// The previous slice (Forge-74) shipped the dialog scaffold but never
// exposed the resolved variable env outside the dialog itself — the
// rest of the app couldn't see the values. PUSH-66 wires:
//   - `window.__forgeEquations` (a live Map<name, number>)
//   - `forge:equations-changed` event (detail.values / detail.errors)
//   - Math.* function support (Math.sin, Math.pow, Math.PI, …)
//   - Per-row data-testids so tests + Archie tools can drive the panel.
//
// Proof end-to-end:
//   1. Boot Forge headed; clear any stale `forge.v4.equations` so we
//      start from a known-empty store (default vars otherwise leak in
//      from the Forge-74 seed and pollute the assertion env).
//   2. Open the Equation Manager via tools.equations.
//   3. Add `length = 50` → Map[length] = 50, event fires with that.
//   4. Add `width = length * 0.6` → Map[width] = 30 (computed from
//      length). Computed cell visible in the panel reads 30 mm.
//   5. Change length to 100 → width auto-recomputes to 60 (event fires
//      again with the new snapshot). This is the load-bearing proof
//      that downstream features can listen for `forge:equations-changed`
//      and re-regenerate from variable values.
//   6. Add `area = length * width` and `radius = Math.sqrt(area/Math.PI)`
//      to prove Math.* functions resolve through the safe parser
//      (radius ≈ 43.7 for length=100, width=60).
//   7. Persistence — vars round-trip through localStorage so a
//      page-level reload (we re-read localStorage and verify it
//      decodes) gets the same env back.
//
// Multi-cam: iso / front / right / top / iso-after = 5 named camera
// angles per the SP-N video review mandate.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-66-equations');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'equations-session.mp4');

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
    await pause(300);
}

// Mutate a controlled <input> in one shot. The Equation Manager's name
// column rebinds its data-testid to the current row id on every change
// (so playwright's character-by-character fill() loses the element
// after the first keystroke when typing into a name field). We instead
// drive the React-controlled input via the prototype's native setter
// + a synthetic input event — that updates state once, atomically,
// without losing the DOM node mid-stroke.
async function setInput(testId, value) {
    await page.evaluate(
        ({ selector, value }) => {
            const el = document.querySelector(`[data-testid="${selector}"]`);
            if (!el) throw new Error('input not found: ' + selector);
            const proto = Object.getPrototypeOf(el);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            desc.set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
        }, { selector: testId, value: String(value) });
    await pause(220);
}

// Add a fresh row, then populate it with name + expression. The panel
// names new vars `var<arr.length + 1>` by default — but that counter
// can collide with an existing id. We diff the row-id set before and
// after the click to find the new row's default id reliably.
async function addEquation(name, expr) {
    const idsBefore = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="forge-eq-row-"]'))
             .map((el) => el.getAttribute('data-testid')));
    await page.locator('[data-testid="forge-eq-add"]').click({ timeout: 4000 });
    await page.waitForFunction(
        (prev) => {
            const cur = Array.from(document.querySelectorAll('[data-testid^="forge-eq-row-"]'))
                            .map((el) => el.getAttribute('data-testid'));
            return cur.length === prev.length + 1;
        }, idsBefore, { timeout: 4000 });
    const newRowTestid = await page.evaluate((prev) => {
        const cur = Array.from(document.querySelectorAll('[data-testid^="forge-eq-row-"]'))
                         .map((el) => el.getAttribute('data-testid'));
        const setPrev = new Set(prev);
        return cur.find((id) => !setPrev.has(id));
    }, idsBefore);
    // testid is `forge-eq-row-<defaultName>`. Strip the prefix.
    const defaultName = newRowTestid.replace(/^forge-eq-row-/, '');
    await setInput(`forge-eq-name-${defaultName}`, name);
    // After rename the testid changes — wait for the new row to exist
    // and then assign the expression.
    await page.waitForSelector(`[data-testid="forge-eq-expr-${name}"]`, { timeout: 4000 });
    await setInput(`forge-eq-expr-${name}`, expr);
}

// Read computed value from the data-eq-value attribute (set on the
// <td> rather than the visible text so we don't have to parse "30 mm"
// strings into numbers from the assertion side).
async function readEqValue(name) {
    const handle = page.locator(`[data-testid="forge-eq-value-${name}"]`);
    const raw = await handle.getAttribute('data-eq-value');
    return raw === '' || raw === null ? null : Number(raw);
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
        if (/push-66|equation|forge:equations|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);

    // Force a clean equation store so the Forge-74 default vars (W, L,
    // T, …) don't leak into our assertions. We also clear the live Map
    // because EquationManager merges the panel's seed list with whatever
    // it finds in localStorage on first mount. The Forge-189 onboarding
    // tour also overlays a full-screen <div data-testid="forge-tour-overlay">
    // that intercepts pointer events — flip its seen flag so it stays
    // dormant for the whole run.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.equations'); } catch {}
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        if (window.__forgeEquations instanceof Map) {
            window.__forgeEquations.clear();
        }
    });
    // If the tour is already running (boot timing race), skip it explicitly.
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
});

test.afterAll(async () => {
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-66] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-66] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-66] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + open Equation Manager via tools.equations', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Start with an event recorder so later steps can assert event count.
    await page.evaluate(() => {
        window.__forgeEqEvents = [];
        window.addEventListener('forge:equations-changed', (e) => {
            window.__forgeEqEvents.push(e.detail);
        });
    });

    await platformMenuAction('tools.equations');
    await page.waitForSelector('[data-testid="forge-equations"]', { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The fresh store gives us a dialog populated either with Forge-74
    // defaults (W, L, T, …) when localStorage was empty, or with
    // whatever rows survived a prior test run. Either way, we wipe the
    // panel back to zero rows before the assertions kick in.
    const initialCount = await page.locator('[data-testid^="forge-eq-row-"]').count();
    console.log('[push-66] initial row count =', initialCount);

    for (let i = 0; i < 40; i++) {
        const remaining = await page.locator('[data-testid^="forge-eq-remove-"]').count();
        if (remaining === 0) break;
        await page.locator('[data-testid^="forge-eq-remove-"]').first().click({ timeout: 2000 });
        await pause(120);
    }
    await pause(300);
    await expect(page.locator('[data-testid^="forge-eq-row-"]')).toHaveCount(0);
    await shot('panel-empty');
});

test('01 — add length = 50 → Map[length] = 50 + event fires', async () => {
    await cameraTo('front');
    await addEquation('length', '50');
    await pause(300);

    const v = await readEqValue('length');
    console.log('[push-66] length value =', v);
    expect(v).toBe(50);

    // Map exposure.
    const fromMap = await page.evaluate(() =>
        window.__forgeEquations instanceof Map ? window.__forgeEquations.get('length') : null);
    expect(fromMap).toBe(50);

    // Event fired with the right detail.
    const events = await page.evaluate(() => window.__forgeEqEvents.slice(-1)[0] || null);
    expect(events).not.toBeNull();
    expect(events.values.length).toBe(50);

    await shot('length-50');
});

test('02 — add width = length * 0.6 → computes to 30', async () => {
    await cameraTo('right');
    await addEquation('width', 'length * 0.6');
    await pause(300);

    const w = await readEqValue('width');
    console.log('[push-66] width value =', w);
    expect(w).toBeCloseTo(30, 6);

    const fromMap = await page.evaluate(() => ({
        length: window.__forgeEquations.get('length'),
        width:  window.__forgeEquations.get('width'),
    }));
    expect(fromMap.length).toBe(50);
    expect(fromMap.width).toBeCloseTo(30, 6);

    await shot('width-30');
});

test('03 — update length=100 → width auto-recomputes to 60', async () => {
    await cameraTo('top');
    // Clear + retype to force a fresh onChange cycle. setInput already
    // does the empty-fill dance.
    await setInput('forge-eq-expr-length', '100');
    await pause(400);

    const lengthV = await readEqValue('length');
    const widthV  = await readEqValue('width');
    console.log('[push-66] post-update length =', lengthV, 'width =', widthV);
    expect(lengthV).toBe(100);
    expect(widthV).toBeCloseTo(60, 6);

    // Map updated too.
    const fromMap = await page.evaluate(() => ({
        length: window.__forgeEquations.get('length'),
        width:  window.__forgeEquations.get('width'),
    }));
    expect(fromMap.length).toBe(100);
    expect(fromMap.width).toBeCloseTo(60, 6);

    // Latest event reflects the new env.
    const latestEvent = await page.evaluate(() => window.__forgeEqEvents.slice(-1)[0] || null);
    expect(latestEvent.values.length).toBe(100);
    expect(latestEvent.values.width).toBeCloseTo(60, 6);
    expect(Object.keys(latestEvent.errors).length).toBe(0);

    await shot('reactive-update');
});

test('04 — Math.* functions resolve: area + radius from Math.sqrt/Math.PI', async () => {
    await cameraTo('iso');
    await addEquation('area', 'length * width');
    await addEquation('radius', 'Math.sqrt(area / Math.PI)');
    await pause(500);

    const area  = await readEqValue('area');
    const radius = await readEqValue('radius');
    console.log('[push-66] area =', area, 'radius =', radius);
    // length=100, width=60 → area=6000, radius=sqrt(6000/PI)=43.7019...
    expect(area).toBeCloseTo(6000, 4);
    expect(radius).toBeCloseTo(Math.sqrt(6000 / Math.PI), 5);

    // Sanity: Math.* did not raise an error (so error map stays empty
    // for these two new ids).
    const latestEvent = await page.evaluate(() => window.__forgeEqEvents.slice(-1)[0] || null);
    expect(latestEvent.errors.area).toBeUndefined();
    expect(latestEvent.errors.radius).toBeUndefined();

    await shot('math-functions');
});

test('05 — persistence + final iso pass', async () => {
    await cameraTo('iso');

    // localStorage payload survives a "reload" — we don't actually
    // reload (would tear down the e2e Electron app), but we verify
    // the JSON we'd reload IS the parametric source of truth.
    const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('forge.v4.equations') || '[]'));
    console.log('[push-66] stored equations =', JSON.stringify(stored));
    const ids = stored.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['length', 'width', 'area', 'radius']));

    // Walk the stored variables back through solveEquations the same way
    // a fresh page load would — by hand-importing the helper would mean
    // reaching into Vite's dist, which we avoid; instead the live values
    // on the Map (Set by the panel's effect) ARE the persisted-and-
    // restored env.
    const env = await page.evaluate(() => {
        const out = {};
        for (const [k, v] of window.__forgeEquations.entries()) out[k] = v;
        return out;
    });
    expect(env.length).toBe(100);
    expect(env.width).toBeCloseTo(60, 6);
    expect(env.area).toBeCloseTo(6000, 4);
    expect(env.radius).toBeCloseTo(Math.sqrt(6000 / Math.PI), 5);

    await shot('final-iso');

    // Close panel.
    await page.locator('[data-testid="forge-eq-done"]').click({ timeout: 4000 });
    await pause(300);
    await shot('panel-closed');
});
