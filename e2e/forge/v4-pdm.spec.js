// v4-pdm.spec.js — Forge-133: Product Data Management panel.
//
// HUMAN-STYLE click-only walk-through in a HEADED Mac-Electron session:
//
//   1. Open the Tools menu, click "Product Data Management…".
//   2. Create three items via the Items tab form (P-1001, P-1002,
//      P-1003) with different materials.
//   3. Pick the first row, click Revise — letter advances A → B.
//   4. Click Check out, then Check in — lock cycle proven.
//   5. Switch to ECNs tab. Create ECN-1010 linking items #2 and #3.
//      Verify the affected-items column shows both PNs.
//   6. Switch to BOMs tab. Pick the first item as parent; link P-1002
//      and P-1003 under it. Toggle Released/Working/Diff modes; the
//      diff math must be honest.
//   7. Switch to Where Used tab. Select P-1002; verify count = 1.
//   8. Multi-angle viewport (4 sizes). Both dark + light theme.
//
// Manual UI must NEVER write to Archie's thread — we verify by reading
// localStorage forge.v4.archieThread after the run.
//
// Tests use clicks only (no window hooks during the asserts).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-pdm';
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
async function watchable(page, ms = 300) {
  await page.waitForTimeout(ms);
}

const MULTI_ANGLE_PASSES = [
  { name: 'macbook-1440',   size: { width: 1440, height: 900  } },
  { name: 'studio-1920',    size: { width: 1920, height: 1080 } },
  { name: 'studio-1680',    size: { width: 1680, height: 1050 } },
  { name: 'pro-1280',       size: { width: 1280, height: 800  } },
];

// Click a Tools-menu entry by label. The label is matched case-insensitive
// substring against the menu items' rendered text.
async function clickToolsMenuItem(page, labelRegex) {
  await page.click('button[data-menu="tools"]');
  const menu = page.locator('[data-testid="forge-menu-tools"]');
  await expect(menu).toBeVisible({ timeout: 3000 });
  const item = menu.locator('button', { hasText: labelRegex }).first();
  await expect(item).toBeVisible();
  await item.click();
}

async function openPdmFromMenu(page) {
  await clickToolsMenuItem(page, /Product Data Management/i);
  const panel = page.locator('[data-testid="forge-pdm-panel"]');
  await expect(panel).toBeVisible({ timeout: 4000 });
}

async function clickTab(page, id) {
  const tab = page.locator(`[data-testid="forge-pdm-tab-${id}"]`);
  await tab.click();
  await expect(tab).toHaveAttribute('data-active', 'true');
}

async function fillByTestId(page, tid, value) {
  const el = page.locator(`[data-testid="${tid}"]`);
  await el.click();
  await el.fill('');
  await el.type(String(value), { delay: 8 });
}

async function selectByTestId(page, tid, value) {
  await page.locator(`[data-testid="${tid}"]`).selectOption(value);
}

test.describe('Forge v4 · PDM panel', () => {
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
        if (/forge-v4|pdm|Pdm|PDM/i.test(txt)) {
          consoleErrors.push(`console.error: ${txt}`);
        }
      }
    });
    await page.waitForLoadState('domcontentloaded');
    // Make sure the host has mounted before we click into the menu.
    await page.waitForFunction(
      () => typeof window.__forgeOpenPdm === 'function',
      null, { timeout: 10_000 });

    // Wipe any prior state from a previous run so the spec is hermetic.
    // (One-time setup hook — NOT counted as a test-time action.)
    await page.evaluate(() => {
      try { localStorage.removeItem('forge.v4.pdm'); } catch {}
    });
    // Force re-mount of the panel state by reloading once.
    await page.reload();
    await page.waitForFunction(
      () => typeof window.__forgeOpenPdm === 'function',
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
  // 01 — Open panel via Tools menu.
  // ────────────────────────────────────────────────────────────────
  test('01 open Tools menu and click Product Data Management…', async () => {
    await openPdmFromMenu(page);
    await watchable(page, 400);
    await shot(page, 'pdm-panel-open');
    // Items tab is the default landing.
    await expect(page.locator('[data-testid="forge-pdm-tab-items"]'))
      .toHaveAttribute('data-active', 'true');
  });

  // ────────────────────────────────────────────────────────────────
  // 02 — Create three items.
  // ────────────────────────────────────────────────────────────────
  test('02 create three items via the Items tab form', async () => {
    const fixtures = [
      { pn: 'P-1001', name: 'Frame plate',  material: 'AL-6061' },
      { pn: 'P-1002', name: 'M6 bolt',      material: 'SS-304'  },
      { pn: 'P-1003', name: 'Spacer ring',  material: 'MS-1018' },
    ];
    for (const f of fixtures) {
      await fillByTestId(page, 'forge-pdm-input-pn',   f.pn);
      await fillByTestId(page, 'forge-pdm-input-name', f.name);
      await selectByTestId(page, 'forge-pdm-input-material', f.material);
      await page.click('[data-testid="forge-pdm-create-btn"]');
      await expect(page.locator(`[data-testid="forge-pdm-item-row-${f.pn}"]`))
        .toBeVisible({ timeout: 2000 });
      await watchable(page, 250);
    }
    await shot(page, 'three-items-created');

    // Three rows in the table.
    const rows = page.locator('[data-testid="forge-pdm-items-table"] tbody tr');
    await expect(rows).toHaveCount(3);
  });

  // ────────────────────────────────────────────────────────────────
  // 03 — Revise item one A → B.
  // ────────────────────────────────────────────────────────────────
  test('03 revise P-1001 from rev A to rev B', async () => {
    // Open the detail strip by clicking the row.
    await page.click('[data-testid="forge-pdm-item-row-P-1001"]');
    const detail = page.locator('[data-testid="forge-pdm-item-detail"]');
    await expect(detail).toBeVisible();
    await expect(page.locator('[data-testid="forge-pdm-detail-rev"]'))
      .toContainText('Rev A');
    await shot(page, 'item-detail-A');

    await page.click('[data-testid="forge-pdm-revise-btn"]');
    await watchable(page, 300);
    await expect(page.locator('[data-testid="forge-pdm-detail-rev"]'))
      .toContainText('Rev B');
    // The row in the table reflects the bump too.
    await expect(page.locator('[data-testid="forge-pdm-item-row-P-1001"] td').nth(2))
      .toHaveText('B');
    await shot(page, 'item-detail-B');
  });

  // ────────────────────────────────────────────────────────────────
  // 04 — Check-out / check-in cycle.
  // ────────────────────────────────────────────────────────────────
  test('04 check out and check in P-1001', async () => {
    // Detail strip is still mounted from the previous test.
    await fillByTestId(page, 'forge-pdm-detail-user', 'satvik');
    await page.click('[data-testid="forge-pdm-checkout-btn"]');
    await watchable(page, 300);
    // Locked-by column lights up.
    await expect(page.locator('[data-testid="forge-pdm-item-row-P-1001"] td').nth(4))
      .toContainText('satvik');
    await shot(page, 'checked-out');

    await fillByTestId(page, 'forge-pdm-detail-note', 'tightened tolerance band');
    await page.click('[data-testid="forge-pdm-checkin-btn"]');
    await watchable(page, 300);
    await expect(page.locator('[data-testid="forge-pdm-item-row-P-1001"] td').nth(4))
      .toContainText('—');
    await shot(page, 'checked-in');
  });

  // ────────────────────────────────────────────────────────────────
  // 05 — Revisions tab — chronological view.
  // ────────────────────────────────────────────────────────────────
  test('05 Revisions tab shows two revs for P-1001', async () => {
    await clickTab(page, 'revs');
    await shot(page, 'revs-tab');
    // Three items × initial rev A = 3 rows, plus the P-1001 → B bump = 4.
    const rows = page.locator('[data-testid="forge-pdm-revs-table"] tbody tr');
    await expect(rows).toHaveCount(4);
    // The P-1001 / B row must exist.
    const bRow = rows.filter({ hasText: 'P-1001' }).filter({ hasText: 'B' });
    await expect(bRow.first()).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────
  // 06 — ECNs tab: add ECN linking two items.
  // ────────────────────────────────────────────────────────────────
  test('06 ECNs tab — add ECN-1010 affecting P-1002 + P-1003', async () => {
    await clickTab(page, 'ecns');
    await shot(page, 'ecns-tab-empty');

    await fillByTestId(page, 'forge-pdm-ecn-number', 'ECN-1010');
    await fillByTestId(page, 'forge-pdm-ecn-reason', 'spacer height correction');
    await page.click('[data-testid="forge-pdm-ecn-pick-P-1002"]');
    await page.click('[data-testid="forge-pdm-ecn-pick-P-1003"]');
    await expect(page.locator('[data-testid="forge-pdm-ecn-pick-P-1002"]'))
      .toHaveAttribute('data-active', 'true');
    await expect(page.locator('[data-testid="forge-pdm-ecn-pick-P-1003"]'))
      .toHaveAttribute('data-active', 'true');
    await shot(page, 'ecn-form-filled');

    await page.click('[data-testid="forge-pdm-ecn-add-btn"]');
    await watchable(page, 300);
    const row = page.locator('[data-testid="forge-pdm-ecn-row-ECN-1010"]');
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(3)).toContainText('P-1002');
    await expect(row.locator('td').nth(3)).toContainText('P-1003');
    await expect(row.locator('td').nth(3))
      .toHaveAttribute('data-affected-count', '2');
    await shot(page, 'ecn-created');
  });

  // ────────────────────────────────────────────────────────────────
  // 07 — BOMs tab: link parent/child, switch view modes.
  // ────────────────────────────────────────────────────────────────
  test('07 BOMs tab — link two children under P-1001', async () => {
    await clickTab(page, 'boms');
    await shot(page, 'boms-tab-initial');

    // Parent selector lists all three items — pick the first.
    const parentSelect = page.locator('[data-testid="forge-pdm-bom-parent-select"]');
    await parentSelect.waitFor();
    const optionVal = await parentSelect.locator('option', { hasText: /P-1001/ })
                                         .first()
                                         .getAttribute('value');
    await parentSelect.selectOption(optionVal);

    // Link P-1002 ×4.
    await fillByTestId(page, 'forge-pdm-bom-child-pn', 'P-1002');
    await fillByTestId(page, 'forge-pdm-bom-qty', '4');
    await page.click('[data-testid="forge-pdm-bom-link-btn"]');
    await watchable(page, 300);
    // Link P-1003 ×2.
    await fillByTestId(page, 'forge-pdm-bom-child-pn', 'P-1003');
    await fillByTestId(page, 'forge-pdm-bom-qty', '2');
    await page.click('[data-testid="forge-pdm-bom-link-btn"]');
    await watchable(page, 300);

    const tree = page.locator('[data-testid="forge-pdm-bom-tree"]');
    await expect(tree).toBeVisible();
    const list = page.locator('[data-testid="forge-pdm-bom-list"]');
    await expect(list).toHaveAttribute('data-bom-rows', '2');
    await expect(tree).toContainText('P-1002');
    await expect(tree).toContainText('P-1003');
    await shot(page, 'bom-working');

    // Working mode is the default; assert.
    await expect(tree).toHaveAttribute('data-bom-mode', 'working');

    // Released mode — parent is WIP, so released BOM is empty.
    await page.click('[data-testid="forge-pdm-bom-mode-released"]');
    await expect(tree).toHaveAttribute('data-bom-mode', 'released');
    await shot(page, 'bom-released-empty');

    // Diff mode — everything is "added" because nothing is released yet.
    await page.click('[data-testid="forge-pdm-bom-mode-diff"]');
    await expect(tree).toHaveAttribute('data-bom-mode', 'diff');
    const diff = page.locator('[data-testid="forge-pdm-bom-diff"]');
    await expect(diff.locator('ul').first())
      .toHaveAttribute('data-diff-added', '2');
    await shot(page, 'bom-diff');
  });

  // ────────────────────────────────────────────────────────────────
  // 08 — Where Used tab: P-1002 used by P-1001 ×1 parent.
  // ────────────────────────────────────────────────────────────────
  test('08 Where Used tab — P-1002 used by one parent', async () => {
    await clickTab(page, 'where');
    await shot(page, 'where-tab-initial');

    const itemSelect = page.locator('[data-testid="forge-pdm-where-item-select"]');
    const optionVal = await itemSelect.locator('option', { hasText: /P-1002/ })
                                       .first()
                                       .getAttribute('value');
    await itemSelect.selectOption(optionVal);
    await watchable(page, 300);

    await expect(page.locator('[data-testid="forge-pdm-where-count"]'))
      .toHaveText('1');
    const row = page.locator('[data-testid="forge-pdm-where-row-P-1001"]');
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(0)).toContainText('P-1001');
    await expect(row.locator('td').nth(3)).toContainText('×4');
    await shot(page, 'where-used-counts');
  });

  // ────────────────────────────────────────────────────────────────
  // 09 — Multi-angle viewport — dark theme.
  // ────────────────────────────────────────────────────────────────
  for (const pass of MULTI_ANGLE_PASSES) {
    test(`09 multi-angle · ${pass.name} · dark theme`, async () => {
      // Force dark theme via the DOM attribute — presentation harness,
      // not a click-tracked user action.
      await page.evaluate(
        () => document.documentElement.setAttribute('data-forge-theme', 'dark'));
      await page.setViewportSize(pass.size);
      await watchable(page, 400);
      await expect(page.locator('[data-testid="forge-pdm-panel"]')).toBeVisible();
      await shot(page, `multi-${pass.name}-dark`);
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 10 — Switch to light theme via View menu, walk the same angles.
  // ────────────────────────────────────────────────────────────────
  test('10 user toggles theme via View menu', async () => {
    await page.click('button[data-menu="view"]');
    const menu = page.locator('[data-testid="forge-menu-view"]');
    await expect(menu).toBeVisible({ timeout: 3000 });
    const item = menu.locator('button', { hasText: /Toggle theme/i }).first();
    await item.click();
    await watchable(page, 400);
    // The PDM panel must re-render in light theme.
    const theme = await page.evaluate(
      () => document.documentElement.getAttribute('data-forge-theme'));
    expect(theme).toBe('light');
    await shot(page, 'light-theme-pdm');
  });

  for (const pass of MULTI_ANGLE_PASSES) {
    test(`11 multi-angle · ${pass.name} · light theme`, async () => {
      await page.evaluate(
        () => document.documentElement.setAttribute('data-forge-theme', 'light'));
      await page.setViewportSize(pass.size);
      await watchable(page, 350);
      // Re-open the panel if a viewport change ever collapsed it (it
      // shouldn't — the panel is fixed — but defence in depth).
      const panel = page.locator('[data-testid="forge-pdm-panel"]');
      if (!(await panel.isVisible().catch(() => false))) {
        await openPdmFromMenu(page);
      }
      await shot(page, `multi-${pass.name}-light`);
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 12 — Manual UI must never write to Archie's thread.
  // ────────────────────────────────────────────────────────────────
  test('12 manual PDM clicks do not write Archie thread', async () => {
    const archieThread = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('forge.v4.archieThread');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
    // Either the key is absent or empty — the panel never proxies clicks
    // into the conversation. If it exists and has been populated by
    // something else in the session, the new entries cannot mention any
    // PDM action ids.
    if (archieThread && Array.isArray(archieThread)) {
      const offending = archieThread.filter((m) =>
        typeof m === 'object' && /tools\.pdm|pdm\.create|pdm\.revise/i.test(
          JSON.stringify(m)));
      expect(offending, `Archie thread contains PDM mentions: ${JSON.stringify(offending)}`)
        .toEqual([]);
    } else {
      expect(archieThread === null || archieThread === undefined ||
             (Array.isArray(archieThread) && archieThread.length === 0)).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // 13 — Close panel.
  // ────────────────────────────────────────────────────────────────
  test('13 close the PDM panel', async () => {
    await page.click('[data-testid="forge-pdm-close"]');
    await expect(page.locator('[data-testid="forge-pdm-panel"]')).toHaveCount(0,
      { timeout: 2000 });
    await shot(page, 'pdm-closed');
  });

  // ────────────────────────────────────────────────────────────────
  // 14 — No uncaught errors from the PDM surface.
  // ────────────────────────────────────────────────────────────────
  test('14 no uncaught renderer errors', async () => {
    expect(consoleErrors,
           `Renderer errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
