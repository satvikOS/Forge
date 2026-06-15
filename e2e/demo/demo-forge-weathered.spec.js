// Forge DEGRADATION / WEATHERING proof (program step B, operator half) —
// drives Archie's bridge with the new degradation verbs (part.surface-wear /
// surface-deposit / chipped-edges) and renders CLEAN vs DEGRADED pairs. Proves
// Archie can now PRODUCE realistic asymmetric wear/pitting/corrosion/chips on a
// part — the defect taxonomy as generation, not just recognition.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'forge');

test('Forge weathering / degradation proof', async () => {
  test.setTimeout(8 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => !!(window.__forgeEngine && window.__forgeEngine.dispatchToolCall && window.forge && window.forge.isReady && window.forge.isReady()), { timeout: 40000 });

  const built = await win.evaluate(async () => {
    const D = window.__forgeEngine.dispatchToolCall;
    const log = [];
    const call = async (name, args) => {
      const r = await D({ name, arguments: args });
      log.push({ name, ok: !!r.ok, error: r.error || null });
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      return r.result.shape;
    };
    const handles = [];
    const add = (label, color, h) => handles.push({ label, color, handle: h });

    // PAIR 1 — flange: precision (clean) vs service-worn (pitting + chips)
    try {
      const clean = await call('asset.make-flange', { od: 90, thick: 14, bore: 28, bolts: 6, bolt_d: 9, bcd: 66 });
      add('flange · precision', 0x9fb6c8, clean);
      let worn = await call('asset.make-flange', { od: 90, thick: 14, bore: 28, bolts: 6, bolt_d: 9, bcd: 66 });
      worn = await call('part.surface-wear', { shape: worn, count: 16, depth: 1.0, seed: 7 });
      worn = await call('part.surface-deposit', { shape: worn, count: 12, height: 0.9, seed: 17 });
      add('flange · service-worn', 0xa8693a, worn);
    } catch (e) { log.push({ name: 'pair.flange', ok: false, error: String(e.message || e) }); }

    // PAIR 2 — gear: new vs corroded (blisters + pitting)
    try {
      const clean = await call('asset.make-spur-gear', { od: 86, bore: 22, thick: 16, teeth: 18 });
      add('gear · new', 0x9fb6c8, clean);
      let corr = await call('asset.make-spur-gear', { od: 86, bore: 22, thick: 16, teeth: 18 });
      corr = await call('part.surface-deposit', { shape: corr, count: 22, height: 1.7, seed: 11 });
      corr = await call('part.surface-wear', { shape: corr, count: 16, depth: 1.2, seed: 13 });
      add('gear · corroded', 0x9a5a30, corr);
    } catch (e) { log.push({ name: 'pair.gear', ok: false, error: String(e.message || e) }); }

    // PAIR 3 — block: machined (filleted) vs impact-damaged (chips + dents)
    try {
      let box = await call('part.make-box', { dx: 64, dy: 64, dz: 50 });
      const clean = await call('part.fillet', { shape: box, radius: 9 });
      add('block · machined', 0x9fb6c8, clean);
      let box2 = await call('part.make-box', { dx: 64, dy: 64, dz: 50 });
      let dmg = await call('part.fillet', { shape: box2, radius: 9 });
      dmg = await call('part.chipped-edges', { shape: dmg, count: 12, size: 6, seed: 23 });
      dmg = await call('part.surface-wear', { shape: dmg, count: 14, depth: 1.6, seed: 29 });
      add('block · impact-damaged', 0xa8693a, dmg);
    } catch (e) { log.push({ name: 'pair.block', ok: false, error: String(e.message || e) }); }

    const bodies = [];
    for (const h of handles) {
      try {
        const m = window.forge.tessellate(h.handle, 0.2, 0.3);
        bodies.push({ label: h.label, color: h.color,
          positions: Array.from(m.positions || []),
          normals: m.normals ? Array.from(m.normals) : null,
          indices: m.indices ? Array.from(m.indices) : null,
          triangleCount: m.triangleCount || (m.positions ? m.positions.length / 9 : 0) });
      } catch (e) { log.push({ name: `tessellate:${h.label}`, ok: false, error: String(e.message || e) }); }
    }
    return { log, bodies };
  });
  console.log('[forge-weather] build log: ' + JSON.stringify(built.log));
  console.log('[forge-weather] bodies: ' + built.bodies.length);

  const result = await win.evaluate(async (bodies) => {
    const THREE = window.__forgeThree;
    if (!THREE) return { error: 'no __forgeThree' };
    const scene = new THREE.Scene();
    const SKY = new THREE.Color(0xaec4dd); scene.background = SKY;
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x40403a, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2dc, 3.4); sun.position.set(90, 180, 150); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 1.0); fill.position.set(-120, 60, -80); scene.add(fill);

    const meshes = []; let cx = 0; const GAP = 26; const skipped = [];
    for (const b of bodies) {
      if (!b.positions || b.positions.length < 9) { skipped.push(b.label + ':empty'); continue; }
      // a degenerate boolean can emit NaN/Inf verts → poisons Box3 framing; drop it
      let bad = false;
      for (let i = 0; i < b.positions.length; i++) { if (!Number.isFinite(b.positions[i])) { bad = true; break; } }
      if (bad) { skipped.push(b.label + ':NaN'); continue; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.positions), 3));
      if (b.indices && b.indices.length) geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(b.indices), 1));
      if (b.normals && b.normals.length === b.positions.length) geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b.normals), 3));
      else geo.computeVertexNormals();
      geo.computeBoundingBox();
      const bb = geo.boundingBox; const sz = bb.getSize(new THREE.Vector3()); const ctr = bb.getCenter(new THREE.Vector3());
      geo.translate(-ctr.x, -bb.min.y, -ctr.z);
      const isWorn = /worn|corroded|damaged/.test(b.label);
      const mat = new THREE.MeshStandardMaterial({ color: b.color, metalness: isWorn ? 0.4 : 0.7, roughness: isWorn ? 0.8 : 0.32 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = cx + sz.x / 2;
      scene.add(mesh); meshes.push(mesh);
      cx += sz.x + GAP;
    }
    const totalW = Math.max(cx, 1);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(totalW + 80, 4, 160), new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.95 }));
    ground.position.set(totalW / 2 - GAP / 2, -2, 0); scene.add(ground);

    // Frame from a guarded per-mesh union (skip any non-finite bbox) so one
    // bad body can't collapse the camera. Fall back to the known row width.
    const box = new THREE.Box3();
    for (const m of meshes) {
      const b = new THREE.Box3().setFromObject(m);
      if ([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)) box.union(b);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, -120), new THREE.Vector3(totalW, 90, 120));
    const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.z, sz.y) * 0.5 || 100;
    scene.fog = new THREE.Fog(SKY, R * 2.6, R * 7);
    const W = 1700, H = 620, aspect = W / H;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const rend = new THREE.WebGLRenderer({ canvas, antialias: true });
    rend.setPixelRatio(1); rend.setSize(W, H, false);
    rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.12; rend.outputColorSpace = THREE.SRGBColorSpace;
    const ANGLES = {
      pairs: [[c.x, c.y + R * 0.6, c.z + R * 1.9], [c.x, c.y, c.z]],
      close: [[c.x - sz.x * 0.28, c.y + R * 0.55, c.z + R * 1.15], [c.x - sz.x * 0.25, c.y, c.z]],
    };
    const out = {};
    for (const [name, [pos, look]] of Object.entries(ANGLES)) {
      const cam = new THREE.PerspectiveCamera(42, aspect, 0.5, R * 30);
      cam.position.set(pos[0], pos[1], pos[2]); cam.lookAt(look[0], look[1], look[2]);
      rend.render(scene, cam);
      out[name] = canvas.toDataURL('image/png');
    }
    const info = { calls: rend.info.render.calls, tris: rend.info.render.triangles, bodies: meshes.length };
    const dbg = { skipped, c: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], sz: [Math.round(sz.x), Math.round(sz.y), Math.round(sz.z)], R: Math.round(R),
      m0: meshes[0] ? [Math.round(meshes[0].position.x), Math.round(meshes[0].position.y), Math.round(meshes[0].position.z)] : null,
      m0bb: meshes[0] ? (() => { const b = new THREE.Box3().setFromObject(meshes[0]); return [Math.round(b.min.x), Math.round(b.min.y), Math.round(b.min.z), Math.round(b.max.x), Math.round(b.max.y), Math.round(b.max.z)]; })() : null };
    try { rend.forceContextLoss(); } catch (_) {}
    return { out, info, dbg };
  }, built.bodies);

  if (result.error) { await app.close(); throw new Error(result.error); }
  for (const [name, dataUrl] of Object.entries(result.out)) {
    fs.writeFileSync(path.join(OUT, `weathered-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(OUT, 'weathered-proof.json'), JSON.stringify({ log: built.log, bodyCount: built.bodies.length, render: result.info }, null, 1));
  console.log('[forge-weather] render: ' + JSON.stringify(result.info));
  console.log('[forge-weather] dbg: ' + JSON.stringify(result.dbg));
  const okVerbs = built.log.filter((l) => l.ok && /surface-wear|surface-deposit|chipped-edges/.test(l.name)).length;
  console.log(`\n=== FORGE WEATHERING PROOF: ${built.bodies.length} bodies (clean+degraded), ${result.info.tris} tris, ${okVerbs} degradation-verb calls OK ===`);
  await app.close();
  expect(built.bodies.length).toBeGreaterThanOrEqual(4);
});
