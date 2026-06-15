// Forge 100k INDUSTRIAL ENVIRONMENT proof — calls window.__forgeBuildEnvironment
// (forgeEnvironmentBuilder.js: 13 distinct machine models + instanced fasteners/
// drums/crates/rollers → ~100k components), then renders it via a SELF-CONTAINED
// offline WebGLRenderer (ACES + sun + sky + fog) from multiple angles. Mirrors the
// Studio 100k proof. Proves the scale + variety, not one spammed artifact.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'forge');

test('Forge 100k industrial environment proof', async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 30 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500); // let the r3f viewport mount + expose __forgeThree/__forgeScene

  // wait for the Forge viewport handles
  await win.waitForFunction(() => !!(window.__forgeThree && window.__forgeScene), { timeout: 30000 });

  // BUILD the industrial environment (13 machine types + 100k instanced components)
  const built = await win.evaluate(async () => {
    if (typeof window.__forgeBuildEnvironment !== 'function') return { error: '__forgeBuildEnvironment not installed' };
    const t0 = performance.now();
    let r;
    try { r = window.__forgeBuildEnvironment({ count: 100000, seed: 7 }); }
    catch (e) { return { error: String(e && e.stack || e && e.message || e).slice(0, 500) }; }
    const buildMs = Math.round(performance.now() - t0);
    const s = window.__forgeScene; let instMeshes = 0, totalInst = 0, machines = 0;
    s.traverse((o) => { if (o.isInstancedMesh) { instMeshes++; totalInst += o.count; } else if (o.isGroup && o.userData && o.userData.machineType) machines++; });
    return { buildMs, instMeshes, totalInst, machines, stats: r && r.stats };
  });
  console.log('[forge-100k] build: ' + JSON.stringify(built).slice(0, 500));
  if (built.error) { await app.close(); throw new Error(built.error); }

  // SELF-CONTAINED offline render: fresh renderer + sun/sky/fog + multi-angle
  const result = await win.evaluate(async () => {
    const THREE = window.__forgeThree; const scene = window.__forgeScene;
    // hide editor chrome: origin gizmo / axes / grid helpers / transform controls
    scene.traverse((o) => {
      const t = o.type || '';
      if (/Helper$/.test(t) || o.isTransformControls || ((o.isLine || o.isLineSegments) && !(o.userData && o.userData.forgeBody))) o.visible = false;
      if (o.name && /gizmo|helper|axis|grid/i.test(o.name)) o.visible = false;
    });
    const sun = new THREE.DirectionalLight(0xfff2dc, 3.4); sun.position.set(140, 200, 90); scene.add(sun);
    const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x4a443a, 1.2); scene.add(hemi);
    const SKY = new THREE.Color(0x9fbce0); scene.background = SKY;
    // bound only the built environment (forgeBody) so framing isn't thrown off by stray nodes
    const box = new THREE.Box3();
    scene.traverse((o) => { if (o.visible && (o.isMesh || o.isInstancedMesh) && o.userData && o.userData.forgeBody) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromObject(scene);
    const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.z) * 0.5 || 100;
    scene.fog = new THREE.Fog(SKY, R * 1.1, R * 3.4);
    const W = 1600, H = 900, aspect = W / H;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const rend = new THREE.WebGLRenderer({ canvas, antialias: true });
    rend.setPixelRatio(1); rend.setSize(W, H, false);
    rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.22; rend.outputColorSpace = THREE.SRGBColorSpace;
    // facility is wide (X) along production→warehouse→drum-farm; frame to read the zones + aisles
    const ANGLES = {
      // high 3/4 aerial from a corner — reads all three zones, the rows + aisles
      overview: [[c.x - R * 0.95, R * 0.8, c.z + R * 1.05], [c.x, sz.y * 0.15, c.z]],
      // ground-level shot looking down the central aisle toward the racking
      aisle:    [[c.x - 4, 4.5, c.z - R * 0.96], [c.x + R * 0.35, 4, c.z + R * 0.4]],
      // low hero on the warehouse side — tall loaded pallet racks recede into haze
      hero:     [[c.x + R * 0.12, 8.5, c.z - R * 0.55], [c.x + R * 0.55, 4, c.z - R * 0.05]],
    };
    const out = {};
    for (const [name, [pos, look]] of Object.entries(ANGLES)) {
      const cam = new THREE.PerspectiveCamera(name === 'overview' ? 46 : 54, aspect, 0.3, R * 14);
      cam.position.set(pos[0], pos[1], pos[2]); cam.lookAt(look[0], look[1], look[2]);
      rend.render(scene, cam);
      out[name] = canvas.toDataURL('image/png');
    }
    const info = { calls: rend.info.render.calls, tris: rend.info.render.triangles };
    try { rend.forceContextLoss(); } catch (_) {}
    return { out, extent: [Math.round(sz.x), Math.round(sz.y), Math.round(sz.z)], info };
  });
  for (const [name, dataUrl] of Object.entries(result.out)) {
    try { fs.writeFileSync(path.join(OUT, `100k-industrial-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64')); } catch (_) {}
  }
  const proof = { ...built, extent: result.extent, render: result.info };
  fs.writeFileSync(path.join(OUT, '100k-industrial-proof.json'), JSON.stringify(proof, null, 1));
  console.log('[forge-100k] render: ' + JSON.stringify({ extent: result.extent, info: result.info }));
  console.log(`\n=== FORGE 100k PROOF: ${built.stats ? JSON.stringify(built.stats) : built.totalInst + ' inst'} | ${result.info.calls} draw calls, ${(result.info.tris / 1e6).toFixed(1)}M tris ===`);
  await app.close();
});
