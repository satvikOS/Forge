import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { Move, RotateCcw, Maximize, MousePointer, Box, Hexagon, Eye, Grid3x3, Layers } from 'lucide-react';
import { useViewport } from '../contexts/ViewportContext';
import { ThreeJSBridge } from '../kernel/index.js';

/**
 * Industrial-grade 3D Viewport
 * - Object/Face/Edge selection modes (1/2/3)
 * - Transform gizmos: Move(G), Rotate(R), Scale(S)
 * - Display modes: Shaded, Wireframe, Shaded+Wireframe, X-Ray
 * - Proper group selection with transform controls
 */
function Viewport3D({ canvasId = 'render-canvas', domain = 'mechanical', onReady, onSelectionChange }) {
    const containerRef = useRef(null);
    const internalsRef = useRef(null); // store scene, camera, etc. without causing re-renders
    const rafRef = useRef(null);
    const viewport = useViewport();
    const [transformMode, setTransformMode] = useState('translate');
    const [selectionMode, setSelectionMode] = useState('object');
    const [displayMode, setDisplayMode] = useState('shaded'); // shaded | wireframe | shadedWire | xray
    const selectionModeRef = useRef('object');
    const displayModeRef = useRef('shaded');
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onReadyRef = useRef(onReady);
    useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
    useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

    useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
    useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;

        // Clean up any leftover canvases from StrictMode double-mount
        while (container.querySelector('canvas')) {
            container.querySelector('canvas').remove();
        }

        const width = container.clientWidth || 800;
        const height = container.clientHeight || 600;

        // --- Scene ---
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);

        // --- Camera ---
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000);
        camera.position.set(8, 6, 8);
        camera.lookAt(0, 0, 0);

        // --- Renderer ---
        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        container.appendChild(renderer.domElement);

        // --- Grid ---
        const grid = new THREE.GridHelper(100, 100, 0x444466, 0x222244);
        grid.userData.pickable = false;
        grid.userData.isHelper = true;
        scene.add(grid);

        // --- Axes ---
        const axes = new THREE.AxesHelper(3);
        axes.userData.pickable = false;
        axes.userData.isHelper = true;
        scene.add(axes);

        // --- Lighting (studio setup) ---
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambient);

        const key = new THREE.DirectionalLight(0xffffff, 0.9);
        key.position.set(10, 20, 10);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 100;
        key.shadow.camera.left = -20;
        key.shadow.camera.right = 20;
        key.shadow.camera.top = 20;
        key.shadow.camera.bottom = -20;
        scene.add(key);

        const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
        fill.position.set(-10, 5, -10);
        scene.add(fill);

        const rim = new THREE.DirectionalLight(0xffffff, 0.2);
        rim.position.set(0, -5, -10);
        scene.add(rim);

        // --- Ground shadow ---
        const groundGeo = new THREE.PlaneGeometry(200, 200);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.15 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        ground.userData.pickable = false;
        ground.userData.isHelper = true;
        scene.add(ground);

        // --- Orbit Controls ---
        const orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.enableDamping = true;
        orbitControls.dampingFactor = 0.1;
        orbitControls.screenSpacePanning = true;
        orbitControls.minDistance = 0.5;
        orbitControls.maxDistance = 500;
        orbitControls.rotateSpeed = 0.8;
        orbitControls.zoomSpeed = 1.2;
        orbitControls.panSpeed = 0.8;

        // --- Transform Controls ---
        const transformControls = new TransformControls(camera, renderer.domElement);
        transformControls.setSize(0.8);
        if (!transformControls.userData) transformControls.userData = {};
        transformControls.userData.isHelper = true;
        // TransformControls extends Object3D — add its gizmo helper to scene
        try { scene.add(transformControls); } catch (e) { /* some Three.js versions need getHelper */ }
        if (transformControls.getHelper) {
            const helper = transformControls.getHelper();
            helper.userData = { isHelper: true };
            scene.add(helper);
        }

        transformControls.addEventListener('dragging-changed', (e) => {
            orbitControls.enabled = !e.value;
        });

        // Update object position in real-time while dragging
        transformControls.addEventListener('objectChange', () => {
            const obj = transformControls.object;
            if (obj && onSelectionChange) {
                onSelectionChangeRef.current({
                    type: 'object',
                    name: obj.name || 'Object',
                    position: { x: obj.position.x.toFixed(3), y: obj.position.y.toFixed(3), z: obj.position.z.toFixed(3) },
                    rotation: { x: THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1), y: THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1), z: THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1) },
                    scale: { x: obj.scale.x.toFixed(3), y: obj.scale.y.toFixed(3), z: obj.scale.z.toFixed(3) },
                });
            }
        });

        // Store references
        const selectedRef = { current: null };
        internalsRef.current = { scene, camera, renderer, orbitControls, transformControls, selectedRef };

        // --- Raycaster ---
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        // --- Selection outline material ---
        const outlineMat = new THREE.MeshBasicMaterial({ color: 0xff6b35, wireframe: true, transparent: true, opacity: 0.5 });

        function findTopGroup(obj) {
            // Walk up to find the top-level group added to scene
            let current = obj;
            while (current.parent && current.parent !== scene) {
                current = current.parent;
            }
            return current;
        }

        function clearSelection() {
            // Remove selection outline
            const existing = scene.getObjectByName('__selection_outline__');
            if (existing) {
                existing.traverse(c => { if (c.geometry) c.geometry.dispose(); });
                scene.remove(existing);
            }
            // Clear face/edge highlights
            scene.traverse(obj => {
                if (obj.isGroup) {
                    ThreeJSBridge.clearHighlight(obj);
                    ThreeJSBridge.hideVertices(obj);
                }
            });
            transformControls.detach();
            selectedRef.current = null;
        }

        function selectObject(target) {
            clearSelection();
            selectedRef.current = target;
            transformControls.attach(target);

            // Add selection wireframe outline
            const outlineGroup = new THREE.Group();
            outlineGroup.name = '__selection_outline__';
            target.traverse(child => {
                if (child.isMesh && child.geometry) {
                    const clone = new THREE.Mesh(child.geometry.clone(), outlineMat);
                    clone.position.copy(child.position);
                    clone.rotation.copy(child.rotation);
                    clone.scale.copy(child.scale);
                    clone.userData.pickable = false;
                    outlineGroup.add(clone);
                }
            });
            // Position outline at target's world position
            outlineGroup.position.copy(target.position);
            outlineGroup.rotation.copy(target.rotation);
            outlineGroup.scale.copy(target.scale);
            outlineGroup.userData.pickable = false;
            outlineGroup.userData.isHelper = true;
            scene.add(outlineGroup);
        }

        // --- Click handler ---
        let clickPending = false;
        const handleClick = (event) => {
            // Don't handle if dragging transform gizmo
            if (transformControls.dragging) return;
            if (clickPending) return;
            clickPending = true;
            requestAnimationFrame(() => { clickPending = false; });

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            // Collect pickable objects
            const pickable = [];
            scene.traverse(obj => {
                if (obj.isMesh && obj.userData.pickable !== false &&
                    !obj.userData.isHelper && !obj.isTransformControlsPlane &&
                    obj.name !== '__selection_outline__' &&
                    !(obj.parent && obj.parent.name === '__selection_outline__')) {
                    pickable.push(obj);
                }
            });

            const intersects = raycaster.intersectObjects(pickable, false);
            const mode = selectionModeRef.current;

            if (intersects.length === 0) {
                clearSelection();
                if (onSelectionChangeRef.current) onSelectionChangeRef.current?.(null);
                return;
            }

            const hit = intersects[0];
            const hitMesh = hit.object;
            const topGroup = findTopGroup(hitMesh);

            if (mode === 'face') {
                clearSelection();
                // Walk up to find kernel solid
                let group = hitMesh.parent;
                while (group && !group.userData.kernelSolid) {
                    if (group === scene) break;
                    group = group.parent;
                }
                if (group && group.userData.kernelSolid) {
                    const faceId = ThreeJSBridge.pickFace(hit);
                    if (faceId !== null) {
                        ThreeJSBridge.highlightFace(group, faceId, 0xff6b35);
                        if (onSelectionChangeRef.current) {
                            onSelectionChangeRef.current({ type: 'face', faceId, solidId: group.userData.kernelSolid?.id });
                        }
                    }
                } else {
                    // Non-kernel mesh — still highlight
                    selectObject(topGroup);
                    if (onSelectionChangeRef.current) {
                        onSelectionChangeRef.current({ type: 'face', name: topGroup.name, faceIndex: hit.faceIndex });
                    }
                }
                return;
            }

            if (mode === 'edge') {
                clearSelection();
                let group = hitMesh.parent;
                while (group && !group.userData.kernelSolid) {
                    if (group === scene) break;
                    group = group.parent;
                }
                if (group && group.userData.kernelSolid) {
                    ThreeJSBridge.showVertices(group, group.userData.kernelSolid, 0.03, 0x00ff88);
                    if (onSelectionChangeRef.current) {
                        const s = group.userData.kernelSolid;
                        onSelectionChangeRef.current({ type: 'edge', solidId: s.id, edgeCount: s.edges().length, vertexCount: s.vertices().length });
                    }
                }
                return;
            }

            // Object mode — select and enable transform
            selectObject(topGroup);
            if (onSelectionChangeRef.current) {
                onSelectionChangeRef.current({
                    type: 'object',
                    name: topGroup.name || 'Object',
                    position: { x: topGroup.position.x.toFixed(3), y: topGroup.position.y.toFixed(3), z: topGroup.position.z.toFixed(3) },
                    solidId: topGroup.userData.kernelSolid?.id,
                });
            }
        };

        renderer.domElement.addEventListener('click', handleClick);

        // --- Keyboard ---
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.key.toLowerCase()) {
                case 'g': transformControls.setMode('translate'); setTransformMode('translate'); break;
                case 'r': transformControls.setMode('rotate'); setTransformMode('rotate'); break;
                case 's':
                    if (!e.ctrlKey && !e.metaKey) {
                        transformControls.setMode('scale');
                        setTransformMode('scale');
                    }
                    break;
                case '1': setSelectionMode('object'); break;
                case '2': setSelectionMode('face'); break;
                case '3': setSelectionMode('edge'); break;
                case 'z':
                    if (!e.ctrlKey && !e.metaKey) {
                        // Toggle wireframe
                        const modes = ['shaded', 'wireframe', 'shadedWire', 'xray'];
                        const next = modes[(modes.indexOf(displayModeRef.current) + 1) % modes.length];
                        setDisplayMode(next);
                        applyDisplayMode(scene, next);
                    }
                    break;
                case 'delete': case 'backspace':
                    if (selectedRef.current && e.target.tagName !== 'INPUT') {
                        const obj = selectedRef.current;
                        clearSelection();
                        obj.traverse(c => {
                            if (c.geometry) c.geometry.dispose();
                            if (c.material) {
                                if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                                else c.material.dispose();
                            }
                        });
                        scene.remove(obj);
                        if (onSelectionChangeRef.current) onSelectionChangeRef.current?.(null);
                    }
                    break;
                case 'f':
                    // Focus/frame selected or all
                    if (selectedRef.current) {
                        focusOnObject(selectedRef.current, camera, orbitControls);
                    } else {
                        focusOnAll(scene, camera, orbitControls);
                    }
                    break;
                case 'h':
                    // Hide selected
                    if (selectedRef.current) {
                        selectedRef.current.visible = !selectedRef.current.visible;
                        clearSelection();
                    }
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        // --- Render loop ---
        function animate() {
            rafRef.current = requestAnimationFrame(animate);
            orbitControls.update();
            renderer.render(scene, camera);
        }
        rafRef.current = requestAnimationFrame(animate);

        // --- Resize ---
        let resizeTimer;
        const handleResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const w = container.clientWidth, h = container.clientHeight;
                if (w === 0 || h === 0) return;
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
            }, 50);
        };
        window.addEventListener('resize', handleResize);

        // --- Notify ---
        if (onReadyRef.current) onReadyRef.current({ scene, camera, renderer, controls: orbitControls, transformControls });
        if (viewport?.registerViewport) {
            viewport.registerViewport({ scene, camera, renderer, controls: orbitControls, transformControls });
        }

        return () => {
            cancelAnimationFrame(rafRef.current);
            clearTimeout(resizeTimer);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            if (renderer.domElement) {
                renderer.domElement.removeEventListener('click', handleClick);
            }
            try { transformControls.detach(); } catch (e) {}
            try { transformControls.dispose(); } catch (e) {}
            orbitControls.dispose();
            renderer.dispose();
            // Remove canvas from container
            try {
                if (renderer.domElement && container.contains(renderer.domElement)) {
                    container.removeChild(renderer.domElement);
                }
            } catch (e) { /* ignore if already removed */ }
            internalsRef.current = null;
        };
    }, [canvasId, domain]);

    // --- Display mode change from button ---
    const cycleDisplayMode = useCallback(() => {
        const modes = ['shaded', 'wireframe', 'shadedWire', 'xray'];
        const next = modes[(modes.indexOf(displayMode) + 1) % modes.length];
        setDisplayMode(next);
        if (internalsRef.current) applyDisplayMode(internalsRef.current.scene, next);
    }, [displayMode]);

    const handleModeChange = useCallback((mode) => {
        setTransformMode(mode);
        if (internalsRef.current) internalsRef.current.transformControls.setMode(mode);
    }, []);

    const displayLabels = { shaded: 'Shaded', wireframe: 'Wire', shadedWire: 'S+W', xray: 'X-Ray' };

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '200px', position: 'relative', overflow: 'hidden' }}>
            {/* Transform toolbar */}
            <div className="gizmo-toolbar">
                <button className={`gizmo-btn ${transformMode === 'translate' ? 'active' : ''}`}
                    onClick={() => handleModeChange('translate')} title="Move (G)"><Move size={14} /></button>
                <button className={`gizmo-btn ${transformMode === 'rotate' ? 'active' : ''}`}
                    onClick={() => handleModeChange('rotate')} title="Rotate (R)"><RotateCcw size={14} /></button>
                <button className={`gizmo-btn ${transformMode === 'scale' ? 'active' : ''}`}
                    onClick={() => handleModeChange('scale')} title="Scale (S)"><Maximize size={14} /></button>
            </div>

            {/* Selection + Display toolbar */}
            <div className="selection-toolbar">
                <button className={`gizmo-btn ${selectionMode === 'object' ? 'active' : ''}`}
                    onClick={() => setSelectionMode('object')} title="Object (1)"><MousePointer size={14} /></button>
                <button className={`gizmo-btn ${selectionMode === 'face' ? 'active' : ''}`}
                    onClick={() => setSelectionMode('face')} title="Face (2)"><Box size={14} /></button>
                <button className={`gizmo-btn ${selectionMode === 'edge' ? 'active' : ''}`}
                    onClick={() => setSelectionMode('edge')} title="Edge (3)"><Hexagon size={14} /></button>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                <button className="gizmo-btn" onClick={cycleDisplayMode} title="Display mode (Z)">
                    <Eye size={14} />
                </button>
                <span className="selection-mode-label">{displayLabels[displayMode]}</span>
            </div>
        </div>
    );
}

// --- Display mode application ---
function applyDisplayMode(scene, mode) {
    scene.traverse(obj => {
        if (!obj.isMesh || obj.userData.isHelper) return;
        const mat = obj.material;
        if (!mat) return;

        // Store original color if not stored
        if (!mat.userData) mat.userData = {};
        if (mat.userData._origColor === undefined) {
            mat.userData._origColor = mat.color ? mat.color.getHex() : 0x888888;
            mat.userData._origOpacity = mat.opacity;
            mat.userData._origTransparent = mat.transparent;
            mat.userData._origWireframe = mat.wireframe;
        }

        switch (mode) {
            case 'shaded':
                mat.wireframe = false;
                mat.transparent = mat.userData._origTransparent;
                mat.opacity = mat.userData._origOpacity;
                break;
            case 'wireframe':
                mat.wireframe = true;
                mat.transparent = false;
                mat.opacity = 1.0;
                break;
            case 'shadedWire':
                mat.wireframe = false;
                mat.transparent = false;
                mat.opacity = 1.0;
                // Add wireframe overlay — handled by edge lines in ThreeJSBridge
                break;
            case 'xray':
                mat.wireframe = false;
                mat.transparent = true;
                mat.opacity = 0.25;
                break;
        }
        mat.needsUpdate = true;
    });
}

function focusOnObject(obj, camera, controls) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.5;
    camera.position.set(center.x + dist * 0.6, center.y + dist * 0.4, center.z + dist * 0.6);
    controls.target.copy(center);
    controls.update();
}

function focusOnAll(scene, camera, controls) {
    const box = new THREE.Box3();
    scene.traverse(obj => {
        if (obj.isMesh && !obj.userData.isHelper && obj.visible) {
            box.expandByObject(obj);
        }
    });
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 5;
    const dist = maxDim / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.8;
    camera.position.set(center.x + dist * 0.6, center.y + dist * 0.4, center.z + dist * 0.6);
    controls.target.copy(center);
    controls.update();
}

export default Viewport3D;
