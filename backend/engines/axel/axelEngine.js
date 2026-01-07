/**
 * AXEL ENGINE - Advanced eXperimental Engineering Laboratory
 *
 * Sophisticated polygon mesh processing engine for AI-generated CAD geometry.
 * Analyzes, validates, optimizes, and prepares meshes for viewport rendering.
 *
 * Architecture:
 * - AI (Claude Sonnet 4.5): Generates complete design with geometry
 * - AXEL Engine: Validates, analyzes, optimizes, calculates normals
 * - Viewport: Renders the processed geometry
 *
 * Features:
 * - Comprehensive geometry validation
 * - Mesh quality analysis and reporting
 * - Automatic normal calculation (smooth shading)
 * - Degenerate face detection
 * - Bounding box computation
 * - Detailed logging for debugging
 */

class AxelEngine {
    constructor(options = {}) {
        this.optimizeMeshes = options.optimizeMeshes !== false;
        this.verbose = options.verbose !== false;

        console.log('🎮 AXEL ENGINE initialized');
        console.log('   Mode: Polygon Mesh Processing');
        console.log('   AI Source: Claude Sonnet 4.5');
        console.log('   Version: 2.0 (AI-Geometry Analyzer)');
    }

    /**
     * Process AI-generated mesh through AXEL pipeline
     * Performs validation, optimization, analysis, and normal calculation
     *
     * @param {Object} mesh - AI-generated mesh with vertices and faces
     * @returns {Object} Optimized and analyzed polygon mesh
     */
    processMesh(mesh) {
        console.log('\n⚙️  ========== AXEL ENGINE PROCESSING ==========');
        console.log(`📊 INPUT GEOMETRY (AI-Generated):`);
        console.log(`   Vertices: ${mesh.vertices?.length || 0}`);
        console.log(`   Faces: ${mesh.faces?.length || 0}`);
        console.log(`   Dimensions: ${JSON.stringify(mesh.dimensions || {})}`);

        if (!mesh || !mesh.vertices || !mesh.faces) {
            throw new Error('AXEL: Invalid mesh data - vertices and faces required');
        }

        const startTime = Date.now();

        // STEP 1: Validate and clean vertices
        console.log('\n🔍 STEP 1: Vertex Validation');
        const validVertices = this.validateAndCleanVertices(mesh.vertices);

        // STEP 2: Validate face topology
        console.log('\n🔍 STEP 2: Face Topology Validation');
        const validFaces = this.validateFaces(mesh.faces, validVertices.length);

        // STEP 3: Analyze mesh quality
        console.log('\n📈 STEP 3: Mesh Quality Analysis');
        const quality = this.analyzeMeshQuality(validVertices, validFaces);

        // STEP 4: Calculate bounding box
        console.log('\n📦 STEP 4: Bounding Box Calculation');
        const boundingBox = this.calculateBoundingBox(validVertices);

        // STEP 5: Calculate smooth normals
        console.log('\n💡 STEP 5: Normal Vector Calculation');
        const normals = this.calculateNormals(validVertices, validFaces);

        // Build final optimized mesh
        const optimizedMesh = {
            type: 'polygon_mesh',
            vertices: validVertices,
            faces: validFaces,
            normals: normals,
            boundingBox: boundingBox,
            dimensions: mesh.dimensions || boundingBox.size,
            metadata: {
                vertexCount: validVertices.length,
                faceCount: validFaces.length,
                normalCount: normals.length,
                engine: 'axel',
                version: '2.0',
                source: 'ai_generated',
                model: 'claude-sonnet-4.5',
                format: 'triangulated_mesh',
                processingTime: Date.now() - startTime,
                quality: quality,
                timestamp: new Date().toISOString()
            }
        };

        // Final summary
        console.log('\n✅ ========== AXEL PROCESSING COMPLETE ==========');
        console.log(`📊 OUTPUT GEOMETRY:`);
        console.log(`   Vertices: ${validVertices.length} (${validVertices.length - mesh.vertices.length >= 0 ? '+' : ''}${validVertices.length - mesh.vertices.length})`);
        console.log(`   Faces: ${validFaces.length} (${validFaces.length - mesh.faces.length >= 0 ? '+' : ''}${validFaces.length - mesh.faces.length})`);
        console.log(`   Normals: ${normals.length}`);
        console.log(`   Quality Score: ${quality.score}/100`);
        console.log(`   Bounding Box: ${boundingBox.size.x.toFixed(1)}×${boundingBox.size.y.toFixed(1)}×${boundingBox.size.z.toFixed(1)} mm`);
        console.log(`   Processing Time: ${Date.now() - startTime}ms`);
        console.log('===============================================\n');

        return optimizedMesh;
    }

    /**
     * Analyze mesh quality metrics
     */
    analyzeMeshQuality(vertices, faces) {
        let score = 100;
        const issues = [];
        const warnings = [];

        // Check for degenerate faces (zero area)
        let degenerateFaces = 0;
        for (const face of faces) {
            const [i0, i1, i2] = face;
            const v0 = vertices[i0];
            const v1 = vertices[i1];
            const v2 = vertices[i2];

            // Calculate area using cross product magnitude
            const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
            const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

            const cross = [
                edge1[1] * edge2[2] - edge1[2] * edge2[1],
                edge1[2] * edge2[0] - edge1[0] * edge2[2],
                edge1[0] * edge2[1] - edge1[1] * edge2[0]
            ];

            const area = Math.sqrt(cross[0]*cross[0] + cross[1]*cross[1] + cross[2]*cross[2]) / 2;

            if (area < 0.001) {
                degenerateFaces++;
            }
        }

        if (degenerateFaces > 0) {
            warnings.push(`${degenerateFaces} degenerate faces detected`);
            score -= Math.min(degenerateFaces, 10);
        }

        // Check vertex/face ratio (typical: 0.5-2.0)
        const ratio = vertices.length / faces.length;
        if (ratio < 0.3 || ratio > 3.0) {
            warnings.push(`Unusual vertex/face ratio: ${ratio.toFixed(2)}`);
            score -= 5;
        }

        console.log(`   Quality Score: ${score}/100`);
        if (degenerateFaces > 0) {
            console.log(`   ⚠️  ${degenerateFaces} degenerate faces (near-zero area)`);
        }
        if (warnings.length === 0) {
            console.log('   ✓ No mesh quality issues detected');
        }

        return { score, issues, warnings, degenerateFaces, vertexFaceRatio: ratio };
    }

    /**
     * Calculate bounding box of the mesh
     */
    calculateBoundingBox(vertices) {
        if (vertices.length === 0) {
            return { min: [0,0,0], max: [0,0,0], center: [0,0,0], size: {x:0, y:0, z:0} };
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (const [x, y, z] of vertices) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        const sizeX = maxX - minX;
        const sizeY = maxY - minY;
        const sizeZ = maxZ - minZ;

        const box = {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
            center: [(minX + maxX)/2, (minY + maxY)/2, (minZ + maxZ)/2],
            size: { x: sizeX, y: sizeY, z: sizeZ, units: 'mm' }
        };

        console.log(`   Min: [${minX.toFixed(1)}, ${minY.toFixed(1)}, ${minZ.toFixed(1)}]`);
        console.log(`   Max: [${maxX.toFixed(1)}, ${maxY.toFixed(1)}, ${maxZ.toFixed(1)}]`);
        console.log(`   Size: ${sizeX.toFixed(1)} × ${sizeY.toFixed(1)} × ${sizeZ.toFixed(1)} mm`);

        return box;
    }

    /**
     * Validate and clean vertex data
     */
    validateAndCleanVertices(vertices) {
        const cleaned = [];

        for (const vertex of vertices) {
            if (!Array.isArray(vertex) || vertex.length !== 3) {
                console.warn('⚠️  Invalid vertex format, skipping:', vertex);
                continue;
            }

            const [x, y, z] = vertex;

            // Check for null/NaN values
            if (x === null || y === null || z === null ||
                isNaN(x) || isNaN(y) || isNaN(z)) {
                console.warn('⚠️  Invalid vertex coordinates (null/NaN), skipping:', vertex);
                continue;
            }

            cleaned.push([Number(x), Number(y), Number(z)]);
        }

        console.log(`✓ Validated ${cleaned.length}/${vertices.length} vertices`);
        return cleaned;
    }

    /**
     * Validate face indices
     */
    validateFaces(faces, vertexCount) {
        const validated = [];

        for (const face of faces) {
            if (!Array.isArray(face) || face.length !== 3) {
                console.warn('⚠️  Invalid face format (not triangle), skipping:', face);
                continue;
            }

            const [i0, i1, i2] = face;

            // Check indices are valid
            if (i0 < 0 || i0 >= vertexCount ||
                i1 < 0 || i1 >= vertexCount ||
                i2 < 0 || i2 >= vertexCount) {
                console.warn('⚠️  Invalid face indices, skipping:', face);
                continue;
            }

            validated.push([i0, i1, i2]);
        }

        console.log(`✓ Validated ${validated.length}/${faces.length} faces`);
        return validated;
    }

    /**
     * Calculate vertex normals for smooth shading
     */
    calculateNormals(vertices, faces) {
        // Initialize normals to zero
        const normals = vertices.map(() => [0, 0, 0]);

        // Accumulate face normals for each vertex
        for (const face of faces) {
            const [i0, i1, i2] = face;

            const v0 = vertices[i0];
            const v1 = vertices[i1];
            const v2 = vertices[i2];

            // Calculate face normal using cross product
            const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
            const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

            const normal = [
                edge1[1] * edge2[2] - edge1[2] * edge2[1],
                edge1[2] * edge2[0] - edge1[0] * edge2[2],
                edge1[0] * edge2[1] - edge1[1] * edge2[0]
            ];

            // Add to each vertex of the face
            normals[i0][0] += normal[0]; normals[i0][1] += normal[1]; normals[i0][2] += normal[2];
            normals[i1][0] += normal[0]; normals[i1][1] += normal[1]; normals[i1][2] += normal[2];
            normals[i2][0] += normal[0]; normals[i2][1] += normal[1]; normals[i2][2] += normal[2];
        }

        // Normalize all normals
        for (let i = 0; i < normals.length; i++) {
            const [x, y, z] = normals[i];
            const length = Math.sqrt(x*x + y*y + z*z);

            if (length > 0) {
                normals[i] = [x/length, y/length, z/length];
            } else {
                normals[i] = [0, 1, 0]; // Default up vector
            }
        }

        console.log(`✓ Calculated ${normals.length} vertex normals`);
        return normals;
    }
}

module.exports = AxelEngine;

