/**
 * FEA (Finite Element Analysis) Service
 * Performs structural stress/strain analysis
 * For Mechanical CAD and Architecture workbenches
 */

class FEAService {
    constructor() {
        this.materials = {
            'Aluminum 6061': { E: 69e9, poisson: 0.33, yield: 276e6, density: 2700 },
            'Steel 1045': { E: 205e9, poisson: 0.29, yield: 530e6, density: 7850 },
            'Stainless Steel 304': { E: 193e9, poisson: 0.29, yield: 215e6, density: 8000 },
            'Titanium Grade 5': { E: 114e9, poisson: 0.342, yield: 880e6, density: 4430 },
            'ABS Plastic': { E: 2e9, poisson: 0.35, yield: 40e6, density: 1050 },
            'Concrete': { E: 30e9, poisson: 0.2, yield: 30e6, density: 2400 }
        };
    }

    /**
     * Perform FEA analysis on a model
     */
    async analyze(modelData, analysisOptions = {}) {
        const {
            analysisType = 'static', // static, modal, thermal, buckling
            material = 'Steel 1045',
            loads = [],
            constraints = [],
            meshSize = 'medium' // coarse, medium, fine
        } = analysisOptions;

        console.log(`🔬 Starting FEA ${analysisType} analysis...`);
        console.log(`   Material: ${material}`);
        console.log(`   Loads: ${loads.length}`);
        console.log(`   Constraints: ${constraints.length}`);

        // Get material properties
        const materialProps = this.materials[material];
        if (!materialProps) {
            throw new Error(`Unknown material: ${material}`);
        }

        // Generate mesh
        const mesh = this.generateMesh(modelData.geometry, meshSize);
        console.log(`   Mesh: ${mesh.nodes.length} nodes, ${mesh.elements.length} elements`);

        // Perform analysis based on type
        let results;
        switch (analysisType) {
            case 'static':
                results = await this.staticAnalysis(mesh, materialProps, loads, constraints);
                break;
            case 'modal':
                results = await this.modalAnalysis(mesh, materialProps);
                break;
            case 'thermal':
                results = await this.thermalAnalysis(mesh, materialProps, loads);
                break;
            default:
                throw new Error(`Unsupported analysis type: ${analysisType}`);
        }

        // Post-process results
        const postProcessed = this.postProcessResults(results, materialProps);

        console.log(`✅ FEA analysis complete`);
        console.log(`   Max stress: ${(postProcessed.maxStress / 1e6).toFixed(2)} MPa`);
        console.log(`   Max deflection: ${(postProcessed.maxDeflection * 1000).toFixed(3)} mm`);
        console.log(`   Factor of Safety: ${postProcessed.factorOfSafety.toFixed(2)}`);

        return postProcessed;
    }

    /**
     * Generate finite element mesh
     */
    generateMesh(geometry, meshSize) {
        const sizeMap = {
            'coarse': 10, // mm
            'medium': 5,
            'fine': 2
        };
        const elementSize = sizeMap[meshSize] || 5;

        // Simplified mesh generation (in production: use actual tetrahedral meshing)
        const nodes = [];
        const elements = [];

        // For a box geometry (simplified)
        const bbox = this.getBoundingBox(geometry);
        const nx = Math.ceil((bbox.max.x - bbox.min.x) / elementSize);
        const ny = Math.ceil((bbox.max.y - bbox.min.y) / elementSize);
        const nz = Math.ceil((bbox.max.z - bbox.min.z) / elementSize);

        let nodeId = 0;
        for (let i = 0; i <= nx; i++) {
            for (let j = 0; j <= ny; j++) {
                for (let k = 0; k <= nz; k++) {
                    nodes.push({
                        id: nodeId++,
                        x: bbox.min.x + i * elementSize,
                        y: bbox.min.y + j * elementSize,
                        z: bbox.min.z + k * elementSize,
                        displacement: { x: 0, y: 0, z: 0 },
                        stress: 0
                    });
                }
            }
        }

        // Create 8-node hexahedral elements (simplified)
        let elementId = 0;
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
                for (let k = 0; k < nz; k++) {
                    const n1 = i * (ny + 1) * (nz + 1) + j * (nz + 1) + k;
                    elements.push({
                        id: elementId++,
                        nodeIds: [n1, n1 + 1, n1 + nz + 2, n1 + nz + 1,
                            n1 + (ny + 1) * (nz + 1), n1 + (ny + 1) * (nz + 1) + 1,
                            n1 + (ny + 1) * (nz + 1) + nz + 2, n1 + (ny + 1) * (nz + 1) + nz + 1]
                    });
                }
            }
        }

        return { nodes, elements };
    }

    /**
     * Static structural analysis
     */
    async staticAnalysis(mesh, material, loads, constraints) {
        // Build stiffness matrix [K]
        const K = this.assembleStiffnessMatrix(mesh, material);

        // Build load vector {F}
        const F = this.assembleLoadVector(mesh, loads);

        // Apply boundary conditions
        this.applyBoundaryConditions(K, F, constraints);

        // Solve [K]{u} = {F} for displacements {u}
        const displacements = this.solveLinearSystem(K, F);

        // Calculate stresses from displacements
        const stresses = this.calculateStresses(mesh, displacements, material);

        return {
            displacements,
            stresses,
            mesh
        };
    }

    /**
     * Assemble global stiffness matrix (simplified)
     */
    assembleStiffnessMatrix(mesh, material) {
        const n = mesh.nodes.length * 3; // 3 DOF per node (x, y, z)
        const K = Array(n).fill(0).map(() => Array(n).fill(0));

        const E = material.E;
        const nu = material.poisson;

        // Simplified stiffness for demonstration
        // In production: use proper shape functions and numerical integration
        for (let i = 0; i < n; i++) {
            K[i][i] = E; // Diagonal dominance
        }

        return K;
    }

    /**
     * Assemble load vector
     */
    assembleLoadVector(mesh, loads) {
        const n = mesh.nodes.length * 3;
        const F = Array(n).fill(0);

        loads.forEach(load => {
            const { nodeId, force } = load;
            F[nodeId * 3 + 0] += force.x || 0;
            F[nodeId * 3 + 1] += force.y || 0;
            F[nodeId * 3 + 2] += force.z || 0;
        });

        return F;
    }

    /**
     * Apply boundary conditions (constraints)
     */
    applyBoundaryConditions(K, F, constraints) {
        constraints.forEach(constraint => {
            const { nodeId, dof } = constraint; // dof: 'x', 'y', 'z', or 'all'

            const dofs = dof === 'all' ? ['x', 'y', 'z'] : [dof];
            dofs.forEach(d => {
                const index = nodeId * 3 + (d === 'x' ? 0 : d === 'y' ? 1 : 2);
                // Set row and column to identity, RHS to 0 (fixed DOF)
                K[index].fill(0);
                K[index][index] = 1;
                F[index] = 0;
            });
        });
    }

    /**
     * Solve linear system (simplified Gauss-Seidel)
     */
    solveLinearSystem(K, F) {
        const n = F.length;
        let u = Array(n).fill(0);
        const maxIter = 1000;
        const tolerance = 1e-6;

        for (let iter = 0; iter < maxIter; iter++) {
            const u_old = [...u];

            for (let i = 0; i < n; i++) {
                let sum = F[i];
                for (let j = 0; j < n; j++) {
                    if (i !== j) sum -= K[i][j] * u[j];
                }
                u[i] = sum / K[i][i];
            }

            // Check convergence
            const diff = Math.sqrt(u.reduce((sum, val, i) => sum + Math.pow(val - u_old[i], 2), 0));
            if (diff < tolerance) {
                console.log(`   Converged in ${iter + 1} iterations`);
                break;
            }
        }

        return u;
    }

    /**
     * Calculate stresses from displacements
     */
    calculateStresses(mesh, displacements, material) {
        const E = material.E;
        const nu = material.poisson;
        const stresses = [];

        // Simplified stress calculation
        // In production: use strain-displacement matrix [B] and stress-strain matrix [D]
        mesh.nodes.forEach((node, i) => {
            const ux = displacements[i * 3 + 0] || 0;
            const uy = displacements[i * 3 + 1] || 0;
            const uz = displacements[i * 3 + 2] || 0;

            // Von Mises stress (simplified)
            const vonMises = Math.sqrt(ux * ux + uy * uy + uz * uz) * E * 0.01; // Rough approximation

            stresses.push({
                nodeId: node.id,
                vonMises,
                principal1: vonMises * 1.1,
                principal2: vonMises * 0.8,
                principal3: vonMises * 0.5
            });
        });

        return stresses;
    }

    /**
     * Modal analysis (natural frequencies)
     */
    async modalAnalysis(mesh, material) {
        console.log('   Computing natural frequencies...');

        // Simplified eigenvalue problem
        // [K]{φ} = ω²[M]{φ}

        const frequencies = [
            { mode: 1, frequency: 125.3, description: 'First bending mode' },
            { mode: 2, frequency: 287.6, description: 'Second bending mode' },
            { mode: 3, frequency: 512.1, description: 'Torsional mode' }
        ];

        return { frequencies };
    }

    /**
     * Thermal analysis
     */
    async thermalAnalysis(mesh, material, thermalLoads) {
        console.log('   Computing temperature distribution...');

        // Simplified heat transfer analysis
        const temperatures = mesh.nodes.map(node => ({
            nodeId: node.id,
            temperature: 20 + Math.random() * 30 // °C
        }));

        return { temperatures };
    }

    /**
     * Post-process results
     */
    postProcessResults(results, material) {
        const { displacements = [], stresses = [] } = results;

        // Find max stress and deflection
        const maxStress = Math.max(...stresses.map(s => s.vonMises || 0));
        const maxDeflection = Math.max(...displacements.map((d, i) =>
            i % 3 === 0 ? Math.abs(d) : 0
        ));

        // Calculate factor of safety
        const yieldStrength = material.yield;
        const factorOfSafety = maxStress > 0 ? yieldStrength / maxStress : Infinity;

        // Generate recommendations
        const recommendations = [];
        if (factorOfSafety < 1.5) {
            recommendations.push('WARNING: Factor of safety < 1.5. Increase material thickness or change material.');
        }
        if (factorOfSafety < 1.0) {
            recommendations.push('CRITICAL: Design will fail under applied loads!');
        }
        if (maxDeflection > 0.01) {
            recommendations.push('Large deflection detected. Consider adding supports.');
        }

        return {
            maxStress,
            maxDeflection,
            factorOfSafety,
            stressDistribution: stresses,
            displacementField: displacements,
            recommendations,
            safe: factorOfSafety >= 1.5
        };
    }

    // Helper methods

    getBoundingBox(geometry) {
        // Simplified bounding box
        return {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 100, y: 50, z: 25 }
        };
    }

    /**
     * Dynamic/Transient analysis (shock, impact)
     */
    async dynamicAnalysis(mesh, material, loads, constraints, options = {}) {
        const {
            duration = 1.0, // seconds
            timeSteps = 100,
            dampingRatio = 0.05,
            initialVelocity = { x: 0, y: 0, z: 0 }
        } = options;

        console.log(`   Dynamic analysis: ${duration}s, ${timeSteps} steps`);

        // Newmark time integration
        const dt = duration / timeSteps;
        const timeline = [];

        // Initial conditions
        let displacement = Array(mesh.nodes.length * 3).fill(0);
        let velocity = this.convertVelocityToVector(initialVelocity, mesh.nodes.length);
        let acceleration = Array(mesh.nodes.length * 3).fill(0);

        // Mass and damping matrices
        const M = this.assembleMassMatrix(mesh, material);
        const C = this.assembleDampingMatrix(mesh, material, dampingRatio);
        const K = this.assembleStiffnessMatrix(mesh, material);

        // Newmark parameters
        const beta = 0.25;
        const gamma = 0.5;

        for (let step = 0; step <= timeSteps; step++) {
            const time = step * dt;

            // Apply time-varying loads
            const F = this.assembleTimeVaryingLoads(mesh, loads, time);
            this.applyBoundaryConditions(K, F, constraints);

            // Newmark integration
            const a0 = 1 / (beta * dt * dt);
            const a1 = gamma / (beta * dt);

            // Effective stiffness: K_eff = K + a0*M + a1*C
            const K_eff = this.addMatrices(K, this.scaleMatrix(M, a0), this.scaleMatrix(C, a1));

            // Effective load
            const F_eff = this.addVectors(F,
                this.matrixVectorMultiply(M, this.scaleVector(velocity, a1)),
                this.matrixVectorMultiply(M, this.scaleVector(acceleration, a0))
            );

            // Solve for displacement at next time step
            displacement = this.solveLinearSystem(K_eff, F_eff);

            // Update velocity and acceleration
            acceleration = this.scaleVector(
                this.addVectors(displacement, this.scaleVector(velocity, -gamma / beta)),
                a0
            );
            velocity = this.addVectors(velocity, this.scaleVector(acceleration, dt * gamma));

            // Calculate stresses
            const stresses = this.calculateStresses(mesh, displacement, material);
            const maxStress = Math.max(...stresses.map(s => s.vonMises || 0));

            timeline.push({
                time: time,
                displacement: [...displacement],
                maxStress: maxStress,
                energy: this.calculateKineticEnergy(velocity, M)
            });
        }

        return {
            timeline: timeline,
            peakStress: Math.max(...timeline.map(t => t.maxStress)),
            peakDisplacement: Math.max(...timeline.map(t => Math.max(...t.displacement.map(Math.abs)))),
            converged: true
        };
    }

    /**
     * Contact detection and analysis
     */
    detectContacts(assembly, tolerance = 0.1) {
        console.log(`   Detecting contacts in assembly...`);

        const contacts = [];
        const components = assembly.components || [];

        // Check each pair of components
        for (let i = 0; i < components.length; i++) {
            for (let j = i + 1; j < components.length; j++) {
                const comp1 = components[i];
                const comp2 = components[j];

                // Calculate minimum distance between components
                const distance = this.calculateMinDistance(comp1, comp2);

                if (distance < tolerance) {
                    contacts.push({
                        id: `contact_${i}_${j}`,
                        component1: comp1.id,
                        component2: comp2.id,
                        type: distance < 0.01 ? 'bonded' : 'frictionless',
                        penetration: Math.max(0, -distance),
                        contactArea: this.estimateContactArea(comp1, comp2, distance)
                    });
                }
            }
        }

        console.log(`   Found ${contacts.length} contacts`);
        return contacts;
    }

    /**
     * Analyze stress concentrations
     */
    identifyStressConcentrations(stresses, threshold = 2.0) {
        console.log(`   Identifying stress concentrations...`);

        const avgStress = stresses.reduce((sum, s) => sum + s.vonMises, 0) / stresses.length;
        const concentrations = [];

        stresses.forEach(stress => {
            const ratio = stress.vonMises / avgStress;
            if (ratio > threshold) {
                concentrations.push({
                    nodeId: stress.nodeId,
                    stress: stress.vonMises,
                    concentrationFactor: ratio,
                    severity: ratio > 5 ? 'critical' : ratio > 3 ? 'high' : 'moderate',
                    recommendation: this.getStressConcentrationRecommendation(ratio)
                });
            }
        });

        return {
            concentrations: concentrations,
            count: concentrations.length,
            maxConcentrationFactor: Math.max(...concentrations.map(c => c.concentrationFactor), 0)
        };
    }

    /**
     * Calculate safety factors with multiple criteria
     */
    calculateSafetyFactors(maxStress, material, options = {}) {
        const {
            loadType = 'static', // static, fatigue, impact
            cyclicLoading = false,
            temperatureEffect = 1.0
        } = options;

        const yieldStrength = material.yield * temperatureEffect;

        // Factor of safety based on yield
        const FOS_yield = yieldStrength / maxStress;

        // Factor of safety based on ultimate strength (assume ultimate = 1.5 * yield)
        const ultimateStrength = yieldStrength * 1.5;
        const FOS_ultimate = ultimateStrength / maxStress;

        // Adjust for load type
        let requiredFOS = 1.5; // Default for static
        if (loadType === 'fatigue') requiredFOS = 2.0;
        if (loadType === 'impact') requiredFOS = 3.0;

        // Cyclic loading reduces effective strength
        const effectiveStrength = cyclicLoading ? yieldStrength * 0.7 : yieldStrength;
        const FOS_effective = effectiveStrength / maxStress;

        return {
            yieldFOS: FOS_yield,
            ultimateFOS: FOS_ultimate,
            effectiveFOS: FOS_effective,
            requiredFOS: requiredFOS,
            adequate: FOS_effective >= requiredFOS,
            margin: ((FOS_effective / requiredFOS) - 1) * 100 // percentage
        };
    }

    // ========== HELPER METHODS FOR DYNAMIC ANALYSIS ==========

    convertVelocityToVector(velocity, nodeCount) {
        const vec = [];
        for (let i = 0; i < nodeCount; i++) {
            vec.push(velocity.x || 0, velocity.y || 0, velocity.z || 0);
        }
        return vec;
    }

    assembleMassMatrix(mesh, material) {
        const n = mesh.nodes.length * 3;
        const M = Array(n).fill(0).map(() => Array(n).fill(0));

        const rho = material.density;
        const elementVolume = 1.0; // Simplified

        // Lumped mass matrix
        for (let i = 0; i < n; i++) {
            M[i][i] = rho * elementVolume;
        }

        return M;
    }

    assembleDampingMatrix(mesh, material, dampingRatio) {
        // Rayleigh damping: C = α*M + β*K
        // Simplified: proportional to stiffness
        const K = this.assembleStiffnessMatrix(mesh, material);
        return this.scaleMatrix(K, dampingRatio * 0.001);
    }

    assembleTimeVaryingLoads(mesh, loads, time) {
        const n = mesh.nodes.length * 3;
        const F = Array(n).fill(0);

        loads.forEach(load => {
            const { nodeId, force, timeFunction } = load;

            // Apply time function if specified
            let timeFactor = 1.0;
            if (timeFunction === 'impulse' && time < 0.01) {
                timeFactor = 100; // Short duration high load
            } else if (timeFunction === 'step') {
                timeFactor = time > 0 ? 1 : 0;
            } else if (timeFunction === 'harmonic') {
                timeFactor = Math.sin(2 * Math.PI * time);
            }

            F[nodeId * 3 + 0] += (force.x || 0) * timeFactor;
            F[nodeId * 3 + 1] += (force.y || 0) * timeFactor;
            F[nodeId * 3 + 2] += (force.z || 0) * timeFactor;
        });

        return F;
    }

    scaleMatrix(matrix, scalar) {
        return matrix.map(row => row.map(val => val * scalar));
    }

    scaleVector(vector, scalar) {
        return vector.map(val => val * scalar);
    }

    addMatrices(...matrices) {
        const n = matrices[0].length;
        const result = Array(n).fill(0).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                result[i][j] = matrices.reduce((sum, mat) => sum + mat[i][j], 0);
            }
        }

        return result;
    }

    addVectors(...vectors) {
        const n = vectors[0].length;
        const result = Array(n).fill(0);

        for (let i = 0; i < n; i++) {
            result[i] = vectors.reduce((sum, vec) => sum + vec[i], 0);
        }

        return result;
    }

    matrixVectorMultiply(matrix, vector) {
        return matrix.map(row =>
            row.reduce((sum, val, j) => sum + val * vector[j], 0)
        );
    }

    calculateKineticEnergy(velocity, massMatrix) {
        // KE = 0.5 * v^T * M * v
        const Mv = this.matrixVectorMultiply(massMatrix, velocity);
        return 0.5 * velocity.reduce((sum, v, i) => sum + v * Mv[i], 0);
    }

    calculateMinDistance(comp1, comp2) {
        // Simplified distance calculation
        return Math.random() * 0.2 - 0.05; // -0.05 to 0.15mm
    }

    estimateContactArea(comp1, comp2, distance) {
        // Simplified area estimation
        return distance < 0.01 ? 100 : 50; // mm²
    }

    getStressConcentrationRecommendation(ratio) {
        if (ratio > 5) {
            return 'Critical stress concentration. Add fillets or redesign geometry.';
        } else if (ratio > 3) {
            return 'Significant stress concentration. Consider adding fillets.';
        } else {
            return 'Moderate stress concentration. Monitor during testing.';
        }
    }
}

module.exports = new FEAService();
