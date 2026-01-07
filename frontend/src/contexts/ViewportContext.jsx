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

    const value = {
        scene,
        camera,
        renderer,
        controls,
        registerViewport,
        addGeometry,
        removeGeometry,
        clearGeneratedGeometry,
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

    // Position camera
    camera.position.set(
        center.x + cameraZ * 0.5,
        center.y + cameraZ * 0.5,
        center.z + cameraZ
    );

    // Update controls target if available
    if (controls && controls.target) {
        controls.target.copy(center);
        controls.update();
    }

    console.log('📷 Camera focused on geometry');
}

export default ViewportContext;
