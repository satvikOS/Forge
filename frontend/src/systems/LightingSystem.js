/**
 * LightingSystem - IMAX/AAA Quality Lighting
 * Point, Directional, Spot, Area lights with HDRI environment
 */

import * as THREE from 'three';

export class LightConfig {
    constructor(type, name) {
        this.type = type; // 'point', 'directional', 'spot', 'area', 'ambient'
        this.name = name;
        this.id = `light_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Common properties
        this.color = '#ffffff';
        this.intensity = 1.0;
        this.castShadow = true;
        this.visible = true;

        // Transform
        this.position = new THREE.Vector3(5, 5, 5);
        this.rotation = new THREE.Euler();
        this.target = new THREE.Vector3(0, 0, 0);

        // Shadow properties
        this.shadowMapSize = 2048;
        this.shadowBias = -0.0001;
        this.shadowRadius = 2;

        // Type-specific properties
        switch (type) {
            case 'point':
                this.distance = 0; // 0 = infinite
                this.decay = 2; // Physically correct
                break;
            case 'spot':
                this.angle = Math.PI / 4; // 45 degrees
                this.penumbra = 0.1;
                this.distance = 0;
                this.decay = 2;
                break;
            case 'area':
                this.width = 2;
                this.height = 2;
                break;
        }
    }

    /**
     * Create Three.js light from config
     */
    createThreeLight() {
        let light;

        switch (this.type) {
            case 'point':
                light = new THREE.PointLight(
                    this.color,
                    this.intensity,
                    this.distance,
                    this.decay
                );
                break;

            case 'directional':
                light = new THREE.DirectionalLight(this.color, this.intensity);
                light.target.position.copy(this.target);
                break;

            case 'spot':
                light = new THREE.SpotLight(
                    this.color,
                    this.intensity,
                    this.distance,
                    this.angle,
                    this.penumbra,
                    this.decay
                );
                light.target.position.copy(this.target);
                break;

            case 'area':
                // Area lights in Three.js require RectAreaLight (from examples)
                light = new THREE.RectAreaLight(
                    this.color,
                    this.intensity,
                    this.width,
                    this.height
                );
                break;

            case 'ambient':
                light = new THREE.AmbientLight(this.color, this.intensity);
                break;

            default:
                light = new THREE.PointLight(this.color, this.intensity);
        }

        light.position.copy(this.position);
        light.rotation.copy(this.rotation);
        light.castShadow = this.castShadow;
        light.visible = this.visible;

        // Configure shadow properties
        if (light.shadow) {
            light.shadow.mapSize.width = this.shadowMapSize;
            light.shadow.mapSize.height = this.shadowMapSize;
            light.shadow.bias = this.shadowBias;
            light.shadow.radius = this.shadowRadius;

            // Set shadow camera frustum based on light type
            if (this.type === 'directional') {
                light.shadow.camera.left = -10;
                light.shadow.camera.right = 10;
                light.shadow.camera.top = 10;
                light.shadow.camera.bottom = -10;
                light.shadow.camera.near = 0.5;
                light.shadow.camera.far = 50;
            } else if (this.type === 'spot' || this.type === 'point') {
                light.shadow.camera.near = 0.5;
                light.shadow.camera.far = 50;
            }
        }

        light.userData.lightId = this.id;
        light.userData.lightConfig = this;

        return light;
    }
}

export class LightingSystem {
    constructor(scene) {
        this.scene = scene;
        this.lights = new Map(); // lightId -> { config, threeLight }

        // Environment lighting
        this.environment = {
            enabled: false,
            hdri: null,
            intensity: 1.0,
            rotation: 0,
        };

        // Global shadow settings
        this.shadowsEnabled = true;
        this.shadowMapType = THREE.PCFSoftShadowMap; // Soft shadows
    }

    /**
     * Add light to scene
     */
    addLight(type, name = null) {
        const lightName = name || `${type.charAt(0).toUpperCase() + type.slice(1)} Light`;
        const config = new LightConfig(type, lightName);
        const threeLight = config.createThreeLight();

        this.scene.add(threeLight);

        // Add target for directional/spot lights
        if (type === 'directional' || type === 'spot') {
            this.scene.add(threeLight.target);
        }

        this.lights.set(config.id, { config, threeLight });

        console.log(`💡 Added ${type} light: ${lightName}`);
        return config.id;
    }

    /**
     * Remove light from scene
     */
    removeLight(lightId) {
        const lightData = this.lights.get(lightId);
        if (!lightData) return;

        this.scene.remove(lightData.threeLight);

        if (lightData.threeLight.target) {
            this.scene.remove(lightData.threeLight.target);
        }

        this.lights.delete(lightId);
        console.log(`🗑️ Removed light: ${lightData.config.name}`);
    }

    /**
     * Update light property
     */
    updateLight(lightId, property, value) {
        const lightData = this.lights.get(lightId);
        if (!lightData) return;

        const { config, threeLight } = lightData;

        // Update config
        if (property.includes('.')) {
            const [prop, subProp] = property.split('.');
            if (config[prop] && config[prop][subProp] !== undefined) {
                config[prop][subProp] = value;
            }
        } else {
            config[property] = value;
        }

        // Update Three.js light
        switch (property) {
            case 'color':
                threeLight.color.set(value);
                break;
            case 'intensity':
                threeLight.intensity = value;
                break;
            case 'position.x':
            case 'position.y':
            case 'position.z':
                threeLight.position.copy(config.position);
                break;
            case 'castShadow':
                threeLight.castShadow = value;
                break;
            case 'visible':
                threeLight.visible = value;
                break;
            case 'distance':
                if (threeLight.distance !== undefined) {
                    threeLight.distance = value;
                }
                break;
            case 'angle':
                if (threeLight.angle !== undefined) {
                    threeLight.angle = value;
                }
                break;
            case 'penumbra':
                if (threeLight.penumbra !== undefined) {
                    threeLight.penumbra = value;
                }
                break;
            case 'shadowMapSize':
                if (threeLight.shadow) {
                    threeLight.shadow.mapSize.width = value;
                    threeLight.shadow.mapSize.height = value;
                    threeLight.shadow.map = null; // Force regeneration
                }
                break;
        }
    }

    /**
     * Set HDRI environment map
     */
    setHDRI(hdriTexture, intensity = 1.0) {
        if (!hdriTexture) {
            this.scene.environment = null;
            this.scene.background = null;
            this.environment.enabled = false;
            console.log('🌅 HDRI disabled');
            return;
        }

        hdriTexture.mapping = THREE.EquirectangularReflectionMapping;

        this.scene.environment = hdriTexture;
        this.scene.background = hdriTexture;

        this.environment.enabled = true;
        this.environment.hdri = hdriTexture;
        this.environment.intensity = intensity;

        console.log('🌅 HDRI environment set');
    }

    /**
     * Create default 3-point lighting setup
     */
    createThreePointLighting() {
        // Key light (main light)
        const keyLightId = this.addLight('directional', 'Key Light');
        this.updateLight(keyLightId, 'intensity', 1.5);
        this.updateLight(keyLightId, 'position.x', 5);
        this.updateLight(keyLightId, 'position.y', 8);
        this.updateLight(keyLightId, 'position.z', 5);

        // Fill light (soften shadows)
        const fillLightId = this.addLight('directional', 'Fill Light');
        this.updateLight(fillLightId, 'intensity', 0.5);
        this.updateLight(fillLightId, 'position.x', -5);
        this.updateLight(fillLightId, 'position.y', 3);
        this.updateLight(fillLightId, 'position.z', 3);
        this.updateLight(fillLightId, 'castShadow', false);

        // Back light (rim light)
        const backLightId = this.addLight('point', 'Back Light');
        this.updateLight(backLightId, 'intensity', 0.8);
        this.updateLight(backLightId, 'position.x', 0);
        this.updateLight(backLightId, 'position.y', 5);
        this.updateLight(backLightId, 'position.z', -8);
        this.updateLight(backLightId, 'castShadow', false);

        console.log('💡 Three-point lighting setup created');
        return [keyLightId, fillLightId, backLightId];
    }

    /**
     * Get all lights
     */
    getAllLights() {
        return Array.from(this.lights.values()).map(data => data.config);
    }

    /**
     * Get light by ID
     */
    getLight(lightId) {
        return this.lights.get(lightId);
    }

    /**
     * Toggle shadows globally
     */
    toggleShadows(enabled) {
        this.shadowsEnabled = enabled;

        this.lights.forEach(({ threeLight }) => {
            if (threeLight.castShadow !== undefined) {
                threeLight.castShadow = enabled;
            }
        });

        console.log(`🌓 Shadows ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Set shadow quality
     */
    setShadowQuality(quality) {
        // quality: 'low' (512), 'medium' (1024), 'high' (2048), 'ultra' (4096)
        const sizeMap = {
            low: 512,
            medium: 1024,
            high: 2048,
            ultra: 4096,
        };

        const size = sizeMap[quality] || 2048;

        this.lights.forEach(({ config, threeLight }) => {
            config.shadowMapSize = size;
            if (threeLight.shadow) {
                threeLight.shadow.mapSize.width = size;
                threeLight.shadow.mapSize.height = size;
                threeLight.shadow.map = null; // Force regeneration
            }
        });

        console.log(`🌓 Shadow quality set to: ${quality} (${size}x${size})`);
    }
}
