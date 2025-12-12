import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, GizmoHelper, GizmoViewcube, CameraControls } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import SceneManager from '../systems/SceneManager';
import initializeEnvironmentSystem from '../systems/EnvironmentSystem';
import AxelViewer from './axel/AxelViewer';
import { fitCameraToScene, normalizeAsset, calculateBoundingBox, calculateAutoScaleFactor } from '../utils/CameraTools';

/**
 * Helper function to normalize element dimensions from backend
 * Backend may return values in millimeters, we need meters for Three.js
 */
function normalizeElementDimensions(element) {
  // Check if dimensions are suspiciously large (likely in millimeters)
  const avgDimension = (
    (element.dimensions?.width || element.dimensions?.x || 1) +
    (element.dimensions?.height || element.dimensions?.y || 1) +
    (element.dimensions?.depth || element.dimensions?.z || 1)
  ) / 3;

  // If average dimension > 100, assume millimeters and convert to meters
  const scale = avgDimension > 100 ? 0.001 : 1;

  return {
    width: (element.dimensions?.width || element.dimensions?.x || 1) * scale,
    height: (element.dimensions?.height || element.dimensions?.y || 1) * scale,
    depth: (element.dimensions?.depth || element.dimensions?.z || 1) * scale,
    position: {
      x: (element.position?.x || 0) * scale,
      y: (element.position?.y || 0) * scale,
      z: (element.position?.z || 0) * scale
    },
    radius: element.radius ? element.radius * scale : undefined,
    radiusTop: element.radiusTop ? element.radiusTop * scale : undefined,
    radiusBottom: element.radiusBottom ? element.radiusBottom * scale : undefined
  };
}


/**
 * Component to render a single scene object from SceneManager
 */
function SceneObject({ sceneObject, isWireframe }) {
  const meshRef = useRef();
  const prevPositionRef = useRef({ x: 0, y: 0, z: 0 });
  const prevRotationRef = useRef({ x: 0, y: 0, z: 0 });
  const prevScaleRef = useRef({ x: 1, y: 1, z: 1 });

  useEffect(() => {
    if (meshRef.current && sceneObject) {
      const pos = sceneObject.position;
      const rot = sceneObject.rotation;
      const scale = sceneObject.scale;

      // Only update if values actually changed
      if (pos.x !== prevPositionRef.current.x || pos.y !== prevPositionRef.current.y || pos.z !== prevPositionRef.current.z) {
        meshRef.current.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
        prevPositionRef.current = { ...pos };
      }

      if (rot.x !== prevRotationRef.current.x || rot.y !== prevRotationRef.current.y || rot.z !== prevRotationRef.current.z) {
        meshRef.current.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        prevRotationRef.current = { ...rot };
      }

      if (scale.x !== prevScaleRef.current.x || scale.y !== prevScaleRef.current.y || scale.z !== prevScaleRef.current.z) {
        meshRef.current.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
        prevScaleRef.current = { ...scale };
      }
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
      case 'landmark': // Custom type for landmarks
        geometryElement = (
          <boxGeometry args={[
            geometry.dimensions?.x || 10,
            geometry.dimensions?.y || 50,
            geometry.dimensions?.z || 10
          ]} />
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
function SceneRenderer({ sceneManager, isWireframe, modelData, refreshTrigger }) {
  const [sceneObjects, setSceneObjects] = useState([]);
  const prevObjectCountRef = useRef(0);

  // Update scene objects from SceneManager only when object count changes or refreshTrigger changes
  useEffect(() => {
    if (sceneManager) {
      const objects = sceneManager.getAllObjects();
      const currentCount = objects.length;

      // Only update if object count changed or it's the initial render
      if (currentCount !== prevObjectCountRef.current) {
        console.log(`🎭 Rendering ${currentCount} scene objects`);
        setSceneObjects(objects);
        prevObjectCountRef.current = currentCount;
      }
    }
  }, [sceneManager, modelData, refreshTrigger]);

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
  const [sceneRefreshTrigger, setSceneRefreshTrigger] = useState(0); // Trigger re-render of scene
  const processedModelIdsRef = useRef(new Set()); // Track processed model IDs to prevent infinite loops


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

    // Generate a unique ID for this modelData if it doesn't have one
    const modelId = modelData.id || modelData.designId || JSON.stringify(modelData).substring(0, 100);

    // Skip if we've already processed this exact modelData
    if (processedModelIdsRef.current.has(modelId)) {
      return;
    }

    console.log('📦 AdvancedWorkbench: Processing modelData', modelData);
    processedModelIdsRef.current.add(modelId);

    // 🧹 Clear previous generated objects when loading new variant/design
    const existingGenerated = sceneManagerRef.current.getAllObjects()
      .filter(obj => obj.type === 'generated');

    if (existingGenerated.length > 0) {
      console.log(`🧹 Clearing ${existingGenerated.length} previous generated objects`);
      existingGenerated.forEach(obj => {
        sceneManagerRef.current.removeObject(obj.id);
      });
    }

    // Process and add modelData to scene
    try {
      if (modelData.geometry) {
        const geom = modelData.geometry;

        // Handle different geometry types
        if (geom.type === 'unified_landmark' && geom.unifiedMesh) {
          // Unified landmark - single object with internal subcomponents (DO NOT instance subcomponents)
          console.log(`🏛️ Adding unified landmark as single object (${geom.subcomponents?.length || 0} internal parts)`);
          const sceneObject = {
            id: `model_${Date.now()}_landmark`,
            name: modelData.name || 'Landmark Structure',
            type: 'generated',
            position: geom.position || { x: 0, y: 0, z: 0 },
            rotation: geom.rotation || { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            visible: true,
            userData: {
              geometry: {
                type: 'landmark',  // Custom type for landmarks
                landmarkType: geom.landmarkType || 'tower',
                dimensions: geom.dimensions || { x: 10, y: 50, z: 10 },
                // Store subcomponents as metadata, don't render separately
                subcomponents: geom.subcomponents,
                partCount: geom.metadata?.partCount || 0
              },
              material: modelData.material || geom.material || { color: '#8b7355' }, // Bronze/steel color
              prompt: modelData.prompt,
              isLandmark: true
            }
          };
          sceneManagerRef.current.addObject(sceneObject);
          console.log(`✅ Added unified landmark as 1 object`);
          setSceneRefreshTrigger(prev => prev + 1);

        } else if (geom.type === 'composite' && geom.parts) {
          // Composite geometry with multiple parts - add each part as separate object
          console.log(`📦 Adding composite geometry with ${geom.parts.length} parts`);
          geom.parts.forEach((part, index) => {
            // Normalize part dimensions
            const normalized = normalizeElementDimensions({
              dimensions: part.dimensions || { x: 10, y: 10, z: 10 },
              position: part.position || { x: 0, y: 0, z: 0 },
              radius: part.radius,
              radiusTop: part.radiusTop,
              radiusBottom: part.radiusBottom
            });

            const sceneObject = {
              id: `model_${Date.now()}_part_${index}`,
              name: `${modelData.name || 'Generated Model'} - Part ${index + 1}`,
              type: 'generated',
              position: normalized.position,
              rotation: part.rotation || { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              visible: true,
              userData: {
                geometry: {
                  type: part.type || 'box',
                  width: normalized.width,
                  height: normalized.height,
                  depth: normalized.depth,
                  radius: normalized.radius,
                  radiusTop: normalized.radiusTop,
                  radiusBottom: normalized.radiusBottom
                },
                material: part.material || modelData.material || { color: '#4a90e2' },
                prompt: modelData.prompt
              }
            };
            sceneManagerRef.current.addObject(sceneObject);
          });
          console.log(`✅ Added ${geom.parts.length} parts to scene`);
          setSceneRefreshTrigger(prev => prev + 1);

        } else if ((geom.type === 'scene' || geom.type === 'taxonomy_scene') && (geom.meshes || geom.instances)) {
          // Detailed scene handling handling logic
          if (geom.instances && geom.instances.length > 0) {
            geom.instances.forEach((instance, instanceIndex) => {
              const meshDef = instance.mesh;
              const positions = instance.positions || [{ x: 0, y: 0, z: 0 }];
              positions.forEach((pos, posIndex) => {
                // Normalize mesh dimensions
                const normalized = normalizeElementDimensions({
                  dimensions: meshDef.dimensions || { x: 10, y: 10, z: 10 },
                  position: pos,
                  radius: meshDef.radius
                });

                const sceneObject = {
                  id: `model_${Date.now()}_inst_${instanceIndex}_${posIndex}`,
                  name: `${modelData.name} - Inst ${instanceIndex}.${posIndex}`,
                  type: 'generated',
                  position: normalized.position,
                  rotation: meshDef.rotation || { x: 0, y: 0, z: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                  visible: true,
                  userData: {
                    geometry: {
                      type: meshDef.type || 'box',
                      width: normalized.width,
                      height: normalized.height,
                      depth: normalized.depth,
                      radius: normalized.radius
                    },
                    material: meshDef.material || modelData.material || { color: '#4a90e2' },
                    prompt: modelData.prompt
                  }
                };
                sceneManagerRef.current.addObject(sceneObject);
              });
            });
            setSceneRefreshTrigger(prev => prev + 1);
          } else if (geom.meshes && geom.meshes.length > 0) {
            geom.meshes.forEach((mesh, index) => {
              // Normalize mesh dimensions
              const normalized = normalizeElementDimensions({
                dimensions: mesh.dimensions || { x: 10, y: 10, z: 10 },
                position: mesh.position || { x: 0, y: 0, z: 0 },
                radius: mesh.radius
              });

              const sceneObject = {
                id: `model_${Date.now()}_mesh_${index}`,
                name: mesh.name || `Mesh ${index}`,
                type: 'generated',
                position: normalized.position,
                rotation: mesh.rotation || { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                visible: true,
                userData: {
                  geometry: {
                    type: mesh.type || 'box',
                    width: normalized.width,
                    height: normalized.height,
                    depth: normalized.depth,
                    radius: normalized.radius
                  },
                  material: mesh.material || modelData.material || { color: '#4a90e2' },
                  prompt: modelData.prompt
                }
              };
              sceneManagerRef.current.addObject(sceneObject);
            });
            setSceneRefreshTrigger(prev => prev + 1);
          }
        } else if (modelData.elements && modelData.elements.length > 0) {
          // Handle raw elements array (e.g. from Backend Fallback)
          console.log(`🧩 Processing ${modelData.elements.length} raw elements from modelData`);
          modelData.elements.forEach((element, index) => {
            // Use normalization helper instead of hardcoded scale
            const normalized = normalizeElementDimensions(element);

            const sceneObject = {
              id: `model_${Date.now()}_elem_${index}`,
              name: element.name || `Element ${index}`,
              type: 'generated',
              position: normalized.position,
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              visible: true,
              userData: {
                geometry: {
                  type: element.type || 'box',
                  width: normalized.width,
                  height: normalized.height,
                  depth: normalized.depth,
                  radius: normalized.radius || normalized.width / 2,
                  radiusTop: normalized.radiusTop || (element.type === 'cone' ? 0 : normalized.width / 2),
                  radiusBottom: normalized.radiusBottom || normalized.width / 2
                },
                material: typeof element.material === 'string'
                  ? { name: element.material, color: '#888888' }
                  : (element.material || { color: '#cccccc' }),
                prompt: modelData.prompt
              }
            };
            sceneManagerRef.current.addObject(sceneObject);
          });
          console.log(`✅ Added ${modelData.elements.length} elements to scene`);
          setSceneRefreshTrigger(prev => prev + 1);

        } else {
          // Simple geometry fallback - CHANGED FROM BOX TO CONE TO AVOID "THE CUBE"
          const sceneObject = {
            id: `model_${Date.now()}`,
            name: modelData.name || 'Generated Model',
            type: 'generated',
            position: modelData.position || { x: 0, y: 0, z: 0 },
            rotation: modelData.rotation || { x: 0, y: 0, z: 0 },
            scale: modelData.scale || { x: 1, y: 1, z: 1 },
            visible: true,
            userData: {
              geometry: {
                type: geom.type || 'cone', // FORCE CONE instead of box
                width: geom.dimensions?.x || geom.width || 10,
                height: geom.dimensions?.y || geom.height || 20, // Taller
                depth: geom.dimensions?.z || geom.depth || 10,
                radius: geom.radius || 10
              },
              material: modelData.material || { color: '#ff6b35' }, // Orange warning color
              prompt: modelData.prompt
            }
          };
          sceneManagerRef.current.addObject(sceneObject);
          console.log('✅ Added generated model to scene (Fallback Cone)');
          setSceneRefreshTrigger(prev => prev + 1);
        }
      } else if (modelData.elements && modelData.elements.length > 0) {
        // TOP-LEVEL ELEMENTS HANDLING: For variants/fallbacks that have no geometry but have elements
        console.log(`🧩 TOP-LEVEL: Processing ${modelData.elements.length} elements from modelData (no geometry present)`);
        modelData.elements.forEach((element, index) => {
          // Use normalization helper
          const normalized = normalizeElementDimensions(element);

          const sceneObject = {
            id: `model_${Date.now()}_topelem_${index}`,
            name: element.name || `Element ${index}`,
            type: 'generated',
            position: normalized.position,
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            visible: true,
            userData: {
              geometry: {
                type: element.type || 'box',
                width: normalized.width,
                height: normalized.height,
                depth: normalized.depth,
                radius: normalized.radius || normalized.width / 2,
                radiusTop: normalized.radiusTop || (element.type === 'cone' ? 0 : normalized.width / 2),
                radiusBottom: normalized.radiusBottom || normalized.width / 2
              },
              material: typeof element.material === 'string'
                ? { name: element.material, color: '#888888' }
                : (element.material || { color: '#cccccc' }),
              prompt: modelData.prompt
            }
          };
          sceneManagerRef.current.addObject(sceneObject);
        });
        console.log(`✅ TOP-LEVEL: Added ${modelData.elements.length} elements to scene`);
        setSceneRefreshTrigger(prev => prev + 1);
      } else {
        console.warn('⚠️ ModelData has no geometry, elements, or recognized type:', modelData);
      }
    } catch (error) {
      console.error('❌ Error processing modelData:', error);
    }

    if (onSceneUpdate) {
      onSceneUpdate({
        sceneManager: sceneManagerRef.current,
        environmentSystem: environmentSystemRef.current,
        selectedCount: sceneManagerRef.current.selectedObjects.size,
        totalObjects: sceneManagerRef.current.objects.size,
      });
    }
  }, [modelData, initialized]);

  const isWireframe = viewMode === 'wireframe';
  const cameraControlsRef = useRef(null);

  // Auto-fit camera when modelData changes (EVERY TIME, not just once)
  useEffect(() => {
    if (!cameraControlsRef.current || !sceneManagerRef.current || !initialized) return;

    const objects = sceneManagerRef.current.getAllObjects();
    if (objects.length === 0) return;

    // Filter out fallback models from bounds calculation
    const realObjects = objects.filter(obj => {
      const isFallback = obj.userData?.isFallback ||
        obj.userData?.metadata?.fallback ||
        obj.userData?.metadata?.isFallback;
      return !isFallback;
    });

    const objectsToFit = realObjects.length > 0 ? realObjects : objects;
    if (realObjects.length === 0 && objects.length > 0) {
      console.warn('⚠️  Only fallback models detected - camera may not be optimal');
    }

    // Use CameraTools to fit camera to scene
    try {
      const camera = cameraControlsRef.current.camera || cameraControlsRef.current;
      fitCameraToScene(camera, cameraControlsRef.current, objectsToFit, 1.2);
    } catch (error) {
      console.error('❌ Error fitting camera to scene:', error);
    }
  }, [modelData, sceneRefreshTrigger, initialized]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      <Canvas shadows frameloop="demand">
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[50, 50, 50]} far={10000} />
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
          {
            initialized && sceneManagerRef.current && (
              <SceneRenderer
                sceneManager={sceneManagerRef.current}
                isWireframe={isWireframe}
                modelData={modelData}
                refreshTrigger={sceneRefreshTrigger}
              />
            )
          }

          {/* Camera Controls with automatic fitting and smooth dampening */}
          <CameraControls
            ref={cameraControlsRef}
            makeDefault
            minDistance={2}
            maxDistance={1000}
            dollyToCursor={true}
            // Smooth dampening for better UX
            smoothTime={0.5}
            draggingSmoothTime={0.3}
            // Reduced sensitivity for easier control
            azimuthRotateSpeed={0.5}
            polarRotateSpeed={0.5}
            truckSpeed={2}
            dollySpeed={1}
            mouseButtons={{
              left: 1,    // CameraControls.ACTION.ROTATE
              middle: 0,  // CameraControls.ACTION.NONE
              right: 2,   // CameraControls.ACTION.TRUCK (pan)
              wheel: 16   // CameraControls.ACTION.DOLLY (zoom)
            }}
          />

          {/* Grid - sized appropriately for typical models (200x200 = 200% increase) */}
          <gridHelper
            args={[200, 200, '#333333', '#1a1a1a']}
            position={[0, -0.01, 0]}
          />

          {/* Axes Helper */}
          <axesHelper args={[5]} />

          {/* Gizmo */}
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewcube color="#ff6b35" hoverColor="#ff8555" />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* Axel Analysis Overlay */}
      {modelData && modelData.axelAnalysis && (
        <div style={{
          position: 'absolute',
          right: '20px',
          top: '20px',
          width: '320px',
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          zIndex: 10,
          pointerEvents: 'none' // Allow clicking through container
        }}>
          <div style={{ pointerEvents: 'auto' }}>
            <AxelViewer axelData={modelData.axelAnalysis} />
          </div>
        </div>
      )}
    </div>
  );
}