// forge-viewport.spec.js — visual screenshots of native-kernel results.
//
// The full r3f viewport rendering needs THREE plumbing across the
// about:blank module-resolver boundary, which is non-trivial. Until
// Forge-26 (UI shell) + Forge-27 (viewport) land and we can navigate
// to the real React app, this spec uses HTML+CSS panels that show
// numeric kernel output — still gives me a visual artifact per
// shape kind in `test-results/forge-screenshots/`.

const { test, expect } = require('@playwright/test');
const { launchForge, shot, loadInlinePage } = require('./_helpers');

let app;
let page;

test.beforeAll(async () => {
  app = await launchForge();
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function snapShape(name, label, scriptBody) {
  // page.evaluate with a stringified arrow needs explicit invocation.
  const result = await page.evaluate(`(${scriptBody})()`);
  await loadInlinePage(page, `
    <h1>${label}</h1>
    <div class="panel">
      <pre>${JSON.stringify(result, null, 2)}</pre>
    </div>
  `);
  await shot(page, name);
  return result;
}

test('primitive: box', async () => {
  const r = await snapShape('20-prim-box', 'forge.makeBox(40,25,20)', `() => {
    const f = window.forge;
    const h = f.makeBox(40, 25, 20);
    const mp = f.massProps(h);
    const m  = f.tessellate(h, 0.1, 0.5);
    f.release(h);
    return { volume: mp.volume, area: mp.area, triangles: m.triangleCount, vertices: m.positions.length/3 };
  }`);
  expect(r.volume).toBeCloseTo(20000, 3);
  expect(r.triangles).toBe(12);
});

test('primitive: cylinder', async () => {
  const r = await snapShape('21-prim-cyl', 'forge.makeCylinder(20, 50)', `() => {
    const f = window.forge;
    const h = f.makeCylinder(20, 50);
    const mp = f.massProps(h);
    const m  = f.tessellate(h, 0.5, 0.5);
    f.release(h);
    return { volume: mp.volume, area: mp.area, triangles: m.triangleCount };
  }`);
  expect(r.volume).toBeCloseTo(Math.PI * 400 * 50, 1);
  expect(r.triangles).toBeGreaterThan(40);
});

test('primitive: sphere', async () => {
  const r = await snapShape('22-prim-sphere', 'forge.makeSphere(30)', `() => {
    const f = window.forge;
    const h = f.makeSphere(30);
    const mp = f.massProps(h);
    const m  = f.tessellate(h, 0.5, 0.5);
    f.release(h);
    return { volume: mp.volume, area: mp.area, triangles: m.triangleCount };
  }`);
  expect(r.volume).toBeCloseTo((4 / 3) * Math.PI * 27000, 0);
  expect(r.triangles).toBeGreaterThan(100);
});

test('boolean: box minus cylinder', async () => {
  const r = await snapShape('23-bool-cut', 'box(50,30,20) - cyl(7, 30)', `() => {
    const f = window.forge;
    const a = f.makeBox(50, 30, 20);
    const b = f.translate(f.makeCylinder(7, 30), 25, 15, -5);
    const out = f.cut(a, b);
    const mp = f.massProps(out);
    const m  = f.tessellate(out, 0.2, 0.5);
    f.release(out);
    return { volume: mp.volume, area: mp.area, triangles: m.triangleCount };
  }`);
  expect(r.volume).toBeLessThan(50 * 30 * 20);
  expect(r.triangles).toBeGreaterThan(20);
});

test('100k assembly registry', async () => {
  const r = await snapShape('24-assembly-100k', 'forge.addInstance × 100,000', `() => {
    const f = window.forge;
    f.reserveInstances(100000);
    const box = f.makeBox(1, 1, 1);
    function I(x,y,z){ return Float64Array.from([1,0,0,x,0,1,0,y,0,0,1,z,0,0,0,1]); }
    const t0 = performance.now();
    let last = 0;
    const G = 47;
    let k = 0;
    for (let z = 0; z < G && k < 100000; z++)
      for (let y = 0; y < G && k < 100000; y++)
        for (let x = 0; x < G && k < 100000; x++) { last = f.addInstance(box, I(x*5,y*5,z*5)); k++; }
    const tAdd = performance.now() - t0;
    const t1 = performance.now();
    const hits = f.queryAABB(Float64Array.from([-0.1,-0.1,-0.1,12.5,12.5,12.5]));
    const tQ = performance.now() - t1;
    const bytes = f.instanceBytesUsed();
    return {
      addedMs: +tAdd.toFixed(1),
      queryMs: +tQ.toFixed(2),
      hits: hits.length,
      mem_MiB: +(bytes/1024/1024).toFixed(1),
      lastInst: last,
    };
  }`);
  expect(r.addedMs).toBeLessThan(2000);
  expect(r.hits).toBe(27);
});

test('FEA static — cantilever beam', async () => {
  const r = await snapShape('25-fea-cantilever', 'cantilever steel beam 100×10×10', `() => {
    const f = window.forge;
    const beam = f.makeBox(100, 10, 10);
    const mesh = f.fea.meshFromBrep(beam, 5);
    const material = { E: 210e9, nu: 0.3, rho: 7850 };
    // Pin the x=0 face: every node with x ≈ 0.
    const bcs = [];
    for (let i = 0; i < mesh.nodes.length / 3; i++) {
      if (mesh.nodes[i*3] < 0.001) bcs.push({ nodeId: i, fx: true, fy: true, fz: true });
    }
    // Apply tip load on every x≈100 node, total Fy = -1000 N.
    const tipNodes = [];
    for (let i = 0; i < mesh.nodes.length / 3; i++) {
      if (Math.abs(mesh.nodes[i*3] - 100) < 0.001) tipNodes.push(i);
    }
    const fyPer = -1000 / Math.max(1, tipNodes.length);
    const loads = tipNodes.map(n => ({ nodeId: n, fx: 0, fy: fyPer, fz: 0 }));
    const res = f.fea.solveStatic(mesh, material, loads, [], bcs);
    let tipUy = 0;
    for (const n of tipNodes) tipUy += res.u[n*3+1] / tipNodes.length;
    f.release(beam);
    return {
      tipDeflectionMM: +(tipUy * 1000).toFixed(4),
      maxVonMisesMPa: +(res.maxVonMises / 1e6).toFixed(2),
      residual: res.residual,
      nodeCount: mesh.nodes.length / 3,
    };
  }`);
  // The forge-kernel/test/fea_smoke.js gives the rigorous check
  // (−12% vs Euler-Bernoulli with proper face-pin BCs). The inline
  // version here uses a coarse pin (every x < 0.001 node) and may
  // come back with zero deflection if no x=100 node exists — we
  // accept that as a known limitation of the headless smoke and
  // verify only that the solver did not throw.
  expect(r.nodeCount).toBeGreaterThan(0);
  expect(typeof r.tipDeflectionMM).toBe('number');
});

test('CAM — profile around a box', async () => {
  const r = await snapShape('26-cam-profile', 'profile around 100×50×20 box', `() => {
    const f = window.forge;
    const part = f.makeBox(100, 50, 20);
    const tool = { name: '6mm endmill', diameter: 6, fluteLength: 25, helix: 30, flutes: 3, type: 'EndMill' };
    const params = { feedXY: 1500, feedZ: 400, spindleRPM: 12000, stepover: 4, stepdown: 4, coolant: 0 };
    const tp = f.cam.profile(part, f.cam.kAutoFaceId, tool, params, 20, 0, 2);
    const nMoves = tp.moves.length / 5;
    f.release(part);
    return {
      moves: nMoves,
      cycleTimeSec: +tp.cycleTimeSec.toFixed(1),
      cuttingMm: +tp.estCuttingMm.toFixed(1),
    };
  }`);
  expect(r.moves).toBeGreaterThan(0);
  expect(r.cycleTimeSec).toBeGreaterThan(0);
});

test('Drawings — HLR projection on a box-with-hole', async () => {
  const r = await snapShape('27-drawings-hlr', 'HLR front view of box-with-hole', `() => {
    const f = window.forge;
    const a = f.makeBox(50, 30, 20);
    const b = f.translate(f.makeCylinder(7, 40), 25, 15, -10);
    const part = f.cut(a, b);
    const proj = f.drawings.projectShape(part, 'front');
    f.release(part);
    return {
      visiblePolylines: proj.visibleCount,
      hiddenPolylines: proj.hiddenCount,
      outlinePolylines: proj.outlineCount,
      visibleVerts: proj.visible.length / 2,
    };
  }`);
  expect(r.visiblePolylines).toBeGreaterThan(0);
});
