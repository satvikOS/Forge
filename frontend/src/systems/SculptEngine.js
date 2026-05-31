/**
 * SculptEngine - IMAX/AAA Quality Sculpting System
 * Dynamic mesh deformation with professional brushes
 */

import * as THREE from 'three';

export class SculptBrush {
    constructor(name, type) {
        this.name = name;
        this.type = type; // 'draw', 'clay', 'grab', 'smooth', 'inflate', 'pinch', 'scrape'
        this.size = 0.5;
        this.strength = 0.5;
        this.hardness = 0.7;
    }

    /**
     * Apply brush effect to vertices within radius
     */
    applyToVertex(vertex, hitPoint, normal, distance) {
        const falloff = this.calculateFalloff(distance);
        const displacement = this.calculateDisplacement(vertex, hitPoint, normal, falloff);

        return displacement;
    }

    /**
     * Calculate brush falloff (0 at edge, 1 at center)
     */
    calculateFalloff(distance) {
        const normalizedDist = distance / this.size;
        if (normalizedDist >= 1) return 0;

        // Smooth falloff curve
        const t = 1 - normalizedDist;
        return Math.pow(t, this.hardness * 3);
    }

    /**
     * Calculate displacement vector for this brush type
     */
    calculateDisplacement(vertex, hitPoint, normal, falloff) {
        const strength = this.strength * falloff;

        switch (this.type) {
            case 'draw':
                // Push/pull along normal
                return normal.clone().multiplyScalar(strength * 0.1);

            case 'clay':
                // Additive sculpting (like adding clay)
                return normal.clone().multiplyScalar(strength * 0.15);

            case 'inflate':
                // Expand outward from surface
                return normal.clone().multiplyScalar(strength * 0.12);

            case 'pinch':
                // Pull vertices toward brush center
                const toCenter = new THREE.Vector3().subVectors(hitPoint, vertex);
                return toCenter.multiplyScalar(strength * 0.08);

            case 'scrape':
                // Flatten surface
                const toPlane = new THREE.Vector3().subVectors(hitPoint, vertex);
                toPlane.projectOnPlane(normal);
                return toPlane.multiplyScalar(strength * 0.05);

            case 'grab':
                // Move vertices with brush
                return new THREE.Vector3(); // Handled separately in stroke mode

            case 'smooth':
                // Averaging with neighbors (requires neighbor info)
                return new THREE.Vector3(); // Handled separately

            default:
                return new THREE.Vector3();
        }
    }
}

export class SculptEngine {
    constructor(mesh) {
        this.mesh = mesh;
        this.geometry = mesh.geometry;

        if (!this.geometry.isBufferGeometry) {
            throw new Error('SculptEngine requires BufferGeometry');
        }

        this.positions = this.geometry.attributes.position;

        // Sculpting state
        this.enabled = false;
        this.symmetryEnabled = false;
        this.symmetryAxis = 'x'; // 'x', 'y', 'z'
        this.currentBrush = new SculptBrush('Draw', 'draw');

        // Available brushes
        this.brushes = new Map();
        this.initializeBrushes();

        // Stroke tracking for smooth/grab brushes
        this.isStroking = false;
        this.lastHit = null;

        // History for undo
        this.history = [];
        this.historyIndex = -1;
    }

    /**
     * Initialize default sculpting brushes
     */
    initializeBrushes() {
        this.brushes.set('draw', new SculptBrush('Draw', 'draw'));
        this.brushes.set('clay', new SculptBrush('Clay', 'clay'));
        this.brushes.set('grab', new SculptBrush('Grab', 'grab'));
        this.brushes.set('smooth', new SculptBrush('Smooth', 'smooth'));
        this.brushes.set('inflate', new SculptBrush('Inflate', 'inflate'));
        this.brushes.set('pinch', new SculptBrush('Pinch', 'pinch'));
        this.brushes.set('scrape', new SculptBrush('Scrape', 'scrape'));
    }

    /**
     * Set active brush
     */
    setBrush(brushType) {
        const brush = this.brushes.get(brushType);
        if (brush) {
            this.currentBrush = brush;
            console.log(`🖌️ Switched to ${brush.name} brush`);
        }
    }

    /**
     * Apply sculpting at hit point
     */
    sculpt(hitPoint, normal, camera) {
        if (!this.enabled || !hitPoint || !normal) return;

        this.pushHistory();

        const positions = this.positions.array;
        const hitPos = hitPoint.clone();
        const affectedVertices = new Set();

        // Find vertices within brush radius
        for (let i = 0; i < positions.length; i += 3) {
            const vertex = new THREE.Vector3(
                positions[i],
                positions[i + 1],
                positions[i + 2]
            );

            const distance = vertex.distanceTo(hitPos);

            if (distance <= this.currentBrush.size) {
                // Apply brush effect
                const displacement = this.currentBrush.applyToVertex(
                    vertex,
                    hitPos,
                    normal,
                    distance
                );

                positions[i] += displacement.x;
                positions[i + 1] += displacement.y;
                positions[i + 2] += displacement.z;

                affectedVertices.add(i / 3);

                // Apply symmetry if enabled
                if (this.symmetryEnabled) {
                    this.applySymmetry(i, displacement);
                }
            }
        }

        // Update geometry
        this.updateGeometry();

        console.log(`🎨 Sculpted ${affectedVertices.size} vertices with ${this.currentBrush.name} brush`);
    }

    /**
     * Apply symmetry to vertex
     */
    applySymmetry(vertexIndex, displacement) {
        const positions = this.positions.array;
        const i = vertexIndex;

        // Mirror vertex position
        const mirroredPos = new THREE.Vector3(
            positions[i],
            positions[i + 1],
            positions[i + 2]
        );

        // Mirror across selected axis
        if (this.symmetryAxis === 'x') {
            mirroredPos.x = -mirroredPos.x;
        } else if (this.symmetryAxis === 'y') {
            mirroredPos.y = -mirroredPos.y;
        } else if (this.symmetryAxis === 'z') {
            mirroredPos.z = -mirroredPos.z;
        }

        // Find closest vertex to mirrored position
        let closestIndex = -1;
        let closestDist = Infinity;

        for (let j = 0; j < positions.length; j += 3) {
            const testVert = new THREE.Vector3(
                positions[j],
                positions[j + 1],
                positions[j + 2]
            );
            const dist = testVert.distanceTo(mirroredPos);

            if (dist < closestDist && dist < 0.01) { // Tolerance
                closestDist = dist;
                closestIndex = j;
            }
        }

        // Apply mirrored displacement
        if (closestIndex !== -1) {
            const mirroredDisp = displacement.clone();
            if (this.symmetryAxis === 'x') {
                mirroredDisp.x = -mirroredDisp.x;
            } else if (this.symmetryAxis === 'y') {
                mirroredDisp.y = -mirroredDisp.y;
            } else if (this.symmetryAxis === 'z') {
                mirroredDisp.z = -mirroredDisp.z;
            }

            positions[closestIndex] += mirroredDisp.x;
            positions[closestIndex + 1] += mirroredDisp.y;
            positions[closestIndex + 2] += mirroredDisp.z;
        }
    }

    /**
     * Smooth vertices in area
     */
    smooth(hitPoint, iterations = 1) {
        const positions = this.positions.array;
        const vertexCount = positions.length / 3;

        for (let iter = 0; iter < iterations; iter++) {
            const newPositions = positions.slice();

            for (let i = 0; i < positions.length; i += 3) {
                const vertex = new THREE.Vector3(
                    positions[i],
                    positions[i + 1],
                    positions[i + 2]
                );

                const distance = vertex.distanceTo(hitPoint);

                if (distance <= this.currentBrush.size) {
                    // Average with neighbors (simplified - uses spatial proximity)
                    const neighbors = [];
                    const searchRadius = 0.1;

                    for (let j = 0; j < positions.length; j += 3) {
                        if (i === j) continue;

                        const neighbor = new THREE.Vector3(
                            positions[j],
                            positions[j + 1],
                            positions[j + 2]
                        );

                        if (vertex.distanceTo(neighbor) < searchRadius) {
                            neighbors.push(neighbor);
                        }
                    }

                    if (neighbors.length > 0) {
                        const avg = new THREE.Vector3();
                        neighbors.forEach(n => avg.add(n));
                        avg.divideScalar(neighbors.length);

                        const falloff = this.currentBrush.calculateFalloff(distance);

                        newPositions[i] = THREE.MathUtils.lerp(vertex.x, avg.x, falloff * this.currentBrush.strength);
                        newPositions[i + 1] = THREE.MathUtils.lerp(vertex.y, avg.y, falloff * this.currentBrush.strength);
                        newPositions[i + 2] = THREE.MathUtils.lerp(vertex.z, avg.z, falloff * this.currentBrush.strength);
                    }
                }
            }

            // Apply smoothed positions
            for (let i = 0; i < positions.length; i++) {
                positions[i] = newPositions[i];
            }
        }

        this.updateGeometry();
    }

    /**
     * Update geometry after sculpting
     */
    updateGeometry() {
        this.positions.needsUpdate = true;
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingBox();
        this.geometry.computeBoundingSphere();
    }

    /**
     * Save current state for undo
     */
    pushHistory() {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        const state = {
            positions: this.positions.array.slice(),
        };

        this.history.push(state);
        this.historyIndex++;

        if (this.history.length > 20) { // Limit to 20 states for memory
            this.history.shift();
            this.historyIndex--;
        }
    }

    /**
     * Undo last sculpt
     */
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const state = this.history[this.historyIndex];

            this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(state.positions), 3));
            this.positions = this.geometry.attributes.position;

            this.updateGeometry();
            console.log('↶ Undo sculpt');
        }
    }

    /**
     * Redo sculpt
     */
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const state = this.history[this.historyIndex];

            this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(state.positions), 3));
            this.positions = this.geometry.attributes.position;

            this.updateGeometry();
            console.log('↷ Redo sculpt');
        }
    }
}
