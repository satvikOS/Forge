/**
 * Workflow-30 — High-resolution viewport snapshot to PNG.
 *
 * Engineers paste viewport images into review decks, vendor RFQs,
 * project trackers, customer slide decks. ArchDisc now produces a
 * 2x-canvas-size PNG so the image stays crisp at typical slide
 * scaling.
 *
 * Coherent real-project test: builds a 7-component pneumatic
 * controls panel (a real shop-floor automation sub-assembly --
 * solenoid valves on a manifold + air-pressure regulator + a few
 * fittings) and exports a high-res PNG. Verifies the PNG bytes,
 * dimensions, and PNG header signature.
 *
 *   1. Manifold block        Box 200 × 80 × 40 mm   AISI 1018
 *   2. Solenoid valve 1      Cyl Ø 40 × 80 mm       brass
 *   3. Solenoid valve 2      Cyl Ø 40 × 80 mm       brass
 *   4. Solenoid valve 3      Cyl Ø 40 × 80 mm       brass
 *   5. Pressure regulator    Cyl Ø 50 × 100 mm      brass
 *   6. Pressure gauge        Cyl Ø 60 × 25 mm       stainless
 *   7. Mounting bracket      Box 220 × 100 × 4 mm   aluminum
 *
 * Coherence checks:
 *   - PNG signature 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
 *   - Width >= 1200, Height >= 600 (2x the canvas at typical 800x300
 *     test viewport, which yields > 1600x600 typically)
 *   - File size > 5 KB (real rendered content, not empty PNG)
 *   - Renderer size restored after capture (sanity)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf30-snapshot-png');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-30 — Pneumatic controls panel: 2x viewport snapshot exports as valid PNG', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 0,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool && !!window.__archdiscViewport,
    null, { timeout: 60000 });
  await win.evaluate(() => {
    window.__archdiscBypassDialog = true;
    window.localStorage.setItem('archdisc:welcome:v1', '1');
    window.localStorage.setItem('archdisc:splash:lastShownAt', String(Date.now()));
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // Build 7-body pneumatic controls panel.
  const components = [
    { tool: 'Box',      tag: 'Pneumatic-ManifoldBlock-1018' },
    { tool: 'Cylinder', tag: 'Pneumatic-Solenoid1-Brass' },
    { tool: 'Cylinder', tag: 'Pneumatic-Solenoid2-Brass' },
    { tool: 'Cylinder', tag: 'Pneumatic-Solenoid3-Brass' },
    { tool: 'Cylinder', tag: 'Pneumatic-Regulator-Brass' },
    { tool: 'Cylinder', tag: 'Pneumatic-Gauge-Stainless' },
    { tool: 'Box',      tag: 'Pneumatic-Bracket-Aluminum' },
  ];
  for (const c of components) {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(({ tool }) => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool } }));
    }, { tool: c.tool });
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n + 1;
      }, { n: before }, { timeout: 30000 });
    await win.evaluate(({ tag }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (typeof reg.rename === 'function') reg.rename(list[list.length - 1].id, tag);
    }, { tag: c.tag });
  }
  await win.screenshot({ path: path.join(OUT, '01-panel-built.png') });

  // Pre-capture renderer size for the restore-sanity check.
  const preSize = await win.evaluate(() => {
    const r = window.__archdiscViewport?.renderer;
    return {
      width: r?.domElement?.clientWidth ?? null,
      height: r?.domElement?.clientHeight ?? null,
      pixelRatio: r?.getPixelRatio?.() ?? null,
    };
  });

  // Click "Export Snapshot (PNG)" via Drawing ribbon.
  await win.evaluate(() => {
    for (const t of document.querySelectorAll('.ribbon-tab')) {
      if ((t.textContent || '').trim().toLowerCase() === 'drawing') {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
    }
  });
  await win.waitForTimeout(250);
  const click = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.ribbon-tool')) {
      if ((b.textContent || '').includes('Export Snapshot (PNG)')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  expect(click.clicked).toBe(true);

  await win.waitForFunction(() => !!window.__lastSnapshot?.ok, null, { timeout: 30000 });
  const result = await win.evaluate(() => {
    const r = window.__lastSnapshot;
    const u8 = r.pngBytes;
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return {
      ok: r.ok, width: r.width, height: r.height, bytes: r.bytes, filename: r.filename,
      pngBase64: btoa(s),
    };
  });
  console.log('  [snapshot]', JSON.stringify({
    ok: result.ok, width: result.width, height: result.height, bytes: result.bytes, filename: result.filename,
  }));
  expect(result.ok).toBe(true);
  expect(result.filename).toMatch(/\.png$/);
  // 2x multiplier; viewport at test resolution is roughly 2000 x 800.
  expect(result.width).toBeGreaterThan(preSize.width * 1.9);
  expect(result.height).toBeGreaterThan(preSize.height * 1.9);
  expect(result.bytes).toBeGreaterThan(5_000);

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const png = Buffer.from(result.pngBase64, 'base64');
  fs.writeFileSync(path.join(OUT, 'pneumatic-snapshot.png'), png);
  expect(png[0]).toBe(0x89);
  expect(png[1]).toBe(0x50);
  expect(png[2]).toBe(0x4E);
  expect(png[3]).toBe(0x47);
  expect(png[4]).toBe(0x0D);
  expect(png[5]).toBe(0x0A);
  expect(png[6]).toBe(0x1A);
  expect(png[7]).toBe(0x0A);

  // Renderer size restored after the capture.
  const postSize = await win.evaluate(() => {
    const r = window.__archdiscViewport?.renderer;
    return {
      width: r?.domElement?.clientWidth ?? null,
      height: r?.domElement?.clientHeight ?? null,
      pixelRatio: r?.getPixelRatio?.() ?? null,
    };
  });
  expect(postSize.width).toBe(preSize.width);
  expect(postSize.height).toBe(preSize.height);
  expect(postSize.pixelRatio).toBe(preSize.pixelRatio);

  await win.screenshot({ path: path.join(OUT, '02-after-snapshot.png') });
  await app.close();
});
