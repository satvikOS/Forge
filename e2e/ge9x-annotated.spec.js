import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'marketing');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X annotated cutaway: SVG labels over the side-elevation render', async ({ page }) => {
  ensure(OUT);

  const W = 1920, H = 800;
  await page.setViewportSize({ width: W, height: H });

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  // Phase 1: produce a clean cutaway render with no UI chrome. We grab
  // the canvas pixels directly.
  const renderData = await page.evaluate(async (params) => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const {
      PartIDRegistry, AssemblyBridge, MarketingCutaway, StudioLighting,
    } = m;
    const GE9XBuilder = builderMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();
    const root = AssemblyBridge.renderAssembly(ge9x, window.__three_scene);

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Lighting
    const existing = [];
    window.__three_scene.traverse(o => { if (o.isLight && !o.userData?.studio) existing.push(o); });
    for (const l of existing) window.__three_scene.remove(l);
    StudioLighting.apply(window.__three_scene, {
      THREE, targetCenter: center, targetSize: size.length(), intensity: 1.4,
    });
    window.__three_scene.background = new THREE.Color(0x0a0e1a);

    window.__three_renderer.toneMapping = THREE.ACESFilmicToneMapping;
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    MarketingCutaway.apply(window.__three_scene, window.__three_renderer, {
      axisDir: new THREE.Vector3(0, 0, 1), center,
      hideAccessories: true, colorBySection: true,
    });

    // Resize renderer to our target dimensions
    window.__three_renderer.setSize(params.W, params.H, false);

    const camDist = size.z * 0.6;
    window.__three_camera.position.set(
      center.x + camDist, center.y + camDist * 0.05, center.z
    );
    window.__three_camera.lookAt(center.x, center.y, center.z);
    window.__three_camera.aspect = params.W / params.H;
    window.__three_camera.fov = 60;
    window.__three_camera.near = 0.01;
    window.__three_camera.far = camDist * 50;
    window.__three_camera.updateProjectionMatrix();
    window.__three_renderer.render(window.__three_scene, window.__three_camera);

    // Extract canvas pixels as PNG data URL
    const canvas = window.__three_renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');

    return {
      dataUrl,
      bbox: {
        zMin: box.min.z, zMax: box.max.z,
        xMin: box.min.x, xMax: box.max.x,
        center: center.toArray(), size: size.toArray(),
      },
      partCount: ge9x.partCount(),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  }, { W, H });

  console.log(`Components: ${renderData.partCount.toLocaleString()}`);
  console.log(`Canvas: ${renderData.canvasWidth} × ${renderData.canvasHeight}`);
  console.log(`Engine z range: ${renderData.bbox.zMin.toFixed(2)} → ${renderData.bbox.zMax.toFixed(2)} m`);

  // Save the raw render
  const rawPng = Buffer.from(renderData.dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, 'cutaway-raw.png'), rawPng);

  // Phase 2: build SVG overlay
  const overlay = await page.evaluate(async (params) => {
    const m = await import('/src/kernel/index.js');
    const { AnnotationOverlay } = m;
    const sections = AnnotationOverlay.GE9X_SECTIONS();
    const W = params.W, H = params.H;
    const zMap = AnnotationOverlay.makeZMapper(
      { zMin: params.bbox.zMin, zMax: params.bbox.zMax },
      W, H, { flip: true }  // engine intake at right (camera at +X), exhaust at left
    );
    // Place labels in 2 staggered rows so they don't overlap
    const labels = sections.map((s, i) => {
      const x = zMap(s.z);
      const yTarget = H * 0.50;
      const yLabel = (i % 2 === 0) ? H * 0.20 : H * 0.78;
      return {
        x: x - 40, y: yLabel, text: s.text, color: s.color,
        leaderTo: { x, y: yTarget },
      };
    });
    return AnnotationOverlay.build({
      imageHref: params.dataUrl,
      width: W, height: H,
      title: 'GE9X — Cutaway Section View',
      subtitle: 'Reconstructed in ArchDisc · 29,669 components · cross-validated against published specs',
      labels,
      legend: [
        { color: '#4a90d9', label: 'Fan (16 composite)' },
        { color: '#4ed99d', label: 'LPC (3 stages)' },
        { color: '#d9a04a', label: 'HPC (11 stages, 60:1 OPR)' },
        { color: '#d94a4a', label: 'Combustor (TAPS III, CMC)' },
        { color: '#d9c84a', label: 'HPT (2 stages, CMC s1)' },
        { color: '#4ad9c8', label: 'LPT (6 stages)' },
        { color: '#aaaaaa', label: 'Exhaust + nozzle' },
      ],
    });
  }, { W, H, dataUrl: renderData.dataUrl, bbox: renderData.bbox });

  fs.writeFileSync(path.join(OUT, 'annotated-cutaway.svg'), overlay);
  console.log(`Annotated SVG: ${(overlay.length / 1024).toFixed(0)} KB`);

  // Phase 3: render the SVG to PNG via headless
  const html = `<!doctype html><html><body style="margin:0;background:#000">${overlay}</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(OUT, 'annotated-cutaway.png'),
    fullPage: false,
    omitBackground: false,
    clip: { x: 0, y: 0, width: W, height: H },
  });
  console.log('  ✓ annotated-cutaway.png');

  expect(renderData.partCount).toBeGreaterThan(20000);
});
