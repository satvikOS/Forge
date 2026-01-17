/**
 * Sheet Metal Design Service
 * Flanges, bends, punches, form features
 * Bend radius, K-factor, flat pattern generation, DXF export
 */

class SheetMetalDesignService {
    constructor() {
        this.designs = new Map();
        this.materials = this.initializeMaterials();
        this.bendTables = this.initializeBendTables();
    }

    /**
     * Create sheet metal part from specifications
     */
    async createSheetMetalPart(spec) {
        const {
            name,
            material = 'mild-steel',
            thickness = 1.0,  // mm
            bendRadius = null,  // Auto-calculate if not provided
            kFactor = null,     // Auto-select based on material
            features = []
        } = spec;

        console.log(`📋 Sheet Metal Design: Creating "${name}"...`);

        const partId = `sm_${Date.now()}`;

        // Get material properties
        const matProps = this.materials[material];
        if (!matProps) {
            throw new Error(`Unknown material: ${material}`);
        }

        // Calculate bend radius if not provided
        const finalBendRadius = bendRadius || this.calculateMinBendRadius(thickness, material);

        // Select K-factor if not provided
        const finalKFactor = kFactor || matProps.defaultKFactor;

        const part = {
            partId,
            name,
            type: 'sheet-metal',
            material,
            materialProperties: matProps,
            thickness,
            bendRadius: finalBendRadius,
            kFactor: finalKFactor,
            features: [],
            flatPattern: null,
            createdAt: Date.now()
        };

        // Add features
        for (const feature of features) {
            await this.addFeature(part, feature);
        }

        // Generate flat pattern
        part.flatPattern = await this.generateFlatPattern(part);

        this.designs.set(partId, part);

        return {
            success: true,
            operation: 'create-sheet-metal-part',
            part,
            flatPattern: part.flatPattern,
            recommendations: this.generateRecommendations(part)
        };
    }

    /**
     * Add feature to sheet metal part
     */
    async addFeature(part, featureSpec) {
        const { type, parameters } = featureSpec;

        let feature = null;

        switch (type) {
            case 'base-flange':
                feature = this.createBaseFlange(parameters, part);
                break;
            case 'edge-flange':
                feature = this.createEdgeFlange(parameters, part);
                break;
            case 'hem':
                feature = this.createHem(parameters, part);
                break;
            case 'jog':
                feature = this.createJog(parameters, part);
                break;
            case 'miter-flange':
                feature = this.createMiterFlange(parameters, part);
                break;
            case 'corner-relief':
                feature = this.createCornerRelief(parameters, part);
                break;
            case 'bend':
                feature = this.createBend(parameters, part);
                break;
            case 'unfold':
                feature = this.createUnfold(parameters, part);
                break;
            case 'hole':
                feature = this.createHole(parameters, part);
                break;
            case 'louver':
                feature = this.createLouver(parameters, part);
                break;
            case 'emboss':
                feature = this.createEmboss(parameters, part);
                break;
            default:
                throw new Error(`Unknown sheet metal feature: ${type}`);
        }

        if (feature) {
            part.features.push(feature);
        }

        return feature;
    }

    /**
     * Create base flange (first feature)
     */
    createBaseFlange(params, part) {
        const {
            width = 100,
            length = 100,
            sketch = null
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'base-flange',
            width,
            length,
            thickness: part.thickness,
            area: width * length,
            sketch
        };
    }

    /**
     * Create edge flange (bend from edge)
     */
    createEdgeFlange(params, part) {
        const {
            edge,
            flangeLength = 25,
            angle = 90,          // degrees
            bendPosition = 'inside',  // 'inside', 'outside', 'centered'
            reliefType = 'rectangular'  // 'rectangular', 'round', 'tear'
        } = params;

        // Calculate bend allowance
        const bendAllowance = this.calculateBendAllowance(
            angle,
            part.bendRadius,
            part.kFactor,
            part.thickness
        );

        // Calculate bend deduction
        const bendDeduction = this.calculateBendDeduction(
            angle,
            part.bendRadius,
            part.kFactor,
            part.thickness
        );

        return {
            featureId: `feature_${part.features.length}`,
            type: 'edge-flange',
            edge,
            flangeLength,
            angle,
            bendPosition,
            reliefType,
            bendAllowance,
            bendDeduction,
            bendRadius: part.bendRadius
        };
    }

    /**
     * Create hem (folded edge)
     */
    createHem(params, part) {
        const {
            edge,
            hemType = 'open',  // 'open', 'closed', 'teardrop', 'rolled'
            length = 5
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'hem',
            edge,
            hemType,
            length,
            bendRadius: part.bendRadius
        };
    }

    /**
     * Create jog (offset bend)
     */
    createJog(params, part) {
        const {
            offsetDistance = 10,
            angle = 90,
            length = 50
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'jog',
            offsetDistance,
            angle,
            length,
            bendCount: 2  // Jog creates two bends
        };
    }

    /**
     * Create miter flange
     */
    createMiterFlange(params, part) {
        const {
            edges,
            flangeLength = 25,
            angle = 90,
            miterAngle = 45
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'miter-flange',
            edges,
            flangeLength,
            angle,
            miterAngle
        };
    }

    /**
     * Create corner relief (prevent tearing at corners)
     */
    createCornerRelief(params, part) {
        const {
            corner,
            reliefType = 'rectangular',  // 'rectangular', 'round', 'tear', 'closed'
            reliefSize = part.thickness * 2
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'corner-relief',
            corner,
            reliefType,
            reliefSize,
            rationale: 'Prevents material tearing at bend intersections'
        };
    }

    /**
     * Create bend
     */
    createBend(params, part) {
        const {
            bendLine,
            angle = 90,
            bendRadius = part.bendRadius
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'bend',
            bendLine,
            angle,
            bendRadius
        };
    }

    /**
     * Create unfold (flatten bent region)
     */
    createUnfold(params, part) {
        const {
            bendToUnfold,
            fixedFace
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'unfold',
            bendToUnfold,
            fixedFace,
            state: 'unfolded'
        };
    }

    /**
     * Create hole (punch)
     */
    createHole(params, part) {
        const {
            position,
            diameter = 6,
            shape = 'round',  // 'round', 'square', 'obround', 'custom'
            pattern = null
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'hole',
            position,
            diameter,
            shape,
            pattern,
            method: 'punching'
        };
    }

    /**
     * Create louver (ventilation feature)
     */
    createLouver(params, part) {
        const {
            position,
            width = 10,
            length = 30,
            angle = 45,
            pattern = null
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'louver',
            position,
            width,
            length,
            angle,
            pattern
        };
    }

    /**
     * Create emboss (raised/recessed feature)
     */
    createEmboss(params, part) {
        const {
            profile,
            depth = 2,
            type = 'raised'  // 'raised', 'recessed'
        } = params;

        return {
            featureId: `feature_${part.features.length}`,
            type: 'emboss',
            profile,
            depth,
            embossType: type
        };
    }

    /**
     * Calculate bend allowance (material added due to bending)
     */
    calculateBendAllowance(angle, bendRadius, kFactor, thickness) {
        // BA = (π/180) × angle × (R + K × T)
        // Where: R = bend radius, K = K-factor, T = thickness

        const angleRad = angle * (Math.PI / 180);
        const BA = angleRad * (bendRadius + kFactor * thickness);

        return parseFloat(BA.toFixed(4));
    }

    /**
     * Calculate bend deduction (material removed from flat pattern)
     */
    calculateBendDeduction(angle, bendRadius, kFactor, thickness) {
        // BD = 2 × (R + T) × tan(angle/2) - BA
        // Where: R = bend radius, T = thickness, BA = bend allowance

        const angleRad = angle * (Math.PI / 180);
        const BA = this.calculateBendAllowance(angle, bendRadius, kFactor, thickness);
        const BD = 2 * (bendRadius + thickness) * Math.tan(angleRad / 2) - BA;

        return parseFloat(BD.toFixed(4));
    }

    /**
     * Calculate minimum bend radius for material
     */
    calculateMinBendRadius(thickness, material) {
        const matProps = this.materials[material];

        // Rule of thumb: minBendRadius = thickness × materialFactor
        return thickness * (matProps.bendFactor || 1.0);
    }

    /**
     * Generate flat pattern
     */
    async generateFlatPattern(part) {
        console.log(`  📐 Generating flat pattern...`);

        // Calculate flat dimensions by unfolding all bends
        let totalLength = 0;
        let totalWidth = 0;

        part.features.forEach(feature => {
            if (feature.type === 'base-flange') {
                totalLength += feature.length;
                totalWidth = feature.width;
            } else if (feature.type === 'edge-flange') {
                // Add flange length minus bend deduction
                totalLength += feature.flangeLength - feature.bendDeduction;
            } else if (feature.type === 'jog') {
                totalLength += feature.offsetDistance;
            }
        });

        const flatPattern = {
            patternId: `flat_${Date.now()}`,
            partId: part.partId,
            dimensions: {
                length: totalLength,
                width: totalWidth,
                area: totalLength * totalWidth
            },
            material: part.material,
            thickness: part.thickness,
            bendLines: this.extractBendLines(part),
            cutouts: this.extractCutouts(part),
            exportFormats: ['DXF', 'DWG', 'PDF', 'STEP']
        };

        return flatPattern;
    }

    /**
     * Extract bend lines for flat pattern
     */
    extractBendLines(part) {
        const bendLines = [];

        part.features.forEach(feature => {
            if (feature.type === 'edge-flange' || feature.type === 'bend') {
                bendLines.push({
                    featureId: feature.featureId,
                    angle: feature.angle,
                    bendRadius: feature.bendRadius || part.bendRadius,
                    bendAllowance: feature.bendAllowance,
                    direction: feature.angle > 0 ? 'up' : 'down'
                });
            } else if (feature.type === 'jog') {
                // Jog has two bend lines
                bendLines.push({
                    featureId: feature.featureId,
                    bendNumber: 1,
                    angle: feature.angle
                });
                bendLines.push({
                    featureId: feature.featureId,
                    bendNumber: 2,
                    angle: -feature.angle
                });
            }
        });

        return bendLines;
    }

    /**
     * Extract cutouts (holes, notches) for flat pattern
     */
    extractCutouts(part) {
        const cutouts = [];

        part.features.forEach(feature => {
            if (feature.type === 'hole') {
                cutouts.push({
                    type: 'hole',
                    shape: feature.shape,
                    diameter: feature.diameter,
                    position: feature.position
                });
            } else if (feature.type === 'louver') {
                cutouts.push({
                    type: 'louver',
                    width: feature.width,
                    length: feature.length,
                    position: feature.position
                });
            }
        });

        return cutouts;
    }

    /**
     * Export flat pattern to DXF for laser cutting
     */
    async exportToDXF(partId) {
        console.log(`📤 Exporting flat pattern to DXF...`);

        const part = this.designs.get(partId);
        if (!part || !part.flatPattern) {
            throw new Error('Flat pattern not available');
        }

        const dxf = {
            format: 'DXF',
            version: 'R14',
            units: 'mm',
            layers: [
                {
                    name: 'CUT',
                    color: 'red',
                    entities: this.generateCutEntities(part.flatPattern)
                },
                {
                    name: 'BEND',
                    color: 'blue',
                    entities: this.generateBendEntities(part.flatPattern)
                },
                {
                    name: 'ENGRAVE',
                    color: 'green',
                    entities: []
                }
            ],
            metadata: {
                material: part.material,
                thickness: part.thickness,
                bendRadius: part.bendRadius,
                createdAt: Date.now()
            }
        };

        return {
            success: true,
            operation: 'export-dxf',
            dxf,
            downloadUrl: `/api/mechanical/sheet-metal/export/${partId}.dxf`
        };
    }

    /**
     * Generate cut entities for DXF
     */
    generateCutEntities(flatPattern) {
        const entities = [];

        // Outer boundary
        entities.push({
            type: 'polyline',
            closed: true,
            vertices: [
                [0, 0],
                [flatPattern.dimensions.length, 0],
                [flatPattern.dimensions.length, flatPattern.dimensions.width],
                [0, flatPattern.dimensions.width]
            ]
        });

        // Cutouts (holes)
        flatPattern.cutouts.forEach(cutout => {
            if (cutout.type === 'hole' && cutout.shape === 'round') {
                entities.push({
                    type: 'circle',
                    center: cutout.position,
                    radius: cutout.diameter / 2
                });
            }
        });

        return entities;
    }

    /**
     * Generate bend entities for DXF
     */
    generateBendEntities(flatPattern) {
        const entities = [];

        flatPattern.bendLines.forEach(bend => {
            entities.push({
                type: 'line',
                start: [bend.position || 0, 0],
                end: [bend.position || 0, flatPattern.dimensions.width],
                attributes: {
                    angle: bend.angle,
                    bendRadius: bend.bendRadius
                }
            });
        });

        return entities;
    }

    /**
     * Generate bend table (for manufacturing documentation)
     */
    async generateBendTable(partId) {
        const part = this.designs.get(partId);
        if (!part) {
            throw new Error(`Part ${partId} not found`);
        }

        const bendTable = {
            partId,
            partName: part.name,
            material: part.material,
            thickness: part.thickness,
            bends: []
        };

        let bendNumber = 1;

        part.features.forEach(feature => {
            if (feature.type === 'edge-flange' || feature.type === 'bend') {
                bendTable.bends.push({
                    bendNumber: bendNumber++,
                    angle: feature.angle,
                    bendRadius: feature.bendRadius || part.bendRadius,
                    bendAllowance: feature.bendAllowance,
                    bendDeduction: feature.bendDeduction,
                    direction: feature.angle > 0 ? 'Up' : 'Down',
                    tool: this.selectBendTool(feature.angle, part.bendRadius, part.thickness)
                });
            }
        });

        return {
            success: true,
            operation: 'generate-bend-table',
            bendTable
        };
    }

    /**
     * Select appropriate bend tool
     */
    selectBendTool(angle, bendRadius, thickness) {
        // Simplified tool selection
        if (angle === 90) {
            return `90° V-Die, ${bendRadius * 2}mm opening`;
        } else if (angle === 45) {
            return `45° V-Die, ${bendRadius * 2}mm opening`;
        } else {
            return `Custom angle die, ${angle}°`;
        }
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(part) {
        const recs = [];

        // Check bend radius vs thickness
        const ratio = part.bendRadius / part.thickness;
        if (ratio < 1.0) {
            recs.push(`⚠️ Bend radius/thickness ratio (${ratio.toFixed(2)}) is tight - risk of cracking`);
            recs.push(`💡 Increase bend radius to ${part.thickness}mm or more`);
        }

        // Check material
        if (part.material === 'stainless-steel') {
            recs.push('ℹ️ Stainless steel requires larger bend radius than mild steel');
        }

        // Check for corner reliefs
        const hasCornerReliefs = part.features.some(f => f.type === 'corner-relief');
        if (!hasCornerReliefs) {
            recs.push('💡 Consider adding corner reliefs to prevent tearing');
        }

        // Flat pattern export
        if (part.flatPattern) {
            recs.push(`📐 Flat pattern: ${part.flatPattern.dimensions.length}mm × ${part.flatPattern.dimensions.width}mm`);
            recs.push('📤 Export to DXF for laser cutting or punch press');
        }

        return recs;
    }

    /**
     * Initialize materials
     */
    initializeMaterials() {
        return {
            'mild-steel': {
                name: 'Mild Steel',
                density: 7.85,  // g/cm³
                yieldStrength: 250,  // MPa
                defaultKFactor: 0.33,
                bendFactor: 1.0,  // min bend radius = thickness × factor
                commonThicknesses: [0.5, 0.7, 1.0, 1.2, 1.5, 2.0, 3.0]
            },
            'stainless-steel-304': {
                name: 'Stainless Steel 304',
                density: 8.0,
                yieldStrength: 215,
                defaultKFactor: 0.38,
                bendFactor: 1.5,  // Needs larger bend radius
                commonThicknesses: [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0]
            },
            'aluminum-5052': {
                name: 'Aluminum 5052',
                density: 2.68,
                yieldStrength: 193,
                defaultKFactor: 0.33,
                bendFactor: 0.5,  // Can use tighter bends
                commonThicknesses: [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0, 4.0]
            },
            'copper': {
                name: 'Copper',
                density: 8.96,
                yieldStrength: 70,
                defaultKFactor: 0.35,
                bendFactor: 0.5,
                commonThicknesses: [0.5, 0.8, 1.0, 1.5, 2.0]
            }
        };
    }

    /**
     * Initialize bend tables
     */
    initializeBendTables() {
        return {
            'mild-steel-1mm': {
                material: 'mild-steel',
                thickness: 1.0,
                bendData: [
                    { angle: 90, radius: 1.0, kFactor: 0.33, bendAllowance: 1.57 },
                    { angle: 90, radius: 2.0, kFactor: 0.38, bendAllowance: 1.75 },
                    { angle: 45, radius: 1.0, kFactor: 0.33, bendAllowance: 0.785 }
                ]
            }
        };
    }
}

module.exports = new SheetMetalDesignService();
