import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import { Suspense, useState } from 'react';
import * as THREE from 'three';

function EditablePart({ geometry, position, material, isSelected, onSelect, partId, isWireframe, isExploded }) {
  const [hovered, setHovered] = useState(false);

  const explodeOffset = isExploded ? [
    (position[0] / 1000) * 2,
    (position[1] / 1000) * 2,
    (position[2] / 1000) * 2,
  ] : [0, 0, 0];

  const finalPosition = [
    position[0] + explodeOffset[0],
    position[1] + explodeOffset[1],
    position[2] + explodeOffset[2],
  ];

  return (
    <mesh
      position={finalPosition}
      scale={geometry.scale}
      rotation={geometry.rotation || [0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(partId);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {geometry.type === 'box' && <boxGeometry args={[1, 1, 1]} />}
      {geometry.type === 'sphere' && <sphereGeometry args={[1, 32, 32]} />}
      {geometry.type === 'cylinder' && <cylinderGeometry args={[1, 1, 1, 32]} />}
      
      <meshStandardMaterial
        color={isSelected ? '#ff6b35' : (hovered ? '#ff8555' : material.color)}
        wireframe={isWireframe}
        transparent={isSelected || hovered}
        opacity={isSelected ? 0.8 : (hovered ? 0.9 : 1)}
        emissive={isSelected || hovered ? '#ff6b35' : '#000000'}
        emissiveIntensity={isSelected ? 0.3 : (hovered ? 0.2 : 0)}
      />
    </mesh>
  );
}

function Model({ geometry, selectedPart, onSelectPart, isWireframe, isExploded }) {
  if (!geometry) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4a90e2" wireframe={isWireframe} />
      </mesh>
    );
  }

  if (geometry.type === 'composite' && geometry.parts) {
    return (
      <>
        {geometry.parts.map((part, index) => {
          const position = part.position ? [
            part.position.x / 1000,
            part.position.y / 1000,
            part.position.z / 1000
          ] : [0, 0, 0];

          let scale = [1, 1, 1];
          if (part.type === 'box' && part.dimensions) {
            scale = [
              part.dimensions.x / 1000,
              part.dimensions.y / 1000,
              part.dimensions.z / 1000
            ];
          } else if (part.type === 'sphere' && part.radius) {
            const s = part.radius / 500;
            scale = [s, s, s];
          } else if (part.type === 'cylinder' && part.radius && part.height) {
            scale = [part.radius / 500, part.height / 1000, part.radius / 500];
          }

          return (
            <EditablePart
              key={index}
              partId={index}
              geometry={{
                type: part.type,
                scale: scale,
              }}
              position={position}
              material={{ color: '#4a90e2' }}
              isSelected={selectedPart === index}
              onSelect={onSelectPart}
              isWireframe={isWireframe}
              isExploded={isExploded}
            />
          );
        })}
      </>
    );
  }

  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4a90e2" wireframe={isWireframe} />
    </mesh>
  );
}

export default function WorkbenchViewer({ modelData, viewMode, isExploded }) {
  const [selectedPart, setSelectedPart] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const isWireframe = viewMode === 'wireframe';

  const handleContextMenu = (e) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const contextMenuItems = [
    { label: 'Reset Camera', icon: '↻' },
    { label: 'Focus Selected', icon: '🎯', disabled: selectedPart === null },
    { label: 'Duplicate Part', icon: '📋', disabled: selectedPart === null },
    { divider: true },
    { label: 'Add Cube', icon: '⬜' },
    { label: 'Add Sphere', icon: '⚪' },
    { label: 'Add Cylinder', icon: '⭕' },
    { divider: true },
    { label: 'Export Model', icon: '💾' },
    { label: 'Take Screenshot', icon: '📷' },
  ];

  return (
    <div 
      style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg-primary)' }}
      onContextMenu={handleContextMenu}
      onClick={closeContextMenu}
    >
      {/* View info overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(26, 26, 26, 0.9)',
        backdropFilter: 'blur(10px)',
        padding: '8px 12px',
        borderRadius: '8px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        zIndex: 10,
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div>View: {viewMode === 'wireframe' ? 'Wireframe' : 'Solid'}</div>
        {isExploded && <div style={{ color: 'var(--accent-orange)' }}>Exploded View</div>}
        {selectedPart !== null && (
          <div style={{ marginTop: '4px', color: 'var(--accent-orange)' }}>
            Part {selectedPart + 1} Selected
          </div>
        )}
      </div>

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
          
          {/* Model */}
          <Model 
            geometry={modelData?.geometry}
            selectedPart={selectedPart}
            onSelectPart={setSelectedPart}
            isWireframe={isWireframe}
            isExploded={isExploded}
          />
          
          {/* Grid - Industry standard 1m squares, 18x larger (360m total) */}
          <gridHelper 
            args={[360, 360, '#333333', '#1a1a1a']} 
            position={[0, -0.01, 0]}
          />

          {/* Axes Helper */}
          <axesHelper args={[50]} />

          {/* Gizmo */}
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewcube color="#ff6b35" hoverColor="#ff8555" />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* Context Menu */}
      {contextMenu && (
        <div style={{
          position: 'fixed',
          top: `${contextMenu.y}px`,
          left: `${contextMenu.x}px`,
          background: 'rgba(26, 26, 26, 0.98)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          padding: '6px',
          minWidth: '180px',
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
        }}>
          {contextMenuItems.map((item, idx) => 
            item.divider ? (
              <div key={idx} style={{
                height: '1px',
                background: 'rgba(255, 255, 255, 0.1)',
                margin: '4px 0',
              }} />
            ) : (
              <button
                key={idx}
                disabled={item.disabled}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: item.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) {
                    e.target.style.background = 'var(--bg-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'transparent';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!item.disabled) {
                    console.log(`Context menu: ${item.label}`);
                    closeContextMenu();
                  }
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            )
          )}
        </div>
      )}

      {/* Selected part info */}
      {selectedPart !== null && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(26, 26, 26, 0.95)',
          backdropFilter: 'blur(10px)',
          padding: '12px',
          borderRadius: '8px',
          fontSize: '12px',
          color: 'var(--text-primary)',
          zIndex: 10,
          border: '1px solid var(--accent-orange)',
          minWidth: '200px',
        }}>
          <div style={{ 
            fontWeight: 'bold', 
            marginBottom: '8px',
            color: 'var(--accent-orange)',
          }}>
            Part {selectedPart + 1}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            Type: {modelData?.geometry?.parts?.[selectedPart]?.type || 'Unknown'}
          </div>
          <button
            onClick={() => setSelectedPart(null)}
            style={{
              marginTop: '8px',
              width: '100%',
              padding: '6px',
              background: 'var(--bg-tertiary)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Deselect
          </button>
        </div>
      )}
    </div>
  );
}
