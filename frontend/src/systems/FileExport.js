/**
 * File Export System - Export 3D scenes to various formats
 */

import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

// Export scene to OBJ format
export function exportToOBJ(sceneManager) {
  const exporter = new OBJExporter();
  const scene = createThreeScene(sceneManager);
  const result = exporter.parse(scene);
  downloadFile(result, 'scene.obj', 'text/plain');
}

// Export scene to STL format
export function exportToSTL(sceneManager, binary = true) {
  const exporter = new STLExporter();
  const scene = createThreeScene(sceneManager);
  const result = exporter.parse(scene, { binary });
  
  if (binary) {
    downloadFile(result, 'scene.stl', 'application/octet-stream');
  } else {
    downloadFile(result, 'scene.stl', 'text/plain');
  }
}

// Export scene to GLTF format
export function exportToGLTF(sceneManager, binary = false) {
  const exporter = new GLTFExporter();
  const scene = createThreeScene(sceneManager);
  
  exporter.parse(
    scene,
    (result) => {
      if (binary) {
        downloadFile(result, 'scene.glb', 'application/octet-stream');
      } else {
        const output = JSON.stringify(result, null, 2);
        downloadFile(output, 'scene.gltf', 'application/json');
      }
    },
    (error) => {
      console.error('Export error:', error);
    },
    { binary }
  );
}

// Save project as JSON
export function saveProject(sceneManager) {
  const project = {
    version: '1.0.0',
    objects: Array.from(sceneManager.objects.values()).map(obj => ({
      id: obj.id,
      name: obj.name,
      type: obj.type,
      geometry: obj.geometry,
      material: obj.material,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      visible: obj.visible,
      locked: obj.locked,
      userData: obj.userData,
    })),
    layers: Array.from(sceneManager.layers.values()),
    activeLayer: sceneManager.activeLayer,
  };
  
  const json = JSON.stringify(project, null, 2);
  downloadFile(json, 'project.archdisc', 'application/json');
}

// Load project from JSON
export function loadProject(fileContent, sceneManager) {
  try {
    const project = JSON.parse(fileContent);
    
    // Clear current scene
    sceneManager.clear();
    
    // Restore objects
    project.objects.forEach(objData => {
      const obj = sceneManager.createObject(
        objData.name,
        objData.type,
        objData.geometry,
        objData.material
      );
      obj.position = objData.position;
      obj.rotation = objData.rotation;
      obj.scale = objData.scale;
      obj.visible = objData.visible;
      obj.locked = objData.locked;
      obj.userData = objData.userData || {};
    });
    
    // Restore layers
    if (project.layers) {
      sceneManager.layers.clear();
      project.layers.forEach(layer => {
        sceneManager.layers.set(layer.id, layer);
      });
      sceneManager.activeLayer = project.activeLayer || 'default';
    }
    
    return true;
  } catch (error) {
    console.error('Failed to load project:', error);
    return false;
  }
}

// Helper: Create Three.js scene from scene manager
function createThreeScene(sceneManager) {
  const scene = new THREE.Scene();
  
  sceneManager.getAllObjects().forEach(obj => {
    const mesh = createMeshFromObject(obj);
    if (mesh) {
      scene.add(mesh);
    }
  });
  
  return scene;
}

// Helper: Create Three.js mesh from scene object
function createMeshFromObject(obj) {
  let geometry;
  const geom = obj.geometry;
  
  switch (geom.type) {
    case 'box':
      geometry = new THREE.BoxGeometry(
        geom.width || 1,
        geom.height || 1,
        geom.depth || 1
      );
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(
        geom.radius || 0.5,
        geom.widthSegments || 32,
        geom.heightSegments || 16
      );
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(
        geom.radiusTop || 0.5,
        geom.radiusBottom || 0.5,
        geom.height || 1,
        geom.radialSegments || 32
      );
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(
        geom.radius || 0.5,
        geom.height || 1,
        geom.radialSegments || 32
      );
      break;
    case 'plane':
      geometry = new THREE.PlaneGeometry(
        geom.width || 1,
        geom.height || 1
      );
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(
        geom.radius || 0.5,
        geom.tube || 0.2,
        geom.radialSegments || 16,
        geom.tubularSegments || 100
      );
      break;
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
  }
  
  const material = new THREE.MeshStandardMaterial({
    color: obj.material.color || '#4a90e2',
    metalness: obj.material.metalness || 0.3,
    roughness: obj.material.roughness || 0.7,
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
  mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
  mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
  
  return mesh;
}

// Helper: Download file
function downloadFile(content, filename, mimeType) {
  const blob = content instanceof ArrayBuffer 
    ? new Blob([content], { type: mimeType })
    : new Blob([content], { type: mimeType });
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  
  // Clean up
  setTimeout(() => URL.revokeObjectURL(link.href), 100);
}

export default {
  exportToOBJ,
  exportToSTL,
  exportToGLTF,
  saveProject,
  loadProject,
};
