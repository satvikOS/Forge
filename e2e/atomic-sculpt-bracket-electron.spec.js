import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps sculpts a bracket inside the ArchDisc desktop app', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // Launch the genuine Electron desktop app — uses electron/main.js which
  // loads frontend/dist/index.html (no --dev flag means production mode).
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  // Capture renderer console + errors for diagnostics
  const consoleLogs = [];
  const pageErrors = [];

  const win = await app.firstWindow();

  win.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  win.on('pageerror', err => pageErrors.push(err.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });

  // Wait for the mechanical workbench to register __archdiscAtomic
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // ── Step 1: sketch 60×40 rectangle and extrude 12 mm ──────────────────────
  const step1 = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('L-Bracket');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 60, 40);
    A.finishSketch(part);
    await A.extrude(part, 12);
    A.render(part);
    return { features: part.featureCount(), volume: part.solid.volume() };
  });

  expect(step1.volume).toBeGreaterThan(0);

  console.log(`  Step 1 — features: ${step1.features}, volume: ${step1.volume.toFixed(0)} mm^3`);

  if (pageErrors.length > 0) {
    console.log('  Page errors so far:', pageErrors.join('\n  '));
  }

  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(OUT, 'electron-bracket-step1.png') });

  // ── Step 2: second sketch + extrude unions an upstand → L-bracket ─────────
  const step2 = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = window.__atomicPart;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 24, 0, 12, 40);
    A.finishSketch(part);
    await A.extrude(part, 40);
    A.render(part);
    return { volume: part.solid.volume(), history: part.describe() };
  });

  expect(step2.volume).toBeGreaterThan(step1.volume);

  console.log('  ArchDisc desktop app — construction history: ' + step2.history);
  console.log('  final volume: ' + step2.volume.toFixed(0) + ' mm^3');

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-bracket-step2.png') });

  await app.close();
});
