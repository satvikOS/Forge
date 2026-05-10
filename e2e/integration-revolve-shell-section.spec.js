import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

async function clickFoundationTool(page, toolName) {
  await page.evaluate(() => { window.__lastFoundationManifold = null; });
  await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${toolName}$`) }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });
  return page.evaluate(async () => {
    const m = window.__lastFoundationManifold;
    const bb = m.boundingBox();
    return { volume: m.volume(), bbox: { min: [...bb.min], max: [...bb.max] } };
  });
}

test.describe('Integration: Revolve / Shell / Section View through real ribbons', () => {
  test.beforeEach(async ({ page }) => {
    ensure(ROOT);
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  });

  test('Revolve Boss: stepped-shaft solid via manifold-3d revolve', async ({ page }) => {
    const r = await clickFoundationTool(page, 'Revolve Boss');
    const d1 = Math.PI * (225 - 56.25) * 30;
    const d2 = Math.PI * (144 - 56.25) * 10;
    const Vexp = d1 + d2;
    console.log(`\nRevolve Boss: V = ${r.volume.toFixed(2)} mm³ (analytical ${Vexp.toFixed(2)})`);
    fs.writeFileSync(path.join(ROOT, 'revolve-integration.json'), JSON.stringify(r, null, 2));
    expect(Math.abs(r.volume - Vexp) / Vexp).toBeLessThan(0.01);
  });

  test('Shell: 30³ cube hollowed to 2 mm wall', async ({ page }) => {
    const r = await clickFoundationTool(page, 'Shell');
    const Vexp = 27000 - 17576;
    console.log(`\nShell: V = ${r.volume.toFixed(0)} mm³ (analytical ${Vexp})`);
    fs.writeFileSync(path.join(ROOT, 'shell-integration.json'), JSON.stringify(r, null, 2));
    expect(Math.abs(r.volume - Vexp) / Vexp).toBeLessThan(0.001);
    expect(r.bbox.min[0]).toBeCloseTo(-15, 4);
    expect(r.bbox.max[0]).toBeCloseTo(15, 4);
  });

  test('Section View: cross-section of foundation body at midplane', async ({ page }) => {
    // Build a Linear Pattern body first, then take the section
    await clickFoundationTool(page, 'Linear Pattern');
    // Switch to Drawing tab and click Section View
    await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Section View$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastSectionView, null, { timeout: 30000 });
    const sec = await page.evaluate(() => window.__lastSectionView);
    console.log(`\nSection View: z = ${sec.zMid.toFixed(2)} mm, ${sec.polygonCount} polygons, ${sec.outerLoops} outer + ${sec.innerLoops} inner loops, perimeter ${sec.perimeter.toFixed(1)} mm`);
    fs.writeFileSync(path.join(ROOT, 'section-view-integration.json'), JSON.stringify(sec, null, 2));
    // 4 cylinders sliced at midplane should give 4 closed loops
    expect(sec.polygonCount).toBeGreaterThanOrEqual(4);
    expect(sec.outerLoops).toBeGreaterThanOrEqual(4);
    expect(sec.perimeter).toBeGreaterThan(50);
  });
});
