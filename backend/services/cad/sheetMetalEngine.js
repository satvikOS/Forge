/**
 * Sheet Metal Engine - Sheet Metal Design Operations
 * Handles flanges, bends, folds, flat patterns, and unfold operations
 */

class SheetMetalEngine {
    constructor() {
        this.defaultRules = {
            thickness: 1.0, // mm
            bendRadius: 1.5, // mm
            kFactor: 0.44, // Neutral axis factor
            reliefType: 'rectangular', // rectangular, round, tear
            reliefWidth: 1.0, // mm
            reliefDepth: 1.0, // mm
            bendAngle: 90 // degrees
        };
    }

    /**
     * Create base sheet metal face from sketch
     */
    createBaseFace(sketch, thickness, direction = 'bidirectional') {
        const face = {
            id: `sm_face_${Date.now()}`,
            type: 'base_face',
            sketch: sketch,
            thickness: thickness,
            direction: direction, // 'up', 'down', 'bidirectional'
            flatPattern: null,
            material: 'steel_mild',
            bendTable: []
        };

        // Calculate flat pattern dimensions
        face.flatPattern = this.calculateFlatPattern(face);

        return face;
    }

    /**
     * Add edge flange to existing face
     */
    createEdgeFlange(part, edgeId, options = {}) {
        const flange = {
            id: `flange_${Date.now()}`,
            type: 'edge_flange',
            edgeId: edgeId,
            distance: options.distance || 10, // Height of flange
            angle: options.angle || 90, // Bend angle
            bendRadius: options.bendRadius || this.defaultRules.bendRadius,
            reliefType: options.reliefType || this.defaultRules.reliefType,
            offsetType: options.offsetType || 'bend_outside', // bend_outside, bend_centerline, bend_inside
            gap: options.gap || 0
        };

        // Calculate bend allowance
        flange.bendAllowance = this.calculateBendAllowance(
            flange.angle,
            flange.bendRadius,
            part.thickness,
            this.defaultRules.kFactor
        );

        // Apply flange to part
        part.features = part.features || [];
        part.features.push(flange);
        part.bendTable.push({
            bendId: flange.id,
            angle: flange.angle,
            radius: flange.bendRadius,
            allowance: flange.bendAllowance
        });

        return flange;
    }

    /**
     * Create contour flange from sketch profile
     */
    createContourFlange(part, sketchProfile, options = {}) {
        const flange = {
            id: `contour_flange_${Date.now()}`,
            type: 'contour_flange',
            profile: sketchProfile,
            width: options.width || 10,
            angle: options.angle || 90,
            bendRadius: options.bendRadius || this.defaultRules.bendRadius,
            position: options.position || 'outside' // outside, inside, centerline
        };

        part.features = part.features || [];
        part.features.push(flange);

        return flange;
    }

    /**
     * Create hem feature
     */
    createHem(part, edgeId, options = {}) {
        const hem = {
            id: `hem_${Date.now()}`,
            type: 'hem',
            edgeId: edgeId,
            hemType: options.hemType || 'open', // open, closed, tear_drop
            length: options.length || 3, // mm
            gap: options.gap || 0, // For open hem
            radius: options.radius || 0.5 // For tear drop
        };

        part.features = part.features || [];
        part.features.push(hem);

        return hem;
    }

    /**
     * Fold operation - create bends along lines
     */
    createFold(part, foldLineId, options = {}) {
        const fold = {
            id: `fold_${Date.now()}`,
            type: 'fold',
            foldLineId: foldLineId,
            angle: options.angle || 90,
            bendRadius: options.bendRadius || this.defaultRules.bendRadius,
            fixedFace: options.fixedFace || null, // Which face remains stationary
            bendDirection: options.direction || 'up'
        };

        fold.bendAllowance = this.calculateBendAllowance(
            fold.angle,
            fold.bendRadius,
            part.thickness,
            this.defaultRules.kFactor
        );

        part.features = part.features || [];
        part.features.push(fold);

        return fold;
    }

    /**
     * Unfold/Refold operations
     */
    unfoldBend(part, bendId, stationaryFaceId) {
        const bend = part.bendTable.find(b => b.bendId === bendId);
        if (!bend) return null;

        return {
            operation: 'unfold',
            bendId: bendId,
            stationaryFace: stationaryFaceId,
            previousState: { ...bend }
        };
    }

    refoldBend(part, bendId) {
        return {
            operation: 'refold',
            bendId: bendId
        };
    }

    /**
     * Generate flat pattern for manufacturing
     */
    generateFlatPattern(part) {
        const flatPattern = {
            id: `flat_${part.id}`,
            type: 'flat_pattern',
            outline: [],
            bendLines: [],
            dimensions: {
                width: 0,
                height: 0,
                area: 0
            },
            material: part.material,
            thickness: part.thickness,
            dxfExport: null
        };

        // Calculate unfolded dimensions
        let totalLength = 0;
        let totalWidth = 0;

        // Process all bends
        for (const bend of part.bendTable) {
            totalLength += bend.allowance;

            // Add bend line to flat pattern
            flatPattern.bendLines.push({
                position: totalLength,
                angle: bend.angle,
                radius: bend.radius,
                type: 'bend_up' // or 'bend_down'
            });
        }

        flatPattern.dimensions.width = totalLength;
        flatPattern.dimensions.height = totalWidth;
        flatPattern.dimensions.area = totalLength * totalWidth;

        return flatPattern;
    }

    /**
     * Calculate bend allowance (material stretch in bend)
     */
    calculateBendAllowance(angle, radius, thickness, kFactor) {
        // BA = (π/180) × Angle × (Radius + K-factor × Thickness)
        const angleRad = (Math.PI / 180) * angle;
        const bendAllowance = angleRad * (radius + kFactor * thickness);

        return {
            bendAllowance: bendAllowance,
            bendDeduction: 2 * (radius + thickness) * Math.tan(angleRad / 2) - bendAllowance,
            outsideSetback: (radius + thickness) * Math.tan(angleRad / 2),
            kFactor: kFactor
        };
    }

    /**
     * Calculate K-factor from bend angle and material
     */
    calculateKFactor(material, bendAngle, radius, thickness) {
        // Simplified - in production would use material database
        const ratioRT = radius / thickness;

        if (ratioRT < 1) {
            return 0.33; // Sharp bends
        } else if (ratioRT < 2) {
            return 0.38;
        } else if (ratioRT < 4) {
            return 0.42;
        } else {
            return 0.45; // Generous bends
        }
    }

    /**
     * Add corner relief
     */
    createCornerRelief(part, cornerVertexId, options = {}) {
        const relief = {
            id: `relief_${Date.now()}`,
            type: 'corner_relief',
            cornerVertex: cornerVertexId,
            reliefType: options.reliefType || this.defaultRules.reliefType,
            width: options.width || this.defaultRules.reliefWidth,
            depth: options.depth || this.defaultRules.reliefDepth,
            radius: options.radius || 0.5 // For round relief
        };

        part.features = part.features || [];
        part.features.push(relief);

        return relief;
    }

    /**
     * Create cut in sheet metal (can cut across bends)
     */
    createSheetMetalCut(part, sketchProfile, options = {}) {
        const cut = {
            id: `sm_cut_${Date.now()}`,
            type: 'sheet_metal_cut',
            profile: sketchProfile,
            throughAll: options.throughAll !== false,
            cutAcrossBends: options.cutAcrossBends || false,
            normalCut: options.normalCut !== false
        };

        part.features = part.features || [];
        part.features.push(cut);

        return cut;
    }

    /**
     * Rip operation - split faces
     */
    createRip(part, edgeId, options = {}) {
        const rip = {
            id: `rip_${Date.now()}`,
            type: 'rip',
            edgeId: edgeId,
            gapSize: options.gapSize || part.thickness,
            extendRip: options.extendRip || false
        };

        part.features = part.features || [];
        part.features.push(rip);

        return rip;
    }

    /**
     * Mirror sheet metal features
     */
    mirrorSheetMetal(part, mirrorPlane, featuresToMirror) {
        const mirror = {
            id: `sm_mirror_${Date.now()}`,
            type: 'sheet_metal_mirror',
            plane: mirrorPlane,
            features: featuresToMirror,
            copyBends: true
        };

        part.features = part.features || [];
        part.features.push(mirror);

        return mirror;
    }

    /**
     * Export flat pattern to DXF
     */
    exportFlatPatternDXF(flatPattern, options = {}) {
        const dxf = {
            format: 'DXF',
            version: options.version || 'R2018',
            layers: {
                outline: 'SM_OUTLINE',
                bendLines: 'SM_BEND_LINES',
                centerlines: 'SM_CENTERLINES',
                dimensions: 'SM_DIMENSIONS',
                text: 'SM_TEXT'
            },
            units: options.units || 'mm',
            bendNotation: options.bendNotation || 'angle_radius', // angle_radius, k_factor, bend_allowance
            includeNotes: options.includeNotes !== false
        };

        // Generate DXF content (simplified)
        const dxfContent = this.generateDXFContent(flatPattern, dxf);

        return {
            success: true,
            format: 'DXF',
            content: dxfContent,
            filename: `${flatPattern.id}_flat_pattern.dxf`
        };
    }

    /**
     * Generate DXF file content
     */
    generateDXFContent(flatPattern, config) {
        // Simplified DXF generation
        let dxf = '0\nSECTION\n2\nENTITIES\n';

        // Add outline
        dxf += '0\nPOLYLINE\n8\n' + config.layers.outline + '\n';

        // Add bend lines
        for (const bendLine of flatPattern.bendLines) {
            dxf += `0\nLINE\n8\n${config.layers.bendLines}\n`;
            dxf += `10\n${bendLine.position}\n20\n0\n`;
        }

        dxf += '0\nENDSEC\n0\nEOF\n';

        return dxf;
    }

    /**
     * Calculate flat pattern for existing part
     */
    calculateFlatPattern(part) {
        // Placeholder - would traverse feature tree and calculate
        return {
            totalLength: 100,
            totalWidth: 50,
            area: 5000,
            perimeter: 300,
            weight: 0 // Would calculate based on material density
        };
    }
}

module.exports = SheetMetalEngine;
