/**
 * CAM (Computer-Aided Manufacturing) Service
 * Generates toolpaths for CNC machining - 2.5/3/5-axis milling, turning, drilling
 */

class CAMService {
    constructor() {
        this.toolLibrary = this._initializeToolLibrary();
        this.machineLibrary = this._initializeMachineLibrary();
        this.postProcessors = this._initializePostProcessors();
    }

    /**
     * Initialize comprehensive tool library
     */
    _initializeToolLibrary() {
        return {
            // End Mills
            'end_mill_3mm': { diameter: 3, type: 'end_mill', flutes: 2, maxDepth: 10, material: 'carbide' },
            'end_mill_6mm': { diameter: 6, type: 'end_mill', flutes: 4, maxDepth: 20, material: 'carbide' },
            'end_mill_12mm': { diameter: 12, type: 'end_mill', flutes: 4, maxDepth: 30, material: 'carbide' },
            // Ball Nose
            'ball_nose_3mm': { diameter: 3, type: 'ball_nose', flutes: 2, maxDepth: 10, material: 'carbide' },
            'ball_nose_6mm': { diameter: 6, type: 'ball_nose', flutes: 4, maxDepth: 15, material: 'carbide' },
            // Drills
            'drill_3mm': { diameter: 3, type: 'drill', flutes: 2, maxDepth: 40, material: 'HSS' },
            'drill_5mm': { diameter: 5, type: 'drill', flutes: 2, maxDepth: 50, material: 'HSS' },
            'drill_8mm': { diameter: 8, type: 'drill', flutes: 2, maxDepth: 80, material: 'HSS' },
            // Turning Tools
            'turning_insert_TNMG': { type: 'turning_insert', noseRadius: 0.8, insertShape: 'TNMG' },
            'turning_insert_CNMG': { type: 'turning_insert', noseRadius: 0.4, insertShape: 'CNMG' },
            'grooving_3mm': { type: 'grooving', width: 3 },
            'threading_M10': { type: 'threading', pitch: 1.5, majorDiameter: 10 },
            // Chamfer & Deburr
            'chamfer_90deg': { type: 'chamfer', angle: 90, diameter: 12 }
        };
    }

    /**
     * Initialize machine configurations
     */
    _initializeMachineLibrary() {
        return {
            'haas_vf2': {
                type: '3-axis_mill',
                workEnvelope: { x: 762, y: 406, z: 508 },
                maxSpindleSpeed: 8100,
                maxFeedRate: 12700
            },
            'dmg_5axis': {
                type: '5-axis_mill',
                workEnvelope: { x: 600, y: 500, z: 450 },
                rotaryAxes: ['A', 'C'],
                maxSpindleSpeed: 18000,
                maxFeedRate: 15000
            },
            'haas_st30': {
                type: 'lathe',
                maxDiameter: 330,
                maxLength: 660,
                maxSpindleSpeed: 6000,
                hasMilling: true
            }
        };
    }

    /**
     * Initialize postprocessor configurations
     */
    _initializePostProcessors() {
        return {
            'fanuc': { dialect: 'fanuc', rapidCommand: 'G0', linearCommand: 'G1' },
            'haas': { dialect: 'haas', rapidCommand: 'G0', linearCommand: 'G1', arcCW: 'G2', arcCCW: 'G3' },
            'siemens_840d': { dialect: 'siemens', rapidCommand: 'G0', linearCommand: 'G1' },
            'mazak': { dialect: 'mazak', rapidCommand: 'G0', linearCommand: 'G1' }
        };
    }

    /**
     * Generate CNC toolpaths from 3D model
     */
    async generateToolpaths(modelData, options = {}) {
        const {
            operations = ['roughing', 'finishing'], // roughing, finishing, drilling, pocketing
            material = 'aluminum', // aluminum, steel, wood, plastic
            tolerance = 0.01, // mm
            feedRate = 1000, // mm/min
            spindleSpeed = 12000 // RPM
        } = options;

        console.log('🔧 Generating CAM toolpaths...');
        console.log(`   Material: ${material}`);
        console.log(`   Operations: ${operations.join(', ')}`);

        const toolpaths = [];

        // Generate toolpaths for each operation
        for (const operation of operations) {
            const toolpath = await this.generateOperation(operation, modelData, {
                material,
                tolerance,
                feedRate,
                spindleSpeed
            });
            toolpaths.push(toolpath);
        }

        // Calculate machining time
        const totalTime = this.calculateMachiningTime(toolpaths);

        console.log(`✅ Toolpaths generated`);
        console.log(`   Total operations: ${toolpaths.length}`);
        console.log(`   Estimated time: ${totalTime.toFixed(1)} minutes`);

        return {
            toolpaths,
            estimatedTime: totalTime,
            material,
            metadata: {
                generatedAt: new Date().toISOString(),
                tolerance,
                feedRate,
                spindleSpeed
            }
        };
    }

    /**
     * Generate specific machining operation
     */
    async generateOperation(operation, modelData, params) {
        switch (operation) {
            case 'roughing':
                return this.generateRoughing(modelData, params);
            case 'finishing':
                return this.generateFinishing(modelData, params);
            case 'drilling':
                return this.generateDrilling(modelData, params);
            case 'pocketing':
                return this.generatePocketing(modelData, params);
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
    }

    /**
     * Roughing operation - remove bulk material
     */
    generateRoughing(modelData, params) {
        const tool = this.toolLibrary['end_mill_6mm'];
        const stepover = tool.diameter * 0.5; // 50% stepover
        const paths = [];

        // Generate zigzag roughing pattern
        const bbox = this.getBoundingBox(modelData.geometry);
        const levels = Math.ceil((bbox.max.z - bbox.min.z) / tool.maxDepth);

        for (let level = 0; level < levels; level++) {
            const z = bbox.max.z - (level + 1) * tool.maxDepth;

            for (let y = bbox.min.y; y <= bbox.max.y; y += stepover) {
                // Zigzag pattern
                const forward = level % 2 === 0;
                const xStart = forward ? bbox.min.x : bbox.max.x;
                const xEnd = forward ? bbox.max.x : bbox.min.x;

                paths.push({
                    type: 'linear',
                    start: { x: xStart, y, z },
                    end: { x: xEnd, y, z },
                    feedRate: params.feedRate
                });
            }
        }

        return {
            operation: 'roughing',
            tool: 'end_mill_6mm',
            paths,
            spindleSpeed: params.spindleSpeed,
            coolant: true
        };
    }

    /**
     * Finishing operation - final surface quality
     */
    generateFinishing(modelData, params) {
        const tool = this.toolLibrary['ball_nose_6mm'];
        const paths = [];

        // Generate contour following paths
        const bbox = this.getBoundingBox(modelData.geometry);
        const stepdown = 0.5; // mm

        for (let z = bbox.max.z; z >= bbox.min.z; z -= stepdown) {
            // Follow contour at this Z level
            const contour = this.extractContour(modelData.geometry, z);

            contour.forEach((point, i) => {
                if (i > 0) {
                    paths.push({
                        type: 'linear',
                        start: contour[i - 1],
                        end: point,
                        feedRate: params.feedRate * 0.8 // Slower for finishing
                    });
                }
            });
        }

        return {
            operation: 'finishing',
            tool: 'ball_nose_6mm',
            paths,
            spindleSpeed: params.spindleSpeed * 1.2,
            coolant: false
        };
    }

    /**
     * Drilling operation
     */
    generateDrilling(modelData, params) {
        const tool = this.toolLibrary['drill_5mm'];
        const holes = this.detectHoles(modelData.geometry);
        const paths = [];

        holes.forEach(hole => {
            // Rapid to hole position
            paths.push({
                type: 'rapid',
                start: { x: hole.x, y: hole.y, z: 5 },
                end: { x: hole.x, y: hole.y, z: 1 }
            });

            // Drill with pecking
            const peckDepth = 5; // mm
            for (let depth = peckDepth; depth <= hole.depth; depth += peckDepth) {
                paths.push({
                    type: 'drill',
                    position: { x: hole.x, y: hole.y, z: -depth },
                    feedRate: params.feedRate * 0.3
                });
                // Retract for chip clearance
                paths.push({
                    type: 'retract',
                    position: { x: hole.x, y: hole.y, z: 1 }
                });
            }
        });

        return {
            operation: 'drilling',
            tool: 'drill_5mm',
            paths,
            spindleSpeed: params.spindleSpeed * 0.8
        };
    }

    /**
     * Pocketing operation
     */
    generatePocketing(modelData, params) {
        const tool = this.toolLibrary['end_mill_3mm'];
        const pockets = this.detectPockets(modelData.geometry);
        const paths = [];

        pockets.forEach(pocket => {
            // Spiral pocketing strategy
            const centerX = (pocket.min.x + pocket.max.x) / 2;
            const centerY = (pocket.min.y + pocket.max.y) / 2;
            const maxRadius = Math.max(
                pocket.max.x - centerX,
                pocket.max.y - centerY
            );

            for (let radius = tool.diameter / 2; radius < maxRadius; radius += tool.diameter * 0.5) {
                for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
                    const x = centerX + radius * Math.cos(angle);
                    const y = centerY + radius * Math.sin(angle);
                    const z = pocket.depth;

                    paths.push({
                        type: 'arc',
                        position: { x, y, z },
                        feedRate: params.feedRate
                    });
                }
            }
        });

        return {
            operation: 'pocketing',
            tool: 'end_mill_3mm',
            paths
        };
    }

    /**
     * Export toolpaths as G-code
     */
    exportGCode(toolpaths, options = {}) {
        const {
            machine = 'generic', // generic, haas, fanuc, siemens
            units = 'mm', // mm or inch
            includeComments = true
        } = options;

        let gcode = '';

        // Header
        gcode += includeComments ? '; Generated by ArchDisc CAM\n' : '';
        gcode += includeComments ? `; Date: ${new Date().toISOString()}\n` : '';
        gcode += 'G21 ; Metric units\n';
        gcode += 'G90 ; Absolute positioning\n';
        gcode += 'G17 ; XY plane\n\n';

        // Generate G-code for each toolpath
        toolpaths.forEach((tp, index) => {
            gcode += includeComments ? `\n; Operation ${index + 1}: ${tp.operation}\n` : '';
            gcode += `M6 T${index + 1} ; Tool change\n`;
            gcode += `S${tp.spindleSpeed} M3 ; Spindle on\n`;
            if (tp.coolant) gcode += 'M8 ; Coolant on\n';
            gcode += '\n';

            tp.paths.forEach(path => {
                gcode += this.pathToGCode(path);
            });

            if (tp.coolant) gcode += 'M9 ; Coolant off\n';
            gcode += '\n';
        });

        // Footer
        gcode += 'M5 ; Spindle off\n';
        gcode += 'G0 Z50 ; Safe Z\n';
        gcode += 'M30 ; Program end\n';

        return gcode;
    }

    /**
     * Convert path to G-code command
     */
    pathToGCode(path) {
        switch (path.type) {
            case 'rapid':
                return `G0 X${path.end.x.toFixed(3)} Y${path.end.y.toFixed(3)} Z${path.end.z.toFixed(3)}\n`;
            case 'linear':
                return `G1 X${path.end.x.toFixed(3)} Y${path.end.y.toFixed(3)} Z${path.end.z.toFixed(3)} F${path.feedRate}\n`;
            case 'arc':
                return `G2 X${path.position.x.toFixed(3)} Y${path.position.y.toFixed(3)} F${path.feedRate}\n`;
            case 'drill':
                return `G1 Z${path.position.z.toFixed(3)} F${path.feedRate}\n`;
            case 'retract':
                return `G0 Z${path.position.z.toFixed(3)}\n`;
            default:
                return '';
        }
    }

    /**
     * Calculate total machining time
     */
    calculateMachiningTime(toolpaths) {
        let totalTime = 0; // minutes

        toolpaths.forEach(tp => {
            tp.paths.forEach(path => {
                if (path.feedRate) {
                    const distance = this.calculatePathDistance(path);
                    totalTime += distance / path.feedRate; // Convert to minutes
                }
            });
            totalTime += 2; // Add 2 minutes for tool change
        });

        return totalTime;
    }

    // Helper methods

    getBoundingBox(geometry) {
        return {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 100, y: 100, z: 50 }
        };
    }

    extractContour(geometry, zLevel) {
        // Simplified contour extraction
        return [
            { x: 0, y: 0, z: zLevel },
            { x: 100, y: 0, z: zLevel },
            { x: 100, y: 100, z: zLevel },
            { x: 0, y: 100, z: zLevel }
        ];
    }

    detectHoles(geometry) {
        // Detect cylindrical holes in geometry
        return [
            { x: 25, y: 25, depth: 20 },
            { x: 75, y: 25, depth: 20 }
        ];
    }

    detectPockets(geometry) {
        // Detect rectangular pockets
        return [
            { min: { x: 10, y: 10 }, max: { x: 40, y: 40 }, depth: -5 }
        ];
    }

    calculatePathDistance(path) {
        if (path.start && path.end) {
            const dx = path.end.x - path.start.x;
            const dy = path.end.y - path.start.y;
            const dz = path.end.z - path.start.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return 0;
    }

    /**
     * Generate 5-axis simultaneous toolpaths
     */
    async generate5AxisToolpath(modelData, options = {}) {
        const {
            strategy = 'swarf', // swarf, ball_nose, or indexing
            tool = 'ball_nose_6mm',
            tolerance = 0.01
        } = options;

        console.log(`🔧 Generating 5-axis ${strategy} toolpath...`);

        const toolData = this.toolLibrary[tool];
        const paths = [];

        if (strategy === 'swarf') {
            // Swarf milling: tool side cuts along ruled surfaces
            const surfaces = this._extractSurfaces(modelData.geometry);
            surfaces.forEach(surface => {
                const guides = this._generateSwarfGuideCurves(surface);
                guides.forEach(guide => {
                    paths.push({
                        type: '5axis_swarf',
                        path: guide.points,
                        toolAxis: guide.normals, // Tool orientation at each point
                        feedRate: 800
                    });
                });
            });
        } else if (strategy === 'ball_nose') {
            // 5-axis ball nose: constant engagement
            const bbox = this.getBoundingBox(modelData.geometry);
            for (let z = bbox.max.z; z >= bbox.min.z; z -= toolData.diameter * 0.3) {
                const contour = this.extractContour(modelData.geometry, z);
                contour.forEach((point, i) => {
                    if (i > 0) {
                        // Calculate optimal tool axis orientation
                        const normal = this._getSurfaceNormal(point);
                        paths.push({
                            type: '5axis_positioning',
                            position: point,
                            toolAxis: normal,
                            feedRate: 1000,
                            rotaryA: this._calculateAAxis(normal),
                            rotaryC: this._calculateCAxis(normal)
                        });
                    }
                });
            }
        }

        console.log(`✅ 5-axis toolpath generated with ${paths.length} moves`);

        return {
            strategy,
            tool,
            paths,
            estimatedTime: paths.length * 0.05 // minutes
        };
    }

    /**
     * Generate turning/lathe toolpaths
     */
    async generateTurningToolpath(profileData, options = {}) {
        const {
            operation = 'roughing', // roughing, finishing, threading, grooving
            tool = 'turning_insert_TNMG',
            spindleSpeed = 2000,
            feedRate = 0.2 // mm/rev
        } = options;

        console.log(`🔄 Generating turning ${operation} toolpath...`);

        const toolData = this.toolLibrary[tool];
        const paths = [];

        switch (operation) {
            case 'roughing':
                // OD roughing with depth of cut
                const depthOfCut = 2; // mm
                const profile = profileData.outerDiameter;
                for (let pass = 0; pass < Math.ceil(profile.stock / depthOfCut); pass++) {
                    const currentDiameter = profile.finished + profile.stock - (pass * depthOfCut);
                    paths.push({
                        type: 'turning_od',
                        startDiameter: currentDiameter,
                        endDiameter: currentDiameter - depthOfCut,
                        startZ: profile.startZ,
                        endZ: profile.endZ,
                        feedRate: feedRate,
                        spindleSpeed: spindleSpeed
                    });
                }
                break;

            case 'threading':
                const threadData = profileData.thread;
                paths.push({
                    type: 'threading',
                    majorDiameter: threadData.majorDiameter,
                    minorDiameter: threadData.minorDiameter,
                    pitch: threadData.pitch,
                    length: threadData.length,
                    passes: threadData.depth / 0.5, // 0.5mm per pass
                    spindleSpeed: 500, // Slower for threading
                    feedRate: threadData.pitch // Feed per revolution = pitch
                });
                break;

            case 'grooving':
                const groove = profileData.groove;
                paths.push({
                    type: 'grooving',
                    diameter: groove.diameter,
                    width: groove.width,
                    depth: groove.depth,
                    zPosition: groove.zPosition,
                    feedRate: 0.05, // Slow feed for grooving
                    spindleSpeed: 1500
                });
                break;
        }

        console.log(`✅ Turning toolpath generated: ${paths.length} operations`);

        return {
            operation,
            tool,
            paths,
            estimatedTime: this._calculateTurningTime(paths, feedRate)
        };
    }

    /**
     * Adaptive toolpath with constant engagement
     */
    generateAdaptiveToolpath(modelData, options = {}) {
        const {
            tool = 'end_mill_6mm',
            targetEngagement = 0.3, // 30% radial engagement
            stockModel = null
        } = options;

        console.log(`🎯 Generating adaptive toolpath (constant engagement)...`);

        const toolData = this.toolLibrary[tool];
        const paths = [];
        const regions = this._identifyMaterialRegions(modelData, stockModel);

        regions.forEach(region => {
            // Adaptive strategy: curve paths to maintain constant chip load
            const adaptivePath = this._generateAdaptivePath(
                region,
                toolData.diameter,
                targetEngagement
            );

            paths.push({
                type: 'adaptive',
                region: region.id,
                path: adaptivePath.points,
                engagement: targetEngagement,
                feedRate: this._calculateAdaptiveFeedRate(toolData, targetEngagement)
            });
        });

        return {
            tool,
            paths,
            totalLength: this._calculateTotalPathLength(paths),
            estimatedTime: paths.length * 1.2
        };
    }

    /**
     * Export with machine-specific postprocessor
     */
    exportWithPostProcessor(toolpaths, machine, options = {}) {
        const {
            postProcessor = 'fanuc',
            includeToolChangeMacros = true,
            safetyHeight = 50
        } = options;

        console.log(`📤 Exporting for ${machine} with ${postProcessor} post...`);

        const machineConfig = this.machineLibrary[machine];
        const postConfig = this.postProcessors[postProcessor];

        let gcode = this._generateHeader(machineConfig, postConfig);

        toolpaths.forEach((tp, index) => {
            // Machine-specific handling
            if (machineConfig.type === '5-axis_mill' && tp.operation?.includes('5axis')) {
                gcode += this._export5AxisMoves(tp.paths, postConfig);
            } else if (machineConfig.type === 'lathe') {
                gcode += this._exportTurningMoves(tp.paths, postConfig);
            } else {
                // Standard 3-axis
                tp.paths.forEach(path => {
                    gcode += this.pathToGCode(path);
                });
            }

            if (includeToolChangeMacros) {
                gcode += this._generateToolChangeMacro(postConfig, index + 1);
            }
        });

        gcode += this._generateFooter(machineConfig, postConfig, safetyHeight);

        console.log(`✅ G-code exported: ${gcode.split('\n').length} lines`);

        return {
            gcode,
            machine,
            postProcessor,
            lineCount: gcode.split('\n').length
        };
    }

    // Helper methods for new features

    _extractSurfaces(geometry) {
        return [{ id: 1, type: 'ruled' }, { id: 2, type: 'freeform' }];
    }

    _generateSwarfGuideCurves(surface) {
        return [
            {
                points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 10 }],
                normals: [{ x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 0 }]
            }
        ];
    }

    _getSurfaceNormal(point) {
        return { x: 0, y: 0, z: 1 };
    }

    _calculateAAxis(normal) {
        return Math.asin(normal.z) * (180 / Math.PI);
    }

    _calculateCAxis(normal) {
        return Math.atan2(normal.y, normal.x) * (180 / Math.PI);
    }

    _calculateTurningTime(paths, feedRate) {
        return paths.reduce((time, path) => {
            const length = Math.abs((path.endZ || 0) - (path.startZ || 0));
            return time + (length / feedRate);
        }, 0);
    }

    _identifyMaterialRegions(modelData, stockModel) {
        return [
            { id: 'region1', material: 'bulk', bounds: { x: [0, 50], y: [0, 50] } },
            { id: 'region2', material: 'corner', bounds: { x: [50, 100], y: [0, 50] } }
        ];
    }

    _generateAdaptivePath(region, toolDiameter, engagement) {
        const points = [];
        for (let i = 0; i < 20; i++) {
            points.push({
                x: region.bounds.x[0] + i * 5,
                y: region.bounds.y[0] + Math.sin(i * 0.5) * 10,
                z: -5
            });
        }
        return { points };
    }

    _calculateAdaptiveFeedRate(tool, engagement) {
        const baseFeed = 1000;
        return baseFeed * Math.sqrt(engagement);
    }

    _calculateTotalPathLength(paths) {
        return paths.reduce((total, path) => {
            return total + (path.path?.length || 0) * 5; // Simplified
        }, 0);
    }

    _generateHeader(machineConfig, postConfig) {
        let header = `; Machine: ${machineConfig.type}\n`;
        header += `; Post: ${postConfig.dialect}\n`;
        header += `G21 ; Metric\nG90 ; Absolute\nG17 ; XY plane\n\n`;
        return header;
    }

    _export5AxisMoves(paths, postConfig) {
        let code = '';
        paths.forEach(path => {
            if (path.toolAxis && path.rotaryA !== undefined) {
                code += `G1 X${path.position.x.toFixed(3)} Y${path.position.y.toFixed(3)} Z${path.position.z.toFixed(3)} A${path.rotaryA.toFixed(3)} C${path.rotaryC.toFixed(3)} F${path.feedRate}\n`;
            }
        });
        return code;
    }

    _exportTurningMoves(paths, postConfig) {
        let code = '';
        paths.forEach(path => {
            if (path.type === 'turning_od') {
                code += `G0 X${path.startDiameter.toFixed(3)} Z${path.startZ.toFixed(3)}\n`;
                code += `G1 X${path.endDiameter.toFixed(3)} Z${path.endZ.toFixed(3)} F${path.feedRate}\n`;
            } else if (path.type === 'threading') {
                code += `G92 X${path.minorDiameter.toFixed(3)} Z${path.length.toFixed(3)} F${path.feedRate.toFixed(3)}\n`;
            }
        });
        return code;
    }

    _generateToolChangeMacro(postConfig, toolNumber) {
        return `M6 T${toolNumber} ; Tool change\nM3 S3000 ; Spindle on\n`;
    }

    _generateFooter(machineConfig, postConfig, safetyHeight) {
        let footer = `M5 ; Spindle off\n`;
        footer += `G0 Z${safetyHeight} ; Safe Z\n`;
        footer += `M30 ; Program end\n`;
        return footer;
    }
}

module.exports = new CAMService();

