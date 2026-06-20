// demo-ge9x-marketing-exterior.spec.js — GE9X MARKETING EXTERIOR BEAUTY PASS
// ============================================================================
// A glossy PRODUCT-SHOT of the GE9X turbofan with its NACELLE SHELL ON (the
// recognizable cowl-on exterior, like an RR/GE/PW marketing image), pushed as
// far as the renderer allows. This is a beauty pass for the demo.
//
// APPROACH (exterior = few bodies → use the real GPU path tracer):
//   1. Build the REAL flagship engine (buildGE9X). Then publish ONLY the
//      nacelle-SHELL exterior prototypes (inlet lip + fan cowl + core cowl +
//      exhaust nozzle + tail cone + pylon + bypass duct + nacelle) — plus the
//      fan face (fan blades + spinner) at the inlet for the iconic look — to the
//      React SceneMeshes path so each lands as a single placed mesh tagged
//      userData.forgeBody. The ~20k INTERNAL instances are NOT rendered (not
//      visible from outside; keeps it light + avoids OOM).
//   2. setupPhotoreal → engineer-correct PBR per component (CFRP/anodised cowl,
//      polished-metal inlet lip, titanium accents, clearcoat) + HDRI studio/
//      hangar env (IBL + visible background) + ACES.
//   3. Render with the Forge GPU path tracer (window.__forgeRunPathTracedRender:
//      three-gpu-pathtracer, GI/reflections, reflective ground, thin-lens-ish
//      framing, ACES + grade). HERO 3/4-front angle. High spp / hi-res.
//      FALL BACK to the realtime r3f viewport at max quality if the path tracer
//      can't cleanly render the assembly.
//   4. Deliver a hero still PNG (highest quality) + a short TURNTABLE mp4 (slow
//      orbit of the shell-on engine, realtime PBR) →
//      shots/flagship/ge9x/ge9x-marketing-exterior.{png,mp4}
//
// PNGs are written from the renderer via dataURL → fs (no save dialog).
//
// Run manually, HEADED, on the Mac Studio:
//   cd /Users/account_clawteam1/archdisc-Mech
//   (cd frontend && npm run build)
//   npx playwright test e2e/forge/demo-ge9x-marketing-exterior.spec.js \
//     --config=playwright.config.js --headed

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const NAME = 'ge9x';
const SHOT_DIR  = path.resolve(`/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/flagship/${NAME}`);
const FRAME_DIR = path.join(SHOT_DIR, 'mkt-frames');
const HERO_PNG  = path.join(SHOT_DIR, 'ge9x-marketing-exterior.png');
const TURN_MP4  = path.join(SHOT_DIR, 'ge9x-marketing-exterior.mp4');
const TMP_DIR   = '/tmp/ge9xmkt';
fs.mkdirSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
const BUILDER_PATH  = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/ge9xBuilder.js');
const RENDER_HELPER = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/forgeFlagshipRender.js');

// Hangar HDRI reads well on a full nacelle (broad skylight sweep over the cowl).
const FLAGSHIP_ENV = 'hangar';

function ffmpegBin() {
  try { return require('/Users/account_clawteam1/archdisc-Mech/node_modules/ffmpeg-static'); }
  catch (_) { return 'ffmpeg'; }
}

// Write a dataURL (data:image/png;base64,…) to a file.
function writeDataUrlPng(dataUrl, filePath) {
  const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
}

function viewportCanvas(page) {
  const tagged = page.locator('[data-testid="forge-v4-canvas"]');
  return { tagged, fallback: page.locator('canvas').first() };
}
async function shotCanvas(page, filePath) {
  const { tagged, fallback } = viewportCanvas(page);
  const loc = (await tagged.count()) > 0 ? tagged : fallback;
  await loc.screenshot({ path: filePath });
}

let _frameN = 0;
async function frame(page) {
  const f = path.join(FRAME_DIR, `f_${String(_frameN++).padStart(5, '0')}.png`);
  await shotCanvas(page, f);
  return f;
}

test.describe.serial('GE9X · marketing exterior beauty pass (shell-on, path-traced)', () => {
  let app, page;
  const facts = {};

  test.beforeAll(async () => {
    for (const f of fs.readdirSync(FRAME_DIR)) {
      if (f.endsWith('.png')) fs.unlinkSync(path.join(FRAME_DIR, f));
    }
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 15000 });
    await page.waitForFunction(
      () => !!(window.forge && window.forge.isReady && window.forge.isReady()), { timeout: 20000 });
    await page.waitForTimeout(800);
  });

  test.afterAll(async () => { if (app) await app.close(); });

  // ── STAGE 1 — build engine, isolate the SHELL exterior, photoreal it ───────
  test('stage 1 · build + isolate nacelle shell + photoreal', async () => {
    test.setTimeout(900000);

    const ready = await page.evaluate(() =>
      !!(window.forge && window.forge.isReady && window.forge.isReady()
         && window.__forgeEngine && typeof window.__forgeEngine.dispatchToolCall === 'function'
         && typeof window.__forgeAppendBody === 'function'));
    expect(ready, 'native kernel + dispatch + appendBody must be wired').toBe(true);

    // Clean slate.
    await page.evaluate(() => { try { window.__forgeSetBodies?.([]); window.__forgeBodies = []; } catch (_) {} });

    // Build the REAL flagship engine.
    const res = await page.evaluate(async (builderUrl) => {
      const mod = await import(/* @vite-ignore */ builderUrl);
      const buildGE9X = mod.buildGE9X || mod.default;
      const r = await buildGE9X(window.forge);
      window.__ge9x = r;
      return {
        uniqueBodies: r.uniqueBodies,
        totalComponents: r.totalComponents,
        bodies: r.bodies.map((b) => ({ name: b.name, handle: b.handle, role: b.role, bbox: b.bbox })),
        bboxMm: r.bboxMm,
      };
    }, BUILDER_PATH);
    facts.uniqueBodies = res.uniqueBodies;
    facts.totalComponents = res.totalComponents;
    facts.bboxMm = res.bboxMm;
    console.log(`[mkt] built: ${res.uniqueBodies} unique, ${res.totalComponents} components, ` +
                `envelope ${res.bboxMm ? Object.values(res.bboxMm).map(Math.round).join('×') : '?'} mm`);
    console.log('[mkt] body names:', res.bodies.map((b) => b.name).join(', '));

    // SHELL exterior bodies = the cowl-on nacelle chain + (optionally) the fan
    // face for the iconic inlet look. Match by name. The internals (compressor/
    // turbine/combustor blades, bolts, cooling holes, shafts) are EXCLUDED.
    const SHELL_RE  = /nacelle|cowl|inlet[_-]?lip|exhaust[_-]?nozzle|nozzle[_-]?cone|tail[_-]?cone|pylon|bypass[_-]?duct|spinner|containment/i;
    const FANFACE_RE = /fan[_-]?blade|spinner|fan[_-]?disk|fan[_-]?platform|ogv|outlet[_-]?guide/i;

    const shellBodies = res.bodies.filter((b) => SHELL_RE.test(b.name));
    const fanFaceBodies = res.bodies.filter((b) => FANFACE_RE.test(b.name) && !SHELL_RE.test(b.name));
    facts.shellNames = shellBodies.map((b) => b.name);
    facts.fanFaceNames = fanFaceBodies.map((b) => b.name);
    console.log('[mkt] SHELL bodies:', facts.shellNames.join(', ') || '(none!)');
    console.log('[mkt] FAN-FACE bodies (iconic inlet):', facts.fanFaceNames.join(', ') || '(none)');
    expect(shellBodies.length, 'the nacelle SHELL exterior bodies must exist in the builder').toBeGreaterThan(0);

    // Publish ONLY the shell (+ fan face) to the React SceneMeshes path so each
    // lands as a single placed mesh tagged userData.forgeBody — exactly what the
    // path tracer's harvestScene() picks up. We do NOT renderAssemblyInstances
    // (that would draw the 20k internals + OOM risk).
    const publishList = [...shellBodies, ...fanFaceBodies];
    await page.evaluate((bs) => {
      window.__forgeSetBodies?.([]); window.__forgeBodies = [];
      for (const b of bs) {
        window.__forgeAppendBody({ id: `ge9x-${b.name}`, name: b.name, kind: 'native',
                                   handle: b.handle, toolId: 'flagship.ge9x.exterior' });
      }
    }, publishList);
    await page.waitForTimeout(400);
    const inScene = await page.evaluate(() =>
      (window.__forgeBodies || []).filter((b) => b.toolId === 'flagship.ge9x.exterior').length);
    console.log(`[mkt] published ${inScene} exterior bodies to the scene`);
    expect(inScene, 'shell + fan-face bodies must be in the viewport').toBe(publishList.length);

    // PHOTOREAL — engineer-correct PBR per component + HDRI + ACES. Inlet lip
    // gets a polished-metal pin override (the bright "fat lip" highlight) on top
    // of the by-tag materials; the cowl reads as lacquered composite/anodised.
    const photoreal = await page.evaluate(async (args) => {
      const mod = await import(/* @vite-ignore */ args.helperUrl);
      const bodies = window.__ge9x.bodies.map((b) => ({ name: b.name, handle: b.handle }));
      const r = mod.setupPhotoreal(bodies, { environment: args.env, exposure: 1.08, background: true });
      // Inlet-lip override → near-mirror polished aluminium (the iconic bright
      // highlight ring). Match the lip body by name; pin its PBR preset.
      try {
        const lip = window.__ge9x.bodies.find((b) => /inlet[_-]?lip|^lip$|highlight/i.test(b.name));
        if (lip && window.__forgeBodyPBR instanceof Map) {
          window.__forgeBodyPBR.set(lip.handle, {
            color: '#dfe3e8', metalness: 1.0, roughness: 0.08,
            envMapIntensity: 1.35, clearcoat: 0.4, clearcoatRoughness: 0.1,
          });
          if (window.__forgeBodyColors instanceof Map) window.__forgeBodyColors.set(lip.handle, '#dfe3e8');
        }
        window.dispatchEvent(new CustomEvent('forge:body-colors-changed'));
      } catch (_) {}
      return { env: r.env, counts: r.materials.counts };
    }, { helperUrl: RENDER_HELPER, env: FLAGSHIP_ENV });
    console.log('[mkt] photoreal materials:', JSON.stringify(photoreal.counts), '· env:', JSON.stringify(photoreal.env));
    expect(photoreal.env.ok, `HDRI env must mount; got ${JSON.stringify(photoreal.env)}`).toBe(true);
    facts.materialCounts = photoreal.counts;

    // Frame the shell from a 3/4-front hero angle so the inlet/fan face + cowl
    // sweep + nozzle all read. Use the published-bodies bounding box.
    await page.evaluate(() => { window.__forgeFit?.(); });
    await page.waitForTimeout(500);
  });

  // ── STAGE 2 — PATH-TRACED HERO STILLS (GPU; high spp / hi-res) ─────────────
  test('stage 2 · path-traced hero stills (GPU)', async () => {
    test.setTimeout(900000);

    const hasPT = await page.evaluate(() => typeof window.__forgeRunPathTracedRender === 'function');
    facts.ptAvailable = hasPT;
    console.log(`[mkt] path tracer available: ${hasPT}`);

    // The headless path-tracer driver harvests window.__forgeScene meshes tagged
    // userData.forgeBody (our shell+fan-face), assigns flagship PBR by name, adds
    // a reflective ground + gradient-equirect IBL + background, ACES + grade.
    // angle 'hero' = 3/4-front [1.55,1.2,1.75]. We render at 4K hero + a 1080p
    // pair (front + iso) so the deck has options.
    const ptJobs = [
      { angle: 'hero',  samples: 220, resolutionId: '4K',    envPresetId: 'warehouse', tag: 'hero_4k' },
      { angle: 'hero',  samples: 192, resolutionId: '1080p', envPresetId: 'studio',    tag: 'hero_1080_studio' },
      { angle: 'front', samples: 160, resolutionId: '1080p', envPresetId: 'warehouse', tag: 'front_1080' },
    ];
    facts.ptResults = [];
    let heroWritten = false;
    if (hasPT) {
      for (const job of ptJobs) {
        const t0 = Date.now();
        let out;
        try {
          out = await page.evaluate(async (j) => {
            const r = await window.__forgeRunPathTracedRender({
              envPresetId: j.envPresetId, samples: j.samples, denoise: true,
              resolutionId: j.resolutionId, angle: j.angle,
            });
            return { ok: true, dataUrl: r.dataUrl, width: r.width, height: r.height, samples: r.samples };
          }, job);
        } catch (e) {
          out = { ok: false, error: e.message };
        }
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (out.ok && out.dataUrl) {
          const f = path.join(TMP_DIR, `pt_${job.tag}.png`);
          writeDataUrlPng(out.dataUrl, f);
          const bytes = fs.statSync(f).size;
          console.log(`[mkt] path-traced ${job.tag}: ${out.width}×${out.height} @ ${out.samples}spp ` +
                      `→ ${f} (${(bytes / 1024).toFixed(0)} KB, ${secs}s)`);
          facts.ptResults.push({ tag: job.tag, w: out.width, h: out.height, spp: out.samples, bytes, secs });
          // The 4K hero is the headline deliverable.
          if (job.tag === 'hero_4k' && bytes > 20000) {
            writeDataUrlPng(out.dataUrl, HERO_PNG);
            facts.heroRenderer = 'path-traced';
            facts.heroSpp = out.samples;
            facts.heroRes = `${out.width}×${out.height}`;
            heroWritten = true;
          }
        } else {
          console.log(`[mkt] path-traced ${job.tag} FAILED (${secs}s):`, out.error);
          facts.ptResults.push({ tag: job.tag, error: out.error });
        }
      }
      // If 4K hero didn't land but a 1080p one did, promote the best one.
      if (!heroWritten) {
        const best = ['hero_1080_studio', 'front_1080'].map((t) => path.join(TMP_DIR, `pt_${t}.png`))
          .find((p) => fs.existsSync(p) && fs.statSync(p).size > 20000);
        if (best) {
          fs.copyFileSync(best, HERO_PNG);
          const r = facts.ptResults.find((x) => path.join(TMP_DIR, `pt_${x.tag}.png`) === best);
          facts.heroRenderer = 'path-traced';
          facts.heroSpp = r?.spp; facts.heroRes = r ? `${r.w}×${r.h}` : '1080p';
          heroWritten = true;
        }
      }
    }
    facts.heroWritten = heroWritten;
  });

  // ── STAGE 3 — REALTIME-PBR FALLBACK / TURNTABLE ────────────────────────────
  // The realtime r3f viewport (setupPhotoreal env + ACES + reflective context)
  // gives the TURNTABLE (smooth orbit, cheap) and a fallback hero if the path
  // tracer failed.
  test('stage 3 · realtime-PBR turntable + fallback hero', async () => {
    test.setTimeout(600000);

    // Ensure clean photoreal + framed from the hero 3/4-front angle. Drive the
    // camera explicitly from the published-bodies world box.
    await page.evaluate(() => {
      try {
        const THREE = window.__forgeThree, scene = window.__forgeScene;
        if (THREE && scene) {
          const box = new THREE.Box3();
          scene.traverse((o) => {
            if (o.isMesh && o.geometry && (o.userData?.forgeBody || o.userData?.body)) {
              o.updateWorldMatrix?.(true, false);
              const b = new THREE.Box3().setFromObject(o);
              if (!b.isEmpty()) box.union(b);
            }
          });
          if (!box.isEmpty()) window.__ge9xExteriorBox = box;
        }
      } catch (_) {}
    });

    const fitHero = async (dir, margin = 1.7) => page.evaluate((a) => {
      const box = window.__ge9xExteriorBox;
      const fit = window.__forgeFitToBounds;
      if (!box || typeof fit !== 'function') return { ok: false };
      fit(box, { dir: a.dir, margin: a.margin });
      const cam = window.__forgeCamera, THREE = window.__forgeThree;
      const c = new THREE.Vector3(); box.getCenter(c);
      return { ok: true, camDistMm: cam ? Math.round(cam.position.distanceTo(c)) : null };
    }, { dir, margin });

    const fitOk = await fitHero([1.55, 0.55, 1.0], 1.7);
    console.log('[mkt] realtime hero fit →', JSON.stringify(fitOk));
    await page.waitForTimeout(400);

    // Fallback hero still (canvas screenshot at the hero angle) — only the
    // PRIMARY deliverable if the path tracer produced nothing.
    const rtHero = path.join(TMP_DIR, 'rt_hero.png');
    await shotCanvas(page, rtHero);
    if (!facts.heroWritten && fs.existsSync(rtHero) && fs.statSync(rtHero).size > 10000) {
      fs.copyFileSync(rtHero, HERO_PNG);
      facts.heroRenderer = 'realtime-PBR';
      facts.heroRes = '1920×1000 (canvas)';
      facts.heroWritten = true;
      console.log('[mkt] hero from realtime-PBR fallback');
    }

    // TURNTABLE — slow orbit of the shell-on engine via drag-orbit on the canvas.
    const canvas = page.locator('canvas').first();
    const cbox = await canvas.boundingBox();
    if (cbox) {
      const cx = cbox.x + cbox.width / 2, cy = cbox.y + cbox.height / 2;
      const STEPS = 120; // ~10s @ 12fps
      for (let i = 0; i < STEPS; i++) {
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 12, cy, { steps: 2 });
        await page.mouse.up();
        await frame(page);
      }
    }
    const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png'));
    facts.turntableFrames = frames.length;
    console.log(`[mkt] turntable captured ${frames.length} frames`);
    expect(frames.length, 'turntable must have frames').toBeGreaterThan(40);
  });

  // ── STAGE 4 — ffmpeg → turntable mp4 + extract tmp frames ──────────────────
  test('stage 4 · ffmpeg turntable mp4 + tmp extraction', async () => {
    const frames = fs.readdirSync(FRAME_DIR).filter((f) => f.endsWith('.png')).sort();
    expect(frames.length, 'turntable frames required').toBeGreaterThan(40);
    const ff = ffmpegBin();
    execFileSync(ff, [
      '-y', '-framerate', '12',
      '-pattern_type', 'glob', '-i', path.join(FRAME_DIR, 'f_*.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      TURN_MP4,
    ], { stdio: 'inherit' });
    expect(fs.existsSync(TURN_MP4), `${TURN_MP4} must exist`).toBe(true);

    // Extract hero + 2 turntable frames to /tmp/ge9xmkt for verification.
    if (fs.existsSync(HERO_PNG)) fs.copyFileSync(HERO_PNG, path.join(TMP_DIR, 'ge9x-marketing-exterior.png'));
    const t1 = path.join(FRAME_DIR, frames[Math.floor(frames.length * 0.33)]);
    const t2 = path.join(FRAME_DIR, frames[Math.floor(frames.length * 0.66)]);
    if (fs.existsSync(t1)) fs.copyFileSync(t1, path.join(TMP_DIR, 'turntable_a.png'));
    if (fs.existsSync(t2)) fs.copyFileSync(t2, path.join(TMP_DIR, 'turntable_b.png'));

    const buf = fs.readFileSync(TURN_MP4);
    console.log(`[mkt] ===== DELIVERABLES =====`);
    console.log(`[mkt] hero PNG  → ${HERO_PNG} (${fs.existsSync(HERO_PNG) ? (fs.statSync(HERO_PNG).size / 1024).toFixed(0) + ' KB' : 'MISSING'})`);
    console.log(`[mkt] turntable → ${TURN_MP4} (${(buf.length / 1e6).toFixed(1)} MB, ${frames.length} frames)`);
    console.log(`[mkt] renderer=${facts.heroRenderer} spp=${facts.heroSpp} res=${facts.heroRes}`);
    console.log(`[mkt] FACTS: ${JSON.stringify(facts)}`);
  });
});
