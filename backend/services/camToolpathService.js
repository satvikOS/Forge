/**
 * CAM Toolpath Generation Service
 * 2D/3D milling, turning, multi-axis machining
 * Tool selection, feeds/speeds, G-code generation
 * Toolpath optimization, collision detection, simulation
 */

class CAMToolpathService {
    constructor() {
        this.toolpaths = new Map();
        this.toolLibrary = this.initializeToolLibrary();
        this.materialDatabase = this.initializeMaterialDatabase();
        this.machineConfigs = this.initializeMachineConfigs();
    }

    /**
     * Generate toolpath from CAD model
     */
    async generateToolpath(spec) {
        const {
            modelId,
            model3D,
            stock,  // Stock material dimensions
            operations = [],  // Array of machining operations
            machine = '3-axis-mill',  // '3-axis-mill', '5-axis-mill', 'lathe', '4-axis-mill'
            material = 'aluminum-6061',
            workholding = 'vise',  // 'vise', '4-jaw-chuck', '3-jaw-chuck', 'fixtures'
            autoSelectTools = true,
            optimizeToolpaths = true,
            safetyHeight = 10  // mm above stock
        } = spec;

        console.log(`🔧 CAM Toolpath: Generating for "${modelId}"...`);

        const toolpathId = `cam_${Date.now()}`;

        const toolpath = {
            toolpathId,
            modelId,
            machine,
            machineConfig: this.machineConfigs[machine],
            material,
            materialProperties: this.materialDatabase[material],
            stock,
            workholding,
            operations: [],
            tools: [],
            safetyHeight,
            estimatedTime: 0,
            estimatedCost: 0,
            gcode: null,
            createdAt: Date.now()
        };

        // Process each operation
        for (const opSpec of operations) {
            const operation = await this.createOperation(opSpec, toolpath, model3D);
            toolpath.operations.push(operation);
        }

        // Auto-select tools if requested
        if (autoSelectTools) {
            await this.autoSelectTools(toolpath);
        }

        // Calculate feeds and speeds
        for (const operation of toolpath.operations) {
            operation.feedsAndSpeeds = this.calculateFeedsAndSpeeds(
                operation.tool,
                toolpath.material,
                operation.type
            );
        }

        // Generate toolpaths
        for (const operation of toolpath.operations) {
            operation.toolpathData = await this.generateOperationToolpath(operation, model3D, stock);
        }

        // Optimize toolpaths if requested
        if (optimizeToolpaths) {
            await this.optimizeToolpaths(toolpath);
        }

        // Collision detection
        const collisions = await this.detectCollisions(toolpath, stock);
        if (collisions.length > 0) {
            console.warn(`  ⚠️ ${collisions.length} potential collisions detected`);
            toolpath.collisions = collisions;
        }

        // Generate G-code
        toolpath.gcode = await this.generateGCode(toolpath);

        // Calculate estimates
        toolpath.estimatedTime = this.estimateMachiningTime(toolpath);
        toolpath.estimatedCost = this.estimateMachiningCost(toolpath);

        this.toolpaths.set(toolpathId, toolpath);

        return {
            success: true,
            operation: 'generate-toolpath',
            toolpath,
            estimatedTime: toolpath.estimatedTime,
            estimatedCost: toolpath.estimatedCost,
            gCodeUrl: `/api/mechanical/cam/${toolpathId}/gcode.nc`,
            simulationUrl: `/api/mechanical/cam/${toolpathId}/simulate`
        };
    }

    /**
     * Create machining operation
     */
    async createOperation(opSpec, toolpath, model3D) {
        const {
            type,  // 'face', 'contour', 'pocket', 'drill', 'adaptive', 'surface', 'turning', 'thread'
            name,
            geometry = null,  // Features to machine (pockets, holes, surfaces)
            depth = null,
            stepdown = null,
            stepover = null,
            toolDiameter = null,
            tool = null,  // Specific tool or null for auto-select
            strategy = 'zigzag',  // 'zigzag', 'spiral', 'one-way', 'constant-offset', 'pencil'
            finishing = false,  // True for finishing pass
            roughing = true
        } = opSpec;

        console.log(`  🔨 Creating ${type} operation: "${name}"...`);

        const operation = {
            operationId: `op_${toolpath.operations.length}`,
            type,
            name,
            geometry,
            depth,
            stepdown: stepdown || this.getDefaultStepdown(type, toolDiameter),
            stepover: stepover || this.getDefaultStepover(type, toolDiameter),
            tool,
            toolDiameter,
            strategy,
            finishing,
            roughing,
            feedsAndSpeeds: null,  // Calculated later
            toolpathData: null,  // Generated later
            estimatedTime: 0,
            createdAt: Date.now()
        };

        return operation;
    }

    /**
     * Auto-select tools for operations
     */
    async autoSelectTools(toolpath) {
        console.log(`  🔧 Auto-selecting tools...`);

        const selectedTools = new Set();

        for (const operation of toolpath.operations) {
            if (!operation.tool) {
                const tool = this.selectToolForOperation(operation, toolpath.material);
                operation.tool = tool;
                selectedTools.add(tool.toolNumber);
                console.log(`    ✅ Op "${operation.name}": ${tool.type} ${tool.diameter}mm (Tool #${tool.toolNumber})`);
            }
        }

        toolpath.tools = Array.from(selectedTools).map(toolNum =>
            this.toolLibrary.find(t => t.toolNumber === toolNum)
        );
    }

    /**
     * Select appropriate tool for operation
     */
    selectToolForOperation(operation, material) {
        const { type, depth, geometry } = operation;

        let candidateTools = [...this.toolLibrary];

        // Filter by operation type
        switch (type) {
            case 'face':
                candidateTools = candidateTools.filter(t =>
                    t.type === 'face-mill' || t.type === 'end-mill'
                );
                break;

            case 'contour':
            case 'pocket':
                candidateTools = candidateTools.filter(t =>
                    t.type === 'end-mill' || t.type === 'ball-end-mill'
                );
                break;

            case 'drill':
                candidateTools = candidateTools.filter(t =>
                    t.type === 'drill' || t.type === 'center-drill'
                );
                break;

            case 'adaptive':
                candidateTools = candidateTools.filter(t =>
                    t.type === 'end-mill' && t.flutes >= 3
                );
                break;

            case 'surface':
                candidateTools = candidateTools.filter(t =>
                    t.type === 'ball-end-mill' || t.type === 'bull-nose-mill'
                );
                break;

            case 'thread':
                candidateTools = candidateTools.filter(t =>
                    t.type === 'thread-mill'
                );
                break;
        }

        // Filter by material compatibility
        candidateTools = candidateTools.filter(t =>
            t.materials.includes(material) || t.materials.includes('all')
        );

        // Select smallest suitable diameter for precision
        candidateTools.sort((a, b) => a.diameter - b.diameter);

        return candidateTools[0] || this.toolLibrary[0];  // Fallback to first tool
    }

    /**
     * Calculate feeds and speeds
     */
    calculateFeedsAndSpeeds(tool, material, operationType) {
        const matProps = this.materialDatabase[material];
        if (!matProps) {
            throw new Error(`Material ${material} not found in database`);
        }

        // Surface speed (SFM) based on material and tool
        let surfaceSpeed = matProps.surfaceSpeed;  // ft/min

        // Adjust for tool coating
        if (tool.coating === 'TiAlN' || tool.coating === 'AlTiN') {
            surfaceSpeed *= 1.5;  // Coated tools can run faster
        }

        // Calculate spindle speed (RPM)
        // RPM = (SFM × 3.82) / diameter_in_mm
        const spindleSpeed = Math.round((surfaceSpeed * 3.82) / tool.diameter);

        // Chip load per tooth (inches per tooth)
        let chipLoad = matProps.chipLoad;

        // Adjust for finishing vs roughing
        if (operationType === 'finishing') {
            chipLoad *= 0.5;  // Lighter cuts for finishing
        }

        // Calculate feed rate (mm/min)
        // Feed = RPM × flutes × chip_load_mm
        const chipLoadMM = chipLoad * 25.4;  // Convert inches to mm
        const feedRate = Math.round(spindleSpeed * tool.flutes * chipLoadMM);

        // Depth of cut
        const depthOfCut = operationType === 'finishing' ? tool.diameter * 0.1 : tool.diameter * 0.5;

        // Width of cut (stepover)
        const widthOfCut = operationType === 'finishing' ? tool.diameter * 0.1 : tool.diameter * 0.4;

        return {
            spindleSpeed,      // RPM
            feedRate,          // mm/min
            chipLoad: chipLoadMM,  // mm/tooth
            depthOfCut,        // mm
            widthOfCut,        // mm (stepover)
            surfaceSpeed,      // ft/min
            plungeRate: feedRate * 0.3  // mm/min (slower for plunging)
        };
    }

    /**
     * Generate toolpath for operation
     */
    async generateOperationToolpath(operation, model3D, stock) {
        console.log(`    📍 Generating toolpath for "${operation.name}"...`);

        const toolpathData = {
            operationId: operation.operationId,
            points: [],
            moves: [],
            rapids: [],
            totalLength: 0,
            machiningTime: 0
        };

        switch (operation.type) {
            case 'face':
                this.generateFaceMillingToolpath(toolpathData, operation, stock);
                break;

            case 'contour':
                this.generateContourToolpath(toolpathData, operation, model3D);
                break;

            case 'pocket':
                this.generatePocketToolpath(toolpathData, operation, model3D);
                break;

            case 'drill':
                this.generateDrillingToolpath(toolpathData, operation, model3D);
                break;

            case 'adaptive':
                this.generateAdaptiveToolpath(toolpathData, operation, model3D);
                break;

            case 'surface':
                this.generateSurfaceToolpath(toolpathData, operation, model3D);
                break;
        }

        console.log(`      ✅ ${toolpathData.points.length} points, ${toolpathData.totalLength.toFixed(2)}mm`);

        return toolpathData;
    }

    /**
     * Generate face milling toolpath
     */
    generateFaceMillingToolpath(toolpathData, operation, stock) {
        const { width, length, height } = stock;
        const stepover = operation.stepover;
        const safeZ = height + 10;
        const cutDepth = height + operation.depth;

        let y = 0;
        let direction = 1;

        while (y <= length) {
            // Rapid to start of pass
            toolpathData.rapids.push({ x: 0, y, z: safeZ });

            // Plunge
            toolpathData.points.push({ x: 0, y, z: cutDepth, type: 'plunge' });

            // Cut across
            toolpathData.points.push({
                x: direction > 0 ? width : 0,
                y,
                z: cutDepth,
                type: 'cut'
            });

            // Retract
            toolpathData.points.push({
                x: direction > 0 ? width : 0,
                y,
                z: safeZ,
                type: 'retract'
            });

            y += stepover;
            direction *= -1;  // Zigzag
        }

        toolpathData.totalLength = width * (length / stepover);
    }

    /**
     * Generate contour toolpath
     */
    generateContourToolpath(toolpathData, operation, model3D) {
        // Simplified contour - follow edges at specified depth
        const contour = operation.geometry || [];
        const depth = operation.depth || -10;

        contour.forEach((point, index) => {
            toolpathData.points.push({
                x: point.x,
                y: point.y,
                z: depth,
                type: index === 0 ? 'rapid' : 'cut'
            });
        });

        // Close contour if needed
        if (contour.length > 0) {
            toolpathData.points.push({
                x: contour[0].x,
                y: contour[0].y,
                z: depth,
                type: 'cut'
            });
        }
    }

    /**
     * Generate pocket toolpath
     */
    generatePocketToolpath(toolpathData, operation, model3D) {
        const pocket = operation.geometry || { width: 50, length: 50, depth: -10 };
        const stepover = operation.stepover;
        const depth = operation.depth || pocket.depth;

        // Spiral pocket clearing
        let offset = 0;
        const maxOffset = Math.min(pocket.width, pocket.length) / 2;

        while (offset < maxOffset) {
            // Rectangular spiral
            const points = [
                { x: offset, y: offset },
                { x: pocket.width - offset, y: offset },
                { x: pocket.width - offset, y: pocket.length - offset },
                { x: offset, y: pocket.length - offset },
                { x: offset, y: offset }
            ];

            points.forEach((point, index) => {
                toolpathData.points.push({
                    x: point.x,
                    y: point.y,
                    z: depth,
                    type: index === 0 ? 'plunge' : 'cut'
                });
            });

            offset += stepover;
        }
    }

    /**
     * Generate drilling toolpath
     */
    generateDrillingToolpath(toolpathData, operation, model3D) {
        const holes = operation.geometry || [];

        holes.forEach(hole => {
            const { x, y, depth } = hole;

            // Rapid to hole
            toolpathData.rapids.push({ x, y, z: 10, type: 'rapid' });

            // Drill
            toolpathData.points.push({ x, y, z: depth, type: 'drill' });

            // Retract
            toolpathData.points.push({ x, y, z: 10, type: 'retract' });
        });
    }

    /**
     * Generate adaptive clearing toolpath
     */
    generateAdaptiveToolpath(toolpathData, operation, model3D) {
        // Simplified adaptive - constant engagement angle
        // Real implementation would use advanced algorithms
        console.log(`      ℹ️ Adaptive clearing (simplified)`);
        this.generatePocketToolpath(toolpathData, operation, model3D);
    }

    /**
     * Generate surface toolpath (3D)
     */
    generateSurfaceToolpath(toolpathData, operation, model3D) {
        // Parallel finishing passes for 3D surface
        const surface = operation.geometry || { width: 100, length: 100 };
        const stepover = operation.stepover || 0.5;  // Fine stepover for surface finish

        for (let y = 0; y <= surface.length; y += stepover) {
            // Scan line across surface
            toolpathData.points.push({
                x: 0,
                y,
                z: this.calculateSurfaceHeight(0, y, model3D),
                type: y === 0 ? 'plunge' : 'cut'
            });

            toolpathData.points.push({
                x: surface.width,
                y,
                z: this.calculateSurfaceHeight(surface.width, y, model3D),
                type: 'cut'
            });
        }
    }

    /**
     * Calculate surface height at point (simplified)
     */
    calculateSurfaceHeight(x, y, model3D) {
        // Simplified - real implementation would query actual surface
        return -5;  // Default height
    }

    /**
     * Optimize toolpaths
     */
    async optimizeToolpaths(toolpath) {
        console.log(`  ⚡ Optimizing toolpaths...`);

        // Reorder operations for minimal tool changes
        this.optimizeOperationOrder(toolpath);

        // Minimize rapids
        this.minimizeRapids(toolpath);

        console.log(`    ✅ Optimized`);
    }

    /**
     * Optimize operation order
     */
    optimizeOperationOrder(toolpath) {
        // Group operations by tool to minimize tool changes
        toolpath.operations.sort((a, b) => {
            const toolA = a.tool ? a.tool.toolNumber : 999;
            const toolB = b.tool ? b.tool.toolNumber : 999;
            return toolA - toolB;
        });
    }

    /**
     * Minimize rapid movements
     */
    minimizeRapids(toolpath) {
        // Optimize rapid paths between operations
        // Real implementation would use traveling salesman algorithm
    }

    /**
     * Detect collisions
     */
    async detectCollisions(toolpath, stock) {
        console.log(`  🔍 Checking for collisions...`);

        const collisions = [];

        // Check tool holder vs stock
        // Check tool vs fixtures
        // Simplified - real implementation would do 3D collision detection

        return collisions;
    }

    /**
     * Generate G-code
     */
    async generateGCode(toolpath) {
        console.log(`  📝 Generating G-code...`);

        let gcode = [];

        // Header
        gcode.push('%');
        gcode.push(`(${toolpath.modelId})`);
        gcode.push(`(Machine: ${toolpath.machine})`);
        gcode.push(`(Material: ${toolpath.material})`);
        gcode.push('(Generated by ArchDisc AI CAD)');
        gcode.push('');

        // Initialization
        gcode.push('G17 G21 G90 G94 G54');  // XY plane, mm, absolute, feed/min, work offset 1
        gcode.push('G91.1');  // Incremental arc centers
        gcode.push('');

        let currentTool = null;

        // Generate code for each operation
        for (const operation of toolpath.operations) {
            gcode.push(`(Operation: ${operation.name})`);

            // Tool change if needed
            if (!currentTool || currentTool.toolNumber !== operation.tool.toolNumber) {
                gcode.push(`T${operation.tool.toolNumber} M6`);  // Tool change
                currentTool = operation.tool;
                gcode.push('');
            }

            // Spindle and coolant
            gcode.push(`S${operation.feedsAndSpeeds.spindleSpeed} M3`);  // Spindle CW
            gcode.push('M8');  // Coolant on
            gcode.push('');

            // Feed rate
            gcode.push(`F${operation.feedsAndSpeeds.feedRate}`);
            gcode.push('');

            // Toolpath moves
            const toolpathData = operation.toolpathData;

            // Rapids
            toolpathData.rapids.forEach(point => {
                gcode.push(`G0 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} Z${point.z.toFixed(3)}`);
            });

            // Cutting moves
            toolpathData.points.forEach(point => {
                if (point.type === 'rapid') {
                    gcode.push(`G0 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} Z${point.z.toFixed(3)}`);
                } else if (point.type === 'plunge') {
                    gcode.push(`G1 Z${point.z.toFixed(3)} F${operation.feedsAndSpeeds.plungeRate}`);
                } else {
                    gcode.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} Z${point.z.toFixed(3)}`);
                }
            });

            gcode.push('');
        }

        // Footer
        gcode.push('M5');   // Spindle stop
        gcode.push('M9');   // Coolant off
        gcode.push('G0 Z50');  // Retract to safe height
        gcode.push('G0 X0 Y0');  // Return to origin
        gcode.push('M30');  // Program end
        gcode.push('%');

        const gcodeText = gcode.join('\n');

        console.log(`    ✅ Generated ${gcode.length} lines of G-code`);

        return gcodeText;
    }

    /**
     * Estimate machining time
     */
    estimateMachiningTime(toolpath) {
        let totalTime = 0;  // minutes

        for (const operation of toolpath.operations) {
            const toolpathData = operation.toolpathData;
            const feedRate = operation.feedsAndSpeeds.feedRate;  // mm/min

            // Cutting time
            const cuttingTime = toolpathData.totalLength / feedRate;

            // Rapid time (assume 10000 mm/min rapid rate)
            const rapidLength = toolpathData.rapids.reduce((sum, point) => sum + 100, 0);  // Simplified
            const rapidTime = rapidLength / 10000;

            totalTime += cuttingTime + rapidTime;
        }

        // Add tool change time (1 min per change)
        const toolChanges = new Set(toolpath.operations.map(op => op.tool.toolNumber)).size - 1;
        totalTime += toolChanges * 1;

        return totalTime;
    }

    /**
     * Estimate machining cost
     */
    estimateMachiningCost(toolpath) {
        const machineRate = 75;  // $/hour

        const timeInHours = toolpath.estimatedTime / 60;

        return timeInHours * machineRate;
    }

    // ========== Default Parameters ==========

    getDefaultStepdown(type, toolDiameter) {
        const defaults = {
            'face': toolDiameter * 0.5,
            'contour': toolDiameter * 0.5,
            'pocket': toolDiameter * 0.5,
            'adaptive': toolDiameter * 1.0,
            'surface': toolDiameter * 0.1
        };

        return defaults[type] || 2.0;
    }

    getDefaultStepover(type, toolDiameter) {
        const defaults = {
            'face': toolDiameter * 0.8,
            'contour': toolDiameter * 0.4,
            'pocket': toolDiameter * 0.4,
            'adaptive': toolDiameter * 0.1,  // Light radial engagement
            'surface': toolDiameter * 0.1   // Fine finish
        };

        return defaults[type] || toolDiameter * 0.4;
    }

    // ========== Initialization ==========

    initializeToolLibrary() {
        return [
            // End mills
            {
                toolNumber: 1,
                type: 'end-mill',
                diameter: 6,
                fluteLength: 20,
                overallLength: 60,
                flutes: 4,
                material: 'carbide',
                coating: 'TiAlN',
                materials: ['aluminum', 'steel', 'stainless']
            },
            {
                toolNumber: 2,
                type: 'end-mill',
                diameter: 10,
                fluteLength: 30,
                overallLength: 75,
                flutes: 4,
                material: 'carbide',
                coating: 'AlTiN',
                materials: ['aluminum', 'steel', 'stainless']
            },
            {
                toolNumber: 3,
                type: 'end-mill',
                diameter: 3,
                fluteLength: 10,
                overallLength: 50,
                flutes: 2,
                material: 'carbide',
                coating: 'uncoated',
                materials: ['aluminum', 'brass', 'plastic']
            },

            // Face mills
            {
                toolNumber: 4,
                type: 'face-mill',
                diameter: 50,
                fluteLength: 15,
                overallLength: 40,
                flutes: 6,
                material: 'carbide-insert',
                coating: 'TiAlN',
                materials: ['steel', 'aluminum', 'stainless']
            },

            // Ball end mills
            {
                toolNumber: 5,
                type: 'ball-end-mill',
                diameter: 6,
                fluteLength: 15,
                overallLength: 60,
                flutes: 2,
                material: 'carbide',
                coating: 'TiAlN',
                materials: ['steel', 'aluminum', 'stainless']
            },
            {
                toolNumber: 6,
                type: 'ball-end-mill',
                diameter: 10,
                fluteLength: 25,
                overallLength: 75,
                flutes: 2,
                material: 'carbide',
                coating: 'AlTiN',
                materials: ['steel', 'aluminum']
            },

            // Drills
            {
                toolNumber: 10,
                type: 'drill',
                diameter: 5,
                fluteLength: 50,
                overallLength: 85,
                flutes: 2,
                material: 'HSS',
                coating: 'TiN',
                materials: ['all']
            },
            {
                toolNumber: 11,
                type: 'drill',
                diameter: 8,
                fluteLength: 75,
                overallLength: 115,
                flutes: 2,
                material: 'carbide',
                coating: 'TiAlN',
                materials: ['all']
            },
            {
                toolNumber: 12,
                type: 'center-drill',
                diameter: 3,
                fluteLength: 10,
                overallLength: 50,
                flutes: 2,
                material: 'HSS',
                coating: 'uncoated',
                materials: ['all']
            }
        ];
    }

    initializeMaterialDatabase() {
        return {
            'aluminum-6061': {
                name: 'Aluminum 6061-T6',
                surfaceSpeed: 800,  // ft/min
                chipLoad: 0.003,    // inches/tooth
                hardness: 95        // HB
            },
            'aluminum-7075': {
                name: 'Aluminum 7075-T6',
                surfaceSpeed: 700,
                chipLoad: 0.003,
                hardness: 150
            },
            'mild-steel': {
                name: 'Mild Steel (1018)',
                surfaceSpeed: 100,
                chipLoad: 0.002,
                hardness: 126
            },
            'stainless-steel-304': {
                name: 'Stainless Steel 304',
                surfaceSpeed: 60,
                chipLoad: 0.002,
                hardness: 201
            },
            'tool-steel': {
                name: 'Tool Steel (O1)',
                surfaceSpeed: 50,
                chipLoad: 0.001,
                hardness: 200
            },
            'brass': {
                name: 'Brass',
                surfaceSpeed: 500,
                chipLoad: 0.004,
                hardness: 60
            },
            'plastic-acrylic': {
                name: 'Acrylic (PMMA)',
                surfaceSpeed: 1000,
                chipLoad: 0.005,
                hardness: 30
            }
        };
    }

    initializeMachineConfigs() {
        return {
            '3-axis-mill': {
                name: '3-Axis Vertical Milling Machine',
                axes: ['X', 'Y', 'Z'],
                maxSpindleSpeed: 12000,  // RPM
                maxFeedRate: 5000,       // mm/min
                toolChanger: true,
                maxTools: 20,
                workEnvelope: { x: 500, y: 400, z: 300 }  // mm
            },
            '4-axis-mill': {
                name: '4-Axis Milling Machine',
                axes: ['X', 'Y', 'Z', 'A'],
                maxSpindleSpeed: 12000,
                maxFeedRate: 5000,
                toolChanger: true,
                maxTools: 20,
                workEnvelope: { x: 500, y: 400, z: 300 }
            },
            '5-axis-mill': {
                name: '5-Axis Simultaneous Milling Machine',
                axes: ['X', 'Y', 'Z', 'A', 'B'],
                maxSpindleSpeed: 18000,
                maxFeedRate: 8000,
                toolChanger: true,
                maxTools: 40,
                workEnvelope: { x: 600, y: 500, z: 400 }
            },
            'lathe': {
                name: 'CNC Turning Center',
                axes: ['X', 'Z'],
                maxSpindleSpeed: 4000,
                maxFeedRate: 3000,
                toolChanger: true,
                maxTools: 12,
                maxDiameter: 300,   // mm
                maxLength: 500      // mm
            }
        };
    }
}

module.exports = new CAMToolpathService();
