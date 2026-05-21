/**
 * motionCapture.js — shared "operation in motion" capture layer for ArchDisc
 * e2e specs.
 *
 * WHY: closing specs used to orbit a FINISHED model and screenshot it from 36
 * angles — the reviewer saw "different models but not operations being worked
 * on them in motion". This helper records the whole workflow as a .webm video
 * AND drops key-frame stills, driven by REAL viewport clicks + drag-orbits, so
 * the artifacts show the exact human user workflow.
 *
 * Step-0 browser findings (playwright.dev, fetched 2026-05-20):
 *   - electron.launch() OPTIONS include `recordVideo` ({ dir, size }). The
 *     video is flushed to disk on app close; the path is retrieved via
 *     `page.video().path()` AFTER close.
 *   - `slowMo` IS accepted by `_electron.launch()` (recon verdict B — no throw,
 *     window opens, actions are paced). We pass it AND additionally pace the
 *     interaction helpers with explicit waits so the recording has watchable
 *     beats even on fast machines.
 *   - mouse.move(x,y,{steps}) emits `steps` interpolated mousemove events —
 *     used for smooth, video-visible cursor travel and drag-orbits.
 *
 * Recon verdicts baked into this helper (see motion-recon-electron.spec.js):
 *   C  real viewport click selects a body: worldToScreen(centroid) →
 *      mouse.move(steps) → mouse.click; verified via registry.selectedIds().
 *   D  the viewport click handler has NO shift/ctrl branch — modifier-click
 *      REPLACES the selection. addToSelection() therefore selects body 1 with
 *      a real click, then uses registry.selectMany([...]) to add body 2 (the
 *      same API the Body Browser panel uses). Documented, not hidden.
 *   E  drag-orbit: mouse.move(centre) → down → move(+dx,+dy,{steps}) → up.
 *
 * Artifacts land in:  test-results/motion/<specName>/
 *   00-session.webm   the full workflow recording
 *   NN-<label>.png    auto-incrementing key-frame stills
 *
 * Imports use BARE specifiers (no node:) so Playwright can load the spec.
 */

import { _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'electron', 'main.js');

// Pacing (ms) — gives the video watchable beats. slowMo handles per-action
// pacing; these are explicit pauses around the meaningful moments.
const BEAT = {
  beforeMouse: 220,
  afterMouse:  260,
  afterDialog: 600,
  afterOp:     700,
};

/**
 * Launch Electron with video recording into test-results/motion/<specName>/.
 *
 * @param {string} specName  short kebab name, e.g. 'brep-g-catmullclark'
 * @returns {Promise<{app,win,pageErrors,story,motionDir}>}
 */
export async function launchWithCapture(specName) {
  const motionDir = path.join(ROOT, 'test-results', 'motion', specName);
  fs.mkdirSync(motionDir, { recursive: true });
  // Clear stale stills/webm from a prior run so artifacts are unambiguous.
  for (const f of fs.readdirSync(motionDir)) {
    if (f.endsWith('.png') || f.endsWith('.webm')) {
      try { fs.rmSync(path.join(motionDir, f)); } catch { /* ignore */ }
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    // slowMo paces every action so the recording is human-watchable
    // (recon verdict B: accepted by _electron.launch).
    slowMo: 180,
    recordVideo: { dir: motionDir, size: { width: 1280, height: 800 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await win.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  // The viewport internals exposure is required by worldToScreen / clickBody /
  // dragOrbit. WorkbenchMechanical mounts Viewport3D which sets it.
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  const story = makeStory(win, app, motionDir, specName);
  return { app, win, pageErrors, story, motionDir };
}

/**
 * Storyboard frame capture. `story.frame(label)` writes an auto-incrementing
 * NN-<label>.png of the WHOLE window. `story.finish()` (call AFTER app.close())
 * renames the recorded webm to 00-session.webm and logs the absolute path.
 */
function makeStory(win, app, motionDir, specName) {
  let n = 0;
  const frames = [];
  return {
    motionDir,
    /**
     * Screenshot the whole window into NN-<label>.png. A brief settle lets
     * Three.js finish its render call so the frame isn't mid-paint.
     */
    async frame(label) {
      n += 1;
      const nn = String(n).padStart(2, '0');
      const safe = String(label || 'frame').replace(/[^a-z0-9_-]/gi, '-');
      const file = path.join(motionDir, `${nn}-${safe}.png`);
      await win.waitForTimeout(120);
      await win.screenshot({ path: file });
      frames.push(file);
      return file;
    },
    /** All still paths captured so far. */
    frames() { return frames.slice(); },
    /**
     * Resolve + rename the recorded video. MUST be called after app.close()
     * because Playwright only flushes the webm on close (Step-0 finding).
     */
    async finish() {
      let videoPath = null;
      try {
        const v = typeof win.video === 'function' ? win.video() : null;
        if (v) videoPath = await v.path();
      } catch { videoPath = null; }
      if (!videoPath || !fs.existsSync(videoPath)) {
        // Fallback: scan the dir for any .webm Playwright dropped.
        const found = fs.readdirSync(motionDir).filter(f => f.endsWith('.webm'));
        if (found.length) videoPath = path.join(motionDir, found[0]);
      }
      let sessionPath = null;
      if (videoPath && fs.existsSync(videoPath)) {
        sessionPath = path.join(motionDir, '00-session.webm');
        try {
          if (videoPath !== sessionPath) {
            if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath);
            fs.renameSync(videoPath, sessionPath);
          }
        } catch {
          // Cross-device or lock — fall back to copy.
          try { fs.copyFileSync(videoPath, sessionPath); } catch { sessionPath = videoPath; }
        }
      }
      const size = sessionPath && fs.existsSync(sessionPath)
        ? fs.statSync(sessionPath).size : 0;
      // eslint-disable-next-line no-console
      console.log(`  [motion] ${specName}: video=${sessionPath || '(none)'} ` +
        `(${size} bytes), ${frames.length} stills in ${motionDir}`);
      return { videoPath: sessionPath, videoSize: size, stills: frames.slice() };
    },
  };
}

// ─── Real viewport interaction ──────────────────────────────────────────────

/**
 * Project a body's world-space bbox centroid through the live Three.js
 * camera to a viewport CSS pixel. Returns { x, y } or null if the body
 * has no mesh / does not project.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} bodyId  BodyRegistry id, e.g. 'body-001'
 * @returns {Promise<{x:number,y:number}|null>}
 */
export async function worldToScreen(win, bodyId) {
  return win.evaluate((bid) => {
    const vp = window.__archdiscViewport;
    const reg = window.__archdiscRegistry;
    const THREE = window.THREE;
    if (!vp || !reg || !THREE) return null;
    const body = reg.bodies.find(b => b.id === bid);
    if (!body || !body.group) return null;
    const group = body.group;
    group.updateMatrixWorld(true);
    // World-space bbox via THREE's own Box3.setFromObject — the SAME routine
    // the app's focus framing (focusOnObject) uses, so the projected centre is
    // exactly where the body is rendered. An earlier hand-rolled matrix
    // projection drifted off the body and every clickBody attempt missed.
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const centre = box.getCenter(new THREE.Vector3());
    const cam = vp.camera;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    // Vector3.project = applyMatrix4(matrixWorldInverse) then
    // applyMatrix4(projectionMatrix) with the perspective divide → NDC.
    const ndc = centre.clone().project(cam);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
    };
  }, bodyId);
}

/** Read the registry's current selected body ids. */
async function selectedIds(win) {
  return win.evaluate(() =>
    (window.__archdiscRegistry && window.__archdiscRegistry.selectedIds
      ? window.__archdiscRegistry.selectedIds() : []));
}

/**
 * Frame a body dead-centre in the viewport using the app's own
 * __archdiscFocusOnObject hook (the same camera framing the Body Browser
 * row-click uses). This is what a real CAD user does — orbit/fit so the
 * part they want is comfortably centred — and it guarantees the body's
 * projected centroid lands inside the canvas, unoccluded, before a click.
 */
async function frameBody(win, bodyId) {
  await win.evaluate((bid) => {
    const reg = window.__archdiscRegistry;
    const body = reg && reg.bodies.find(b => b.id === bid);
    if (body && body.group && typeof window.__archdiscFocusOnObject === 'function') {
      window.__archdiscFocusOnObject(body.group);
    }
  }, bodyId);
  await win.waitForTimeout(280);
}

/**
 * Wait until the camera stops moving. focusOnObject sets the camera then
 * OrbitControls damping eases it over many frames — projecting / clicking
 * mid-ease lands on a stale pixel. Resolves once two reads agree, or on a
 * timeout (best-effort).
 */
async function waitForCameraSettled(win, timeoutMs = 4000) {
  const t0 = Date.now();
  let prev = null;
  while (Date.now() - t0 < timeoutMs) {
    const p = await win.evaluate(() => {
      const c = window.__archdiscViewport.camera.position;
      return { x: c.x, y: c.y, z: c.z };
    });
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) < 1e-6) return;
    prev = p;
    await win.waitForTimeout(140);
  }
}

/**
 * Find a viewport CSS pixel whose NEAREST pickable hit is the target body.
 *
 * This is the robust replacement for projecting a bbox centroid: it scans a
 * grid of screen points (centre-outward) and raycasts each through the live
 * camera against the SAME pickable mesh set the app's handleClick uses. The
 * first point whose nearest hit belongs to the target body's group is
 * returned — so a click there is guaranteed to pick this body, immune to
 * projection error, perspective foreshortening and occlusion by other bodies.
 *
 * @returns {Promise<{x:number,y:number}|null>}
 */
async function findBodyScreenPoint(win, bodyId) {
  return win.evaluate((bid) => {
    const vp = window.__archdiscViewport;
    const reg = window.__archdiscRegistry;
    const THREE = window.THREE;
    if (!vp || !reg || !THREE) return null;
    const body = reg.bodies.find(b => b.id === bid);
    if (!body || !body.group) return null;
    const targetGroup = body.group;
    targetGroup.updateMatrixWorld(true);
    const inTarget = (o) => {
      let p = o;
      while (p) { if (p === targetGroup) return true; p = p.parent; }
      return false;
    };
    // Same pickable filter as Viewport3D.handleClick — so the scan respects
    // occlusion: we want a pixel whose nearest hit IS the target body. The
    // ancestor isHelper walk excludes the TransformControls gizmo subtree
    // (its handle meshes carry no flag of their own).
    const isInHelper = (o) => {
      for (let a = o; a; a = a.parent) {
        if (a.userData && a.userData.isHelper) return true;
      }
      return false;
    };
    const pickable = [];
    vp.scene.traverse((o) => {
      if (o.isMesh && o.userData.pickable !== false && !o.isTransformControlsPlane &&
          !isInHelper(o) && o.name !== '__selection_outline__' &&
          !(o.parent && o.parent.name === '__selection_outline__')) {
        pickable.push(o);
      }
    });
    if (!pickable.length) return null;
    const cam = vp.camera;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const rect = vp.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const N = 25;
    const c = (N - 1) / 2;
    const cells = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) cells.push([gx, gy]);
    }
    // Centre-outward so we pick a central, robust point on the body.
    cells.sort((a, b) =>
      Math.hypot(a[0] - c, a[1] - c) - Math.hypot(b[0] - c, b[1] - c));
    for (const [gx, gy] of cells) {
      const fx = (gx + 0.5) / N, fy = (gy + 0.5) / N;
      ndc.x = fx * 2 - 1;
      ndc.y = -(fy * 2 - 1);
      ray.setFromCamera(ndc, cam);
      const hits = ray.intersectObjects(pickable, false);
      if (hits.length && inTarget(hits[0].object)) {
        return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
      }
    }
    return null;
  }, bodyId);
}

/**
 * Select a body with a REAL viewport mouse click.
 *
 * Mirrors a real user: frame the body so it is comfortably on-screen, let the
 * camera settle, then click a pixel that is RAYCAST-VERIFIED to land on the
 * body (findBodyScreenPoint), and poll the registry to confirm. Re-verifies
 * the pixel after the (slow-mo-paced) cursor travel in case the camera moved.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} bodyId
 * @param {{clearFirst?:boolean,frame?:boolean}} [opts]
 *        clearFirst (default true) clears prior selection first.
 *        frame     (default true) frames the body before clicking.
 */
export async function clickBody(win, bodyId, opts = {}) {
  const clearFirst = opts.clearFirst !== false;
  const doFrame = opts.frame !== false;
  if (clearFirst) {
    await win.evaluate(() => window.__archdiscRegistry.clearSelection());
  }
  if (doFrame) await frameBody(win, bodyId);

  for (let attempt = 0; attempt < 4; attempt++) {
    await waitForCameraSettled(win);
    let pt = await findBodyScreenPoint(win, bodyId);
    if (!pt) {
      // Body not on screen at all — re-frame and retry.
      if (doFrame) await frameBody(win, bodyId);
      continue;
    }
    await win.waitForTimeout(BEAT.beforeMouse);
    await win.mouse.move(pt.x, pt.y, { steps: 16 }); // visible cursor travel
    // Re-verify after the paced travel — the camera may have eased meanwhile.
    await waitForCameraSettled(win);
    pt = (await findBodyScreenPoint(win, bodyId)) || pt;
    await win.waitForTimeout(120);
    await win.mouse.click(pt.x, pt.y);
    await win.waitForTimeout(BEAT.afterMouse);
    // Poll ~1.8 s for the selection to register.
    let sel = [];
    for (let p = 0; p < 8; p++) {
      sel = await selectedIds(win);
      if (sel.includes(bodyId)) {
        await win.waitForTimeout(120);
        return;
      }
      await win.waitForTimeout(220);
    }
    // eslint-disable-next-line no-console
    console.log(`  [clickBody] ${bodyId} attempt ${attempt + 1} miss ` +
      `at ${pt.x.toFixed(0)},${pt.y.toFixed(0)} (selected=${JSON.stringify(sel)})`);
    if (doFrame) await frameBody(win, bodyId);
  }
  throw new Error(`clickBody: real viewport click never selected ${bodyId}`);
}

/**
 * Add a SECOND body to the current selection via the most-robust real-input
 * path discovered in recon (verdict D).
 *
 * The viewport click handler (Viewport3D.jsx handleClick) has NO shift/ctrl
 * modifier branch — a modifier-click simply REPLACES the selection. So a
 * genuine 2-body selection cannot be reached by viewport modifier-clicks.
 * The robust path: a real viewport click positions the cursor over the 2nd
 * body (visible in the video), then registry.selectMany([...current, id])
 * adds it — the SAME multi-select API the Body Browser panel rows drive.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} bodyId  the body to ADD to the existing selection
 */
export async function addToSelection(win, bodyId) {
  const before = await selectedIds(win);
  // Visible cursor travel to the body being added (so the video shows intent).
  const proj = await worldToScreen(win, bodyId);
  if (proj) {
    await win.waitForTimeout(BEAT.beforeMouse);
    await win.mouse.move(proj.x, proj.y, { steps: 18 });
    await win.waitForTimeout(BEAT.afterMouse);
  }
  // Add via the registry multi-select API (Body Browser uses the same).
  const next = before.includes(bodyId) ? before : before.concat([bodyId]);
  await win.evaluate((ids) => {
    window.__archdiscRegistry.selectMany(ids);
  }, next);
  await win.waitForTimeout(220);
  const after = await selectedIds(win);
  if (!after.includes(bodyId)) {
    throw new Error(`addToSelection: ${bodyId} not in selection after selectMany`);
  }
}

/**
 * Perform a REAL drag-orbit on the viewport canvas: move to the canvas
 * centre, press, drag (interpolated steps — visible in the recording),
 * release. Returns the camera-position delta so callers can assert motion.
 *
 * @param {import('@playwright/test').Page} win
 * @param {{dx?:number,dy?:number,steps?:number}} [opts]
 * @returns {Promise<number>} camera position delta magnitude
 */
export async function dragOrbit(win, opts = {}) {
  const dx = opts.dx ?? 200;
  const dy = opts.dy ?? 80;
  const steps = opts.steps ?? 24;
  const box = await win.locator('canvas').first().boundingBox();
  if (!box) throw new Error('dragOrbit: canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const camBefore = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  });
  await win.mouse.move(cx, cy, { steps: 8 });
  await win.waitForTimeout(BEAT.beforeMouse);
  await win.mouse.down();
  await win.mouse.move(cx + dx, cy + dy, { steps });
  await win.waitForTimeout(120);
  await win.mouse.up();
  await win.waitForTimeout(BEAT.afterMouse);
  const camAfter = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  });
  return Math.hypot(
    camAfter.x - camBefore.x,
    camAfter.y - camBefore.y,
    camAfter.z - camBefore.z,
  );
}

/** Pacing constants, exported so retrofitted specs can reuse the beats. */
export const MOTION_BEATS = BEAT;
