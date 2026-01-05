/**
 * BOM Auto-Generator Service
 * Automatically generates Bill of Materials from parametric designs
 * Includes cost estimation, standard part matching, and export capabilities
 */

const bomService = require('./bomService');
const standardComponents = require('./standardComponentService');
const costEstimation = require('../manufacturing/costEstimationService');

class BOMAutoGenerator {
    constructor() {
        this.standardPartsLibrary = this._initializeStandardParts();
        this.materialPricing = this._initializeMaterialPricing();
    }

    /**
     * Initialize standard parts library for matching
     */
    _initializeStandardParts() {
        return {
            fasteners: {
                'M3': { description: 'M3 Socket Head Cap Screw', unitCost: 0.05 },
                'M4': { description: 'M4 Socket Head Cap Screw', unitCost: 0.08 },
                'M5': { description: 'M5 Socket Head Cap Screw', unitCost: 0.10 },
                'M6': { description: 'M6 Socket Head Cap Screw', unitCost: 0.15 },
                'M8': { description: 'M8 Socket Head Cap Screw', unitCost: 0.25 },
                'M10': { description: 'M10 Socket Head Cap Screw', unitCost: 0.35 }
            },
            washers: {
                'M3': { description: 'M3 Flat Washer', unitCost: 0.02 },
                'M4': { description: 'M4 Flat Washer', unitCost: 0.03 },
                'M5': { description: 'M5 Flat Washer', unitCost: 0.04 },
                'M6': { description: 'M6 Flat Washer', unitCost: 0.05 }
            },
            nuts: {
                'M3': { description: 'M3 Hex Nut', unitCost: 0.03 },
                'M4': { description: 'M4 Hex Nut', unitCost: 0.04 },
                'M5': { description: 'M5 Hex Nut', unitCost: 0.05 },
                'M6': { description: 'M6 Hex Nut', unitCost: 0.06 }
            },
            bearings: {
                '608': { description: '608-2RS Ball Bearing (8x22x7)', unitCost: 1.50 },
                '6001': { description: '6001-2RS Ball Bearing (12x28x8)', unitCost: 2.00 },
                '6201': { description: '6201-2RS Ball Bearing (12x32x10)', unitCost: 2.50 },
                '6202': { description: '6202-2RS Ball Bearing (15x35x11)', unitCost: 3.00 }
            },
            dowelPins: {
                '3x10': { description: 'Dowel Pin 3mm x 10mm', unitCost: 0.15 },
                '4x15': { description: 'Dowel Pin 4mm x 15mm', unitCost: 0.20 },
                '5x20': { description: 'Dowel Pin 5mm x 20mm', unitCost: 0.25 },
                '6x25': { description: 'Dowel Pin 6mm x 25mm', unitCost: 0.30 }
            }
        };
    }

    /**
     * Initialize material pricing data
     */
    _initializeMaterialPricing() {
        return {
            'Aluminum 6061-T6': { perKg: 3.50, density: 2700 },
            'Aluminum 7075-T6': { perKg: 5.00, density: 2810 },
            'Steel 1018': { perKg: 1.20, density: 7850 },
            'Steel 4140': { perKg: 2.00, density: 7850 },
            'Stainless 304': { perKg: 4.00, density: 8000 },
            'Stainless 316': { perKg: 5.50, density: 8000 },
            'Ti-6Al-4V': { perKg: 45.00, density: 4430 },
            'ABS Plastic': { perKg: 2.50, density: 1050 },
            'Nylon 6': { perKg: 4.00, density: 1140 },
            'PEEK': { perKg: 80.00, density: 1320 },
            'Carbon Fiber Composite': { perKg: 35.00, density: 1600 },
            'Brass C360': { perKg: 8.00, density: 8500 }
        };
    }

    /**
     * Generate complete BOM from design variants
     * @param {object} designData - Design variant data with feature tree
     * @param {object} options - Generation options
     * @returns {object} - Complete BOM with costs and standard parts
     */
    async generateBOM(designData, options = {}) {
        const {
            includeHardware = true,
            includeLabor = true,
            laborRate = 75, // USD/hour
            overhead = 1.35, // 35% overhead
            markup = 1.25, // 25% markup
            quantity = 1
        } = options;

        console.log(`📋 Generating BOM for design...`);

        // Step 1: Extract components from feature tree
        const components = await this._extractComponentsFromDesign(designData);
        console.log(`   Found ${components.length} components`);

        // Step 2: Calculate material costs
        const materializedComponents = this._calculateMaterialCosts(components);

        // Step 3: Match standard parts
        let bomItems = [...materializedComponents];
        if (includeHardware) {
            const standardParts = this._matchStandardParts(designData);
            bomItems = [...bomItems, ...standardParts];
        }

        // Step 4: Calculate labor and manufacturing costs
        if (includeLabor) {
            bomItems = bomItems.map(item => ({
                ...item,
                laborCost: this._estimateLaborCost(item, laborRate),
                manufacturingCost: this._estimateManufacturingCost(item)
            }));
        }

        // Step 5: Calculate totals
        const totals = this._calculateTotals(bomItems, overhead, markup, quantity);

        // Step 6: Generate BOM structure
        const bom = {
            id: `BOM_${Date.now()}`,
            designId: designData.id || 'design_1',
            name: designData.name || 'Generated Design',
            generatedAt: new Date().toISOString(),
            items: bomItems.map((item, idx) => ({
                itemNumber: idx + 1,
                ...item
            })),
            summary: {
                totalItems: bomItems.length,
                customParts: bomItems.filter(i => !i.isStandard).length,
                standardParts: bomItems.filter(i => i.isStandard).length,
                quantity: quantity
            },
            costs: totals,
            metadata: {
                laborRate,
                overhead,
                markup,
                currency: 'USD'
            }
        };

        console.log(`✅ BOM generated: ${bom.items.length} line items`);
        console.log(`   Total cost: $${totals.grandTotal.toFixed(2)} (qty: ${quantity})`);

        return bom;
    }

    /**
     * Extract components from design data
     */
    async _extractComponentsFromDesign(designData) {
        const components = [];

        // Extract from specification
        const spec = designData.specification || designData.baseSpec || {};
        const dims = spec.dimensions || { x: 100, y: 50, z: 25 };
        const material = spec.material || { name: 'Aluminum 6061-T6' };

        // Main body component
        components.push({
            partNumber: 'BODY-001',
            name: `${designData.name || 'Part'} Main Body`,
            description: `Main body - ${dims.x}x${dims.y}x${dims.z}mm`,
            material: material.name,
            quantity: 1,
            isStandard: false,
            dimensions: dims,
            volume: this._calculateVolume(dims, spec),
            weight: null, // Will be calculated
            unitCost: null // Will be calculated
        });

        // Extract from feature tree if available
        const featureTree = designData.featureTree || {};
        const features = featureTree.features || [];

        // Look for sub-components
        for (const feature of features) {
            if (feature.type === 'component' || feature.type === 'subassembly') {
                components.push({
                    partNumber: `COMP-${String(components.length).padStart(3, '0')}`,
                    name: feature.name || `Component ${components.length}`,
                    description: feature.description || 'Sub-component',
                    material: feature.material || material.name,
                    quantity: feature.quantity || 1,
                    isStandard: false,
                    dimensions: feature.dimensions || { x: 10, y: 10, z: 10 },
                    volume: null,
                    weight: null,
                    unitCost: null
                });
            }
        }

        return components;
    }

    /**
     * Calculate volume from dimensions and spec
     */
    _calculateVolume(dims, spec) {
        let volume = (dims.x * dims.y * dims.z) / 1000; // cm³

        // Apply reductions for features
        const features = spec.features || [];
        for (const feat of features) {
            if (feat.type === 'hole') {
                const holeVolume = Math.PI * Math.pow(feat.diameter / 2, 2) * (feat.depth || dims.z);
                volume -= holeVolume / 1000;
            } else if (feat.type === 'pocket') {
                const pocketDims = feat.dimensions || [10, 10, 5];
                volume -= (pocketDims[0] * pocketDims[1] * pocketDims[2]) / 1000;
            } else if (feat.type === 'shell') {
                volume *= 0.3; // Approximate shell reduction
            }
        }

        // Apply structure modifier
        if (spec.structure?.type === 'lattice') {
            volume *= (spec.structure.density || 0.3);
        }

        return Math.max(volume, 0.1); // Minimum volume
    }

    /**
     * Calculate material costs for components
     */
    _calculateMaterialCosts(components) {
        return components.map(comp => {
            const materialData = this.materialPricing[comp.material] ||
                this.materialPricing['Aluminum 6061-T6'];

            // Calculate volume if not provided
            const volume = comp.volume || this._calculateVolume(comp.dimensions, {});

            // Calculate weight: volume (cm³) * density (kg/m³) / 1000000
            const volumeM3 = volume / 1000000;
            const weight = volumeM3 * materialData.density;

            // Calculate material cost
            const materialCost = weight * materialData.perKg;

            return {
                ...comp,
                volume,
                weight: weight * 1000, // grams
                materialCost,
                unitCost: materialCost * 2.5 // Base markup for raw material to finished part
            };
        });
    }

    /**
     * Match and suggest standard parts based on design
     */
    _matchStandardParts(designData) {
        const standardParts = [];
        const spec = designData.specification || designData.baseSpec || {};
        const features = spec.features || [];

        // Analyze holes to suggest fasteners
        for (const feature of features) {
            if (feature.type === 'hole') {
                const diameter = feature.diameter;
                const quantity = feature.quantity || 1;

                // Match hole to standard fastener size
                const fastenerSize = this._matchFastenerSize(diameter);
                if (fastenerSize) {
                    // Add screw
                    const screw = this.standardPartsLibrary.fasteners[fastenerSize];
                    if (screw) {
                        standardParts.push({
                            partNumber: `STD-SCR-${fastenerSize}`,
                            name: screw.description,
                            description: `Standard ${fastenerSize} fastener`,
                            material: 'Steel, Zinc Plated',
                            quantity: quantity,
                            isStandard: true,
                            unitCost: screw.unitCost,
                            supplier: 'McMaster-Carr',
                            supplierPN: `91292A${fastenerSize.slice(1)}1`
                        });
                    }

                    // Add washer
                    const washer = this.standardPartsLibrary.washers[fastenerSize];
                    if (washer) {
                        standardParts.push({
                            partNumber: `STD-WSH-${fastenerSize}`,
                            name: washer.description,
                            description: `Standard ${fastenerSize} washer`,
                            material: 'Steel, Zinc Plated',
                            quantity: quantity,
                            isStandard: true,
                            unitCost: washer.unitCost,
                            supplier: 'McMaster-Carr',
                            supplierPN: `98689A1${fastenerSize.slice(1)}`
                        });
                    }

                    // Add nut for through holes
                    if (feature.depth === null || feature.holeType === 'through') {
                        const nut = this.standardPartsLibrary.nuts[fastenerSize];
                        if (nut) {
                            standardParts.push({
                                partNumber: `STD-NUT-${fastenerSize}`,
                                name: nut.description,
                                description: `Standard ${fastenerSize} nut`,
                                material: 'Steel, Zinc Plated',
                                quantity: quantity,
                                isStandard: true,
                                unitCost: nut.unitCost,
                                supplier: 'McMaster-Carr',
                                supplierPN: `90592A0${fastenerSize.slice(1)}`
                            });
                        }
                    }
                }
            }
        }

        // Check for bearing features
        for (const feature of features) {
            if (feature.type === 'bearing_bore' ||
                (feature.type === 'hole' && feature.diameter >= 8 && feature.precision === 'high')) {
                const bearingSize = this._matchBearingSize(feature.diameter);
                if (bearingSize) {
                    const bearing = this.standardPartsLibrary.bearings[bearingSize];
                    if (bearing) {
                        standardParts.push({
                            partNumber: `STD-BRG-${bearingSize}`,
                            name: bearing.description,
                            description: 'Deep groove ball bearing',
                            material: 'Steel, Rubber Sealed',
                            quantity: feature.quantity || 1,
                            isStandard: true,
                            unitCost: bearing.unitCost,
                            supplier: 'SKF',
                            supplierPN: bearingSize
                        });
                    }
                }
            }
        }

        return standardParts;
    }

    /**
     * Match hole diameter to standard fastener size
     */
    _matchFastenerSize(diameter) {
        const clearanceHoles = {
            3.2: 'M3', 3.4: 'M3',
            4.3: 'M4', 4.5: 'M4',
            5.3: 'M5', 5.5: 'M5',
            6.4: 'M6', 6.6: 'M6',
            8.4: 'M8', 9.0: 'M8',
            10.5: 'M10', 11.0: 'M10'
        };

        // Find closest match
        for (const [holeSize, fastener] of Object.entries(clearanceHoles)) {
            if (Math.abs(diameter - parseFloat(holeSize)) < 0.5) {
                return fastener;
            }
        }

        return null;
    }

    /**
     * Match hole to bearing size
     */
    _matchBearingSize(diameter) {
        const bearingBores = {
            8: '608',
            12: '6001',
            12.5: '6201',
            15: '6202'
        };

        for (const [bore, bearing] of Object.entries(bearingBores)) {
            if (Math.abs(diameter - parseFloat(bore)) < 1) {
                return bearing;
            }
        }

        return null;
    }

    /**
     * Estimate labor cost for component
     */
    _estimateLaborCost(item, laborRate) {
        if (item.isStandard) return 0;

        // Estimate based on complexity
        const baseTime = 0.5; // 30 minutes base
        const featureTime = 0.1; // 6 minutes per feature
        const volume = item.volume || 100;
        const sizeModifier = Math.log10(volume + 1) * 0.2;

        const totalHours = baseTime + sizeModifier;
        return totalHours * laborRate;
    }

    /**
     * Estimate manufacturing cost
     */
    _estimateManufacturingCost(item) {
        if (item.isStandard) return 0;

        const materialCost = item.materialCost || 0;
        const weight = item.weight || 100;

        // Machine time cost estimate
        const machineRate = 50; // USD/hour
        const machineTime = 0.25 + (weight / 500); // Base + weight factor
        const machineCost = machineTime * machineRate;

        // Setup cost (amortized)
        const setupCost = 25;

        return machineCost + setupCost;
    }

    /**
     * Calculate cost totals
     */
    _calculateTotals(items, overhead, markup, quantity) {
        const materialTotal = items.reduce((sum, i) => sum + (i.materialCost || 0) * (i.quantity || 1), 0);
        const laborTotal = items.reduce((sum, i) => sum + (i.laborCost || 0) * (i.quantity || 1), 0);
        const manufacturingTotal = items.reduce((sum, i) => sum + (i.manufacturingCost || 0) * (i.quantity || 1), 0);
        const standardPartsTotal = items.reduce((sum, i) =>
            sum + (i.isStandard ? (i.unitCost || 0) * (i.quantity || 1) : 0), 0);

        const subtotal = materialTotal + laborTotal + manufacturingTotal + standardPartsTotal;
        const withOverhead = subtotal * overhead;
        const withMarkup = withOverhead * markup;
        const perUnit = withMarkup;
        const grandTotal = perUnit * quantity;

        return {
            materialTotal,
            laborTotal,
            manufacturingTotal,
            standardPartsTotal,
            subtotal,
            overhead: withOverhead - subtotal,
            markup: withMarkup - withOverhead,
            perUnit,
            grandTotal,
            quantity
        };
    }

    /**
     * Export BOM to various formats
     */
    async exportBOM(bom, format = 'csv') {
        switch (format) {
            case 'csv':
                return this._exportToCSV(bom);
            case 'json':
                return JSON.stringify(bom, null, 2);
            case 'excel':
                return this._exportToExcelFormat(bom);
            default:
                return bom;
        }
    }

    /**
     * Export to CSV format
     */
    _exportToCSV(bom) {
        const headers = [
            'Item #', 'Part Number', 'Name', 'Description',
            'Material', 'Qty', 'Unit Cost', 'Extended Cost', 'Standard Part'
        ];

        const rows = bom.items.map(item => [
            item.itemNumber,
            item.partNumber,
            item.name,
            item.description,
            item.material,
            item.quantity,
            (item.unitCost || 0).toFixed(2),
            ((item.unitCost || 0) * item.quantity).toFixed(2),
            item.isStandard ? 'Yes' : 'No'
        ]);

        // Add totals row
        rows.push([]);
        rows.push(['', '', '', '', '', '', 'Subtotal:', bom.costs.subtotal.toFixed(2), '']);
        rows.push(['', '', '', '', '', '', 'Overhead:', bom.costs.overhead.toFixed(2), '']);
        rows.push(['', '', '', '', '', '', 'Total:', bom.costs.grandTotal.toFixed(2), '']);

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        return csvContent;
    }

    /**
     * Export to Excel-compatible format
     */
    _exportToExcelFormat(bom) {
        return {
            format: 'xlsx',
            sheets: [
                {
                    name: 'BOM',
                    data: bom.items.map(item => ({
                        'Item #': item.itemNumber,
                        'Part Number': item.partNumber,
                        'Name': item.name,
                        'Description': item.description,
                        'Material': item.material,
                        'Quantity': item.quantity,
                        'Unit Cost': item.unitCost || 0,
                        'Extended': (item.unitCost || 0) * item.quantity
                    }))
                },
                {
                    name: 'Summary',
                    data: [
                        { 'Category': 'Material Cost', 'Amount': bom.costs.materialTotal },
                        { 'Category': 'Labor Cost', 'Amount': bom.costs.laborTotal },
                        { 'Category': 'Manufacturing', 'Amount': bom.costs.manufacturingTotal },
                        { 'Category': 'Standard Parts', 'Amount': bom.costs.standardPartsTotal },
                        { 'Category': 'Subtotal', 'Amount': bom.costs.subtotal },
                        { 'Category': 'Overhead', 'Amount': bom.costs.overhead },
                        { 'Category': 'Grand Total', 'Amount': bom.costs.grandTotal }
                    ]
                }
            ]
        };
    }

    /**
     * Generate BOM comparison between variants
     */
    compareBOMs(boms) {
        return {
            variantCount: boms.length,
            costComparison: boms.map(b => ({
                id: b.designId,
                name: b.name,
                totalCost: b.costs.grandTotal,
                itemCount: b.items.length
            })).sort((a, b) => a.totalCost - b.totalCost),
            lowestCost: boms.reduce((min, b) =>
                b.costs.grandTotal < min.costs.grandTotal ? b : min
            ),
            savings: {
                max: Math.max(...boms.map(b => b.costs.grandTotal)),
                min: Math.min(...boms.map(b => b.costs.grandTotal)),
                potential: ((Math.max(...boms.map(b => b.costs.grandTotal)) -
                    Math.min(...boms.map(b => b.costs.grandTotal))) /
                    Math.max(...boms.map(b => b.costs.grandTotal)) * 100).toFixed(1) + '%'
            }
        };
    }
}

module.exports = new BOMAutoGenerator();
