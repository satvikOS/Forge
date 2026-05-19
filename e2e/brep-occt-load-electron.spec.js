import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('OCCT WASM loads inside the ArchDisc Electron app and exposes B-rep classes', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // Load OCCT and introspect the binding surface this version exposes.
  const recon = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    const names = Object.getOwnPropertyNames(oc);
    const pick = (re) => names.filter(n => re.test(n)).sort();
    return {
      hasMakeBox: pick(/^BRepPrimAPI_MakeBox/),
      hasMesh: pick(/^BRepMesh_IncrementalMesh/),
      hasBRepTool: names.includes('BRep_Tool'),
      hasGProp: pick(/^GProp_GProps|^BRepGProp/),
      hasExplorer: pick(/^TopExp_Explorer/),
      hasTopoDS: names.includes('TopoDS'),
      total: names.length,
    };
  });

  fs.mkdirSync(path.join(__dirname, '..', 'docs', 'superpowers', 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'superpowers', 'notes', 'occt-api-A0-recon.json'),
    JSON.stringify(recon, null, 2),
  );
  console.log('OCCT recon:', JSON.stringify(recon, null, 2));

  expect(recon.hasMakeBox.length).toBeGreaterThan(0);
  expect(recon.hasMesh.length).toBeGreaterThan(0);
  expect(recon.hasBRepTool).toBe(true);
  expect(recon.total).toBeGreaterThan(100);
  expect(pageErrors).toEqual([]);
  await app.close();
});
