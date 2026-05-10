import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(360000);

test('Integration: CFD Flow Simulation in the Simulate ribbon runs foundation.solveLidDrivenCavity', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simTab).toBeVisible({ timeout: 15000 });
  await simTab.click();

  const cfdBtn = page.locator('.ribbon-tool', { hasText: 'CFD Flow Simulation' }).first();
  await expect(cfdBtn).toBeVisible({ timeout: 10000 });
  await cfdBtn.click();

  // Lid-driven cavity at Re=100 takes 30-60s on JS for a 41x41 grid.
  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 300000) {
      const r = window.__lastCFDResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 500));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'cfd-trace.log'), consoleLines.join('\n'));
    throw new Error(`CFD pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: CFD FLOW SIMULATION through real Simulate ribbon ===`);
  console.log(`Grid: ${result.gridShape.join('×')},  ${result.timeSteps} time steps`);
  console.log(`Final residual: ${result.finalResidual.toExponential(3)}`);
  console.log(`RMS centerline u-velocity error vs Ghia 1982: ${result.rmsErrorVsGhia.toFixed(4)}`);
  console.log(`Peak u: ${result.peakU.toFixed(3)}  (Ghia ${result.peakUGhia.toFixed(3)})`);

  fs.writeFileSync(path.join(ROOT, 'cfd-integration.json'), JSON.stringify(result, null, 2));

  // RMS error against Ghia 1982 should be quite small even at coarse grid.
  // 41x41 + 4000 time steps typically gives RMS error < 0.05.
  expect(result.rmsErrorVsGhia).toBeLessThan(0.15);
  expect(result.timeSteps).toBeGreaterThan(100);
  expect(Math.abs(result.peakU)).toBeGreaterThan(0.1);   // some recirculation captured
});
