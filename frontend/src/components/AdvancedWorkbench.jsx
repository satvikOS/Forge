/**
 * Advanced 3D Workbench - Full-featured 3D editor with tool integration
 */

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, GizmoHelper, GizmoViewcube, Grid, TransformControls } from '@react-three/drei';
import { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import ToolManager from '../systems/ToolSystem';
import SceneManager from '../systems/SceneManager';
import EnvironmentLightingSystem from '../systems/EnvironmentLightingSystem';

// Import all tools
import { SelectTool, SelectBoxTool, SelectCircleTool, SelectAllTool, InvertSelectionTool } from '../tools/SelectionTools';
import { MoveTool, RotateTool, ScaleTool } from '../tools/TransformTools';
import {
  AddCubeTool, AddSphereTool, AddCylinderTool, AddConeTool, AddPlaneTool,
  AddTorusTool, AddIcoSphereTool, AddCircleTool, AddGridTool,
  AddPointLightTool, AddDirectionalLightTool, AddSpotLightTool, AddAreaLightTool,
  AddCameraTool
} from '../tools/PrimitiveTools';
import {
  ExtrudeTool, PushPullTool, BevelTool, SubdivideTool,
  DuplicateTool, DeleteTool, MirrorTool
} from '../tools/ModelingTools';
import { LineTool, RectangleTool, CircleTool, PolygonTool } from '../tools/DrawingTools';
import { TapeMeasureTool, ProtractorTool, DimensionTool, AreaCalculatorTool, VolumeCalculatorTool } from '../tools/MeasurementTools';
import { TopViewTool, FrontViewTool, SideViewTool, PerspectiveViewTool, FocusSelectionTool, FrameAllTool } from '../tools/CameraTools';
import { initializeEnvironmentSystem } from '../systems/EnvironmentSystem';

// Camera Auto-Framer - Automatically frames all objects when scene changes
function CameraAutoFramer({ sceneManager, enabled = true }) {
  const { camera, controls } = useThree();
  const lastObjectCountRef = useRef(0);
  
  useFrame(() => {
    if (!enabled || !sceneManager || !camera || !controls) return;
    
    const currentObjectCount = sceneManager.objects.size;
    
    // Only frame if object count changed (new objects added)
    if (currentObjectCount !== lastObjectCountRef.current && currentObjectCount > 0) {
      lastObjectCountRef.current = currentObjectCount;
      
      // Calculate bounding box of all objects
      const allObjects = sceneManager.getAllObjects();
      if (allObjects.length === 0) return;
      
      // Calculate bounds
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      
      allObjects.forEach(obj => {
        const pos = obj.position;
        const scale = obj.scale;
        
        // Estimate object bounds (rough approximation)
        const halfWidth = (scale.x || 1) * 5;
        const halfHeight = (scale.y || 1) * 5;
        const halfDepth = (scale.z || 1) * 5;
        
        minX = Math.min(minX, pos.x - halfWidth);
        minY = Math.min(minY, pos.y - halfHeight);
        minZ = Math.min(minZ, pos.z - halfDepth);
        maxX = Math.max(maxX, pos.x + halfWidth);
        maxY = Math.max(maxY, pos.y + halfHeight);
        maxZ = Math.max(maxZ, pos.z + halfDepth);
      });
      
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;
      
      const sizeX = maxX - minX;
      const sizeY = maxY - minY;
      const sizeZ = maxZ - minZ;
      const maxDim = Math.max(sizeX, sizeY, sizeZ);
      
      // Calculate optimal camera distance
      const fov = camera.fov || 50;
      const distance = maxDim / (2 * Math.tan((fov * Math.PI) / 360)) * 1.5; // 1.5x for padding
      
      // Position camera at an angle to see the scene
      const angle = Math.PI / 4; // 45 degrees
      const cameraX = centerX + distance * Math.cos(angle);
      const cameraY = centerY + distance * 0.5; // Elevated view
      const cameraZ = centerZ + distance * Math.sin(angle);
      
      camera.position.set(cameraX, cameraY, cameraZ);
      camera.lookAt(centerX, centerY, centerZ);
      
      if (controls && controls.target) {
        controls.target.set(centerX, centerY, centerZ);
        controls.update();
      }
      
      console.log('📷 Auto-framed camera to view', currentObjectCount, 'objects');
      console.log('  Scene bounds:', { sizeX, sizeY, sizeZ, maxDim });
      console.log('  Camera position:', { x: cameraX, y: cameraY, z: cameraZ });
      console.log('  Looking at:', { x: centerX, y: centerY, z: centerZ });
    }
  });
  
  return null;
}

// Environment Lighting Component - Handles HDRI and dynamic lighting
function EnvironmentLighting({ environmentConfig }) {
  const { scene, gl } = useThree();
  const lightingSystemRef = useRef(null);

  // Initialize lighting system
  useEffect(() => {
    if (!lightingSystemRef.current) {
      lightingSystemRef.current = new EnvironmentLightingSystem(scene, gl);
      console.log('✅ Environment Lighting System initialized in scene');
    }

    return () => {
      if (lightingSystemRef.current) {
        lightingSystemRef.current.dispose();
        lightingSystemRef.current = null;
      }
    };
  }, [scene, gl]);

  // Apply environment configuration when it changes
  useEffect(() => {
    if (!lightingSystemRef.current || !environmentConfig) return;

    console.log('🌅 Applying environment configuration:', environmentConfig);

    const { hdri, lighting, timeOfDay, weather } = environmentConfig;

    // Setup HDRI if available
    if (hdri && hdri.url) {
      lightingSystemRef.current.setupEnvironment(
        hdri.url,
        hdri.intensity || 1.0,
        hdri.blur || 0.0
      ).catch(error => {
        console.warn('Failed to setup HDRI, using fallback lighting');
      });
    } else {
      lightingSystemRef.current.setupFallbackEnvironment();
    }

    // Update time of day lighting
    if (timeOfDay) {
      lightingSystemRef.current.updateTimeOfDay(timeOfDay);
    }

    // Apply weather effects
    if (weather) {
      lightingSystemRef.current.setWeatherEffects(weather);
    }
  }, [environmentConfig]);

  return null;
}
  });
  
  return null;
}

// Scene Object Renderer - Renders objects from the scene manager
function SceneObject({ sceneObject, isSelected, onSelect }) {
  const meshRef = useRef();
  const groupRef = useRef();
  const [hovered, setHovered] = useState(false);

  // Check if this is an environment asset
  const isEnvironmentAsset = sceneObject.geometry.type === 'environment';

  // For environment assets, render from userData
  if (isEnvironmentAsset && sceneObject.userData) {
    // Handle Three.js Group objects (complex assets like trees, buildings)
    if (sceneObject.userData.group) {
      return (
        <primitive
          ref={groupRef}
          object={sceneObject.userData.group}
          position={[sceneObject.position.x, sceneObject.position.y, sceneObject.position.z]}
          rotation={[sceneObject.rotation.x, sceneObject.rotation.y, sceneObject.rotation.z]}
          scale={[sceneObject.scale.x, sceneObject.scale.y, sceneObject.scale.z]}
          visible={sceneObject.visible}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(sceneObject.id);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        />
      );
    }

    // Handle simple geometry + material
    if (sceneObject.userData.geometry && sceneObject.userData.material) {
      return (
        <mesh
          ref={meshRef}
          geometry={sceneObject.userData.geometry}
          material={sceneObject.userData.material}
          position={[sceneObject.position.x, sceneObject.position.y, sceneObject.position.z]}
          rotation={[sceneObject.rotation.x, sceneObject.rotation.y, sceneObject.rotation.z]}
          scale={[sceneObject.scale.x, sceneObject.scale.y, sceneObject.scale.z]}
          visible={sceneObject.visible}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(sceneObject.id);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        />
      );
    }
  }

  // Create Three.js geometry based on scene object type (original primitives)
  const geometry = useMemo(() => {
    const geom = sceneObject.geometry;
    
    switch (geom.type) {
      case 'box':
        return new THREE.BoxGeometry(
          geom.width || 1,
          geom.height || 1,
          geom.depth || 1
        );
      case 'sphere':
        return new THREE.SphereGeometry(
          geom.radius || 0.5,
          geom.widthSegments || 32,
          geom.heightSegments || 16
        );
      case 'cylinder':
        return new THREE.CylinderGeometry(
          geom.radiusTop || 0.5,
          geom.radiusBottom || 0.5,
          geom.height || 1,
          geom.radialSegments || 32
        );
      case 'cone':
        return new THREE.ConeGeometry(
          geom.radius || 0.5,
          geom.height || 1,
          geom.radialSegments || 32
        );
      case 'plane':
        return new THREE.PlaneGeometry(
          geom.width || 1,
          geom.height || 1
        );
      case 'torus':
        return new THREE.TorusGeometry(
          geom.radius || 0.5,
          geom.tube || 0.2,
          geom.radialSegments || 16,
          geom.tubularSegments || 100
        );
      case 'icosphere':
        return new THREE.IcosahedronGeometry(
          geom.radius || 0.5,
          geom.detail || 2
        );
      case 'circle':
        return new THREE.CircleGeometry(
          geom.radius || 0.5,
          geom.segments || 32
        );
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [sceneObject.geometry]);

  // Update position, rotation, scale when object changes
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.set(
        sceneObject.position.x,
        sceneObject.position.y,
        sceneObject.position.z
      );
      meshRef.current.rotation.set(
        sceneObject.rotation.x,
        sceneObject.rotation.y,
        sceneObject.rotation.z
      );
      meshRef.current.scale.set(
        sceneObject.scale.x,
        sceneObject.scale.y,
        sceneObject.scale.z
      );
    }
  }, [
    sceneObject.position.x, sceneObject.position.y, sceneObject.position.z,
    sceneObject.rotation.x, sceneObject.rotation.y, sceneObject.rotation.z,
    sceneObject.scale.x, sceneObject.scale.y, sceneObject.scale.z
  ]);

  if (!sceneObject.visible) return null;

  // Check if object has PBR material with texture maps
  const hasPBRMaps = sceneObject.material?.maps && sceneObject.material.isPBR;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(sceneObject.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      userData={{ sceneObjectId: sceneObject.id }}
    >
      {hasPBRMaps ? (
        <PBRMaterial
          material={sceneObject.material}
          isSelected={isSelected}
          isHovered={hovered}
        />
      ) : (
        <meshStandardMaterial
          color={sceneObject.material.color}
          metalness={sceneObject.material.metalness || 0.3}
          roughness={sceneObject.material.roughness || 0.7}
          emissive={isSelected || hovered ? '#ff6b35' : '#000000'}
          emissiveIntensity={isSelected ? 0.3 : (hovered ? 0.2 : 0)}
          transparent={isSelected || hovered}
          opacity={isSelected ? 0.95 : (hovered ? 0.95 : 1)}
        />
      )}
    </mesh>
  );
}

// PBR Material Component - Loads and applies PBR textures
function PBRMaterial({ material, isSelected, isHovered }) {
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);
  const [textures, setTextures] = useState(null);

  useEffect(() => {
    if (!material.maps) return;

    const loadTextures = async () => {
      try {
        const loadedTextures = {};

        // Load textures concurrently
        const promises = [];
        const textureKeys = [];

        if (material.maps.albedo) {
          textureKeys.push('albedo');
          promises.push(textureLoader.loadAsync(material.maps.albedo));
        }
        if (material.maps.normal) {
          textureKeys.push('normal');
          promises.push(textureLoader.loadAsync(material.maps.normal));
        }
        if (material.maps.roughness) {
          textureKeys.push('roughness');
          promises.push(textureLoader.loadAsync(material.maps.roughness));
        }
        if (material.maps.metalness) {
          textureKeys.push('metalness');
          promises.push(textureLoader.loadAsync(material.maps.metalness));
        }
        if (material.maps.ao) {
          textureKeys.push('ao');
          promises.push(textureLoader.loadAsync(material.maps.ao));
        }

        const results = await Promise.all(promises);
        
        results.forEach((texture, index) => {
          const key = textureKeys[index];
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = 16;
          if (key === 'albedo') {
            texture.encoding = THREE.sRGBEncoding;
          }
          loadedTextures[key] = texture;
        });

        setTextures(loadedTextures);
      } catch (error) {
        console.warn('Failed to load PBR textures, using fallback:', error);
        setTextures({});
      }
    };

    loadTextures();

    return () => {
      // Cleanup textures on unmount
      if (textures) {
        Object.values(textures).forEach(texture => texture.dispose());
      }
    };
  }, [material.maps, textureLoader]);

  const materialProps = material.properties || {};

  return (
    <meshStandardMaterial
      map={textures?.albedo || null}
      normalMap={textures?.normal || null}
      normalScale={new THREE.Vector2(materialProps.normalScale || 1.0, materialProps.normalScale || 1.0)}
      roughnessMap={textures?.roughness || null}
      roughness={materialProps.roughness || 0.7}
      metalnessMap={textures?.metalness || null}
      metalness={materialProps.metalness || 0.3}
      aoMap={textures?.ao || null}
      aoMapIntensity={1.0}
      color={textures?.albedo ? '#ffffff' : (material.color || '#888888')}
      emissive={isSelected || isHovered ? '#ff6b35' : '#000000'}
      emissiveIntensity={isSelected ? 0.3 : (isHovered ? 0.2 : 0)}
      transparent={isSelected || isHovered}
      opacity={isSelected ? 0.95 : (isHovered ? 0.95 : 1)}
    />
  );
}

// Scene Renderer Component
function SceneRenderer({ sceneManager, selectedObjects, onSelect }) {
  const { scene, camera, gl, raycaster } = useThree();
  const [objectsMap, setObjectsMap] = useState(new Map());
  const objectsMapRef = useRef(new Map());

  useEffect(() => {
    // Get initial objects
    const allObjects = sceneManager.getAllObjects();
    const newMap = new Map(allObjects.map(obj => [obj.id, obj]));
    objectsMapRef.current = newMap;
    setObjectsMap(newMap);
    
    // Poll for new objects being added, but only update if count changes
    const interval = setInterval(() => {
      const currentObjects = sceneManager.getAllObjects();
      const currentCount = currentObjects.length;
      const previousCount = objectsMapRef.current.size;
      
      // Only update if object count changed (new designs added/removed)
      if (currentCount !== previousCount) {
        const newMap = new Map(currentObjects.map(obj => [obj.id, obj]));
        objectsMapRef.current = newMap;
        setObjectsMap(newMap);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [sceneManager]);

  return (
    <>
      {Array.from(objectsMap.values()).map((obj) => (
        <SceneObject
          key={obj.id}
          sceneObject={obj}
          isSelected={selectedObjects.has(obj.id)}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

// Main Advanced Workbench Component
export default function AdvancedWorkbench({ 
  onToolChange, 
  activeTool,
  viewMode = 'solid',
  modelData = null,
  onSceneUpdate 
}) {
  const canvasRef = useRef();
  const sceneManagerRef = useRef(null);
  if (!sceneManagerRef.current) {
    sceneManagerRef.current = new SceneManager();
    sceneManagerRef.current.instanceId = `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('🆕 Created NEW SceneManager instance:', sceneManagerRef.current.instanceId);
  }
  const sceneManager = sceneManagerRef.current;
  
  // Initialize environment system with sceneManager for scene composition
  const [environmentSystem] = useState(() => {
    return initializeEnvironmentSystem(sceneManager);
  });
  
  const [toolManager] = useState(() => {
    const tm = new ToolManager();
    
    // Register all selection tools
    tm.registerTool(new SelectTool());
    tm.registerTool(new SelectBoxTool());
    tm.registerTool(new SelectCircleTool());
    tm.registerTool(new SelectAllTool());
    tm.registerTool(new InvertSelectionTool());
    
    // Register transform tools
    tm.registerTool(new MoveTool());
    tm.registerTool(new RotateTool());
    tm.registerTool(new ScaleTool());
    
    // Register primitive tools
    tm.registerTool(new AddCubeTool());
    tm.registerTool(new AddSphereTool());
    tm.registerTool(new AddCylinderTool());
    tm.registerTool(new AddConeTool());
    tm.registerTool(new AddPlaneTool());
    tm.registerTool(new AddTorusTool());
    tm.registerTool(new AddIcoSphereTool());
    tm.registerTool(new AddCircleTool());
    tm.registerTool(new AddGridTool());
    tm.registerTool(new AddPointLightTool());
    tm.registerTool(new AddDirectionalLightTool());
    tm.registerTool(new AddSpotLightTool());
    tm.registerTool(new AddAreaLightTool());
    tm.registerTool(new AddCameraTool());
    
    // Register modeling tools
    tm.registerTool(new ExtrudeTool());
    tm.registerTool(new PushPullTool());
    tm.registerTool(new BevelTool());
    tm.registerTool(new SubdivideTool());
    tm.registerTool(new DuplicateTool());
    tm.registerTool(new DeleteTool());
    tm.registerTool(new MirrorTool());
    
    // Register drawing tools
    tm.registerTool(new LineTool());
    tm.registerTool(new RectangleTool());
    tm.registerTool(new CircleTool());
    tm.registerTool(new PolygonTool());
    
    // Register measurement tools
    tm.registerTool(new TapeMeasureTool());
    tm.registerTool(new ProtractorTool());
    tm.registerTool(new DimensionTool());
    tm.registerTool(new AreaCalculatorTool());
    tm.registerTool(new VolumeCalculatorTool());
    
    // Register camera tools
    tm.registerTool(new TopViewTool());
    tm.registerTool(new FrontViewTool());
    tm.registerTool(new SideViewTool());
    tm.registerTool(new PerspectiveViewTool());
    tm.registerTool(new FocusSelectionTool());
    tm.registerTool(new FrameAllTool());
    
    // Register environment tools
    environmentSystem.environmentTools.forEach(tool => {
      tm.registerTool(tool);
    });
    
    tm.setDefaultTool('select');
    return tm;
  });
  
  const [selectedObjects, setSelectedObjects] = useState(new Set());
  const [needsRender, setNeedsRender] = useState(false);
  const contextRef = useRef({});
  const lastProcessedTimestampRef = useRef(null);
  const [environmentConfig, setEnvironmentConfig] = useState(null);

  // Update context when tools or scene changes
  useEffect(() => {
    if (canvasRef.current) {
      contextRef.current = {
        canvas: canvasRef.current,
        sceneManager,
        toolManager,
        needsRender: false,
        raycaster: new THREE.Raycaster(),
        camera: null, // Will be set by Three.js
        controls: null, // Will be set by Three.js
      };
    }
  }, [sceneManager, toolManager]);

  // Activate tool when activeTool prop changes
  useEffect(() => {
    if (activeTool && contextRef.current) {
      toolManager.activateTool(activeTool, contextRef.current);
      setNeedsRender(true);
    }
  }, [activeTool, toolManager]);

  // Notify parent of environment system initialization
  useEffect(() => {
    if (onSceneUpdate && environmentSystem && sceneManager) {
      onSceneUpdate({
        selectedCount: sceneManager.selectedObjects.size,
        totalObjects: sceneManager.objects.size,
        sceneManager,
        environmentSystem,
      });
    }
  }, [environmentSystem, sceneManager, onSceneUpdate]);

  // Update selected objects display
  useEffect(() => {
    const updateSelection = () => {
      setSelectedObjects(sceneManager.selectedObjects);
    };
    
    const interval = setInterval(updateSelection, 100);
    return () => clearInterval(interval);
  }, [sceneManager]);

  // Handle object selection
  const handleObjectSelect = (objectId) => {
    sceneManager.selectObject(objectId, 'toggle');
    setSelectedObjects(new Set(sceneManager.selectedObjects));
    setNeedsRender(true);
    
    if (onSceneUpdate) {
      onSceneUpdate({
        selectedCount: sceneManager.selectedObjects.size,
        totalObjects: sceneManager.objects.size,
      });
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Tool shortcuts
      if (event.key === 's' || event.key === 'S') {
        toolManager.activateTool('select', contextRef.current);
        if (onToolChange) onToolChange('select');
      } else if (event.key === 'g' || event.key === 'G') {
        toolManager.activateTool('move', contextRef.current);
        if (onToolChange) onToolChange('move');
      } else if (event.key === 'r' || event.key === 'R') {
        toolManager.activateTool('rotate', contextRef.current);
        if (onToolChange) onToolChange('rotate');
      } else if (event.key === 'e' || event.key === 'E') {
        toolManager.activateTool('extrude', contextRef.current);
        if (onToolChange) onToolChange('extrude');
      } else if (event.key === 'a' || event.key === 'A') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          sceneManager.selectAll();
          setSelectedObjects(new Set(sceneManager.selectedObjects));
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        sceneManager.deleteSelected();
        setSelectedObjects(new Set());
        setNeedsRender(true);
      } else if (event.key === 'd' || event.key === 'D') {
        if (event.shiftKey) {
          event.preventDefault();
          sceneManager.duplicateSelected();
          setNeedsRender(true);
        }
      } else if (event.key === 'z' || event.key === 'Z') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (event.shiftKey) {
            sceneManager.redo();
          } else {
            sceneManager.undo();
          }
          setNeedsRender(true);
        }
      }
      
      // Pass event to active tool
      if (toolManager.getActiveTool()) {
        toolManager.handleEvent('keydown', event, contextRef.current);
        setNeedsRender(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toolManager, sceneManager, onToolChange]);

  // Process incoming AI model data
  // Only re-run when timestamp changes (not on every modelData object change)
  const modelDataTimestamp = modelData?.timestamp;
  
  useEffect(() => {
    if (!modelData || !sceneManager || !modelDataTimestamp) {
      console.log('Skipping model data processing - missing modelData or sceneManager');
      return;
    }
    
    // Extract environment config if provided by backend
    if (modelData.environmentConfig) {
      console.log('🌍 Setting environment configuration from modelData');
      setEnvironmentConfig(modelData.environmentConfig);
    }
    
    console.log('\n\n========================================');
    console.log('=== PROCESSING NEW MODEL DATA ===');
    console.log('========================================');
    console.log('🆔 SceneManager instance ID:', sceneManager.instanceId);
    console.log('Received model data in AdvancedWorkbench:', modelData);
    
    // Check if this is an environment composition scene (objects already added by SceneComposer)
    if (modelData.sceneType === 'environment_composition') {
      // Check if we've already processed this timestamp
      const currentTimestamp = modelData.timestamp;
      if (lastProcessedTimestampRef.current === currentTimestamp) {
        console.log('Environment composition already processed, skipping');
        return;
      }
      
      // Mark as processed using timestamp
      lastProcessedTimestampRef.current = currentTimestamp;
      
      console.log('✅ Environment composition scene - objects already in scene manager');
      console.log('📊 Current scene state:');
      console.log('  - Total objects in scene:', sceneManager.objects.size);
      console.log('  - Design groups:', sceneManager.designGroups.size);
      
      // Just trigger a render - objects are already added by SceneComposer
      setNeedsRender(true);
      
      // Notify parent component
      if (onSceneUpdate) {
        onSceneUpdate({
          selectedCount: sceneManager.selectedObjects.size,
          totalObjects: sceneManager.objects.size,
          sceneManager,
          environmentSystem,
        });
      }
      
      console.log('========================================');
      console.log('=== ENVIRONMENT COMPOSITION REFRESH COMPLETE ===');
      console.log('========================================\n\n');
      return;
    }
    
    // For backend API-generated models, check if already processed using timestamp or unique ID
    const currentTimestamp = modelData.timestamp || JSON.stringify(modelData);
    if (lastProcessedTimestampRef.current === currentTimestamp) {
      console.log('Model data already processed, skipping');
      return;
    }
    
    // Mark this modelData as processed BEFORE processing to prevent race conditions
    lastProcessedTimestampRef.current = currentTimestamp;
    
    // For backend API-generated models, process through the old path
    console.log('📊 BEFORE ADDING NEW DESIGN:');
    console.log('  - Existing designs:', sceneManager.getAllDesigns().length);
    console.log('  - Total objects in scene:', sceneManager.objects.size);
    console.log('  - Design groups:', sceneManager.designGroups.size);
    
    // List all existing designs
    const existingDesigns = sceneManager.getAllDesigns();
    if (existingDesigns.length > 0) {
      console.log('  - Existing design IDs:', existingDesigns.map(d => d.id));
      existingDesigns.forEach((design, idx) => {
        console.log(`    Design ${idx + 1}: ${design.id}, objects: ${design.objects.length}, position: (${design.position.x}, ${design.position.y}, ${design.position.z})`);
      });
    }
    
    // Import geometry converter and layout manager
    Promise.all([
      import('../utils/geometryConverter.js'),
      import('../utils/layoutManager.js')
    ]).then(([{ convertModelDataToSceneObjects }, { calculateNextPosition, calculateBounds }]) => {
      try {
        // Extract geometry from model data (backend returns { geometry: {...}, materials: [...], ... })
        const geometryData = modelData.geometry || modelData;
        console.log('📦 Extracting geometry data...');
        
        // Convert backend model data to scene objects
        const sceneObjects = convertModelDataToSceneObjects(geometryData, 'AI_Model');
        console.log(`✅ Converted ${sceneObjects.length} objects from model data`);
        
        // Check if we got any objects
        if (!sceneObjects || sceneObjects.length === 0) {
          console.error('❌ NO OBJECTS WERE CONVERTED!');
          console.error('Model data structure:', JSON.stringify(modelData, null, 2));
          return;
        }
        
        // Calculate bounds for the new design
        const newDesignBounds = calculateBounds(sceneObjects);
        console.log('📏 New design bounds:', newDesignBounds);
        
        // Get existing designs AGAIN (to be sure)
        const existingDesignsNow = sceneManager.getAllDesigns();
        console.log(`📍 Found ${existingDesignsNow.length} existing designs when calculating position`);
        
        // Calculate position for new design (with spacing between designs)
        const position = calculateNextPosition(existingDesignsNow, newDesignBounds, 5);
        console.log('🎯 Calculated position for new design:', position);
        
        // Generate unique design ID
        const designId = sceneManager.generateDesignId();
        console.log('🆔 Generated design ID:', designId);
        
        // Add as a design group (this will add objects to scene with position offset)
        console.log('➕ Adding design group to scene...');
        sceneManager.addDesignGroup(designId, sceneObjects, position, {
          prompt: modelData.prompt || 'AI Generated Design',
          source: 'ai_generation',
        });
        
        console.log('📊 AFTER ADDING NEW DESIGN:');
        console.log(`  ✅ Design group ${designId} added successfully`);
        console.log('  - Total designs now:', sceneManager.getAllDesigns().length);
        console.log('  - Total objects now:', sceneManager.objects.size);
        console.log('  - Design groups:', sceneManager.designGroups.size);
        
        // List all designs after adding
        const allDesigns = sceneManager.getAllDesigns();
        console.log('  - All design IDs:', allDesigns.map(d => d.id));
        allDesigns.forEach((design, idx) => {
          console.log(`    Design ${idx + 1}: ${design.id}, objects: ${design.objects.length}, position: (${design.position.x}, ${design.position.y}, ${design.position.z})`);
        });
        
        console.log('========================================');
        console.log('=== MODEL DATA PROCESSING COMPLETE ===');
        console.log('========================================\n\n');
        
        setNeedsRender(true);
        
        // Notify parent component
        if (onSceneUpdate) {
          onSceneUpdate({
            selectedCount: sceneManager.selectedObjects.size,
            totalObjects: sceneManager.objects.size,
            sceneManager,
            environmentSystem,
          });
        }
      } catch (error) {
        console.error('!!! ❌ ERROR ADDING AI MODEL TO SCENE !!!', error);
        console.error('Error stack:', error.stack);
      }
    }).catch(error => {
      console.error('!!! ❌ ERROR IMPORTING MODULES !!!', error);
      console.error('Error stack:', error.stack);
    });
  }, [modelDataTimestamp, sceneManager, environmentSystem, onSceneUpdate]);

  const isWireframe = viewMode === 'wireframe';

  return (
    <div ref={canvasRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a1a' }}>
      {/* Info overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(26, 26, 26, 0.9)',
        padding: '10px 14px',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#ccc',
        zIndex: 10,
        border: '1px solid #333',
        minWidth: '200px',
      }}>
        <div style={{ marginBottom: '6px', color: '#ff6b35', fontWeight: 'bold' }}>
          Tool: {toolManager.getActiveTool()?.name || 'None'}
        </div>
        <div>Objects: {sceneManager.objects.size}</div>
        <div>Selected: {sceneManager.selectedObjects.size}</div>
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #333', fontSize: '10px' }}>
          S: Select | G: Move | R: Rotate | E: Extrude
        </div>
      </div>

      <Canvas 
        shadows 
        ref={canvasRef}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          outputEncoding: THREE.sRGBEncoding,
          physicallyCorrectLights: true,
        }}
      >
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[15, 15, 15]} fov={50} far={5000} />
          <OrbitControls 
            enableDamping 
            dampingFactor={0.05}
            makeDefault
            maxDistance={1500}
            minDistance={2}
          />
          
          {/* Lighting */}
          {environmentConfig ? (
            <EnvironmentLighting environmentConfig={environmentConfig} />
          ) : (
            <>
              <ambientLight intensity={0.5} />
              <directionalLight 
                position={[10, 10, 5]} 
                intensity={1}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight position={[-10, -10, -5]} intensity={0.3} />
              <pointLight position={[0, 5, 0]} intensity={0.5} color="#ff6b35" />
            </>
          )}
          
          {/* Scene Objects */}
          <SceneRenderer
            sceneManager={sceneManager}
            selectedObjects={selectedObjects}
            onSelect={handleObjectSelect}
          />
          
          {/* Auto-frame camera when objects are added */}
          <CameraAutoFramer sceneManager={sceneManager} enabled={true} />
          
          {/* Industry-Grade Grid - 18x larger (1800×1800 units) */}
          <Grid
            args={[1800, 1800]}
            cellSize={1}
            cellThickness={0.8}
            cellColor="#4a4a4a"
            sectionSize={10}
            sectionThickness={1.5}
            sectionColor="#666666"
            fadeDistance={1800}
            fadeStrength={0.5}
            position={[0, 0, 0]}
            infiniteGrid={false}
          />

          {/* Axes Helper */}
          <axesHelper args={[5]} />

          {/* Gizmo */}
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewcube color="#ff6b35" hoverColor="#ff8555" />
          </GizmoHelper>
        </Suspense>
      </Canvas>
    </div>
  );
}
