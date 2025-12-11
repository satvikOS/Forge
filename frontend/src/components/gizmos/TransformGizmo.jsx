/**
 * Transform Gizmo - Cinema 4D and Blender-style 3D gizmo
 * Provides rotation, translation, and scale controls
 */

import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export default function TransformGizmo({ selectedObject, mode = 'translate', onTransformChange, snapToGrid = false }) {
    const gizmoGroupRef = useRef();
    const { camera, gl, raycaster } = useThree();

    const [isDragging, setIsDragging] = useState(false);
    const [hoveredAxis, setHoveredAxis] = useState(null);
    const [dragStartPoint, setDragStartPoint] = useState(null);
    const [dragStartValue, setDragStartValue] = useState(null);

    // Update gizmo position to match selected object
    useFrame(() => {
        if (gizmoGroupRef.current && selectedObject) {
            const pos = selectedObject.position;
            gizmoGroupRef.current.position.set(pos.x || 0, pos.y || 0, pos.z || 0);

            // Make gizmo always face camera for better visibility
            if (mode === 'rotate') {
                gizmoGroupRef.current.quaternion.copy(camera.quaternion);
            }
        }
    });

    if (!selectedObject) return null;

    // Gizmo scale - make it visible but not too large
    const gizmoScale = 1.0;

    return (
        <group ref={gizmoGroupRef}>
            {mode === 'translate' && (
                <TranslationGizmo
                    scale={gizmoScale}
                    onAxisDrag={onTransformChange}
                    hoveredAxis={hoveredAxis}
                    setHoveredAxis={setHoveredAxis}
                    snapToGrid={snapToGrid}
                />
            )}
            {mode === 'rotate' && (
                <RotationGizmo
                    scale={gizmoScale}
                    onAxisDrag={onTransformChange}
                    hoveredAxis={hoveredAxis}
                    setHoveredAxis={setHoveredAxis}
                />
            )}
            {mode === 'scale' && (
                <ScaleGizmo
                    scale={gizmoScale}
                    onAxisDrag={onTransformChange}
                    hoveredAxis={hoveredAxis}
                    setHoveredAxis={setHoveredAxis}
                />
            )}
        </group>
    );
}

/**
 * Translation Gizmo - Arrow handles for moving objects
 */
function TranslationGizmo({ scale, onAxisDrag, hoveredAxis, setHoveredAxis, snapToGrid }) {
    const xAxisRef = useRef();
    const yAxisRef = useRef();
    const zAxisRef = useRef();

    const arrowLength = 2 * scale;
    const arrowRadius = 0.03 * scale;
    const coneHeight = 0.3 * scale;
    const coneRadius = 0.1 * scale;

    return (
        <group>
            {/* X Axis - Red */}
            <group ref={xAxisRef}>
                <mesh rotation={[0, 0, -Math.PI / 2]} position={[arrowLength / 2, 0, 0]}>
                    <cylinderGeometry args={[arrowRadius, arrowRadius, arrowLength, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'x' ? '#ff6060' : '#ff0000'} />
                </mesh>
                <mesh rotation={[0, 0, -Math.PI / 2]} position={[arrowLength, 0, 0]}>
                    <coneGeometry args={[coneRadius, coneHeight, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'x' ? '#ff6060' : '#ff0000'} />
                </mesh>
            </group>

            {/* Y Axis - Green */}
            <group ref={yAxisRef}>
                <mesh position={[0, arrowLength / 2, 0]}>
                    <cylinderGeometry args={[arrowRadius, arrowRadius, arrowLength, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'y' ? '#60ff60' : '#00ff00'} />
                </mesh>
                <mesh position={[0, arrowLength, 0]}>
                    <coneGeometry args={[coneRadius, coneHeight, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'y' ? '#60ff60' : '#00ff00'} />
                </mesh>
            </group>

            {/* Z Axis - Blue */}
            <group ref={zAxisRef}>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, arrowLength / 2]}>
                    <cylinderGeometry args={[arrowRadius, arrowRadius, arrowLength, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'z' ? '#6060ff' : '#0000ff'} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, arrowLength]}>
                    <coneGeometry args={[coneRadius, coneHeight, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'z' ? '#6060ff' : '#0000ff'} />
                </mesh>
            </group>

            {/* Center sphere for uniform movement */}
            <mesh position={[0, 0, 0]}>
                <sphereGeometry args={[0.15 * scale, 16, 16]} />
                <meshBasicMaterial color={hoveredAxis === 'all' ? '#ffffff' : '#cccccc'} />
            </mesh>
        </group>
    );
}

/**
 * Rotation Gizmo - Circular handles for rotating objects
 */
function RotationGizmo({ scale, onAxisDrag, hoveredAxis, setHoveredAxis }) {
    const torusRadius = 1.5 * scale;
    const tubeRadius = 0.03 * scale;

    return (
        <group>
            {/* X Axis - Red circle (YZ plane) */}
            <mesh rotation={[0, Math.PI / 2, 0]}>
                <torusGeometry args={[torusRadius, tubeRadius, 16, 64]} />
                <meshBasicMaterial
                    color={hoveredAxis === 'x' ? '#ff6060' : '#ff0000'}
                    transparent
                    opacity={0.8}
                />
            </mesh>

            {/* Y Axis - Green circle (XZ plane) */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[torusRadius, tubeRadius, 16, 64]} />
                <meshBasicMaterial
                    color={hoveredAxis === 'y' ? '#60ff60' : '#00ff00'}
                    transparent
                    opacity={0.8}
                />
            </mesh>

            {/* Z Axis - Blue circle (XY plane) */}
            <mesh rotation={[0, 0, 0]}>
                <torusGeometry args={[torusRadius, tubeRadius, 16, 64]} />
                <meshBasicMaterial
                    color={hoveredAxis === 'z' ? '#6060ff' : '#0000ff'}
                    transparent
                    opacity={0.8}
                />
            </mesh>

            {/* Outer ring for view-aligned rotation */}
            <mesh rotation={[0, 0, 0]}>
                <torusGeometry args={[torusRadius * 1.1, tubeRadius * 0.8, 16, 64]} />
                <meshBasicMaterial
                    color={hoveredAxis === 'view' ? '#ffffff' : '#888888'}
                    transparent
                    opacity={0.5}
                />
            </mesh>
        </group>
    );
}

/**
 * Scale Gizmo - Box handles for scaling objects
 */
function ScaleGizmo({ scale, onAxisDrag, hoveredAxis, setHoveredAxis }) {
    const lineLength = 1.5 * scale;
    const lineRadius = 0.02 * scale;
    const cubeSize = 0.15 * scale;

    return (
        <group>
            {/* X Axis - Red */}
            <group>
                <mesh rotation={[0, 0, -Math.PI / 2]} position={[lineLength / 2, 0, 0]}>
                    <cylinderGeometry args={[lineRadius, lineRadius, lineLength, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'x' ? '#ff6060' : '#ff0000'} />
                </mesh>
                <mesh position={[lineLength, 0, 0]}>
                    <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
                    <meshBasicMaterial color={hoveredAxis === 'x' ? '#ff6060' : '#ff0000'} />
                </mesh>
            </group>

            {/* Y Axis - Green */}
            <group>
                <mesh position={[0, lineLength / 2, 0]}>
                    <cylinderGeometry args={[lineRadius, lineRadius, lineLength, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'y' ? '#60ff60' : '#00ff00'} />
                </mesh>
                <mesh position={[0, lineLength, 0]}>
                    <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
                    <meshBasicMaterial color={hoveredAxis === 'y' ? '#60ff60' : '#00ff00'} />
                </mesh>
            </group>

            {/* Z Axis - Blue */}
            <group>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, lineLength / 2]}>
                    <cylinderGeometry args={[lineRadius, lineRadius, lineLength, 8]} />
                    <meshBasicMaterial color={hoveredAxis === 'z' ? '#6060ff' : '#0000ff'} />
                </mesh>
                <mesh position={[0, 0, lineLength]}>
                    <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
                    <meshBasicMaterial color={hoveredAxis === 'z' ? '#6060ff' : '#0000ff'} />
                </mesh>
            </group>

            {/* Center cube for uniform scaling */}
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[cubeSize * 1.5, cubeSize * 1.5, cubeSize * 1.5]} />
                <meshBasicMaterial color={hoveredAxis === 'all' ? '#ffffff' : '#cccccc'} />
            </mesh>
        </group>
    );
}
