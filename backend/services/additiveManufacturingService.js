/**
 * 3D Printing & Additive Manufacturing Service
 * FDM, SLA, SLS, DMLS, Binder Jetting support
 * Auto-orientation, support generation, slicing preview
 * Print time estimation, material usage, cost calculation
 */

class AdditiveManufacturingService {
    constructor() {
        this.printJobs = new Map();
        this.printers = this.initializePrinters();
        this.materials = this.initializeMaterials();
    }

    /**
     * Prepare model for 3D printing
     */
    async preparePrint(spec) {
        const {
            modelId,
            model3D,
            modelName,
            technology = 'FDM',  // 'FDM', 'SLA', 'SLS', 'DMLS', 'Binder-Jetting', 'PolyJet'
            material = 'PLA',
            printer = null,  // Auto-select if null
            autoOrient = true,
            autoSupports = true,
            layerHeight = null,  // Auto-select if null
            infill = 20,  // percentage
            quality = 'normal'  // 'draft', 'normal', 'high', 'ultra'
        } = spec;

        console.log(`🖨️ 3D Print Prep: "${modelName}" (${technology}, ${material})...`);

        const jobId = `print_${Date.now()}`;

        // Select printer
        const selectedPrinter = printer || this.selectPrinter(technology, model3D);

        // Get material properties
        const matProps = this.materials[technology]?.[material];
        if (!matProps) {
            throw new Error(`Material ${material} not available for ${technology}`);
        }

        const printJob = {
            jobId,
            modelId,
            modelName,
            technology,
            material,
            materialProperties: matProps,
            printer: selectedPrinter,
            orientation: null,
            supports: null,
            settings: {
                layerHeight: layerHeight || this.getDefaultLayerHeight(quality, technology),
                infill,
                quality,
                shellThickness: 1.0,
                printSpeed: 50,
                temperature: matProps.printTemperature,
                bedTemperature: matProps.bedTemperature
            },
            analysis: null,
            estimates: null,
            warnings: [],
            createdAt: Date.now()
        };

        // Step 1: Analyze printability
        console.log(`  🔍 Analyzing printability...`);
        printJob.analysis = await this.analyzePrintability(model3D, technology, matProps);

        // Step 2: Auto-orient if requested
        if (autoOrient) {
            console.log(`  🔄 Optimizing orientation...`);
            printJob.orientation = await this.optimizeOrientation(model3D, technology, printJob.analysis);
        }

        // Step 3: Generate supports if needed
        if (autoSupports && printJob.analysis.needsSupport) {
            console.log(`  🏗️ Generating supports...`);
            printJob.supports = await this.generateSupports(model3D, printJob.orientation, technology);
        }

        // Step 4: Calculate estimates
        console.log(`  📊 Calculating estimates...`);
        printJob.estimates = await this.calculateEstimates(
            model3D,
            printJob.orientation,
            printJob.supports,
            printJob.settings,
            matProps
        );

        // Step 5: Generate warnings
        printJob.warnings = this.generateWarnings(printJob);

        this.printJobs.set(jobId, printJob);

        console.log(`  ✅ Print prepared: ${printJob.estimates.printTime.toFixed(1)}h, ${printJob.estimates.materialUsed.toFixed(0)}g, $${printJob.estimates.cost.toFixed(2)}`);

        return {
            success: true,
            operation: 'prepare-print',
            printJob,
            estimates: printJob.estimates,
            warnings: printJob.warnings
        };
    }

    /**
     * Analyze printability
     */
    async analyzePrintability(model3D, technology, matProps) {
        const analysis = {
            printable: true,
            issues: [],
            warnings: [],
            needsSupport: false,
            overhangs: [],
            thinWalls: [],
            smallFeatures: [],
            volumeBounds: this.calculateBounds(model3D)
        };

        // Check build volume
        const printer = this.printers[technology][0];
        if (analysis.volumeBounds.x > printer.buildVolume.x ||
            analysis.volumeBounds.y > printer.buildVolume.y ||
            analysis.volumeBounds.z > printer.buildVolume.z) {
            analysis.printable = false;
            analysis.issues.push({
                severity: 'critical',
                issue: 'Model exceeds printer build volume',
                solution: `Scale down or use larger printer (max: ${printer.buildVolume.x}×${printer.buildVolume.y}×${printer.buildVolume.z}mm)`
            });
        }

        // Detect overhangs
        const overhangs = this.detectOverhangs(model3D);
        if (overhangs.length > 0) {
            analysis.needsSupport = true;
            analysis.overhangs = overhangs;
            analysis.warnings.push({
                severity: 'medium',
                issue: `${overhangs.length} overhangs detected (${overhangs.filter(o => o.angle > 60).length} critical)`,
                solution: 'Auto-generate supports or reorient model'
            });
        }

        // Check wall thickness
        const minWall = matProps.minWallThickness;
        const thinWalls = this.detectThinWalls(model3D, minWall);
        if (thinWalls.length > 0) {
            analysis.thinWalls = thinWalls;
            analysis.warnings.push({
                severity: 'high',
                issue: `${thinWalls.length} walls thinner than ${minWall}mm`,
                solution: `Thicken walls to minimum ${minWall}mm`
            });
        }

        // Check small features
        const minFeature = matProps.minFeatureSize;
        const smallFeatures = this.detectSmallFeatures(model3D, minFeature);
        if (smallFeatures.length > 0) {
            analysis.smallFeatures = smallFeatures;
            analysis.warnings.push({
                severity: 'medium',
                issue: `${smallFeatures.length} features smaller than ${minFeature}mm`,
                solution: 'May not print reliably - enlarge or remove'
            });
        }

        console.log(`    ✅ Printability: ${analysis.printable ? 'OK' : 'ISSUES'} (${analysis.issues.length} issues, ${analysis.warnings.length} warnings)`);

        return analysis;
    }

    /**
     * Optimize part orientation
     */
    async optimizeOrientation(model3D, technology, analysis) {
        console.log(`    🔄 Testing orientations...`);

        const orientations = [];

        // Test multiple orientations
        const rotations = [
            { x: 0, y: 0, z: 0, name: 'Original' },
            { x: 90, y: 0, z: 0, name: 'Rotate X 90°' },
            { x: 0, y: 90, z: 0, name: 'Rotate Y 90°' },
            { x: 0, y: 0, z: 90, name: 'Rotate Z 90°' },
            { x: 180, y: 0, z: 0, name: 'Flip X' },
            { x: 0, y: 180, z: 0, name: 'Flip Y' }
        ];

        for (const rotation of rotations) {
            const rotatedModel = this.rotateModel(model3D, rotation);
            const score = this.scoreOrientation(rotatedModel, technology);
            orientations.push({
                rotation,
                score,
                supportVolume: score.supportVolume,
                surfaceQuality: score.surfaceQuality,
                printTime: score.printTime
            });
        }

        // Sort by overall score (lower is better)
        orientations.sort((a, b) => a.score.overall - b.score.overall);

        const best = orientations[0];

        console.log(`      ✅ Best: ${best.rotation.name} (score: ${best.score.overall.toFixed(2)})`);

        return {
            rotation: best.rotation,
            score: best.score,
            alternatives: orientations.slice(1, 3)
        };
    }

    /**
     * Score orientation
     */
    scoreOrientation(model, technology) {
        // Simplified scoring
        const overhangs = this.detectOverhangs(model);
        const supportVolume = overhangs.length * 10;  // Simplified
        const surfaceQuality = 100 - (overhangs.length * 5);
        const printTime = this.calculateBounds(model).z / 0.2;  // Layer height

        const overall = (
            supportVolume * 0.4 +  // Minimize supports
            (100 - surfaceQuality) * 0.3 +  // Maximize quality
            printTime * 0.3  // Minimize time
        );

        return {
            overall,
            supportVolume,
            surfaceQuality,
            printTime
        };
    }

    /**
     * Generate support structures
     */
    async generateSupports(model3D, orientation, technology) {
        console.log(`    🏗️ Calculating support structures...`);

        const rotatedModel = this.rotateModel(model3D, orientation.rotation);
        const overhangs = this.detectOverhangs(rotatedModel);

        const supports = {
            type: technology === 'FDM' ? 'tree' : 'standard',  // Tree supports for FDM
            count: 0,
            volume: 0,
            areas: []
        };

        overhangs.forEach(overhang => {
            if (overhang.angle > 45) {  // Need support
                const supportArea = {
                    location: overhang.location,
                    area: overhang.area,
                    height: overhang.height,
                    density: overhang.angle > 60 ? 'dense' : 'normal'
                };
                supports.areas.push(supportArea);
                supports.volume += supportArea.area * supportArea.height * 0.15;  // 15% density
                supports.count++;
            }
        });

        console.log(`      ✅ ${supports.count} support structures (~${supports.volume.toFixed(0)}mm³)`);

        return supports;
    }

    /**
     * Calculate print estimates
     */
    async calculateEstimates(model3D, orientation, supports, settings, matProps) {
        const volume = this.calculateVolume(model3D);
        const bounds = this.calculateBounds(model3D);

        // Material usage
        const modelVolume = volume * (settings.infill / 100);  // Account for infill
        const shellVolume = this.calculateSurfaceArea(model3D) * settings.shellThickness;
        const supportVolume = supports ? supports.volume : 0;
        const totalVolume = modelVolume + shellVolume + supportVolume;

        const materialUsed = (totalVolume / 1000) * matProps.density;  // grams

        // Print time
        const layerCount = Math.ceil(bounds.z / settings.layerHeight);
        const printTime = (layerCount * 2) / 60;  // 2 min per layer average (simplified)

        // Cost
        const materialCost = materialUsed * (matProps.costPerKg / 1000);
        const machineCost = printTime * 5;  // $5/hour machine time
        const totalCost = materialCost + machineCost;

        return {
            materialUsed,  // grams
            supportMaterial: (supportVolume / 1000) * matProps.density,  // grams
            printTime,  // hours
            layerCount,
            cost: totalCost,
            breakdown: {
                materialCost,
                machineCost,
                laborCost: 0  // Automated
            }
        };
    }

    /**
     * Export G-code/slicing file
     */
    async exportPrintFile(jobId, format = 'gcode') {
        const job = this.printJobs.get(jobId);
        if (!job) {
            throw new Error(`Print job ${jobId} not found`);
        }

        console.log(`📤 Exporting ${format.toUpperCase()} for ${job.technology}...`);

        const printFile = {
            format: format.toUpperCase(),
            technology: job.technology,
            material: job.material,
            settings: job.settings,
            metadata: {
                modelName: job.modelName,
                layerHeight: job.settings.layerHeight,
                infill: job.settings.infill,
                printTime: job.estimates.printTime,
                materialUsed: job.estimates.materialUsed
            },
            content: null
        };

        if (format === 'gcode') {
            printFile.content = this.generateGCode(job);
        } else if (format === '3mf') {
            printFile.content = this.generate3MF(job);
        } else if (format === 'stl') {
            printFile.content = this.generateSTL(job);
        }

        return {
            success: true,
            operation: 'export-print-file',
            printFile,
            downloadUrl: `/api/mechanical/3dprint/${jobId}/export.${format}`
        };
    }

    // ========== Helper Methods ==========

    selectPrinter(technology, model3D) {
        const printers = this.printers[technology];
        if (!printers || printers.length === 0) {
            throw new Error(`No printers available for ${technology}`);
        }

        const bounds = this.calculateBounds(model3D);

        // Select smallest printer that fits
        for (const printer of printers) {
            if (bounds.x <= printer.buildVolume.x &&
                bounds.y <= printer.buildVolume.y &&
                bounds.z <= printer.buildVolume.z) {
                return printer;
            }
        }

        throw new Error('Model too large for available printers');
    }

    getDefaultLayerHeight(quality, technology) {
        const heights = {
            'FDM': { 'draft': 0.3, 'normal': 0.2, 'high': 0.1, 'ultra': 0.05 },
            'SLA': { 'draft': 0.1, 'normal': 0.05, 'high': 0.025, 'ultra': 0.01 },
            'SLS': { 'draft': 0.15, 'normal': 0.1, 'high': 0.075, 'ultra': 0.05 }
        };

        return heights[technology]?.[quality] || 0.2;
    }

    detectOverhangs(model3D) {
        // Simplified overhang detection
        return [
            { location: { x: 50, y: 50, z: 30 }, angle: 65, area: 200, height: 10 },
            { location: { x: 25, y: 75, z: 40 }, angle: 50, area: 150, height: 8 }
        ];
    }

    detectThinWalls(model3D, minThickness) {
        // Simplified
        return [];
    }

    detectSmallFeatures(model3D, minSize) {
        // Simplified
        return [];
    }

    rotateModel(model3D, rotation) {
        // Simplified rotation
        return model3D;
    }

    calculateBounds(model3D) {
        // Simplified bounds calculation
        return { x: 100, y: 100, z: 50 };
    }

    calculateVolume(model3D) {
        // Simplified volume
        return 100000;  // mm³
    }

    calculateSurfaceArea(model3D) {
        // Simplified surface area
        return 10000;  // mm²
    }

    generateWarnings(job) {
        const warnings = [];

        if (job.estimates.printTime > 24) {
            warnings.push(`⏰ Long print time: ${job.estimates.printTime.toFixed(1)} hours`);
        }

        if (job.supports && job.supports.count > 10) {
            warnings.push(`🏗️ Extensive supports required (${job.supports.count} areas)`);
        }

        if (job.analysis.warnings.length > 0) {
            warnings.push(...job.analysis.warnings.map(w => `⚠️ ${w.issue}`));
        }

        return warnings;
    }

    generateGCode(job) {
        // Simplified G-code generation
        return `; Generated by ArchDisc AI CAD
; Technology: ${job.technology}
; Material: ${job.material}
; Layer Height: ${job.settings.layerHeight}mm
; Print Time: ${job.estimates.printTime.toFixed(1)}h

G28 ; Home all axes
M140 S${job.settings.bedTemperature} ; Set bed temp
M190 S${job.settings.bedTemperature} ; Wait for bed temp
M104 S${job.settings.temperature} ; Set hotend temp
M109 S${job.settings.temperature} ; Wait for hotend temp

; Start printing
G1 Z0.2 F3000
; ... layers ...

M104 S0 ; Turn off hotend
M140 S0 ; Turn off bed
G28 X0 ; Home X
M84 ; Disable motors`;
    }

    generate3MF(job) {
        return { format: '3MF', data: 'Binary 3MF data' };
    }

    generateSTL(job) {
        return { format: 'STL', data: 'Binary STL data' };
    }

    // ========== Initialization ==========

    initializePrinters() {
        return {
            'FDM': [
                {
                    name: 'Prusa i3 MK3S+',
                    buildVolume: { x: 250, y: 210, z: 210 },
                    nozzleSizes: [0.4, 0.6, 0.8],
                    maxTemp: 300,
                    materials: ['PLA', 'PETG', 'ABS', 'TPU', 'Nylon']
                },
                {
                    name: 'Creality CR-10',
                    buildVolume: { x: 300, y: 300, z: 400 },
                    nozzleSizes: [0.4],
                    maxTemp: 260,
                    materials: ['PLA', 'PETG', 'ABS']
                }
            ],
            'SLA': [
                {
                    name: 'Formlabs Form 3',
                    buildVolume: { x: 145, y: 145, z: 185 },
                    resolution: 0.025,
                    materials: ['Standard Resin', 'Tough Resin', 'Flexible Resin', 'Castable Resin']
                }
            ],
            'SLS': [
                {
                    name: 'Formlabs Fuse 1',
                    buildVolume: { x: 165, y: 165, z: 320 },
                    materials: ['Nylon 12', 'Nylon 11']
                }
            ]
        };
    }

    initializeMaterials() {
        return {
            'FDM': {
                'PLA': {
                    name: 'PLA (Polylactic Acid)',
                    printTemperature: 210,
                    bedTemperature: 60,
                    density: 1.24,  // g/cm³
                    costPerKg: 20,
                    minWallThickness: 0.8,
                    minFeatureSize: 0.4,
                    shrinkage: 0.003,
                    properties: { strength: 'medium', flexibility: 'low', temperature: 'low' }
                },
                'PETG': {
                    name: 'PETG',
                    printTemperature: 230,
                    bedTemperature: 80,
                    density: 1.27,
                    costPerKg: 25,
                    minWallThickness: 0.8,
                    minFeatureSize: 0.4,
                    shrinkage: 0.007,
                    properties: { strength: 'high', flexibility: 'medium', temperature: 'medium' }
                },
                'ABS': {
                    name: 'ABS',
                    printTemperature: 240,
                    bedTemperature: 100,
                    density: 1.04,
                    costPerKg: 22,
                    minWallThickness: 1.0,
                    minFeatureSize: 0.5,
                    shrinkage: 0.015,
                    properties: { strength: 'high', flexibility: 'low', temperature: 'medium' }
                }
            },
            'SLA': {
                'Standard Resin': {
                    name: 'Standard Photopolymer Resin',
                    density: 1.15,
                    costPerKg: 150,
                    minWallThickness: 0.4,
                    minFeatureSize: 0.1,
                    shrinkage: 0.002,
                    properties: { strength: 'medium', flexibility: 'low', detail: 'very high' }
                }
            },
            'SLS': {
                'Nylon 12': {
                    name: 'Nylon 12 (PA12)',
                    density: 1.01,
                    costPerKg: 70,
                    minWallThickness: 0.7,
                    minFeatureSize: 0.3,
                    shrinkage: 0.035,
                    properties: { strength: 'very high', flexibility: 'high', durability: 'excellent' }
                }
            }
        };
    }
}

module.exports = new AdditiveManufacturingService();
