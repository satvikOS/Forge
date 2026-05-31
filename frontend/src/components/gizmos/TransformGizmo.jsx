/**
 * Transform Gizmo - IMAX/AAA Quality Interactive 3D Transform Tool
 * Professional-grade gizmo with precise mouse interaction, axis constraints, and visual feedback
 * Supports Move (G), Rotate (R), and Scale (S) operations
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export default function TransformGizmo({
    selectedObject,
    mode = 'translate',
    onTransformChange,
    snapToGrid = false,
    gridSize = 1,
    constrainAxis = null // 'x', 'y', 'z', or null for all axes
}) {
    const gizmoGroupRef = useRef();
    const { camera, gl, raycaster, scene, size } = useThree();

    const [isDragging, setIsDragging] = useState(false);
    const [hoveredAxis, setHoveredAxis] = useState(null);
    const [activeAxis, setActiveAxis] = useState(null);
    const [dragStartMouse, setDragStartMouse] = useState(null);
    const [dragStartValue, setDragStartValue] = useState(null);
    const [dragPlane, setDragPlane] = useState(null);

    // Update gizmo position to match selected object
    useFrame(() => {
        if (gizmoGroupRef.current && selectedObject) {
            const pos = selectedObject.position;
            gizmoGroupRef.current.position.set(pos.x || 0, pos.y || 0, pos.z || 0);

            // For rotate mode, orient gizmo based on object rotation
            if (mode === 'rotate' && selectedObject.rotation) {
                gizmoGroupRef.current.rotation.copy(selectedObject.rotation);
            } else if (mode !== 'rotate') {
                gizmoGroupRef.current.rotation.set(0, 0, 0);
            }
        }
    });

    // Mouse event handlers
    useEffect(() => {
        if (!selectedObject) return;

        const canvas = gl.domElement;

        const getMousePosition = (event) => {
            const rect = canvas.getBoundingClientRect();
            return new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1
            );
        };

        const handlePointerDown = (event) => {
            if (!hoveredAxis || !selectedObject) return;

            setIsDragging(true);
            setActiveAxis(hoveredAxis);
            setDragStartMouse(getMousePosition(event));

            // Store initial transform values
            if (mode === 'translate') {
                setDragStartValue(selectedObject.position.clone());

                // Create drag plane perpendicular to camera for the selected axis
                const plane = new THREE.Plane();
                const normal = new THREE.Vector3();

                if (hoveredAxis === 'x') {
                    normal.set(0, 1, 0); // YZ plane
                } else if (hoveredAxis === 'y') {
                    normal.set(1, 0, 0); // XZ plane
                } else if (hoveredAxis === 'z') {
                    normal.set(1, 0, 0); // XY plane
                } else {
                    // For 'all' axis, use camera-facing plane
                    normal.copy(camera.position).sub(selectedObject.position).normalize();
                }

                plane.setFromNormalAndCoplanarPoint(normal, selectedObject.position);
                setDragPlane(plane);
            } else if (mode === 'rotate') {
                setDragStartValue(selectedObject.rotation.clone());
            } else if (mode === 'scale') {
                setDragStartValue(selectedObject.scale.clone());
            }

            event.stopPropagation();
        };

        const handlePointerMove = (event) => {
            if (!isDragging || !activeAxis || !dragStartMouse || !dragStartValue || !selectedObject) return;

            const mouse = getMousePosition(event);

            if (mode === 'translate') {
                // Calculate intersection with drag plane
                raycaster.setFromCamera(mouse, camera);
                const intersection = new THREE.Vector3();

                if (dragPlane && raycaster.ray.intersectPlane(dragPlane, intersection)) {
                    const delta = intersection.clone().sub(selectedObject.position);
                    const newPosition = dragStartValue.clone();

                    if (activeAxis === 'x' || activeAxis === 'all') {
                        newPosition.x += delta.x;
                    }
                    if (activeAxis === 'y' || activeAxis === 'all') {
                        newPosition.y += delta.y;
                    }
                    if (activeAxis === 'z' || activeAxis === 'all') {
                        newPosition.z += delta.z;
                    }

                    // Apply grid snapping if enabled
                    if (snapToGrid) {
                        newPosition.x = Math.round(newPosition.x / gridSize) * gridSize;
                        newPosition.y = Math.round(newPosition.y / gridSize) * gridSize;
                        newPosition.z = Math.round(newPosition.z / gridSize) * gridSize;
                    }

                    selectedObject.position.copy(newPosition);

                    if (onTransformChange) {
                        onTransformChange({ type: 'translate', position: newPosition, axis: activeAxis });
                    }
                }
            } else if (mode === 'rotate') {
                // Calculate rotation delta from mouse movement
                const mouseDelta = mouse.clone().sub(dragStartMouse);
                const rotationSpeed = 3; // Radians per full screen drag

                const newRotation = dragStartValue.clone();

                if (activeAxis === 'x') {
                    newRotation.x += mouseDelta.y * rotationSpeed;
                } else if (activeAxis === 'y') {
                    newRotation.y += mouseDelta.x * rotationSpeed;
                } else if (activeAxis === 'z') {
                    newRotation.z += -mouseDelta.x * rotationSpeed;
                }

                selectedObject.rotation.copy(newRotation);

                if (onTransformChange) {
                    onTransformChange({ type: 'rotate', rotation: newRotation, axis: activeAxis });
                }
            } else if (mode === 'scale') {
                // Calculate scale delta from mouse movement
                const mouseDelta = mouse.clone().sub(dragStartMouse);
                const scaleSpeed = 2; // Scale factor per full screen drag
                const scaleDelta = 1 + (mouseDelta.y * scaleSpeed);

                const newScale = dragStartValue.clone();

                if (activeAxis === 'x' || activeAxis === 'all') {
                    newScale.x *= scaleDelta;
                }
                if (activeAxis === 'y' || activeAxis === 'all') {
                    newScale.y *= scaleDelta;
                }
                if (activeAxis === 'z' || activeAxis === 'all') {
                    newScale.z *= scaleDelta;
                }

                // Clamp scale to reasonable values
                newScale.x = Math.max(0.01, Math.min(100, newScale.x));
                newScale.y = Math.max(0.01, Math.min(100, newScale.y));
                newScale.z = Math.max(0.01, Math.min(100, newScale.z));

                selectedObject.scale.copy(newScale);

                if (onTransformChange) {
                    onTransformChange({ type: 'scale', scale: newScale, axis: activeAxis });
                }
            }
        };

        const handlePointerUp = () => {
            setIsDragging(false);
            setActiveAxis(null);
            setDragStartMouse(null);
            setDragStartValue(null);
            setDragPlane(null);
        };

        canvas.addEventListener('pointerdown', handlePointerDown);
        canvas.addEventListener('pointermove', handlePointerMove);
        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointerleave', handlePointerUp);

        return () => {
            canvas.removeEventListener('pointerdown', handlePointerDown);
            canvas.removeEventListener('pointermove', handlePointerMove);
            canvas.removeEventListener('pointerup', handlePointerUp);
            canvas.removeEventListener('pointerleave', handlePointerUp);
        };
    }, [selectedObject, hoveredAxis, isDragging, activeAxis, dragStartMouse, dragStartValue, dragPlane, mode, camera, gl, raycaster, onTransformChange, snapToGrid, gridSize]);

    if (!selectedObject) return null;

    // Gizmo scale - adaptive based on camera distance for IMAX clarity
    const gizmoScale = useMemo(() => {
        if (!selectedObject || !camera) return 1.0;

        const distance = camera.position.distanceTo(selectedObject.position);
        return Math.max(0.5, Math.min(2.0, distance * 0.1)); // Adaptive scale
    }, [selectedObject, camera]);

    return (
        <group ref={gizmoGroupRef}>
            {mode === 'translate' && (
                <TranslationGizmo
                    scale={gizmoScale}
                    hoveredAxis={hoveredAxis}
                    activeAxis={activeAxis}
                    setHoveredAxis={setHoveredAxis}
                    constrainAxis={constrainAxis}
                />
            )}
            {mode === 'rotate' && (
                <RotationGizmo
                    scale={gizmoScale}
                    hoveredAxis={hoveredAxis}
                    activeAxis={activeAxis}
                    setHoveredAxis={setHoveredAxis}
                    constrainAxis={constrainAxis}
                />
            )}
            {mode === 'scale' && (
                <ScaleGizmo
                    scale={gizmoScale}
                    hoveredAxis={hoveredAxis}
                    activeAxis={activeAxis}
                    setHoveredAxis={setHoveredAxis}
                    constrainAxis={constrainAxis}
                />
            )}
        </group>
    );
}

/**
 * Translation Gizmo - Arrow handles for moving objects
 */
function TranslationGizmo({ scale, hoveredAxis, activeAxis, setHoveredAxis, constrainAxis }) {
    const arrowLength = 2 * scale;
    const arrowRadius = 0.03 * scale;
    const coneHeight = 0.3 * scale;
    const coneRadius = 0.1 * scale;

    const axisConfig = {
        x: { color: '#ff0000', hoverColor: '#ff6060', activeColor: '#ff9090', rotation: [0, 0, -Math.PI / 2], position: [arrowLength / 2, 0, 0], conePos: [arrowLength, 0, 0] },
        y: { color: '#00ff00', hoverColor: '#60ff60', activeColor: '#90ff90', rotation: [0, 0, 0], position: [0, arrowLength / 2, 0], conePos: [0, arrowLength, 0] },
        z: { color: '#0000ff', hoverColor: '#6060ff', activeColor: '#9090ff', rotation: [Math.PI / 2, 0, 0], position: [0, 0, arrowLength / 2], conePos: [0, 0, arrowLength] },
    };

    const getAxisColor = (axis) => {
        if (activeAxis === axis) return axisConfig[axis].activeColor;
        if (hoveredAxis === axis) return axisConfig[axis].hoverColor;
        if (constrainAxis && constrainAxis !== axis) return axisConfig[axis].color + '40'; // Faded
        return axisConfig[axis].color;
    };

    return (
        <group>
            {Object.entries(axisConfig).map(([axis, config]) => (
                <group key={axis}>
                    <mesh
                        rotation={config.rotation}
                        position={config.position}
                        onPointerEnter={() => setHoveredAxis(axis)}
                        onPointerLeave={() => setHoveredAxis(null)}
                    >
                        <cylinderGeometry args={[arrowRadius, arrowRadius, arrowLength, 8]} />
                        <meshBasicMaterial
                            color={getAxisColor(axis)}
                            transparent
                            opacity={constrainAxis && constrainAxis !== axis ? 0.3 : 1.0}
                            depthTest={false}
                            depthWrite={false}
                        />
                    </mesh>
                    <mesh
                        rotation={config.rotation}
                        position={config.conePos}
                        onPointerEnter={() => setHoveredAxis(axis)}
                        onPointerLeave={() => setHoveredAxis(null)}
                    >
                        <coneGeometry args={[coneRadius, coneHeight, 8]} />
                        <meshBasicMaterial
                            color={getAxisColor(axis)}
                            transparent
                            opacity={constrainAxis && constrainAxis !== axis ? 0.3 : 1.0}
                            depthTest={false}
                            depthWrite={false}
                        />
                    </mesh>
                </group>
            ))}

            {/* Center sphere for uniform movement */}
            <mesh
                position={[0, 0, 0]}
                onPointerEnter={() => setHoveredAxis('all')}
                onPointerLeave={() => setHoveredAxis(null)}
            >
                <sphereGeometry args={[0.15 * scale, 16, 16]} />
                <meshBasicMaterial
                    color={activeAxis === 'all' ? '#ffffff' : (hoveredAxis === 'all' ? '#dddddd' : '#999999')}
                    depthTest={false}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
}

/**
 * Rotation Gizmo - Circular handles for rotating objects
 */
function RotationGizmo({ scale, hoveredAxis, activeAxis, setHoveredAxis, constrainAxis }) {
    const torusRadius = 1.5 * scale;
    const tubeRadius = 0.04 * scale;

    const axisConfig = {
        x: { color: '#ff0000', hoverColor: '#ff6060', activeColor: '#ff9090', rotation: [0, Math.PI / 2, 0] },
        y: { color: '#00ff00', hoverColor: '#60ff60', activeColor: '#90ff90', rotation: [Math.PI / 2, 0, 0] },
        z: { color: '#0000ff', hoverColor: '#6060ff', activeColor: '#9090ff', rotation: [0, 0, 0] },
    };

    const getAxisColor = (axis) => {
        if (activeAxis === axis) return axisConfig[axis].activeColor;
        if (hoveredAxis === axis) return axisConfig[axis].hoverColor;
        if (constrainAxis && constrainAxis !== axis) return axisConfig[axis].color + '40';
        return axisConfig[axis].color;
    };

    return (
        <group>
            {Object.entries(axisConfig).map(([axis, config]) => (
                <mesh
                    key={axis}
                    rotation={config.rotation}
                    onPointerEnter={() => setHoveredAxis(axis)}
                    onPointerLeave={() => setHoveredAxis(null)}
                >
                    <torusGeometry args={[torusRadius, tubeRadius, 32, 64]} />
                    <meshBasicMaterial
                        color={getAxisColor(axis)}
                        transparent
                        opacity={constrainAxis && constrainAxis !== axis ? 0.3 : 0.9}
                        depthTest={false}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
        </group>
    );
}

/**
 * Scale Gizmo - Box handles for scaling objects
 */
function ScaleGizmo({ scale, hoveredAxis, activeAxis, setHoveredAxis, constrainAxis }) {
    const lineLength = 1.5 * scale;
    const lineRadius = 0.02 * scale;
    const cubeSize = 0.15 * scale;

    const axisConfig = {
        x: { color: '#ff0000', hoverColor: '#ff6060', activeColor: '#ff9090', rotation: [0, 0, -Math.PI / 2], position: [lineLength / 2, 0, 0], cubePos: [lineLength, 0, 0] },
        y: { color: '#00ff00', hoverColor: '#60ff60', activeColor: '#90ff90', rotation: [0, 0, 0], position: [0, lineLength / 2, 0], cubePos: [0, lineLength, 0] },
        z: { color: '#0000ff', hoverColor: '#6060ff', activeColor: '#9090ff', rotation: [Math.PI / 2, 0, 0], position: [0, 0, lineLength / 2], cubePos: [0, 0, lineLength] },
    };

    const getAxisColor = (axis) => {
        if (activeAxis === axis) return axisConfig[axis].activeColor;
        if (hoveredAxis === axis) return axisConfig[axis].hoverColor;
        if (constrainAxis && constrainAxis !== axis) return axisConfig[axis].color + '40';
        return axisConfig[axis].color;
    };

    return (
        <group>
            {Object.entries(axisConfig).map(([axis, config]) => (
                <group key={axis}>
                    <mesh
                        rotation={config.rotation}
                        position={config.position}
                        onPointerEnter={() => setHoveredAxis(axis)}
                        onPointerLeave={() => setHoveredAxis(null)}
                    >
                        <cylinderGeometry args={[lineRadius, lineRadius, lineLength, 8]} />
                        <meshBasicMaterial
                            color={getAxisColor(axis)}
                            transparent
                            opacity={constrainAxis && constrainAxis !== axis ? 0.3 : 1.0}
                            depthTest={false}
                            depthWrite={false}
                        />
                    </mesh>
                    <mesh
                        position={config.cubePos}
                        onPointerEnter={() => setHoveredAxis(axis)}
                        onPointerLeave={() => setHoveredAxis(null)}
                    >
                        <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
                        <meshBasicMaterial
                            color={getAxisColor(axis)}
                            transparent
                            opacity={constrainAxis && constrainAxis !== axis ? 0.3 : 1.0}
                            depthTest={false}
                            depthWrite={false}
                        />
                    </mesh>
                </group>
            ))}

            {/* Center cube for uniform scaling */}
            <mesh
                position={[0, 0, 0]}
                onPointerEnter={() => setHoveredAxis('all')}
                onPointerLeave={() => setHoveredAxis(null)}
            >
                <boxGeometry args={[cubeSize * 1.5, cubeSize * 1.5, cubeSize * 1.5]} />
                <meshBasicMaterial
                    color={activeAxis === 'all' ? '#ffffff' : (hoveredAxis === 'all' ? '#dddddd' : '#999999')}
                    depthTest={false}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
}
