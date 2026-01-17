/**
 * Plastic Mold Design Service
 * Injection mold design: draft angles, undercuts, parting lines
 * Core/cavity, cooling channels, ejector pins, gates, runners
 * Mold flow analysis prep, shrinkage compensation
 */

class PlasticMoldDesignService {
    constructor() {
        this.designs = new Map();
        this.plasticMaterials = this.initializePlasticMaterials();
        this.moldStandards = this.initializeMoldStandards();
    }

    /**
     * Design injection mold from part model
     */
    async designInjectionMold(spec) {
        const {
            partModel,
            partName,
            material = 'ABS',
            productionVolume = 10000,  // Annual quantity
            moldBase = 'standard',  // 'standard', 'hot-runner', 'stack', 'family'
            cavities = 1,  // Number of cavities (1, 2, 4, 8, 16, etc.)
            parting-line = null,  // Auto-detect if null
            gateType = 'edge-gate',  // 'edge', 'sub', 'hot-tip', 'fan', 'tab', 'tunnel'
            gateLocation = null,  // Auto-select if null
            autoDraft = true,  // Automatically add draft angles
            autoEjection = true  // Automatically place ejector pins
        } = spec;

        console.log(`🏭 Injection Mold Design: "${partName}" (${material})...`);

        const moldId = `mold_${Date.now()}`;

        const matProps = this.plasticMaterials[material];
        if (!matProps) {
            throw new Error(`Material ${material} not found in database`);
        }

        const mold = {
            moldId,
            partName,
            partModel,
            material,
            materialProperties: matProps,
            productionVolume,
            moldBase,
            cavities,
            parting-line: null,
            core: null,
            cavity: null,
            draftAnalysis: null,
            undercuts: [],
            gateSystem: null,
            coolingChannels: [],
            ejectionSystem: null,
            shrinkageCompensation: matProps.shrinkage,
            estimatedCost: 0,
            estimatedLeadTime: 0,
            createdAt: Date.now()
        };

        // Step 1: Analyze draft angles
        console.log(`  🔍 Analyzing draft angles...`);
        mold.draftAnalysis = await this.analyzeDraft(partModel, matProps.minDraft);

        // Step 2: Auto-apply draft if needed
        if (autoDraft && mold.draftAnalysis.insufficientDraft.length > 0) {
            console.log(`  🔧 Auto-applying draft to ${mold.draftAnalysis.insufficientDraft.length} faces...`);
            await this.applyDraft(partModel, mold.draftAnalysis, matProps.recommendedDraft);
        }

        // Step 3: Detect undercuts
        console.log(`  🔍 Detecting undercuts...`);
        mold.undercuts = await this.detectUndercuts(partModel);

        if (mold.undercuts.length > 0) {
            console.log(`    ⚠️ ${mold.undercuts.length} undercuts detected - will require slides or lifters`);
        }

        // Step 4: Determine parting line
        console.log(`  ✂️ Determining parting line...`);
        mold.partingLine = partingLine || await this.detectPartingLine(partModel, mold.undercuts);

        // Step 5: Generate core and cavity
        console.log(`  🔨 Generating core and cavity...`);
        const { core, cavity } = await this.generateCoreAndCavity(
            partModel,
            mold.partingLine,
            matProps.shrinkage
        );
        mold.core = core;
        mold.cavity = cavity;

        // Step 6: Design gate system
        console.log(`  🚪 Designing gate system...`);
        mold.gateSystem = await this.designGateSystem(
            partModel,
            gateType,
            gateLocation,
            cavities,
            material
        );

        // Step 7: Design cooling system
        console.log(`  ❄️ Designing cooling channels...`);
        mold.coolingChannels = await this.designCoolingSystem(
            partModel,
            mold.core,
            mold.cavity,
            material
        );

        // Step 8: Design ejection system
        if (autoEjection) {
            console.log(`  ⬆️ Designing ejection system...`);
            mold.ejectionSystem = await this.designEjectionSystem(partModel, mold.core);
        }

        // Step 9: Cost and lead time estimation
        mold.estimatedCost = this.estimateMoldCost(mold);
        mold.estimatedLeadTime = this.estimateMoldLeadTime(mold);

        this.designs.set(moldId, mold);

        return {
            success: true,
            operation: 'design-injection-mold',
            mold,
            warnings: this.generateWarnings(mold),
            recommendations: this.generateRecommendations(mold),
            estimatedCost: mold.estimatedCost,
            estimatedLeadTime: mold.estimatedLeadTime
        };
    }

    /**
     * Analyze draft angles
     */
    async analyzeDraft(partModel, minDraft = 1.0) {
        const analysis = {
            totalFaces: 0,
            sufficientDraft: [],
            insufficientDraft: [],
            noDraft: [],
            worstCase: { face: null, angle: 0 }
        };

        // Analyze each face (simplified - real implementation would use actual geometry)
        const faces = partModel.faces || [];

        faces.forEach((face, index) => {
            const draftAngle = this.calculateDraftAngle(face, partModel);

            analysis.totalFaces++;

            if (draftAngle >= minDraft) {
                analysis.sufficientDraft.push({ faceId: index, angle: draftAngle });
            } else if (draftAngle > 0) {
                analysis.insufficientDraft.push({ faceId: index, angle: draftAngle, required: minDraft });
            } else {
                analysis.noDraft.push({ faceId: index });
            }

            if (draftAngle < analysis.worstCase.angle || analysis.worstCase.face === null) {
                analysis.worstCase = { face: index, angle: draftAngle };
            }
        });

        console.log(`    ✅ ${analysis.sufficientDraft.length}/${analysis.totalFaces} faces have sufficient draft`);
        if (analysis.insufficientDraft.length > 0) {
            console.log(`    ⚠️ ${analysis.insufficientDraft.length} faces need draft adjustment`);
        }

        return analysis;
    }

    /**
     * Calculate draft angle for face
     */
    calculateDraftAngle(face, partModel) {
        // Simplified - real implementation would calculate angle from normal vector
        // and pull direction
        return Math.random() * 5;  // Random angle 0-5° for demo
    }

    /**
     * Apply draft to faces
     */
    async applyDraft(partModel, draftAnalysis, draftAngle) {
        const modified = [];

        for (const faceInfo of draftAnalysis.insufficientDraft) {
            // Apply draft to face
            const face = partModel.faces[faceInfo.faceId];
            // Real implementation would modify geometry
            modified.push({
                faceId: faceInfo.faceId,
                originalAngle: faceInfo.angle,
                newAngle: draftAngle
            });
        }

        console.log(`    ✅ Applied ${draftAngle}° draft to ${modified.length} faces`);

        return modified;
    }

    /**
     * Detect undercuts
     */
    async detectUndercuts(partModel) {
        const undercuts = [];

        // Analyze geometry for features that would prevent mold opening
        // Real implementation would do ray casting from parting line

        // Example undercuts
        const exampleUndercuts = [
            {
                undercutId: 'uc_1',
                type: 'internal-thread',  // 'thread', 'snap-fit', 'hole-perpendicular', 'rib'
                location: { x: 25, y: 30, z: 10 },
                severity: 'critical',  // 'minor', 'moderate', 'critical'
                solution: 'unscrewing-device',  // 'slide', 'lifter', 'unscrewing', 'collapsible-core', 'hand-load'
                estimatedCost: 5000
            }
        ];

        return exampleUndercuts;
    }

    /**
     * Detect optimal parting line
     */
    async detectPartingLine(partModel, undercuts) {
        console.log(`    🔍 Analyzing parting line options...`);

        // Find the plane that minimizes undercuts and splits part roughly in half
        // Real implementation would use advanced algorithms

        const partingLine = {
            plane: { point: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 0, z: 1 } },
            type: 'flat',  // 'flat', 'stepped', 'curved'
            quality: 'good',  // 'excellent', 'good', 'acceptable', 'poor'
            undercuts: undercuts.length,
            shutoffArea: 250,  // mm²
            complexity: 'simple'  // 'simple', 'moderate', 'complex'
        };

        console.log(`    ✅ Parting line: ${partingLine.type}, quality: ${partingLine.quality}`);

        return partingLine;
    }

    /**
     * Generate core and cavity
     */
    async generateCoreAndCavity(partModel, partingLine, shrinkage) {
        console.log(`    🔨 Generating core and cavity with ${shrinkage * 100}% shrinkage compensation...`);

        // Scale part by shrinkage factor
        const scale = 1 + shrinkage;

        const core = {
            type: 'core',
            geometry: this.scaleGeometry(partModel, scale),
            material: 'P20-steel',  // Mold steel
            hardness: '28-32 HRC',
            finish: 'SPI-B3',  // Surface finish
            inserts: [],
            slides: [],
            lifters: []
        };

        const cavity = {
            type: 'cavity',
            geometry: this.scaleGeometry(partModel, scale),
            material: 'P20-steel',
            hardness: '28-32 HRC',
            finish: 'SPI-B3',
            inserts: []
        };

        // Add slides/lifters for undercuts
        // Real implementation would design actual slide mechanisms

        console.log(`    ✅ Core and cavity generated (${(scale * 100).toFixed(2)}% scaled for shrinkage)`);

        return { core, cavity };
    }

    /**
     * Design gate system
     */
    async designGateSystem(partModel, gateType, gateLocation, cavities, material) {
        const matProps = this.plasticMaterials[material];

        // Auto-select gate location if not provided
        const finalGateLocation = gateLocation || this.selectOptimalGateLocation(partModel);

        const gateSystem = {
            type: gateType,
            location: finalGateLocation,
            cavities,
            sprue: null,
            runner: null,
            gates: []
        };

        // Sprue design
        gateSystem.sprue = {
            diameter: 6,  // mm at top
            length: 100,  // mm
            taper: 2  // degrees
        };

        // Runner design
        if (cavities > 1) {
            gateSystem.runner = {
                type: 'balanced',  // 'balanced', 'h-pattern', 'radial'
                diameter: 8,  // mm
                length: 150 * cavities,  // mm
                coldSlug: true
            };
        }

        // Gate design for each cavity
        for (let i = 0; i < cavities; i++) {
            const gate = this.designGate(gateType, matProps, finalGateLocation, i);
            gateSystem.gates.push(gate);
        }

        console.log(`    ✅ ${gateType} gate system for ${cavities} cavit${cavities > 1 ? 'ies' : 'y'}`);

        return gateSystem;
    }

    /**
     * Design individual gate
     */
    designGate(gateType, matProps, location, cavityIndex) {
        const gateDesigns = {
            'edge-gate': {
                width: 2,
                depth: 1,
                landLength: 0.5,
                location
            },
            'sub-gate': {
                diameter: 1.5,
                length: 3,
                location
            },
            'hot-tip-gate': {
                diameter: 2,
                orifice: 0.8,
                location
            },
            'fan-gate': {
                width: 15,
                thickness: 1,
                landLength: 1,
                location
            },
            'tab-gate': {
                width: 5,
                thickness: 2,
                location
            },
            'tunnel-gate': {
                diameter: 2,
                length: 5,
                location
            }
        };

        return {
            gateId: `gate_${cavityIndex}`,
            cavityIndex,
            ...gateDesigns[gateType]
        };
    }

    /**
     * Select optimal gate location
     */
    selectOptimalGateLocation(partModel) {
        // Gate should be at thickest wall section, away from visible surfaces
        // Real implementation would analyze wall thickness distribution

        return {
            x: 50,
            y: 25,
            z: 0,  // At parting line
            reasoning: 'Thickest wall section, hidden surface'
        };
    }

    /**
     * Design cooling system
     */
    async designCoolingSystem(partModel, core, cavity, material) {
        console.log(`    ❄️ Designing cooling channels for ${material}...`);

        const matProps = this.plasticMaterials[material];
        const coolingChannels = [];

        // Cooling channels in core
        const coreChannels = this.generateCoolingChannels(
            core,
            'core',
            matProps.moldTemperature,
            8  // 8mm diameter channels
        );
        coolingChannels.push(...coreChannels);

        // Cooling channels in cavity
        const cavityChannels = this.generateCoolingChannels(
            cavity,
            'cavity',
            matProps.moldTemperature,
            8
        );
        coolingChannels.push(...cavityChannels);

        // Calculate cooling time
        const coolingTime = this.calculateCoolingTime(partModel, matProps);

        console.log(`    ✅ ${coolingChannels.length} cooling channels, ~${coolingTime.toFixed(1)}s cycle time`);

        return coolingChannels.map(ch => ({
            ...ch,
            estimatedCoolingTime: coolingTime
        }));
    }

    /**
     * Generate cooling channels
     */
    generateCoolingChannels(moldHalf, type, moldTemp, diameter) {
        const channels = [];

        // Create parallel cooling channels
        for (let i = 0; i < 4; i++) {
            channels.push({
                channelId: `${type}_channel_${i}`,
                moldHalf: type,
                diameter,
                layout: 'straight',  // 'straight', 'baffle', 'spiral', 'conformal'
                inlet: { x: 0, y: i * 25, z: 0 },
                outlet: { x: 100, y: i * 25, z: 0 },
                distanceToSurface: 12,  // mm (3 × diameter rule of thumb)
                moldTemperature: moldTemp,
                flowRate: 5  // liters/min
            });
        }

        return channels;
    }

    /**
     * Calculate cooling time
     */
    calculateCoolingTime(partModel, matProps) {
        // Simplified formula: t = (s² / π²α) × ln(4(T_inj - T_mold) / π(T_eject - T_mold))
        // where s = wall thickness, α = thermal diffusivity

        const wallThickness = 3;  // mm (simplified - would analyze actual part)
        const T_inj = matProps.meltTemperature;  // °C
        const T_mold = matProps.moldTemperature;  // °C
        const T_eject = matProps.ejectTemperature;  // °C
        const alpha = matProps.thermalDiffusivity;  // mm²/s

        const coolingTime = (wallThickness * wallThickness / (Math.PI * Math.PI * alpha)) *
                          Math.log((4 * (T_inj - T_mold)) / (Math.PI * (T_eject - T_mold)));

        return coolingTime;
    }

    /**
     * Design ejection system
     */
    async designEjectionSystem(partModel, core) {
        console.log(`    ⬆️ Designing ejection system...`);

        const ejectionSystem = {
            type: 'pin-ejection',  // 'pin', 'sleeve', 'stripper-plate', 'air-blast'
            pins: [],
            strokeLength: 25,  // mm
            force: 500  // N (estimated)
        };

        // Place ejector pins
        const pinLocations = this.calculateEjectorPinLocations(partModel);

        pinLocations.forEach((location, index) => {
            ejectionSystem.pins.push({
                pinId: `ejector_${index}`,
                diameter: 3,  // mm
                length: 100,  // mm
                location,
                type: 'standard'  // 'standard', 'shoulder', 'blade'
            });
        });

        console.log(`    ✅ ${ejectionSystem.pins.length} ejector pins placed`);

        return ejectionSystem;
    }

    /**
     * Calculate ejector pin locations
     */
    calculateEjectorPinLocations(partModel) {
        // Pins should be evenly distributed, avoiding thin walls and visible surfaces
        // Simplified - returns example locations

        return [
            { x: 20, y: 20, z: 0 },
            { x: 80, y: 20, z: 0 },
            { x: 20, y: 80, z: 0 },
            { x: 80, y: 80, z: 0 },
            { x: 50, y: 50, z: 0 }
        ];
    }

    /**
     * Estimate mold cost
     */
    estimateMoldCost(mold) {
        let baseCost = 5000;  // Base tooling cost

        // Cavity cost
        baseCost += mold.cavities * 3000;

        // Undercut features
        mold.undercuts.forEach(uc => {
            baseCost += uc.estimatedCost || 2000;
        });

        // Hot runner (if applicable)
        if (mold.moldBase === 'hot-runner') {
            baseCost += mold.cavities * 5000;
        }

        // Stack mold (if applicable)
        if (mold.moldBase === 'stack') {
            baseCost *= 2;
        }

        // Complexity factor
        const complexityMultiplier = {
            'simple': 1.0,
            'moderate': 1.3,
            'complex': 1.8
        };
        baseCost *= complexityMultiplier[mold.partingLine.complexity] || 1.0;

        return Math.round(baseCost);
    }

    /**
     * Estimate mold lead time
     */
    estimateMoldLeadTime(mold) {
        let weeks = 6;  // Base lead time

        // Add time for complexity
        if (mold.cavities > 4) weeks += 2;
        if (mold.undercuts.length > 0) weeks += mold.undercuts.length * 1;
        if (mold.moldBase === 'hot-runner') weeks += 3;
        if (mold.moldBase === 'stack') weeks += 4;

        return weeks;
    }

    /**
     * Generate warnings
     */
    generateWarnings(mold) {
        const warnings = [];

        if (mold.draftAnalysis.insufficientDraft.length > 0) {
            warnings.push(`⚠️ ${mold.draftAnalysis.insufficientDraft.length} faces have insufficient draft`);
        }

        if (mold.undercuts.length > 0) {
            warnings.push(`⚠️ ${mold.undercuts.length} undercuts detected - will increase mold cost`);
        }

        if (mold.partingLine.quality === 'poor') {
            warnings.push('⚠️ Parting line quality is poor - consider redesign');
        }

        // Cooling time warning
        const coolingTime = mold.coolingChannels[0]?.estimatedCoolingTime || 0;
        if (coolingTime > 60) {
            warnings.push(`⚠️ Cooling time is high (${coolingTime.toFixed(1)}s) - consider thinner walls`);
        }

        return warnings;
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(mold) {
        const recs = [];

        // Draft recommendations
        const draftPercent = (mold.draftAnalysis.sufficientDraft.length / mold.draftAnalysis.totalFaces) * 100;
        recs.push(`✅ ${draftPercent.toFixed(0)}% of faces have adequate draft`);

        // Material recommendations
        const matProps = mold.materialProperties;
        recs.push(`ℹ️ ${matProps.name}: shrinkage ${(matProps.shrinkage * 100).toFixed(2)}%, min wall ${matProps.minWallThickness}mm`);

        // Gate recommendations
        recs.push(`🚪 ${mold.gateSystem.type} at ${mold.gateSystem.location.reasoning}`);

        // Cooling recommendations
        recs.push(`❄️ ${mold.coolingChannels.length} cooling channels for uniform cooling`);

        // Cost and lead time
        recs.push(`💰 Estimated mold cost: $${mold.estimatedCost.toLocaleString()}`);
        recs.push(`📅 Estimated lead time: ${mold.estimatedLeadTime} weeks`);

        // Production volume recommendation
        if (mold.productionVolume < 1000 && mold.cavities > 1) {
            recs.push('💡 Low volume production - consider single cavity mold to reduce cost');
        } else if (mold.productionVolume > 100000 && mold.cavities < 4) {
            recs.push('💡 High volume production - consider multi-cavity mold to reduce cycle time');
        }

        return recs;
    }

    // ========== Helper Methods ==========

    scaleGeometry(geometry, scale) {
        // Simplified - real implementation would scale actual geometry
        return {
            ...geometry,
            scaleFactor: scale
        };
    }

    // ========== Initialization ==========

    initializePlasticMaterials() {
        return {
            'ABS': {
                name: 'ABS (Acrylonitrile Butadiene Styrene)',
                shrinkage: 0.005,  // 0.5%
                meltTemperature: 230,  // °C
                moldTemperature: 60,  // °C
                ejectTemperature: 90,  // °C
                thermalDiffusivity: 0.11,  // mm²/s
                minWallThickness: 1.2,  // mm
                maxWallThickness: 3.5,
                minDraft: 0.5,  // degrees
                recommendedDraft: 1.5,
                flowLength: 150  // mm (max flow length)
            },
            'PC': {
                name: 'Polycarbonate',
                shrinkage: 0.006,
                meltTemperature: 300,
                moldTemperature: 90,
                ejectTemperature: 130,
                thermalDiffusivity: 0.14,
                minWallThickness: 1.0,
                maxWallThickness: 4.0,
                minDraft: 0.5,
                recommendedDraft: 1.0,
                flowLength: 100
            },
            'PP': {
                name: 'Polypropylene',
                shrinkage: 0.015,  // 1.5% (high shrinkage)
                meltTemperature: 220,
                moldTemperature: 40,
                ejectTemperature: 70,
                thermalDiffusivity: 0.09,
                minWallThickness: 0.8,
                maxWallThickness: 3.0,
                minDraft: 1.0,
                recommendedDraft: 2.0,
                flowLength: 200
            },
            'PA66': {
                name: 'Nylon 6/6',
                shrinkage: 0.012,
                meltTemperature: 280,
                moldTemperature: 80,
                ejectTemperature: 120,
                thermalDiffusivity: 0.10,
                minWallThickness: 0.75,
                maxWallThickness: 3.0,
                minDraft: 1.0,
                recommendedDraft: 1.5,
                flowLength: 120
            },
            'POM': {
                name: 'Acetal (Delrin)',
                shrinkage: 0.020,  // 2.0% (very high shrinkage)
                meltTemperature: 210,
                moldTemperature: 90,
                ejectTemperature: 140,
                thermalDiffusivity: 0.12,
                minWallThickness: 0.8,
                maxWallThickness: 3.0,
                minDraft: 0.5,
                recommendedDraft: 1.0,
                flowLength: 100
            },
            'HDPE': {
                name: 'High Density Polyethylene',
                shrinkage: 0.018,
                meltTemperature: 200,
                moldTemperature: 30,
                ejectTemperature: 60,
                thermalDiffusivity: 0.13,
                minWallThickness: 0.75,
                maxWallThickness: 4.0,
                minDraft: 1.5,
                recommendedDraft: 2.5,
                flowLength: 250
            }
        };
    }

    initializeMoldStandards() {
        return {
            'DME': {
                name: 'DME (North America)',
                baseType: 'two-plate',
                sizes: ['A', 'B', 'C', 'D', 'E'],
                ejectorPinSizes: [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            },
            'HASCO': {
                name: 'HASCO (European)',
                baseType: 'two-plate',
                sizes: ['K', 'L', 'M', 'N'],
                ejectorPinSizes: [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            },
            'LKM': {
                name: 'LKM (Asian)',
                baseType: 'two-plate',
                sizes: ['2025', '2530', '3035', '3540'],
                ejectorPinSizes: [2, 3, 4, 5, 6, 8, 10]
            }
        };
    }
}

module.exports = new PlasticMoldDesignService();
