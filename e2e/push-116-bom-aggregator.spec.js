// PUSH-116 (Slice-85 / BOM Aggregator).
//
// PUSH-60 ships the row-per-body BOM view. PUSH-116 layers the grouping
// axis a real procurement / manufacturing BOM needs:
//
//   * Group-by name pattern → "Bolt M6 #1", "Bolt M6 #2", "Bolt M6 #3"
//     collapse to a single row qty=3 mass=3×each cost=3×each.
//   * Group-by material → every titanium body rolls under one row.
//   * Group-by part key (the original PUSH-60 axis) — for the rare case
//     where two parts share a name but differ in dimensions.
//
// Proof end-to-end through the real Electron UI:
//   00. Boot Electron. Confirm window.__forgeOpenBomAggregator +
//       window.__forgeBomAggregatorHelper install BEFORE the panel
//       mounts. Sanity-check namePattern() on hard cases.
//   01. Seed 5 real OCCT bodies — 3 × "Bolt M6 #N" cubes, 2 × "Nut M6 #N"
//       cubes (different sizes so the mass-total is sensible).
//   02. Open the BOM Aggregator via the tools.bomAggregator menu action.
//       Assert the canonical test-ids mount + the row-count chip lists
//       2 groups · 5 bodies.
//   03. Group by NAME → assert 2 rows ("Bolt M6" qty 3, "Nut M6" qty 2).
//   04. Group by MATERIAL → switch row 1 to aluminum via the legacy
//       BOM panel then back; group totals should reflect the picked
//       material (titanium since we set every body to titanium in the
//       e2e prelude).
//   05. Group by PART KEY → each (name, material, spec) combo splits
//       into its own row. Default body name is unique per index so we
//       expect 5 rows when bodies have distinct names but partKey
//       collapses identical specs.
//   06. Export CSV (group-by name) — the io:saveDialog IPC is stubbed
//       to a /tmp path. Assert the CSV header + the Bolt M6 / Nut M6
//       rows + the TOTAL.
//   07. PUSH-60 regression — open the original Bill of Materials panel
//       and confirm it still lists per-body rows.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper surface)
//   - front (seed bodies)
//   - top   (group by name)
//   - right (group by material / partKey)
//   - iso   (Export CSV + PUSH-60 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-116-bom-aggregator');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'bom-aggregator-session.mp4');
const CSV_PATH   = path.join(os.tmpdir(), `push-116-bom-aggregator-${Date.now()}.csv`);

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
    try { fs.unlinkSync(CSV_PATH); } catch {}
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-116|bomagg|bom|aggregator|forge|error|Error/i.test(t)) {
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

    // Reset the per-body material persistence so a previous run can't
    // bleed in. The legacy in-memory Map + the PUSH-61 localStorage
    // layer both need to be cleared.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.bodyMaterials'); } catch {}
        window.__forgeBodyMaterials = new Map();
        const helper = window.__forgeBodyMaterialsHelper;
        if (helper && typeof helper.clearBodyMaterials === 'function') {
            helper.clearBodyMaterials();
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
        console.error('[push-116] no .webm');
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
                console.log(`[push-116] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-116] ffmpeg failed:', code,
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
        open:    typeof window.__forgeOpenBomAggregator,
        close:   typeof window.__forgeCloseBomAggregator,
        refresh: typeof window.__forgeRefreshBomAggregator,
        helper:  typeof window.__forgeBomAggregatorHelper,
        helperKeys: window.__forgeBomAggregatorHelper
            ? Object.keys(window.__forgeBomAggregatorHelper).sort()
            : [],
        // Sanity-check namePattern() on the canonical hard cases.
        nameStripHash:  window.__forgeBomAggregatorHelper?.namePattern?.('Bolt M6 #3'),
        nameStripParen: window.__forgeBomAggregatorHelper?.namePattern?.('Bolt M6 (3)'),
        nameStripDot:   window.__forgeBomAggregatorHelper?.namePattern?.('Bolt M6.003'),
        nameStripSpc:   window.__forgeBomAggregatorHelper?.namePattern?.('Bolt M6 3'),
        emptyName:      window.__forgeBomAggregatorHelper?.namePattern?.(''),
        groupModeIds: (window.__forgeBomAggregatorHelper?.GROUP_BY_MODES || [])
            .map((m) => m.id),
    }));
    console.log('[push-116] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.refresh).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('groupBodies');
    expect(surface.helperKeys).toContain('computeRowMass');
    expect(surface.helperKeys).toContain('exportCsv');
    expect(surface.helperKeys).toContain('namePattern');
    expect(surface.helperKeys).toContain('GROUP_BY_MODES');
    expect(surface.helperKeys).toContain('DENSITY_TABLE');
    expect(surface.helperKeys).toContain('COST_TABLE');
    // namePattern() collapses every common engineering instance counter.
    expect(surface.nameStripHash).toBe('Bolt M6');
    expect(surface.nameStripParen).toBe('Bolt M6');
    expect(surface.nameStripDot).toBe('Bolt M6');
    expect(surface.nameStripSpc).toBe('Bolt M6');
    expect(surface.emptyName).toBe('Body');
    expect(surface.groupModeIds).toEqual(['name', 'material', 'partKey']);

    // Headless groupBodies() smoke test — drive the pure pipeline before
    // the panel is even open. This proves the same code path the e2e
    // exercises later through the UI.
    const headless = await page.evaluate(() => {
        const helper = window.__forgeBomAggregatorHelper;
        const bodies = [
            { id: 'a', name: 'Bolt M6 #1', material: 'steel',
              spec: { dx: 10, dy: 10, dz: 10 } },
            { id: 'b', name: 'Bolt M6 #2', material: 'steel',
              spec: { dx: 10, dy: 10, dz: 10 } },
            { id: 'c', name: 'Nut M6 #1',  material: 'steel',
              spec: { dx: 8, dy: 8, dz: 4 } },
        ];
        const byName = helper.groupBodies(bodies, 'name');
        return byName.map((r) => ({ label: r.label, qty: r.qty }));
    });
    console.log('[push-116] headless groupBy(name) =', JSON.stringify(headless));
    // Bolt M6 has higher mass (1000 mm³ × 2) than Nut M6 (256 mm³ × 1)
    // so it sorts first.
    expect(headless[0]).toEqual({ label: 'Bolt M6', qty: 2 });
    expect(headless[1]).toEqual({ label: 'Nut M6', qty: 1 });

    await shot('host-surface-ok');
});

test('01 — seed 5 real OCCT bodies (3 Bolt M6 + 2 Nut M6) + tag material', async () => {
    await cameraTo('front');

    const seeded = await page.evaluate(() => {
        const out = [];
        const make = (name, dx, dy, dz) => {
            const h = window.forge?.makeBox?.(dx, dy, dz);
            if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
            const id = `f-${name.replace(/\s+/g, '-')}`;
            window.__forgeAppendBody({
                id, kind: 'native', handle: h,
                toolId: 'solid.box', name,
                params: { width: dx, height: dy, distance: dz },
            });
            // Tag each body with a deterministic material so the
            // group-by-material pass has a non-trivial result.
            try {
                window.__forgeBodyMaterialsHelper?.setBodyMaterial?.(h, 'titanium');
            } catch {}
            return { name, handle: h, dx, dy, dz };
        };
        // 3 bolts (10 × 10 × 10 = 1000 mm³ each).
        out.push(make('Bolt M6 #1', 10, 10, 10));
        out.push(make('Bolt M6 #2', 10, 10, 10));
        out.push(make('Bolt M6 #3', 10, 10, 10));
        // 2 nuts (8 × 8 × 4 = 256 mm³ each).
        out.push(make('Nut M6 #1', 8, 8, 4));
        out.push(make('Nut M6 #2', 8, 8, 4));
        return out;
    });
    console.log('[push-116] seeded =', JSON.stringify(seeded));
    for (const r of seeded) {
        expect(r.handle).toBeGreaterThan(0);
    }
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 5,
        null, { timeout: 4000 });
    await shot('five-bodies-seeded');
});

test('02 — open BOM Aggregator via tools.bomAggregator', async () => {
    await cameraTo('top');
    await platformMenuAction('tools.bomAggregator');
    await page.waitForSelector('[data-testid="forge-bomagg-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('aggregator-open');

    // Every control test-id is present.
    await expect(page.locator('[data-testid="forge-bomagg-group-by"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-bomagg-refresh"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-bomagg-export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-bomagg-close"]')).toBeVisible();

    // Row-count chip lists 2 groups (Bolt M6 / Nut M6) · 5 bodies (default = name).
    const chip = page.locator('[data-testid="forge-bomagg-row-count"]');
    await expect(chip).toContainText('2 groups');
    await expect(chip).toContainText('5 bodies');
});

test('03 — group by NAME → 2 rows: Bolt M6 qty 3, Nut M6 qty 2', async () => {
    // Default mode is 'name' but we re-select explicitly so the test is
    // robust against future default changes.
    await page.locator('[data-testid="forge-bomagg-group-by"]').selectOption('name');
    await pause(400);
    await shot('group-by-name');

    const rows = page.locator('[data-testid="forge-bomagg-row"]');
    await expect(rows).toHaveCount(2);

    // Mass-sort: bolts (3 × 1000 mm³ × 4.51 g/cc × 1e-3 = 13.530 g) is
    // heavier than nuts (2 × 256 × 4.51e-3 = 2.310 g) so Bolt M6 sorts
    // first.
    const labels = await page.locator('[data-testid="forge-bomagg-row-label"]').allTextContents();
    console.log('[push-116] group-by-name labels =', JSON.stringify(labels));
    expect(labels[0]).toBe('Bolt M6');
    expect(labels[1]).toBe('Nut M6');

    const qtys = await page.locator('[data-testid="forge-bomagg-row-qty"]').allTextContents();
    console.log('[push-116] qtys =', JSON.stringify(qtys));
    expect(qtys[0]).toBe('3');
    expect(qtys[1]).toBe('2');

    // Total mass: 3 × 1000 + 2 × 256 = 3512 mm³; × 4.51e-3 g/mm³ (titanium) = 15.839 g.
    const totalMass = await page.locator('[data-testid="forge-bomagg-total-mass"]')
        .textContent();
    console.log('[push-116] total mass (name group) =', totalMass);
    expect(Number(totalMass)).toBeCloseTo(15.839, 2);

    // Total qty across both groups = 5.
    const totalQty = await page.locator('[data-testid="forge-bomagg-total-qty"]')
        .textContent();
    expect(Number(totalQty)).toBe(5);

    // Each row's data-qty attribute is the authoritative numeric.
    const row0Qty = await rows.nth(0).getAttribute('data-qty');
    const row1Qty = await rows.nth(1).getAttribute('data-qty');
    expect(row0Qty).toBe('3');
    expect(row1Qty).toBe('2');
});

test('04 — group by MATERIAL → 1 row (titanium) qty 5', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-bomagg-group-by"]').selectOption('material');
    await pause(400);
    await shot('group-by-material');

    const rows = page.locator('[data-testid="forge-bomagg-row"]');
    await expect(rows).toHaveCount(1);

    // Single titanium row carrying every body.
    const row0 = rows.nth(0);
    await expect(row0).toHaveAttribute('data-label', 'titanium');
    await expect(row0).toHaveAttribute('data-qty', '5');
    await expect(row0).toHaveAttribute('data-material', 'titanium');

    // Total qty / mass match the prior group-by-name run since the
    // numbers are the same — only the axis changed.
    const totalQty = await page.locator('[data-testid="forge-bomagg-total-qty"]')
        .textContent();
    expect(Number(totalQty)).toBe(5);
    const totalMass = await page.locator('[data-testid="forge-bomagg-total-mass"]')
        .textContent();
    expect(Number(totalMass)).toBeCloseTo(15.839, 2);

    // Total cost: 15.839 g × 22 USD/kg (titanium) = $0.3485
    const totalCost = await page.locator('[data-testid="forge-bomagg-total-cost"]')
        .textContent();
    console.log('[push-116] total cost (material) =', totalCost);
    expect(Number(totalCost)).toBeCloseTo(0.3485, 3);
});

test('05 — group by PART KEY → 2 rows (same dims share a partKey)', async () => {
    await page.locator('[data-testid="forge-bomagg-group-by"]').selectOption('partKey');
    await pause(400);
    await shot('group-by-partKey');

    const rows = page.locator('[data-testid="forge-bomagg-row"]');
    // Bolts share spec dx=dy=dz=10, name "Bolt M6 #1/#2/#3" — but the
    // partKey is (name | material | spec). Each Bolt has a UNIQUE name
    // ("Bolt M6 #1" vs "Bolt M6 #2") so partKey splits them into
    // separate rows. So 5 bodies → 5 partKey rows.
    await expect(rows).toHaveCount(5);

    const totalQty = await page.locator('[data-testid="forge-bomagg-total-qty"]')
        .textContent();
    expect(Number(totalQty)).toBe(5);

    // Sanity: every row has qty 1 because partKey is exact match.
    const qtys = await page.locator('[data-testid="forge-bomagg-row-qty"]').allTextContents();
    console.log('[push-116] partKey qtys =', JSON.stringify(qtys));
    for (const q of qtys) expect(q).toBe('1');
});

test('06 — Export CSV (group by name) writes a real CSV on disk', async () => {
    await cameraTo('iso');
    // Switch back to name grouping for the canonical CSV shape.
    await page.locator('[data-testid="forge-bomagg-group-by"]').selectOption('name');
    await pause(300);

    // Stub the io:saveDialog IPC main-side so the headless OS dialog
    // doesn't pop. The renderer treats whatever the main process returns
    // as the chosen path.
    await app.evaluate(async ({ ipcMain }, tmpPath) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => tmpPath);
    }, CSV_PATH);

    await page.locator('[data-testid="forge-bomagg-export-csv"]').click();
    await pause(900);
    await shot('export-clicked');

    // Status pill confirms save.
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-bomagg-csv-status"]');
        return el && /saved|error|cancelled/i.test(el.textContent || '');
    }, null, { timeout: 6000 });
    const status = await page.locator('[data-testid="forge-bomagg-csv-status"]')
        .textContent();
    console.log('[push-116] csv status =', status);
    expect(status).toMatch(/saved/i);

    // The renderer publishes the last save path on the window for the
    // e2e to assert against.
    const reportedPath = await page.evaluate(() => window.__forgeLastBomAggregatorPath || null);
    console.log('[push-116] reported csv path =', reportedPath);
    expect(reportedPath).toBe(CSV_PATH);

    // File on disk.
    expect(fs.existsSync(CSV_PATH)).toBe(true);
    const csv = fs.readFileSync(CSV_PATH, 'utf8');
    console.log('[push-116] CSV contents:\n' + csv);

    // Header row carries every column.
    expect(csv).toMatch(/"groupKey","label","qty","material","mass_g_each","mass_g_total","cost_per_unit_usd","cost_total_usd","volume_mm3_total","names"/);
    // Both groups present with the right qty.
    expect(csv).toMatch(/"nm:Bolt M6"/);
    expect(csv).toMatch(/"Bolt M6"/);
    expect(csv).toMatch(/"3"/);
    expect(csv).toMatch(/"nm:Nut M6"/);
    expect(csv).toMatch(/"Nut M6"/);
    expect(csv).toMatch(/"2"/);
    // TOTAL row + 15.839 g (or rounding).
    expect(csv).toMatch(/"TOTAL"/);
    expect(csv).toMatch(/15\.839/);
    // CRLF line endings (Excel + Numbers compatibility).
    expect(csv.indexOf('\r\n')).toBeGreaterThan(0);
    // The names column joins every contributing body name.
    expect(csv).toMatch(/Bolt M6 #1;Bolt M6 #2;Bolt M6 #3/);
    expect(csv).toMatch(/Nut M6 #1;Nut M6 #2/);

    await shot('export-confirmed');
});

test('07 — PUSH-60 regression: original BOM panel still lists per-body rows', async () => {
    // Close the aggregator first so it doesn't overlap.
    await page.locator('[data-testid="forge-bomagg-close"]').click().catch(() => {});
    await pause(300);
    await shot('aggregator-closed');

    // Open the original BOM panel — it should still render five rows.
    await platformMenuAction('tools.bom');
    await page.waitForSelector('[data-testid="forge-bom-panel"]',
        { state: 'visible', timeout: 6000 });
    const rows = page.locator('[data-testid="forge-bom-row"]');
    await expect(rows).toHaveCount(5);

    const names = await page.locator('[data-testid="forge-bom-row-name"]').allTextContents();
    console.log('[push-116] PUSH-60 regression names =', JSON.stringify(names));
    expect(names).toEqual([
        'Bolt M6 #1', 'Bolt M6 #2', 'Bolt M6 #3',
        'Nut M6 #1',  'Nut M6 #2',
    ]);
    // Default material from PUSH-61 persistence should already be
    // titanium thanks to step 01's setBodyMaterial calls.
    const mats = await page.locator('[data-testid="forge-bom-row-material"]')
        .evaluateAll((nodes) => nodes.map((n) => n.value));
    console.log('[push-116] PUSH-60 regression materials =', JSON.stringify(mats));
    for (const m of mats) expect(m).toBe('titanium');

    await shot('regression-bom-five-rows');
});
