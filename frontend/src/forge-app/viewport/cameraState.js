/**
 * cameraState — pure helpers for capturing + restoring a viewport camera.
 *
 * The Forge viewport persists camera state in two places:
 *   1. AppState (live, per-session, in-memory).
 *   2. ForgeProject.namedViews[] (serialised with the document).
 *
 * Both paths share this single serialisation shape so a "Named View"
 * round-trips cleanly through `toJSON()` and a screen capture can be
 * restored on a different machine. Keeping the math in a no-React,
 * no-Three module means we can headless-test it without JSDOM.
 *
 * Shape:
 *   {
 *     position:   [x, y, z],
 *     quaternion: [x, y, z, w],   // unit quaternion
 *     target:     [x, y, z],      // OrbitControls.target
 *     zoom:       number,
 *     fov:        number,         // PerspectiveCamera FOV (degrees)
 *     up:         [x, y, z],
 *     timestamp:  number,
 *   }
 */

export const DEFAULT_CAMERA_STATE = Object.freeze({
  position:   [80, 60, 80],
  quaternion: [0, 0, 0, 1],
  target:     [0, 0, 0],
  zoom:       1,
  fov:        50,
  up:         [0, 1, 0],
  timestamp:  0,
});

/**
 * Snapshot a THREE.PerspectiveCamera + (optional) OrbitControls into a
 * plain JSON-safe object.
 *
 * @param {object} camera  — Three.js PerspectiveCamera (or stub with
 *                            `.position`, `.quaternion`, `.zoom`,
 *                            `.fov`, `.up`).
 * @param {object} [controls] — OrbitControls-like (has `.target`).
 * @param {number} [now]      — clock override for tests.
 */
export function captureCamera(camera, controls = null, now = Date.now()) {
  if (!camera) throw new Error('[forge.viewport] captureCamera needs a camera');
  const target = controls && controls.target
    ? [controls.target.x, controls.target.y, controls.target.z]
    : [0, 0, 0];
  return {
    position:   [camera.position.x, camera.position.y, camera.position.z],
    quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z,
                 camera.quaternion.w],
    target,
    zoom:       camera.zoom ?? 1,
    fov:        camera.fov ?? 50,
    up:         camera.up ? [camera.up.x, camera.up.y, camera.up.z] : [0, 1, 0],
    timestamp:  now,
  };
}

/**
 * Push a captured state back onto a live camera + controls. Tolerant of
 * missing fields (uses DEFAULT_CAMERA_STATE for gaps); skips the
 * controls update if `controls` is null.
 */
export function applyCamera(camera, controls, state) {
  if (!camera) throw new Error('[forge.viewport] applyCamera needs a camera');
  const s = { ...DEFAULT_CAMERA_STATE, ...(state || {}) };
  if (camera.position && typeof camera.position.set === 'function') {
    camera.position.set(s.position[0], s.position[1], s.position[2]);
  } else if (camera.position) {
    camera.position.x = s.position[0];
    camera.position.y = s.position[1];
    camera.position.z = s.position[2];
  }
  if (camera.quaternion && typeof camera.quaternion.set === 'function') {
    camera.quaternion.set(s.quaternion[0], s.quaternion[1], s.quaternion[2], s.quaternion[3]);
  } else if (camera.quaternion) {
    camera.quaternion.x = s.quaternion[0];
    camera.quaternion.y = s.quaternion[1];
    camera.quaternion.z = s.quaternion[2];
    camera.quaternion.w = s.quaternion[3];
  }
  if (camera.up && typeof camera.up.set === 'function') {
    camera.up.set(s.up[0], s.up[1], s.up[2]);
  }
  camera.zoom = s.zoom;
  if (Number.isFinite(s.fov)) camera.fov = s.fov;
  if (typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix();
  }
  if (controls && controls.target) {
    if (typeof controls.target.set === 'function') {
      controls.target.set(s.target[0], s.target[1], s.target[2]);
    } else {
      controls.target.x = s.target[0];
      controls.target.y = s.target[1];
      controls.target.z = s.target[2];
    }
    if (typeof controls.update === 'function') controls.update();
  }
  return s;
}

/**
 * Compare two camera states for near-equality. Used by tests and by the
 * named-view UI to decide whether to highlight the "current view" pill.
 */
export function cameraStatesEqual(a, b, eps = 1e-4) {
  if (!a || !b) return false;
  const arr = (v) => Array.isArray(v) ? v : [];
  const vec = (x, y) => {
    const xa = arr(x); const ya = arr(y);
    if (xa.length !== ya.length) return false;
    for (let i = 0; i < xa.length; i++) {
      if (Math.abs(xa[i] - ya[i]) > eps) return false;
    }
    return true;
  };
  return vec(a.position, b.position) &&
         vec(a.quaternion, b.quaternion) &&
         vec(a.target, b.target) &&
         vec(a.up, b.up) &&
         Math.abs((a.zoom ?? 1) - (b.zoom ?? 1)) < eps &&
         Math.abs((a.fov  ?? 50) - (b.fov ?? 50))  < eps;
}
