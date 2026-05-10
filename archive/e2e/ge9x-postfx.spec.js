import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'postfx');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X post-FX: SSAO + bloom + FXAA renders', async ({ page }) => {
  ensure(OUT);

  const W = 1920, H = 800;
  await page.setViewportSize({ width: W, height: H });

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async (params) => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const {
      PartIDRegistry, AssemblyBridge, MarketingCutaway,
      StudioLighting, EngineMaterials, PostFX,
    } = m;
    const GE9XBuilder = builderMod.default;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    // Dynamic-import postprocessing modules (Vite-served)
    const ECMod  = await import('/node_modules/three/examples/jsm/postprocessing/EffectComposer.js');
    const RPMod  = await import('/node_modules/three/examples/jsm/postprocessing/RenderPass.js');
    const SSAOMod = await import('/node_modules/three/examples/jsm/postprocessing/SSAOPass.js');
    const UBPMod = await import('/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js');
    const FXAAMod = await import('/node_modules/three/examples/jsm/shaders/FXAAShader.js');
    const SPMod  = await import('/node_modules/three/examples/jsm/postprocessing/ShaderPass.js');
    const OPMod  = await import('/node_modules/three/examples/jsm/postprocessing/OutputPass.js');

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
    window.__three_renderer.toneMappingExposure = 1.0;
    window.__three_renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Apply marketing cutaway
    MarketingCutaway.apply(window.__three_scene, window.__three_renderer, {
      axisDir: new THREE.Vector3(0, 0, 1), center,
      hideAccessories: true, colorBySection: true,
    });

    // Resize renderer + camera
    window.__three_renderer.setSize(params.W, params.H, false);
    const camDist = size.z * 0.6;
    window.__three_camera.position.set(center.x + camDist, center.y + camDist * 0.05, center.z);
    window.__three_camera.lookAt(center.x, center.y, center.z);
    window.__three_camera.aspect = params.W / params.H;
    window.__three_camera.fov = 60;
    window.__three_camera.near = 0.01;
    window.__three_camera.far = camDist * 50;
    window.__three_camera.updateProjectionMatrix();

    // Build post-FX pipeline
    const fx = PostFX.create({
      THREE,
      modules: {
        EffectComposer: ECMod.EffectComposer,
        RenderPass: RPMod.RenderPass,
        SSAOPass: SSAOMod.SSAOPass,
        UnrealBloomPass: UBPMod.UnrealBloomPass,
        FXAAShader: FXAAMod.FXAAShader,
        ShaderPass: SPMod.ShaderPass,
        OutputPass: OPMod.OutputPass,
      },
      renderer: window.__three_renderer,
      scene: window.__three_scene,
      camera: window.__three_camera,
      width: params.W, height: params.H,
      ssaoKernelRadius: 0.05,
      bloomStrength: 0.5, bloomRadius: 0.8, bloomThreshold: 0.7,
    });

    // Cool render
    fx.render();
    const dataURL_cool = window.__three_renderer.domElement.toDataURL('image/png');

    // Hot mode
    EngineMaterials.setHotMode(THREE, window.__three_scene, 0.8);
    fx.setBloomStrength(1.4);
    fx.render();
    const dataURL_hot = window.__three_renderer.domElement.toDataURL('image/png');

    fx.dispose();

    return {
      partCount: ge9x.partCount(),
      cool: dataURL_cool,
      hot: dataURL_hot,
    };
  }, { W, H });

  console.log(`Components: ${result.partCount.toLocaleString()}`);

  fs.writeFileSync(path.join(OUT, 'postfx-cool.png'),
    Buffer.from(result.cool.split(',')[1], 'base64'));
  console.log('  ✓ postfx-cool.png (SSAO + bloom + FXAA, cool engine)');

  fs.writeFileSync(path.join(OUT, 'postfx-hot.png'),
    Buffer.from(result.hot.split(',')[1], 'base64'));
  console.log('  ✓ postfx-hot.png (SSAO + bloom + FXAA, hot mode)');

  expect(result.partCount).toBeGreaterThan(20000);
});
