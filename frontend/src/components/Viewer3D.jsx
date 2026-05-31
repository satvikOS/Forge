import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Suspense } from 'react';

function Box({ dimensions, position, color }) {
  const { x, y, z } = dimensions;
  const scale = [x / 1000, y / 1000, z / 1000];
  
  return (
    <mesh position={position} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color || '#4a90e2'} />
    </mesh>
  );
}

function Sphere({ radius, position, color }) {
  const scale = radius / 500;
  
  return (
    <mesh position={position} scale={scale}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial color={color || '#333'} />
    </mesh>
  );
}

function Cylinder({ radius, height, position, color }) {
  const scale = [radius / 500, height / 1000, radius / 500];
  
  return (
    <mesh position={position} scale={scale} rotation={[0, 0, 0]}>
      <cylinderGeometry args={[1, 1, 1, 32]} />
      <meshStandardMaterial color={color || '#888'} />
    </mesh>
  );
}

function Model({ geometry }) {
  if (!geometry) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4a90e2" />
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

          if (part.type === 'box') {
            return <Box key={index} dimensions={part.dimensions} position={position} />;
          } else if (part.type === 'sphere') {
            return <Sphere key={index} radius={part.radius} position={position} />;
          } else if (part.type === 'cylinder') {
            return <Cylinder key={index} radius={part.radius} height={part.height} position={position} />;
          }
          return null;
        })}
      </>
    );
  }

  if (geometry.type === 'box' && geometry.dimensions) {
    return <Box dimensions={geometry.dimensions} position={[0, 0, 0]} />;
  }

  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4a90e2" />
    </mesh>
  );
}

export default function Viewer3D({ modelData }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      <Canvas>
        <Suspense fallback={null}>
          <PerspectiveCamera makeDefault position={[50, 50, 50]} far={10000} />
          <OrbitControls enableDamping dampingFactor={0.05} />
          
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <directionalLight position={[-10, -10, -5]} intensity={0.5} />
          
          <Model geometry={modelData?.geometry} />
          
          <gridHelper args={[1800, 180, '#888', '#666']} />
        </Suspense>
      </Canvas>
    </div>
  );
}
