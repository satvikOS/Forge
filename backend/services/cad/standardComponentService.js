/**
 * Standard Component Library Service
 * Fasteners, bearings, springs, connectors with AI-powered suggestions
 */

class StandardComponentService {
    constructor() {
        this.fasteners = this._initializeFasteners();
        this.bearings = this._initializeBearings();
        this.springs = this._initializeSprings();
        this.connectors = this._initializeConnectors();
    }

    /**
     * Initialize fastener library (ISO, ANSI, DIN, MIL-spec)
     */
    _initializeFasteners() {
        return {
            bolts: {
                'ISO_4017_M8x1.25x30': {
                    standard: 'ISO 4017',
                    type: 'hex_bolt',
                    thread: 'M8x1.25',
                    length: 30,
                    material: 'steel_8.8',
                    vendor: 'McMaster-Carr',
                    partNumber: '91290A358',
                    unitCost: 0.42
                },
                'ANSI_B18.2.1_1/4-20x1': {
                    standard: 'ANSI B18.2.1',
                    type: 'hex_bolt',
                    thread: '1/4-20',
                    length: 25.4,
                    material: 'steel_grade5',
                    vendor: 'McMaster-Carr',
                    partNumber: '91251A540',
                    unitCost: 0.38
                }
            },
            screws: {
                'ISO_4762_M6x1x16': {
                    standard: 'ISO 4762',
                    type: 'socket_head',
                    thread: 'M6x1',
                    length: 16,
                    material: 'steel_12.9',
                    vendor: 'McMaster-Carr',
                    partNumber: '91292A142',
                    unitCost: 0.28
                }
            },
            nuts: {
                'ISO_4032_M8': {
                    standard: 'ISO 4032',
                    type: 'hex_nut',
                    thread: 'M8',
                    material: 'steel_8',
                    vendor: 'McMaster-Carr',
                    partNumber: '90592A022',
                    unitCost: 0.12
                }
            },
            washers: {
                'ISO_7089_8': {
                    standard: 'ISO 7089',
                    type: 'flat_washer',
                    innerDiameter: 8.4,
                    outerDiameter: 17,
                    thickness: 1.6,
                    material: 'steel',
                    vendor: 'McMaster-Carr',
                    partNumber: '93475A210',
                    unitCost: 0.05
                }
            }
        };
    }

    /**
     * Initialize bearing library
     */
    _initializeBearings() {
        return {
            ballBearings: {
                '6204': {
                    type: 'deep_groove_ball',
                    bore: 20,
                    outerDiameter: 47,
                    width: 14,
                    dynamicLoad: 12800, // N
                    staticLoad: 6650, // N
                    vendor: 'SKF',
                    partNumber: '6204-2RS1',
                    unitCost: 12.50
                },
                '6206': {
                    type: 'deep_groove_ball',
                    bore: 30,
                    outerDiameter: 62,
                    width: 16,
                    dynamicLoad: 19500,
                    staticLoad: 11200,
                    vendor: 'SKF',
                    partNumber: '6206-2RS1',
                    unitCost: 18.75
                }
            },
            rollerBearings: {
                'NU204': {
                    type: 'cylindrical_roller',
                    bore: 20,
                    outerDiameter: 47,
                    width: 14,
                    dynamicLoad: 18300,
                    staticLoad: 14600,
                    vendor: 'SKF',
                    partNumber: 'NU204ECP',
                    unitCost: 28.90
                }
            }
        };
    }

    /**
     * Initialize spring library
     */
    _initializeSpringss() {
        return {
            compression: {
                'CS_12x25x50': {
                    type: 'compression',
                    wireDiameter: 1.2,
                    outerDiameter: 12,
                    freeLength: 50,
                    springRate: 2.5, // N/mm
                    maxLoad: 80, // N
                    material: 'music_wire',
                    vendor: 'McMaster-Carr',
                    partNumber: '9657K173',
                    unitCost: 1.85
                }
            },
            extension: {
                'ES_10x20x40': {
                    type: 'extension',
                    wireDiameter: 1.0,
                    outerDiameter: 10,
                    freeLength: 40,
                    springRate: 1.8,
                    maxLoad: 50,
                    material: 'stainless_302',
                    vendor: 'McMaster-Carr',
                    partNumber: '9663K32',
                    unitCost: 2.10
                }
            },
            torsion: {
                'TS_8x15': {
                    type: 'torsion',
                    wireDiameter: 0.8,
                    coilDiameter: 8,
                    legLength: 15,
                    springRate: 0.12, // Nm/deg
                    maxTorque: 1.2, // Nm
                    material: 'spring_steel',
                    vendor: 'McMaster-Carr',
                    partNumber: '9271K83',
                    unitCost: 3.40
                }
            }
        };
    }

    /**
     * Initialize connector library
     */
    _initializeConnectors() {
        return {
            electrical: {
                'JST_XH_2pin': {
                    type: 'wire_to_board',
                    pins: 2,
                    pitch: 2.5,
                    current: 3, // A
                    voltage: 250, // V
                    vendor: 'Digi-Key',
                    partNumber: 'JST-B2B-XH-A',
                    unitCost: 0.45
                }
            },
            pneumatic: {
                'SMC_KQ2H06': {
                    type: 'push_to_connect',
                    tubeDiameter: 6,
                    thread: 'M5',
                    maxPressure: 10, // bar
                    vendor: 'SMC',
                    partNumber: 'KQ2H06-M5',
                    unitCost: 4.20
                }
            }
        };
    }

    /**
     * Search for standard components by specification
     */
    searchComponents(specifications) {
        const {
            category, // fastener, bearing, spring, connector
            filters = {}
        } = specifications;

        console.log(`🔍 Searching ${category} components...`);

        let results = [];

        switch (category) {
            case 'fastener':
                results = this._searchFasteners(filters);
                break;
            case 'bearing':
                results = this._searchBearings(filters);
                break;
            case 'spring':
                results = this._searchSprings(filters);
                break;
            case 'connector':
                results = this._searchConnectors(filters);
                break;
        }

        console.log(`✅ Found ${results.length} matching components`);

        return results;
    }

    /**
     * AI-powered suggestion for standard part replacement
     */
    async suggestStandardReplacement(customPart, options = {}) {
        const {
            considerCost = true,
            considerAvailability = true,
            toleranceForDimensions = 0.5 // mm
        } = options;

        console.log(`🤖 Finding standard replacements for custom part: ${customPart.name}...`);

        const suggestions = [];

        // Analyze part type
        const partType = this._identifyPartType(customPart);

        // Search appropriate library
        let candidates = [];

        if (partType === 'fastener') {
            candidates = this._findFastenerCandidates(customPart, toleranceForDimensions);
        } else if (partType === 'bearing') {
            candidates = this._findBearingCandidates(customPart, toleranceForDimensions);
        } else if (partType === 'spring') {
            candidates = this._findSpringCandidates(customPart, toleranceForDimensions);
        }

        // Rank candidates
        candidates.forEach(candidate => {
            let score = 100;

            // Dimensional fit
            const dimensionalFit = this._calculateDimensionalFit(customPart, candidate);
            score -= (1 - dimensionalFit) * 50;

            // Cost benefit
            if (considerCost && customPart.estimatedCost) {
                const costSavings = ((customPart.estimatedCost - candidate.unitCost) / customPart.estimatedCost) * 100;
                score += Math.max(0, costSavings) * 0.3;
            }

            // Availability
            if (considerAvailability && candidate.vendor) {
                score += 10;
            }

            suggestions.push({
                component: candidate,
                score,
                dimensionalFit,
                costSavings: customPart.estimatedCost ? customPart.estimatedCost - candidate.unitCost : null,
                recommendation: score > 70 ? 'Highly Recommended' : score > 50 ? 'Suitable' : 'Consider'
            });
        });

        // Sort by score
        suggestions.sort((a, b) => b.score - a.score);

        console.log(`✅ Found ${suggestions.length} standard replacement options`);

        return suggestions.slice(0, 5); // Top 5
    }

    /**
     * Get supplier information and part numbers
     */
    getSupplierInfo(partNumber, vendor) {
        console.log(`🏭 Retrieving supplier info for ${partNumber} from ${vendor}...`);

        const supplierInfo = {
            vendor,
            partNumber,
            availability: 'In Stock',
            leadTime: '2-3 days',
            moq: 1,
            priceBreaks: [
                { quantity: 1, unitPrice: null },
                { quantity: 10, unitPrice: null },
                { quantity: 100, unitPrice: null }
            ],
            datasheet: `https://www.${vendor.toLowerCase().replace(/\s+/g, '')}.com/datasheets/${partNumber}.pdf`,
            technicalDrawing: `https://www.${vendor.toLowerCase().replace(/\s+/g, '')}.com/drawings/${partNumber}.pdf`
        };

        // Find component to get pricing
        const component = this._findComponentByPartNumber(partNumber);

        if (component) {
            supplierInfo.priceBreaks[0].unitPrice = component.unitCost;
            supplierInfo.priceBreaks[1].unitPrice = component.unitCost * 0.9;
            supplierInfo.priceBreaks[2].unitPrice = component.unitCost * 0.75;
        }

        return supplierInfo;
    }

    // Helper methods

    _searchFasteners(filters) {
        const results = [];
        Object.values(this.fasteners).forEach(category => {
            Object.entries(category).forEach(([id, fastener]) => {
                if (this._matchesFilters(fastener, filters)) {
                    results.push({ id, ...fastener });
                }
            });
        });
        return results;
    }

    _searchBearings(filters) {
        const results = [];
        Object.values(this.bearings).forEach(category => {
            Object.entries(category).forEach(([id, bearing]) => {
                if (this._matchesFilters(bearing, filters)) {
                    results.push({ id, ...bearing });
                }
            });
        });
        return results;
    }

    _searchSprings(filters) {
        const results = [];
        Object.values(this.springs).forEach(category => {
            Object.entries(category).forEach(([id, spring]) => {
                if (this._matchesFilters(spring, filters)) {
                    results.push({ id, ...spring });
                }
            });
        });
        return results;
    }

    _searchConnectors(filters) {
        const results = [];
        Object.values(this.connectors).forEach(category => {
            Object.entries(category).forEach(([id, connector]) => {
                if (this._matchesFilters(connector, filters)) {
                    results.push({ id, ...connector });
                }
            });
        });
        return results;
    }

    _matchesFilters(component, filters) {
        for (const [key, value] of Object.entries(filters)) {
            if (component[key] !== value) return false;
        }
        return true;
    }

    _identifyPartType(customPart) {
        // Simplified part type identification
        if (customPart.thread) return 'fastener';
        if (customPart.bore) return 'bearing';
        if (customPart.springRate) return 'spring';
        return 'unknown';
    }

    _findFastenerCandidates(customPart, tolerance) {
        // Find fasteners that match dimensions
        const candidates = [];
        Object.values(this.fasteners).forEach(category => {
            Object.values(category).forEach(fastener => {
                if (fastener.thread === customPart.thread) {
                    candidates.push(fastener);
                }
            });
        });
        return candidates;
    }

    _findBearingCandidates(customPart, tolerance) {
        const candidates = [];
        Object.values(this.bearings).forEach(category => {
            Object.values(category).forEach(bearing => {
                if (Math.abs(bearing.bore - customPart.bore) <= tolerance) {
                    candidates.push(bearing);
                }
            });
        });
        return candidates;
    }

    _findSpringCandidates(customPart, tolerance) {
        const candidates = [];
        Object.values(this.springs).forEach(category => {
            Object.values(category).forEach(spring => {
                if (Math.abs(spring.springRate - customPart.springRate) / customPart.springRate < 0.2) {
                    candidates.push(spring);
                }
            });
        });
        return candidates;
    }

    _calculateDimensionalFit(customPart, standardPart) {
        // Simplified fit calculation (0-1 score)
        let fit = 1.0;

        if (customPart.bore && standardPart.bore) {
            const boreDiff = Math.abs(customPart.bore - standardPart.bore);
            fit -= Math.min(boreDiff / customPart.bore, 0.5);
        }

        return Math.max(0, fit);
    }

    _findComponentByPartNumber(partNumber) {
        const allComponents = [
            ...Object.values(this.fasteners).flatMap(c => Object.values(c)),
            ...Object.values(this.bearings).flatMap(c => Object.values(c)),
            ...Object.values(this.springs).flatMap(c => Object.values(c)),
            ...Object.values(this.connectors).flatMap(c => Object.values(c))
        ];

        return allComponents.find(c => c.partNumber === partNumber);
    }
}

module.exports = new StandardComponentService();
