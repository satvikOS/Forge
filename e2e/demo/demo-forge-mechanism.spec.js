// Forge MECHANISM proof — full mechanics. Builds a working mechanism via the OCCT
// kernel (__forgeMechanism) and drives its real kinematics (slider-crank stroke, four-bar
// coupler solve) per frame → an animated MOVING assembly → ffmpeg mp4 + hero still.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'forge');
const MECHS = ['piston-crank', 'four-bar'];

test('Forge mechanism kinematics (moving assembly)', async () => {
  test.setTimeout(15 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 15 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => typeof window.__forgeMechanism === 'function' && window.forge && window.forge.isReady && window.forge.isReady() && window.__forgeThree, { timeout: 40000 });

  const proof = {};
  for (const type of MECHS) {
    const r = await win.evaluate(async (type) => {
      const THREE = window.__forgeThree;
      const mech = window.__forgeMechanism(type);
      // tessellate each part once, centred at local origin so pose() transforms apply cleanly
      const parts = [];
      for (const p of mech.parts) {
        const m = window.forge.tessellate(p.handle, 0.4, 0.5);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(m.positions), 3));
        if (m.indices && m.indices.length) geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1));
        if (m.normals && m.normals.length === m.positions.length) geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(m.normals), 3)); else geo.computeVertexNormals();
        geo.center();
        parts.push({ geo, color: p.color, pose: p.pose });
      }
      const scene = new THREE.Scene(); const SKY = new THREE.Color(0xaec4dd); scene.background = SKY;
      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x404038, 1.0));
      const sun = new THREE.DirectionalLight(0xfff2dc, 3.2); sun.position.set(60, 120, 90); scene.add(sun);
      const meshes = parts.map((p) => { const mesh = new THREE.Mesh(p.geo, new THREE.MeshStandardMaterial({ color: p.color, metalness: 0.6, roughness: 0.4 })); scene.add(mesh); return mesh; });
      // frame the mechanism over a full cycle (union of extents)
      const bb = new THREE.Box3();
      for (let s = 0; s < 8; s++) { const th = s / 8 * Math.PI * 2; parts.forEach((p, i) => { const k = p.pose(th); meshes[i].position.set(k.pos[0], k.pos[1], k.pos[2]); meshes[i].rotation.z = k.rotZ || 0; meshes[i].updateMatrixWorld(true); bb.expandByObject(meshes[i]); }); }
      const c = bb.getCenter(new THREE.Vector3()); const sz = bb.getSize(new THREE.Vector3()); const R = Math.max(sz.x, sz.y, sz.z) * 0.5 || 80;
      const W = 1280, H = 720; const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const rend = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); rend.setPixelRatio(1); rend.setSize(W, H, false);
      rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.15; rend.outputColorSpace = THREE.SRGBColorSpace;
      const cam = new THREE.PerspectiveCamera(40, W / H, 0.1, R * 30); cam.position.set(c.x + R * 0.3, c.y + R * 0.8, c.z + R * 2.4); cam.lookAt(c.x, c.y, c.z);
      const frames = []; const n = 48;
      for (let f = 0; f < n; f++) {
        const th = f / n * Math.PI * 2;
        parts.forEach((p, i) => { const k = p.pose(th); meshes[i].position.set(k.pos[0], k.pos[1], k.pos[2]); meshes[i].rotation.z = k.rotZ || 0; });
        rend.render(scene, cam); frames.push(canvas.toDataURL('image/png'));
      }
      try { rend.forceContextLoss(); } catch (_) {}
      return { label: mech.label, dof: mech.dof, partCount: parts.length, frames };
    }, type);

    const dir = path.join(OUT, `mech_${type}_frames`); fs.mkdirSync(dir, { recursive: true });
    let i = 0; for (const url of r.frames) { fs.writeFileSync(path.join(dir, `f-${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64')); i++; }
    fs.writeFileSync(path.join(OUT, `mechanism-${type}-hero.png`), Buffer.from(r.frames[Math.floor(r.frames.length / 4)].split(',')[1], 'base64'));
    const mp4 = path.join(OUT, `mechanism-${type}.mp4`); let enc = false;
    try { execFileSync('ffmpeg', ['-y', '-framerate', '30', '-i', path.join(dir, 'f-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4], { stdio: 'ignore' }); enc = fs.existsSync(mp4) && fs.statSync(mp4).size > 0; } catch (e) {}
    proof[type] = { label: r.label, dof: r.dof, parts: r.partCount, frames: r.frames.length, mp4kb: enc ? Math.round(fs.statSync(mp4).size / 1024) : 0 };
    console.log(`[mech] ${type}: ${r.label} — ${r.partCount} parts, ${r.frames.length}f, dof=${r.dof} → mp4 ${proof[type].mp4kb}KB`);
  }
  await app.close();
  console.log('\n=== FORGE MECHANISM: ' + MECHS.map((m) => `${m}(${proof[m].parts}p, ${proof[m].frames}f, ${proof[m].mp4kb}KB)`).join(' · ') + ' ===');
  for (const m of MECHS) { expect(proof[m].parts).toBeGreaterThanOrEqual(3); expect(proof[m].frames).toBeGreaterThanOrEqual(24); expect(proof[m].mp4kb).toBeGreaterThan(0); }
});
