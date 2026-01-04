/**
 * Modal Analysis Service  
 * Natural frequency and vibration mode analysis
 */

class ModalAnalysisService {
    constructor() {
        this.maxModes = 20;
    }

    /**
     * Run modal analysis
     */
    async analyze(modelData, options = {}) {
        const {
            numModes = 10,
            frequencyRange = { min: 0, max: 10000 }, // Hz
            dampingRatio = 0.05,
            materials = [],
            constraints = []
        } = options;

        console.log(`🎵 Running modal analysis for ${numModes} modes...`);

        // Validate
        if (numModes > this.maxModes) {
            throw new Error(`Maximum ${this.maxModes} modes supported`);
        }

        // Prepare structural model
        const structuralModel = this.prepareStructuralModel(modelData, materials, constraints);

        // Calculate mass and stiffness matrices
        const matrices = this.calculateMatrices(structuralModel);

        // Solve eigenvalue problem
        const modes = this.solveEigenvalueProblem(matrices, numModes);

        // Apply frequency range filter
        const filteredModes = modes.filter(m =>
            m.frequency >= frequencyRange.min && m.frequency <= frequencyRange.max
        );

        // Calculate damping
        const dampedModes = this.applyDamping(filteredModes, dampingRatio);

        // Detect resonance risks
        const resonanceAnalysis = this.analyzeResonance(dampedModes);

        console.log(`✅ Modal analysis complete. Found ${filteredModes.length} modes.`);

        return {
            success: true,
            modes: dampedModes,
            resonanceAnalysis: resonanceAnalysis,
            fundamentalFrequency: dampedModes[0]?.frequency || 0,
            report: this.generateModalReport(dampedModes, resonanceAnalysis)
        };
    }

    /**
     * Prepare structural model
     */
    prepareStructuralModel(modelData, materials, constraints) {
        return {
            geometry: modelData.geometry,
            mass: this.calculateMass(modelData, materials),
            stiffness: this.estimateStiffness(modelData, materials),
            constraints: constraints,
            nodes: this.generateNodes(modelData.geometry, 500)
        };
    }

    /**
     * Calculate total mass
     */
    calculateMass(modelData, materials) {
        const volume = modelData.volume || 1000; // mm³
        const density = materials[0]?.density || 7850; // kg/m³

        return (volume / 1e9) * density; // kg
    }

    /**
     * Estimate stiffness
     */
    estimateStiffness(modelData, materials) {
        const E = materials[0]?.elasticModulus || 200e9; // Pa
        const I = 1e-6; // m⁴ (simplified)
        const L = 0.1; // m (simplified)

        return (3 * E * I) / Math.pow(L, 3); // N/m
    }

    /**
     * Generate nodes
     */
    generateNodes(geometry, count) {
        const nodes = [];
        for (let i = 0; i < count; i++) {
            nodes.push({
                id: i,
                x: Math.random() * 100,
                y: Math.random() * 100,
                z: Math.random() * 100,
                mass: 0.001
            });
        }
        return nodes;
    }

    /**
     * Calculate mass and stiffness matrices
     */
    calculateMatrices(model) {
        const n = model.nodes.length;

        // Simplified matrices (in production: use FEM assembly)
        const M = this.createMatrix(n, n); // Mass matrix
        const K = this.createMatrix(n, n); // Stiffness matrix

        // Fill diagonal with simplified values
        for (let i = 0; i < n; i++) {
            M[i][i] = model.nodes[i].mass;
            K[i][i] = model.stiffness / n;
        }

        return { M, K };
    }

    /**
     * Solve eigenvalue problem: K*phi = omega²*M*phi
     */
    solveEigenvalueProblem(matrices, numModes) {
        const { M, K } = matrices;
        const modes = [];

        // Simplified eigenvalue solver
        // In production: use proper numerical methods (Lanczos, Arnoldi)
        for (let i = 0; i < numModes; i++) {
            const eigenvalue = (K[i][i] / M[i][i]) * (i + 1); // Simplified
            const frequency = Math.sqrt(eigenvalue) / (2 * Math.PI); // Hz

            modes.push({
                modeNumber: i + 1,
                frequency: frequency,
                period: 1 / frequency,
                angularFrequency: 2 * Math.PI * frequency,
                eigenvalue: eigenvalue,
                modeShape: this.generateModeShape(i, matrices.M.length),
                modalMass: 1.0,
                modalStiffness: eigenvalue
            });
        }

        return modes.sort((a, b) => a.frequency - b.frequency);
    }

    /**
     * Generate mode shape vector
     */
    generateModeShape(modeNum, nodeCount) {
        const shape = [];
        for (let i = 0; i < nodeCount; i++) {
            // Simplified sinusoidal mode shape
            const amplitude = Math.sin((modeNum + 1) * Math.PI * i / nodeCount);
            shape.push({
                nodeId: i,
                displacement: {
                    x: amplitude * Math.random(),
                    y: amplitude * Math.random(),
                    z: amplitude
                }
            });
        }
        return shape;
    }

    /**
     * Apply damping
     */
    applyDamping(modes, dampingRatio) {
        return modes.map(mode => {
            const omega_n = mode.angularFrequency;
            const omega_d = omega_n * Math.sqrt(1 - dampingRatio * dampingRatio);

            return {
                ...mode,
                dampingRatio: dampingRatio,
                dampedFrequency: omega_d / (2 * Math.PI),
                dampedPeriod: 2 * Math.PI / omega_d
            };
        });
    }

    /**
     * Analyze resonance risks
     */
    analyzeResonance(modes) {
        const operatingFrequencies = [50, 60, 100]; // Hz (power line, motor, etc.)
        const resonanceThreshold = 0.1; // 10% tolerance

        const risks = [];

        modes.forEach(mode => {
            operatingFrequencies.forEach(opFreq => {
                const ratio = Math.abs(mode.frequency - opFreq) / opFreq;

                if (ratio < resonanceThreshold) {
                    risks.push({
                        mode: mode.modeNumber,
                        naturalFrequency: mode.frequency,
                        operatingFrequency: opFreq,
                        proximity: ratio,
                        severity: ratio < 0.05 ? 'high' : 'medium',
                        recommendation: `Mode ${mode.modeNumber} (${mode.frequency.toFixed(2)} Hz) is close to operating frequency ${opFreq} Hz`
                    });
                }
            });
        });

        return {
            risksDetected: risks.length > 0,
            riskCount: risks.length,
            risks: risks,
            summary: this.summarizeResonance(risks)
        };
    }

    /**
     * Summarize resonance analysis
     */
    summarizeResonance(risks) {
        if (risks.length === 0) {
            return '✅ No resonance risks detected';
        }

        const highRisk = risks.filter(r => r.severity === 'high').length;
        const mediumRisk = risks.filter(r => r.severity === 'medium').length;

        return `⚠️ ${risks.length} resonance risk(s) detected: ${highRisk} high, ${mediumRisk} medium`;
    }

    /**
     * Generate modal analysis report
     */
    generateModalReport(modes, resonanceAnalysis) {
        return {
            summary: {
                totalModes: modes.length,
                fundamentalFrequency: modes[0]?.frequency.toFixed(2) + ' Hz',
                highestFrequency: modes[modes.length - 1]?.frequency.toFixed(2) + ' Hz',
                resonanceRisk: resonanceAnalysis.summary
            },
            modeTable: modes.map(m => ({
                mode: m.modeNumber,
                frequency: m.frequency.toFixed(2) + ' Hz',
                period: m.period.toFixed(4) + ' s',
                damping: (m.dampingRatio * 100).toFixed(1) + '%'
            })),
            recommendations: this.generateRecommendations(modes, resonanceAnalysis)
        };
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(modes, resonanceAnalysis) {
        const recommendations = [];

        if (modes[0].frequency < 10) {
            recommendations.push('⚠️ Low fundamental frequency (<10 Hz). Consider stiffening the structure.');
        }

        if (resonanceAnalysis.risksDetected) {
            recommendations.push('⚠️ Resonance risks detected. Consider damping or frequency shift.');
        }

        if (recommendations.length === 0) {
            recommendations.push('✅ Modal characteristics are acceptable.');
        }

        return recommendations;
    }

    // Helper method
    createMatrix(rows, cols) {
        const matrix = [];
        for (let i = 0; i < rows; i++) {
            matrix[i] = new Array(cols).fill(0);
        }
        return matrix;
    }
}

module.exports = new ModalAnalysisService();
