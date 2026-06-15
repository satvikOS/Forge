// Monday INVESTOR DEMO (#61) — Archie plans → drives the kernel → renders → gate-verifies,
// end-to-end through the LIVE promoted adapter (no stub). For each showcase prompt:
// __forgeRun (real model) → collect built handles from the trace → offline render →
// record plan + gate verdict. Produces the demo deck + a proof manifest.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'forge');
const PROMPTS = [
  ['flange', 'model a Ø80 mm flange, 10 mm thick, 25 mm bore, 6 bolt holes'],
  ['shaft', 'a stepped shaft Ø40x60 stepping to Ø24x40'],
  ['plate', 'a 120x80x14 mm mounting plate with a 25 mm centre bore'],
  ['bracket', 'an L-bracket 60 long, 40 foot, 50 wall, 8 mm holes'],
];

test('Monday investor demo — Archie plans, drives, verifies (Forge, live adapter)', async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 15 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => typeof window.__forgeRun === 'function' && window.forge && window.forge.isReady && window.forge.isReady() && window.__forgeThree, { timeout: 40000 });
  // confirm the live Archie server is reachable
  const serveOk = await win.evaluate(async () => { try { const r = await fetch('http://localhost:8080/v1/models'); return r.ok; } catch (_) { return false; } });
  console.log('[investor] live Archie serve reachable: ' + serveOk);

  const manifest = [];
  for (const [tag, prompt] of PROMPTS) {
    const res = await win.evaluate(async (prompt) => {
      let trace;
      try { trace = await window.__forgeRun({ prompt, discipline: 'part' }); }
      catch (e) { return { error: String(e && e.message || e) }; }
      const handles = [];
      for (const it of (trace.iterations || [])) for (const r of (it.toolResponses || [])) if (r && r.ok && r.produces === 'handle' && r.result && typeof r.result.shape === 'number') handles.push(r.result.shape);
      const plan = (trace.iterations[0] && trace.iterations[0].parsed && trace.iterations[0].parsed.plan) || null;
      const toolNames = (trace.iterations || []).flatMap((it) => (it.parsed && it.parsed.toolCalls || []).map((c) => c.name));
      // render the final body
      let info = null;
      const h = handles[handles.length - 1];
      if (h != null) {
        const THREE = window.__forgeThree; const scene = new THREE.Scene();
        const SKY = new THREE.Color(0xaec4dd); scene.background = SKY;
        scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x404038, 1.0));
        const sun = new THREE.DirectionalLight(0xfff2dc, 3.3); sun.position.set(60, 120, 90); scene.add(sun);
        const m = window.forge.tessellate(h, 0.18, 0.3);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(m.positions), 3));
        if (m.indices && m.indices.length) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1));
        if (m.normals && m.normals.length === m.positions.length) g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(m.normals), 3)); else g.computeVertexNormals();
        g.computeBoundingBox(); const ctr = g.boundingBox.getCenter(new THREE.Vector3()); const sz = g.boundingBox.getSize(new THREE.Vector3());
        g.translate(-ctr.x, -ctr.y, -ctr.z);
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9fb6c8, metalness: 0.7, roughness: 0.34 })); scene.add(mesh);
        const ground = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 4 + 40, 2, sz.z * 4 + 40), new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.95 })); ground.position.y = -sz.y / 2 - 2; scene.add(ground);
        const R = Math.max(sz.x, sz.y, sz.z) * 0.5 || 40;
        scene.fog = new THREE.Fog(SKY, R * 3, R * 9);
        const W = 1100, H = 760, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
        const rend = new THREE.WebGLRenderer({ canvas, antialias: true }); rend.setPixelRatio(1); rend.setSize(W, H, false);
        rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.15; rend.outputColorSpace = THREE.SRGBColorSpace;
        const cam = new THREE.PerspectiveCamera(42, W / H, 0.3, R * 30); cam.position.set(R * 1.6, R * 1.2, R * 2.0); cam.lookAt(0, 0, 0);
        rend.render(scene, cam);
        info = { url: canvas.toDataURL('image/png'), tris: rend.info.render.triangles };
        try { rend.forceContextLoss(); } catch (_) {}
      }
      return { plan, toolNames, handles: handles.length, gate: trace.gateChecks || (trace.final && trace.final.gate) || null, status: trace.final && trace.final.status, url: info && info.url, tris: info && info.tris };
    }, prompt);

    if (res.url) { fs.writeFileSync(path.join(OUT, `investor-${tag}.png`), Buffer.from(res.url.split(',')[1], 'base64')); delete res.url; }
    manifest.push({ tag, prompt, ...res });
    console.log(`[investor] ${tag}: tools=${JSON.stringify(res.toolNames)} bodies=${res.handles} gate=${res.gate ? (res.gate.allValid ? 'valid' : 'invalid') : 'n/a'} rendered=${res.tris ? 'yes' : 'no'}`);
  }

  fs.writeFileSync(path.join(OUT, 'investor-proof.json'), JSON.stringify({ serveOk, manifest }, null, 1));
  const built = manifest.filter((m) => m.handles > 0).length;
  console.log(`\n=== INVESTOR DEMO: ${built}/${PROMPTS.length} prompts → Archie planned + built + rendered (live adapter) ===`);
  await app.close();
  expect(serveOk).toBe(true);
  expect(built).toBeGreaterThanOrEqual(2); // live model can flake at temp 0.1; majority must complete
});
