/**
 * CAM (Computer-Aided Manufacturing) Service
 * Generates toolpaths for CNC machining
 */

class CAMService {
    constructor() {
        this.toolLibrary = {
            'end_mill_6mm': { diameter: 6, type: 'end_mill', flutes: 4, maxDepth: 20 },
            'end_mill_3mm': { diameter: 3, type: 'end_mill', flutes: 2, maxDepth: 10 },
            'ball_nose_6mm': { diameter: 6, type: 'ball_nose', flutes: 4, maxDepth: 15 },
            'drill_5mm': { diameter: 5, type: 'drill', flutes: 2, maxDepth: 50 }
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
}

module.exports = new CAMService();
