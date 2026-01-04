/**
 * PCB Gerber File Generation Service
 * Generates Gerber files for PCB manufacturing
 */

class GerberService {
    constructor() {
        this.layers = [
            'top_copper',
            'bottom_copper',
            'top_silkscreen',
            'bottom_silkscreen',
            'top_soldermask',
            'bottom_soldermask',
            'drill',
            'outline'
        ];
    }

    /**
     * Generate Gerber files from PCB design
     */
    async generateGerberFiles(pcbData, options = {}) {
        const {
            units = 'mm', // mm or inch
            format = 'RS274X', // RS274X (standard Gerber)
            includeNCDrill = true
        } = options;

        console.log('📋 Generating Gerber files...');

        const gerberFiles = {};

        // Generate each layer
        for (const layer of this.layers) {
            if (pcbData[layer]) {
                gerberFiles[layer] = this.generateLayer(layer, pcbData[layer], units, format);
            }
        }

        // Generate drill file
        if (includeNCDrill && pcbData.drill) {
            gerberFiles['drill'] = this.generateDrillFile(pcbData.drill, units);
        }

        console.log(`✅ Gerber files generated (${Object.keys(gerberFiles).length} files)`);

        return {
            files: gerberFiles,
            metadata: {
                layers: Object.keys(gerberFiles),
                units,
                format,
                generatedAt: new Date().toISOString()
            }
        };
    }

    /**
     * Generate Gerber file for a specific layer
     */
    generateLayer(layerName, layerData, units, format) {
        let gerber = '';

        // Header
        gerber += 'G04 #@! TF.GenerationSoftware,ArchDisc,PCB,1.0*\n';
        gerber += `G04 #@! TF.FileFunction,${this.getFileFunction(layerName)}*\n`;
        gerber += '%FSLAX46Y46*%\n'; // Format specification
        gerber += units === 'mm' ? '%MOMM*%\n' : '%MOIN*%\n'; // Units
        gerber += '\n';

        // Aperture definitions
        gerber += this.defineApertures(layerData);
        gerber += '\n';

        // Layer data
        if (layerName.includes('copper')) {
            gerber += this.generateCopperLayer(layerData);
        } else if (layerName.includes('silkscreen')) {
            gerber += this.generateSilkscreenLayer(layerData);
        } else if (layerName.includes('soldermask')) {
            gerber += this.generateSoldermaskLayer(layerData);
        } else if (layerName === 'outline') {
            gerber += this.generateOutlineLayer(layerData);
        }

        // Footer
        gerber += 'M02*\n'; // End of file

        return gerber;
    }

    /**
     * Define apertures (tools)
     */
    defineApertures(layerData) {
        let apertures = '';

        // Standard apertures
        apertures += '%ADD10C,0.200000*%\n'; // D10: Circle 0.2mm (trace)
        apertures += '%ADD11C,0.400000*%\n'; // D11: Circle 0.4mm (pad)
        apertures += '%ADD12R,1.500000X1.500000*%\n'; // D12: Rectangle 1.5x1.5mm (SMD pad)
        apertures += '%ADD13C,0.050000*%\n'; // D13: Circle 0.05mm (silkscreen)

        return apertures;
    }

    /**
     * Generate copper layer (traces, pads, fills)
     */
    generateCopperLayer(layerData) {
        let gerber = '';

        // Traces
        if (layerData.traces) {
            gerber += 'D10*\n'; // Select trace aperture

            layerData.traces.forEach(trace => {
                const start = this.toGerberCoords(trace.start);
                const end = this.toGerberCoords(trace.end);

                gerber += `G01*\n`; // Linear interpolation mode
                gerber += `X${start.x}Y${start.y}D02*\n`; // Move to start
                gerber += `X${end.x}Y${end.y}D01*\n`; // Draw to end
            });
        }

        // Pads
        if (layerData.pads) {
            gerber += 'D11*\n'; // Select pad aperture

            layerData.pads.forEach(pad => {
                const pos = this.toGerberCoords(pad.position);
                gerber += `X${pos.x}Y${pos.y}D03*\n`; // Flash pad
            });
        }

        // Copper fills/polygons
        if (layerData.fills) {
            layerData.fills.forEach(fill => {
                gerber += 'G36*\n'; // Start region
                fill.points.forEach((point, i) => {
                    const coords = this.toGerberCoords(point);
                    const cmd = i === 0 ? 'D02' : 'D01';
                    gerber += `X${coords.x}Y${coords.y}${cmd}*\n`;
                });
                gerber += 'G37*\n'; // End region
            });
        }

        return gerber;
    }

    /**
     * Generate silkscreen layer
     */
    generateSilkscreenLayer(layerData) {
        let gerber = '';
        gerber += 'D13*\n'; // Select silkscreen aperture

        if (layerData.text) {
            layerData.text.forEach(text => {
                // Simplified text rendering (use stroke font in production)
                gerber += `G04 Text: ${text.content}*\n`;
                const pos = this.toGerberCoords(text.position);
                gerber += `X${pos.x}Y${pos.y}D03*\n`;
            });
        }

        if (layerData.lines) {
            layerData.lines.forEach(line => {
                const start = this.toGerberCoords(line.start);
                const end = this.toGerberCoords(line.end);
                gerber += `X${start.x}Y${start.y}D02*\n`;
                gerber += `X${end.x}Y${end.y}D01*\n`;
            });
        }

        return gerber;
    }

    /**
     * Generate soldermask layer
     */
    generateSoldermaskLayer(layerData) {
        let gerber = '';

        // Soldermask openings (where copper is exposed)
        if (layerData.openings) {
            gerber += 'D12*\n';

            layerData.openings.forEach(opening => {
                const pos = this.toGerberCoords(opening.position);
                gerber += `X${pos.x}Y${pos.y}D03*\n`;
            });
        }

        return gerber;
    }

    /**
     * Generate board outline layer
     */
    generateOutlineLayer(layerData) {
        let gerber = '';
        gerber += 'D10*\n';

        if (layerData.outline) {
            layerData.outline.forEach((point, i) => {
                const coords = this.toGerberCoords(point);
                const cmd = i === 0 ? 'D02' : 'D01';
                gerber += `X${coords.x}Y${coords.y}${cmd}*\n`;
            });
        }

        return gerber;
    }

    /**
     * Generate NC Drill file (Excellon format)
     */
    generateDrillFile(drillData, units) {
        let drill = '';

        // Header
        drill += 'M48\n'; // Beginning of header
        drill += units === 'mm' ? 'METRIC,TZ\n' : 'INCH,TZ\n';

        // Tool definitions
        drill += 'T1C0.3000\n'; // Tool 1: 0.3mm drill
        drill += 'T2C0.8000\n'; // Tool 2: 0.8mm drill
        drill += 'T3C1.0000\n'; // Tool 3: 1.0mm drill
        drill += '%\n'; // End of header
        drill += 'G90\n'; // Absolute mode
        drill += 'G05\n'; // Drill mode

        // Drill holes
        drillData.holes?.forEach(hole => {
            const tool = this.selectDrillTool(hole.diameter);
            const coords = this.toGerberCoords(hole.position);

            drill += `T${tool}\n`; drill += `X${coords.x}Y${coords.y}\n`;
        });

        // Footer
        drill += 'M30\n'; // End of program

        return drill;
    }

    /**
     * Generate Bill of Materials (BOM)
     */
    generateBOM(pcbData) {
        let bom = 'Designator,Footprint,Quantity,Value,Manufacturer,MPN\n';

        const components = {};

        // Group components by value
        pcbData.components?.forEach(comp => {
            const key = `${comp.value}_${comp.footprint}`;
            if (!components[key]) {
                components[key] = {
                    designators: [],
                    ...comp
                };
            }
            components[key].designators.push(comp.designator);
        });

        // Generate BOM lines
        Object.values(components).forEach(comp => {
            bom += `${comp.designators.join(' ')},${comp.footprint},${comp.designators.length},${comp.value},${comp.manufacturer || ''},${comp.mpn || ''}\n`;
        });

        return bom;
    }

    // Helper methods

    getFileFunction(layerName) {
        const functions = {
            'top_copper': 'Copper,L1,Top',
            'bottom_copper': 'Copper,L2,Bot',
            'top_silkscreen': 'Legend,Top',
            'bottom_silkscreen': 'Legend,Bot',
            'top_soldermask': 'Soldermask,Top',
            'bottom_soldermask': 'Soldermask,Bot',
            'outline': 'Profile,NP'
        };
        return functions[layerName] || 'Other';
    }

    toGerberCoords(point) {
        // Convert to Gerber coordinate format (micrometers with leading zeros)
        const x = Math.round(point.x * 1000000).toString().padStart(9, '0');
        const y = Math.round(point.y * 1000000).toString().padStart(9, '0');
        return { x, y };
    }

    selectDrillTool(diameter) {
        if (diameter < 0.5) return 1;
        if (diameter < 0.9) return 2;
        return 3;
    }
}

module.exports = new GerberService();
