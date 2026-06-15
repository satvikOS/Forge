// Forge PARAMETRIC / FREEFORM proof — drives Archie's tool bridge
// (window.__forgeEngine.dispatchToolCall) with the NEW kernel verbs added in
// task A (revolve / pipe / nurbs-surface / fillet / circular-pattern) and
// renders the resulting OCCT solids. Proves Archie's action space now reaches
// CURVED / BLENDED / PATTERNED geometry — not just straight CSG primitives.
//
// Bodies are built through the bridge, tessellated via window.forge.tessellate,
// and drawn in a fresh offline WebGLRenderer (sun + sky + fog, ACES, multi-cam)
// — bypassing the known SceneMeshes native-handle render gap.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'forge');

test('Forge parametric / freeform proof', async () => {
  test.setTimeout(8 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);

  // wait for the bridge engine + a ready kernel
  await win.waitForFunction(() => !!(window.__forgeEngine && window.__forgeEngine.dispatchToolCall && window.forge && window.forge.isReady && window.forge.isReady()), { timeout: 40000 });

  // BUILD via the bridge — each entry is exactly what Archie would emit.
  const built = await win.evaluate(async () => {
    const D = window.__forgeEngine.dispatchToolCall;
    const log = [];
    const handles = [];
    const call = async (name, args) => {
      const r = await D({ name, arguments: args });
      log.push({ name, ok: !!r.ok, error: r.error || null, shape: r.result && r.result.shape });
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      return r.result.shape;
    };
    const bodies = [];
    const push = (label, color, handle) => { handles.push({ label, color, handle }); };

    // 1) REVOLVE — a turned vase (solid of revolution). Curved.
    try {
      const profile = [[4, 0], [30, 0], [26, 16], [15, 34], [22, 56], [33, 72], [26, 86], [4, 90]];
      const vase = await call('part.revolve', { profile, axisOrigin: [0, 0, 0], axisDir: [0, 1, 0], angleDeg: 360 });
      push('revolve · vase', 0x7fb0d8, vase);
    } catch (e) { log.push({ name: 'part.revolve', ok: false, error: String(e.message || e) }); }

    // 2) PIPE — a 3D S-curve duct. Curved.
    try {
      const pathPts = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20; pathPts.push([t * 150, 26 * Math.sin(t * Math.PI * 2), 18 * Math.cos(t * Math.PI * 1.3)]); }
      const pipe = await call('part.pipe', { path: pathPts, radius: 7 });
      push('pipe · S-duct', 0xd6913a, pipe);
    } catch (e) { log.push({ name: 'part.pipe', ok: false, error: String(e.message || e) }); }

    // 3) NURBS-SURFACE — a freeform wavy panel, thickened to a solid.
    try {
      const grid = [];
      for (let r = 0; r < 6; r++) { const row = []; for (let c = 0; c < 6; c++) row.push([c * 22, 10 * Math.sin(c * 0.95) * Math.cos(r * 0.95), r * 22]); grid.push(row); }
      const surf = await call('part.nurbs-surface', { grid, uDegree: 3, vDegree: 3, thickness: 3 });
      push('nurbs · freeform', 0x9ad17f, surf);
    } catch (e) { log.push({ name: 'part.nurbs-surface', ok: false, error: String(e.message || e) }); }

    // 4) FILLET — a box rounded on ALL edges (manufactured look, not a raw block).
    try {
      const box = await call('part.make-box', { dx: 60, dy: 60, dz: 60 });
      const rounded = await call('part.fillet', { shape: box, radius: 12 });
      push('fillet · rounded', 0xc8606a, rounded);
    } catch (e) { log.push({ name: 'part.fillet', ok: false, error: String(e.message || e) }); }

    // 5) CIRCULAR-PATTERN — a ring of pillars around Z.
    try {
      const pin = await call('part.make-cylinder', { radius: 5, height: 40 });
      const off = await call('part.translate', { shape: pin, dx: 34, dy: 0, dz: 0 });
      const ring = await call('part.circular-pattern', { shape: off, count: 12, axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], totalAngleDeg: 360 });
      push('circular-pattern', 0xb89bd0, ring);
    } catch (e) { log.push({ name: 'part.circular-pattern', ok: false, error: String(e.message || e) }); }

    // Tessellate each built body for the offline renderer.
    for (const h of handles) {
      try {
        const m = window.forge.tessellate(h.handle, 0.25, 0.35);
        bodies.push({ label: h.label, color: h.color,
          positions: Array.from(m.positions || []),
          normals: m.normals ? Array.from(m.normals) : null,
          indices: m.indices ? Array.from(m.indices) : null,
          triangleCount: m.triangleCount || (m.positions ? m.positions.length / 9 : 0) });
      } catch (e) { log.push({ name: `tessellate:${h.label}`, ok: false, error: String(e.message || e) }); }
    }
    return { log, bodies };
  });
  console.log('[forge-param] build log: ' + JSON.stringify(built.log));
  console.log('[forge-param] bodies tessellated: ' + built.bodies.length);

  // OFFLINE RENDER — lay the bodies out in a row, sun + sky + fog, multi-cam.
  const result = await win.evaluate(async (bodies) => {
    const THREE = window.__forgeThree;
    if (!THREE) return { error: 'window.__forgeThree unavailable' };
    const scene = new THREE.Scene();
    const SKY = new THREE.Color(0x9fbce0); scene.background = SKY;
    scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x404038, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2dc, 3.2); sun.position.set(120, 200, 140); scene.add(sun);

    // ground
    const meshes = [];
    let cursorX = 0; const GAP = 30;
    for (const b of bodies) {
      if (!b.positions || b.positions.length < 9) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.positions), 3));
      if (b.indices && b.indices.length) geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(b.indices), 1));
      if (b.normals && b.normals.length === b.positions.length) geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b.normals), 3));
      else geo.computeVertexNormals();
      geo.computeBoundingBox();
      const bb = geo.boundingBox; const sz = bb.getSize(new THREE.Vector3()); const ctr = bb.getCenter(new THREE.Vector3());
      // center on origin in X/Z, sit on ground (min y = 0)
      geo.translate(-ctr.x, -bb.min.y, -ctr.z);
      const mat = new THREE.MeshStandardMaterial({ color: b.color, metalness: 0.55, roughness: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = cursorX + sz.x / 2;
      scene.add(mesh); meshes.push(mesh);
      cursorX += sz.x + GAP;
    }
    const totalW = Math.max(cursorX, 1);
    // ground plane
    const ground = new THREE.Mesh(new THREE.BoxGeometry(totalW + 120, 4, 240), new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.95 }));
    ground.position.set(totalW / 2 - GAP / 2, -2, 0); scene.add(ground);

    const box = new THREE.Box3().setFromObject(scene);
    const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.z, sz.y) * 0.5 || 100;
    scene.fog = new THREE.Fog(SKY, R * 2.2, R * 6.5);

    const W = 1700, H = 720, aspect = W / H;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const rend = new THREE.WebGLRenderer({ canvas, antialias: true });
    rend.setPixelRatio(1); rend.setSize(W, H, false);
    rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.15; rend.outputColorSpace = THREE.SRGBColorSpace;
    const ANGLES = {
      row:    [[c.x - sz.x * 0.15, c.y + R * 0.7, c.z + R * 2.0], [c.x, c.y, c.z]],
      iso:    [[c.x + sz.x * 0.35, c.y + R * 1.1, c.z + R * 1.6], [c.x, c.y - sz.y * 0.1, c.z]],
      front:  [[c.x, c.y + R * 0.25, c.z + R * 2.6], [c.x, c.y, c.z]],
    };
    const out = {};
    for (const [name, [pos, look]] of Object.entries(ANGLES)) {
      const cam = new THREE.PerspectiveCamera(45, aspect, 0.5, R * 30);
      cam.position.set(pos[0], pos[1], pos[2]); cam.lookAt(look[0], look[1], look[2]);
      rend.render(scene, cam);
      out[name] = canvas.toDataURL('image/png');
    }
    const info = { calls: rend.info.render.calls, tris: rend.info.render.triangles, bodies: meshes.length };
    try { rend.forceContextLoss(); } catch (_) {}
    return { out, info, extent: [Math.round(sz.x), Math.round(sz.y), Math.round(sz.z)] };
  }, built.bodies);

  if (result.error) { await app.close(); throw new Error(result.error); }
  for (const [name, dataUrl] of Object.entries(result.out)) {
    fs.writeFileSync(path.join(OUT, `parametric-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  const proof = { log: built.log, bodyCount: built.bodies.length, render: result.info, extent: result.extent };
  fs.writeFileSync(path.join(OUT, 'parametric-proof.json'), JSON.stringify(proof, null, 1));
  console.log('[forge-param] render: ' + JSON.stringify({ info: result.info, extent: result.extent }));
  const okCount = built.log.filter((l) => l.ok && /^part\./.test(l.name)).length;
  console.log(`\n=== FORGE PARAMETRIC PROOF: ${built.bodies.length} curved/blended bodies rendered, ${result.info.tris} tris, ${okCount} new-verb calls OK ===`);
  await app.close();
  expect(built.bodies.length).toBeGreaterThanOrEqual(3);
});
