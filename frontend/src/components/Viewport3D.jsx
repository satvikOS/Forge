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
            // Mechanical: Gears and mechanical parts
            const gear = createGear();
            gear.position.set(0, 1, 0);
            scene.add(gear);
            break;

        case 'architecture':
            // Architecture: Simple building structure
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(8, 3, 0.3),
                material
            );
            wall.position.set(0, 1.5, 0);
            wall.castShadow = true;
            scene.add(wall);
            break;

        case 'automotive':
            // Automotive: Car-like body
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(4, 1, 2),
                material
            );
            body.position.set(0, 0.5, 0);
            body.castShadow = true;
            scene.add(body);

            const top = new THREE.Mesh(
                new THREE.BoxGeometry(2, 0.8, 1.8),
                material
            );
            top.position.set(-0.3, 1.4, 0);
            top.castShadow = true;
            scene.add(top);
            break;

        case 'gaming':
            // Gaming: Character-like figure
            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 16, 16),
                material
            );
            head.position.set(0, 2.5, 0);
            head.castShadow = true;
            scene.add(head);

            const body2 = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1.5, 0.8),
                material
            );
            body2.position.set(0, 1.25, 0);
            body2.castShadow = true;
            scene.add(body2);
            break;

        case 'industrial':
            // Industrial: Conveyor belt
            const conveyor = new THREE.Mesh(
                new THREE.BoxGeometry(8, 0.3, 1),
                material
            );
            conveyor.position.set(0, 0.5, 0);
            conveyor.castShadow = true;
            scene.add(conveyor);
            break;

        case 'electronics':
            // Electronics: PCB board
            const pcb = new THREE.Mesh(
                new THREE.BoxGeometry(6, 0.1, 4),
                new THREE.MeshStandardMaterial({ color: 0x1a5f1a })
            );
            pcb.position.set(0, 0.5, 0);
            pcb.castShadow = true;
            scene.add(pcb);

            // Add components
            for (let i = 0; i < 5; i++) {
                const component = new THREE.Mesh(
                    new THREE.BoxGeometry(0.3, 0.2, 0.3),
                    material
                );
                component.position.set(
                    (Math.random() - 0.5) * 5,
                    0.7,
                    (Math.random() - 0.5) * 3
                );
                component.castShadow = true;
                scene.add(component);
            }
            break;

        case 'aviation':
            // Aviation: Wing section
            const wing = new THREE.Mesh(
                new THREE.BoxGeometry(8, 0.3, 2),
                material
            );
            wing.position.set(0, 1, 0);
            wing.rotation.z = Math.PI / 12;
            wing.castShadow = true;
            scene.add(wing);
            break;

        case 'ui-product':
            // UI/Product: Phone mockup
            const phone = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 3, 0.2),
                new THREE.MeshStandardMaterial({ color: 0x333333 })
            );
            phone.position.set(0, 1.5, 0);
            phone.rotation.x = -Math.PI / 6;
            phone.castShadow = true;
            scene.add(phone);

            // Screen
            const screen = new THREE.Mesh(
                new THREE.BoxGeometry(1.3, 2.7, 0.05),
                new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
            );
            screen.position.set(0, 1.5, 0.13);
            screen.rotation.x = -Math.PI / 6;
            scene.add(screen);
            break;

        default:
            // Default: Simple cube
            const cube = new THREE.Mesh(
                new THREE.BoxGeometry(2, 2, 2),
                material
            );
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

    // Teeth
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

    // Sample cube for testing (will be replaced by AI models)
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const material = new THREE.MeshStandardMaterial({
        color: 0x8b1538,
        metalness: 0.3,
        roughness: 0.4
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.y = 1;
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);

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
}, [canvasId, onReady]);

return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        {/* ViewCube Gizmo - Top Right */}
        <ViewCubeGizmo
            camera={cameraRef.current}
            controls={controlsRef.current}
        />
    </div>
);
}

/**
 * ViewCube Gizmo Component
 * Interactive orientation cube in top-right corner
 */
function ViewCubeGizmo({ camera, controls }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!canvasRef.current || !camera) return;

        const canvas = canvasRef.current;
        const size = 120;

        // Mini scene for viewcube
        const scene = new THREE.Scene();
        const miniCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        miniCamera.position.set(0, 0, 5);

        const renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true
        });
        renderer.setSize(size, size);
        renderer.setClearColor(0x000000, 0);

        // Create viewcube
        const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
        const materials = [
            new THREE.MeshBasicMaterial({ color: 0x8b1538, transparent: true, opacity: 0.8 }), // Right (X+)
            new THREE.MeshBasicMaterial({ color: 0x6d1029, transparent: true, opacity: 0.8 }), // Left (X-)
            new THREE.MeshBasicMaterial({ color: 0x8b1538, transparent: true, opacity: 0.8 }), // Top (Y+)
            new THREE.MeshBasicMaterial({ color: 0x6d1029, transparent: true, opacity: 0.8 }), // Bottom (Y-)
            new THREE.MeshBasicMaterial({ color: 0x8b1538, transparent: true, opacity: 0.8 }), // Front (Z+)
            new THREE.MeshBasicMaterial({ color: 0x6d1029, transparent: true, opacity: 0.8 })  // Back (Z-)
        ];

        const cube = new THREE.Mesh(cubeGeometry, materials);
        scene.add(cube);

        // Edges
        const edges = new THREE.EdgesGeometry(cubeGeometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        cube.add(wireframe);

        // Labels
        const loader = new THREE.FontLoader();
        const addLabel = (text, position, rotation) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 64;
            canvas.height = 64;
            context.fillStyle = 'white';
            context.font = 'bold 48px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(text, 32, 32);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.position.copy(position);
            sprite.scale.set(0.5, 0.5, 1);
            cube.add(sprite);
        };

        addLabel('F', new THREE.Vector3(0, 0, 1.2));  // Front
        addLabel('B', new THREE.Vector3(0, 0, -1.2)); // Back
        addLabel('R', new THREE.Vector3(1.2, 0, 0));  // Right
        addLabel('L', new THREE.Vector3(-1.2, 0, 0)); // Left
        addLabel('T', new THREE.Vector3(0, 1.2, 0));  // Top
        addLabel('D', new THREE.Vector3(0, -1.2, 0)); // Bottom

        // Sync rotation with main camera
        function animate() {
            requestAnimationFrame(animate);

            // Copy main camera rotation
            if (camera) {
                cube.quaternion.copy(camera.quaternion).invert();
            }

            renderer.render(scene, miniCamera);
        }
        animate();

        // Click handler for view changes
        const handleClick = (event) => {
            if (!camera || !controls) return;

            const rect = canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(x, y), miniCamera);
            const intersects = raycaster.intersectObject(cube);

            if (intersects.length > 0) {
                const face = intersects[0].face;
                const normal = face.normal.clone();

                // Transform normal to world space
                normal.transformDirection(cube.matrixWorld);

                // Set camera position based on clicked face
                const distance = camera.position.distanceTo(controls.target);
                const newPosition = controls.target.clone().add(normal.multiplyScalar(distance));

                // Smooth transition
                const startPosition = camera.position.clone();
                const startTime = Date.now();
                const duration = 500;

                function animateTransition() {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

                    camera.position.lerpVectors(startPosition, newPosition, eased);
                    camera.lookAt(controls.target);

                    if (progress < 1) {
                        requestAnimationFrame(animateTransition);
                    }
                }
                animateTransition();
            }
        };

        canvas.addEventListener('click', handleClick);

        return () => {
            canvas.removeEventListener('click', handleClick);
            renderer.dispose();
        };
    }, [camera, controls]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '120px',
                height: '120px',
                cursor: 'pointer',
                zIndex: 100,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                background: 'rgba(30, 30, 30, 0.8)'
            }}
        />
    );
}

export default Viewport3D;
