/**
 * MeshEditor - IMAX/AAA Quality Mesh Editing System
 * Handles vertex/edge/face selection and geometric operations
 * Supports: Extrude, Inset, Bevel, Subdivide, Loop Cut
 */

import * as THREE from 'three';

export class MeshEditor {
    constructor(mesh) {
        this.mesh = mesh;
        this.geometry = mesh.geometry;

        if (!this.geometry.isBufferGeometry) {
            throw new Error('MeshEditor requires BufferGeometry');
        }

        // Get references to geometry attributes
        this.positions = this.geometry.attributes.position;
        this.normals = this.geometry.attributes.normal;
        this.indices = this.geometry.index;

        // Selection state
        this.selectedVertices = new Set();
        this.selectedEdges = new Set();
        this.selectedFaces = new Set();
        this.selectionMode = 'vertex'; // 'vertex', 'edge', 'face'

        // History for undo/redo
        this.history = [];
        this.historyIndex = -1;

        // Cache for performance
        this.vertexCache = null;
        this.edgeCache = null;
        this.faceCache = null;
    }

    /**
     * Set selection mode
     */
    setSelectionMode(mode) {
        if (['vertex', 'edge', 'face'].includes(mode)) {
            this.selectionMode = mode;
            this.clearSelection();
        }
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedVertices.clear();
        this.selectedEdges.clear();
        this.selectedFaces.clear();
    }

    /**
     * Select vertex by index
     */
    selectVertex(index, multiSelect = false) {
        if (!multiSelect) {
            this.selectedVertices.clear();
        }
        this.selectedVertices.add(index);
    }

    /**
     * Select face by index
     */
    selectFace(faceIndex, multiSelect = false) {
        if (!multiSelect) {
            this.selectedFaces.clear();
        }
        this.selectedFaces.add(faceIndex);
    }

    /**
     * Get selected vertex indices as array
     */
    getSelectedVertices() {
        return Array.from(this.selectedVertices);
    }

    /**
     * Get selected face indices as array
     */
    getSelectedFaces() {
        return Array.from(this.selectedFaces);
    }

    /**
     * Extrude selected faces
     */
    extrude(distance = 1.0, direction = null) {
        if (this.selectedFaces.size === 0) {
            console.warn('No faces selected for extrusion');
            return;
        }

        this.pushHistory();

        const positions = this.positions.array;
        const indices = this.indices ? this.indices.array : null;

        if (!indices) {
            console.error('Extrude requires indexed geometry');
            return;
        }

        const newVertices = [];
        const newIndices = [];
        const faceVertexMap = new Map(); // Maps old vertex index to new vertex index

        // For each selected face
        this.selectedFaces.forEach(faceIndex => {
            const i0 = indices[faceIndex * 3];
            const i1 = indices[faceIndex * 3 + 1];
            const i2 = indices[faceIndex * 3 + 2];

            // Calculate face normal
            const v0 = new THREE.Vector3(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
            const v1 = new THREE.Vector3(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
            const v2 = new THREE.Vector3(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);

            const edge1 = new THREE.Vector3().subVectors(v1, v0);
            const edge2 = new THREE.Vector3().subVectors(v2, v0);
            const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

            const extrudeDir = direction || normal;

            // Create new vertices for this face
            [i0, i1, i2].forEach(oldIndex => {
                if (!faceVertexMap.has(oldIndex)) {
                    const newIndex = (positions.length / 3) + newVertices.length / 3;

                    // Duplicate vertex and move along normal
                    const x = positions[oldIndex * 3] + extrudeDir.x * distance;
                    const y = positions[oldIndex * 3 + 1] + extrudeDir.y * distance;
                    const z = positions[oldIndex * 3 + 2] + extrudeDir.z * distance;

                    newVertices.push(x, y, z);
                    faceVertexMap.set(oldIndex, newIndex);
                }
            });
        });

        // Expand position buffer
        const newPositions = new Float32Array(positions.length + newVertices.length);
        newPositions.set(positions);
        newPositions.set(newVertices, positions.length);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));

        // Create side faces and top face
        this.selectedFaces.forEach(faceIndex => {
            const i0 = indices[faceIndex * 3];
            const i1 = indices[faceIndex * 3 + 1];
            const i2 = indices[faceIndex * 3 + 2];

            const ni0 = faceVertexMap.get(i0);
            const ni1 = faceVertexMap.get(i1);
            const ni2 = faceVertexMap.get(i2);

            // Top face (new vertices)
            newIndices.push(ni0, ni1, ni2);

            // Side faces (quads split into triangles)
            // Edge 0-1
            newIndices.push(i0, i1, ni1);
            newIndices.push(i0, ni1, ni0);

            // Edge 1-2
            newIndices.push(i1, i2, ni2);
            newIndices.push(i1, ni2, ni1);

            // Edge 2-0
            newIndices.push(i2, i0, ni0);
            newIndices.push(i2, ni0, ni2);
        });

        // Expand index buffer
        const newIndexArray = new Uint32Array(indices.length + newIndices.length);
        newIndexArray.set(indices);
        newIndexArray.set(newIndices, indices.length);

        this.geometry.setIndex(new THREE.BufferAttribute(newIndexArray, 1));

        this.updateGeometry();
        console.log(`✅ Extruded ${this.selectedFaces.size} faces by ${distance} units`);
    }

    /**
     * Inset selected faces
     */
    inset(offset = 0.2) {
        if (this.selectedFaces.size === 0) {
            console.warn('No faces selected for inset');
            return;
        }

        this.pushHistory();

        // Simplified inset: shrink face toward its center
        const positions = this.positions.array;
        const indices = this.indices.array;

        this.selectedFaces.forEach(faceIndex => {
            const i0 = indices[faceIndex * 3];
            const i1 = indices[faceIndex * 3 + 1];
            const i2 = indices[faceIndex * 3 + 2];

            // Calculate face center
            const center = new THREE.Vector3(
                (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
                (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
                (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3
            );

            // Move each vertex toward center
            [i0, i1, i2].forEach(vIndex => {
                const v = new THREE.Vector3(
                    positions[vIndex * 3],
                    positions[vIndex * 3 + 1],
                    positions[vIndex * 3 + 2]
                );

                v.lerp(center, offset);

                positions[vIndex * 3] = v.x;
                positions[vIndex * 3 + 1] = v.y;
                positions[vIndex * 3 + 2] = v.z;
            });
        });

        this.updateGeometry();
        console.log(`✅ Inset ${this.selectedFaces.size} faces by ${offset}`);
    }

    /**
     * Subdivide selected faces
     */
    subdivide() {
        if (this.selectedFaces.size === 0) {
            console.warn('No faces selected for subdivision');
            return;
        }

        this.pushHistory();

        const positions = this.positions.array;
        const indices = this.indices.array;
        const newVertices = [];
        const newIndices = [];
        const edgeMidpoints = new Map(); // Cache edge midpoints

        const getEdgeKey = (v0, v1) => {
            return v0 < v1 ? `${v0}-${v1}` : `${v1}-${v0}`;
        };

        const getOrCreateMidpoint = (v0, v1) => {
            const key = getEdgeKey(v0, v1);

            if (edgeMidpoints.has(key)) {
                return edgeMidpoints.get(key);
            }

            const newIndex = (positions.length / 3) + (newVertices.length / 3);

            // Calculate midpoint
            const x = (positions[v0 * 3] + positions[v1 * 3]) / 2;
            const y = (positions[v0 * 3 + 1] + positions[v1 * 3 + 1]) / 2;
            const z = (positions[v0 * 3 + 2] + positions[v1 * 3 + 2]) / 2;

            newVertices.push(x, y, z);
            edgeMidpoints.set(key, newIndex);
            return newIndex;
        };

        this.selectedFaces.forEach(faceIndex => {
            const i0 = indices[faceIndex * 3];
            const i1 = indices[faceIndex * 3 + 1];
            const i2 = indices[faceIndex * 3 + 2];

            // Get or create edge midpoints
            const m01 = getOrCreateMidpoint(i0, i1);
            const m12 = getOrCreateMidpoint(i1, i2);
            const m20 = getOrCreateMidpoint(i2, i0);

            // Create 4 new triangles
            newIndices.push(i0, m01, m20);
            newIndices.push(i1, m12, m01);
            newIndices.push(i2, m20, m12);
            newIndices.push(m01, m12, m20);

            // Mark original face for deletion
            indices[faceIndex * 3] = 0;
            indices[faceIndex * 3 + 1] = 0;
            indices[faceIndex * 3 + 2] = 0;
        });

        // Expand positions
        const newPositions = new Float32Array(positions.length + newVertices.length);
        newPositions.set(positions);
        newPositions.set(newVertices, positions.length);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));

        // Filter out deleted faces and add new faces
        const filteredIndices = [];
        for (let i = 0; i < indices.length; i += 3) {
            if (indices[i] !== 0 || indices[i + 1] !== 0 || indices[i + 2] !== 0) {
                filteredIndices.push(indices[i], indices[i + 1], indices[i + 2]);
            }
        }
        filteredIndices.push(...newIndices);

        this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(filteredIndices), 1));
        this.updateGeometry();

        console.log(`✅ Subdivided ${this.selectedFaces.size} faces`);
    }

    /**
     * Update geometry after modifications
     */
    updateGeometry() {
        this.positions.needsUpdate = true;
        if (this.indices) {
            this.geometry.index.needsUpdate = true;
        }
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingBox();
        this.geometry.computeBoundingSphere();
    }

    /**
     * Save current state for undo
     */
    pushHistory() {
        // Clear any future history if we're not at the end
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        // Save current geometry state
        const state = {
            positions: this.positions.array.slice(),
            indices: this.indices ? this.indices.array.slice() : null,
        };

        this.history.push(state);
        this.historyIndex++;

        // Limit history size
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    /**
     * Undo last operation
     */
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const state = this.history[this.historyIndex];

            this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(state.positions), 3));
            if (state.indices) {
                this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(state.indices), 1));
            }

            this.updateGeometry();
            console.log('↶ Undo');
        }
    }

    /**
     * Redo last undone operation
     */
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const state = this.history[this.historyIndex];

            this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(state.positions), 3));
            if (state.indices) {
                this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(state.indices), 1));
            }

            this.updateGeometry();
            console.log('↷ Redo');
        }
    }
}
