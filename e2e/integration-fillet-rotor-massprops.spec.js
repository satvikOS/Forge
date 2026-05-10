import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Fillet (Part) → upgraded Mass Properties (Assembly) — full inertia tensor', async ({ page }) => {
  ensure(ROOT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // 1) Fillet builds a rounded box
  await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Fillet$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  // 2) Mass Properties — should now report full inertia tensor
  await page.locator('.ribbon-tab', { hasText: 'Assembly' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Mass Properties$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastMassProps?.inertiaCOM, null, { timeout: 30000 });

  const mp = await page.evaluate(() => window.__lastMassProps);

  console.log(`\n=== ROUNDED BOX → MASS PROPERTIES ===`);
  console.log(`V = ${mp.volume_mm3.toFixed(2)} mm³,  m = ${mp.mass_kg.toFixed(4)} kg`);
  console.log(`COM = (${mp.centroid_mm.map(v => v.toFixed(3)).join(', ')}) mm`);
  console.log(`I_COM:`);
  for (const row of mp.inertiaCOM) console.log('  ', row.map(v => v.toFixed(3)).join('\t'));
  console.log(`Principal: ${mp.principalMoments.map(v => v.toFixed(3)).join(', ')}`);
  console.log(`Tri count: ${mp.triCount}`);
  fs.writeFileSync(path.join(ROOT, 'fillet-massprops-integration.json'), JSON.stringify(mp, null, 2));

  // Rounded box (50×30×20, r=5) ≈ 28021 mm³, COM at origin
  expect(mp.volume_mm3).toBeGreaterThan(27800);
  expect(mp.volume_mm3).toBeLessThan(28100);
  for (const c of mp.centroid_mm) expect(Math.abs(c)).toBeLessThan(0.5);
  // I_xx > I_yy > I_zz (longest dimension X gives least about-X inertia... wait)
  // For a box (50×30×20), about its centroid: I_xx ∝ (b²+c²) = 1300, I_yy ∝ (a²+c²)=2900, I_zz ∝ (a²+b²)=3400
  // → I_zz > I_yy > I_xx
  expect(mp.principalMoments[0]).toBeGreaterThanOrEqual(mp.principalMoments[1]);
  expect(mp.principalMoments[1]).toBeGreaterThanOrEqual(mp.principalMoments[2]);
});

test('Integration: Rotordynamics in Simulate ribbon → critical speed report', async ({ page }) => {
  ensure(ROOT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Rotordynamics$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastRotordynResult, null, { timeout: 30000 });

  const r = await page.evaluate(() => window.__lastRotordynResult);

  console.log(`\n=== ROTORDYNAMICS via real ribbon ===`);
  console.log(`f₁ = ${r.firstNaturalHz.toFixed(3)} Hz  (analytical Jeffcott ${r.analyticalHz.toFixed(3)} Hz, err ${r.errorPct.toFixed(2)} %)`);
  console.log(`Synchronous critical speed: ${r.criticalSpeedRPM.toFixed(0)} RPM`);
  console.log(`Mode frequencies (Hz): ${r.modeFrequenciesHz.slice(0, 4).map(f => f.toFixed(2)).join(', ')}`);
  fs.writeFileSync(path.join(ROOT, 'rotordynamics-integration.json'), JSON.stringify(r, null, 2));

  expect(r.firstNaturalHz).toBeGreaterThan(0);
  expect(r.firstNaturalHz).toBeLessThan(r.analyticalHz * 1.2);
  expect(r.criticalSpeedRPM).toBeGreaterThan(0);
});
