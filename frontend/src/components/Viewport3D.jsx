import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

/**
 * Interactive 3D Viewport Component
 * Features: Infinite grid, orbit controls, domain-specific scenes
 */
function Viewport3D({ canvasId = 'render-canvas', domain = 'mechanical', onReady }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const rendererRef = useRef(null);
    const controlsRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1e1e1e);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(10, 10, 10);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Infinite Grid
        const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x2a2a2a);
        scene.add(gridHelper);

        // Axes Helper (small, subtle)
        const axesHelper = new THREE.AxesHelper(5);
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

        // Orbit Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 1;
        controls.maxDistance = 500;
        controls.maxPolarAngle = Math.PI / 2;
        controlsRef.current = controls;

        // Domain-specific objects
        createDomainScene(scene, domain);

        // Ground plane
        const planeGeometry = new THREE.PlaneGeometry(100, 100);
        const planeMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        scene.add(plane);

        // Animation loop
        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        // Resize handler
        function handleResize() {
            const newWidth = container.clientWidth;
            const newHeight = container.clientHeight;
            camera.aspect = newWidth / newHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(newWidth, newHeight);
        }
        window.addEventListener('resize', handleResize);

        // Notify parent that scene is ready
        if (onReady) {
            onReady({ scene, camera, renderer, controls });
        }

        // Cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            renderer.dispose();
            container.removeChild(renderer.domElement);
        };
    }, [canvasId, domain, onReady]);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
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
        case 'mechanical':
            const gear = createGear();
            gear.position.set(0, 1, 0);
            scene.add(gear);
            break;

        case 'architecture':
            const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.3), material);
            wall.position.set(0, 1.5, 0);
            wall.castShadow = true;
            scene.add(wall);
            break;

        case 'automotive':
            const body = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2), material);
            body.position.set(0, 0.5, 0);
            body.castShadow = true;
            scene.add(body);

            const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.8), material);
            top.position.set(-0.3, 1.4, 0);
            top.castShadow = true;
            scene.add(top);
            break;

        case 'gaming':
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), material);
            head.position.set(0, 2.5, 0);
            head.castShadow = true;
            scene.add(head);

            const body2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.8), material);
            body2.position.set(0, 1.25, 0);
            body2.castShadow = true;
            scene.add(body2);
            break;

        case 'industrial':
            const conveyor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 1), material);
            conveyor.position.set(0, 0.5, 0);
            conveyor.castShadow = true;
            scene.add(conveyor);
            break;

        case 'electronics':
            const pcb = new THREE.Mesh(
                new THREE.BoxGeometry(6, 0.1, 4),
                new THREE.MeshStandardMaterial({ color: 0x1a5f1a })
            );
            pcb.position.set(0, 0.5, 0);
            pcb.castShadow = true;
            scene.add(pcb);

            for (let i = 0; i < 5; i++) {
                const component = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), material);
                component.position.set((Math.random() - 0.5) * 5, 0.7, (Math.random() - 0.5) * 3);
                component.castShadow = true;
                scene.add(component);
            }
            break;

        case 'aviation':
            const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 2), material);
            wing.position.set(0, 1, 0);
            wing.rotation.z = Math.PI / 12;
            wing.castShadow = true;
            scene.add(wing);
            break;

        case 'ui-product':
            const phone = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 3, 0.2),
                new THREE.MeshStandardMaterial({ color: 0x333333 })
            );
            phone.position.set(0, 1.5, 0);
            phone.rotation.x = -Math.PI / 6;
            phone.castShadow = true;
            scene.add(phone);

            const screen = new THREE.Mesh(
                new THREE.BoxGeometry(1.3, 2.7, 0.05),
                new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
            );
            screen.position.set(0, 1.5, 0.13);
            screen.rotation.x = -Math.PI / 6;
            scene.add(screen);
            break;

        default:
            const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
            cube.position.y = 1;
            cube.castShadow = true;
            scene.add(cube);
    }
}

/**
 * Create a simple gear shape
 */
function createGear() {
    const group = new THREE.Group();

    const center = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 0.5, 32),
        new THREE.MeshStandardMaterial({ color: 0x8b1538, metalness: 0.3, roughness: 0.4 })
    );
    center.castShadow = true;
    group.add(center);

    for (let i = 0; i < 12; i++) {
        const tooth = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.5, 0.4),
            new THREE.MeshStandardMaterial({ color: 0x8b1538, metalness: 0.3, roughness: 0.4 })
        );
        const angle = (i / 12) * Math.PI * 2;
        tooth.position.x = Math.cos(angle) * 1.2;
        tooth.position.z = Math.sin(angle) * 1.2;
        tooth.castShadow = true;
        group.add(tooth);
    }

    return group;
}

export default Viewport3D;
