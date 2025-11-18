import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
import SceneManager from '../systems/SceneManager';
import initializeEnvironmentSystem from '../systems/EnvironmentSystem';

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