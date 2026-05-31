/**
 * MaterialLibrary - IMAX/AAA Quality Material Management System
 * Manages PBR materials with physically-based properties
 */

import * as THREE from 'three';

export class Material {
    constructor(id, name, type = 'standard') {
        this.id = id;
        this.name = name;
        this.type = type; // 'standard', 'glass', 'metal', 'emission'

        // PBR Properties (Physically Based Rendering)
        this.properties = {
            color: '#ffffff',
            metalness: 0.0,
            roughness: 0.5,
            opacity: 1.0,
            transparent: false,
            emissive: '#000000',
            emissiveIntensity: 0.0,
            normalScale: 1.0,
            envMapIntensity: 1.0,
        };
    }

    setProperty(key, value) {
        this.properties[key] = value;
    }

    /**
     * Convert to Three.js MeshStandardMaterial
     */
    toThreeMaterial() {
        return new THREE.MeshStandardMaterial({
            color: new THREE.Color(this.properties.color),
            metalness: this.properties.metalness,
            roughness: this.properties.roughness,
            opacity: this.properties.opacity,
            transparent: this.properties.transparent,
            emissive: new THREE.Color(this.properties.emissive),
            emissiveIntensity: this.properties.emissiveIntensity,
            envMapIntensity: this.properties.envMapIntensity,
        });
    }

    /**
     * Clone this material
     */
    clone() {
        const cloned = new Material(this.id + '_copy', this.name + ' Copy', this.type);
        cloned.properties = { ...this.properties };
        return cloned;
    }
}

export class MaterialLibrary {
    constructor() {
        this.materials = new Map();
        this.nextId = 1;

        // Create default materials
        this.initializeDefaults();
    }

    /**
     * Initialize default IMAX/AAA quality materials
     */
    initializeDefaults() {
        // Default Gray
        this.createMaterial('Default', 'standard', {
            color: '#cccccc',
            metalness: 0.0,
            roughness: 0.7,
        });

        // Polished Metal
        this.createMaterial('Polished Metal', 'metal', {
            color: '#c0c0c0',
            metalness: 1.0,
            roughness: 0.2,
        });

        // Gold
        this.createMaterial('Gold', 'metal', {
            color: '#ffd700',
            metalness: 1.0,
            roughness: 0.3,
        });

        // Copper
        this.createMaterial('Copper', 'metal', {
            color: '#b87333',
            metalness: 1.0,
            roughness: 0.4,
        });

        // Rough Metal
        this.createMaterial('Rough Metal', 'metal', {
            color: '#888888',
            metalness: 1.0,
            roughness: 0.8,
        });

        // Glass
        this.createMaterial('Glass', 'glass', {
            color: '#ffffff',
            metalness: 0.0,
            roughness: 0.0,
            opacity: 0.3,
            transparent: true,
        });

        // Plastic (Matte)
        this.createMaterial('Matte Plastic', 'standard', {
            color: '#ff4444',
            metalness: 0.0,
            roughness: 0.9,
        });

        // Plastic (Glossy)
        this.createMaterial('Glossy Plastic', 'standard', {
            color: '#4444ff',
            metalness: 0.0,
            roughness: 0.2,
        });

        // Emission (Glow)
        this.createMaterial('Emission', 'emission', {
            color: '#ffffff',
            emissive: '#ff6b35',
            emissiveIntensity: 1.0,
            metalness: 0.0,
            roughness: 1.0,
        });

        // Wood
        this.createMaterial('Wood', 'standard', {
            color: '#8b4513',
            metalness: 0.0,
            roughness: 0.8,
        });

        // Concrete
        this.createMaterial('Concrete', 'standard', {
            color: '#a9a9a9',
            metalness: 0.0,
            roughness: 0.9,
        });

        // Rubber
        this.createMaterial('Rubber', 'standard', {
            color: '#222222',
            metalness: 0.0,
            roughness: 1.0,
        });
    }

    /**
     * Create a new material
     */
    createMaterial(name, type = 'standard', properties = {}) {
        const id = `mat_${this.nextId++}`;
        const material = new Material(id, name, type);

        // Apply custom properties
        Object.keys(properties).forEach(key => {
            material.setProperty(key, properties[key]);
        });

        this.materials.set(id, material);
        return material;
    }

    /**
     * Get material by ID
     */
    getMaterial(id) {
        return this.materials.get(id);
    }

    /**
     * Get all materials as array
     */
    getAllMaterials() {
        return Array.from(this.materials.values());
    }

    /**
     * Duplicate material
     */
    duplicateMaterial(id) {
        const original = this.materials.get(id);
        if (!original) return null;

        const duplicated = original.clone();
        duplicated.id = `mat_${this.nextId++}`;
        this.materials.set(duplicated.id, duplicated);
        return duplicated;
    }

    /**
     * Delete material
     */
    deleteMaterial(id) {
        this.materials.delete(id);
    }

    /**
     * Apply material to Three.js mesh
     */
    applyMaterialToMesh(mesh, materialId) {
        const material = this.getMaterial(materialId);
        if (!material) {
            console.error('Material not found:', materialId);
            return;
        }

        mesh.material = material.toThreeMaterial();
        console.log(`✅ Applied material "${material.name}" to mesh`);
    }

    /**
     * Apply material to SceneManager object
     */
    applyMaterialToSceneObject(sceneManager, objectId, materialId) {
        const material = this.getMaterial(materialId);
        if (!material) {
            console.error('Material not found:', materialId);
            return;
        }

        const sceneObject = sceneManager.getObject(objectId);
        if (!sceneObject) {
            console.error('Scene object not found:', objectId);
            return;
        }

        // Update object's material data
        if (!sceneObject.userData) {
            sceneObject.userData = {};
        }

        sceneObject.userData.material = {
            ...material.properties,
            name: material.name,
            type: material.type,
        };

        console.log(`✅ Applied material "${material.name}" to scene object "${sceneObject.name}"`);

        return sceneObject;
    }
}
