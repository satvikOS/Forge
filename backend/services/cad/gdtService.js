/**
 * GD&T (Geometric Dimensioning and Tolerancing) Service
 * Model-based definition, annotations, tolerance-driven CAM
 */

class GDTService {
    constructor() {
        this.toleranceStandards = this._initializeStandards();
        this.gdtSymbols = this._initializeSymbols();
    }

    /**
     * Initialize tolerance standards (ISO 1101, ASME Y14.5)
     */
    _initializeStandards() {
        return {
            'ISO_1101': {
                name: 'ISO 1101 Geometrical Tolerancing',
                symbols: ['⌖', '⊕', '∥', '⊥', '∠', '⌢', '⌒'],
                datumPrecedence: ['A', 'B', 'C']
            },
            'ASME_Y14.5': {
                name: 'ASME Y14.5 GD&T Standard',
                symbols: ['⌖', '⊕', '∥', '⊥', '∠', '◎', '⌢'],
                datumPrecedence: ['A', 'B', 'C']
            }
        };
    }

    /**
     * Initialize GD&T symbols
     */
    _initializeSymbols() {
        return {
            flatness: { symbol: '⌀', tolerance: 'surface', description: 'Flatness' },
            straightness: { symbol: '—', tolerance: 'linear', description: 'Straightness' },
            circularity: { symbol: '○', tolerance: 'circular', description: 'Circularity/Roundness' },
            cylindricity: { symbol: '⌭', tolerance: 'cylindrical', description: 'Cylindricity' },
            profileOfLine: { symbol: '⌒', tolerance: 'profile', description: 'Profile of a Line' },
            profileOfSurface: { symbol: '⌓', tolerance: 'profile', description: 'Profile of a Surface' },
            perpendicularity: { symbol: '⊥', tolerance: 'orientation', description: 'Perpendicularity' },
            angularity: { symbol: '∠', tolerance: 'orientation', description: 'Angularity' },
            parallelism: { symbol: '∥', tolerance: 'orientation', description: 'Parallelism' },
            positionTrue: { symbol: '⌖', tolerance: 'location', description: 'True Position' },
            concentricity: { symbol: '◎', tolerance: 'runout', description: 'Concentricity' },
            symmetry: { symbol: '⌯', tolerance: 'location', description: 'Symmetry' },
            circularRunout: { symbol: '↗', tolerance: 'runout', description: 'Circular Runout' },
            totalRunout: { symbol: '↗↗', tolerance: 'runout', description: 'Total Runout' }
        };
    }

    /**
     * Add GD&T annotation to model (MBD - Model-Based Definition)
     */
    async addGDTAnnotation(modelData, annotationSpec) {
        const {
            feature,
            toleranceType,
            toleranceValue,
            datumReferences = [],
            standard = 'ISO_1101',
            materialCondition = 'RFS' // RFS, MMC, LMC
        } = annotationSpec;

        console.log(`📐 Adding GD&T annotation: ${toleranceType} on ${feature.name}`);

        const symbol = this.gdtSymbols[toleranceType];
        if (!symbol) {
            throw new Error(`Unknown GD&T tolerance type: ${toleranceType}`);
        }

        const annotation = {
            id: `gdt_${Date.now()}`,
            feature: feature,
            symbol: symbol.symbol,
            tolerance: toleranceValue,
            datums: datumReferences,
            materialCondition,
            standard,
            featureControlFrame: this._buildFeatureControlFrame(
                symbol.symbol,
                toleranceValue,
                datumReferences,
                materialCondition
            ),
            attachedTo: feature.id
        };

        // Embed in model as PMI (Product Manufacturing Information)
        if (modelData.pmi) {
            modelData.pmi.push(annotation);
        } else {
            modelData.pmi = [annotation];
        }

        console.log(`✅ GD&T annotation added: ${symbol.description} ±${toleranceValue}`);

        return annotation;
    }

    /**
     * Build feature control frame (the GD&T callout box)
     */
    _buildFeatureControlFrame(symbol, tolerance, datums, materialCondition) {
        let frame = `|${symbol}|${tolerance}`;

        if (materialCondition !== 'RFS') {
            frame += `|${materialCondition}`;
        }

        datums.forEach(datum => {
            frame += `|${datum}`;
        });

        frame += '|';

        return frame;
    }

    /**
     * Verify GD&T compliance of a model
     */
    async verifyGDTCompliance(modelData, standard = 'ISO_1101') {
        console.log(`🔍 Verifying GD&T compliance against ${standard}...`);

        const compliance = {
            standard,
            compliant: true,
            issues: [],
            warnings: [],
            annotationsChecked: 0
        };

        const annotations = modelData.pmi || [];

        annotations.forEach((annotation, index) => {
            compliance.annotationsChecked++;

            // Check if tolerance value is achievable
            const achievable = this._checkToleranceAchievability(
                annotation.feature,
                annotation.tolerance
            );

            if (!achievable.isAchievable) {
                compliance.compliant = false;
                compliance.issues.push({
                    annotation: index,
                    type: 'tolerance_too_tight',
                    message: `Tolerance ±${annotation.tolerance} may not be achievable for feature ${annotation.feature.name}`,
                    recommendation: `Recommended tolerance: ±${achievable.recommendedTolerance}`
                });
            }

            // Check datum references
            if (annotation.datums.length > 0) {
                const datumValid = this._validateDatumReferences(annotation.datums, modelData);
                if (!datumValid.valid) {
                    compliance.warnings.push({
                        annotation: index,
                        type: 'datum_reference_issue',
                        message: datumValid.message
                    });
                }
            }
        });

        console.log(`✅ GD&T compliance check complete: ${compliance.compliant ? 'PASS' : 'FAIL'} (${compliance.issues.length} issues, ${compliance.warnings.length} warnings)`);

        return compliance;
    }

    /**
     * Apply tolerance-driven CAM adjustments
     */
    adjustCAMForTolerances(toolpaths, gdtAnnotations) {
        console.log(`🔧 Adjusting CAM toolpaths for GD&T tolerances...`);

        const adjustments = {
            toolpathsModified: 0,
            tolerancesApplied: 0,
            recommendations: []
        };

        gdtAnnotations.forEach(annotation => {
            const affectedToolpaths = toolpaths.filter(tp =>
                this._toolpathAffectsFeature(tp, annotation.feature)
            );

            affectedToolpaths.forEach(toolpath => {
                // Tighten tolerances require finer tooling and slower feeds
                if (annotation.tolerance < 0.05) { // mm
                    toolpath.recommendedTool = 'ball_nose_3mm'; // Smaller tool
                    toolpath.feedRate = Math.min(toolpath.feedRate, 500); // Slower
                    toolpath.stepover = Math.min(toolpath.stepover || 1.5, annotation.tolerance * 0.5);

                    adjustments.toolpathsModified++;
                    adjustments.recommendations.push({
                        toolpath: toolpath.id,
                        annotation: annotation.id,
                        adjustment: 'Precision machining required for tight tolerance',
                        newParams: {
                            tool: toolpath.recommendedTool,
                            feedRate: toolpath.feedRate,
                            stepover: toolpath.stepover
                        }
                    });
                }

                // Geometric tolerances affect inspection points
                if (annotation.symbol === '⌖') { // True position
                    toolpath.inspectionRequired = true;
                    toolpath.inspectionTolerance = annotation.tolerance;
                }

                adjustments.tolerancesApplied++;
            });
        });

        console.log(`✅ CAM adjustments complete: ${adjustments.toolpathsModified} toolpaths modified`);

        return adjustments;
    }

    /**
     * Generate process planning based on GD&T
     */
    generateProcessPlan(modelData, gdtAnnotations) {
        console.log(`📋 Generating process plan from GD&T requirements...`);

        const processPlan = {
            operations: [],
            inspectionPoints: [],
            fixturingNeeds: [],
            totalEstimatedTime: 0
        };

        // Sort features by tolerance (tightest first)
        const sortedAnnotations = [...gdtAnnotations].sort((a, b) => a.tolerance - b.tolerance);

        sortedAnnotations.forEach((annotation, index) => {
            const operation = {
                sequence: index + 1,
                feature: annotation.feature.name,
                tolerance: annotation.tolerance,
                gdtType: annotation.symbol,
                process: this._selectProcessForTolerance(annotation),
                estimatedTime: this._estimateOperationTime(annotation),
                datumSetup: annotation.datums
            };

            processPlan.operations.push(operation);
            processPlan.totalEstimatedTime += operation.estimatedTime;

            // Add inspection point
            if (annotation.tolerance < 0.1) {
                processPlan.inspectionPoints.push({
                    after: operation.sequence,
                    type: 'CMM',
                    feature: annotation.feature.name,
                    tolerance: annotation.tolerance
                });
            }

            // Determine fixturing needs
            if (annotation.datums.length > 0) {
                processPlan.fixturingNeeds.push({
                    operation: operation.sequence,
                    datums: annotation.datums,
                    locatingScheme: '3-2-1'
                });
            }
        });

        console.log(`✅ Process plan generated: ${processPlan.operations.length} operations, ${processPlan.totalEstimatedTime.toFixed(1)} min`);

        return processPlan;
    }

    // Helper methods

    _checkToleranceAchievability(feature, tolerance) {
        // Machining capabilities by process
        const processCapabilities = {
            milling: 0.05, // ±0.05mm
            grinding: 0.01,
            turning: 0.025,
            drilling: 0.1
        };

        const recommendedProcess = feature.manufacturingProcess || 'milling';
        const capability = processCapabilities[recommendedProcess];

        return {
            isAchievable: tolerance >= capability,
            recommendedTolerance: capability,
            process: recommendedProcess
        };
    }

    _validateDatumReferences(datums, modelData) {
        // Check if datums are defined in model
        const definedDatums = modelData.datums || [];

        const missingDatums = datums.filter(d =>
            !definedDatums.find(dd => dd.name === d)
        );

        if (missingDatums.length > 0) {
            return {
                valid: false,
                message: `Datum references ${missingDatums.join(', ')} not defined in model`
            };
        }

        return { valid: true };
    }

    _toolpathAffectsFeature(toolpath, feature) {
        // Simplified: check if toolpath intersects feature bounding box
        return true; // Would need actual geometry intersection
    }

    _selectProcessForTolerance(annotation) {
        if (annotation.tolerance < 0.01) return 'grinding';
        if (annotation.tolerance < 0.05) return 'precision_milling';
        if (annotation.tolerance < 0.1) return 'milling';
        return 'rough_milling';
    }

    _estimateOperationTime(annotation) {
        const baseTime = 10; // minutes
        const toleranceFactor = 0.1 / (annotation.tolerance + 0.01);
        return baseTime * toleranceFactor;
    }
}

module.exports = new GDTService();
