import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * Chained integration: build a foundation body via Linear Pattern,
 * then export it as STEP AP203 via the Drawing → Export STEP ribbon
 * button. Asserts the exported text contains a valid STEP AP203
 * structure.
 */
test('Integration: chained Linear Pattern → Export STEP through real ribbons', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // ── Step 1: Linear Pattern (Part tab) — produces a foundation manifold
  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  await expect(partTab).toBeVisible({ timeout: 15000 });
  await partTab.click();

  const linearPatternBtn = page.locator('.ribbon-tool', { hasText: 'Linear Pattern' }).first();
  await expect(linearPatternBtn).toBeVisible({ timeout: 10000 });
  await linearPatternBtn.click();

  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  // ── Step 2: switch to Drawing tab and click Export STEP
  const drawingTab = page.locator('.ribbon-tab', { hasText: 'Drawing' }).first();
  await expect(drawingTab).toBeVisible({ timeout: 10000 });
  await drawingTab.click();

  const exportStepBtn = page.locator('.ribbon-tool', { hasText: 'Export STEP' }).first();
  await expect(exportStepBtn).toBeVisible({ timeout: 10000 });
  await exportStepBtn.click();

  // ── Step 3: assert STEP text was produced and looks valid
  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      if (window.__lastSTEPText) {
        return {
          sizeBytes: window.__lastSTEPSizeBytes,
          first200: window.__lastSTEPText.slice(0, 200),
          // Count key STEP AP203 entity types
          numFaces: (window.__lastSTEPText.match(/ADVANCED_FACE/g) || []).length,
          numEdges: (window.__lastSTEPText.match(/EDGE_CURVE/g) || []).length,
          numVertices: (window.__lastSTEPText.match(/VERTEX_POINT/g) || []).length,
          hasISO: /ISO-10303-21/.test(window.__lastSTEPText),
          hasManifold: /MANIFOLD_SOLID_BREP|CLOSED_SHELL/.test(window.__lastSTEPText),
        };
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'export-step-trace.log'), consoleLines.join('\n'));
    throw new Error(`STEP export pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: LINEAR PATTERN → EXPORT STEP through real ribbon ===`);
  console.log(`STEP file size: ${(result.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`ADVANCED_FACE entities: ${result.numFaces}`);
  console.log(`EDGE_CURVE entities: ${result.numEdges}`);
  console.log(`VERTEX_POINT entities: ${result.numVertices}`);
  console.log(`First 200 chars: ${result.first200}`);

  fs.writeFileSync(path.join(ROOT, 'export-step-integration.json'), JSON.stringify({
    sizeBytes: result.sizeBytes,
    numFaces: result.numFaces,
    numEdges: result.numEdges,
    numVertices: result.numVertices,
    hasISO: result.hasISO,
    hasManifold: result.hasManifold,
  }, null, 2));

  expect(result.hasISO).toBe(true);
  expect(result.hasManifold).toBe(true);
  expect(result.numFaces).toBeGreaterThan(0);
  expect(result.numEdges).toBeGreaterThan(0);
  expect(result.numVertices).toBeGreaterThan(0);
  expect(result.sizeBytes).toBeGreaterThan(2000);
});
