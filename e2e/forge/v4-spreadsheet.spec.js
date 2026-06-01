// v4-spreadsheet.spec.js — Forge-153: parametric spreadsheet workbench.
//
// HUMAN-STYLE click-only walk-through in a HEADED Mac-Electron session:
//
//   1. Open Tools → Spreadsheet… and confirm the grid mounts.
//   2. Enter =SUM(1,2,3) in A1; assert the cell displays 6.
//   3. Enter =A1*2 in B1; assert the cell displays 12.
//   4. Edit A1 = 5; assert B1 updates to 10 (dependency cascade works).
//   5. Bind cell B2 to a name 'my_width' and verify Equation Manager
//      sees it as a solvable variable.
//   6. Close the panel; confirm Archie thread was not touched by any
//      manual UI clicks.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-spreadsheet';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Watchable pace — the user is remote-watching this run on a Windows
// box driving the Mac Studio over RDP. Headed Electron is mandatory.
async function watchable(page, ms = 350) {
  await page.waitForTimeout(ms);
}

// Type a value into the selected cell via the formula bar (the formula
// bar acts as an always-mounted editor for the active cell, so this
// works without first double-clicking the cell).
async function setCellViaFormulaBar(page, cellId, raw) {
  // First select the target cell by clicking it (mousedown).
  const cell = page.locator(`[data-testid="forge-ss-cell-${cellId}"]`);
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page.locator('[data-testid="forge-ss-selected-id"]')).toHaveText(cellId);

  // Now drive the formula bar — clear, type the value, press Enter to
  // commit + advance.
  const bar = page.locator('[data-testid="forge-ss-formula-bar"]');
  await bar.click();
  await bar.fill('');
  await bar.type(String(raw), { delay: 12 });
  await page.keyboard.press('Enter');
  await watchable(page, 250);
}

async function readCellText(page, cellId) {
  const cell = page.locator(`[data-testid="forge-ss-cell-${cellId}"]`);
  return (await cell.innerText()).trim();
}

async function clickToolsMenuItem(page, labelRegex) {
  await page.click('button[data-menu="tools"]');
  const menu = page.locator('[data-testid="forge-menu-tools"]');
  await expect(menu).toBeVisible({ timeout: 3000 });
  const item = menu.locator('button', { hasText: labelRegex }).first();
  await expect(item).toBeVisible();
  await item.click();
}

test.describe('Forge v4 · Spreadsheet workbench', () => {
  let app, page;
  const consoleErrors = [];

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        if (/forge-v4|spreadsheet|sheet|equation/i.test(txt)) {
          consoleErrors.push(`console.error: ${txt}`);
        }
      }
    });
    await page.waitForLoadState('domcontentloaded');
    // Wait for the spreadsheet host to register its open hook before
    // we begin clicking into the menu.
    await page.waitForFunction(
      () => typeof window.__forgeOpenSpreadsheet === 'function',
      null, { timeout: 10_000 });
    // Hermetic — wipe any prior spreadsheet state and reload once.
    await page.evaluate(() => {
      try { localStorage.removeItem('forge.v4.spreadsheet'); } catch {}
      try { localStorage.removeItem('forge.v4.equations');   } catch {}
    });
    await page.reload();
    await page.waitForFunction(
      () => typeof window.__forgeOpenSpreadsheet === 'function',
      null, { timeout: 10_000 });
    await watchable(page, 600);
    await shot(page, 'initial');
  });

  test.afterAll(async () => {
    if (consoleErrors.length) {
      console.error('Captured renderer errors:\n' + consoleErrors.join('\n'));
    }
    if (app) await app.close();
  });

  // ────────────────────────────────────────────────────────────────
  // 01 — Open the workbench via Tools menu.
  // ────────────────────────────────────────────────────────────────
  test('01 open Tools menu and click Spreadsheet…', async () => {
    await clickToolsMenuItem(page, /Spreadsheet/i);
    const panel = page.locator('[data-testid="forge-spreadsheet"]');
    await expect(panel).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-testid="forge-ss-grid"]')).toBeVisible();
    await watchable(page, 350);
    await shot(page, 'sheet-open');
  });

  // ────────────────────────────────────────────────────────────────
  // 02 — =SUM(1,2,3) in A1 → 6.
  // ────────────────────────────────────────────────────────────────
  test('02 enter =SUM(1,2,3) in A1; cell displays 6', async () => {
    await setCellViaFormulaBar(page, 'A1', '=SUM(1,2,3)');
    const txt = await readCellText(page, 'A1');
    expect(txt).toBe('6');
    await shot(page, 'A1-sum');
  });

  // ────────────────────────────────────────────────────────────────
  // 03 — =A1*2 in B1 → 12.
  // ────────────────────────────────────────────────────────────────
  test('03 enter =A1*2 in B1; cell displays 12', async () => {
    await setCellViaFormulaBar(page, 'B1', '=A1*2');
    const txt = await readCellText(page, 'B1');
    expect(txt).toBe('12');
    await shot(page, 'B1-times2');
  });

  // ────────────────────────────────────────────────────────────────
  // 04 — Edit A1 = 5 → B1 cascades to 10.
  // ────────────────────────────────────────────────────────────────
  test('04 edit A1 = 5; B1 cascades to 10', async () => {
    await setCellViaFormulaBar(page, 'A1', '5');
    expect(await readCellText(page, 'A1')).toBe('5');
    // Give React one frame to commit before we check the dependent.
    await watchable(page, 250);
    expect(await readCellText(page, 'B1')).toBe('10');
    await shot(page, 'A1-five-B1-ten');
  });

  // ────────────────────────────────────────────────────────────────
  // 05 — Bind B2 = 'my_width' = 25 → EquationManager sees it.
  // ────────────────────────────────────────────────────────────────
  test('05 bind B2 to my_width, read it from Equation Manager', async () => {
    // Set B2 to a literal numeric value first.
    await setCellViaFormulaBar(page, 'B2', '25');
    expect(await readCellText(page, 'B2')).toBe('25');

    // Select B2 and type a binding name; press Commit.
    await page.locator('[data-testid="forge-ss-cell-B2"]').click();
    await expect(page.locator('[data-testid="forge-ss-selected-id"]')).toHaveText('B2');

    const bindInput = page.locator('[data-testid="forge-ss-binding-input"]');
    await bindInput.click();
    await bindInput.fill('');
    await bindInput.type('my_width', { delay: 12 });
    await page.click('[data-testid="forge-ss-binding-commit"]');
    await watchable(page, 350);

    // Confirm the cell decoration shows the binding badge.
    await expect(page.locator('[data-testid="forge-ss-cell-B2"]'))
      .toHaveAttribute('data-cell-binding', 'my_width');
    await shot(page, 'B2-bound');

    // Close the workbench and open Equation Manager.
    await page.click('[data-testid="forge-spreadsheet-close"]');
    await expect(page.locator('[data-testid="forge-spreadsheet"]')).toHaveCount(0);

    await clickToolsMenuItem(page, /Equation Manager/i);
    const eqModal = page.locator('[data-testid="forge-equations"]');
    await expect(eqModal).toBeVisible({ timeout: 3000 });

    // Add a new variable in the Equation Manager that references
    // my_width — the Evaluates-to column must read 50 (25 * 2).
    await page.click('button:has-text("+ Add variable")');
    const rows = eqModal.locator('tbody tr');
    const last = rows.last();
    const idInput = last.locator('td').nth(0).locator('input');
    const exprInput = last.locator('td').nth(1).locator('input');
    await idInput.fill('SHEET_TEST');
    await exprInput.fill('my_width*2');
    await watchable(page, 350);
    const evalCol = last.locator('td').nth(3);
    await expect(evalCol).toContainText('50');
    await shot(page, 'eqmgr-reads-binding');

    // Close the equation manager.
    await page.click('button:has-text("Done")');
  });

  // ────────────────────────────────────────────────────────────────
  // 06 — Manual UI must never write to Archie's thread.
  // ────────────────────────────────────────────────────────────────
  test('06 manual spreadsheet clicks do not write Archie thread', async () => {
    const archieThread = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('forge.v4.archieThread');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
    if (archieThread && Array.isArray(archieThread)) {
      const offending = archieThread.filter((m) =>
        typeof m === 'object' && /tools\.spreadsheet|setCell|bindCellName/i.test(
          JSON.stringify(m)));
      expect(offending,
        `Archie thread contains spreadsheet mentions: ${JSON.stringify(offending)}`)
        .toEqual([]);
    } else {
      expect(archieThread === null || archieThread === undefined ||
             (Array.isArray(archieThread) && archieThread.length === 0)).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // 07 — No uncaught renderer errors during the run.
  // ────────────────────────────────────────────────────────────────
  test('07 no uncaught renderer errors', async () => {
    expect(consoleErrors,
           `Renderer errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
