import { test, expect } from '@playwright/test';

async function waitForViewport(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

async function clickTool(page, groupIdx, itemName) {
  await page.locator('.tool-icon-button').nth(groupIdx + 2).click();
  await page.waitForTimeout(400);
  // Use dispatchEvent to bypass viewport bounds check
  const item = page.locator('.dropdown-item').filter({ hasText: itemName }).first();
  await item.dispatchEvent('click');
  await page.waitForTimeout(800);
}

async function verifyStatus(page, text) {
  await expect(page.locator('.tool-status-bar')).toContainText(text, { timeout: 5000 });
}

async function featureCount(page) {
  return await page.locator('.feature-tree-item').count();
}

// ============================================================
// PROJECT 1: Turbine Blade (Aerospace)
// Built from: Loft + Sweep + Fillet + FEA + Thermal
// ============================================================
test.describe('Turbine Blade — Built from Tools', () => {
  test('build complete turbine blade from scratch', async ({ page }) => {
    await waitForViewport(page);

    // Step 1: Airfoil root — extruded base
    await clickTool(page, 1, 'Extrude Boss');
    await verifyStatus(page, 'Extrude Boss');

    // Step 2: Blade body — loft between profiles
    await clickTool(page, 1, 'Loft Boss');
    await verifyStatus(page, 'Loft');

    // Step 3: Leading edge sweep
    await clickTool(page, 1, 'Sweep Boss');
    await verifyStatus(page, 'Sweep');

    // Step 4: Fir-tree root attachment
    await clickTool(page, 1, 'Extrude Boss');

    // Step 5: Cooling channels (holes)
    for (let i = 0; i < 4; i++) {
      await clickTool(page, 1, 'Hole Wizard');
    }

    // Step 6: Fillet leading/trailing edges
    await clickTool(page, 1, 'Fillet');
    await verifyStatus(page, 'Fillet');

    // Step 7: FEA — thermal stress at 1200°C
    await clickTool(page, 9, 'Linear Static FEA');
    await verifyStatus(page, 'MPa');

    // Step 8: Thermal analysis
    await clickTool(page, 9, 'Steady-State Thermal');
    await verifyStatus(page, 'Thermal');

    // Step 9: Mass check
    await clickTool(page, 12, 'Mass Properties');
    await verifyStatus(page, 'Mass');

    // Step 10: Export STEP
    await clickTool(page, 11, 'Export STEP');

    const count = await featureCount(page);
    expect(count).toBeGreaterThanOrEqual(8);

    await page.screenshot({ path: 'e2e/screenshots/turbine-blade.png', fullPage: true });
  });
});

// ============================================================
// PROJECT 2: Planetary Gearbox (Automotive)
// Built from: Revolves + Cylinders + Patterns + Boolean + Assembly
// ============================================================
test.describe('Planetary Gearbox — Built from Tools', () => {
  test('build gearbox assembly from scratch', async ({ page }) => {
    await waitForViewport(page);

    // Sun gear (center revolve)
    await clickTool(page, 1, 'Revolve Boss');
    await verifyStatus(page, 'Revolve');

    // Planet gears (3x revolve + circular pattern)
    await clickTool(page, 1, 'Revolve Boss');
    await clickTool(page, 1, 'Circular Pattern');
    await verifyStatus(page, 'Circular Pattern');

    // Ring gear (large revolve + boolean subtract for teeth)
    await clickTool(page, 1, 'Revolve Boss');
    await clickTool(page, 1, 'Hole Wizard');
    await clickTool(page, 1, 'Circular Pattern');

    // Planet carrier plate
    await clickTool(page, 1, 'Extrude Boss');

    // Bearing housings
    await clickTool(page, 1, 'Revolve Boss');
    await clickTool(page, 1, 'Circular Pattern');

    // Input/output shafts
    await clickTool(page, 1, 'Revolve Boss');
    await clickTool(page, 1, 'Revolve Boss');

    // Housing (shell)
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Shell');
    await verifyStatus(page, 'Shell');

    // Bolts (pattern)
    await clickTool(page, 1, 'Hole Wizard');
    await clickTool(page, 1, 'Circular Pattern');

    // FEA check
    await clickTool(page, 9, 'Linear Static FEA');
    await verifyStatus(page, 'MPa');

    const count = await featureCount(page);
    expect(count).toBeGreaterThanOrEqual(12);

    await page.screenshot({ path: 'e2e/screenshots/planetary-gearbox.png', fullPage: true });
  });
});

// ============================================================
// PROJECT 3: Hydraulic Manifold Block (Industrial)
// Built from: Extrude + Many hole patterns + Boolean + Chamfer
// ============================================================
test.describe('Hydraulic Manifold — Built from Tools', () => {
  test('build manifold block with internal passages', async ({ page }) => {
    await waitForViewport(page);

    // Main block
    await clickTool(page, 1, 'Extrude Boss');
    await verifyStatus(page, 'Extrude Boss');

    // Port holes (6 faces, multiple per face)
    for (let i = 0; i < 8; i++) {
      await clickTool(page, 1, 'Hole Wizard');
    }

    // Internal cross-drilled passages
    for (let i = 0; i < 4; i++) {
      await clickTool(page, 1, 'Hole Wizard');
    }

    // Chamfer all port entries
    await clickTool(page, 1, 'Chamfer');
    await verifyStatus(page, 'Chamfer');

    // O-ring grooves (revolve cuts)
    await clickTool(page, 1, 'Revolve Boss');
    await clickTool(page, 1, 'Revolve Boss');

    // Mounting bolt holes + pattern
    await clickTool(page, 1, 'Hole Wizard');
    await clickTool(page, 1, 'Linear Pattern');

    // Pressure test: FEA at 350 bar
    await clickTool(page, 9, 'Linear Static FEA');
    await verifyStatus(page, 'MPa');

    // Generate G-code for CNC
    await clickTool(page, 10, '2.5-Axis Milling');
    await verifyStatus(page, 'lines');

    // Cost estimation
    await clickTool(page, 10, 'Cost Estimation');
    await verifyStatus(page, '$');

    const count = await featureCount(page);
    expect(count).toBeGreaterThanOrEqual(15);

    await page.screenshot({ path: 'e2e/screenshots/hydraulic-manifold.png', fullPage: true });
  });
});

// ============================================================
// PROJECT 4: PCB Enclosure (Electronics)
// Built from: Extrude + Shell + Pattern + Sheet Metal
// ============================================================
test.describe('PCB Enclosure — Built from Tools', () => {
  test('build electronics enclosure with ventilation', async ({ page }) => {
    await waitForViewport(page);

    // Base shell
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Shell');
    await verifyStatus(page, 'Shell');

    // Ventilation slots (pattern)
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Linear Pattern');

    // Connector cutouts
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Extrude Boss');

    // PCB standoff bosses
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Circular Pattern');

    // Mounting tabs
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Hole Wizard');
    await clickTool(page, 1, 'Linear Pattern');

    // Lid (separate extrude)
    await clickTool(page, 1, 'Extrude Boss');
    await clickTool(page, 1, 'Fillet');

    // Thermal simulation
    await clickTool(page, 9, 'Steady-State Thermal');
    await verifyStatus(page, 'Thermal');

    // Additive prep (3D print)
    await clickTool(page, 10, 'Slice Preview');
    await verifyStatus(page, 'layers');

    const count = await featureCount(page);
    expect(count).toBeGreaterThanOrEqual(10);

    await page.screenshot({ path: 'e2e/screenshots/pcb-enclosure.png', fullPage: true });
  });
});

// ============================================================
// PROJECT 5: Precision Bearing Assembly (Mechanical)
// Built from: Revolves + Patterns + Assembly
// ============================================================
test.describe('Bearing Assembly — Built from Tools', () => {
  test('build deep groove ball bearing from scratch', async ({ page }) => {
    await waitForViewport(page);

    // Outer race (revolve)
    await clickTool(page, 1, 'Revolve Boss');

    // Inner race (revolve)
    await clickTool(page, 1, 'Revolve Boss');

    // Ball elements (sphere + circular pattern would be ideal, using revolves)
    for (let i = 0; i < 3; i++) {
      await clickTool(page, 1, 'Revolve Boss');
    }
    await clickTool(page, 1, 'Circular Pattern');

    // Cage/retainer
    await clickTool(page, 1, 'Revolve Boss');
    await clickTool(page, 1, 'Hole Wizard');
    await clickTool(page, 1, 'Circular Pattern');

    // Seal (thin revolve)
    await clickTool(page, 1, 'Revolve Boss');

    // Insert all as assembly
    await clickTool(page, 5, 'Insert Component');
    await verifyStatus(page, 'parts');

    // Check geometry
    await clickTool(page, 12, 'Check Geometry');

    const count = await featureCount(page);
    expect(count).toBeGreaterThanOrEqual(8);

    await page.screenshot({ path: 'e2e/screenshots/bearing-assembly.png', fullPage: true });
  });
});
