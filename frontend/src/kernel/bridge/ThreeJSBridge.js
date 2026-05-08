/**
 * ArchDisc Geometry Kernel — Three.js Bridge
 * Converts kernel B-Rep solids into Three.js meshes for viewport rendering.
 * Handles: solid → mesh, face highlighting, edge wireframes, vertex markers.
 */

import * as THREE from 'three';
import Tessellator from '../tessellation/Tessellator.js';
import SubdivisionSurface from '../tessellation/SubdivisionSurface.js';

export default class ThreeJSBridge {

  /**
   * Convert a TopoSolid into a Three.js Group with mesh + edges.
   * @param {TopoSolid} solid
   * @param {object} options
   * @param {number} options.color - Hex color (default: 0x4a90d9)
   * @param {number} options.metalness - 0-1 (default: 0.3)
   * @param {number} options.roughness - 0-1 (default: 0.5)
   * @param {boolean} options.wireframe - Show wireframe overlay (default: true)
   * @param {boolean} options.edges - Show sharp edges (default: true)
   * @returns {THREE.Group}
   */
  static solidToGroup(solid, options = {}) {
    const {
      color = 0x4a90d9,
      metalness = 0.3,
      roughness = 0.5,
      wireframe = false,
      edges = true,
      opacity = 1.0,
      flatShading = false,
      smooth = 0,  // DISABLED — subdivision produces artifacts on triangulated B-Rep meshes
    } = options;

    const group = new THREE.Group();
    group.name = solid.name || `Solid_${solid.id}`;
    group.userData.solidId = solid.id;
    group.userData.featureType = solid.userData.featureType || solid.name;

    // Tessellate base mesh
    const tessResult = Tessellator.tessellate(solid);
    const threeData = Tessellator.toThreeJS(tessResult);

    // Apply subdivision for smooth rendering
    let finalPos = threeData.position;
    let finalNorm = threeData.normal;
    let finalIdx = threeData.index;

    if (smooth > 0 && threeData.position.length > 0) {
      try {
        const subdivided = SubdivisionSurface.subdivide(
          threeData.position, threeData.index, threeData.normal, new Set(), smooth
        );
        finalPos = subdivided.positions;
        finalNorm = subdivided.normals;
        finalIdx = subdivided.indices;
      } catch (e) {
        // Fallback to flat tessellation if subdivision fails
        console.warn('Subdivision failed, using flat tessellation:', e.message);
      }
    }

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(finalPos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(finalNorm, 3));
    geometry.setIndex(new THREE.BufferAttribute(finalIdx, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    // Store face map for picking
    geometry.userData = { faceMap: tessResult.faceMap };

    // Material
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      side: THREE.DoubleSide,
      flatShading,
      transparent: opacity < 1,
      opacity,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${group.name}_mesh`;
    mesh.userData.pickable = true;
    mesh.userData.solidId = solid.id;
    group.add(mesh);

    // Edge wireframe — only sharp edges (>30° between faces)
    if (edges) {
      const edgeGeometry = ThreeJSBridge._buildEdgeGeometry(solid, { sharpOnly: true, creaseAngle: Math.PI / 6 });
      if (edgeGeometry) {
        const edgeMaterial = new THREE.LineBasicMaterial({
          color: 0xeeeeee,  // light edges show on dark background
          transparent: true,
          opacity: 0.9,
          depthTest: true,
        });
        const edgeLine = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edgeLine.name = `${group.name}_edges`;
        edgeLine.userData.pickable = false;
        edgeLine.renderOrder = 1; // render edges after mesh
        group.add(edgeLine);
      }
    }

    return group;
  }

  /**
   * Build edge wireframe geometry from solid topology.
   */
  static _buildEdgeGeometry(solid, options = {}) {
    const { sharpOnly = false, creaseAngle = Math.PI / 6 } = options;
    const positions = [];
    const cosCrease = Math.cos(creaseAngle);

    for (const edge of solid.edges()) {
      // If sharpOnly, skip edges between coplanar faces
      if (sharpOnly && edge.faces && edge.faces.size === 2) {
        const facesArr = [...edge.faces];
        const n1 = facesArr[0].outerLoop?.computeNormal();
        const n2 = facesArr[1].outerLoop?.computeNormal();
        if (n1 && n2) {
          const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
          if (dot > cosCrease) continue; // smooth edge, skip
        }
      }

      const pts = edge.tessellate(8);
      for (let i = 0; i < pts.length - 1; i++) {
        positions.push(pts[i].x, pts[i].y, pts[i].z);
        positions.push(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      }
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  /**
   * Highlight a specific face on a solid group.
   * @param {THREE.Group} group - Group created by solidToGroup
   * @param {number} faceId - TopoFace id to highlight
   * @param {number} highlightColor - Hex color (default: 0xff6b35)
   */
  static highlightFace(group, faceId, highlightColor = 0xff6b35) {
    const mesh = group.children.find(c => c.isMesh);
    if (!mesh) return;

    const faceMap = mesh.geometry.userData?.faceMap;
    if (!faceMap) return;

    const faceInfo = faceMap.get(faceId);
    if (!faceInfo) return;

    // Create highlight overlay
    const existingHighlight = group.getObjectByName('face_highlight');
    if (existingHighlight) group.remove(existingHighlight);

    const highlightGeometry = new THREE.BufferGeometry();
    const positions = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();

    const highlightPositions = [];
    for (let i = faceInfo.startIndex; i < faceInfo.startIndex + faceInfo.count; i++) {
      const vi = index.getX(i);
      highlightPositions.push(positions.getX(vi), positions.getY(vi), positions.getZ(vi));
    }

    highlightGeometry.setAttribute('position',
      new THREE.Float32BufferAttribute(highlightPositions, 3));

    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: highlightColor,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });

    const highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlightMesh.name = 'face_highlight';
    highlightMesh.userData.pickable = false;
    highlightMesh.renderOrder = 1;
    group.add(highlightMesh);
  }

  /**
   * Clear face highlight.
   */
  static clearHighlight(group) {
    const highlight = group.getObjectByName('face_highlight');
    if (highlight) {
      highlight.geometry.dispose();
      highlight.material.dispose();
      group.remove(highlight);
    }
  }

  /**
   * Show vertex markers on a solid.
   */
  static showVertices(group, solid, size = 0.02, color = 0x00ff88) {
    const existingVerts = group.getObjectByName('vertex_markers');
    if (existingVerts) group.remove(existingVerts);

    const markerGeometry = new THREE.SphereGeometry(size, 6, 6);
    const markerMaterial = new THREE.MeshBasicMaterial({ color });
    const markerGroup = new THREE.Group();
    markerGroup.name = 'vertex_markers';

    for (const vertex of solid.vertices()) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(vertex.point.x, vertex.point.y, vertex.point.z);
      marker.userData.vertexId = vertex.id;
      marker.userData.pickable = false;
      markerGroup.add(marker);
    }

    group.add(markerGroup);
  }

  /**
   * Hide vertex markers.
   */
  static hideVertices(group) {
    const markers = group.getObjectByName('vertex_markers');
    if (markers) group.remove(markers);
  }

  /**
   * Update a solid group after parameter change (re-tessellate).
   * @param {THREE.Group} group
   * @param {TopoSolid} newSolid
   * @param {object} options - Same as solidToGroup options
   */
  static updateSolid(group, newSolid, options = {}) {
    // Remove old children
    while (group.children.length > 0) {
      const child = group.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      group.remove(child);
    }

    // Rebuild
    const newGroup = ThreeJSBridge.solidToGroup(newSolid, options);
    for (const child of [...newGroup.children]) {
      group.add(child);
    }

    group.userData.solidId = newSolid.id;
  }

  /**
   * Pick a face from a raycaster intersection.
   * @param {THREE.Intersection} intersection
   * @returns {number|null} Face ID or null
   */
  static pickFace(intersection) {
    const mesh = intersection.object;
    const faceMap = mesh.geometry?.userData?.faceMap;
    if (!faceMap || intersection.faceIndex === undefined) return null;

    const triIndex = intersection.faceIndex * 3;

    for (const [faceId, info] of faceMap) {
      if (triIndex >= info.startIndex && triIndex < info.startIndex + info.count) {
        return faceId;
      }
    }
    return null;
  }

  /**
   * Dispose of all Three.js resources in a group.
   */
  static dispose(group) {
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
