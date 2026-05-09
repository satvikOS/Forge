import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'platform-tests', 'focus');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('FocusController: zoom + dim others by partID', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PartIDRegistry, Assembly, AssemblyBridge, FocusController, PrimitiveBuilder } = m;

    PartIDRegistry.reset();
    PartIDRegistry.setProject('GE9X');

    const asm = new Assembly('Focus Test');
    const targetIDs = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const part = asm.addPart(
          PrimitiveBuilder.box(0.1, 0.1, 0.1),
          `Cube ${row}-${col}`,
          {
            position: { x: col * 0.3, y: row * 0.3, z: 0 },
            category: 'TST',
            subsystem: 'CUB',
            material: 'Aluminum 6061-T6',
          }
        );
        // PartInstance.position came from transform, but constructor expects Vec3
        // Patch directly:
        part.position = new (await import('/src/kernel/index.js')).Vec3(col * 0.3, row * 0.3, 0);
        targetIDs.push(part.partID);
      }
    }

    const root = AssemblyBridge.renderAssembly(asm, window.__three_scene, {
      instanceThreshold: 999,  // force regular meshes
    });

    // Focus on the middle cube
    const middle = targetIDs[12];
    const focusResult = FocusController.focusByPartID(
      middle,
      window.__three_scene,
      window.__three_camera,
      null,
      { dimOpacity: 0.05 }
    );

    if (window.__three_renderer && window.__three_camera) {
      window.__three_renderer.render(window.__three_scene, window.__three_camera);
    }

    return {
      totalRegistered: PartIDRegistry.size(),
      targetID: middle,
      focusFound: !!focusResult,
      focusBox: focusResult?.box,
      focusCenter: focusResult?.center,
      focusedID: FocusController.getFocused(),
    };
  });

  console.log('\n=== FocusController Test ===');
  console.log(`Total parts: ${result.totalRegistered}`);
  console.log(`Target: ${result.targetID}`);
  console.log(`Focus successful: ${result.focusFound}`);
  console.log(`Box center: ${JSON.stringify(result.focusCenter)}`);
  console.log(`Currently focused: ${result.focusedID}`);

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'focus-on-middle.png'), fullPage: true });

  // Now clear focus
  await page.evaluate(async () => {
    const { FocusController } = await import('/src/kernel/index.js');
    FocusController.clearFocus(window.__three_scene);
    if (window.__three_renderer && window.__three_camera) {
      window.__three_renderer.render(window.__three_scene, window.__three_camera);
    }
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'focus-cleared.png'), fullPage: true });

  expect(result.focusFound).toBe(true);
  expect(result.focusedID).toBe(result.targetID);
});
