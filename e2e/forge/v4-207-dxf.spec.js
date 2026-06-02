// v4-207-dxf.spec.js — Forge-207 DXF round-trip.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-207-dxf';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-207 · DXF round-trip', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.dxf
         && typeof window.forge.dxf.parse === 'function'
         && typeof window.forge.dxf.write === 'function'));
    expect(has).toBe(true);
  });

  test('02 write a LINE + CIRCLE produces valid DXF text (cam #1)', async () => {
    const out = await page.evaluate(() => window.forge.dxf.write({
      entities: [
        { type: 'line', layer: '0', x0: 0, y0: 0, x1: 10, y1: 5,
          radius: 0, startAngleDeg: 0, endAngleDeg: 0,
          closed: false, vertices: new Float64Array() },
        { type: 'circle', layer: 'HOLES', x0: 5, y0: 5, x1: 0, y1: 0,
          radius: 2.5, startAngleDeg: 0, endAngleDeg: 0,
          closed: false, vertices: new Float64Array() },
      ],
    }));
    expect(out).toMatch(/SECTION/);
    expect(out).toMatch(/ENTITIES/);
    expect(out).toMatch(/LINE/);
    expect(out).toMatch(/CIRCLE/);
    expect(out).toMatch(/HOLES/);
    expect(out).toMatch(/EOF/);
    await shot(page, 'write-text');
  });

  test('03 round-trip preserves entity counts + values (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const fixture = window.__forgeDxfFixture;
      const text = window.forge.dxf.write(fixture);
      const parsed = window.forge.dxf.parse(text);
      return {
        count: parsed.entities.length,
        firstX1:    parsed.entities[0].x1,
        circleR:    parsed.entities[2].radius,
        arcEndDeg:  parsed.entities[3].endAngleDeg,
        polyClosed: parsed.entities[4].closed,
        polyVerts:  parsed.entities[4].vertices.length,
      };
    });
    expect(r.count).toBe(5);
    expect(r.firstX1).toBeCloseTo(30, 6);
    expect(r.circleR).toBeCloseTo(3, 6);
    expect(r.arcEndDeg).toBeCloseTo(180, 6);
    expect(r.polyClosed).toBe(true);
    expect(r.polyVerts).toBe(8);
    await shot(page, 'roundtrip');
  });

  test('04 unknown entity types are skipped (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const text = `  0\nSECTION\n  2\nENTITIES\n` +
                   `  0\nLINE\n  8\n0\n 10\n0\n 20\n0\n 11\n1\n 21\n0\n` +
                   `  0\nXSPLINE\n  8\n0\n  0\nCIRCLE\n  8\n0\n 10\n0\n 20\n0\n 40\n2\n` +
                   `  0\nENDSEC\n  0\nEOF\n`;
      return window.forge.dxf.parse(text);
    });
    expect(r.entities.length).toBe(2);   // XSPLINE is unknown → skipped
    expect(r.entities[0].type).toBe('line');
    expect(r.entities[1].type).toBe('circle');
    await shot(page, 'unknown-skipped');
  });

  test('05 panel open (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenDxfWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-dxf-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-dxf-parse"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('06 panel parse displays counts (cam #5)', async () => {
    await page.locator('[data-testid="forge-dxf-parse"]').click();
    await page.waitForSelector('[data-testid="forge-dxf-counts"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-dxf-counts"]')).toBeVisible();
    const text = await page.locator('[data-testid="forge-dxf-counts"]').innerText();
    expect(text).toMatch(/lines\s+2/);
    expect(text).toMatch(/circles\s+1/);
    expect(text).toMatch(/arcs\s+1/);
    expect(text).toMatch(/lwpolylines\s+1/);
    await shot(page, 'panel-counts');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
