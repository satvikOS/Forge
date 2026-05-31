/**
 * Environment Lighting System
 * Handles HDRI environment map loading, application, and dynamic lighting
 */

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';

export class EnvironmentLightingSystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.pmremGenerator = null;
    this.currentEnvironment = null;
    this.currentHDRI = null;
    this.lights = {};
    
    this.initialize();
  }

  /**
   * Initialize the system
   */
  initialize() {
    if (!this.renderer) {
      console.warn('No renderer provided to EnvironmentLightingSystem');
      return;
    }

    // Setup PMREM generator for environment maps
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    console.log('✅ Environment Lighting System initialized');
  }

  /**
   * Setup environment with HDRI
   */
  async setupEnvironment(hdriUrl, intensity = 1.0, blur = 0.0) {
    if (!hdriUrl) {
      console.warn('No HDRI URL provided');
      return;
    }

    console.log(`🌅 Loading HDRI environment: ${hdriUrl}`);

    try {
      // Load HDRI texture
      const hdriTexture = await this.loadHDRI(hdriUrl);
      
      // Generate environment map
      const envMap = this.pmremGenerator.fromEquirectangular(hdriTexture).texture;
      
      // Apply to scene
      this.scene.environment = envMap;
      this.scene.background = envMap;
      
      // Store current environment
      this.currentEnvironment = envMap;
      this.currentHDRI = hdriUrl;

      // Adjust intensity
      if (intensity !== 1.0) {
        this.setEnvironmentIntensity(intensity);
      }

      // Clean up
      hdriTexture.dispose();

      console.log('✅ HDRI environment applied');
    } catch (error) {
      console.error('Failed to setup environment:', error);
      this.setupFallbackEnvironment();
    }
  }

  /**
   * Load HDRI texture
   */
  loadHDRI(url) {
    return new Promise((resolve, reject) => {
      const loader = new RGBELoader();
      loader.load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  /**
   * Set environment intensity
   */
  setEnvironmentIntensity(intensity) {
    if (!this.scene.environment) return;

    // Adjust by modifying exposure
    if (this.renderer) {
      this.renderer.toneMappingExposure = intensity;
    }

    console.log(`💡 Environment intensity set to ${intensity}`);
  }

  /**
   * Update lighting based on time of day
   */
  updateTimeOfDay(timeOfDay) {
    console.log(`⏰ Updating lighting for: ${timeOfDay}`);

    // Remove existing directional light
    if (this.lights.sun) {
      this.scene.remove(this.lights.sun);
    }

    // Create sun light based on time
    const sun = this.createSunLight(timeOfDay);
    this.scene.add(sun);
    this.lights.sun = sun;

    // Update ambient light
    if (this.lights.ambient) {
      this.scene.remove(this.lights.ambient);
    }
    
    const ambient = this.createAmbientLight(timeOfDay);
    this.scene.add(ambient);
    this.lights.ambient = ambient;
  }

  /**
   * Create sun (directional) light for time of day
   */
  createSunLight(timeOfDay) {
    let intensity = 1.0;
    let color = 0xffffff;
    let position = new THREE.Vector3(50, 50, 50);

    switch (timeOfDay) {
      case 'sunrise':
        intensity = 0.8;
        color = 0xffcc99;
        position.set(100, 20, 50);
        break;
      case 'morning':
        intensity = 1.2;
        color = 0xffffe0;
        position.set(80, 60, 40);
        break;
      case 'noon':
        intensity = 1.5;
        color = 0xffffff;
        position.set(0, 100, 0);
        break;
      case 'afternoon':
        intensity = 1.2;
        color = 0xffffe0;
        position.set(-80, 60, 40);
        break;
      case 'sunset':
        intensity = 0.8;
        color = 0xff8844;
        position.set(-100, 20, 50);
        break;
      case 'dusk':
        intensity = 0.4;
        color = 0x8888ff;
        position.set(-80, 10, 40);
        break;
      case 'night':
        intensity = 0.1;
        color = 0x4444ff;
        position.set(0, 50, 0);
        break;
      default:
        intensity = 1.0;
        color = 0xffffff;
    }

    const light = new THREE.DirectionalLight(color, intensity);
    light.position.copy(position);
    light.castShadow = timeOfDay !== 'night';
    
    // Configure shadows
    if (light.castShadow) {
      light.shadow.mapSize.width = 2048;
      light.shadow.mapSize.height = 2048;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 500;
      light.shadow.camera.left = -100;
      light.shadow.camera.right = 100;
      light.shadow.camera.top = 100;
      light.shadow.camera.bottom = -100;
    }

    return light;
  }

  /**
   * Create ambient light for time of day
   */
  createAmbientLight(timeOfDay) {
    let intensity = 0.3;
    let color = 0xffffff;

    switch (timeOfDay) {
      case 'sunrise':
      case 'sunset':
        intensity = 0.4;
        color = 0xffddbb;
        break;
      case 'morning':
      case 'afternoon':
        intensity = 0.5;
        color = 0xffffff;
        break;
      case 'noon':
        intensity = 0.6;
        color = 0xffffff;
        break;
      case 'dusk':
        intensity = 0.3;
        color = 0xaabbff;
        break;
      case 'night':
        intensity = 0.1;
        color = 0x6666aa;
        break;
    }

    return new THREE.AmbientLight(color, intensity);
  }

  /**
   * Apply weather-based lighting effects
   */
  setWeatherEffects(weatherType) {
    console.log(`🌦️  Applying weather effects: ${weatherType}`);

    switch (weatherType) {
      case 'cloudy':
      case 'overcast':
        this.adjustLightIntensity(0.7);
        this.addFog(0.001);
        break;
      case 'rainy':
        this.adjustLightIntensity(0.5);
        this.addFog(0.002);
        break;
      case 'foggy':
        this.adjustLightIntensity(0.6);
        this.addFog(0.02);
        break;
      case 'snowy':
        this.adjustLightIntensity(0.8);
        this.addFog(0.005);
        break;
      case 'clear':
      default:
        this.adjustLightIntensity(1.0);
        this.removeFog();
        break;
    }
  }

  /**
   * Adjust light intensity multiplier
   */
  adjustLightIntensity(multiplier) {
    if (this.lights.sun) {
      const baseIntensity = this.lights.sun.userData?.baseIntensity || this.lights.sun.intensity;
      this.lights.sun.userData = this.lights.sun.userData || {};
      this.lights.sun.userData.baseIntensity = baseIntensity;
      this.lights.sun.intensity = baseIntensity * multiplier;
    }
    
    if (this.lights.ambient) {
      const baseIntensity = this.lights.ambient.userData?.baseIntensity || this.lights.ambient.intensity;
      this.lights.ambient.userData = this.lights.ambient.userData || {};
      this.lights.ambient.userData.baseIntensity = baseIntensity;
      this.lights.ambient.intensity = baseIntensity * multiplier;
    }
  }

  /**
   * Add fog to scene
   */
  addFog(density) {
    const fogColor = 0xcccccc;
    this.scene.fog = new THREE.FogExp2(fogColor, density);
  }

  /**
   * Remove fog from scene
   */
  removeFog() {
    this.scene.fog = null;
  }

  /**
   * Setup fallback environment (gradient background)
   */
  setupFallbackEnvironment() {
    console.log('⚠️  Using fallback environment');

    // Create gradient background
    const scene = this.scene;
    scene.background = new THREE.Color(0x87ceeb);

    // Add basic lights
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(50, 50, 50);
    sun.castShadow = true;
    scene.add(sun);
    this.lights.sun = sun;

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    this.lights.ambient = ambient;
  }

  /**
   * Dispose and cleanup resources
   */
  dispose() {
    console.log('🗑️  Disposing Environment Lighting System');

    if (this.currentEnvironment) {
      this.currentEnvironment.dispose();
    }

    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
    }

    // Remove lights
    Object.values(this.lights).forEach(light => {
      this.scene.remove(light);
      if (light.dispose) light.dispose();
    });

    this.lights = {};
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      hasEnvironment: !!this.currentEnvironment,
      currentHDRI: this.currentHDRI,
      lightsCount: Object.keys(this.lights).length,
      hasFog: !!this.scene.fog,
    };
  }
}

export default EnvironmentLightingSystem;
