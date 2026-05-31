import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './NavSphere.css';

/**
 * NavSphere - Translucent 3D orientation sphere (replaces ViewCube)
 * Syncs with main viewport camera. Click regions to snap to standard views.
 * Inspired by NX/CATIA navigation widgets.
 */
function NavSphere({ camera, controls }) {
    const containerRef = useRef(null);
    const rafRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current || !camera || !controls) return;

        const size = 130;
        const container = containerRef.current;

        // Mini scene
        const scene = new THREE.Scene();

        // Orthographic camera
        const miniCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
        miniCamera.position.set(3, 3, 3);
        miniCamera.lookAt(0, 0, 0);

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(size, size);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);

        // Translucent sphere
        const sphereGeo = new THREE.SphereGeometry(0.9, 32, 32);
        const sphereMat = new THREE.MeshPhysicalMaterial({
            color: 0x222222,
            transparent: true,
            opacity: 0.25,
            roughness: 0.1,
            metalness: 0.1,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            side: THREE.FrontSide,
            depthWrite: false,
        });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        scene.add(sphere);

        // Wireframe rings for latitude/longitude feel
        const ringMat = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.3 });

        // Equator ring
        const eqGeo = new THREE.RingGeometry(0.89, 0.91, 64);
        const eqMesh = new THREE.Mesh(eqGeo, new THREE.MeshBasicMaterial({
            color: 0x555555, transparent: true, opacity: 0.15, side: THREE.DoubleSide
        }));
        eqMesh.rotation.x = Math.PI / 2;
        scene.add(eqMesh);

        // Vertical ring
        const vRing = eqMesh.clone();
        vRing.rotation.x = 0;
        vRing.rotation.y = 0;
        scene.add(vRing);

        // Side ring
        const sRing = eqMesh.clone();
        sRing.rotation.x = 0;
        sRing.rotation.z = Math.PI / 2;
        scene.add(sRing);

        // Axis lines extending through sphere
        const axisLen = 1.3;
        const axisOrigin = 0;

        // X axis - Red
        const xLine = createAxisLine(
            new THREE.Vector3(axisOrigin, 0, 0),
            new THREE.Vector3(axisLen, 0, 0),
            0xff3333
        );
        scene.add(xLine);

        // Y axis - Green
        const yLine = createAxisLine(
            new THREE.Vector3(0, axisOrigin, 0),
            new THREE.Vector3(0, axisLen, 0),
            0x33ff33
        );
        scene.add(yLine);

        // Z axis - Blue
        const zLine = createAxisLine(
            new THREE.Vector3(0, 0, axisOrigin),
            new THREE.Vector3(0, 0, axisLen),
            0x3388ff
        );
        scene.add(zLine);

        // Negative axes (dimmer)
        const xLineNeg = createAxisLine(
            new THREE.Vector3(-axisLen, 0, 0),
            new THREE.Vector3(axisOrigin, 0, 0),
            0x992222
        );
        scene.add(xLineNeg);

        const yLineNeg = createAxisLine(
            new THREE.Vector3(0, -axisLen, 0),
            new THREE.Vector3(0, axisOrigin, 0),
            0x229922
        );
        scene.add(yLineNeg);

        const zLineNeg = createAxisLine(
            new THREE.Vector3(0, 0, -axisLen),
            new THREE.Vector3(0, 0, axisOrigin),
            0x225599
        );
        scene.add(zLineNeg);

        // Axis endpoint dots
        const dotGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const dots = [
            { pos: [axisLen, 0, 0], color: 0xff3333 },
            { pos: [0, axisLen, 0], color: 0x33ff33 },
            { pos: [0, 0, axisLen], color: 0x3388ff },
            { pos: [-axisLen, 0, 0], color: 0x662222 },
            { pos: [0, -axisLen, 0], color: 0x226622 },
            { pos: [0, 0, -axisLen], color: 0x223366 },
        ];

        dots.forEach(d => {
            const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: d.color }));
            dot.position.set(...d.pos);
            scene.add(dot);
        });

        // Axis labels using sprites
        const labelData = [
            { text: 'X', pos: [axisLen + 0.15, 0, 0], color: '#ff3333' },
            { text: 'Y', pos: [0, axisLen + 0.15, 0], color: '#33ff33' },
            { text: 'Z', pos: [0, 0, axisLen + 0.15], color: '#3388ff' },
        ];

        labelData.forEach(({ text, pos, color }) => {
            const sprite = createTextSprite(text, color);
            sprite.position.set(...pos);
            sprite.scale.set(0.3, 0.3, 1);
            scene.add(sprite);
        });

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight.position.set(2, 3, 2);
        scene.add(dirLight);

        // Reusable direction vector for animation
        const direction = new THREE.Vector3();

        // Sync with main camera
        function animate() {
            rafRef.current = requestAnimationFrame(animate);

            camera.getWorldDirection(direction);
            direction.negate().multiplyScalar(4);

            miniCamera.position.copy(direction);
            miniCamera.lookAt(0, 0, 0);
            miniCamera.up.copy(camera.up);

            renderer.render(scene, miniCamera);
        }
        rafRef.current = requestAnimationFrame(animate);

        // Click to snap to standard views
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const handleClick = (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, miniCamera);
            const intersects = raycaster.intersectObject(sphere);

            if (intersects.length > 0) {
                const point = intersects[0].point.normalize();

                // Determine closest standard view
                const views = [
                    { dir: new THREE.Vector3(1, 0, 0), pos: [15, 0, 0] },   // Right
                    { dir: new THREE.Vector3(-1, 0, 0), pos: [-15, 0, 0] },  // Left
                    { dir: new THREE.Vector3(0, 1, 0), pos: [0, 15, 0.01] }, // Top
                    { dir: new THREE.Vector3(0, -1, 0), pos: [0, -15, 0.01] }, // Bottom
                    { dir: new THREE.Vector3(0, 0, 1), pos: [0, 0, 15] },   // Front
                    { dir: new THREE.Vector3(0, 0, -1), pos: [0, 0, -15] },  // Back
                ];

                let bestView = views[0];
                let bestDot = -Infinity;

                for (const v of views) {
                    const d = point.dot(v.dir);
                    if (d > bestDot) {
                        bestDot = d;
                        bestView = v;
                    }
                }

                snapCameraToView(bestView.pos, camera, controls);
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

    return (
        <div ref={containerRef} className="navsphere-container">
            <div className="navsphere-axes-labels">
                <button className="navsphere-axis-btn x" onClick={() => snapCameraToView([15, 0, 0], camera, controls)} title="Right (+X)">X</button>
                <button className="navsphere-axis-btn y" onClick={() => snapCameraToView([0, 15, 0.01], camera, controls)} title="Top (+Y)">Y</button>
                <button className="navsphere-axis-btn z" onClick={() => snapCameraToView([0, 0, 15], camera, controls)} title="Front (+Z)">Z</button>
            </div>
        </div>
    );
}

function createAxisLine(start, end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
}

function createTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 40px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    return new THREE.Sprite(mat);
}

function snapCameraToView(pos, camera, controls) {
    if (!camera || !controls) return;
    const target = new THREE.Vector3(...pos);
    const start = camera.position.clone();
    const duration = 300;
    const startTime = Date.now();

    function animateSnap() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
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

export default NavSphere;
