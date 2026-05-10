import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const COLLISION_ROOT = path.join(REPO_ROOT, 'foundation-output', 'collision');
const FASTENER_ROOT = path.join(REPO_ROOT, 'foundation-output', 'fasteners');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

test.describe('Foundation collision detection + fastener library', () => {
  test.beforeAll(() => {
    ensure(COLLISION_ROOT); ensure(FASTENER_ROOT); ensure(SS_ROOT);
  });

  test('Collision sweep: hinge through 0° to 270° rotation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const out = await page.evaluate(async () => {
      const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
      const { sweepCollision } = await import('/src/foundation/CollisionDetection.js');

      const leafA = await buildLeafA();
      const leafB = await buildLeafB();
      const pin = await buildHingePin();

      // LeafA stays at origin. LeafB rotates about the knuckle axis.
      // Knuckle axis center in leafA local frame: x=50, y=15, z=2 (per
      // HingedBracketPair build). The pin is along Z there.
      // To rotate leafB about that axis, we need to:
      //   1. translate leafB so its mating axis sits at origin
      //   2. rotate by angle around Z
      //   3. translate to bring it to leafA's knuckle position
      //
      // LeafB's mating axis is at its OWN x=50, y=15, z=2 in local
      // coords. We apply a sequence of translations + rotations
      // through the assembly transform.
      const parts = [
        { name: 'leafA', manifold: leafA, transform: { translation: [0, 0, 0], rotation: [0, 0, 0] }},
        { name: 'leafB', manifold: leafB, transform: { translation: [0, 0, 0], rotation: [0, 0, 0] }},
        { name: 'pin',   manifold: pin,   transform: { translation: [50, 15, 2], rotation: [0, 0, 0] }},
      ];

      // Composite-transform driver: bring leafB's pivot to the world
      // origin, rotate, then move to leafA's pivot at (50, 15, 2).
      // For Manifold transforms we apply rotation FIRST (in local
      // frame), then translation (in world). So we cannot easily
      // express "rotate around an offset point" in one transform.
      //
      // Workaround: we precompose by first translating leafB by
      // (-50, -15, -2), then rotating, then translating by (50, 15, 2)
      // — but our transform is just (rotation, translation).
      //
      // Cleanest: pre-bake leafB centered at origin (already centered
      // around its own knuckle by virtue of how we build it... but
      // actually the knuckle is at x=50). So we'll pre-translate leafB
      // to put the knuckle at origin once, and use that as the working
      // manifold.
      const leafB_centered = leafB.translate([-50, -15, -2]);
      parts[1].manifold = leafB_centered;

      // Driver: t in [0, 1] → angle θ ∈ [180°, 360°]
      // (In our hinge build the two leaves are coplanar in z so they
      // overlap at θ=0°; the "open" position is at θ=180° where leafB
      // points in +x and leafA points in −x. As we close the hinge by
      // rotating from 180° toward 0°/360°, the leaves swing into each
      // other and the first collision tells us the hinge cannot
      // physically close past that angle.)
      const driver = (t) => {
        const angleDeg = 180 + t * 180;
        parts[1].transform.rotation = [0, 0, angleDeg];
        parts[1].transform.translation = [50, 15, 2];
      };

      // Threshold of 500 mm³ skips the (legitimate) knuckle interleaving
      // overlap (~377 mm³ at full open) — the leafA knuckle is MEANT to
      // share space with leafB's split knuckles since they're held together
      // by the hinge pin. Only flag actual leaf-body interference.
      const sweep = await sweepCollision(parts, driver, {
        steps: 36, minVolumeMm3: 500,
      });

      return {
        sweep,
        leafA_volume: leafA.volume(),
        leafB_volume: leafB.volume(),
      };
    });

    const angleAt = (t) => 180 + t * 180;
    console.log(`\n=== HINGE COLLISION SWEEP (180° → 360°) ===`);
    console.log(`Steps: ${out.sweep.steps}`);
    console.log(`First contact at t = ${out.sweep.firstContactT === null ? 'never' : out.sweep.firstContactT.toFixed(3)}` +
      (out.sweep.firstContactT !== null ? ` (angle ≈ ${angleAt(out.sweep.firstContactT).toFixed(1)}°)` : ''));
    console.log(`Max interference volume: ${out.sweep.maxVolume.toFixed(3)} mm³ at angle ≈ ${out.sweep.maxVolumeT !== null ? angleAt(out.sweep.maxVolumeT).toFixed(1) + '°' : 'n/a'}`);
    console.log(`Collision-free range: angle ∈ [180°, ${angleAt(out.sweep.collisionFreeRange[1]).toFixed(1)}°]`);

    // Print frame-by-frame summary at first contact and a few
    // representative angles
    const samples = [0, 4, 9, 14, 18, 22, 27, 31, 36];
    console.log(`Frame samples (angle, total interference vol):`);
    for (const i of samples) {
      const f = out.sweep.frames[Math.min(i, out.sweep.frames.length - 1)];
      console.log(`  ${angleAt(f.t).toFixed(1).padStart(5)}°: ${f.collisions.length} collision(s), V = ${f.totalVolume.toFixed(3)} mm³`);
    }

    fs.writeFileSync(path.join(COLLISION_ROOT, 'hinge-sweep.json'), JSON.stringify(out.sweep, null, 2));

    expect(out.sweep.steps).toBeGreaterThan(20);
    // 180° (coplanar) should be collision-free (zero-volume meeting).
    // Some non-zero contact angle should be detected as we close.
    expect(out.sweep.firstContactT).not.toBe(null);
    expect(out.sweep.firstContactT).toBeGreaterThan(0);
    // Stacked-at-360° should give a large interference (≈ leaf body
    // volume = 50 × 30 × 4 = 6000 mm³)
    expect(out.sweep.maxVolume).toBeGreaterThan(1000);
  });

  test('ISO fastener gallery: M3-M10 SHCS + nuts + washers', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const out = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { iso4762, iso4032, iso7089, FASTENER_CATALOGS, describeFastener }
        = await import('/src/foundation/FastenerLib.js');
      const { manifoldToMesh } = await import('/src/foundation/ManifoldThreeBridge.js');
      const { buildPrintReport, toBinarySTL } = await import('/src/foundation/STLExport.js');
      const { StudioLighting } = await import('/src/kernel/index.js');

      const sizes = ['M3', 'M4', 'M5', 'M6', 'M8', 'M10'];
      const lengths = { M3: 12, M4: 16, M5: 20, M6: 25, M8: 30, M10: 40 };

      // Build all fasteners + collect reports
      const allParts = {};
      const allReports = {};
      const allSTL = {};
      for (const size of sizes) {
        const screw = await iso4762(size, lengths[size]);
        const nut = await iso4032(size);
        const washer = await iso7089(size);
        allParts[`${size}-screw`] = screw;
        allParts[`${size}-nut`] = nut;
        allParts[`${size}-washer`] = washer;
        allReports[size] = {
          screw: { ...buildPrintReport(screw), spec: describeFastener(size, lengths[size]) },
          nut: buildPrintReport(nut),
          washer: buildPrintReport(washer),
        };
        const enc = (a) => { let b = ''; for (let i = 0; i < a.length; i++) b += String.fromCharCode(a[i]); return btoa(b); };
        allSTL[`${size}-screw`] = enc(toBinarySTL(screw));
        allSTL[`${size}-nut`] = enc(toBinarySTL(nut));
        allSTL[`${size}-washer`] = enc(toBinarySTL(washer));
      }

      // Layout in the viewport: 6 rows × 3 columns (screw, washer, nut)
      const scene = window.__three_scene;
      const renderer = window.__three_renderer;
      const toRemove = [];
      scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
      for (const o of toRemove) o.parent?.remove(o);

      const root = new THREE.Group();
      const colors = { screw: 0xc0c0c8, washer: 0x9aa3ad, nut: 0x808088 };
      let yCursor = 0;
      const ROW_GAP = 25, COL_GAP = 30;
      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        const screw = manifoldToMesh(allParts[`${size}-screw`], { color: colors.screw, roughness: 0.4, metalness: 0.7 });
        const washer = manifoldToMesh(allParts[`${size}-washer`], { color: colors.washer, roughness: 0.5, metalness: 0.6 });
        const nut = manifoldToMesh(allParts[`${size}-nut`], { color: colors.nut, roughness: 0.5, metalness: 0.7 });
        screw.position.set(0, -yCursor, 0);
        washer.position.set(COL_GAP, -yCursor, 0);
        nut.position.set(COL_GAP * 2, -yCursor, 0);
        root.add(screw); root.add(washer); root.add(nut);
        yCursor += ROW_GAP;
      }
      scene.add(root);

      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const lightsToRemove = [];
      scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
      for (const l of lightsToRemove) scene.remove(l);
      StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6 });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      return {
        bbox: { center: center.toArray(), size: size.toArray() },
        reports: allReports,
        stls: allSTL,
        catalog: FASTENER_CATALOGS,
      };
    });

    // Save STLs + reports
    for (const [name, b64] of Object.entries(out.stls)) {
      fs.writeFileSync(path.join(FASTENER_ROOT, `${name}.stl`), Buffer.from(b64, 'base64'));
    }
    fs.writeFileSync(path.join(FASTENER_ROOT, 'fastener-reports.json'), JSON.stringify(out.reports, null, 2));
    fs.writeFileSync(path.join(FASTENER_ROOT, 'iso-catalog.json'), JSON.stringify(out.catalog, null, 2));

    console.log(`\n=== ISO FASTENER LIBRARY ===`);
    for (const size of ['M3','M4','M5','M6','M8','M10']) {
      const r = out.reports[size];
      console.log(`  ${size.padEnd(4)}: SHCS ${r.screw.spec.designation.padEnd(20)} ` +
        `(${r.screw.triangles} tri, ${r.screw.volumeMm3.toFixed(0)} mm³),  ` +
        `nut (${r.nut.triangles} tri, ${r.nut.volumeMm3.toFixed(1)} mm³),  ` +
        `washer (${r.washer.triangles} tri, ${r.washer.volumeMm3.toFixed(1)} mm³)`);
    }

    // Render gallery from multiple angles
    const c = out.bbox.center;
    const dist = Math.max(...out.bbox.size) * 1.6;
    const renderView = async (name, cameraPos, fov, label) => {
      await page.evaluate(async (s) => {
        const cam = window.__three_camera;
        cam.position.set(...s.cameraPos);
        cam.lookAt(...s.lookAt);
        cam.fov = s.fov; cam.near = 0.001; cam.far = s.far;
        cam.updateProjectionMatrix();
        window.__three_renderer.render(window.__three_scene, cam);
      }, { cameraPos, lookAt: c, fov, far: dist * 30 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SS_ROOT, `${name}.png`), fullPage: false });
      console.log(`  ✓ ${name}.png — ${label}`);
    };

    await renderView('fasteners-gallery-01-iso', [c[0] + dist * 0.7, c[1] - dist * 0.4, c[2] + dist * 0.6], 32, 'iso, full set');
    await renderView('fasteners-gallery-02-front', [c[0], c[1] - dist * 1.0, c[2] + dist * 0.05], 30, 'front, lined up');
    await renderView('fasteners-gallery-03-top', [c[0], c[1] + dist * 0.05, c[2] + dist * 1.2], 30, 'top, M3-M10');

    // 18 STL files (6 sizes × 3 types)
    const stlFiles = fs.readdirSync(FASTENER_ROOT).filter(f => f.endsWith('.stl'));
    expect(stlFiles.length).toBe(18);
  });
});
