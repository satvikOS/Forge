import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import SceneManager from '../systems/SceneManager';
import initializeEnvironmentSystem from '../systems/EnvironmentSystem';

/**
 * Component to render a single scene object from SceneManager
 */
function SceneObject({ sceneObject, isWireframe }) {
  const meshRef = useRef();

  useEffect(() => {
    if (meshRef.current && sceneObject) {
      // Update transform from sceneObject
      meshRef.current.position.set(
        sceneObject.position.x || 0,
        sceneObject.position.y || 0,
        sceneObject.position.z || 0
      );
      meshRef.current.rotation.set(
        sceneObject.rotation.x || 0,
        sceneObject.rotation.y || 0,
        sceneObject.rotation.z || 0
      );
      meshRef.current.scale.set(
        sceneObject.scale.x || 1,
        sceneObject.scale.y || 1,
        sceneObject.scale.z || 1
      );
    }
  }, [sceneObject]);

  if (!sceneObject || !sceneObject.visible) return null;

  // Get geometry from either geometry property or userData.geometry
  const geometry = sceneObject.userData?.geometry || sceneObject.geometry;
  const material = sceneObject.userData?.material || sceneObject.material;

  // Create geometry based on type
  let geometryElement = null;
  if (geometry) {
    switch (geometry.type) {
      case 'box':
        geometryElement = (
          <boxGeometry args={[
            geometry.width || 1,
            geometry.height || 1,
            geometry.depth || 1
          ]} />
        );
        break;
      case 'sphere':
        geometryElement = <sphereGeometry args={[geometry.radius || 0.5, 32, 32]} />;
        break;
      case 'cylinder':
        geometryElement = (
          <cylinderGeometry args={[
            geometry.radiusTop || 0.5,
            geometry.radiusBottom || 0.5,
            geometry.height || 1,
            32
          ]} />
        );
        break;
      case 'plane':
        geometryElement = (
          <planeGeometry args={[geometry.width || 1, geometry.height || 1]} />
        );
        break;
      default:
        // Default to a box if geometry type is unknown or environment asset
        geometryElement = <boxGeometry args={[
          geometry.width || 10,
          geometry.height || 10,
          geometry.depth || 10
        ]} />;
    }
  } else {
    // Fallback for objects without geometry
    geometryElement = <boxGeometry args={[5, 5, 5]} />;
  }

  // Material properties
  const materialColor = material?.color || '#4a90e2';

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {geometryElement}
      <meshStandardMaterial
        color={materialColor}
        wireframe={isWireframe}
        metalness={material?.metalness || 0.1}
        roughness={material?.roughness || 0.7}
      />
    </mesh>
  );
}

/**
 * Component to render all objects from SceneManager
 */
function SceneRenderer({ sceneManager, isWireframe, modelData }) {
  const [sceneObjects, setSceneObjects] = useState([]);
  const [updateCounter, setUpdateCounter] = useState(0);

  // Re-render when modelData changes (scene is updated)
  useEffect(() => {
    if (modelData) {
      setUpdateCounter(prev => prev + 1);
    }
  }, [modelData]);

  // Update scene objects from SceneManager
  useEffect(() => {
    if (sceneManager) {
      const objects = sceneManager.getAllObjects();
      console.log(`🎭 Rendering ${objects.length} scene objects`);
      setSceneObjects(objects);
    }
  }, [sceneManager, updateCounter]);

  return (
    <>
      {sceneObjects.map((obj) => (
        <SceneObject key={obj.id} sceneObject={obj} isWireframe={isWireframe} />
      ))}
    </>
  );
}

/**
 * AdvancedWorkbench - 3D viewer and editor with SceneManager integration
 * Handles scene management, environment system, and AI-generated model display
 */
export default function AdvancedWorkbench({ activeTool, onToolChange, viewMode, modelData, onSceneUpdate }) {
  const sceneManagerRef = useRef(null);
  const environmentSystemRef = useRef(null);
  const [initialized, setInitialized] = useState(false);

  // Initialize SceneManager and EnvironmentSystem once
  useEffect(() => {
    if (!sceneManagerRef.current) {
      sceneManagerRef.current = new SceneManager();
      environmentSystemRef.current = initializeEnvironmentSystem(sceneManagerRef.current);
      setInitialized(true);

      // Notify parent component about scene manager initialization
      if (onSceneUpdate) {
        onSceneUpdate({
          sceneManager: sceneManagerRef.current,
          environmentSystem: environmentSystemRef.current,
          selectedCount: 0,
          totalObjects: 0,
        });
      }

      console.log('✅ AdvancedWorkbench: SceneManager and EnvironmentSystem initialized');
    }
  }, [onSceneUpdate]);

  // Handle modelData updates (AI-generated models)
  useEffect(() => {
    if (!modelData || !sceneManagerRef.current || !initialized) return;

    console.log('📦 AdvancedWorkbench: Processing modelData', modelData);

    // Update scene info after model is processed
    if (onSceneUpdate) {
      onSceneUpdate({
        sceneManager: sceneManagerRef.current,
        environmentSystem: environmentSystemRef.current,
        selectedCount: sceneManagerRef.current.selectedObjects.size,
        totalObjects: sceneManagerRef.current.objects.size,
      });
    }
  }, [modelData, initialized, onSceneUpdate]);

  const isWireframe = viewMode === 'wireframe';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      <Canvas shadows>
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[50, 50, 50]} far={10000} />
          <OrbitControls 
            enableDamping 
            dampingFactor={0.05}
            makeDefault
          />
          
          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight 
            position={[10, 10, 5]} 
            intensity={1}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight position={[-10, -10, -5]} intensity={0.3} />
          <pointLight position={[0, 5, 0]} intensity={0.5} color="#ff6b35" />
          
          {/* Render scene objects from SceneManager */}
          {initialized && sceneManagerRef.current && (
            <SceneRenderer 
              sceneManager={sceneManagerRef.current}
              isWireframe={isWireframe}
              modelData={modelData}
            />
          )}
          
          {/* Grid */}
          <gridHelper 
            args={[360, 360, '#333333', '#1a1a1a']} 
            position={[0, -0.01, 0]}
          />

          {/* Axes Helper - shortened from 50 to 10 */}
          <axesHelper args={[10]} />

          {/* Gizmo */}
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewcube color="#ff6b35" hoverColor="#ff8555" />
          </GizmoHelper>
        </Suspense>
      </Canvas>
    </div>
  );
}