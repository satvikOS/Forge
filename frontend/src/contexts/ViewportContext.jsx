import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { ThreeJSBridge } from '../kernel/index.js';

/**
 * Viewport Context - 3D scene + model management
 *
 * Provides:
 * - Three.js scene registration
 * - Model registry with component IDs
 * - Geometry add/remove from AXEL format
 * - Model selection and transform updates
 * - Model tree data for UI display
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

let _componentCounter = 0;
function nextComponentId() {
    _componentCounter++;
    return `comp_${String(_componentCounter).padStart(4, '0')}`;
}

let _modelCounter = 0;
function nextModelId() {
    _modelCounter++;
    return `model_${String(_modelCounter).padStart(4, '0')}`;
}

export function ViewportProvider({ children }) {
    const [scene, setScene] = useState(null);
    const [camera, setCamera] = useState(null);
    const [renderer, setRenderer] = useState(null);
    const [controls, setControls] = useState(null);
    const [wireframeMode, setWireframeMode] = useState('off');

    // ─── Model Registry ──────────────────────────────────────────────────────────
    const [models, setModels] = useState([]);
    const [selectedModelId, setSelectedModelId] = useState(null);
    const modelsRef = useRef([]);

    // Keep ref in sync for callbacks
    const updateModels = useCallback((updater) => {
        setModels(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            modelsRef.current = next;
            return next;
        });
    }, []);

    // Register the viewport scene (called by Viewport3D on mount)
    const registerViewport = useCallback((viewportData) => {
        setScene(viewportData.scene);
        setCamera(viewportData.camera);
        setRenderer(viewportData.renderer);
        setControls(viewportData.controls);
    }, []);

    // ─── Add Model ───────────────────────────────────────────────────────────────
    // Takes raw backend response (modelData + specs) and creates tracked model
    const addModel = useCallback((modelData, specs = {}, designId = null) => {
        if (!scene) {
            console.error('Cannot add model: scene not initialized');
            return null;
        }

        const modelId = nextModelId();
        const dId = designId || modelId;
        const modelName = specs?.name || specs?.objectType || 'Generated Model';
        const components = [];

        // Create a THREE.Group to hold all parts
        const group = new THREE.Group();
        group.userData.generatedModel = true;
        group.userData.modelId = modelId;

        try {
            if (modelData?.type === 'composite' && modelData.parts) {
                // Multi-part model
                modelData.parts.forEach((part, i) => {
                    const compId = nextComponentId();
                    const mesh = createThreeJSMesh(part, {
                        color: getPartColor(i),
                        metalness: 0.3,
                        roughness: 0.4,
                    });
                    mesh.userData.componentId = compId;
                    mesh.userData.modelId = modelId;

                    if (part.position) {
                        mesh.position.set(
                            part.position.x || 0,
                            part.position.y || 0,
                            part.position.z || 0
                        );
                    }

                    group.add(mesh);
                    components.push({
                        id: compId,
                        name: part.name || `Part ${i + 1}`,
                        type: 'body',
                        visible: true,
                        meshUUID: mesh.uuid,
                    });
                });
            } else if (modelData?.type === 'taxonomy_scene' && modelData.meshes) {
                modelData.meshes.forEach((meshData, i) => {
                    const compId = nextComponentId();
                    const mesh = createThreeJSMesh(meshData, {
                        color: getPartColor(i),
                    });
                    mesh.userData.componentId = compId;
                    mesh.userData.modelId = modelId;

                    if (meshData.position) {
                        mesh.position.set(
                            meshData.position.x || 0,
                            meshData.position.y || 0,
                            meshData.position.z || 0
                        );
                    }

                    group.add(mesh);
                    components.push({
                        id: compId,
                        name: meshData.name || meshData.category || `Component ${i + 1}`,
                        type: meshData.category || 'body',
                        visible: true,
                        meshUUID: mesh.uuid,
                    });
                });
            } else {
                // Single mesh (polygon_mesh or fallback)
                const compId = nextComponentId();
                const rawMesh = modelData?.vertices ? modelData : (modelData?.model || modelData);
                const mesh = createThreeJSMesh(rawMesh, {
                    color: 0x2196f3,
                    metalness: 0.3,
                    roughness: 0.4,
                });
                mesh.userData.componentId = compId;
                mesh.userData.modelId = modelId;
                group.add(mesh);
                components.push({
                    id: compId,
                    name: 'Body',
                    type: 'body',
                    visible: true,
                    meshUUID: mesh.uuid,
                });
            }

            // Scale and position the whole group
            scaleAndPositionGroup(group);
            scene.add(group);

            // Focus camera
            if (camera && controls) {
                focusCameraOnObject(group, camera, controls);
            }

            // Build model record
            const modelRecord = {
                id: modelId,
                designId: dId,
                name: modelName,
                components,
                groupUUID: group.uuid,
                transform: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
                material: specs?.materials?.[0] || 'Aluminum 6061-T6',
                specs,
                massProperties: computeMassProperties(group),
                createdAt: new Date().toISOString(),
            };

            updateModels(prev => [...prev, modelRecord]);
            setSelectedModelId(modelId);

            return modelRecord;
        } catch (error) {
            console.error('Error adding model:', error);
            return null;
        }
    }, [scene, camera, controls, updateModels]);

    // ─── Remove Model ────────────────────────────────────────────────────────────
    const removeModel = useCallback((modelId) => {
        if (!scene) return;
        const model = modelsRef.current.find(m => m.id === modelId);
        if (!model) return;

        const group = scene.getObjectByProperty('uuid', model.groupUUID);
        if (group) {
            group.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
            scene.remove(group);
        }

        updateModels(prev => prev.filter(m => m.id !== modelId));
        if (selectedModelId === modelId) setSelectedModelId(null);
    }, [scene, selectedModelId, updateModels]);

    // ─── Select Model ────────────────────────────────────────────────────────────
    const selectModel = useCallback((modelId) => {
        setSelectedModelId(modelId);
    }, []);

    const getSelectedModel = useCallback(() => {
        return modelsRef.current.find(m => m.id === selectedModelId) || null;
    }, [selectedModelId]);

    // ─── Update Transform ────────────────────────────────────────────────────────
    const updateModelTransform = useCallback((modelId, field, value) => {
        if (!scene) return;
        const model = modelsRef.current.find(m => m.id === modelId);
        if (!model) return;

        const group = scene.getObjectByProperty('uuid', model.groupUUID);
        if (!group) return;

        const numVal = parseFloat(value) || 0;

        // Apply to Three.js group
        switch (field) {
            case 'x': group.position.x = numVal; break;
            case 'y': group.position.y = numVal; break;
            case 'z': group.position.z = numVal; break;
            case 'rx': group.rotation.x = THREE.MathUtils.degToRad(numVal); break;
            case 'ry': group.rotation.y = THREE.MathUtils.degToRad(numVal); break;
            case 'rz': group.rotation.z = THREE.MathUtils.degToRad(numVal); break;
            case 'sx': group.scale.x = numVal || 1; break;
            case 'sy': group.scale.y = numVal || 1; break;
            case 'sz': group.scale.z = numVal || 1; break;
        }

        // Update state
        updateModels(prev => prev.map(m =>
            m.id === modelId ? { ...m, transform: { ...m.transform, [field]: numVal } } : m
        ));
    }, [scene, updateModels]);

    // ─── Toggle Component Visibility ─────────────────────────────────────────────
    const toggleComponentVisibility = useCallback((modelId, componentId) => {
        if (!scene) return;
        const model = modelsRef.current.find(m => m.id === modelId);
        if (!model) return;

        const comp = model.components.find(c => c.id === componentId);
        if (!comp) return;

        const group = scene.getObjectByProperty('uuid', model.groupUUID);
        if (!group) return;

        const mesh = group.children.find(c => c.uuid === comp.meshUUID);
        if (mesh) {
            mesh.visible = !mesh.visible;
        }

        updateModels(prev => prev.map(m =>
            m.id === modelId ? {
                ...m,
                components: m.components.map(c =>
                    c.id === componentId ? { ...c, visible: !c.visible } : c
                )
            } : m
        ));
    }, [scene, updateModels]);

    // ─── Update Material ─────────────────────────────────────────────────────────
    const updateModelMaterial = useCallback((modelId, materialName) => {
        updateModels(prev => prev.map(m =>
            m.id === modelId ? { ...m, material: materialName } : m
        ));
    }, [updateModels]);

    // ─── Clear All Generated Models ──────────────────────────────────────────────
    const clearAllModels = useCallback(() => {
        if (!scene) return;
        scene.children
            .filter(child => child.userData.generatedModel)
            .forEach(child => {
                child.traverse(c => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) {
                        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                        else c.material.dispose();
                    }
                });
                scene.remove(child);
            });
        updateModels([]);
        setSelectedModelId(null);
    }, [scene, updateModels]);

    // ─── Add Kernel Solid ──────────────────────────────────────────────────────
    const addKernelSolid = useCallback((solid, threeGroup) => {
        if (!scene) return null;

        const modelId = nextModelId();
        const components = [];

        // Track mesh children as components
        threeGroup.traverse(child => {
            if (child.isMesh && child.userData.pickable) {
                const compId = nextComponentId();
                child.userData.componentId = compId;
                child.userData.modelId = modelId;
                components.push({
                    id: compId,
                    name: child.name || `Component ${components.length + 1}`,
                    type: 'body',
                    visible: true,
                    meshUUID: child.uuid,
                });
            }
        });

        const modelRecord = {
            id: modelId,
            designId: `kernel_${solid.id}`,
            name: solid.name || 'Kernel Solid',
            components,
            groupUUID: threeGroup.uuid,
            kernelSolid: solid,
            transform: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
            material: solid.material || 'Aluminum 6061-T6',
            specs: { featureType: solid.userData?.featureType },
            massProperties: solid.massProperties ? solid.massProperties() : computeMassProperties(threeGroup),
            createdAt: new Date().toISOString(),
        };

        updateModels(prev => [...prev, modelRecord]);
        setSelectedModelId(modelId);
        return modelRecord;
    }, [scene, updateModels]);

    // Legacy compatibility
    const addGeometry = useCallback((geometry, options = {}) => {
        return addModel(geometry, {}, null);
    }, [addModel]);
    const removeGeometry = useCallback((mesh) => {
        if (!scene || !mesh) return;
        scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
    }, [scene]);
    const clearGeneratedGeometry = clearAllModels;

    // Toggle wireframe mode
    const toggleWireframeMode = useCallback((mode) => {
        if (!scene) return;
        setWireframeMode(mode);
        scene.traverse((object) => {
            if (object.isMesh && object.material) {
                const mat = object.material;
                switch (mode) {
                    case 'solid':
                        mat.wireframe = true; mat.transparent = false; mat.opacity = 1.0;
                        break;
                    case 'transparent':
                        mat.wireframe = true; mat.transparent = true; mat.opacity = 0.3;
                        break;
                    default:
                        mat.wireframe = false; mat.transparent = false; mat.opacity = 1.0;
                        break;
                }
                mat.needsUpdate = true;
            }
        });
    }, [scene]);

    const value = {
        // Three.js scene
        scene, camera, renderer, controls,
        wireframeMode, registerViewport, toggleWireframeMode,
        // Model management
        models, selectedModelId,
        addModel, addKernelSolid, removeModel, selectModel, getSelectedModel,
        updateModelTransform, toggleComponentVisibility, updateModelMaterial,
        clearAllModels,
        // Legacy
        addGeometry, removeGeometry, clearGeneratedGeometry,
        isReady: !!scene,
    };

    return (
        <ViewportContext.Provider value={value}>
            {children}
        </ViewportContext.Provider>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PART_COLORS = [
    0x2196f3, 0x4caf50, 0xff9800, 0x9c27b0,
    0x00bcd4, 0xf44336, 0x795548, 0x607d8b,
];

function getPartColor(index) {
    return PART_COLORS[index % PART_COLORS.length];
}

function createThreeJSMesh(data, options = {}) {
    if (!data || !data.vertices || !data.faces) {
        // Fallback: create a placeholder cube
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({
            color: options.color || 0x2196f3,
            metalness: 0.3,
            roughness: 0.4,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.generatedModel = true;
        return mesh;
    }

    const geometry = new THREE.BufferGeometry();
    const verticesFlat = new Float32Array(data.vertices.flat());
    geometry.setAttribute('position', new THREE.BufferAttribute(verticesFlat, 3));

    const indicesFlat = new Uint32Array(data.faces.flat());
    geometry.setIndex(new THREE.BufferAttribute(indicesFlat, 1));

    if (data.normals && data.normals.length > 0) {
        const normalsFlat = new Float32Array(data.normals.flat());
        geometry.setAttribute('normal', new THREE.BufferAttribute(normalsFlat, 3));
    } else {
        geometry.computeVertexNormals();
    }

    const material = new THREE.MeshStandardMaterial({
        color: options.color || 0x2196f3,
        metalness: options.metalness || 0.3,
        roughness: options.roughness || 0.4,
        flatShading: options.flatShading || false,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.generatedModel = true;
    if (data.dimensions) mesh.userData.dimensions = data.dimensions;

    return mesh;
}

function scaleAndPositionGroup(group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const MAX_SIZE = 40;
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > MAX_SIZE) {
        const s = MAX_SIZE / maxDim;
        group.scale.set(s, s, s);
    } else if (maxDim > 0 && maxDim < 1) {
        const s = 5 / maxDim;
        group.scale.set(s, s, s);
    }

    // Recalculate after scaling
    const scaledBox = new THREE.Box3().setFromObject(group);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    group.position.y = -scaledBox.min.y;
    group.position.x = -scaledCenter.x;
    group.position.z = -scaledCenter.z;
}

function focusCameraOnObject(obj, camera, controls) {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const dist = Math.abs(maxDim / Math.tan(fov / 2)) * 1.5;

    camera.position.set(
        center.x + dist * 0.7,
        center.y + dist * 0.5,
        center.z + dist * 0.7
    );
    if (controls && controls.target) {
        controls.target.copy(center);
        controls.update();
    }
}

function computeMassProperties(group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const volume = size.x * size.y * size.z;
    const surfaceArea = 2 * (size.x * size.y + size.y * size.z + size.x * size.z);
    // Approximate mass with aluminum density (2700 kg/m3)
    const mass = volume * 0.0027; // cm3 to kg rough estimate
    return {
        mass: mass.toFixed(3),
        volume: volume.toFixed(2),
        surfaceArea: surfaceArea.toFixed(2),
    };
}

export default ViewportContext;
