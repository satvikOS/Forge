import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { Move, RotateCcw, Maximize } from 'lucide-react';
import { useViewport } from '../contexts/ViewportContext';

/**
 * Interactive 3D Viewport Component
 * Performance-optimized: throttled events, reused objects, proper RAF cleanup, GPU hints
 */
function Viewport3D({ canvasId = 'render-canvas', domain = 'mechanical', onReady }) {
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

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0d0d0d);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(10, 10, 10);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        // Renderer - high performance mode
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

        // Grid
        const gridHelper = new THREE.GridHelper(100, 100, 0x333333, 0x1a1a1a);
        gridHelper.userData.pickable = false;
        scene.add(gridHelper);

        // Axes
        const axesHelper = new THREE.AxesHelper(5);
        axesHelper.userData.pickable = false;
        scene.add(axesHelper);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        scene.add(directionalLight);

        // Orbit Controls - responsive damping for smooth feel
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
        controls.screenSpacePanning = false;
        controls.minDistance = 1;
        controls.maxDistance = 500;
        controls.maxPolarAngle = Math.PI;
        controls.rotateSpeed = 0.8;
        controls.zoomSpeed = 1.2;
        controls.panSpeed = 0.8;
        controlsRef.current = controls;

        // Transform Controls
        const transformControls = new TransformControls(camera, renderer.domElement);
        transformControls.setSize(0.75);
        scene.add(transformControls);
        transformRef.current = transformControls;

        transformControls.addEventListener('dragging-changed', (event) => {
            controls.enabled = !event.value;
        });

        // Domain-specific scene objects
        createDomainScene(scene, domain);

        // Ground shadow plane
        const planeGeometry = new THREE.PlaneGeometry(100, 100);
        const planeMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        plane.userData.pickable = false;
        scene.add(plane);

        // Reusable raycaster objects (avoids GC per click)
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        // Throttled click handler
        let clickPending = false;
        const handleClick = (event) => {
            if (clickPending) return;
            clickPending = true;
            requestAnimationFrame(() => { clickPending = false; });

            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);

            const pickable = scene.children.filter(obj =>
                obj.isMesh &&
                obj.userData.pickable !== false &&
                !obj.isTransformControlsPlane
            );

            const intersects = raycaster.intersectObjects(pickable, true);

            if (intersects.length > 0) {
                let target = intersects[0].object;
                while (target.parent && target.parent !== scene) {
                    target = target.parent;
                }
                selectedRef.current = target;
                transformControls.attach(target);
            } else {
                selectedRef.current = null;
                transformControls.detach();
            }
        };

        renderer.domElement.addEventListener('click', handleClick);

        // Keyboard shortcuts
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key.toLowerCase()) {
                case 'g':
                    transformControls.setMode('translate');
                    setTransformMode('translate');
                    break;
                case 'r':
                    transformControls.setMode('rotate');
                    setTransformMode('rotate');
                    break;
                case 's':
                    if (!e.ctrlKey && !e.metaKey) {
                        transformControls.setMode('scale');
                        setTransformMode('scale');
                    }
                    break;
                case 'delete':
                case 'backspace':
                    if (selectedRef.current && e.target.tagName !== 'INPUT') {
                        scene.remove(selectedRef.current);
                        selectedRef.current = null;
                        transformControls.detach();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        // Optimized render loop - uses RAF timestamp, no allocations per frame
        function animate() {
            rafRef.current = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        rafRef.current = requestAnimationFrame(animate);

        // Debounced resize
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

        // Notify parent
        if (onReady) {
            onReady({ scene, camera, renderer, controls, transformControls });
        }

        if (viewport && viewport.registerViewport) {
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
        </div>
    );
}

/**
 * Create domain-specific 3D scenes
 */
function createDomainScene(scene, domain) {
    const material = new THREE.MeshStandardMaterial({
        color: 0x8b1538,
        metalness: 0.3,
        roughness: 0.4
    });

    switch (domain) {
        case 'mechanical': {
            const gear = createGear();
            gear.position.set(0, 1, 0);
            gear.userData.pickable = true;
            gear.name = 'Gear';
            scene.add(gear);
            break;
        }

        case 'architecture': {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.3), material);
            wall.position.set(0, 1.5, 0);
            wall.castShadow = true;
            wall.userData.pickable = true;
            wall.name = 'Wall';
            scene.add(wall);
            break;
        }

        case 'automotive': {
            const body = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2), material);
            body.position.set(0, 0.5, 0);
            body.castShadow = true;
            body.userData.pickable = true;
            body.name = 'Car Body';
            scene.add(body);

            const carTop = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.8), material);
            carTop.position.set(-0.3, 1.4, 0);
            carTop.castShadow = true;
            carTop.userData.pickable = true;
            carTop.name = 'Car Top';
            scene.add(carTop);
            break;
        }

        case 'gaming': {
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), material);
            head.position.set(0, 2.5, 0);
            head.castShadow = true;
            head.userData.pickable = true;
            head.name = 'Character Head';
            scene.add(head);

            const charBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.8), material);
            charBody.position.set(0, 1.25, 0);
            charBody.castShadow = true;
            charBody.userData.pickable = true;
            charBody.name = 'Character Body';
            scene.add(charBody);
            break;
        }

        case 'electronics': {
            const pcb = new THREE.Mesh(
                new THREE.BoxGeometry(6, 0.1, 4),
                new THREE.MeshStandardMaterial({ color: 0x1a5f1a })
            );
            pcb.position.set(0, 0.5, 0);
            pcb.castShadow = true;
            pcb.userData.pickable = true;
            pcb.name = 'PCB Board';
            scene.add(pcb);

            for (let i = 0; i < 5; i++) {
                const component = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), material);
                component.position.set((Math.random() - 0.5) * 5, 0.7, (Math.random() - 0.5) * 3);
                component.castShadow = true;
                component.userData.pickable = true;
                component.name = `Component ${i + 1}`;
                scene.add(component);
            }
            break;
        }

        default: {
            const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
            cube.position.y = 1;
            cube.castShadow = true;
            cube.userData.pickable = true;
            cube.name = 'Default Cube';
            scene.add(cube);
        }
    }
}

function createGear() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b1538, metalness: 0.3, roughness: 0.4 });

    const center = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 32), mat);
    center.castShadow = true;
    group.add(center);

    const toothGeo = new THREE.BoxGeometry(0.3, 0.5, 0.4);
    for (let i = 0; i < 12; i++) {
        const tooth = new THREE.Mesh(toothGeo, mat);
        const angle = (i / 12) * Math.PI * 2;
        tooth.position.x = Math.cos(angle) * 1.2;
        tooth.position.z = Math.sin(angle) * 1.2;
        tooth.castShadow = true;
        group.add(tooth);
    }

    return group;
}

export default Viewport3D;
