import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { Move, RotateCcw, Maximize, MousePointer, Box, Hexagon, Eye, Grid3x3, Layers } from 'lucide-react';
import { useViewport } from '../contexts/ViewportContext';
import { ThreeJSBridge, PixelManager, InteractiveSketch, SketchTools, Vec3, ExtrudeFeature, BVH } from '../kernel/index.js';
import { getFeatureTree, registerSelectedEdgesProvider } from '../workbenches/mechanical-cad/ToolExecutionEngine.js';
import { getBodyRegistry } from '../foundation/BodyRegistry.js';

// Singletons
const _pixelManager = new PixelManager();
const _sketch = new InteractiveSketch();
const _selectedEdges = { ids: new Set(), solidId: null };
export function getPixelManager() { return _pixelManager; }
export function getSketch() { return _sketch; }
export function getSelectedEdges() { return _selectedEdges; }
// Register the provider so ToolExecutionEngine can read selected edges
registerSelectedEdgesProvider(() => _selectedEdges);

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
    const [displayMode, setDisplayMode] = useState('shaded');
    const [sketchActive, setSketchActive] = useState(false);
    const [sketchTool, setSketchTool] = useState('none');
    const [sketchStatus, setSketchStatus] = useState('');
    const selectionModeRef = useRef('object');
    const displayModeRef = useRef('shaded');
    const sketchActiveRef = useRef(false);
    const lastPickedFace = useRef(null);
    const selectedEdges = useRef(new Set()); // edge IDs for fillet/chamfer
    const [edgeSelectionInfo, setEdgeSelectionInfo] = useState({ count: 0, ids: [], solidId: null });
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
        // OLED-black background matches industry CAD apps (NX, CATIA,
        // Fusion 360 dark mode) — pure #000 maximizes contrast for
        // shaded/translucent surfaces and saves OLED pixels.
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        // --- Camera ---
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.0001, 100);
        camera.position.set(0.15, 0.10, 0.15); // ~150mm away for mm-scale parts
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

        // --- Axes triad only (no infinite floor grid) ---
        // Industry CAD apps don't draw a perpetual ground plane —
        // they use a corner triad and an orientation gizmo. Keeps
        // the OLED-black backdrop uncluttered.
        const axes = new THREE.AxesHelper(0.05); // 50mm axes
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
        const groundGeo = new THREE.PlaneGeometry(1, 1); // 1m ground
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
        orbitControls.minDistance = 0.01;  // 10mm min
        orbitControls.maxDistance = 5;     // 5m max
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

        // Expose framing hooks so foundation handlers can re-centre
        // the camera on the body they just added. We expose two:
        //   __archdiscFitToScreen()   — frame ALL meshes in the scene
        //                                (use sparingly — pulls the
        //                                 camera back too far when the
        //                                 grid/gizmo helpers exist)
        //   __archdiscFocusOnObject(o) — frame a single Object3D tight
        //                                (preferred for foundation
        //                                 bodies just added).
        if (typeof window !== 'undefined') {
          window.__archdiscFitToScreen = () => {
            try { focusOnAll(scene, camera, orbitControls); } catch (_) {}
          };
          window.__archdiscFocusOnObject = (obj) => {
            try { focusOnObject(obj, camera, orbitControls); } catch (_) {}
          };
          // Frame every foundation body currently in the scene as a
          // single bbox. Used by tool handlers that add new geometry —
          // this keeps prior bodies visible alongside the new one.
          window.__archdiscFocusOnFoundationBodies = () => {
            try {
              const box = new THREE.Box3();
              scene.traverse(o => {
                if (o.userData?.foundationManifold) {
                  o.updateMatrixWorld(true);
                  box.expandByObject(o);
                }
              });
              if (box.isEmpty()) return;
              const center = box.getCenter(new THREE.Vector3());
              const size = box.getSize(new THREE.Vector3());
              const maxDim = Math.max(size.x, size.y, size.z) || 0.05;
              const halfFov = (camera.fov * Math.PI / 180) / 2;
              const dist = (maxDim / 2) / Math.tan(halfFov) * 1.6;
              const dx = 0.6, dy = 0.35, dz = 0.6;
              const L = Math.hypot(dx, dy, dz);
              camera.position.set(
                center.x + dist * dx / L,
                center.y + dist * dy / L,
                center.z + dist * dz / L,
              );
              camera.near = Math.max(dist * 0.01, 1e-4);
              camera.far  = Math.max(dist * 100, 100);
              camera.updateProjectionMatrix();
              orbitControls.target.copy(center);
              orbitControls.update();
            } catch (_) {}
          };
          let __orbitBaseRadius = null;
          window.__archdiscSetOrbitBase = () => {
            __orbitBaseRadius = camera.position.distanceTo(orbitControls.target) || 1;
          };
          window.__archdiscOrbitView = (azimuthDeg, elevationDeg = 20, zoomFactor = 1) => {
            const target = orbitControls.target;
            const base = __orbitBaseRadius || camera.position.distanceTo(target) || 1;
            const r = base * zoomFactor;
            const az = (azimuthDeg * Math.PI) / 180;
            const el = (elevationDeg * Math.PI) / 180;
            camera.position.set(
              target.x + r * Math.cos(el) * Math.sin(az),
              target.y + r * Math.sin(el),
              target.z + r * Math.cos(el) * Math.cos(az),
            );
            camera.lookAt(target);
            orbitControls.update();
            renderer.render(scene, camera);
          };
          window.__archdiscScene = scene;
        }

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

        // --- Pointer move handler for sketch (supports mouse, touch, pen/stylus) ---
        const handleMouseMove = (event) => {
            if (!sketchActiveRef.current || !_sketch.active) return;
            const rect = renderer.domElement.getBoundingClientRect();
            // Use pointer coordinates (works with mouse, pen, touch)
            const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
            const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
            mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            _sketch.onMouseMove(raycaster);

            // Pen pressure support — could be used for line weight
            if (event.pressure !== undefined && event.pressure > 0) {
                _sketch._penPressure = event.pressure;
            }
        };
        // Use pointer events for pen/stylus/touch compatibility
        renderer.domElement.addEventListener('pointermove', handleMouseMove);
        renderer.domElement.style.touchAction = 'none'; // prevent browser handling

        // --- Click handler ---
        let clickPending = false;
        const handleClick = (event) => {
            if (transformControls.dragging) return;
            if (clickPending) return;
            clickPending = true;
            requestAnimationFrame(() => { clickPending = false; });

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            // If sketch is active, route clicks to sketch engine
            if (sketchActiveRef.current && _sketch.active) {
                _sketch.onClick(raycaster);
                const status = _sketch.getStatus();
                setSketchStatus(`DOF: ${status.dof} | Entities: ${status.entityCount} | ${status.fullyConstrained ? 'Fully Constrained' : 'Under-constrained'}`);
                return;
            }

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

            // BVH-accelerated picking for large scenes (>50 objects)
            let candidates = pickable;
            if (pickable.length > 50) {
                const bvh = BVH.build(pickable);
                candidates = bvh.raycast(raycaster.ray);
            }

            const intersects = raycaster.intersectObjects(candidates, false);
            const mode = selectionModeRef.current;

            if (intersects.length === 0) {
                clearSelection();
                try { getBodyRegistry().select(null); } catch { /* no-op */ }
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

                        // Store the picked face for sketch-on-face activation
                        lastPickedFace.current = {
                            face: group.userData.kernelSolid.faces().find(f => f.id === faceId),
                            normal: hit.face?.normal ? new Vec3(hit.face.normal.x, hit.face.normal.y, hit.face.normal.z) : null,
                            point: new Vec3(hit.point.x, hit.point.y, hit.point.z),
                            faceId,
                            solidId: group.userData.kernelSolid?.id,
                        };

                        if (onSelectionChangeRef.current) {
                            onSelectionChangeRef.current({ type: 'face', faceId, solidId: group.userData.kernelSolid?.id });
                        }
                    }
                } else {
                    // Non-kernel mesh — still highlight
                    selectObject(topGroup);
                    // Capture face normal for sketch-on-face
                    if (hit.face?.normal) {
                        const localNormal = hit.face.normal.clone();
                        // Transform to world space
                        const worldNormal = localNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(hitMesh.matrixWorld)).normalize();
                        lastPickedFace.current = {
                            normal: new Vec3(worldNormal.x, worldNormal.y, worldNormal.z),
                            point: new Vec3(hit.point.x, hit.point.y, hit.point.z),
                            faceIndex: hit.faceIndex,
                        };
                    }
                    if (onSelectionChangeRef.current) {
                        onSelectionChangeRef.current({ type: 'face', name: topGroup.name, faceIndex: hit.faceIndex });
                    }
                }
                return;
            }

            if (mode === 'edge') {
                let group = hitMesh.parent;
                while (group && !group.userData.kernelSolid) {
                    if (group === scene) break;
                    group = group.parent;
                }
                if (group && group.userData.kernelSolid) {
                    const solid = group.userData.kernelSolid;
                    // Find nearest edge to click point
                    const hitWorld = hit.point.clone();
                    let nearestEdge = null;
                    let nearestDist = Infinity;
                    for (const e of solid.edges()) {
                        // Distance from hit point to edge midpoint (approx)
                        const v1 = e.startVertex?.position;
                        const v2 = e.endVertex?.position;
                        if (!v1 || !v2) continue;
                        const mid = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2, z: (v1.z + v2.z) / 2 };
                        const d = Math.sqrt((mid.x - hitWorld.x) ** 2 + (mid.y - hitWorld.y) ** 2 + (mid.z - hitWorld.z) ** 2);
                        if (d < nearestDist) { nearestDist = d; nearestEdge = e; }
                    }

                    if (nearestEdge) {
                        // Toggle selection
                        if (selectedEdges.current.has(nearestEdge.id)) {
                            selectedEdges.current.delete(nearestEdge.id);
                        } else {
                            selectedEdges.current.add(nearestEdge.id);
                        }

                        ThreeJSBridge.showVertices(group, solid, 0.002, 0x00ff88);

                        const ids = [...selectedEdges.current];
                        // Sync to global singleton so ToolExecutionEngine can read it
                        _selectedEdges.ids = new Set(ids);
                        _selectedEdges.solidId = solid.id;
                        setEdgeSelectionInfo({ count: ids.length, ids, solidId: solid.id });

                        if (onSelectionChangeRef.current) {
                            onSelectionChangeRef.current({
                                type: 'edge',
                                solidId: solid.id,
                                selectedEdgeIds: ids,
                                edgeCount: solid.edges().length,
                                vertexCount: solid.vertices().length,
                            });
                        }
                    }
                }
                return;
            }

            // Object mode — select and enable transform
            selectObject(topGroup);
            // If this is a registered foundation body, sync the Part
            // Browser selection so PropertyManager picks up the right
            // body (closes the inverse loop: viewport ⇄ side panel).
            const bodyId = topGroup.userData?.bodyId ?? null;
            try { getBodyRegistry().select(bodyId); } catch { /* no-op */ }
            if (onSelectionChangeRef.current) {
                onSelectionChangeRef.current({
                    type: 'object',
                    name: topGroup.name || 'Object',
                    position: { x: topGroup.position.x.toFixed(3), y: topGroup.position.y.toFixed(3), z: topGroup.position.z.toFixed(3) },
                    solidId: topGroup.userData.kernelSolid?.id,
                    bodyId,
                });
            }
        };

        renderer.domElement.addEventListener('pointerup', handleClick); // pointerup for pen/touch compat

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
                case '4':
                    // Activate sketch — on picked face if available, else XZ plane
                    if (!sketchActiveRef.current) {
                        let planeSpec = 'XZ';
                        let label = 'XZ plane (top-down)';

                        if (lastPickedFace.current?.normal && lastPickedFace.current?.point) {
                            // Sketch on the picked face
                            planeSpec = {
                                origin: lastPickedFace.current.point,
                                normal: lastPickedFace.current.normal,
                            };
                            label = `picked face (Face #${lastPickedFace.current.faceId || 'mesh'})`;
                        }

                        _sketch.activate(scene, planeSpec);
                        _sketch.setTool(SketchTools.LINE);
                        sketchActiveRef.current = true;
                        setSketchActive(true);
                        setSketchTool('line');
                        setSketchStatus(`Sketch active on ${label} — click to place points`);
                        orbitControls.enableRotate = false;
                    }
                    break;
                case 'l':
                    if (sketchActiveRef.current) { _sketch.setTool(SketchTools.LINE); setSketchTool('line'); }
                    break;
                case 'c':
                    if (sketchActiveRef.current && !e.ctrlKey) { _sketch.setTool(SketchTools.CIRCLE); setSketchTool('circle'); }
                    break;
                case 'b':
                    if (sketchActiveRef.current) { _sketch.setTool(SketchTools.RECTANGLE); setSketchTool('rectangle'); }
                    break;
                case 'a':
                    if (sketchActiveRef.current && !e.ctrlKey) { _sketch.setTool(SketchTools.ARC); setSketchTool('arc'); }
                    break;
                case 'd':
                    if (sketchActiveRef.current) { _sketch.setTool(SketchTools.DIMENSION); setSketchTool('dimension'); }
                    break;
                case 'e':
                    // Extrude sketch profile
                    if (sketchActiveRef.current && _sketch.entities.length > 0) {
                        const profile = _sketch.getProfile();
                        if (profile.length >= 3) {
                            const ft = getFeatureTree();
                            // Extrude direction = sketch plane normal (default Y for XZ plane)
                            const dir = _sketch.planeNormal || new Vec3(0, 1, 0);
                            const feature = ft.addExtrude(profile, dir, 0.020); // 20mm default
                            if (feature.solid) {
                                const group = ThreeJSBridge.solidToGroup(feature.solid, { color: 0x9aa3ad, edges: true });
                                group.userData.pickable = true;
                                group.userData.generatedModel = true;
                                group.userData.kernelSolid = feature.solid;
                                scene.add(group);
                            }
                            _sketch.deactivate(scene);
                            sketchActiveRef.current = false;
                            setSketchActive(false);
                            setSketchTool('none');
                            orbitControls.enableRotate = true;
                            setSketchStatus(`Extruded: Feature #${feature.id} — ${profile.length} vertices, depth 20mm`);
                            // Clear the picked face so next sketch defaults to XZ
                            lastPickedFace.current = null;
                        } else {
                            setSketchStatus('Need at least 3 points for extrusion — draw more geometry');
                        }
                    }
                    break;
                case 'z':
                    if (!e.ctrlKey && !e.metaKey) {
                        // Toggle wireframe
                        const modes = ['shaded', 'wireframe', 'shadedWire', 'xray'];
                        const next = modes[(modes.indexOf(displayModeRef.current) + 1) % modes.length];
                        setDisplayMode(next);
                        applyDisplayMode(scene, next);
                    }
                    break;
                case 'escape':
                    if (sketchActiveRef.current) {
                        _sketch.onEscape();
                        if (_sketch.activeTool === SketchTools.NONE) {
                            _sketch.deactivate(scene);
                            sketchActiveRef.current = false;
                            setSketchActive(false);
                            setSketchTool('none');
                            orbitControls.enableRotate = true;
                            setSketchStatus('');
                        }
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
        // Register PixelManager
        _pixelManager.register(renderer, scene, camera);
        // Expose scene/camera/renderer to window for E2E tests and AI agents
        if (typeof window !== 'undefined') {
            window.__three_scene = scene;
            window.__three_camera = camera;
            window.__three_renderer = renderer;
            window.THREE = THREE;
            // Interactive sketch singleton + foundation cleanup hook.
            window.__archdiscSketch = _sketch;
            window.__archdiscCleanupSketch = (opts) =>
                _sketch.active ? _sketch.cleanupWithFoundation(opts)
                               : { ok: false, reason: 'no active sketch' };
        }

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
                renderer.domElement.removeEventListener('pointerup', handleClick);
                renderer.domElement.removeEventListener('pointermove', handleMouseMove);
            }
            if (_sketch.active) _sketch.deactivate(scene);
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

            {/* Sketch toolbar — appears when sketch is active */}
            {sketchActive && (
                <div className="sketch-toolbar">
                    <span className="sketch-toolbar-label">SKETCH</span>
                    <button className={`gizmo-btn ${sketchTool === 'line' ? 'active' : ''}`}
                        onClick={() => { _sketch.setTool(SketchTools.LINE); setSketchTool('line'); }} title="Line (L)">L</button>
                    <button className={`gizmo-btn ${sketchTool === 'rectangle' ? 'active' : ''}`}
                        onClick={() => { _sketch.setTool(SketchTools.RECTANGLE); setSketchTool('rectangle'); }} title="Rectangle (B)">R</button>
                    <button className={`gizmo-btn ${sketchTool === 'circle' ? 'active' : ''}`}
                        onClick={() => { _sketch.setTool(SketchTools.CIRCLE); setSketchTool('circle'); }} title="Circle (C)">C</button>
                    <button className={`gizmo-btn ${sketchTool === 'arc' ? 'active' : ''}`}
                        onClick={() => { _sketch.setTool(SketchTools.ARC); setSketchTool('arc'); }} title="Arc (A)">A</button>
                    <button className={`gizmo-btn ${sketchTool === 'dimension' ? 'active' : ''}`}
                        onClick={() => { _sketch.setTool(SketchTools.DIMENSION); setSketchTool('dimension'); }} title="Dimension (D)">D</button>
                    <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                    <button className="gizmo-btn" onClick={() => {
                        // Extrude and exit sketch
                        const profile = _sketch.getProfile();
                        if (profile.length >= 3 && internalsRef.current) {
                            const ft = getFeatureTree();
                            const feature = ft.addExtrude(profile, new Vec3(0, 1, 0), 0.02);
                            if (feature.solid) {
                                const group = ThreeJSBridge.solidToGroup(feature.solid, { color: 0x9aa3ad, edges: true });
                                group.userData.pickable = true;
                                group.userData.generatedModel = true;
                                group.userData.kernelSolid = feature.solid;
                                internalsRef.current.scene.add(group);
                            }
                            _sketch.deactivate(internalsRef.current.scene);
                            sketchActiveRef.current = false;
                            setSketchActive(false);
                            setSketchTool('none');
                            if (internalsRef.current.orbitControls) internalsRef.current.orbitControls.enableRotate = true;
                            setSketchStatus(`Extruded: Feature #${feature.id}`);
                        }
                    }} title="Extrude (E)">Extrude</button>
                    <button className="gizmo-btn" onClick={() => {
                        if (internalsRef.current) {
                            _sketch.deactivate(internalsRef.current.scene);
                            sketchActiveRef.current = false;
                            setSketchActive(false);
                            setSketchTool('none');
                            if (internalsRef.current.orbitControls) internalsRef.current.orbitControls.enableRotate = true;
                            setSketchStatus('');
                        }
                    }} title="Exit Sketch (Esc)">Exit</button>
                </div>
            )}

            {/* Sketch status */}
            {sketchStatus && (
                <div className="sketch-status-bar">
                    {sketchActive && <span className="sketch-active-badge">SKETCH</span>}
                    <span>{sketchStatus}</span>
                </div>
            )}
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
    const maxDim = Math.max(size.x, size.y, size.z) || 0.05;
    // Frame so the body fills ~70 % of the shorter viewport axis.
    // Multiplier 1.05 gives a ~5 % margin around the bounding sphere.
    const halfFov = (camera.fov * Math.PI / 180) / 2;
    const dist = (maxDim / 2) / Math.tan(halfFov) * 1.05;
    // Keep the existing iso-ish viewing direction (dx ≈ dz, dy small).
    // Direction unit-vector (0.6, 0.35, 0.6) normalised.
    const dx = 0.6, dy = 0.35, dz = 0.6;
    const L = Math.hypot(dx, dy, dz);
    camera.position.set(
      center.x + dist * dx / L,
      center.y + dist * dy / L,
      center.z + dist * dz / L,
    );
    camera.near = Math.max(dist * 0.001, 0.0001);
    camera.far  = Math.max(dist * 100, 100);
    camera.updateProjectionMatrix();
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
