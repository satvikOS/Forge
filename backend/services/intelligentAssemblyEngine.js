/**
 * INTELLIGENT ASSEMBLY ENGINE
 *
 * Positions parallel-generated components in precise 3D space using engineering
 * coordinates. Understands mechanical relationships and ensures proper assembly.
 */

class IntelligentAssemblyEngine {
    constructor() {
        console.log('🤖 Intelligent Assembly Engine initialized');
    }

    /**
     * Assemble components with intelligent 3D positioning
     *
     * @param {Array} componentResults - Array of component generation results
     * @param {Object} template - Component template with positioning data
     * @returns {Object} Assembled geometry with properly positioned components
     */
    assembleWithIntelligentPositioning(componentResults, template) {
        console.log('\n🔧 === INTELLIGENT ASSEMBLY START ===');
        console.log(`   Components to assemble: ${componentResults.length}`);

        const finalGeometry = {
            vertices: [],
            faces: [],
            edges: [],
            components: [],
            metadata: {
                coordinateSystem: 'Right-hand rule, Z-up',
                origin: 'Engine crankshaft centerline',
                units: 'millimeters'
            }
        };

        let vertexOffset = 0;

        for (const result of componentResults) {
            const { component, geometry } = result;

            console.log(`\n📐 Positioning: ${component.name}`);

            // Get positioning data from component
            const position = component.position || { x: 0, y: 0, z: 0 };
            const rotation = component.rotation || { x: 0, y: 0, z: 0 };
            const scale = component.scale || { x: 1, y: 1, z: 1 };

            console.log(`   Translation: [${position.x}, ${position.y}, ${position.z}] mm`);
            console.log(`   Rotation: [${rotation.x}°, ${rotation.y}°, ${rotation.z}°]`);
            console.log(`   Scale: [${scale.x}, ${scale.y}, ${scale.z}]`);

            // Transform vertices to world coordinates
            const transformedVertices = geometry.vertices.map(vertex => {
                let [x, y, z] = vertex;

                // Apply scale
                x *= scale.x;
                y *= scale.y;
                z *= scale.z;

                // Apply rotation (ZYX Euler angles)
                const transformed = this.rotatePoint([x, y, z], rotation);

                // Apply translation
                return [
                    transformed[0] + position.x,
                    transformed[1] + position.y,
                    transformed[2] + position.z
                ];
            });

            // Add transformed vertices
            finalGeometry.vertices.push(...transformedVertices);

            // Add faces with vertex offset
            const offsetFaces = geometry.faces.map(face =>
                face.map(v => v + vertexOffset)
            );
            finalGeometry.faces.push(...offsetFaces);

            // Add edges with vertex offset
            if (geometry.edges) {
                const offsetEdges = geometry.edges.map(edge =>
                    edge.map(v => v + vertexOffset)
                );
                finalGeometry.edges.push(...offsetEdges);
            }

            // Record component metadata
            finalGeometry.components.push({
                id: component.id,
                name: component.name,
                vertexStart: vertexOffset,
                vertexEnd: vertexOffset + transformedVertices.length - 1,
                vertexCount: transformedVertices.length,
                position: position,
                rotation: rotation,
                boundingBox: this.calculateBoundingBox(transformedVertices)
            });

            vertexOffset += transformedVertices.length;

            console.log(`   ✅ Positioned ${transformedVertices.length} vertices`);
        }

        // Validate assembly
        console.log('\n✅ Assembly Validation:');
        console.log(`   Total vertices: ${finalGeometry.vertices.length}`);
        console.log(`   Total faces: ${finalGeometry.faces.length}`);
        console.log(`   Components assembled: ${finalGeometry.components.length}`);

        // Calculate overall bounding box
        finalGeometry.boundingBox = this.calculateBoundingBox(finalGeometry.vertices);
        console.log(`   Bounding box: ${JSON.stringify(finalGeometry.boundingBox)}`);

        console.log('\n🎉 === INTELLIGENT ASSEMBLY COMPLETE ===');

        return finalGeometry;
    }

    /**
     * Rotate a point using Euler angles (ZYX order)
     */
    rotatePoint(point, rotation) {
        let [x, y, z] = point;
        const { x: rx, y: ry, z: rz } = rotation;

        // Convert degrees to radians
        const rxRad = rx * Math.PI / 180;
        const ryRad = ry * Math.PI / 180;
        const rzRad = rz * Math.PI / 180;

        // Rotation around Z-axis
        if (rz !== 0) {
            const cosZ = Math.cos(rzRad);
            const sinZ = Math.sin(rzRad);
            const newX = x * cosZ - y * sinZ;
            const newY = x * sinZ + y * cosZ;
            x = newX;
            y = newY;
        }

        // Rotation around Y-axis
        if (ry !== 0) {
            const cosY = Math.cos(ryRad);
            const sinY = Math.sin(ryRad);
            const newX = x * cosY + z * sinY;
            const newZ = -x * sinY + z * cosY;
            x = newX;
            z = newZ;
        }

        // Rotation around X-axis
        if (rx !== 0) {
            const cosX = Math.cos(rxRad);
            const sinX = Math.sin(rxRad);
            const newY = y * cosX - z * sinX;
            const newZ = y * sinX + z * cosX;
            y = newY;
            z = newZ;
        }

        return [x, y, z];
    }

    /**
     * Calculate bounding box for vertices
     */
    calculateBoundingBox(vertices) {
        if (vertices.length === 0) {
            return { min: [0, 0, 0], max: [0, 0, 0] };
        }

        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];

        for (const vertex of vertices) {
            min[0] = Math.min(min[0], vertex[0]);
            min[1] = Math.min(min[1], vertex[1]);
            min[2] = Math.min(min[2], vertex[2]);
            max[0] = Math.max(max[0], vertex[0]);
            max[1] = Math.max(max[1], vertex[1]);
            max[2] = Math.max(max[2], vertex[2]);
        }

        return { min, max };
    }

    /**
     * Validate component interfaces (check if components align properly)
     */
    validateInterfaces(components) {
        console.log('\n🔍 Validating component interfaces...');

        const issues = [];

        // Check for overlapping components
        for (let i = 0; i < components.length; i++) {
            for (let j = i + 1; j < components.length; j++) {
                const comp1 = components[i];
                const comp2 = components[j];

                if (this.boundingBoxesOverlap(comp1.boundingBox, comp2.boundingBox)) {
                    // Overlapping bounding boxes - might be intentional (e.g., piston in cylinder)
                    console.log(`   ⚠️  ${comp1.name} and ${comp2.name} have overlapping bounding boxes`);
                }
            }
        }

        return issues;
    }

    /**
     * Check if two bounding boxes overlap
     */
    boundingBoxesOverlap(bb1, bb2) {
        return (
            bb1.min[0] <= bb2.max[0] && bb1.max[0] >= bb2.min[0] &&
            bb1.min[1] <= bb2.max[1] && bb1.max[1] >= bb2.min[1] &&
            bb1.min[2] <= bb2.max[2] && bb1.max[2] >= bb2.min[2]
        );
    }
}

module.exports = new IntelligentAssemblyEngine();
