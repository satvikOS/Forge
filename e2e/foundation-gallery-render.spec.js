import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Resolve relative to the repo root, not the playwright cwd, so the
// renders always land alongside the M8 STLs in foundation-output/.
const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

/**
 * Foundation gallery — render all 5 M8 demonstrator parts in the live
 * ArchDisc three.js viewport, capture multi-angle screenshots. The point
 * is to prove the manifold-3d output not only validates as STL but also
 * displays correctly in the viewer the rest of the app uses.
 */
test('Foundation gallery: 5 demonstrators rendered in live viewport', async ({ page }) => {
  ensure(ROOT);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { manifoldToMesh } = await import('/src/foundation/ManifoldThreeBridge.js');
    const { buildPhoneStandBracket }   = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
    const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
    const { buildPlanetary } = await import('/src/foundation/parts/PlanetaryGearset.js');
    const { buildEnclosureBase, buildEnclosureLid } = await import('/src/foundation/parts/SealedEnclosure.js');
    const { StudioLighting } = await import('/src/kernel/index.js');

    const scene = window.__three_scene;
    const renderer = window.__three_renderer;

    // Clear existing children except lights
    const toRemove = [];
    scene.traverse((o) => {
      if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o);
    });
    for (const o of toRemove) o.parent?.remove(o);

    const t0 = performance.now();
    // Build all parts in parallel
    const [
      phoneBracket,
      bottleCap, bottleNeck,
      leafA, leafB, hingePin,
      planetary,
      enclBase, enclLid,
    ] = await Promise.all([
      buildPhoneStandBracket(),
      buildBottleCap(), buildBottleNeck(),
      buildLeafA(), buildLeafB(), buildHingePin(),
      buildPlanetary(),
      buildEnclosureBase(), buildEnclosureLid(),
    ]);
    const buildSec = (performance.now() - t0) / 1000;

    // Layout: 3 columns × 2 rows on a 400 mm × 300 mm grid (work in mm)
    const layout = {
      phoneBracket: { pos: [0,   0, 0],    color: 0x5b9bd5 },   // top-left
      bottleNeck:   { pos: [-150, 0, 0],   color: 0xc0c0c0 },   // top-mid
      bottleCap:    { pos: [-100, 0, 0],   color: 0xd2b48c },   // top-mid offset
      leafA:        { pos: [-300, 0, 0],   color: 0xed7d31 },   // top-right
      leafB:        { pos: [-300, 70, 0],  color: 0xf4a261 },
      hingePin:     { pos: [-300, 140, 0], color: 0x707070 },
      planetarySun: { pos: [200, 100, 0],  color: 0xffc000 },
      planetaryRing:{ pos: [200, 100, 0],  color: 0x9aa3ad },
      planetaryP1:  { pos: [200, 115, 0],  color: 0xc55a11 },
      planetaryP2:  { pos: [215, 100, 0],  color: 0xc55a11 },
      planetaryP3:  { pos: [200, 85, 0],   color: 0xc55a11 },
      planetaryP4:  { pos: [185, 100, 0],  color: 0xc55a11 },
      enclosure:    { pos: [-150, 100, 0], color: 0x70ad47 },
      enclLid:      { pos: [-150, 100, 50],color: 0x548235 },
    };

    const root = new THREE.Group();
    root.name = 'foundation-gallery';
    scene.add(root);

    function add(manifold, position, color, name) {
      const m = manifoldToMesh(manifold, { color, roughness: 0.45, metalness: 0.25 });
      m.position.set(...position);
      m.name = name;
      root.add(m);
    }

    add(phoneBracket, [-200, -50, 0], 0x5b9bd5, 'phoneBracket');
    add(bottleNeck,   [-50, -50, 0], 0xd2b48c, 'bottleNeck');
    add(bottleCap,    [-50, -50, 30], 0xc0c0c0, 'bottleCap');
    add(leafA,        [80, -50, 0],  0xed7d31, 'leafA');
    add(leafB,        [80, -50, 50], 0xf4a261, 'leafB');
    add(hingePin,     [130, -35, 0], 0x707070, 'hingePin');

    // Planetary — sun at center, ring around, 4 planets
    const PD_SUN = 12, PD_PLANET = 18;
    const cd = (PD_SUN + PD_PLANET) / 2;  // 15 mm
    const planetCenter = [-150, 80, 0];
    add(planetary.sun,  planetCenter, 0xffc000, 'sun');
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      add(planetary.planet, [planetCenter[0] + cd * Math.cos(a), planetCenter[1] + cd * Math.sin(a), 0], 0xc55a11, `planet${i}`);
    }
    add(planetary.ring, planetCenter, 0x9aa3ad, 'ring');

    // Sealed enclosure — base on left, lid offset upward
    add(enclBase, [120, 80, 0],  0x70ad47, 'enclosureBase');
    add(enclLid,  [120, 80, 35], 0x548235, 'enclosureLid');

    // Compute bounds + lighting
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const lightsToRemove = [];
    scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
    for (const l of lightsToRemove) scene.remove(l);
    StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.5 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    return {
      buildSec: +buildSec.toFixed(3),
      partCount: root.children.length,
      bbox: { center: center.toArray(), size: size.toArray() },
    };
  });

  console.log(`\n=== FOUNDATION GALLERY ===`);
  console.log(`Built ${result.partCount} parts in ${result.buildSec}s`);
  console.log(`Bounding box: ${result.bbox.size.map(x => x.toFixed(0)).join(' × ')} mm`);

  const c = result.bbox.center;
  const dist = Math.max(...result.bbox.size) * 1.6;

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
    await page.screenshot({ path: path.join(ROOT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };

  await renderView('foundation-gallery-01-iso',
    [c[0] + dist * 0.7, c[1] - dist * 0.4, c[2] + dist * 0.6], 35, 'iso, 5 demonstrators');
  await renderView('foundation-gallery-02-top',
    [c[0], c[1] + dist * 0.05, c[2] + dist * 1.2], 30, 'top, 5 demonstrators');
  await renderView('foundation-gallery-03-front',
    [c[0], c[1] - dist * 1.2, c[2] + dist * 0.05], 30, 'front, 5 demonstrators');
  await renderView('foundation-gallery-04-side',
    [c[0] + dist * 1.2, c[1], c[2] + dist * 0.05], 30, 'side, 5 demonstrators');

  expect(result.partCount).toBeGreaterThanOrEqual(13);  // 5 demonstrators × multiple sub-parts
});
