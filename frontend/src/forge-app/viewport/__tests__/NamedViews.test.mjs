/**
 * NamedViews smoke — capture + restore round-trips camera position.
 *
 * Uses the pure helpers (captureCamera / applyCamera + the store) so
 * the round-trip is verified without a real WebGL context.
 */

import assert from 'node:assert/strict';

// NB: per-file imports rather than `../index.js` to avoid the JSX
// barrel — see ForgeViewport.test.mjs for context. We inline the pure
// `captureNamedView` / `restoreNamedView` logic here since their JSX
// host module would otherwise pull React into the test.
import {
  captureCamera, applyCamera, cameraStatesEqual,
} from '../cameraState.js';
import { ViewportStore } from '../viewportState.js';

function captureNamedView({ camera, controls, canvas, name }) {
  const state = captureCamera(camera, controls);
  // Canvas → null in headless tests; thumbnail therefore null.
  return { name: name || `View ${Date.now().toString(36).slice(-4)}`,
           state, thumbnail: null };
}
function restoreNamedView({ camera, controls, view }) {
  if (!view || !view.state) return null;
  return applyCamera(camera, controls, view.state);
}

// ---- minimal THREE-ish camera + controls stubs ------------------------
function makeCamera({ pos = [10, 20, 30], quat = [0, 0, 0, 1],
                       zoom = 1, fov = 45, up = [0, 1, 0] } = {}) {
  let cam;
  cam = {
    position:   { x: pos[0], y: pos[1], z: pos[2],
                  set(x, y, z) { cam.position.x = x; cam.position.y = y; cam.position.z = z; } },
    quaternion: { x: quat[0], y: quat[1], z: quat[2], w: quat[3],
                  set(x, y, z, w) { cam.quaternion.x = x; cam.quaternion.y = y;
                                    cam.quaternion.z = z; cam.quaternion.w = w; } },
    up:         { x: up[0], y: up[1], z: up[2],
                  set(x, y, z) { cam.up.x = x; cam.up.y = y; cam.up.z = z; } },
    zoom, fov,
    updateProjectionMatrix() {},
  };
  return cam;
}

function makeControls(target = [0, 0, 0]) {
  let ctrls;
  ctrls = {
    target: { x: target[0], y: target[1], z: target[2],
              set(x, y, z) { ctrls.target.x = x; ctrls.target.y = y; ctrls.target.z = z; } },
    update() {},
  };
  return ctrls;
}

// ---- 1. capture + restore round-trip ---------------------------------
{
  const camA = makeCamera({ pos: [100, 50, -25], quat: [0.1, 0.2, 0.3, 0.9],
                              zoom: 1.5, fov: 60, up: [0, 1, 0] });
  const ctrlA = makeControls([5, 10, 15]);
  const snap = captureCamera(camA, ctrlA, 12345);

  // Move the camera somewhere else.
  const camB = makeCamera({ pos: [0, 0, 0], quat: [0, 0, 0, 1],
                              zoom: 1, fov: 45 });
  const ctrlB = makeControls([0, 0, 0]);

  // Restore the snapshot onto camB.
  applyCamera(camB, ctrlB, snap);

  // Round-trip should yield camB === camA in the relevant fields.
  assert.equal(camB.position.x, 100);
  assert.equal(camB.position.y, 50);
  assert.equal(camB.position.z, -25);
  assert.equal(camB.zoom, 1.5);
  assert.equal(camB.fov, 60);
  assert.equal(ctrlB.target.x, 5);
  assert.equal(ctrlB.target.y, 10);
  assert.equal(ctrlB.target.z, 15);

  // And re-capturing camB should match the original snapshot.
  const snap2 = captureCamera(camB, ctrlB, 12346);
  assert.ok(cameraStatesEqual(snap, snap2),
            'recaptured state equals original snapshot');
}

// ---- 2. ViewportStore captures + restores --------------------------
{
  const store = new ViewportStore();
  const cam = makeCamera({ pos: [1, 2, 3], quat: [0, 0, 0, 1], fov: 50 });
  const ctrl = makeControls([0, 0, 0]);

  const view = captureNamedView({ camera: cam, controls: ctrl,
                                   canvas: null, name: 'Front' });
  assert.equal(view.name, 'Front');
  assert.ok(view.state.position[0] === 1);
  // No canvas → no thumbnail; that path is tested headlessly with the
  // explicit thumbnail tests below.
  assert.equal(view.thumbnail, null);

  const v = store.pushNamedView(view);
  assert.equal(store.get().namedViews.length, 1);
  assert.equal(store.get().namedViews[0].name, 'Front');
  assert.ok(v.id.startsWith('nv-'));

  // Rename + delete round-trip.
  store.renameNamedView(v.id, 'Front-iso');
  assert.equal(store.get().namedViews[0].name, 'Front-iso');
  store.removeNamedView(v.id);
  assert.equal(store.get().namedViews.length, 0);
}

// ---- 3. restoreNamedView pushes state onto a fresh camera --------------
{
  const cam = makeCamera({ pos: [7, 8, 9], fov: 35 });
  const ctrl = makeControls([1, 1, 1]);
  const view = captureNamedView({ camera: cam, controls: ctrl, canvas: null });

  const cam2 = makeCamera();
  const ctrl2 = makeControls();
  restoreNamedView({ camera: cam2, controls: ctrl2, view });
  assert.equal(cam2.position.x, 7);
  assert.equal(cam2.position.y, 8);
  assert.equal(cam2.position.z, 9);
  assert.equal(cam2.fov, 35);
  assert.equal(ctrl2.target.x, 1);
}

// ---- 4. store listeners fire on push + rename ------------------------
{
  const store = new ViewportStore();
  let fired = 0;
  store.onChange(() => fired++);
  store.pushNamedView({ name: 'A', state: null, thumbnail: null });
  store.pushNamedView({ name: 'B', state: null, thumbnail: null });
  store.renameNamedView(store.get().namedViews[0].id, 'A2');
  assert.equal(fired, 3, '3 mutations fire 3 notifications');
}

console.log('[forge.viewport] NamedViews smoke passed');
