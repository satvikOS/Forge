// Forge STANDARD-PART vocabulary proof (#58) — builds the new recognizable hardware
// (hex nut/bolt, socket screw, hex standoff, ball bearing, T-slot extrusion) through
// Archie's bridge and renders them in a row. Proves the component vocabulary tier.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'forge');
const PARTS = [
  ['asset.make-hex-nut', { af: 17, thick: 8, bore: 10 }, 0x9fb6c8],
  ['asset.make-hex-bolt', { af: 17, head_h: 7, shank_d: 10, length: 45 }, 0xc0c6cf],
  ['asset.make-socket-screw', { head_d: 16, head_h: 10, shank_d: 10, length: 35 }, 0x9aa0a8],
  ['asset.make-hex-standoff', { af: 12, length: 30, bore: 5 }, 0xb08a55],
  ['asset.make-ball-bearing', { od: 52, id: 25, width: 15, balls: 10 }, 0xc9ced6],
  ['asset.make-tslot-extrusion', { size: 24, length: 110, slot: 7 }, 0xb8bcc2],
];

test('Forge standard-part vocabulary', async () => {
  test.setTimeout(6 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 15 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => !!(window.__forgeEngine && window.forge && window.forge.isReady && window.forge.isReady() && window.__forgeThree), { timeout: 40000 });

  const built = await win.evaluate(async (PARTS) => {
    const D = window.__forgeEngine.dispatchToolCall; const log = []; const bodies = [];
    for (const [name, args, color] of PARTS) {
      try {
        const r = await D({ name, arguments: args });
        log.push({ name, ok: !!r.ok, error: r.error || null });
        if (!r.ok) continue;
        const m = window.forge.tessellate(r.result.shape, 0.18, 0.3);
        bodies.push({ name, color, positions: Array.from(m.positions || []), normals: m.normals ? Array.from(m.normals) : null, indices: m.indices ? Array.from(m.indices) : null });
      } catch (e) { log.push({ name, ok: false, error: String(e.message || e) }); }
    }
    return { log, bodies };
  }, PARTS);
  console.log('[std-parts] build log: ' + JSON.stringify(built.log));

  const result = await win.evaluate(async (bodies) => {
    const THREE = window.__forgeThree; const scene = new THREE.Scene();
    const SKY = new THREE.Color(0xaec4dd); scene.background = SKY;
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x404038, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2dc, 3.3); sun.position.set(80, 160, 130); scene.add(sun);
    const meshes = []; let cx = 0; const GAP = 22;
    for (const b of bodies) {
      if (!b.positions || b.positions.length < 9) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.positions), 3));
      if (b.indices && b.indices.length) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(b.indices), 1));
      if (b.normals && b.normals.length === b.positions.length) g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b.normals), 3)); else g.computeVertexNormals();
      g.computeBoundingBox(); const bb = g.boundingBox; const sz = bb.getSize(new THREE.Vector3()); const ctr = bb.getCenter(new THREE.Vector3());
      g.translate(-ctr.x, -bb.min.y, -ctr.z);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: b.color, metalness: 0.75, roughness: 0.34 }));
      mesh.position.x = cx + sz.x / 2; scene.add(mesh); meshes.push(mesh); cx += sz.x + GAP;
    }
    const ground = new THREE.Mesh(new THREE.BoxGeometry(cx + 60, 3, 120), new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.95 }));
    ground.position.set(cx / 2 - GAP / 2, -1.5, 0); scene.add(ground);
    const box = new THREE.Box3(); for (const m of meshes) box.expandByObject(m);
    const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.z, sz.y) * 0.5 || 80;
    scene.fog = new THREE.Fog(SKY, R * 2.6, R * 7);
    const W = 1700, H = 560, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const rend = new THREE.WebGLRenderer({ canvas, antialias: true }); rend.setPixelRatio(1); rend.setSize(W, H, false);
    rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.12; rend.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(40, W / H, 0.3, R * 30);
    cam.position.set(c.x + sz.x * 0.05, c.y + R * 0.7, c.z + R * 2.2); cam.lookAt(c.x, c.y, c.z);
    rend.render(scene, cam);
    const url = canvas.toDataURL('image/png'); const info = { calls: rend.info.render.calls, tris: rend.info.render.triangles, bodies: meshes.length };
    try { rend.forceContextLoss(); } catch (_) {}
    return { url, info };
  }, built.bodies);

  fs.writeFileSync(path.join(OUT, 'standard-parts.png'), Buffer.from(result.url.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'standard-parts-proof.json'), JSON.stringify({ log: built.log, render: result.info }, null, 1));
  console.log(`\n=== FORGE STANDARD PARTS: ${built.bodies.length}/${PARTS.length} built + rendered, ${result.info.tris} tris ===`);
  await app.close();
  expect(built.bodies.length).toBe(PARTS.length);
});
