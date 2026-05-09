/**
 * ArchDisc — Post-FX Rendering Pipeline
 *
 * Wraps Three.js EffectComposer with SSAO + bloom + FXAA + tone mapping
 * for engineering-render quality. Without ambient occlusion, B-Rep meshes
 * look flat in cavities; without bloom, emissive hot-mode parts look
 * stuck-on; without FXAA, the high-frequency edges of 30K+ thin parts
 * shimmer.
 *
 * Caller passes the THREE module + the postprocessing imports (these
 * are dynamic-imported in the test harness so this file stays
 * dependency-free).
 *
 *   const fx = await PostFX.create({ THREE, scene, camera, renderer, modules });
 *   fx.render();    // call instead of renderer.render()
 *   fx.dispose();
 */

export default class PostFX {

  /**
   * @param {object} options
   *   THREE         - three module
   *   modules       - { EffectComposer, RenderPass, SSAOPass, UnrealBloomPass, FXAAShader, ShaderPass, OutputPass }
   *   renderer      - WebGLRenderer
   *   scene
   *   camera
   *   width, height
   *   ssao, bloom, fxaa - enable flags (default true)
   */
  static create(options = {}) {
    const {
      THREE, modules, renderer, scene, camera,
      width = 1920, height = 1080,
      ssao = true, bloom = true, fxaa = true,
      ssaoKernelRadius = 0.04,
      bloomStrength = 0.4,
      bloomRadius = 0.8,
      bloomThreshold = 0.85,
    } = options;

    if (!THREE || !modules || !renderer) {
      throw new Error('PostFX.create: THREE, modules, renderer required');
    }
    const {
      EffectComposer, RenderPass, SSAOPass, UnrealBloomPass,
      FXAAShader, ShaderPass, OutputPass,
    } = modules;

    const composer = new EffectComposer(renderer);
    composer.setSize(width, height);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let ssaoPass = null;
    if (ssao && SSAOPass) {
      ssaoPass = new SSAOPass(scene, camera, width, height);
      ssaoPass.kernelRadius = ssaoKernelRadius;
      ssaoPass.minDistance = 0.001;
      ssaoPass.maxDistance = 0.5;
      ssaoPass.output = SSAOPass.OUTPUT.Default;
      composer.addPass(ssaoPass);
    }

    let bloomPass = null;
    if (bloom && UnrealBloomPass) {
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        bloomStrength, bloomRadius, bloomThreshold
      );
      composer.addPass(bloomPass);
    }

    let fxaaPass = null;
    if (fxaa && FXAAShader && ShaderPass) {
      fxaaPass = new ShaderPass(FXAAShader);
      fxaaPass.material.uniforms.resolution.value.set(1 / width, 1 / height);
      composer.addPass(fxaaPass);
    }

    if (OutputPass) {
      const outputPass = new OutputPass();
      composer.addPass(outputPass);
    }

    return {
      composer, ssaoPass, bloomPass, fxaaPass,
      render: () => composer.render(),
      setSize: (w, h) => {
        composer.setSize(w, h);
        if (ssaoPass) ssaoPass.setSize(w, h);
        if (bloomPass) bloomPass.setSize(w, h);
        if (fxaaPass) fxaaPass.material.uniforms.resolution.value.set(1 / w, 1 / h);
      },
      setBloomStrength: (s) => { if (bloomPass) bloomPass.strength = s; },
      setSSAOKernel: (r) => { if (ssaoPass) ssaoPass.kernelRadius = r; },
      dispose: () => {
        composer.dispose();
        if (ssaoPass) ssaoPass.dispose?.();
        if (bloomPass) bloomPass.dispose?.();
      },
    };
  }
}
