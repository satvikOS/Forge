// v4-assembly.spec.js — Forge-89 headed verification.
//
// Mounts the v4 shell in Electron, injects a React-friendly mount of
// the assembly panel via window.__forgeOpenAssembly, asserts the panel
// + every required section render, and walks the user through a
// dispatch.addMate → solve → motion-study round-trip. Always headed.
//
// Mirrors the structure of v4-kernel-wired.spec.js so the CI agent only
// has to learn one launch ritual.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-assembly';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Inject a tiny harness that React-mounts AssemblyPanel into the running
// shell. The shell hasn't been wired to it yet (that's a later slice),
// so we open the drawer through a side-channel: dropping a fresh root
// next to #root and rendering Forge's component into it. The harness
// hands back the existing `bodies` state via `window.__forgeBodies` if
// the shell has populated it; otherwise we synthesise two instances
// so the picker has something to bind against.
async function mountAssemblyPanel(page) {
  await page.evaluate(async () => {
    if (window.__assemblyMountReady) return;
    // Dynamically import the panel module from the dev server.
    const url = '/src/forge-v4/AssemblyPanel.jsx';
    let mod;
    try { mod = await import(url); }
    catch (err) { window.__assemblyMountErr = err.message; return; }
    const React = await import('react');
    const ReactDOM = await import('react-dom/client');
    const host = document.createElement('div');
    host.id = 'forge-assembly-host';
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    // Use any bodies the shell exposes; fall back to synthetic stubs.
    const bodies = window.__forgeBodies || [
      { inst: 1, name: 'Bracket', handle: 1 },
      { inst: 2, name: 'Plate',   handle: 2 },
      { inst: 3, name: 'Pin',     handle: 3 },
    ];
    window.__assemblyState = { open: true, bodies, selection: null };
    function App() {
      const [open, setOpen] = React.useState(true);
      const [sel, setSel] = React.useState(null);
      window.__assemblyApiClose = () => setOpen(false);
      window.__assemblyApiSelect = (s) => setSel(s);
      return React.createElement(mod.AssemblyPanel, {
        open,
        onClose: () => setOpen(false),
        bodies,
        selection: sel,
        onSelect: setSel,
        onSolveResult: (r) => { window.__lastSolve = r; },
      });
    }
    root.render(React.createElement(App));
    window.__assemblyMountReady = true;
  });
  await page.waitForFunction(() => window.__assemblyMountReady === true,
                             null, { timeout: 5000 });
}

test.describe.serial('Forge v4 · assembly panel', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => { if (app) await app.close(); });

  test('01 panel mounts + every required section renders', async () => {
    await mountAssemblyPanel(page);
    await page.waitForTimeout(400);
    await shot(page, 'panel-mounted');

    await expect(page.locator('[data-testid="forge-assembly-panel"]'))
      .toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="forge-assembly-mate-list"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-assembly-add-mate"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-assembly-interference-btn"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-assembly-motion-study"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-assembly-dof"]')).toBeVisible();
  });

  test('02 DOF badge equals 6 per instance with no mates', async () => {
    const items = await page.locator('[data-testid="forge-assembly-dof"] li').count();
    expect(items).toBeGreaterThanOrEqual(2);
    const firstDof = await page.locator('[data-testid="forge-assembly-dof"] li')
                                .first().textContent();
    expect(firstDof).toMatch(/dof\s*6/i);
  });

  test('03 add-mate stepper round-trips A · B · kind · Apply', async () => {
    await page.selectOption('[data-testid="forge-assembly-pick-a"]', '1');
    await page.selectOption('[data-testid="forge-assembly-pick-b"]', '2');
    await page.selectOption('[data-testid="forge-assembly-kind"]', 'Coincident');
    await page.fill('[data-testid="forge-assembly-value"]', '0');
    await shot(page, 'add-mate-filled');

    const applyBtn = page.locator('[data-testid="forge-assembly-apply"]');
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();
    await page.waitForTimeout(300);

    // List should now have at least one row regardless of kernel state
    // (the stepper falls back to pending entries when kernel offline).
    const rows = page.locator('[data-testid="forge-assembly-mate-list"] li');
    await expect(rows).toHaveCount(1, { timeout: 1500 });
    await shot(page, 'mate-list-populated');
  });

  test('04 mate can be toggled inactive and removed', async () => {
    const checkbox = page.locator('[data-testid="forge-assembly-mate-list"] input[type="checkbox"]').first();
    await checkbox.click();
    await page.waitForTimeout(150);
    await expect(checkbox).not.toBeChecked();
    // Toggle back
    await checkbox.click();
    await page.waitForTimeout(150);
    await expect(checkbox).toBeChecked();

    // Remove
    const removeBtn = page.locator('[data-testid="forge-assembly-mate-list"] button[aria-label^="Remove mate"]').first();
    await removeBtn.click();
    await page.waitForTimeout(200);
    const rows = page.locator('[data-testid="forge-assembly-mate-list"] li');
    await expect(rows).toHaveCount(0);
    await shot(page, 'mate-removed');
  });

  test('05 interference button opens modal', async () => {
    await page.click('[data-testid="forge-assembly-interference-btn"]');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-assembly-interference-modal"]'))
      .toBeVisible();
    await shot(page, 'interference-modal');
    // Close via the overlay backdrop click.
    await page.locator('[data-testid="forge-assembly-interference-modal"]').click({ position: { x: 5, y: 5 }});
    await page.waitForTimeout(150);
  });

  test('06 motion study fields render and accept input', async () => {
    await page.fill('[data-testid="forge-assembly-motion-axis-x"]', '0');
    await page.fill('[data-testid="forge-assembly-motion-axis-y"]', '0');
    await page.fill('[data-testid="forge-assembly-motion-axis-z"]', '1');
    await page.fill('[data-testid="forge-assembly-motion-angle"]', '180');
    await page.fill('[data-testid="forge-assembly-motion-steps"]', '12');
    // Run button is disabled without a driver mate — pick one we added.
    // First, re-add one mate so the motion study has a driver.
    await page.selectOption('[data-testid="forge-assembly-pick-a"]', '1');
    await page.selectOption('[data-testid="forge-assembly-pick-b"]', '3');
    await page.selectOption('[data-testid="forge-assembly-kind"]', 'Angle');
    await page.click('[data-testid="forge-assembly-apply"]');
    await page.waitForTimeout(200);

    const mateOption = await page.locator('[data-testid="forge-assembly-motion-mate"] option').count();
    expect(mateOption).toBeGreaterThanOrEqual(2);
    await page.locator('[data-testid="forge-assembly-motion-mate"]').selectOption({ index: 1 });
    await shot(page, 'motion-configured');
    await page.click('[data-testid="forge-assembly-motion-run"]');
    await page.waitForTimeout(300);
    await shot(page, 'motion-run');
  });

  test('07 manual clicks did NOT post to Archie thread', async () => {
    const threadItems = await page.locator('[data-testid="forge-archie"] [data-role]').count();
    expect(threadItems).toBe(0);
  });
});
