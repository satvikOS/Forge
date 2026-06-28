// Auto-zoom-to-fit math — pure-function tests for computeCameraFit (cameraFit.js).
// Headless: no DOM, no Electron, no kernel. Uses the real `three` perspective
// camera only to PROJECT the framed box and verify it fills the frame.
// Run: node cameraFit.test.mjs

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeCameraFit } from '../cameraFit.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── Known bounding box: 100 × 30 × 60 at centre (10, 20, -5) ───────────────
const min = new THREE.Vector3(-40, 5, -35);
const max = new THREE.Vector3(60, 35, 25);
const box = new THREE.Box3(min, max);
const expectCenter = [10, 20, -5];
// radius = |diagonal| / 2 = sqrt(100² + 30² + 60²)/2
const expectRadius = Math.sqrt(100 * 100 + 30 * 30 + 60 * 60) / 2; // 60.2079…

const fovDeg = 45;
const aspect = 16 / 9;
const margin = 1.2;              // the auto-fit-on-build padding
const isoDir = [1, -0.7, 1];     // ForgeShellV4's canonical iso view vector

const fit = computeCameraFit(box, { fovDeg, aspect, margin, dir: isoDir });
assert.ok(fit, 'fit result returned');

// ── target == bbox centre (exact) ─────────────────────────────────────────
assert.ok(close(fit.target[0], expectCenter[0]), 'target.x == centre.x');
assert.ok(close(fit.target[1], expectCenter[1]), 'target.y == centre.y');
assert.ok(close(fit.target[2], expectCenter[2]), 'target.z == centre.z');
assert.ok(close(fit.radius, expectRadius, 1e-4), 'bounding-sphere radius');

// ── distance matches the documented formula ───────────────────────────────
//   distance = (radius / tan(fovMin/2)) * margin, fovMin = min(vert, horiz FOV)
const fovV = (fovDeg * Math.PI) / 180;
const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
const fovMin = Math.min(fovV, fovH);
const expectDist = (expectRadius / Math.tan(fovMin / 2)) * margin;
assert.ok(close(fit.distance, expectDist, 1e-4),
  `distance ${fit.distance.toFixed(3)} == formula ${expectDist.toFixed(3)}`);

// ── Build a REAL three camera at the fit pose and project the 8 corners ────
const cam = new THREE.PerspectiveCamera(fovDeg, aspect, fit.near, fit.far);
cam.position.set(fit.position[0], fit.position[1], fit.position[2]);
cam.lookAt(fit.target[0], fit.target[1], fit.target[2]);
cam.updateMatrixWorld();
cam.updateProjectionMatrix();

let boxFill = 0;          // max |ndc| over corners == fraction of half-frame the box spans
let allInside = true;
for (const xx of [min.x, max.x]) {
  for (const yy of [min.y, max.y]) {
    for (const zz of [min.z, max.z]) {
      const p = new THREE.Vector3(xx, yy, zz).project(cam);
      boxFill = Math.max(boxFill, Math.abs(p.x), Math.abs(p.y));
      if (Math.abs(p.x) > 1.0 || Math.abs(p.y) > 1.0) allInside = false;
    }
  }
}

// ── the WHOLE model is inside the frame ────────────────────────────────────
assert.ok(allInside, 'every box corner projects inside the frame (|ndc| <= 1)');

// ── the bbox centre projects to frame centre (model is centred) ────────────
const cNdc = new THREE.Vector3(...expectCenter).project(cam);
assert.ok(Math.abs(cNdc.x) < 0.02 && Math.abs(cNdc.y) < 0.02,
  `bbox centre projects to frame centre (got ${cNdc.x.toFixed(4)}, ${cNdc.y.toFixed(4)})`);

// ── the model FILLS ~70–85 % of the frame (not a tiny mesh on black) ───────
assert.ok(boxFill >= 0.70 && boxFill <= 0.85,
  `box fills 70–85% of frame — got ${(boxFill * 100).toFixed(1)}%`);

console.log(`[fit] dist=${fit.distance.toFixed(2)}  target=${fit.target.join(',')}  ` +
  `fill=${(boxFill * 100).toFixed(1)}%  inside=${allInside}`);

// ── "current view direction" is preserved when no explicit dir is given ────
{
  const currentTarget = [0, 0, 0];
  const currentPosition = [40, 25, 40];   // shell's default iso camera pose
  const f2 = computeCameraFit(box, { fovDeg, aspect, margin, currentPosition, currentTarget });
  assert.ok(f2, 'fit with current view direction returned');
  // camera should sit on the same ray (centre → currentPosition direction).
  const wantDir = new THREE.Vector3(...currentPosition).sub(new THREE.Vector3(...currentTarget)).normalize();
  const gotDir = new THREE.Vector3(...f2.position).sub(new THREE.Vector3(...f2.center)).normalize();
  assert.ok(gotDir.dot(wantDir) > 0.9999, 'camera kept the current view direction');
}

// ── guards: empty / degenerate boxes never frame ───────────────────────────
assert.equal(computeCameraFit(null), null, 'null box → null');
assert.equal(computeCameraFit(new THREE.Box3()), null, 'empty (uninitialised) box → null');
{
  const pt = new THREE.Box3(new THREE.Vector3(5, 5, 5), new THREE.Vector3(5, 5, 5));
  assert.equal(computeCameraFit(pt), null, 'zero-extent box → null');
}

console.log('[fit] cameraFit — all tests passed');
