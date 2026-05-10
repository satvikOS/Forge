import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Frame FEA in the Simulate ribbon runs foundation.solveFrame on a 3D portal', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simTab).toBeVisible({ timeout: 15000 });
  await simTab.click();

  const frameBtn = page.locator('.ribbon-tool', { hasText: 'Frame FEA' }).first();
  await expect(frameBtn).toBeVisible({ timeout: 10000 });
  await frameBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      const r = window.__lastFrameFEAResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'frame-fea-trace.log'), consoleLines.join('\n'));
    throw new Error(`Frame FEA pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: FRAME FEA — 3D PORTAL ===`);
  console.log(`Top-left drift D = ${result.topLeftDriftMm.toFixed(4)} mm`);
  console.log(`Top-right drift C = ${result.topRightDriftMm.toFixed(4)} mm`);
  console.log(`|D - C| = ${result.deltaDriftMm.toFixed(6)} mm  (rigid beam should tie within μm)`);
  console.log(`Mesh: ${result.memberCount} members / ${result.nodeCount} nodes,  CG ${result.cgIterations} iter`);

  fs.writeFileSync(path.join(ROOT, 'frame-fea-integration.json'), JSON.stringify({
    topLeftDriftMm: result.topLeftDriftMm,
    topRightDriftMm: result.topRightDriftMm,
    deltaDriftMm: result.deltaDriftMm,
    cgIterations: result.cgIterations,
    memberCount: result.memberCount,
    nodeCount: result.nodeCount,
  }, null, 2));

  // Both top corners should drift in +x by similar amounts (rigid beam couples them)
  expect(result.topLeftDriftMm).toBeGreaterThan(0);
  expect(result.topLeftDriftMm).toBeLessThan(20);
  expect(result.deltaDriftMm).toBeLessThan(0.05);
});
