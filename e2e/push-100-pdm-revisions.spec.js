// PUSH-100 (Slice-68 / PDM Revisions dialog — semver + ECN log).
//
// PUSH-51 (Slice-20) shipped the real JSON-backed PDM vault. PUSH-14's
// PdmPanel sits next to it as the cosmetic five-tab item / revision /
// ECN / BOM / where-used UI. PUSH-100 adds a *focused* semver revisions
// dialog reachable through tools.pdmRevisions — the user requested it
// specifically:
//
//   • Current document version is displayed as a chip (`1.0.0` on first
//     mount).
//   • +Major / +Minor / +Patch buttons bump the version per SemVer 2.0:
//     - major: bumps major, resets minor + patch to 0
//     - minor: keeps major, bumps minor, resets patch to 0
//     - patch: keeps major + minor, bumps patch only
//   • ECN form (id + free-text description) attaches to the next bump.
//   • Revision history shows every bump as a row in a table (from → to,
//     kind, ECN, description, ISO timestamp).
//   • Everything persists to localStorage `forge.v4.pdmRevisions` AND
//     mirrors onto `window.__forgePdmRevisions` for headless drivers.
//
// Proof end to end through the real UI:
//   1. Boot Electron, dismiss any first-run banner. Reset the local
//      revisions store so we start from a known baseline (1.0.0 / 0 history).
//   2. Wait for window.__forgePdmRevisions, __forgeOpenPdmRevisions,
//      __forgePdmRevisionsBump, __forgePdmRevisionsReset to be installed
//      by the host effect — proof PdmRevisionsPanelHost mounted from
//      App.jsx before the panel was ever opened.
//   3. Open the panel via the `tools.pdmRevisions` menu action; the
//      panel mounts with data-current='1.0.0' and history-count='0'.
//   4. Fill the ECN form: id `ECN-1001`, description `Fix tolerance`.
//   5. Click +Minor → the brief's contract:
//        window.__forgePdmRevisions.current === '1.1.0'
//        window.__forgePdmRevisions.history.length === 1
//        history[0] = { from: '1.0.0', to: '1.1.0', kind: 'minor',
//                       ecn: 'ECN-1001', desc: 'Fix tolerance', ts: <num> }
//      The panel's data-current attribute mirrors '1.1.0' on the next
//      render; the history table shows one row with the ECN + desc.
//   6. SemVer reset coverage: click +Patch (no ECN) → '1.1.1'. Then
//      click +Major → '2.0.0' (minor + patch zeroed). Verify both
//      land in window.__forgePdmRevisions.history with the right ts
//      ordering.
//   7. Verify the persistence contract: re-read localStorage
//      `forge.v4.pdmRevisions` directly and confirm it round-trips to
//      the same shape we asserted on window.
//   8. PUSH-51 regression: open the PDM Vault via tools.pdmvault. Both
//      panels must coexist (different testids, different right-docked
//      slots) — Revisions stays visible, Vault opens fresh.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + host surface assert)
//   - front (open panel + ECN form + +Minor)
//   - top   (+Patch + +Major + SemVer reset rules)
//   - right (localStorage round-trip)
//   - iso   (PUSH-51 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-100-pdm-revisions');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'pdm-revisions-session.mp4');

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
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /push-100|pdm-revisions|PdmRevisions|forge:pdm-revisions|error|Error|exception|TypeError/i.test(t)) {
            console.log('[browser]', msg.type(), t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser pageerror]', err.message);
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
        // Reset the PDM revisions store BEFORE the panel mount reads
        // the persisted snapshot. The host effect calls loadState() on
        // mount, but we want every test run to start from 1.0.0 / 0
        // history — independent of previous CI runs.
        try { window.localStorage.removeItem('forge.v4.pdmRevisions'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
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
        console.error('[push-100] no .webm');
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
                console.log(`[push-100] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-100] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global host surface installed', async () => {
    await cameraTo('iso');
    await shot('boot');
    // The host effect installs the imperative open/close + the headless
    // bump/reset + the mirrored snapshot at mount time, BEFORE the panel
    // is ever opened. Proof PdmRevisionsPanelHost mounted from App.jsx.
    await page.waitForFunction(
        () => typeof window.__forgeOpenPdmRevisions === 'function'
           && typeof window.__forgeClosePdmRevisions === 'function'
           && typeof window.__forgePdmRevisionsBump === 'function'
           && typeof window.__forgePdmRevisionsReset === 'function'
           && typeof window.__forgePdmRevisions === 'object',
        null, { timeout: 8000 });

    // Reset to baseline (the beforeAll clears localStorage, but the
    // mirror snapshot is populated before that block runs in some
    // boot orderings — call reset() to be deterministic).
    const baseline = await page.evaluate(() => window.__forgePdmRevisionsReset());
    console.log('[push-100] baseline =', JSON.stringify(baseline));
    expect(baseline.current).toBe('1.0.0');
    expect(Array.isArray(baseline.history)).toBe(true);
    expect(baseline.history.length).toBe(0);

    // localStorage is also in the baseline shape.
    const persisted = await page.evaluate(() => {
        const raw = window.localStorage.getItem('forge.v4.pdmRevisions');
        return raw ? JSON.parse(raw) : null;
    });
    expect(persisted).toEqual({ current: '1.0.0', history: [] });
});

test('01 — open Revisions panel via tools.pdmRevisions menu action', async () => {
    await cameraTo('front');

    await platformMenuAction('tools.pdmRevisions');
    await page.waitForSelector('[data-testid="forge-pdm-revisions-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const panel = page.locator('[data-testid="forge-pdm-revisions-panel"]');
    expect(await panel.getAttribute('data-current')).toBe('1.0.0');
    expect(await panel.getAttribute('data-history-count')).toBe('0');

    // Current version chip reads `v1.0.0`.
    const chipText = (await page.locator(
        '[data-testid="forge-pdm-revisions-current"]').innerText()).trim();
    expect(chipText).toBe('v1.0.0');

    // Empty-state shown (no history rows).
    await expect(page.locator(
        '[data-testid="forge-pdm-revisions-empty"]')).toBeVisible();
    expect(await page.locator(
        '[data-testid="forge-pdm-revisions-row"]').count()).toBe(0);

    // All three bump buttons + the ECN form fields are present.
    await expect(page.locator(
        '[data-testid="forge-pdm-revisions-bump-major"]')).toBeVisible();
    await expect(page.locator(
        '[data-testid="forge-pdm-revisions-bump-minor"]')).toBeVisible();
    await expect(page.locator(
        '[data-testid="forge-pdm-revisions-bump-patch"]')).toBeVisible();
    await expect(page.locator(
        '[data-testid="forge-pdm-revisions-ecn"]')).toBeVisible();
    await expect(page.locator(
        '[data-testid="forge-pdm-revisions-desc"]')).toBeVisible();
});

test('02 — +Minor with ECN-1001 "Fix tolerance" → current = 1.1.0, history.length = 1', async () => {
    // Fill the ECN id + description.
    await page.locator('[data-testid="forge-pdm-revisions-ecn"]').fill('ECN-1001');
    await page.locator('[data-testid="forge-pdm-revisions-desc"]').fill('Fix tolerance');
    await pause(200);

    // Click +Minor.
    await page.locator('[data-testid="forge-pdm-revisions-bump-minor"]').click();
    await page.waitForFunction(
        () => window.__forgePdmRevisions?.current === '1.1.0'
           && Array.isArray(window.__forgePdmRevisions?.history)
           && window.__forgePdmRevisions.history.length === 1,
        null, { timeout: 6000 });
    await shot('after-minor');

    // The brief's contract: current = '1.1.0' on window AND on the DOM.
    const snapshot = await page.evaluate(() => window.__forgePdmRevisions);
    console.log('[push-100] after +Minor =', JSON.stringify(snapshot));
    expect(snapshot.current).toBe('1.1.0');
    expect(snapshot.history.length).toBe(1);

    const entry = snapshot.history[0];
    expect(entry.from).toBe('1.0.0');
    expect(entry.to).toBe('1.1.0');
    expect(entry.kind).toBe('minor');
    expect(entry.ecn).toBe('ECN-1001');
    expect(entry.desc).toBe('Fix tolerance');
    expect(Number.isFinite(entry.ts)).toBe(true);
    expect(entry.ts).toBeGreaterThan(0);

    // The panel's data attribute mirrors '1.1.0' + history-count '1'.
    const panel = page.locator('[data-testid="forge-pdm-revisions-panel"]');
    expect(await panel.getAttribute('data-current')).toBe('1.1.0');
    expect(await panel.getAttribute('data-history-count')).toBe('1');

    // The current version chip reads `v1.1.0`.
    const chipText = (await page.locator(
        '[data-testid="forge-pdm-revisions-current"]').innerText()).trim();
    expect(chipText).toBe('v1.1.0');

    // History table has one row.
    const rows = page.locator('[data-testid="forge-pdm-revisions-row"]');
    expect(await rows.count()).toBe(1);
    const firstRow = rows.first();
    expect(await firstRow.getAttribute('data-from')).toBe('1.0.0');
    expect(await firstRow.getAttribute('data-to')).toBe('1.1.0');
    expect(await firstRow.getAttribute('data-kind')).toBe('minor');
    expect(await firstRow.getAttribute('data-ecn')).toBe('ECN-1001');
    expect(await firstRow.getAttribute('data-desc')).toBe('Fix tolerance');

    // The ECN form was cleared on submit.
    expect(await page.locator(
        '[data-testid="forge-pdm-revisions-ecn"]').inputValue()).toBe('');
    expect(await page.locator(
        '[data-testid="forge-pdm-revisions-desc"]').inputValue()).toBe('');
});

test('03 — +Patch then +Major exercise the SemVer reset rules', async () => {
    await cameraTo('top');

    // +Patch with no ECN: 1.1.0 → 1.1.1, history length 2.
    await page.locator('[data-testid="forge-pdm-revisions-bump-patch"]').click();
    await page.waitForFunction(
        () => window.__forgePdmRevisions?.current === '1.1.1'
           && window.__forgePdmRevisions.history.length === 2,
        null, { timeout: 6000 });
    await shot('after-patch');

    // +Major with no ECN: 1.1.1 → 2.0.0 (minor + patch zeroed).
    await page.locator('[data-testid="forge-pdm-revisions-bump-major"]').click();
    await page.waitForFunction(
        () => window.__forgePdmRevisions?.current === '2.0.0'
           && window.__forgePdmRevisions.history.length === 3,
        null, { timeout: 6000 });
    await shot('after-major');

    const snapshot = await page.evaluate(() => window.__forgePdmRevisions);
    console.log('[push-100] after +Patch +Major =', JSON.stringify(snapshot));
    expect(snapshot.current).toBe('2.0.0');
    expect(snapshot.history.length).toBe(3);

    // Timestamps strictly monotonic (CI on a single clock).
    const ts = snapshot.history.map((h) => h.ts);
    expect(ts[1]).toBeGreaterThanOrEqual(ts[0]);
    expect(ts[2]).toBeGreaterThanOrEqual(ts[1]);

    // Each entry has the right (from, to, kind).
    expect(snapshot.history[0]).toMatchObject({ from: '1.0.0', to: '1.1.0', kind: 'minor', ecn: 'ECN-1001', desc: 'Fix tolerance' });
    expect(snapshot.history[1]).toMatchObject({ from: '1.1.0', to: '1.1.1', kind: 'patch', ecn: '', desc: '' });
    expect(snapshot.history[2]).toMatchObject({ from: '1.1.1', to: '2.0.0', kind: 'major', ecn: '', desc: '' });

    // History table has three rows; reverse-chronological (newest at top).
    const rows = page.locator('[data-testid="forge-pdm-revisions-row"]');
    expect(await rows.count()).toBe(3);
    expect(await rows.nth(0).getAttribute('data-to')).toBe('2.0.0');
    expect(await rows.nth(1).getAttribute('data-to')).toBe('1.1.1');
    expect(await rows.nth(2).getAttribute('data-to')).toBe('1.1.0');
});

test('04 — localStorage round-trip + headless bump from window helper', async () => {
    await cameraTo('right');

    // Round-trip persistence: localStorage matches window.
    const persisted = await page.evaluate(() => {
        const raw = window.localStorage.getItem('forge.v4.pdmRevisions');
        return raw ? JSON.parse(raw) : null;
    });
    expect(persisted).not.toBeNull();
    expect(persisted.current).toBe('2.0.0');
    expect(persisted.history.length).toBe(3);
    // Mirror matches.
    const snapshot = await page.evaluate(() => window.__forgePdmRevisions);
    expect(persisted.current).toBe(snapshot.current);
    expect(persisted.history.length).toBe(snapshot.history.length);

    // Headless bump via window.__forgePdmRevisionsBump — exercises the
    // exact same code path as the click handler. 2.0.0 → 2.1.0.
    const result = await page.evaluate(() => window.__forgePdmRevisionsBump('minor', {
        ecn: 'ECN-1002', desc: 'Headless fix',
    }));
    console.log('[push-100] headless bump =', JSON.stringify(result));
    expect(result.current).toBe('2.1.0');
    expect(result.history.length).toBe(4);

    // The panel re-renders only when the React `setState` is called —
    // headless bumps bypass React, so the data-current attribute lags
    // by design until the next open. The localStorage + window mirror
    // are the load-bearing contract for headless callers; assert those.
    const after = await page.evaluate(() => ({
        win: window.__forgePdmRevisions,
        ls: JSON.parse(window.localStorage.getItem('forge.v4.pdmRevisions') || 'null'),
    }));
    expect(after.win.current).toBe('2.1.0');
    expect(after.ls.current).toBe('2.1.0');
    expect(after.win.history.length).toBe(4);
    expect(after.ls.history.length).toBe(4);
    expect(after.win.history[3]).toMatchObject({
        from: '2.0.0', to: '2.1.0', kind: 'minor',
        ecn: 'ECN-1002', desc: 'Headless fix',
    });

    await shot('after-headless');
});

test('05 — PUSH-51 regression: PDM Vault still opens alongside the Revisions panel', async () => {
    await cameraTo('iso');

    // PUSH-51 regression: opening the real PDM Vault via tools.pdmvault
    // must still mount its panel. Revisions is a portal sibling — it
    // must not collide with the vault.
    await platformMenuAction('tools.pdmvault');
    await page.waitForSelector('[data-testid="forge-pdm-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('vault-coexists');

    // Both panels are open + visible (different right-docked slots).
    const vaultVisible = await page.locator(
        '[data-testid="forge-pdm-panel"]').isVisible();
    expect(vaultVisible).toBe(true);
    const revVisible = await page.locator(
        '[data-testid="forge-pdm-revisions-panel"]').isVisible();
    expect(revVisible).toBe(true);

    // The Revisions store is still intact (PDM Vault didn't clobber it).
    const stillIntact = await page.evaluate(() => {
        const s = window.__forgePdmRevisions || {};
        return s.current === '2.1.0' && Array.isArray(s.history) && s.history.length === 4;
    });
    expect(stillIntact).toBe(true);

    await shot('final');
});
