/**
 * 3D Printing Slicer Service
 * Generates G-code for 3D printers (FDM/FFF)
 */

class PrintingSlicerService {
    constructor() {
        this.printerProfiles = {
            'prusa_i3': { bedSize: [250, 210, 210], nozzle: 0.4, maxTemp: 260 },
            'ender3': { bedSize: [220, 220, 250], nozzle: 0.4, maxTemp: 255 },
            'cr10': { bedSize: [300, 300, 400], nozzle: 0.4, maxTemp: 260 }
        };

        this.materials = {
            'PLA': { temp: 200, bed: 60, speed: 50, retraction: 5 },
            'PETG': { temp: 235, bed: 80, speed: 40, retraction: 6 },
            'ABS': { temp: 240, bed: 100, speed: 45, retraction: 5 },
            'TPU': { temp: 220, bed: 50, speed: 25, retraction: 2 }
        };
    }

    /**
     * Slice 3D model for printing
     */
    async slice(modelData, options = {}) {
        const {
            printer = 'prusa_i3',
            material = 'PLA',
            layerHeight = 0.2, // mm
            infillDensity = 20, // %
            supportMaterial = false,
            raftEnabled = false
        } = options;

        console.log('🖨️ Slicing model for 3D printing...');
        console.log(`   Printer: ${printer}`);
        console.log(`   Material: ${material}`);
        console.log(`   Layer height: ${layerHeight}mm`);

        const printerConfig = this.printerProfiles[printer];
        const materialConfig = this.materials[material];

        // Step 1: Orient and position model on bed
        const positioned = this.positionOnBed(modelData, printerConfig);

        // Step 2: Generate support structures if needed
        let supports = null;
        if (supportMaterial) {
            supports = this.generateSupports(positioned);
        }

        // Step 3: Slice into layers
        const layers = this.sliceIntoLayers(positioned, layerHeight);

        // Step 4: Generate infill pattern
        layers.forEach(layer => {
            layer.infill = this.generateInfill(layer, infillDensity);
        });

        // Step 5: Calculate print time and material
        const stats = this.calculatePrintStats(layers, materialConfig);

        console.log(`✅ Slicing complete`);
        console.log(`   Layers: ${layers.length}`);
        console.log(`   Print time: ${stats.time} hours`);
        console.log(`   Material: ${stats.material}g`);

        return {
            layers,
            supports,
            stats,
            config: {
                printer,
                material,
                layerHeight,
                infillDensity
            }
        };
    }

    /**
     * Position model on print bed
     */
    positionOnBed(modelData, printerConfig) {
        const bbox = this.getBoundingBox(modelData.geometry);
        const bedCenter = [
            printerConfig.bedSize[0] / 2,
            printerConfig.bedSize[1] / 2,
            0
        ];

        // Center model on bed
        const offset = {
            x: bedCenter[0] - (bbox.max.x + bbox.min.x) / 2,
            y: bedCenter[1] - (bbox.max.y + bbox.min.y) / 2,
            z: -bbox.min.z // Place on bed
        };

        return {
            ...modelData,
            offset
        };
    }

    /**
     * Generate support structures
     */
    generateSupports(modelData) {
        console.log('   Generating supports...');

        // Detect overhangs > 45°
        const overhangs = this.detectOverhangs(modelData.geometry, 45);

        const supports = overhangs.map(overhang => ({
            position: overhang.position,
            height: overhang.height,
            pattern: 'grid'
        }));

        return supports;
    }

    /**
     * Slice model into horizontal layers
     */
    sliceIntoLayers(modelData, layerHeight) {
        const bbox = this.getBoundingBox(modelData.geometry);
        const numLayers = Math.ceil((bbox.max.z - bbox.min.z) / layerHeight);
        const layers = [];

        for (let i = 0; i < numLayers; i++) {
            const z = bbox.min.z + i * layerHeight + modelData.offset.z;

            layers.push({
                number: i,
                z,
                perimeters: this.generatePerimeters(modelData.geometry, z),
                infill: null // Will be filled later
            });
        }

        return layers;
    }

    /**
     * Generate perimeter paths for a layer
     */
    generatePerimeters(geometry, zLevel) {
        // Simplified perimeter generation
        const contours = this.extractContour(geometry, zLevel);

        return contours.map(contour => ({
            type: 'perimeter',
            points: contour,
            width: 0.4 // Nozzle width
        }));
    }

    /**
     * Generate infill pattern
     */
    generateInfill(layer, density) {
        if (density === 0) return [];

        const infillLines = [];
        const spacing = 0.4 * (100 / density); // Adjust spacing based on density

        // Rectilinear infill pattern
        layer.perimeters.forEach(perimeter => {
            const bbox = this.getPerimeterBBox(perimeter);

            for (let x = bbox.min.x; x < bbox.max.x; x += spacing) {
                infillLines.push({
                    start: { x, y: bbox.min.y, z: layer.z },
                    end: { x, y: bbox.max.y, z: layer.z }
                });
            }
        });

        return infillLines;
    }

    /**
     * Export sliced model as G-code
     */
    exportGCode(slicedData) {
        const { layers, config } = slicedData;
        const materialConfig = this.materials[config.material];
        let gcode = '';

        // Header
        gcode += '; Generated by ArchDisc 3D Printing Slicer\n';
        gcode += `; Material: ${config.material}\n`;
        gcode += `; Layer height: ${config.layerHeight}mm\n`;
        gcode += `; Print time: ${slicedData.stats.time} hours\n`;
        gcode += '\n';

        // Startup G-code
        gcode += 'G28 ; Home all axes\n';
        gcode += 'G1 Z15.0 F6000 ; Move Z up\n';
        gcode += `M104 S${materialConfig.temp} ; Set hotend temp\n`;
        gcode += `M140 S${materialConfig.bed} ; Set bed temp\n`;
        gcode += 'M109 ; Wait for hotend\n';
        gcode += 'M190 ; Wait for bed\n';
        gcode += 'G92 E0 ; Reset extruder\n';
        gcode += 'G1 F200 E3 ; Prime nozzle\n';
        gcode += 'G92 E0 ; Reset extruder\n\n';

        // Layer G-code
        let extrusionAmount = 0;

        layers.forEach(layer => {
            gcode += `; Layer ${layer.number}\n`;
            gcode += `G0 Z${layer.z.toFixed(3)} F5000\n`;

            // Perimeters
            layer.perimeters.forEach(perimeter => {
                perimeter.points.forEach((point, i) => {
                    if (i === 0) {
                        gcode += `G0 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} F7200\n`;
                    } else {
                        const distance = this.calculateDistance(perimeter.points[i - 1], point);
                        extrusionAmount += distance * 0.04; // Simplified extrusion calc
                        gcode += `G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} E${extrusionAmount.toFixed(5)} F${materialConfig.speed * 60}\n`;
                    }
                });
            });

            // Infill
            if (layer.infill) {
                layer.infill.forEach(line => {
                    gcode += `G0 X${line.start.x.toFixed(3)} Y${line.start.y.toFixed(3)} F7200\n`;
                    const distance = this.calculateDistance(line.start, line.end);
                    extrusionAmount += distance * 0.03;
                    gcode += `G1 X${line.end.x.toFixed(3)} Y${line.end.y.toFixed(3)} E${extrusionAmount.toFixed(5)} F${materialConfig.speed * 80}\n`;
                });
            }
        });

        // Ending G-code
        gcode += '\n; End of print\n';
        gcode += 'M104 S0 ; Turn off hotend\n';
        gcode += 'M140 S0 ; Turn off bed\n';
        gcode += 'G91 ; Relative positioning\n';
        gcode += 'G1 Z10 F1000 ; Raise Z\n';
        gcode += 'G90 ; Absolute positioning\n';
        gcode += 'G28 X Y ; Home X Y\n';
        gcode += 'M84 ; Disable motors\n';

        return gcode;
    }

    /**
     * Calculate print statistics
     */
    calculatePrintStats(layers, materialConfig) {
        let totalLength = 0; // mm of filament
        let totalTime = 0; // minutes

        layers.forEach(layer => {
            // Calculate filament for perimeters
            layer.perimeters.forEach(perimeter => {
                for (let i = 1; i < perimeter.points.length; i++) {
                    totalLength += this.calculateDistance(perimeter.points[i - 1], perimeter.points[i]);
                }
            });

            // Calculate filament for infill
            if (layer.infill) {
                layer.infill.forEach(line => {
                    totalLength += this.calculateDistance(line.start, line.end);
                });
            }

            // Estimate time (simplified)
            totalTime += (totalLength / materialConfig.speed) + 0.1; // Add layer change time
        });

        // Calculate material weight (1.75mm PLA = ~2.85g/m)
        const materialWeight = (totalLength / 1000) * 2.85;

        return {
            time: (totalTime / 60).toFixed(2), // hours
            material: materialWeight.toFixed(2), // grams
            filamentLength: (totalLength / 1000).toFixed(2) // meters
        };
    }

    // Helper methods

    getBoundingBox(geometry) {
        return {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 100, y: 100, z: 50 }
        };
    }

    extractContour(geometry, zLevel) {
        return [[
            { x: 10, y: 10, z: zLevel },
            { x: 90, y: 10, z: zLevel },
            { x: 90, y: 90, z: zLevel },
            { x: 10, y: 90, z: zLevel },
            { x: 10, y: 10, z: zLevel }
        ]];
    }

    detectOverhangs(geometry, angleThreshold) {
        return []; // Simplified
    }

    getPerimeterBBox(perimeter) {
        const xs = perimeter.points.map(p => p.x);
        const ys = perimeter.points.map(p => p.y);
        return {
            min: { x: Math.min(...xs), y: Math.min(...ys) },
            max: { x: Math.max(...xs), y: Math.max(...ys) }
        };
    }

    calculateDistance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = (p2.z || 0) - (p1.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

module.exports = new PrintingSlicerService();
