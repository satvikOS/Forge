import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { Move, RotateCcw, Maximize, MousePointer, Box, Hexagon } from 'lucide-react';
import { useViewport } from '../contexts/ViewportContext';
import { ThreeJSBridge } from '../kernel/index.js';

/**
 * Interactive 3D Viewport with face/edge/vertex picking.
 * Selection modes: Object, Face, Edge — controlled by toolbar buttons.
 */
function Viewport3D({ canvasId = 'render-canvas', domain = 'mechanical', onReady, onSelectionChange }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const rendererRef = useRef(null);
    const controlsRef = useRef(null);
    const transformRef = useRef(null);
    const selectedRef = useRef(null);
    const rafRef = useRef(null);
    const viewport = useViewport();
    const [transformMode, setTransformMode] = useState('translate');
    const [selectionMode, setSelectionMode] = useState('object'); // 'object' | 'face' | 'edge'
    const selectionModeRef = useRef('object');

    // Keep ref in sync
    useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0d0d0d);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(10, 10, 10);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Grid + Axes
        const gridHelper = new THREE.GridHelper(100, 100, 0x333333, 0x1a1a1a);
        gridHelper.userData.pickable = false;
        scene.add(gridHelper);
        const axesHelper = new THREE.AxesHelper(5);
        axesHelper.userData.pickable = false;
        scene.add(axesHelper);

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.set(2048, 2048);
        scene.add(dirLight);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
        controls.screenSpacePanning = false;
        controls.minDistance = 1;
        controls.maxDistance = 500;
        controls.maxPolarAngle = Math.PI;
        controlsRef.current = controls;

        const transformControls = new TransformControls(camera, renderer.domElement);
        transformControls.setSize(0.75);
        scene.add(transformControls);
        transformRef.current = transformControls;
        transformControls.addEventListener('dragging-changed', (event) => {
            controls.enabled = !event.value;
        });

        // Ground shadow plane
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.ShadowMaterial({ opacity: 0.2 })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        plane.userData.pickable = false;
        scene.add(plane);

        // Raycaster
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        // --- Click handler with selection modes ---
        let clickPending = false;
        const handleClick = (event) => {
            if (clickPending) return;
            clickPending = true;
            requestAnimationFrame(() => { clickPending = false; });

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            // Collect all pickable meshes (including inside groups)
            const pickable = [];
            scene.traverse(obj => {
                if (obj.isMesh && obj.userData.pickable !== false && !obj.isTransformControlsPlane) {
                    pickable.push(obj);
                }
            });

            const intersects = raycaster.intersectObjects(pickable, false);
            const mode = selectionModeRef.current;

            if (intersects.length > 0) {
                const hit = intersects[0];
                const mesh = hit.object;

                if (mode === 'face') {
                    // Face picking — find kernel solid group
                    let group = mesh.parent;
                    while (group && !group.userData.kernelSolid) {
                        group = group.parent;
                    }

                    if (group && group.userData.kernelSolid) {
                        const faceId = ThreeJSBridge.pickFace(hit);
                        if (faceId !== null) {
                            // Clear previous highlights
                            scene.traverse(obj => {
                                if (obj.isGroup && obj.userData.kernelSolid) {
                                    ThreeJSBridge.clearHighlight(obj);
                                }
                            });
                            ThreeJSBridge.highlightFace(group, faceId, 0xff6b35);
                            if (onSelectionChange) {
                                onSelectionChange({
                                    type: 'face',
                                    faceId,
                                    solidId: group.userData.kernelSolid?.id,
                                    featureId: group.userData.featureId,
                                });
                            }
                        }
                    }
                    return;
                }

                if (mode === 'edge') {
                    // Edge mode — show vertices on the solid
                    let group = mesh.parent;
                    while (group && !group.userData.kernelSolid) {
                        group = group.parent;
                    }
                    if (group && group.userData.kernelSolid) {
                        const solid = group.userData.kernelSolid;
                        ThreeJSBridge.showVertices(group, solid, 0.03, 0x00ff88);
                        if (onSelectionChange) {
                            onSelectionChange({
                                type: 'edge',
                                solidId: solid.id,
                                edgeCount: solid.edges().length,
                            });
                        }
                    }
                    return;
                }

                // Object mode — select entire group
                let target = mesh;
                while (target.parent && target.parent !== scene) {
                    target = target.parent;
                }
                selectedRef.current = target;
                transformControls.attach(target);

                if (onSelectionChange) {
                    onSelectionChange({
                        type: 'object',
                        name: target.name || target.userData.modelId || 'Object',
                        solidId: target.userData.kernelSolid?.id,
                        featureId: target.userData.featureId,
                    });
                }
            } else {
                // Deselect
                selectedRef.current = null;
                transformControls.detach();
                // Clear all highlights
                scene.traverse(obj => {
                    if (obj.isGroup && obj.userData.kernelSolid) {
                        ThreeJSBridge.clearHighlight(obj);
                        ThreeJSBridge.hideVertices(obj);
                    }
                });
                if (onSelectionChange) onSelectionChange(null);
            }
        };

        renderer.domElement.addEventListener('click', handleClick);

        // Keyboard shortcuts
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
                case 'delete': case 'backspace':
                    if (selectedRef.current && e.target.tagName !== 'INPUT') {
                        if (selectedRef.current.userData.kernelSolid) {
                            ThreeJSBridge.dispose(selectedRef.current);
                        }
                        scene.remove(selectedRef.current);
                        selectedRef.current = null;
                        transformControls.detach();
                    }
                    break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        // Render loop
        function animate() {
            rafRef.current = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        rafRef.current = requestAnimationFrame(animate);

        // Resize
        let resizeTimer;
        function handleResize() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const w = container.clientWidth;
                const h = container.clientHeight;
                if (w === 0 || h === 0) return;
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
            }, 50);
        }
        window.addEventListener('resize', handleResize);

        if (onReady) onReady({ scene, camera, renderer, controls, transformControls });
        if (viewport?.registerViewport) {
            viewport.registerViewport({ scene, camera, renderer, controls, transformControls });
        }

        return () => {
            cancelAnimationFrame(rafRef.current);
            clearTimeout(resizeTimer);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeyDown);
            renderer.domElement.removeEventListener('click', handleClick);
            transformControls.dispose();
            controls.dispose();
            renderer.dispose();
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [canvasId, domain]);

    const handleModeChange = useCallback((mode) => {
        setTransformMode(mode);
        if (transformRef.current) transformRef.current.setMode(mode);
    }, []);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', contain: 'layout style paint' }}>
            {/* Transform toolbar */}
            <div className="gizmo-toolbar">
                <button
                    className={`gizmo-btn ${transformMode === 'translate' ? 'active' : ''}`}
                    onClick={() => handleModeChange('translate')}
                    title="Move (G)"
                >
                    <Move size={14} />
                </button>
                <button
                    className={`gizmo-btn ${transformMode === 'rotate' ? 'active' : ''}`}
                    onClick={() => handleModeChange('rotate')}
                    title="Rotate (R)"
                >
                    <RotateCcw size={14} />
                </button>
                <button
                    className={`gizmo-btn ${transformMode === 'scale' ? 'active' : ''}`}
                    onClick={() => handleModeChange('scale')}
                    title="Scale (S)"
                >
                    <Maximize size={14} />
                </button>
            </div>

            {/* Selection mode toolbar */}
            <div className="selection-toolbar">
                <button
                    className={`gizmo-btn ${selectionMode === 'object' ? 'active' : ''}`}
                    onClick={() => setSelectionMode('object')}
                    title="Object mode (1)"
                >
                    <MousePointer size={14} />
                </button>
                <button
                    className={`gizmo-btn ${selectionMode === 'face' ? 'active' : ''}`}
                    onClick={() => setSelectionMode('face')}
                    title="Face mode (2)"
                >
                    <Box size={14} />
                </button>
                <button
                    className={`gizmo-btn ${selectionMode === 'edge' ? 'active' : ''}`}
                    onClick={() => setSelectionMode('edge')}
                    title="Edge mode (3)"
                >
                    <Hexagon size={14} />
                </button>
                <span className="selection-mode-label">{selectionMode}</span>
            </div>
        </div>
    );
}

export default Viewport3D;
