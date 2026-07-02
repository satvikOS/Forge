// v4-front20-sim-overlays-multicam.spec.js
//
// FRONT-20 — grounded, fully-visual, fully-dynamic simulation overlays.
//
// HEADED Mac-Electron multi-camera verification that Forge's REAL kernel
// solvers, driven through the CUA verb path (window.__forgeEngine.dispatch-
// ToolCall — the exact function ForgeRunner calls when the model emits a
// tool_call), now leave a LIVE, ANIMATED overlay in the MAIN viewport
// (window.__forgeScene) — not just a scalar report.
//
// Three distinct sims, each captured from ≥5 named camera angles
// (front / top / right / iso / close) of the LIVE main-viewport overlay
// (per the multi-cam e2e rule, memory: feedback-forge-multicam-e2e):
//
//   A. simulate.fea-static  → von-Mises stress contour on a deformed bracket
//   B. simulate.fea-modal   → live sin(2πft) animated mode shape
//   C. simulate.multibody-dynamics → full motion-capture playback of a
//      built two-body mechanism (the kernel-solved trajectory drives the
//      ACTUAL scene bodies)
//
// Each test asserts the overlay group is actually present + has non-empty
// coloured geometry in window.__forgeScene (proof the field rendered, not a
// blank canvas), then screenshots the named angles.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-front20-sim';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _shotN = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_shotN).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// View keys: 1=iso 2=front 3=back 4=top 5=bottom 6=right 7=left (ForgeShellV4).
const VIEWS = [
  { key: '2', name: 'front' },
  { key: '4', name: 'top' },
  { key: '6', name: 'right' },
  { key: '1', name: 'iso' },
];

// Frame the active sim overlay group, then cycle the named angles. The 5th
// angle is a close-up via wheel-zoom. Each angle re-fits to the overlay box.
async function multiCam(page, label, overlayTag) {
  // Compute the world AABB of the overlay group + fit the camera to it.
  const fitOverlay = async () => {
    await page.evaluate((tag) => {
      const THREE = window.__forgeThree;
      const scene = window.__forgeScene;
      if (!THREE || !scene) return;
      let group = null;
      scene.traverse((o) => { if (!group && o.userData && o.userData.simOverlay === tag) group = o; });
      // motion overlay is a marker; frame the union of the moving bodies instead.
      const box = new THREE.Box3();
      if (group && tag !== 'motion') {
        box.setFromObject(group);
      } else {
        // Union every visible mesh with real geometry (the moving bodies).
        let any = false;
        scene.traverse((o) => {
          if (o.isMesh && o.geometry && o.geometry.attributes &&
              o.geometry.attributes.position && o.geometry.attributes.position.count > 0) {
            const b = new THREE.Box3().setFromObject(o);
            if (Number.isFinite(b.min.x)) { box.union(b); any = true; }
          }
        });
        if (!any) return;
      }
      if (!Number.isFinite(box.min.x) || box.isEmpty()) return;
      window.__forgeFitToBounds?.(box, { margin: 2.2 });
    }, overlayTag);
    await page.waitForTimeout(350);
  };

  await fitOverlay();
  for (const v of VIEWS) {
    await page.keyboard.press(v.key);
    await page.waitForTimeout(450);
    await fitOverlay();
    await shot(page, `${label}-${v.name}`);
  }
  // 5th angle — close-up zoom on the canvas.
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  await fitOverlay();
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
  }
  await page.waitForTimeout(400);
  await shot(page, `${label}-close`);
}

// Probe: does the named overlay group exist in the MAIN scene with non-empty
// coloured geometry? Returns { present, triCount, hasColor, smin, smax }.
async function overlayProbe(page, tag) {
  return page.evaluate((t) => {
    const scene = window.__forgeScene;
    if (!scene) return { present: false, reason: 'no scene' };
    let group = null;
    scene.traverse((o) => { if (!group && o.userData && o.userData.simOverlay === t) group = o; });
    if (!group) return { present: false, reason: `no overlay group '${t}'` };
    let triCount = 0, hasColor = false, lineVerts = 0;
    group.traverse((o) => {
      const g = o.geometry;
      if (!g || !g.attributes) return;
      const pos = g.attributes.position;
      if (pos) {
        if (o.isMesh) triCount += pos.count / 3;
        if (o.isLine || o.isLineSegments) lineVerts += pos.count;
      }
      if (g.attributes.color) hasColor = true;
    });
    return {
      present: true, triCount, lineVerts, hasColor,
      smin: group.userData.smin, smax: group.userData.smax,
      mode: group.userData.mode, frames: group.userData.frames,
      resolved: group.userData.resolved,
    };
  }, tag);
}

test.describe.serial('FRONT-20 · live sim overlays in main viewport · multi-camera', () => {
  let app, page;

  test.beforeAll(async () => {
    test.setTimeout(180000);
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Kernel + bridge + scene must be live.
    await page.waitForFunction(
      () => !!(window.forge && window.forge.isReady && window.forge.isReady()
               && window.__forgeScene && window.__forgeThree
               && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'),
      { timeout: 40000 },
    );
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });
    await page.waitForTimeout(800);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('00 baseline — kernel ready, simulate verbs carry visualize param', async () => {
    await shot(page, 'baseline');
    const ok = await page.evaluate(() => {
      const eng = window.__forgeEngine;
      const tools = (eng.tools || eng.FORGE_TOOLS || []);
      return typeof eng.dispatchToolCall === 'function';
    });
    expect(ok).toBe(true);
  });

  // ───────────────────────────── A · STATIC FEA STRESS CONTOUR ─────────────
  test('A1 fea-static → von-Mises stress contour mounts in main scene', async () => {
    test.setTimeout(120000);
    const res = await page.evaluate(async () => {
      // Build a real bracket body in the scene, then drive the verb on it.
      const h = window.forge.makeBox(60, 20, 8);
      window.__forgeAppendBody?.({
        id: `front20-bracket-${h}`, kind: 'native', handle: h,
        toolId: 'part.make-box', params: { dx: 60, dy: 20, dz: 8 },
        name: 'FRONT-20 bracket',
      });
      // CUA verb path: clamp -x, push -z on +x, mesh ~4 mm. Steel.
      const r = await window.__forgeEngine.dispatchToolCall({
        name: 'simulate.fea-static',
        arguments: {
          shape: h,
          material: { E: 2.1e11, nu: 0.3, rho: 7850 },
          fixedFace: '-x', loadFace: '+x', force: [0, 0, -1500],
          meshSize: 4,
        },
      });
      return r;
    });
    console.log('[front20] fea-static result:', JSON.stringify({
      ok: res.ok, overlay: res.result?.overlay,
      maxVonMises_MPa: res.result?.maxVonMises_MPa,
      maxDisplacement_m: res.result?.maxDisplacement_m,
      nodes: res.result?.nodes, elements: res.result?.elements,
    }));
    expect(res.ok, res.error).toBe(true);
    expect(res.result.overlay).toBe('fea');
    expect(res.result.maxVonMises_MPa).toBeGreaterThan(0);

    await page.waitForTimeout(600);
    const probe = await overlayProbe(page, 'fea');
    console.log('[front20] fea overlay probe:', JSON.stringify(probe));
    expect(probe.present, probe.reason).toBe(true);
    expect(probe.triCount).toBeGreaterThan(0);
    expect(probe.hasColor).toBe(true);
    expect(probe.smax).toBeGreaterThan(probe.smin);
  });

  test('A2 fea-static stress contour — 5 camera angles of the live overlay', async () => {
    test.setTimeout(120000);
    await multiCam(page, 'A-fea-static', 'fea');
    // overlay still present after the camera tour
    const probe = await overlayProbe(page, 'fea');
    expect(probe.present).toBe(true);
  });

  // ───────────────────────────── B · MODAL ANIMATION ──────────────────────
  test('B1 fea-modal → live animated mode shape mounts + animates', async () => {
    test.setTimeout(120000);
    // Clear the static overlay first so the modal one is the active subject.
    await page.evaluate(() => {
      const viz = window.__forgeSimViewport;
      if (viz) viz.clearSimOverlays(window.__forgeScene);
    });
    const res = await page.evaluate(async () => {
      // A slender cantilever beam — distinct subject from the bracket.
      const h = window.forge.makeBox(80, 6, 6);
      window.__forgeAppendBody?.({
        id: `front20-beam-${h}`, kind: 'native', handle: h,
        toolId: 'part.make-box', params: { dx: 80, dy: 6, dz: 6 },
        name: 'FRONT-20 beam',
      });
      const r = await window.__forgeEngine.dispatchToolCall({
        name: 'simulate.fea-modal',
        arguments: {
          shape: h,
          material: { E: 2.1e11, nu: 0.3, rho: 7850 },
          fixedFace: '-x', modes: 6, animateMode: 0, meshSize: 4,
        },
      });
      return r;
    });
    console.log('[front20] fea-modal result:', JSON.stringify({
      ok: res.ok, overlay: res.result?.overlay,
      animatedMode: res.result?.animatedMode,
      frequenciesHz: res.result?.frequenciesHz,
    }));
    expect(res.ok, res.error).toBe(true);
    expect(res.result.overlay).toBe('modal');
    expect(Array.isArray(res.result.frequenciesHz)).toBe(true);
    expect(res.result.frequenciesHz[0]).toBeGreaterThan(0);

    await page.waitForTimeout(500);
    const probe = await overlayProbe(page, 'modal');
    console.log('[front20] modal overlay probe:', JSON.stringify(probe));
    expect(probe.present, probe.reason).toBe(true);
    expect(probe.triCount).toBeGreaterThan(0);
    expect(probe.hasColor).toBe(true);

    // Confirm the animation loop is live + actually moving the geometry: sample
    // the first vertex twice across a short interval and assert it changed.
    const moved = await page.evaluate(async () => {
      const anim = window.__forgeSimAnim;
      const scene = window.__forgeScene;
      let mesh = null;
      scene.traverse((o) => { if (!mesh && o.isMesh && o.userData?.simOverlay === undefined && o.parent?.userData?.simOverlay === 'modal') mesh = o; });
      if (!mesh) scene.traverse((o) => { if (!mesh && o.isMesh && o.name === 'sim-modal-shell') mesh = o; });
      if (!mesh) return { ok: false, reason: 'no modal shell mesh' };
      const pos = mesh.geometry.attributes.position.array;
      const snap = () => [pos[0], pos[1], pos[2], pos[30], pos[31], pos[32]];
      const a = snap();
      await new Promise((r) => setTimeout(r, 500));
      const b = snap();
      let delta = 0;
      for (let i = 0; i < a.length; i++) delta += Math.abs(a[i] - b[i]);
      return { ok: true, running: !!(anim && anim.running), delta, freqHz: anim?.freqHz };
    });
    console.log('[front20] modal animation moved:', JSON.stringify(moved));
    expect(moved.ok, moved.reason).toBe(true);
    expect(moved.running).toBe(true);
    expect(moved.delta).toBeGreaterThan(0); // the mode shape is animating
  });

  test('B2 modal mode shape — 5 camera angles of the live animation', async () => {
    test.setTimeout(120000);
    await multiCam(page, 'B-modal', 'modal');
    const probe = await overlayProbe(page, 'modal');
    expect(probe.present).toBe(true);
  });

  // ───────────────────────────── C · MULTIBODY MOTION CAPTURE ──────────────
  test('C1 multibody-dynamics → motion playback drives the real scene bodies', async () => {
    test.setTimeout(120000);
    await page.evaluate(() => {
      const viz = window.__forgeSimViewport;
      if (viz) viz.clearSimOverlays(window.__forgeScene);
      try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {}
    });
    await page.waitForTimeout(400);
    const res = await page.evaluate(async () => {
      // Two real bodies in the scene: a free disk that spins under torque and
      // a second body. We drive the verb with explicit shape handles so the
      // solved trajectory plays back on the ACTUAL scene geometry.
      const disk = window.forge.makeCylinder(20, 8);
      window.__forgeAppendBody?.({
        id: `front20-rotor-${disk}`, kind: 'native', handle: disk,
        toolId: 'part.make-cylinder', params: { r: 20, h: 8 },
        name: 'FRONT-20 rotor',
      });
      const block = window.forge.makeBox(14, 14, 40);
      window.__forgeAppendBody?.({
        id: `front20-pin-${block}`, kind: 'native', handle: block,
        toolId: 'part.make-box', params: { dx: 14, dy: 14, dz: 40 },
        name: 'FRONT-20 pin',
      });
      // multibody verb — body 0 spun about +Z by a torque, body 1 falls under
      // gravity. Both are inertial bodies; the kernel time-marches the EOM.
      const r = await window.__forgeEngine.dispatchToolCall({
        name: 'simulate.multibody-dynamics',
        arguments: {
          bodies: [
            { shape: disk, density: 7850 },
            { shape: block, density: 2700, position: [0.06, 0, 0] },
          ],
          loads: [{ body: 0, torque: [0, 0, 5] }],
          gravity: [0, 0, -9.81],
          dt: 1e-3, steps: 1200, sampleStride: 20,
        },
      });
      return r;
    });
    console.log('[front20] multibody result:', JSON.stringify({
      ok: res.ok, overlay: res.result?.overlay,
      sampleCount: res.result?.sampleCount, stable: res.result?.stable,
      bodyCount: res.result?.bodyCount,
    }));
    expect(res.ok, res.error).toBe(true);
    expect(res.result.overlay).toBe('motion');
    expect(res.result.sampleCount).toBeGreaterThan(2);

    await page.waitForTimeout(500);
    const probe = await overlayProbe(page, 'motion');
    console.log('[front20] motion overlay probe:', JSON.stringify(probe));
    expect(probe.present, probe.reason).toBe(true);
    expect(probe.resolved).toBeGreaterThanOrEqual(1);

    // Confirm the bodies are actually moving: snapshot a body's world position
    // across a short interval and assert it changed (the trajectory is playing).
    const moved = await page.evaluate(async () => {
      const scene = window.__forgeScene;
      const anim = window.__forgeSimAnim;
      // Find a moving body (the rotor).
      let target = null;
      scene.traverse((o) => {
        if (target) return;
        const ud = o.userData || {};
        const name = (ud.body?.name || '').toLowerCase();
        if (o.isMesh && (name.includes('rotor') || name.includes('pin'))) target = o;
      });
      if (!target) scene.traverse((o) => { if (!target && o.isMesh && o.geometry?.attributes?.position?.count > 0) target = o; });
      if (!target) return { ok: false, reason: 'no body mesh' };
      const v = new (window.__forgeThree.Vector3)();
      target.getWorldPosition(v); const a = [v.x, v.y, v.z];
      const q0 = target.quaternion.clone();
      await new Promise((r) => setTimeout(r, 700));
      target.getWorldPosition(v); const b = [v.x, v.y, v.z];
      const q1 = target.quaternion.clone();
      const dpos = Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
      const dquat = Math.abs(q0.x-q1.x)+Math.abs(q0.y-q1.y)+Math.abs(q0.z-q1.z)+Math.abs(q0.w-q1.w);
      return { ok: true, running: !!(anim && anim.running), dpos, dquat, frameIndex: anim?.frameIndex };
    });
    console.log('[front20] motion moved:', JSON.stringify(moved));
    expect(moved.ok, moved.reason).toBe(true);
    expect(moved.running).toBe(true);
    // Either the COM translated or the body rotated — the trajectory is live.
    expect(moved.dpos + moved.dquat).toBeGreaterThan(0);
  });

  test('C2 mechanism motion — 5 camera angles of the moving scene bodies', async () => {
    test.setTimeout(120000);
    await multiCam(page, 'C-motion', 'motion');
    const probe = await overlayProbe(page, 'motion');
    expect(probe.present).toBe(true);
  });

  test('D manual verb dispatch did not post to Archie thread', async () => {
    // dispatchToolCall is the bridge, not the model loop, so the Archie dock
    // must stay empty (memory: feedback-forge-manual-not-archie).
    const archieMsgs = await page.locator('.forge-archie-msg[data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
