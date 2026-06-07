// PUSH-76 (Slice-44 / Selection Filter chip strip — Body / Face / Edge / Vertex).
//
// Up through PUSH-75 the active selection-filter mode was buried at the
// bottom of the Edit menu (Edit → Filter · Bodies / Faces / Edges /
// Vertices), with no always-visible readout of "what kind of thing am I
// currently picking?". PUSH-76 lights up an always-on top-left chip
// strip that exposes the four kinds, shows the current active one
// highlighted, and lets the user switch by clicking any chip.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Assert the strip is mounted and visible at the top-left, all four
//      chips render with the canonical kinds (body / face / edge /
//      vertex), and the canonical global signal
//      `window.__forgeSelectionFilter` is published with a valid kind.
//   3. Click the FACE chip. Assert:
//        • the chip becomes data-active='true'
//        • the strip's data-active-filter attribute flips to 'face'
//        • a forge:menu-action event fired with id 'edit.filterFace'
//        • a forge:filter-changed event fired with kind 'face'
//        • `window.__forgeSelectionFilter` mirrors to 'face'
//        • the shell's window.__forgeSelection.kind mirrors to 'face'
//          (proves the click round-tripped through the real handler in
//          ForgeShellV4.jsx lines 706-721 — no MVP / no fake state)
//   4. Click EDGE / VERTEX / BODY in sequence, asserting after each
//      click that the active chip rotates and the bus events follow.
//   5. External-publish path: dispatch a forge:selection-changed event
//      with kind='face' from outside the strip (mirroring the viewport
//      picker / EntityPropsPanel / MeasureToolPanel publish path).
//      Assert the strip's highlight follows back to 'face'.
//   6. forge:filter-changed external-publish path: dispatch the canonical
//      filter-changed event from outside the strip (mirroring Archie /
//      the command palette). Assert the strip's highlight follows.
//   7. PUSH-63 regression: open Entity Properties via tools.entityProps
//      and assert its panel still mounts — SelectionFilterStrip is a
//      portal sibling and must not collide with other right-docked
//      panels OR with the top-left SketchConstraintsToolbar.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + visibility + initial readouts)
//   - front (click FACE + round-trip assertions)
//   - top   (click EDGE / VERTEX / BODY sequence)
//   - right (external forge:selection-changed + forge:filter-changed paths)
//   - iso   (PUSH-63 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-76-selection-filter');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'selection-filter-session.mp4');

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
    await pause(250);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(200);
}

// Install a window-level capture for the two buses we care about. The
// test asserts payload + ordering across the whole run.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push76MenuEvents   = [];
        window.__push76FilterEvents = [];
        window.addEventListener('forge:menu-action', (e) => {
            try {
                const id = e?.detail?.id;
                if (typeof id === 'string' && id.startsWith('edit.filter')) {
                    window.__push76MenuEvents.push({
                        id,
                        source: e?.detail?.source || null,
                    });
                }
            } catch { /* ignore */ }
        });
        window.addEventListener('forge:filter-changed', (e) => {
            try {
                window.__push76FilterEvents.push({
                    kind:   e?.detail?.kind   || null,
                    source: e?.detail?.source || null,
                });
            } catch { /* ignore */ }
        });
    });
}
async function readMenuEvents()   { return await page.evaluate(() => window.__push76MenuEvents   || []); }
async function readFilterEvents() { return await page.evaluate(() => window.__push76FilterEvents || []); }

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-76|selection-filter|SelectionFilter|forge:filter-changed|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss any first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    // Forge-189 onboarding tour mounts a full-screen overlay; flip the
    // seen flag so it stays dormant for the whole run, then explicitly
    // skip if it raced in.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    await pause(800);
    await installEventCapture();
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
        console.error('[push-76] no .webm');
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
                const sz = (fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2);
                console.log(`[push-76] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-76] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — strip mounts top-left + four chips render + initial signal published', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Strip is mounted and visible.
    const strip = page.locator('[data-testid="forge-selection-filter-strip"]');
    await expect(strip).toBeVisible();

    // Initial data-active-filter must be one of the four valid kinds.
    const initialKind = await strip.getAttribute('data-active-filter');
    expect(['body', 'face', 'edge', 'vertex']).toContain(initialKind);

    // Header chip is present and matches the data-kind contract.
    const header = page.locator('[data-testid="forge-selection-filter-header"]');
    await expect(header).toBeVisible();
    const headerKind = await header.getAttribute('data-kind');
    expect(headerKind).toBe(initialKind);

    // All four chip buttons render with the right kinds.
    for (const k of ['body', 'face', 'edge', 'vertex']) {
        const chip = page.locator(`[data-testid="forge-selection-filter-${k}"]`);
        await expect(chip).toBeVisible();
        const kAttr = await chip.getAttribute('data-kind');
        expect(kAttr).toBe(k);
    }

    // Exactly one chip is data-active='true' (the initial active filter).
    const buttons = page.locator('[data-testid="forge-selection-filter-buttons"] button');
    const total = await buttons.count();
    expect(total).toBe(4);
    let activeCount = 0;
    for (let i = 0; i < total; i += 1) {
        const a = await buttons.nth(i).getAttribute('data-active');
        if (a === 'true') activeCount += 1;
    }
    expect(activeCount).toBe(1);

    // Global signal is published synchronously.
    const sig = await page.evaluate(() => window.__forgeSelectionFilter);
    expect(['body', 'face', 'edge', 'vertex']).toContain(sig);
    expect(sig).toBe(initialKind);

    // Sanity: dispatching forge:filter-changed externally (mirroring
    // Archie / command-palette firings) propagates back to the global
    // signal — proves the strip's listener is hot AND the capture works.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:filter-changed', {
            detail: { kind: 'face', source: 'sanity' },
        }));
    });
    await pause(250);
    const filterEvents = await readFilterEvents();
    const hasSanity = filterEvents.some(
        (e) => e.kind === 'face' && e.source === 'sanity');
    expect(hasSanity).toBe(true);
    // The strip's highlight follows.
    const stripAfter = await strip.getAttribute('data-active-filter');
    expect(stripAfter).toBe('face');
    // Restore to body so test 01 sees the canonical "click face from
    // something-not-face" flow.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:filter-changed', {
            detail: { kind: 'body', source: 'sanity-restore' },
        }));
    });
    await pause(250);
});

test('01 — click Face chip → menu-action + filter-changed dispatched + shell selection mirrors', async () => {
    await cameraTo('front');

    // Reset the capture rings so this test's assertions are scoped.
    await page.evaluate(() => {
        window.__push76MenuEvents.length   = 0;
        window.__push76FilterEvents.length = 0;
    });

    const faceChip = page.locator('[data-testid="forge-selection-filter-face"]');
    await expect(faceChip).toBeVisible();
    await faceChip.click();
    await pause(300);
    await shot('after-face-click');

    // The chip becomes active.
    const active = await faceChip.getAttribute('data-active');
    expect(active).toBe('true');

    // The strip's data-active-filter reflects the new state.
    const strip = page.locator('[data-testid="forge-selection-filter-strip"]');
    const stripFilter = await strip.getAttribute('data-active-filter');
    expect(stripFilter).toBe('face');

    // The other three chips are NOT active.
    for (const k of ['body', 'edge', 'vertex']) {
        const a = await page.locator(`[data-testid="forge-selection-filter-${k}"]`)
                            .getAttribute('data-active');
        expect(a).toBe('false');
    }

    // The header chip mirrors.
    const headerKind = await page.locator('[data-testid="forge-selection-filter-header"]')
                                 .getAttribute('data-kind');
    expect(headerKind).toBe('face');

    // The menu-action bus fired with id=edit.filterFace and our source.
    const menuEvents = await readMenuEvents();
    const filterFaceFired = menuEvents.find(
        (e) => e.id === 'edit.filterFace' && e.source === 'selection-filter-strip');
    expect(filterFaceFired).toBeTruthy();

    // The filter-changed bus fired with kind=face. There can be more
    // than one (the click publishes from strip-click + the menu-action
    // round-trip from menu-action listener), so we assert at least one
    // entry with kind=face exists.
    const filterEvents = await readFilterEvents();
    const filterFaceChanged = filterEvents.find((e) => e.kind === 'face');
    expect(filterFaceChanged).toBeTruthy();

    // The canonical global signal is updated.
    const sig = await page.evaluate(() => window.__forgeSelectionFilter);
    expect(sig).toBe('face');

    // The shell's selection.kind mirrors (proves the click round-tripped
    // through the real ForgeShellV4.onMenuAction → setSelection path).
    const shellSelKind = await page.evaluate(
        () => window.__forgeSelection && window.__forgeSelection.kind);
    expect(shellSelKind).toBe('face');
});

test('02 — click Edge / Vertex / Body sequence → highlight rotates + bus follows', async () => {
    await cameraTo('top');

    const sequence = ['edge', 'vertex', 'body'];
    const menuIds  = {
        edge:   'edit.filterEdge',
        vertex: 'edit.filterVert',
        body:   'edit.filterBody',
    };

    for (const k of sequence) {
        // Reset capture for per-step assertions.
        await page.evaluate(() => {
            window.__push76MenuEvents.length   = 0;
            window.__push76FilterEvents.length = 0;
        });

        const chip = page.locator(`[data-testid="forge-selection-filter-${k}"]`);
        await chip.click();
        await pause(300);
        await shot(`after-${k}-click`);

        // This chip is active.
        const active = await chip.getAttribute('data-active');
        expect(active).toBe('true');

        // The strip data-active-filter follows.
        const strip = page.locator('[data-testid="forge-selection-filter-strip"]');
        const filter = await strip.getAttribute('data-active-filter');
        expect(filter).toBe(k);

        // The other three chips are NOT active.
        for (const other of ['body', 'face', 'edge', 'vertex']) {
            if (other === k) continue;
            const a = await page.locator(`[data-testid="forge-selection-filter-${other}"]`)
                                .getAttribute('data-active');
            expect(a).toBe('false');
        }

        // Menu-action fired with the canonical id.
        const menuEvents = await readMenuEvents();
        const fired = menuEvents.find(
            (e) => e.id === menuIds[k] && e.source === 'selection-filter-strip');
        expect(fired).toBeTruthy();

        // filter-changed fired with our kind.
        const filterEvents = await readFilterEvents();
        const changed = filterEvents.find((e) => e.kind === k);
        expect(changed).toBeTruthy();

        // Global signal mirrors.
        const sig = await page.evaluate(() => window.__forgeSelectionFilter);
        expect(sig).toBe(k);

        // Shell selection mirrors.
        const shellKind = await page.evaluate(
            () => window.__forgeSelection && window.__forgeSelection.kind);
        expect(shellKind).toBe(k);
    }
});

test('03 — external forge:selection-changed + forge:filter-changed propagate to highlight', async () => {
    await cameraTo('right');

    // First: external publish on the shell's canonical selection bus.
    // The viewport picker, EntityProps, MeasureTool, and Layers panels
    // all publish on this exact bus when they detect a kind change.
    await page.evaluate(() => {
        window.__forgeSelection = { kind: 'face', ids: [1] };
        window.dispatchEvent(new CustomEvent('forge:selection-changed', {
            detail: { kind: 'face', ids: [1] },
        }));
    });
    await pause(300);
    await shot('external-selection-changed-face');

    const stripAfterSel = page.locator('[data-testid="forge-selection-filter-strip"]');
    const filterAfterSel = await stripAfterSel.getAttribute('data-active-filter');
    expect(filterAfterSel).toBe('face');
    const faceActive = await page.locator('[data-testid="forge-selection-filter-face"]')
                                 .getAttribute('data-active');
    expect(faceActive).toBe('true');
    // The cross-publish on filter-changed (source='selection-mirror') means
    // any consumer that ONLY listens to forge:filter-changed also sees
    // the implicit filter change. Confirm.
    const sigAfterSel = await page.evaluate(() => window.__forgeSelectionFilter);
    expect(sigAfterSel).toBe('face');

    // Second: external publish on the canonical filter-changed bus
    // directly (mirroring Archie / the command palette firing the bus
    // event without a click).
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:filter-changed', {
            detail: { kind: 'edge', source: 'archie' },
        }));
    });
    await pause(300);
    await shot('external-filter-changed-edge');

    const filterAfterDirect = await stripAfterSel.getAttribute('data-active-filter');
    expect(filterAfterDirect).toBe('edge');
    const edgeActive = await page.locator('[data-testid="forge-selection-filter-edge"]')
                                 .getAttribute('data-active');
    expect(edgeActive).toBe('true');

    // Third: vertex via external selection-changed.
    await page.evaluate(() => {
        window.__forgeSelection = { kind: 'vertex', ids: [42] };
        window.dispatchEvent(new CustomEvent('forge:selection-changed', {
            detail: { kind: 'vertex', ids: [42] },
        }));
    });
    await pause(300);
    const filterAfterVertex = await stripAfterSel.getAttribute('data-active-filter');
    expect(filterAfterVertex).toBe('vertex');

    // Sanity: an external selection-changed with kind='none' must NOT
    // change the highlight (the strip ignores invalid kinds — the
    // 'none' state means "nothing selected", not "no filter").
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:selection-changed', {
            detail: { kind: 'none', ids: [] },
        }));
    });
    await pause(200);
    const filterAfterNone = await stripAfterSel.getAttribute('data-active-filter');
    expect(filterAfterNone).toBe('vertex');
});

test('04 — PUSH-63 regression: Entity Properties panel still mounts alongside the strip', async () => {
    await cameraTo('iso');

    // Open the Entity Properties panel via tools.entityProps. This is
    // a portal-mounted panel; the SelectionFilterStrip is also a portal
    // sibling. The two must coexist.
    await platformMenuAction('tools.entityProps');
    await pause(400);
    await shot('entity-props-coexists');

    const entityPanel = page.locator('[data-testid="forge-entityprops-panel"]');
    await expect(entityPanel).toBeVisible({ timeout: 6000 });

    // The strip is also still visible — opening another panel must not
    // dismount or hide the always-on filter HUD.
    const strip = page.locator('[data-testid="forge-selection-filter-strip"]');
    await expect(strip).toBeVisible();

    // Sanity: the strip still responds to clicks while the entity panel
    // is open. Switch to Body and confirm.
    await page.locator('[data-testid="forge-selection-filter-body"]').click();
    await pause(300);
    const stripFilter = await strip.getAttribute('data-active-filter');
    expect(stripFilter).toBe('body');
    const shellKind = await page.evaluate(
        () => window.__forgeSelection && window.__forgeSelection.kind);
    expect(shellKind).toBe('body');

    await shot('final');
});
