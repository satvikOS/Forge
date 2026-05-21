import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { buildPrimitive } from './helpers/uiWorkflow.js';

/*
 * Viewport workflow — freeze reproduction.
 *
 * Runs a COMPLETE real CAD workflow (build a base plate, build a boss,
 * select each, orbit to inspect, deselect, re-select) entirely through
 * REAL viewport mouse input — real clicks to select, real drag-orbits to
 * inspect — exactly as a user works. The existing suite only ever selects
 * programmatically, so the real pointerup handler (handleClick) is never
 * exercised by tests; this spec is the first to drive it.
 *
 * Instrumentation:
 *  - a 25ms setInterval heartbeat — if the main thread freezes, ticks stall.
 *  - every real click / drag-orbit is wall-clock timed (the pointerup
 *    handler runs synchronously, so a frozen handler shows up as a long
 *    mouse-call duration).
 *  - orbitControls.enabled / enableRotate are read after each interaction
 *    (a soft freeze = orbit silently disabled).
 *
 * The spec FAILS if any interaction takes >2s or leaves orbit disabled.
 */

test.setTimeout(300000);

test('viewport workflow — real clicks and drag-orbits must not freeze', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 120000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport && !!window.__archdiscRegistry,
    null, { timeout: 60000 });

  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  const consoleLogs = [];
  win.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));

  // ── Main-thread freeze detector ──────────────────────────────────────────
  await win.evaluate(() => {
    window.__hb = { ticks: 0 };
    window.__hbTimer = setInterval(() => { window.__hb.ticks++; }, 25);
  });

  const canvasBox = () => win.evaluate(() => {
    const c = window.__archdiscViewport.renderer.domElement;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height,
             cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  const bodyScreenPos = (bodyId) => win.evaluate((id) => {
    const THREE = window.THREE;
    const vp = window.__archdiscViewport;
    const reg = window.__archdiscRegistry;
    const entry = reg.bodies.find((b) => b.id === id);
    if (!entry || !entry.group) return null;
    const box = new THREE.Box3().setFromObject(entry.group);
    const c = box.getCenter(new THREE.Vector3());
    c.project(vp.camera);
    const canvas = vp.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (c.x * 0.5 + 0.5) * r.width,
             y: r.top + (-c.y * 0.5 + 0.5) * r.height };
  }, bodyId);

  const probeFlags = () => win.evaluate(() => ({
    enabled: window.__archdiscViewport.orbitControls.enabled,
    enableRotate: window.__archdiscViewport.orbitControls.enableRotate,
  }));

  const report = [];

  const realClick = async (label, x, y) => {
    console.log('>>> ' + label);
    const hb0 = await win.evaluate(() => window.__hb.ticks);
    const t0 = Date.now();
    await win.mouse.click(x, y);
    const ms = Date.now() - t0;
    const hb1 = await win.evaluate(() => window.__hb.ticks);
    const flags = await probeFlags();
    const r = { label, kind: 'click', ms, hbDelta: hb1 - hb0, ...flags };
    report.push(r);
    console.log('    ' + JSON.stringify(r));
  };

  const realOrbit = async (label, cx, cy) => {
    console.log('>>> ' + label);
    const hb0 = await win.evaluate(() => window.__hb.ticks);
    const t0 = Date.now();
    await win.mouse.move(cx, cy);
    await win.mouse.down();
    await win.mouse.move(cx + 220, cy + 70, { steps: 24 });
    await win.mouse.up();
    const ms = Date.now() - t0;
    const hb1 = await win.evaluate(() => window.__hb.ticks);
    const flags = await probeFlags();
    const r = { label, kind: 'orbit', ms, hbDelta: hb1 - hb0, ...flags };
    report.push(r);
    console.log('    ' + JSON.stringify(r));
  };

  // ── THE WORKFLOW — build a 2-body part, select/orbit as a user would ─────
  const cb = await canvasBox();

  const boxId = await buildPrimitive(win, 'Box');
  await realOrbit('orbit — inspect base plate', cb.cx, cb.cy);

  let p = await bodyScreenPos(boxId);
  await realClick('click — select base plate', p.x, p.y);
  await realOrbit('orbit — base plate selected (gizmo present)', cb.cx, cb.cy);

  const cylId = await buildPrimitive(win, 'Cylinder');
  p = await bodyScreenPos(cylId);
  await realClick('click — select boss', p.x, p.y);
  await realOrbit('orbit — boss selected', cb.cx, cb.cy);

  await realClick('click — empty space (deselect)', cb.x + 14, cb.y + 14);
  await realOrbit('orbit — after deselect', cb.cx, cb.cy);

  p = await bodyScreenPos(boxId);
  await realClick('click — re-select base plate', p.x, p.y);
  await realOrbit('orbit — final', cb.cx, cb.cy);

  // ── Report ───────────────────────────────────────────────────────────────
  console.log('\n===== FREEZE REPORT =====');
  for (const r of report) console.log(JSON.stringify(r));
  console.log('PAGE ERRORS:', JSON.stringify(pageErrors));
  const interesting = consoleLogs.filter((l) => /freeze|error|warn|Maximum|exceed/i.test(l));
  if (interesting.length) console.log('CONSOLE (filtered):\n' + interesting.join('\n'));
  console.log('=========================\n');

  // ── Assertions: no interaction may freeze the viewport ───────────────────
  for (const r of report) {
    expect(r.ms, `${r.label}: took ${r.ms}ms (freeze threshold 2000ms)`).toBeLessThan(2000);
    expect(r.enabled, `${r.label}: orbitControls.enabled must stay true`).toBe(true);
    expect(r.enableRotate, `${r.label}: orbitControls.enableRotate must stay true`).toBe(true);
  }
  expect(pageErrors, 'no renderer errors during the workflow').toEqual([]);

  await app.close();
});
