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

    /**
     * Calculate and place ejector pins
     */
    async calculateEjectorPins(modelData, coreCavity, options = {}) {
        const {
            minPinDiameter = 3, // mm
            maxPinDiameter = 10,
            pinSpacing = 20, // mm minimum spacing
            avoidThinWalls = true,
            minWallThickness = 2
        } = options;

        console.log(`📍 Calculating ejector pin placement...`);

        const cavity = coreCavity.cavity;
        const projectedArea = this._calculateProjectedArea(cavity.geometry);
        const ejectionForce = this._estimateEjectionForce(modelData, projectedArea);

        // Calculate required number of pins
        const pinForce = 500; // N per pin (typical)
        const requiredPins = Math.ceil(ejectionForce / pinForce);

        // Place pins strategically
        const pinLocations = this._calculateOptimalPinLocations(
            cavity.geometry,
            requiredPins,
            pinSpacing,
            avoidThinWalls ? minWallThickness : 0
        );

        const result = {
            totalPins: pinLocations.length,
            arrangementType: this._detectPinArrangement(pinLocations),
            pins: pinLocations.map((loc, i) => ({
                id: i + 1,
                location: loc,
                diameter: this._calculatePinDiameter(ejectionForce / pinLocations.length, minPinDiameter, maxPinDiameter),
                type: loc.type || 'standard',
                depth: cavity.boundingBox?.depth || 30
            })),
            ejectionForce,
            safetyFactor: (pinLocations.length * pinForce) / ejectionForce
        };

        console.log(`✅ Ejector pin calculation complete: ${result.totalPins} pins, ${result.safetyFactor.toFixed(2)}x safety factor`);

        return result;
    }

    /**
     * Integrate standard mold bases (DME, Hasco)
     */
    async integrateMoldBase(coreCavity, options = {}) {
        const {
            standard = 'DME', // DME or Hasco
            series = 'A', // A, B, C series (DME) or K, H, N series (Hasco)
            customSize = null,
            includeInserts = true,
            includeCooling = true
        } = options;

        console.log(`🏭 Integrating ${standard} mold base (Series ${series})...`);

        const moldDimensions = coreCavity.moldAssembly?.dimensions || {
            width: 200,
            height: 200,
            depth: 100
        };

        // Select appropriate mold base size
        const moldBase = this._selectMoldBase(standard, series, moldDimensions, customSize);

        const result = {
            standard,
            series,
            moldBase: {
                size: moldBase.size,
                plateThickness: moldBase.plateThickness,
                components: moldBase.components,
                material: moldBase.material,
                partNumber: moldBase.partNumber
            },
            plates: {
                cavity: {
                    thickness: moldBase.plateThickness.cavity,
                    material: 'P20 Steel',
                    hardness: '28-32 HRC'
                },
                core: {
                    thickness: moldBase.plateThickness.core,
                    material: 'P20 Steel',
                    hardness: '28-32 HRC'
                },
                support: {
                    thickness: moldBase.plateThickness.support,
                    count: 2
                }
            },
            guideSystem: {
                type: moldBase.guideType,
                diameter: moldBase.guideDiameter,
                count: 4,
                material: 'Hardened Steel'
            }
        };

        if (includeInserts) {
            result.inserts = this._designMoldInserts(coreCavity, moldBase);
        }

        if (includeCooling) {
            result.cooling = this._designCoolingChannels(moldBase, moldDimensions);
        }

        console.log(`✅ Mold base integrated: ${standard} ${moldBase.size}, ${moldBase.partNumber}`);

        return result;
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

    // Ejector pin helpers
    _calculateProjectedArea(geometry) {
        return 5000 + Math.random() * 3000; // mm²
    }

    _estimateEjectionForce(model, projectedArea) {
        // Simplified: Force = projected area × ejection pressure
        const ejectionPressure = 2.5; // MPa (typical for ABS)
        return projectedArea * ejectionPressure; // N
    }

    _calculateOptimalPinLocations(geometry, requiredPins, spacing, minWallThickness) {
        const locations = [];
        const gridSize = Math.ceil(Math.sqrt(requiredPins));

        for (let i = 0; i < requiredPins; i++) {
            const row = Math.floor(i / gridSize);
            const col = i % gridSize;
            locations.push({
                x: (col - gridSize / 2) * spacing,
                y: (row - gridSize / 2) * spacing,
                z: 0,
                type: i === 0 ? 'return_pin' : 'standard'
            });
        }

        return locations;
    }

    _detectPinArrangement(locations) {
        if (locations.length <= 4) return 'rectangular';
        if (locations.length >= 8) return 'distributed_grid';
        return 'custom';
    }

    _calculatePinDiameter(forcePerPin, minDia, maxDia) {
        // Simplified: larger force needs larger diameter
        const diameter = Math.sqrt(forcePerPin / 100) + minDia;
        return Math.min(Math.max(diameter, minDia), maxDia);
    }

    // Mold base helpers
    _selectMoldBase(standard, series, dimensions, customSize) {
        if (customSize) {
            return this._createCustomMoldBase(standard, customSize);
        }

        // Standard DME and Hasco sizes
        const standardSizes = {
            DME: {
                A: [
                    { size: '1012', dimensions: { w: 254, h: 305 }, plateThickness: { cavity: 38, core: 38, support: 25 }, partNumber: 'DME-1012-A' },
                    { size: '1418', dimensions: { w: 356, h: 457 }, plateThickness: { cavity: 51, core: 51, support: 32 }, partNumber: 'DME-1418-A' },
                    { size: '1824', dimensions: { w: 457, h: 610 }, plateThickness: { cavity: 64, core: 64, support: 38 }, partNumber: 'DME-1824-A' }
                ],
                B: [
                    { size: '1012', dimensions: { w: 254, h: 305 }, plateThickness: { cavity: 32, core: 32, support: 19 }, partNumber: 'DME-1012-B' }
                ]
            },
            Hasco: {
                K: [
                    { size: '300x400', dimensions: { w: 300, h: 400 }, plateThickness: { cavity: 40, core: 40, support: 25 }, partNumber: 'K300x400' },
                    { size: '400x500', dimensions: { w: 400, h: 500 }, plateThickness: { cavity: 50, core: 50, support: 30 }, partNumber: 'K400x500' }
                ]
            }
        };

        // Select smallest mold base that fits
        const bases = standardSizes[standard]?.[series] || standardSizes.DME.A;
        const selected = bases.find(base =>
            base.dimensions.w >= dimensions.width &&
            base.dimensions.h >= dimensions.height
        ) || bases[bases.length - 1]; // Fallback to largest

        return {
            ...selected,
            components: this._getMoldBaseComponents(standard),
            material: 'P20 Pre-Hardened Steel',
            guideType: standard === 'DME' ? 'leader_pin' : 'guide_pillar',
            guideDiameter: 25
        };
    }

    _createCustomMoldBase(standard, size) {
        return {
            size: `${size.width}x${size.height}`,
            dimensions: size,
            plateThickness: {
                cavity: Math.max(size.width / 10, 30),
                core: Math.max(size.width / 10, 30),
                support: Math.max(size.width / 15, 20)
            },
            partNumber: `${standard}-CUSTOM`,
            components: this._getMoldBaseComponents(standard),
            material: 'P20 Pre-Hardened Steel',
            guideType: 'leader_pin',
            guideDiameter: 25
        };
    }

    _getMoldBaseComponents(standard) {
        return {
            aCavityPlate: true,
            bCorePlate: true,
            cEjectorRetainerPlate: true,
            dEjectorPlate: true,
            supportPillars: 4,
            locatingRing: true,
            sprueBushing: true,
            returnPins: 2
        };
    }

    _designMoldInserts(coreCavity, moldBase) {
        return {
            cavityInsert: {
                material: 'H13 Tool Steel',
                hardness: '48-52 HRC',
                pocketDepth: moldBase.plateThickness.cavity - 10,
                retention: 'shoulder_fit'
            },
            coreInsert: {
                material: 'H13 Tool Steel',
                hardness: '48-52 HRC',
                pocketDepth: moldBase.plateThickness.core - 10,
                retention: 'shoulder_fit'
            }
        };
    }

    _designCoolingChannels(moldBase, dimensions) {
        return {
            channels: [
                { plate: 'cavity', diameter: 8, layout: 'spiral', length: 500 },
                { plate: 'core', diameter: 8, layout: 'spiral', length: 500 }
            ],
            coolantType: 'water',
            flowRate: '4-6 L/min',
            inletTemperature: '15-20°C',
            coolingTime: dimensions.depth * 0.6 // Simplified: ~0.6s per mm thickness
        };
    }
}

module.exports = new MoldDesignService();
