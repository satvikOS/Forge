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
          console.log(`✅ Added unified landmark as 1 object (not ${geom.subcomponents?.length || 0} separate instances)`);
          
          // Force scene re-render after adding object
          setSceneRefreshTrigger(prev => prev + 1);
        } else if (geom.type === 'composite' && geom.parts) {
          // Composite geometry with multiple parts - add each part as separate object
          console.log(`📦 Adding composite geometry with ${geom.parts.length} parts`);
          geom.parts.forEach((part, index) => {
            const sceneObject = {
              id: `model_${Date.now()}_part_${index}`,
              name: `${modelData.name || 'Generated Model'} - Part ${index + 1}`,
              type: 'generated',
              position: part.position || { x: 0, y: 0, z: 0 },
              rotation: part.rotation || { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              visible: true,
              userData: {
                geometry: {
                  type: part.type || 'box',
                  width: part.dimensions?.x || 10,
                  height: part.dimensions?.y || 10,
                  depth: part.dimensions?.z || 10,
                  radius: part.radius,
                  radiusTop: part.radiusTop,
                  radiusBottom: part.radiusBottom
                },
                material: part.material || modelData.material || { color: '#4a90e2' },
                prompt: modelData.prompt
              }
            };
            sceneManagerRef.current.addObject(sceneObject);
          });
          console.log(`✅ Added ${geom.parts.length} parts to scene`);
          
          // Force scene re-render after adding all objects
          setSceneRefreshTrigger(prev => prev + 1);
        } else if ((geom.type === 'scene' || geom.type === 'taxonomy_scene') && (geom.meshes || geom.instances)) {
          // Scene with multiple meshes (handles both 'scene' and 'taxonomy_scene' types)
          
          // Check for instances array (instanced rendering - one mesh, multiple positions)
          if (geom.instances && geom.instances.length > 0) {
            console.log(`📦 Adding ${geom.type} geometry with ${geom.instances.length} instance groups`);
            let totalObjectsAdded = 0;
            
            geom.instances.forEach((instance, instanceIndex) => {
              const meshDef = instance.mesh;
              const positions = instance.positions || [{ x: 0, y: 0, z: 0 }];
              
              // Create a scene object for each position
              positions.forEach((pos, posIndex) => {
                const sceneObject = {
                  id: `model_${Date.now()}_inst_${instanceIndex}_${posIndex}`,
                  name: `${modelData.name || 'Generated Model'} - Instance ${instanceIndex + 1}.${posIndex + 1}`,
                  type: 'generated',
                  position: {
                    x: (pos.x || 0) / 1000, // Convert from mm to meters
                    y: (pos.y || 0) / 1000,
                    z: (pos.z || 0) / 1000
                  },
                  rotation: meshDef.rotation || { x: 0, y: 0, z: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                  visible: true,
                  userData: {
                    geometry: {
                      type: meshDef.type || 'box',
                      width: (meshDef.dimensions?.x || 10) / 1000,  // Convert mm to meters
                      height: (meshDef.dimensions?.y || 10) / 1000,
                      depth: (meshDef.dimensions?.z || 10) / 1000,
                      radius: meshDef.radius ? meshDef.radius / 1000 : undefined
                    },
                    material: meshDef.material || modelData.material || { color: '#4a90e2' },
                    prompt: modelData.prompt
                  }
                };
                sceneManagerRef.current.addObject(sceneObject);
                totalObjectsAdded++;
              });
            });
            
            console.log(`✅ Added ${totalObjectsAdded} instanced objects to scene`);
            
            // Force scene re-render after adding all objects
            setSceneRefreshTrigger(prev => prev + 1);
          }
          // Check for meshes array (traditional - separate mesh definitions)
          else if (geom.meshes && geom.meshes.length > 0) {
            console.log(`📦 Adding ${geom.type} geometry with ${geom.meshes.length} meshes`);
            geom.meshes.forEach((mesh, index) => {
              const sceneObject = {
                id: `model_${Date.now()}_mesh_${index}`,
                name: mesh.name || `${modelData.name || 'Generated Model'} - Mesh ${index + 1}`,
                type: 'generated',
                position: mesh.position || { x: 0, y: 0, z: 0 },
                rotation: mesh.rotation || { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                visible: true,
                userData: {
                  geometry: {
                    type: mesh.type || 'box',
                    width: mesh.dimensions?.x || 10,
                    height: mesh.dimensions?.y || 10,
                    depth: mesh.dimensions?.z || 10,
                    radius: mesh.radius
                  },
                  material: mesh.material || modelData.material || { color: '#4a90e2' },
                  prompt: modelData.prompt
                }
              };
              sceneManagerRef.current.addObject(sceneObject);
            });
            console.log(`✅ Added ${geom.meshes.length} meshes to scene`);
            
            // Force scene re-render after adding all objects
            setSceneRefreshTrigger(prev => prev + 1);
          }
          // Both empty - create placeholder
          else {
            console.warn('⚠️ Empty meshes and instances arrays - creating default placeholder object');
            console.log('ModelData for debugging:', JSON.stringify(modelData, null, 2));
            
            const sceneObject = {
              id: `model_${Date.now()}_placeholder`,
              name: modelData.name || 'Generated Model (Placeholder)',
              type: 'generated',
              position: { x: 0, y: 5, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              visible: true,
              userData: {
                geometry: {
                  type: 'box',
                  width: 20,
                  height: 20,
                  depth: 20
                },
                material: { color: '#ff6b35' }, // Orange to indicate placeholder
                prompt: modelData.prompt
              }
            };
            sceneManagerRef.current.addObject(sceneObject);
            console.log('✅ Added placeholder object (backend returned empty arrays)');
            
            // Force scene re-render
            setSceneRefreshTrigger(prev => prev + 1);
          }
        } else {
          // Simple geometry - add as single object
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
                type: geom.type || 'box',
                width: geom.dimensions?.x || geom.width || 10,
                height: geom.dimensions?.y || geom.height || 10,
                depth: geom.dimensions?.z || geom.depth || 10,
                radius: geom.radius
              },
              material: modelData.material || { color: '#4a90e2' },
              prompt: modelData.prompt
            }
          };
          
          sceneManagerRef.current.addObject(sceneObject);
          console.log('✅ Added generated model to scene');
          
          // Force scene re-render
          setSceneRefreshTrigger(prev => prev + 1);
        }
      } else if (modelData.sceneType === 'environment_composition') {
        // Environment composition already added objects via SceneComposer
        console.log('✅ Environment composition scene already populated');
      } else {
        console.warn('⚠️ ModelData has no geometry or recognized type:', modelData);
      }
    } catch (error) {
      console.error('❌ Error processing modelData:', error);
    }

    // Update scene info after model is processed
    if (onSceneUpdate) {
      onSceneUpdate({
        sceneManager: sceneManagerRef.current,
        environmentSystem: environmentSystemRef.current,
        selectedCount: sceneManagerRef.current.selectedObjects.size,
        totalObjects: sceneManagerRef.current.objects.size,
      });
    }
  }, [modelData, initialized]); // Remove onSceneUpdate from dependencies to prevent recreation loops

  const isWireframe = viewMode === 'wireframe';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg-primary)' }}>
      <Canvas shadows frameloop="demand">
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
              refreshTrigger={sceneRefreshTrigger}
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