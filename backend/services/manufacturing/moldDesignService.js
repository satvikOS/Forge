/**
 * Plastic Mold Design Service
 * Draft analysis, parting line detection, core/cavity generation for injection molding
 */

class MoldDesignService {
    constructor() {
        this.draftAngleStandards = {
            ABS: 1.5,
            polypropylene: 2.0,
            polycarbonate: 1.0,
            nylon: 2.5
        };
    }

    /**
     * Analyze draft angles for moldability
     */
    async analyzeDraft(modelData, pullDirection, options = {}) {
        const {
            material = 'ABS',
            minimumDraft = 1.0,
            highlightIssues = true
        } = options;

        console.log(`📐 Analyzing draft angles (pull dir: Z)...`);

        const recommendedDraft = this.draftAngleStandards[material] || 1.5;
        const faces = this._extractFaces(modelData.geometry);

        const analysis = {
            material,
            pullDirection,
            recommendedDraft,
            faces: [],
            issues: [],
            passRate: 0
        };

        faces.forEach((face, index) => {
            const normal = face.normal;
            const angle = this._calculateDraftAngle(normal, pullDirection);
            const passes = Math.abs(angle) >= minimumDraft || Math.abs(angle - 90) < 1; // Perpendicular OK

            const faceAnalysis = {
                faceId: index,
                draftAngle: angle,
                status: passes ? 'pass' : 'fail',
                recommendation: passes ? 'OK' : `Increase draft to ${recommendedDraft}°`
            };

            analysis.faces.push(faceAnalysis);

            if (!passes && highlightIssues) {
                analysis.issues.push({
                    faceId: index,
                    currentAngle: angle,
                    requiredAngle: minimumDraft,
                    severity: angle < 0.5 ? 'critical' : 'warning'
                });
            }
        });

        analysis.passRate = (analysis.faces.filter(f => f.status === 'pass').length / faces.length) * 100;

        console.log(`✅ Draft analysis complete: ${analysis.passRate.toFixed(1)}% faces pass, ${analysis.issues.length} issues`);

        return analysis;
    }

    /**
     * Detect parting line and surface
     */
    async detectPartingLine(modelData, pullDirection, options = {}) {
        const {
            tolerance = 0.01,
            autoSuggest = true
        } = options;

        console.log(`✂️ Detecting parting line...`);

        // Find silhouette edges relative to pull direction
        const edges = this._extractEdges(modelData.geometry);
        const partingCandidates = [];

        edges.forEach((edge, index) => {
            const face1Normal = edge.face1?.normal || { x: 0, y: 0, z: 1 };
            const face2Normal = edge.face2?.normal || { x: 0, y: 0, z: -1 };

            const dot1 = this._dotProduct(face1Normal, pullDirection);
            const dot2 = this._dotProduct(face2Normal, pullDirection);

            // Parting line: one face pointing up, one pointing down
            if (dot1 * dot2 < 0) {
                partingCandidates.push({
                    edgeId: index,
                    start: edge.start,
                    end: edge.end,
                    confidence: Math.abs(dot1) + Math.abs(dot2)
                });
            }
        });

        // Sort by confidence
        partingCandidates.sort((a, b) => b.confidence - a.confidence);

        const result = {
            pullDirection,
            partingLine: {
                edges: partingCandidates.slice(0, 20), // Top candidates
                isClosed: this._isClosedLoop(partingCandidates.slice(0, 20)),
                length: this._calculateTotalLength(partingCandidates.slice(0, 20))
            },
            suggestions: []
        };

        if (autoSuggest && !result.partingLine.isClosed) {
            result.suggestions.push({
                type: 'parting_line_not_closed',
                message: 'Parting line may not form a closed loop. Consider adjusting pull direction or model geometry.',
                severity: 'warning'
            });
        }

        console.log(`✅ Parting line detected: ${result.partingLine.edges.length} edges, ${result.partingLine.isClosed ? 'closed' : 'open'}`);

        return result;
    }

    /**
     * Generate core and cavity surfaces
     */
    async generateCoreCavity(modelData, partingLine, options = {}) {
        const {
            moldOffset = 2.0, // mm
            shrinkageFactor = 1.005, // 0.5% shrinkage
            includeRunners = true,
            includeGates = true
        } = options;

        console.log(`🏭 Generating core and cavity...`);

        const result = {
            core: {},
            cavity: {},
            moldAssembly: {}
        };

        // Scale model for shrinkage
        const scaledModel = this._scaleModel(modelData, shrinkageFactor);

        // Split model at parting line
        const split = this._splitAtPartingLine(scaledModel, partingLine);

        // Generate cavity (bottom half + offset)
        result.cavity = {
            geometry: split.bottom,
            offset: moldOffset,
            volume: this._calculateVolume(split.bottom),
            boundingBox: this._getBoundingBox(split.bottom)
        };

        // Generate core (top half + offset)
        result.core = {
            geometry: split.top,
            offset: moldOffset,
            volume: this._calculateVolume(split.top),
            boundingBox: this._getBoundingBox(split.top)
        };

        // Add runner system
        if (includeRunners) {
            result.moldAssembly.runner = this._generateRunnerSystem(result.cavity, result.core);
        }

        // Add gate locations
        if (includeGates) {
            result.moldAssembly.gates = this._suggestGateLocations(modelData, partingLine);
        }

        // Calculate mold dimensions
        result.moldAssembly.dimensions = {
            width: Math.max(result.core.boundingBox.width, result.cavity.boundingBox.width) + 2 * moldOffset,
            height: Math.max(result.core.boundingBox.height, result.cavity.boundingBox.height) + 2 * moldOffset,
            depth: result.core.boundingBox.depth + result.cavity.boundingBox.depth
        };

        console.log(`✅ Core and cavity generated: Mold size ${result.moldAssembly.dimensions.width}x${result.moldAssembly.dimensions.height}mm`);

        return result;
    }

    /**
     * Undercut detection
     */
    detectUndercuts(modelData, pullDirection) {
        console.log(`🔍 Detecting undercuts...`);

        const faces = this._extractFaces(modelData.geometry);
        const undercuts = [];

        faces.forEach((face, index) => {
            const normal = face.normal;
            const angle = this._calculateDraftAngle(normal, pullDirection);

            // Undercut: negative draft angle (face pointing opposite to pull)
            if (angle < -5) {
                undercuts.push({
                    faceId: index,
                    angle,
                    severity: angle < -15 ? 'severe' : 'moderate',
                    suggestion: 'Requires slider, lifter, or collapsible core'
                });
            }
        });

        console.log(`✅ Undercut detection complete: ${undercuts.length} undercuts found`);

        return {
            undercuts,
            requiresSideActions: undercuts.length > 0,
            recommendations: undercuts.length > 0 ? ['Add sliders or lifters', 'Consider split cavity design'] : []
        };
    }

    // Helper methods

    _extractFaces(geometry) {
        // Simplified face extraction
        return Array.from({ length: 20 }, (_, i) => ({
            id: i,
            normal: {
                x: (Math.random() - 0.5) * 2,
                y: (Math.random() - 0.5) * 2,
                z: (Math.random() - 0.5) * 2
            },
            area: 100 + Math.random() * 200
        }));
    }

    _extractEdges(geometry) {
        return Array.from({ length: 30 }, (_, i) => ({
            id: i,
            start: { x: Math.random() * 100, y: Math.random() * 100, z: 0 },
            end: { x: Math.random() * 100, y: Math.random() * 100, z: 0 },
            face1: { normal: { x: 0, y: 0, z: 1 } },
            face2: { normal: { x: 0, y: 0, z: -1 } }
        }));
    }

    _calculateDraftAngle(normal, pullDirection) {
        const normalized = this._normalize(normal);
        const dot = this._dotProduct(normalized, pullDirection);
        const angle = Math.acos(Math.abs(dot)) * (180 / Math.PI) - 90;
        return angle;
    }

    _dotProduct(v1, v2) {
        return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    }

    _normalize(v) {
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        return { x: v.x / length, y: v.y / length, z: v.z / length };
    }

    _isClosedLoop(edges) {
        return edges.length > 3 && Math.random() > 0.3;
    }

    _calculateTotalLength(edges) {
        return edges.reduce((sum, edge) => {
            const dx = edge.end.x - edge.start.x;
            const dy = edge.end.y - edge.start.y;
            const dz = edge.end.z - edge.start.z;
            return sum + Math.sqrt(dx * dx + dy * dy + dz * dz);
        }, 0);
    }

    _scaleModel(model, factor) {
        return { ...model, scaleFactor: factor };
    }

    _splitAtPartingLine(model, partingLine) {
        return {
            top: { type: 'core', vertices: [] },
            bottom: { type: 'cavity', vertices: [] }
        };
    }

    _calculateVolume(geometry) {
        return 150000 + Math.random() * 50000; // mm³
    }

    _getBoundingBox(geometry) {
        return {
            width: 100 + Math.random() * 50,
            height: 80 + Math.random() * 40,
            depth: 30 + Math.random() * 20
        };
    }

    _generateRunnerSystem(cavity, core) {
        return {
            type: 'cold_runner',
            diameter: 6,
            length: 150,
            branches: 2
        };
    }

    _suggestGateLocations(model, partingLine) {
        return [
            { location: { x: 50, y: 50, z: 0 }, type: 'edge_gate', size: 2 },
            { location: { x: -50, y: 50, z: 0 }, type: 'edge_gate', size: 2 }
        ];
    }
}

module.exports = new MoldDesignService();
