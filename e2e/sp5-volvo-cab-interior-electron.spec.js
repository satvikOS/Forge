import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-5 — Volvo FH cab interior (Video-21 parity sub-project 5).
 *
 * Driver+passenger seats (base + back + headrest), steering wheel
 * (rim + boss + 3 spokes), steering column, dashboard, instrument
 * cluster, gear shifter (with yellow knob), 3 foot pedals, 4 AC
 * vents, 2 door cards, 2 sun visors, centre console, cup holders,
 * sleeper bunk, headliner. All UI-only.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp5-volvo-cab-interior');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-5 — Volvo FH cab interior built UI-only', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.error('[pageerror]', err.message));
  win.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[renderer:error] ${msg.text()}`);
  });

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }

  const bodyCount = () => win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  const clickTab = (k) => win.locator(`[data-ribbon-tab-key="${k}"]`).dispatchEvent('click');
  const clickTool = async (n) => {
    const btn = win.locator(`[data-ribbon-tool-name="${n}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.dispatchEvent('click');
  };

  const captureAllAngles = async (label) => {
    await win.evaluate(() => {
      if (typeof window.__archdiscFrameAll === 'function') window.__archdiscFrameAll();
      if (typeof window.__archdiscSetOrbitBase === 'function') window.__archdiscSetOrbitBase();
    });
    await win.waitForTimeout(150);
    const angles = [
      { name: 'iso',        az:  25, el:  15, zoom: 1.0 },
      { name: 'driver',     az:  60, el:   0, zoom: 0.5 },
      { name: 'passenger',  az: -60, el:   0, zoom: 0.5 },
      { name: 'rear',       az: 180, el:  10, zoom: 1.0 },
      { name: 'top-down',   az:   0, el:  85, zoom: 1.0 },
      { name: 'wheel-close', az: 55, el: -10, zoom: 0.25 },
      { name: 'dash-close', az:  35, el: -10, zoom: 0.35 },
      { name: 'wide',       az:  25, el:  15, zoom: 1.6 },
    ];
    for (const a of angles) {
      await win.evaluate((c) => window.__archdiscOrbitView?.(c.az, c.el, c.zoom), a);
      await win.waitForTimeout(180);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  const openStd = async () => {
    await clickTool('Standards Library');
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'visible', timeout: 10000 });
    await win.waitForTimeout(180);
  };
  const cat = (c) => win.locator(`.standards-library-dialog .category-tree .cat button:text-is("${c}")`).first().dispatchEvent('click');
  const leaf = (n) => win.locator(`.standards-library-dialog .category-tree li button:text-is("${n}")`).first().dispatchEvent('click');
  const setPR = async (x, y, z, rx = 0, ry = 0, rz = 0) => {
    const rows = win.locator('.standards-library-dialog .position-row');
    const pos = rows.nth(0).locator('input');
    await pos.nth(0).fill(String(x));
    await pos.nth(1).fill(String(y));
    await pos.nth(2).fill(String(z));
    const rot = rows.nth(1).locator('input');
    await rot.nth(0).fill(String(rx));
    await rot.nth(1).fill(String(ry));
    await rot.nth(2).fill(String(rz));
  };
  const place = async (leafName, x, y, z, rx = 0, ry = 0, rz = 0) => {
    await openStd();
    await cat('Automotive');
    await leaf(leafName);
    await setPR(x, y, z, rx, ry, rz);
    const before = await bodyCount();
    await win.evaluate(() => document.querySelector('[data-testid="sl-place-btn"]')?.click());
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'hidden', timeout: 120000 });
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 120000 });
    return (await bodyCount()) - before;
  };

  await captureAllAngles('00-empty');
  await clickTab('part');

  // Origin = cab floor centre. Driver = X<0 side, passenger = X>0.

  // ─── Phase 1: seats (driver + passenger) — base + back + headrest ─────
  for (const driver of [-1, 1]) {
    const x = driver * 500;
    await place('Driver Seat Base', x - 300, 0, -200);
    await place('Driver Seat Back', x - 300, 100, -700);
    await place('Seat Headrest',    x - 140, 880, -780);
  }
  await captureAllAngles('01-seats');

  // ─── Phase 2: steering wheel assembly ─────────────────────────────────
  // Driver side (-X). Rim at z=-100, slightly tilted toward driver.
  await place('Steering Wheel Rim', -500, 750, -100, 90, 0, 0);
  await place('Steering Wheel Boss', -500, 750, -100);
  // 3 spokes at 120° around centre
  for (let i = 0; i < 3; i++) {
    const ang = (i * 120) - 90;
    await place('Steering Wheel Spoke', -500, 750, -100, 90, 0, ang);
  }
  await place('Steering Column', -500, 750, -260);
  await captureAllAngles('02-steering');

  // ─── Phase 3: dashboard + instrument cluster ──────────────────────────
  await place('Dashboard', -1100, 600, 0);
  await place('Instrument Cluster', -800, 820, 80);
  await captureAllAngles('03-dashboard');

  // ─── Phase 4: gear shifter + foot pedals ──────────────────────────────
  await place('Gear Shifter', -200, 240, -350);
  // 3 pedals (clutch / brake / accel)
  for (let i = 0; i < 3; i++) {
    await place('Foot Pedal', -800 + i * 130, -200, 50);
  }
  await captureAllAngles('04-shifter-pedals');

  // ─── Phase 5: AC vents (4 across the dashboard) ───────────────────────
  await openStd();
  await cat('Automotive');
  await leaf('AC Vent');
  await setPR(-900, 680, 380, 0, 0, 0);
  await win.locator('.standards-library-dialog select#sl-pattern')
    .waitFor({ state: 'attached', timeout: 1000 }).catch(() => {});
  // Pattern mode placeholder — single dialog opening only supports single
  // placement; do 4 single placements instead.
  await win.evaluate(() => document.querySelector('[data-testid="sl-place-btn"]')?.click());
  await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'hidden', timeout: 60000 });
  for (const x of [-300, 300, 900]) {
    await place('AC Vent', x, 680, 380);
  }

  // ─── Phase 6: door cards (driver + passenger) ─────────────────────────
  await place('Door Card', -1240, 0, -1100, 0, 90, 0);
  await place('Door Card',  1240, 0, -1100, 0, 90, 0);

  // ─── Phase 7: interior sun visors + centre console ────────────────────
  await place('Sun Visor Interior', -600, 1450, 100, 30, 0, 0);
  await place('Sun Visor Interior',  600, 1450, 100, 30, 0, 0);
  await place('Centre Console', 0, 0, -400);

  // ─── Phase 8: cup holders (2 on centre console) ───────────────────────
  await place('Cup Holder',  100, 240, -200);
  await place('Cup Holder', -100, 240, -200);

  // ─── Phase 9: sleeper bunk (behind seats) + headliner ─────────────────
  await place('Sleeper Bunk', -1100, 100, -1800);
  await place('Headliner', -1200, 1500, -2000);
  await captureAllAngles('09-bunk-headliner');

  // ─── Final ────────────────────────────────────────────────────────────
  const finalCount = await bodyCount();
  console.log(`SP-5 — final body count: ${finalCount}`);
  expect(finalCount).toBeGreaterThanOrEqual(25);
  await captureAllAngles('99-final');
  await app.close();
});
