import { test, expect } from '@playwright/test';

// Helper: wait for the main viewport canvas (not NavSphere)
async function waitForViewport(page) {
  await page.goto('/');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000); // let Three.js fully init
  return canvas;
}

// Helper: click a tool group button by index (0-based from toolbar)
async function clickToolGroup(page, groupIndex) {
  const btn = page.locator('.tool-icon-button').nth(groupIndex + 2); // +2 for Select/Move buttons
  await btn.click();
  await page.waitForTimeout(500);
}

// Helper: click a dropdown item by name
async function clickDropdownItem(page, name) {
  const item = page.locator('.dropdown-item').filter({ hasText: name }).first();
  await item.click();
  await page.waitForTimeout(1000);
}

// Helper: verify status bar shows success
async function expectStatus(page, text) {
  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText(text, { timeout: 5000 });
}

test.describe('Viewport Stability', () => {
  test('viewport renders and stays visible for 10 seconds', async ({ page }) => {
    const canvas = await waitForViewport(page);
    await page.waitForTimeout(10000);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);
  });

  test('viewport has 2 canvases (main + NavSphere)', async ({ page }) => {
    await waitForViewport(page);
    const count = await page.locator('canvas').count();
    expect(count).toBe(2);
  });
});

test.describe('Primitives & Part Design', () => {
  test.beforeEach(async ({ page }) => { await waitForViewport(page); });

  test('Extrude Boss creates solid', async ({ page }) => {
    await clickToolGroup(page, 1); // Part Design
    await clickDropdownItem(page, 'Extrude Boss');
    await expectStatus(page, 'Extrude Boss');
  });

  test('Revolve Boss creates solid', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Revolve Boss');
    await expectStatus(page, 'Revolve');
  });

  test('Loft Boss creates solid', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Loft Boss');
    await expectStatus(page, 'Loft');
  });

  test('Sweep Boss creates solid', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Sweep Boss');
    await expectStatus(page, 'Sweep');
  });

  test('Fillet applies to edges', async ({ page }) => {
    // Create base solid first
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(500);
    // Apply fillet
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Fillet');
    await expectStatus(page, 'Fillet');
  });

  test('Chamfer applies to edges', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(500);
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Chamfer');
    await expectStatus(page, 'Chamfer');
  });

  test('Shell hollows solid', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(500);
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Shell');
    await expectStatus(page, 'Shell');
  });

  test('Boolean Subtract works', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(500);
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Hole Wizard');
    await page.waitForTimeout(500);
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Subtract');
    await expectStatus(page, 'Subtract');
  });

  test('Linear Pattern creates copies', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Linear Pattern');
    await expectStatus(page, 'Linear Pattern');
  });

  test('Circular Pattern creates copies', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Circular Pattern');
    await expectStatus(page, 'Circular Pattern');
  });
});

test.describe('Sketch Tools', () => {
  test.beforeEach(async ({ page }) => { await waitForViewport(page); });

  test('Line creates sketch entity', async ({ page }) => {
    await clickToolGroup(page, 0); // Sketch
    await clickDropdownItem(page, 'Line');
    await expectStatus(page, 'Line');
  });

  test('Circle creates sketch entity', async ({ page }) => {
    await clickToolGroup(page, 0);
    await clickDropdownItem(page, 'Circle');
    await expectStatus(page, 'Circle');
  });

  test('Rectangle creates sketch entity', async ({ page }) => {
    await clickToolGroup(page, 0);
    await clickDropdownItem(page, 'Rectangle');
    await expectStatus(page, 'Rectangle');
  });
});

test.describe('Display Modes', () => {
  test.beforeEach(async ({ page }) => { await waitForViewport(page); });

  test('Z key cycles display modes', async ({ page }) => {
    const label = page.locator('.selection-mode-label').last();
    await expect(label).toContainText('Shaded');

    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    await expect(label).toContainText('Wire');

    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    await expect(label).toContainText('S+W');

    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    await expect(label).toContainText('X-Ray');
  });

  test('selection modes switch with 1/2/3', async ({ page }) => {
    await page.keyboard.press('2');
    await page.waitForTimeout(300);
    const faceBtn = page.locator('.selection-toolbar .gizmo-btn').nth(1);
    await expect(faceBtn).toHaveClass(/active/);

    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    const objBtn = page.locator('.selection-toolbar .gizmo-btn').nth(0);
    await expect(objBtn).toHaveClass(/active/);
  });
});

test.describe('Feature Tree', () => {
  test.beforeEach(async ({ page }) => { await waitForViewport(page); });

  test('features appear in tree when created', async ({ page }) => {
    // Create 3 features
    for (let i = 0; i < 3; i++) {
      await clickToolGroup(page, 1);
      await clickDropdownItem(page, 'Extrude Boss');
    }
    const items = page.locator('.feature-tree-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Simulation', () => {
  test.beforeEach(async ({ page }) => { await waitForViewport(page); });

  test('FEA returns stress results', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(500);
    await clickToolGroup(page, 9); // Simulation
    await clickDropdownItem(page, 'Linear Static FEA');
    await expectStatus(page, 'stress');
  });
});

test.describe('Measure', () => {
  test.beforeEach(async ({ page }) => { await waitForViewport(page); });

  test('Mass Properties returns values', async ({ page }) => {
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(500);
    await clickToolGroup(page, 12); // Measure
    await clickDropdownItem(page, 'Mass Properties');
    await expectStatus(page, 'Mass');
  });
});

test.describe('V12 Engine Build', () => {
  test('build V12 engine components end-to-end', async ({ page }) => {
    await waitForViewport(page);

    // Engine block
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(800);

    // 6 cylinder bores
    for (let i = 0; i < 6; i++) {
      await clickToolGroup(page, 1);
      await clickDropdownItem(page, 'Hole Wizard');
      await page.waitForTimeout(600);
    }

    // Crankshaft
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Revolve Boss');
    await page.waitForTimeout(800);

    // Intake manifold
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Sweep Boss');
    await page.waitForTimeout(800);

    // Exhaust manifold
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Loft Boss');
    await page.waitForTimeout(800);

    // Fillets
    await clickToolGroup(page, 1);
    await clickDropdownItem(page, 'Fillet');
    await page.waitForTimeout(600);

    // FEA analysis
    await clickToolGroup(page, 9);
    await clickDropdownItem(page, 'Linear Static FEA');
    await page.waitForTimeout(800);

    // Mass properties
    await clickToolGroup(page, 12);
    await clickDropdownItem(page, 'Mass Properties');
    await page.waitForTimeout(800);

    // Verify feature tree
    const items = page.locator('.feature-tree-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // Screenshot
    await page.screenshot({ path: 'e2e/screenshots/v12-engine.png', fullPage: true });
  });
});
