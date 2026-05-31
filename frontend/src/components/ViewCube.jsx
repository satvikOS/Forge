import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './ViewCube.css';

/**
 * ViewCube - 3D orientation widget that syncs with main viewport camera
 * Renders a mini Three.js scene with a labeled cube
 * Clicking faces snaps the main camera to standard views
 */
function ViewCube({ camera, controls }) {
    const containerRef = useRef(null);
    const miniSceneRef = useRef(null);
    const miniCameraRef = useRef(null);
    const miniRendererRef = useRef(null);
    const rafRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current || !camera || !controls) return;

        const size = 120;
        const container = containerRef.current;

        // Mini scene
        const scene = new THREE.Scene();
        miniSceneRef.current = scene;

        // Mini camera - orthographic for clean look
        const miniCamera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 100);
        miniCamera.position.set(3, 3, 3);
        miniCamera.lookAt(0, 0, 0);
        miniCameraRef.current = miniCamera;

        // Mini renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(size, size);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);
        miniRendererRef.current = renderer;

        // Create cube with face labels
        const cubeSize = 1;
        const cubeMaterials = createCubeMaterials(cubeSize);
        const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
        const cube = new THREE.Mesh(cubeGeometry, cubeMaterials);
        scene.add(cube);

        // Edge wireframe for definition
        const edges = new THREE.EdgesGeometry(cubeGeometry);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x444444 });
        const wireframe = new THREE.LineSegments(edges, edgeMaterial);
        scene.add(wireframe);

        // Axis lines extending from cube
        const axisLength = 1.2;
        // X axis - red
        const xLine = createAxisLine(
            new THREE.Vector3(cubeSize / 2, 0, 0),
            new THREE.Vector3(cubeSize / 2 + axisLength, 0, 0),
            0xff3333
        );
        scene.add(xLine);

        // Y axis - green
        const yLine = createAxisLine(
            new THREE.Vector3(0, cubeSize / 2, 0),
            new THREE.Vector3(0, cubeSize / 2 + axisLength, 0),
            0x33ff33
        );
        scene.add(yLine);

        // Z axis - blue
        const zLine = createAxisLine(
            new THREE.Vector3(0, 0, cubeSize / 2),
            new THREE.Vector3(0, 0, cubeSize / 2 + axisLength),
            0x3388ff
        );
        scene.add(zLine);

        // Subtle ambient light
        scene.add(new THREE.AmbientLight(0xffffff, 1));

        // Sync with main camera
        function animate() {
            rafRef.current = requestAnimationFrame(animate);

            // Copy the main camera's rotation to the mini camera
            // The mini camera orbits at a fixed distance but matches the main camera's direction
            const direction = new THREE.Vector3();
            camera.getWorldDirection(direction);
            direction.negate();

            const dist = 4;
            miniCamera.position.copy(direction.multiplyScalar(dist));
            miniCamera.lookAt(0, 0, 0);
            miniCamera.up.copy(camera.up);

            renderer.render(scene, miniCamera);
        }
        animate();

        // Click handling for face snapping
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const handleClick = (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, miniCamera);
            const intersects = raycaster.intersectObject(cube);

            if (intersects.length > 0) {
                const faceIndex = intersects[0].faceIndex;
                const viewDirection = getViewFromFaceIndex(faceIndex);
                snapCameraToView(viewDirection, camera, controls);
            }
        };

        renderer.domElement.addEventListener('click', handleClick);
        renderer.domElement.style.cursor = 'pointer';

        return () => {
            cancelAnimationFrame(rafRef.current);
            renderer.domElement.removeEventListener('click', handleClick);
            renderer.dispose();
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [camera, controls]);

    return <div ref={containerRef} className="viewcube-container" />;
}

// Create labeled materials for each cube face
function createCubeMaterials() {
    const faces = [
        { label: 'R', color: '#1a1a1a', textColor: '#ff3333' },   // +X Right
        { label: 'L', color: '#1a1a1a', textColor: '#ff3333' },   // -X Left
        { label: 'T', color: '#1a1a1a', textColor: '#33ff33' },   // +Y Top
        { label: 'B', color: '#1a1a1a', textColor: '#33ff33' },   // -Y Bottom
        { label: 'F', color: '#1a1a1a', textColor: '#3388ff' },   // +Z Front
        { label: 'K', color: '#1a1a1a', textColor: '#3388ff' },   // -Z Back
    ];

    return faces.map(face => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = face.color;
        ctx.fillRect(0, 0, 128, 128);

        // Border
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 126, 126);

        // Label
        ctx.fillStyle = face.textColor;
        ctx.font = 'bold 48px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(face.label, 64, 64);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;

        return new THREE.MeshBasicMaterial({ map: texture });
    });
}

function createAxisLine(start, end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

// Map face index to camera view direction
function getViewFromFaceIndex(faceIndex) {
    const pair = Math.floor(faceIndex / 2);
    switch (pair) {
        case 0: return { pos: [15, 0, 0], name: 'Right' };    // +X
        case 1: return { pos: [-15, 0, 0], name: 'Left' };    // -X
        case 2: return { pos: [0, 15, 0], name: 'Top' };      // +Y
        case 3: return { pos: [0, -15, 0.01], name: 'Bottom' }; // -Y
        case 4: return { pos: [0, 0, 15], name: 'Front' };    // +Z
        case 5: return { pos: [0, 0, -15], name: 'Back' };    // -Z
        default: return { pos: [10, 10, 10], name: 'Isometric' };
    }
}

// Smoothly snap camera to a standard view
function snapCameraToView(view, camera, controls) {
    const target = new THREE.Vector3(...view.pos);
    const start = camera.position.clone();
    const duration = 300;
    const startTime = Date.now();

    function animateSnap() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(start, target, ease);
        controls.target.set(0, 0, 0);
        controls.update();

        if (t < 1) {
            requestAnimationFrame(animateSnap);
        }
    }
    animateSnap();
}

export default ViewCube;
