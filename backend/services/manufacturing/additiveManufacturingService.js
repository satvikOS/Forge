/**
 * Additive Manufacturing & 3D Printing Service
 * Print orientation, support generation, slicing, and nesting
 */

class AdditiveManufacturingService {
    constructor() {
        this.printers = this._initializePrinterProfiles();
        this.materials = this._initializeMaterials();
    }

    /**
     * Initialize printer profiles
     */
    _initializePrinterProfiles() {
        return {
            'fdm_prusa_mk3': {
                type: 'FDM',
                buildVolume: { x: 250, y: 210, z: 210 },
                layerHeightRange: [0.05, 0.35],
                nozzleDiameter: 0.4,
                maxSpeed: 200 // mm/s
            },
            'sla_form3': {
                type: 'SLA',
                buildVolume: { x: 145, y: 145, z: 185 },
                layerHeight: 0.025,
                resolution: 0.025
            },
            'sls_eos_p396': {
                type: 'SLS',
                buildVolume: { x: 340, y: 340, z: 600 },
                layerHeight: 0.06,
                laserPower: 50
            },
            'metal_dmls': {
                type: 'DMLS',
                buildVolume: { x: 250, y: 250, z: 325 },
                layerHeight: 0.02,
                material: 'metal'
            }
        };
    }

    /**
     * Initialize material profiles
     */
    _initializeMaterials() {
        return {
            'PLA': { type: 'FDM', nozzleTemp: 210, bedTemp: 60, supportRequired: 'minimal' },
            'ABS': { type: 'FDM', nozzleTemp: 240, bedTemp: 100, supportRequired: 'moderate' },
            'PETG': { type: 'FDM', nozzleTemp: 230, bedTemp: 80, supportRequired: 'minimal' },
            'resin_standard': { type: 'SLA', supportRequired: 'extensive' },
            'nylon_pa12': { type: 'SLS', supportRequired: 'none' },
            'stainless_316l': { type: 'DMLS', supportRequired: 'extensive', difficulty: 'high' }
        };
    }

    /**
     * Optimize print orientation
     */
    async optimizePrintOrientation(modelData, options = {}) {
        const {
            printerType = 'FDM',
            optimizeFor = 'strength', // strength, surface_finish, support_minimization, speed
            material = 'PLA'
        } = options;

        console.log(`🔄 Optimizing print orientation for ${optimizeFor}...`);

        const orientations = this._generateCandidateOrientations(modelData);
        const scores = [];

        orientations.forEach(orientation => {
            const score = {
                orientation: orientation.angles,
                supportVolume: this._estimateSupportVolume(modelData, orientation),
                surfaceQuality: this._estimateSurfaceQuality(modelData, orientation),
                buildTime: this._estimateBuildTime(modelData, orientation),
                strength: this._estimateStrength(modelData, orientation, material),
                totalScore: 0
            };

            // Weighted scoring based on optimization goal
            if (optimizeFor === 'strength') {
                score.totalScore = score.strength * 0.6 + (1 - score.supportVolume / 1000) * 0.2 + score.surfaceQuality * 0.2;
            } else if (optimizeFor === 'support_minimization') {
                score.totalScore = (1 - score.supportVolume / 1000) * 0.7 + score.surfaceQuality * 0.3;
            } else if (optimizeFor === 'surface_finish') {
                score.totalScore = score.surfaceQuality * 0.8 + (1 - score.supportVolume / 1000) * 0.2;
            } else {
                score.totalScore = (1 / score.buildTime) * 0.6 + (1 - score.supportVolume / 1000) * 0.4;
            }

            scores.push(score);
        });

        // Sort by total score
        scores.sort((a, b) => b.totalScore - a.totalScore);

        const bestOrientation = scores[0];

        console.log(`✅ Optimal orientation found: ${JSON.stringify(bestOrientation.orientation)} (score: ${bestOrientation.totalScore.toFixed(2)})`);

        return {
            recommended: bestOrientation,
            alternatives: scores.slice(1, 4),
            optimizationCriteria: optimizeFor
        };
    }

    /**
     * Generate support structures
     */
    async generateSupports(modelData, orientation, options = {}) {
        const {
            printer = 'fdm_prusa_mk3',
            material = 'PLA',
            supportDensity = 20, // percent
            supportPattern = 'grid', // grid, lines, trees
            overhangAngle = 45 // degrees
        } = options;

        console.log(`🏗️ Generating ${supportPattern} supports (overhang: ${overhangAngle}°)...`);

        const printerProfile = this.printers[printer];

        // Identify overhanging faces
        const overhangFaces = this._identifyOverhangs(modelData, orientation, overhangAngle);

        const supports = {
            type: supportPattern,
            structures: [],
            volume: 0,
            interfaceAreas: []
        };

        overhangFaces.forEach(face => {
            let supportStructure;

            if (supportPattern === 'trees') {
                // Tree supports: organic branching
                supportStructure = this._generateTreeSupport(face, printerProfile);
            } else if (supportPattern === 'grid') {
                // Grid supports: traditional lattice
                supportStructure = this._generateGridSupport(face, supportDensity);
            } else {
                // Linear supports
                supportStructure = this._generateLinearSupport(face);
            }

            supports.structures.push(supportStructure);
            supports.volume += supportStructure.volume;

            // Define interface area (contact with model)
            supports.interfaceAreas.push({
                faceId: face.id,
                area: supportStructure.contactArea,
                location: face.centroid
            });
        });

        console.log(`✅ Supports generated: ${supports.structures.length} structures, ${supports.volume.toFixed(0)}mm³`);

        return supports;
    }

    /**
     * Slice model into print layers
     */
    async sliceModel(modelData, printer, options = {}) {
        const {
            layerHeight = 0.2,
            wallThickness = 1.2, // mm
            infillDensity = 20, // percent
            infillPattern = 'gyroid',
            supportEnabled = true
        } = options;

        console.log(`🍰 Slicing model (layer height: ${layerHeight}mm, infill: ${infillDensity}%)...`);

        const printerProfile = this.printers[printer];
        const bbox = this._getBoundingBox(modelData.geometry);

        const numLayers = Math.ceil((bbox.max.z - bbox.min.z) / layerHeight);
        const layers = [];

        for (let i = 0; i < numLayers; i++) {
            const z = bbox.min.z + i * layerHeight;

            // Extract contours at this Z level
            const contours = this._extractContoursAtZ(modelData.geometry, z);

            // Generate perimeters (walls)
            const perimeters = this._generatePerimeters(contours, wallThickness, printerProfile.nozzleDiameter);

            // Generate infill
            const infill = this._generateInfill(contours, infillDensity, infillPattern);

            layers.push({
                layerNumber: i,
                z: z,
                perimeters,
                infill,
                printTime: this._estimateLayerTime(perimeters, infill, printerProfile)
            });
        }

        const totalTime = layers.reduce((sum, layer) => sum + layer.printTime, 0);
        const filamentLength = this._estimateFilament(layers, printerProfile.nozzleDiameter);

        console.log(`✅ Slicing complete: ${numLayers} layers, ${(totalTime / 60).toFixed(1)} minutes, ${filamentLength.toFixed(1)}m filament`);

        return {
            layers,
            numLayers,
            printTimeMinutes: totalTime / 60,
            filamentLength,
            filamentVolume: this._calculateFilamentVolume(filamentLength, 1.75)
        };
    }

    /**
     * Nest multiple parts on build plate
     */
    nestParts(parts, buildVolume, options = {}) {
        const {
            spacing = 5, // mm between parts
            arrangementStrategy = 'density' // density, speed, or custom
        } = options;

        console.log(`📦 Nesting ${parts.length} parts on ${buildVolume.x}x${buildVolume.y}mm plate...`);

        const nested = {
            totalParts: parts.length,
            arrangements: [],
            platesRequired: 1,
            efficiency: 0
        };

        // Sort parts by area (largest first for better packing)
        const sortedParts = parts.sort((a, b) => {
            const areaA = (a.boundingBox.x || 0) * (a.boundingBox.y || 0);
            const areaB = (b.boundingBox.x || 0) * (b.boundingBox.y || 0);
            return areaB - areaA;
        });

        let currentPlate = { index: 0, parts: [], usedArea: 0 };
        const plateArea = buildVolume.x * buildVolume.y;

        sortedParts.forEach((part, index) => {
            const partArea = (part.boundingBox.x + spacing) * (part.boundingBox.y + spacing);

            if (currentPlate.usedArea + partArea <= plateArea * 0.85) {
                // Place on current plate
                const position = this._findBestPosition(currentPlate, part, buildVolume, spacing);
                currentPlate.parts.push({
                    partIndex: index,
                    position,
                    rotation: 0
                });
                currentPlate.usedArea += partArea;
            } else {
                // Start new plate
                nested.arrangements.push(currentPlate);
                currentPlate = { index: currentPlate.index + 1, parts: [], usedArea: 0 };
                currentPlate.parts.push({
                    partIndex: index,
                    position: { x: spacing, y: spacing },
                    rotation: 0
                });
                currentPlate.usedArea += partArea;
            }
        });

        nested.arrangements.push(currentPlate);
        nested.platesRequired = nested.arrangements.length;
        nested.efficiency = (nested.arrangements.reduce((sum, plate) => sum + plate.usedArea, 0) / (plateArea * nested.platesRequired)) * 100;

        console.log(`✅ Nesting complete: ${nested.platesRequired} plate(s), ${nested.efficiency.toFixed(1)}% efficiency`);

        return nested;
    }

    // Helper methods

    _generateCandidateOrientations(model) {
        return [
            { angles: { x: 0, y: 0, z: 0 }, score: 0 },
            { angles: { x: 90, y: 0, z: 0 }, score: 0 },
            { angles: { x: 0, y: 90, z: 0 }, score: 0 },
            { angles: { x: 45, y: 45, z: 0 }, score: 0 }
        ];
    }

    _estimateSupportVolume(model, orientation) {
        return 500 + Math.random() * 300; // mm³
    }

    _estimateSurfaceQuality(model, orientation) {
        return 0.6 + Math.random() * 0.3; // 0-1 score
    }

    _estimateBuildTime(model, orientation) {
        return 120 + Math.random() * 60; // minutes
    }

    _estimateStrength(model, orientation, material) {
        // FDM parts are strongest in XY plane
        const xyScore = Math.abs(Math.cos(orientation.angles.x * Math.PI / 180));
        return 0.5 + xyScore * 0.5;
    }

    _identifyOverhangs(model, orientation, angle) {
        return [
            { id: 1, area: 200, centroid: { x: 50, y: 50, z: 30 } },
            { id: 2, area: 150, centroid: { x: 80, y: 80, z: 40 } }
        ];
    }

    _generateTreeSupport(face, printer) {
        return {
            type: 'tree',
            volume: face.area * 0.3,
            contactArea: face.area * 0.2,
            branches: 5
        };
    }

    _generateGridSupport(face, density) {
        return {
            type: 'grid',
            volume: face.area * (density / 100) * 2,
            contactArea: face.area * 0.5,
            density
        };
    }

    _generateLinearSupport(face) {
        return {
            type: 'linear',
            volume: face.area * 0.4,
            contactArea: face.area * 0.3
        };
    }

    _getBoundingBox(geometry) {
        return {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 100, y: 100, z: 50 }
        };
    }

    _extractContoursAtZ(geometry, z) {
        return [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
    }

    _generatePerimeters(contours, thickness, nozzleDiameter) {
        const numPerimeters = Math.ceil(thickness / nozzleDiameter);
        return { count: numPerimeters, paths: [] };
    }

    _generateInfill(contours, density, pattern) {
        return { pattern, density, length: 500 };
    }

    _estimateLayerTime(perimeters, infill, printer) {
        const perimeterTime = perimeters.count * 20;
        const infillTime = (infill.length / (printer.maxSpeed || 50));
        return perimeterTime + infillTime; // seconds
    }

    _estimateFilament(layers, nozzleDiameter) {
        return layers.length * 2.5; // meters
    }

    _calculateFilamentVolume(length, diameter) {
        const radius = diameter / 2;
        return Math.PI * radius * radius * length * 1000; // mm³
    }

    _findBestPosition(plate, part, buildVolume, spacing) {
        // Simplified bottom-left placement
        return {
            x: spacing + (plate.parts.length % 3) * ((part.boundingBox.x || 50) + spacing),
            y: spacing + Math.floor(plate.parts.length / 3) * ((part.boundingBox.y || 50) + spacing)
        };
    }
}

module.exports = new AdditiveManufacturingService();
