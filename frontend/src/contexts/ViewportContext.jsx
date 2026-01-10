import React, { createContext, useContext, useState, useCallback } from 'react';
import * as THREE from 'three';

/**
 * Viewport Context - Provides shared access to 3D scene across components
 *
 * This context allows components like AIConsole to add geometry to the viewport
 * without tight coupling between components.
 */
const ViewportContext = createContext(null);

export const useViewport = () => {
    const context = useContext(ViewportContext);
    if (!context) {
        console.warn('useViewport must be used within ViewportProvider');
        return null;
    }
    return context;
};

export function ViewportProvider({ children }) {
    const [scene, setScene] = useState(null);
    const [camera, setCamera] = useState(null);
    const [renderer, setRenderer] = useState(null);
    const [controls, setControls] = useState(null);
    const [wireframeMode, setWireframeMode] = useState('off'); // 'off', 'solid', 'transparent'

    // Register the viewport scene (called by Viewport3D on mount)
    const registerViewport = useCallback((viewportData) => {
        console.log('📹 Viewport registered in context');
        setScene(viewportData.scene);
        setCamera(viewportData.camera);
        setRenderer(viewportData.renderer);
        setControls(viewportData.controls);
    }, []);

    // Add geometry to the scene from AXEL polygon mesh format
    const addGeometry = useCallback((geometry, options = {}) => {
        if (!scene) {
            console.error('❌ Cannot add geometry: Scene not initialized');
            return null;
        }

        console.log('🎨 Adding geometry to viewport:', geometry);

        try {
            // Convert AXEL polygon mesh to Three.js mesh
            const mesh = createThreeJSMeshFromAXEL(geometry, options);

            // Clear previous generated models (optional)
            if (options.clearPrevious) {
                scene.children
                    .filter(child => child.userData.generatedModel)
                    .forEach(child => scene.remove(child));
            }

            // Scale and position the mesh appropriately
            scaleAndPositionMesh(mesh, options);

            // Add to scene
            scene.add(mesh);

            // Center camera on new geometry
            if (camera && options.focusCamera !== false) {
                focusCameraOnMesh(mesh, camera, controls);
            }

            console.log('✅ Geometry added to viewport successfully');
            return mesh;
        } catch (error) {
            console.error('❌ Error adding geometry to viewport:', error);
            return null;
        }
    }, [scene, camera, controls]);

    // Remove specific mesh from scene
    const removeGeometry = useCallback((mesh) => {
        if (!scene || !mesh) return;
        scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        }
    }, [scene]);

    // Clear all generated geometry
    const clearGeneratedGeometry = useCallback(() => {
        if (!scene) return;
        scene.children
            .filter(child => child.userData.generatedModel)
            .forEach(child => {
                scene.remove(child);
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        console.log('🗑️  Cleared all generated geometry');
    }, [scene]);

    // Toggle wireframe mode
    const toggleWireframeMode = useCallback((mode) => {
        if (!scene) return;

        setWireframeMode(mode);

        // Update all meshes in the scene
        scene.traverse((object) => {
            if (object.isMesh && object.material) {
                const material = object.material;

                switch(mode) {
                    case 'solid':
                        // Solid wireframe mode
                        material.wireframe = true;
                        material.transparent = false;
                        material.opacity = 1.0;
                        console.log('🔲 Solid wireframe mode enabled');
                        break;

                    case 'transparent':
                        // Transparent wireframe mode (see-through)
                        material.wireframe = true;
                        material.transparent = true;
                        material.opacity = 0.3;
                        console.log('👻 Transparent wireframe mode enabled');
                        break;

                    case 'off':
                    default:
                        // Normal solid rendering
                        material.wireframe = false;
                        material.transparent = false;
                        material.opacity = 1.0;
                        console.log('🎨 Normal rendering mode enabled');
                        break;
                }

                material.needsUpdate = true;
            }
        });
    }, [scene]);

    const value = {
        scene,
        camera,
        renderer,
        controls,
        wireframeMode,
        registerViewport,
        addGeometry,
        removeGeometry,
        clearGeneratedGeometry,
        toggleWireframeMode,
        isReady: !!scene
    };

    return (
        <ViewportContext.Provider value={value}>
            {children}
        </ViewportContext.Provider>
    );
}

/**
 * Convert AXEL polygon mesh format to Three.js BufferGeometry
 *
 * AXEL Format:
 * {
 *   vertices: [[x, y, z], ...],
 *   faces: [[i0, i1, i2], ...],
 *   normals: [[x, y, z], ...],
 *   type: 'polygon_mesh'
 * }
 */
function createThreeJSMeshFromAXEL(axelMesh, options = {}) {
    const geometry = new THREE.BufferGeometry();

    // Flatten vertices array: [[x,y,z], [x,y,z]] -> [x,y,z,x,y,z]
    const verticesFlat = new Float32Array(axelMesh.vertices.flat());
    geometry.setAttribute('position', new THREE.BufferAttribute(verticesFlat, 3));

    // Flatten faces to indices: [[0,1,2], [2,3,4]] -> [0,1,2,2,3,4]
    const indicesFlat = new Uint32Array(axelMesh.faces.flat());
    geometry.setIndex(new THREE.BufferAttribute(indicesFlat, 1));

    // Add normals if available
    if (axelMesh.normals && axelMesh.normals.length > 0) {
        const normalsFlat = new Float32Array(axelMesh.normals.flat());
        geometry.setAttribute('normal', new THREE.BufferAttribute(normalsFlat, 3));
    } else {
        // Compute normals if not provided
        geometry.computeVertexNormals();
    }

    // Create material
    const material = new THREE.MeshStandardMaterial({
        color: options.color || 0x2196f3, // Nice blue color
        metalness: options.metalness || 0.3,
        roughness: options.roughness || 0.4,
        flatShading: options.flatShading || false,
        side: THREE.DoubleSide
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.generatedModel = true;
    mesh.userData.source = 'axel_engine';

    // Apply dimensions if available
    if (axelMesh.dimensions) {
        mesh.userData.dimensions = axelMesh.dimensions;
    }

    console.log(`✓ Created Three.js mesh: ${axelMesh.vertices.length} vertices, ${axelMesh.faces.length} faces`);

    return mesh;
}

/**
 * Scale and position mesh to fit the grid properly
 * Grid is 100x100 units, so we want models to be a reasonable size
 */
function scaleAndPositionMesh(mesh, options = {}) {
    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Maximum size we want (units in Three.js space)
    // Grid is 100x100, so let's make models fit within ~40 units max
    const MAX_SIZE = options.maxSize || 40;

    // Find the largest dimension
    const maxDim = Math.max(size.x, size.y, size.z);

    // Calculate scale factor to fit within MAX_SIZE
    let scaleFactor = 1;
    if (maxDim > MAX_SIZE) {
        scaleFactor = MAX_SIZE / maxDim;
        mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
        console.log(`📏 Scaled model by ${scaleFactor.toFixed(3)}x to fit grid (${maxDim.toFixed(1)} → ${MAX_SIZE} units)`);
    } else if (maxDim < 1) {
        // Model is too small, scale it up
        scaleFactor = 5 / maxDim; // Make it at least 5 units
        mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
        console.log(`📏 Scaled model up by ${scaleFactor.toFixed(3)}x (${maxDim.toFixed(3)} → ${(maxDim * scaleFactor).toFixed(1)} units)`);
    }

    // Recalculate bounding box after scaling
    mesh.geometry.computeBoundingBox();
    const scaledBox = new THREE.Box3().setFromObject(mesh);
    const scaledSize = scaledBox.getSize(new THREE.Vector3());
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

    // Position the mesh so it sits ON TOP of the grid (y = 0)
    // The bottom of the mesh should be at y = 0
    mesh.position.y = -scaledBox.min.y;

    // Center the mesh at x=0, z=0
    mesh.position.x = -scaledCenter.x;
    mesh.position.z = -scaledCenter.z;

    console.log(`📍 Positioned model: size=${scaledSize.x.toFixed(1)}×${scaledSize.y.toFixed(1)}×${scaledSize.z.toFixed(1)} units, bottom at y=0`);
}

/**
 * Focus camera on a specific mesh
 */
function focusCameraOnMesh(mesh, camera, controls) {
    if (!camera || !mesh) return;

    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Calculate camera distance
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / Math.tan(fov / 2)) * 1.5;

    // Position camera at an angle to see the model nicely
    camera.position.set(
        center.x + cameraZ * 0.7,
        center.y + cameraZ * 0.5,
        center.z + cameraZ * 0.7
    );

    // Update controls target to the center of the model
    if (controls && controls.target) {
        controls.target.copy(center);
        controls.update();
    }

    console.log('📷 Camera focused on geometry');
}

export default ViewportContext;
