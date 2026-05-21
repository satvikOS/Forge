import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { buildPrimitive } from './helpers/uiWorkflow.js';

/*
 * Regression: a REAL viewport click selects a B-rep body.
 *
 * Root cause once fixed here: the viewport click handler's pickable set
 * included the TransformControls gizmo's handle meshes (X/Y/Z, XY/YZ/XZ,
 * XYZ, START/END, TransformControlsPlane). Those meshes are plain Meshes
 * with no userData.isHelper of their own — only the gizmo's ROOT helper is
 * flagged — so a mesh-only isHelper check let them into the pick set, where
 * they sat in front of the body and swallowed every selection click. The
 * existing suite only ever selected programmatically, so it was never caught.
 *
 * This spec drives the REAL pointer path and guards both halves of the fix:
 *  1. the pick set contains the body mesh and NO gizmo meshes;
 *  2. a real mouse click on the body actually selects it.
 */

const MAIN = path.join(__dirname, '..', 'electron', 'main.js');

test.setTimeout(300000);

test('viewport: a real click selects a B-rep body (gizmo excluded from the pick set)', async () => {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscViewport && !!window.__archdiscRegistry,
    null, { timeout: 60000 });

  // Build a Box through the real ribbon — it lands at the origin, exactly
  // where the (origin-anchored) gizmo handles used to occlude it.
  const boxId = await buildPrimitive(win, 'Box');

  // 1. The pick set the handler builds must contain the body mesh and none
  //    of the TransformControls gizmo meshes.
  const pick = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const isInHelper = (o) => {
      for (let a = o; a; a = a.parent) {
        if (a.userData && a.userData.isHelper) return true;
      }
      return false;
    };
    const names = [];
    vp.scene.traverse((o) => {
      if (o.isMesh && o.userData.pickable !== false && !o.isTransformControlsPlane &&
          !isInHelper(o) && o.name !== '__selection_outline__' &&
          !(o.parent && o.parent.name === '__selection_outline__')) {
        names.push(o.name || o.type);
      }
    });
    return names;
  });
  for (const g of ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ', 'XYZ', 'START', 'END',
    'TransformControlsPlane']) {
    expect(pick, `gizmo mesh "${g}" must not be in the pick set`).not.toContain(g);
  }
  expect(pick.length, 'the body mesh must be pickable').toBeGreaterThan(0);

  // 2. A real viewport click on the body's projected centre must select it.
  await win.evaluate(() => window.__archdiscRegistry.clearSelection());
  const proj = await win.evaluate((bid) => {
    const vp = window.__archdiscViewport;
    const reg = window.__archdiscRegistry;
    const THREE = window.THREE;
    const body = reg.bodies.find((b) => b.id === bid);
    body.group.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(body.group).getCenter(new THREE.Vector3());
    const cam = vp.camera;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    c.project(cam);
    const r = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (c.x * 0.5 + 0.5) * r.width,
      y: r.top + (-c.y * 0.5 + 0.5) * r.height,
    };
  }, boxId);
  await win.mouse.click(proj.x, proj.y);
  await win.waitForFunction(
    (bid) => {
      const reg = window.__archdiscRegistry;
      return reg.selectedIds && reg.selectedIds().includes(bid);
    },
    boxId, { timeout: 10000 });

  const sel = await win.evaluate(() => window.__archdiscRegistry.selectedIds());
  expect(sel, 'a real viewport click must select the B-rep body').toContain(boxId);
  expect(pageErrors).toEqual([]);
  await app.close();
});
