/**
 * Advanced 3D Workbench - Full-featured 3D editor with tool integration
 */

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, GizmoHelper, GizmoViewcube, Grid, TransformControls } from '@react-three/drei';
import { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import ToolManager from '../systems/ToolSystem';
import SceneManager from '../systems/SceneManager';

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

// Scene Object Renderer - Renders objects from the scene manager
function SceneObject({ sceneObject, isSelected, onSelect }) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);

  // Create Three.js geometry based on scene object type
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

  // Update position, rotation, scale
  useFrame(() => {
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
  });

  if (!sceneObject.visible) return null;

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
      <meshStandardMaterial
        color={sceneObject.material.color}
        metalness={sceneObject.material.metalness || 0.3}
        roughness={sceneObject.material.roughness || 0.7}
        emissive={isSelected || hovered ? '#ff6b35' : '#000000'}
        emissiveIntensity={isSelected ? 0.3 : (hovered ? 0.2 : 0)}
        transparent={isSelected || hovered}
        opacity={isSelected ? 0.95 : (hovered ? 0.95 : 1)}
      />
    </mesh>
  );
}

// Scene Renderer Component
function SceneRenderer({ sceneManager, selectedObjects, onSelect }) {
  const { scene, camera, gl, raycaster } = useThree();
  const [objects, setObjects] = useState([]);

  useEffect(() => {
    // Update objects list when scene manager changes
    const updateObjects = () => {
      setObjects(sceneManager.getAllObjects());
    };
    
    updateObjects();
    const interval = setInterval(updateObjects, 100); // Poll for changes
    return () => clearInterval(interval);
  }, [sceneManager]);

  return (
    <>
      {objects.map((obj) => (
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
  const [sceneManager] = useState(() => new SceneManager());
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
    
    tm.setDefaultTool('select');
    return tm;
  });
  
  const [selectedObjects, setSelectedObjects] = useState(new Set());
  const [needsRender, setNeedsRender] = useState(false);
  const contextRef = useRef({});

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
  useEffect(() => {
    if (!modelData || !sceneManager) {
      return;
    }
    
    console.log('Received model data in AdvancedWorkbench:', modelData);
    
    // Import geometry converter and layout manager
    Promise.all([
      import('../utils/geometryConverter.js'),
      import('../utils/layoutManager.js')
    ]).then(([{ convertModelDataToSceneObjects }, { calculateNextPosition, calculateBounds }]) => {
      try {
        // Extract geometry from model data (backend returns { geometry: {...}, materials: [...], ... })
        const geometryData = modelData.geometry || modelData;
        console.log('Extracting geometry data:', geometryData);
        
        // Convert backend model data to scene objects
        const sceneObjects = convertModelDataToSceneObjects(geometryData, 'AI_Model');
        console.log(`Adding ${sceneObjects.length} objects to scene`);
        
        // Calculate bounds for the new design
        const newDesignBounds = calculateBounds(sceneObjects);
        
        // Get existing designs
        const existingDesigns = sceneManager.getAllDesigns();
        
        // Calculate position for new design (with spacing between designs)
        const position = calculateNextPosition(existingDesigns, newDesignBounds, 5);
        console.log('Calculated position for new design:', position);
        
        // Generate unique design ID
        const designId = sceneManager.generateDesignId();
        
        // Add as a design group (this will add objects to scene with position offset)
        sceneManager.addDesignGroup(designId, sceneObjects, position, {
          prompt: modelData.prompt || 'AI Generated Design',
          source: 'ai_generation',
        });
        
        setNeedsRender(true);
        
        // Notify parent component
        if (onSceneUpdate) {
          onSceneUpdate({
            selectedCount: sceneManager.selectedObjects.size,
            totalObjects: sceneManager.objects.size,
            sceneManager,
          });
        }
        
        console.log('AI model added to scene successfully as design group:', designId);
      } catch (error) {
        console.error('Error adding AI model to scene:', error);
      }
    });
  }, [modelData, sceneManager, onSceneUpdate]);

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

      <Canvas shadows ref={canvasRef}>
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
          
          {/* Scene Objects */}
          <SceneRenderer
            sceneManager={sceneManager}
            selectedObjects={selectedObjects}
            onSelect={handleObjectSelect}
          />
          
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
