// ─────────────────────────────────────────────────────────────────────────────
// coherent-proof.spec.js — PROOF spec for the two CADGenBench bug-fixes
// (1800-token bundle + part.holes consolidation). HEADLESS, GENUINE-CUA.
//
// For a focused subset of CADGenBench fixtures it:
//   1. TYPES the dimensioned spec into the LIVE Forge command bar (genuine CUA —
//      the same submitPromptToConsole path the cadgenbench-cua harness uses),
//   2. watches the trained coherent-big model drive forge-kernel.node,
//   3. MEASURES the built solid (faceCount / edgeCount / massProps → hole proxy),
//   4. exports OCCT STEP, and
//   5. RENDERS the part headless at 4 camera angles (front/iso/top/right),
//      auto-framed, on a clean background → /tmp/coherent_renders/<id>_<angle>.png.
//
// This is NOT a deterministic builder: the geometry comes from the model
// operating the app (H.submitPromptToConsole → runArchie → :8080 → kernel).
// ─────────────────────────────────────────────────────────────────────────────

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const H = require('./cadgenbench-cua-helper.js');

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
const SPECS_PATH = process.env.CADGEN_SPECS || H.DEFAULT_SPECS;
const OUT_ROOT   = process.env.CADGEN_OUT   || '/Users/account_clawteam1/archdisc-Mech/cadgenbench_deliverables/cua_submission_fixed';
const RENDER_DIR = process.env.RENDER_DIR   || '/tmp/coherent_renders';
const ADAPTER    = process.env.FORGE_CUA_ADAPTER || '';
const BUILD_MS   = Number(process.env.CADGEN_BUILD_MS || 150000);
const SUBSET     = (process.env.CADGEN_ONLY || '101,114,117,120,128,135,129,147,132')
  .split(',').map((s) => s.trim()).filter(Boolean);

const GT = JSON.parse(fs.readFileSync('/tmp/gt_subset.json', 'utf8'));
const ANGLES = ['front', 'iso', 'top', 'right'];

const FIXTURES = H.pickFixtures(H.loadSpecs(SPECS_PATH), { only: SUBSET.join(','), limit: 0 });

// ── measure the finished solid's topology + mass props ───────────────────────
async function measureBody(page, handle) {
  return page.evaluate((h) => {
    const out = { faceCount: null, edgeCount: null, volume: null, valid: null, err: null };
    try {
      const f = window.forge?.direct?.faceCount;
      const e = window.forge?.direct?.edgeCount;
      out.faceCount = typeof f === 'function' ? f(h) : null;
      out.edgeCount = typeof e === 'function' ? e(h) : null;
      const mp = window.forge?.massProps ? window.forge.massProps(h) : null;
      if (mp && typeof mp === 'object') out.volume = mp.volume ?? mp.Volume ?? mp.mass ?? null;
      const cv = window.forge?.heal?.checkValidity;
      if (typeof cv === 'function') { const r = cv(h); out.valid = (r === true || r?.ok === true || r?.valid === true); }
    } catch (ex) { out.err = String(ex && ex.message || ex); }
    return out;
  }, handle);
}

// ── set the camera to one principal/iso angle, auto-framed to the part bbox ───
async function setAngle(page, name) {
  return page.evaluate((angleName) => {
    const THREE = window.__forgeThree, scene = window.__forgeScene,
          cam = window.__forgeCamera, orbit = window.__forgeOrbit, renderer = window.__forgeRenderer;
    if (!THREE || !scene || !cam || !renderer) return { ok: false, reason: 'three not published' };

    // union of part mesh bboxes — skip the infinite grid / gizmos / helpers.
    const box = new THREE.Box3(); let found = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.visible === false) return;
      const nm = `${o.name || ''} ${o.parent && o.parent.name || ''}`;
      if (/grid|gizmo|helper|ground|axes|floor/i.test(nm)) return;
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox; if (!b) return;
      const size = new THREE.Vector3(); b.getSize(size);
      const md = Math.max(size.x, size.y, size.z);
      if (!isFinite(md) || md <= 0 || md > 1e5) return; // skip infinite grid plane
      box.union(b.clone().applyMatrix4(o.matrixWorld)); found++;
    });
    if (found === 0 || box.isEmpty()) return { ok: false, reason: 'no part mesh in scene' };

    const center = new THREE.Vector3(); box.getCenter(center);
    const sph = new THREE.Sphere(); box.getBoundingSphere(sph);
    const r = Math.max(sph.radius, 1e-3);
    const fov = (cam.fov || 45) * Math.PI / 180;
    const dist = (r / Math.sin(fov / 2)) * 1.4;

    const D = {
      front: { dir: [0, 0, 1],  up: [0, 1, 0] },
      iso:   { dir: [1, 0.8, 1], up: [0, 1, 0] },
      top:   { dir: [0, 1, 0],  up: [0, 0, -1] },
      right: { dir: [1, 0, 0],  up: [0, 1, 0] },
    }[angleName] || { dir: [1, 0.8, 1], up: [0, 1, 0] };

    const dir = new THREE.Vector3(...D.dir).normalize();
    cam.up.set(...D.up);
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    cam.near = Math.max(dist - r * 4, 0.01);
    cam.far = dist + r * 8;
    cam.lookAt(center);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    if (orbit) {
      const wasDamping = orbit.enableDamping;
      orbit.enableDamping = false;
      orbit.target.copy(center);
      orbit.update();
      orbit.enableDamping = wasDamping;
    }
    // Camera-following headlight + fill so EVERY angle lights the viewed face
    // (the app's fixed directional light leaves shadow-side faces near-black).
    try {
      if (!window.__proofLights) {
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        const amb = new THREE.AmbientLight(0xffffff, 0.55);
        const hemi = new THREE.HemisphereLight(0xffffff, 0x404050, 0.9);
        scene.add(key); scene.add(amb); scene.add(hemi);
        window.__proofLights = { key, amb, hemi };
      }
      window.__proofLights.key.position.copy(cam.position);
      window.__proofLights.key.target.position.copy(center);
      window.__proofLights.key.target.updateMatrixWorld();
    } catch (_) {}
    try { renderer.render(scene, cam); renderer.render(scene, cam); }
    catch (e) { return { ok: false, reason: String(e) }; }
    return { ok: true, found, center: center.toArray().map((v) => +v.toFixed(1)), radius: +r.toFixed(1) };
  }, name);
}

test.describe.serial('coherent-proof — fixed multi-hole parts, headless multi-angle render', () => {
  let app, page;
  const results = [];

  test.beforeAll(async () => {
    test.setTimeout(60 * 60 * 1000);
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    console.log(`[proof] fixtures: ${FIXTURES.map((f) => f.id).join(',')}`);
    console.log(`[proof] adapter: ${ADAPTER || '(shipped default)'}  out: ${OUT_ROOT}  renders: ${RENDER_DIR}`);

    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox', '--use-gl=swiftshader', '--use-angle=swiftshader',
             '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    if (page.url().startsWith('devtools://')) {
      page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
        || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
    }
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.waitForLoadState('domcontentloaded');
    await H.routeAdapter(page, ADAPTER);
    await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} }).catch(() => {});
    await page.reload().catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
    await expect(page.locator('[data-testid="forge-cmdbar-input"]')).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 20000 });
    await H.waitForReady(page, 30000);
  });

  test.afterAll(async () => {
    if (app) await app.close().catch(() => {});
    fs.writeFileSync(path.join(RENDER_DIR, '_results.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), adapter: ADAPTER || '(shipped default)', results,
    }, null, 2));
    console.log(`[proof] wrote ${path.join(RENDER_DIR, '_results.json')}`);
  });

  test('00 preflight — kernel + STEP + live :8080', async () => {
    const ready = await page.evaluate(() => !!(window.forge && window.forge.isReady && window.forge.isReady()));
    expect(ready).toBe(true);
    const chatUp = await page.evaluate(async () => {
      try { const r = await fetch('http://localhost:8080/v1/models'); const j = await r.json(); return Array.isArray(j.data) && j.data.length > 0; }
      catch (_) { return false; }
    });
    expect(chatUp).toBe(true);
  });

  test('01 build + measure + render each fixture', async () => {
    test.setTimeout(60 * 60 * 1000);
    for (const fx of FIXTURES) {
      const id = fx.id;
      const gt = GT[id] || {};
      const rec = { id, family: gt.family, env: gt.env, specHoles: gt.nholes, specDiams: gt.diams,
        status: 'miss', reason: null, bodyCount: 0, handle: null, toolSteps: [], modelHoleCalls: null,
        faceCount: null, edgeCount: null, volume: null, valid: null, stepBytes: 0, renders: [] };

      await H.clearScene(page);
      console.log(`\n[${id}] family=${gt.family} env=${JSON.stringify(gt.env)} specHoles=${gt.nholes} → console`);
      await H.submitPromptToConsole(page, fx.spec);

      const n = await H.waitForBuild(page, { minBodies: 1, timeoutMs: BUILD_MS });
      rec.bodyCount = n;
      rec.toolSteps = await H.readToolSteps(page);
      // count hole-bearing tool steps the model drove
      rec.modelHoleCalls = rec.toolSteps.filter((s) => /hole|bolt-circle|grid-holes|subtract.*cyl/i.test(s)).length;

      if (n < 1) {
        rec.reason = 'no body built (honest miss)';
        console.log(`[${id}] MISS — ${rec.reason}  toolSteps=${rec.toolSteps.length}`);
        results.push(rec); continue;
      }
      const body = await H.resolveFinalBody(page);
      rec.handle = body.handle; rec.bodyCount = body.bodyCount;
      if (body.handle == null) { rec.reason = 'no numeric handle'; results.push(rec); continue; }

      const m = await measureBody(page, body.handle);
      rec.faceCount = m.faceCount; rec.edgeCount = m.edgeCount; rec.volume = m.volume; rec.valid = m.valid;

      // export STEP
      const dir = path.join(OUT_ROOT, id); fs.mkdirSync(dir, { recursive: true });
      const stepPath = path.join(dir, 'output.step');
      const ex = await H.exportStep(page, body.handle, stepPath);
      const v = ex.ok ? H.validateStepFile(stepPath) : { ok: false, reason: ex.error };
      if (v.ok) { rec.status = 'hit'; rec.stepBytes = v.bytes; } else { rec.reason = `STEP ${v.reason}`; }

      // PUSH the record + write per-fixture meta NOW (before renders) so a
      // swiftshader render crash cannot lose the measured result or the STEP.
      results.push(rec);
      try { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(rec, null, 2)); } catch (_) {}

      // multi-angle render (best-effort; a render crash must not lose the record)
      for (const ang of ANGLES) {
        let sa = null;
        try {
          sa = await setAngle(page, ang);
          await page.waitForTimeout(250);
          const fp = path.join(RENDER_DIR, `${id}_${ang}.png`);
          const tagged = page.locator('[data-testid="forge-v4-canvas"]');
          const loc = (await tagged.count().catch(() => 0)) > 0 ? tagged : page.locator('canvas').first();
          await loc.screenshot({ path: fp });
          rec.renders.push({ angle: ang, path: fp, frame: sa && sa.ok ? sa : (sa && sa.reason) });
        } catch (e) { rec.renders.push({ angle: ang, path: null, err: String(e) }); break; }
      }
      try { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(rec, null, 2)); } catch (_) {}

      console.log(`[${id}] ${rec.status}  handle=${rec.handle} faces=${rec.faceCount} edges=${rec.edgeCount} vol=${rec.volume} valid=${rec.valid} holeCalls=${rec.modelHoleCalls} step=${rec.stepBytes}B renders=${rec.renders.filter((r) => r.path).length}`);
    }

    // proof guard: at least one fixture produced a valid solid + render.
    const hits = results.filter((r) => r.status === 'hit');
    console.log(`\n[proof] ${hits.length}/${results.length} fixtures built a valid STEP solid`);
    expect(hits.length, 'the model drove NOTHING across the subset — serve/adapter/wiring broken').toBeGreaterThan(0);
  });
});
