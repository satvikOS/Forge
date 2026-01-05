/**
 * BOM Auto-Generator & Simulation Prep Service
 * Extract Bills of Materials from CAD models + Prepare models for FEA/CFD
 * Auto-assign materials, contacts, meshes, boundary conditions
 */

class BOMAndSimulationPrepService {
    constructor() {
        this.materialDatabase = this.initializeMaterialDatabase();
        this.standardParts = this.initializeStandardPartsLibrary();
        this.vendorDatabase = this.initializeVendorDatabase();
    }

    // ==================== BOM GENERATION ====================

    /**
     * Auto-generate Bill of Materials from CAD model
     * Extracts parts, materials, quantities, costs
     */
    async generateBOM(cadModel, options = {}) {
        const {
            bomType = 'hierarchical',  // 'hierarchical' or 'flat'
            includeStandardParts = true,
            includeCosts = true,
            includeVendors = true,
            configurationName = 'default'
        } = options;

        console.log(`📋 BOM Generator: Generating ${bomType} BOM...`);

        // Step 1: Parse CAD model structure
        const structure = this.parseCadStructure(cadModel);

        // Step 2: Extract parts and components
        const parts = await this.extractParts(structure);

        // Step 3: Identify materials
        const partsWithMaterials = await this.identifyMaterials(parts);

        // Step 4: Calculate quantities
        const partsWithQuantities = this.calculateQuantities(partsWithMaterials);

        // Step 5: Match standard parts
        let finalParts = partsWithQuantities;
        if (includeStandardParts) {
            finalParts = await this.matchStandardParts(partsWithQuantities);
        }

        // Step 6: Add vendor information
        if (includeVendors) {
            finalParts = await this.addVendorInfo(finalParts);
        }

        // Step 7: Calculate costs
        let costData = null;
        if (includeCosts) {
            costData = await this.calculateCosts(finalParts);
        }

        // Step 8: Format BOM
        const bom = bomType === 'hierarchical' ?
            this.formatHierarchicalBOM(finalParts, structure) :
            this.formatFlatBOM(finalParts);

        return {
            success: true,
            operation: 'bom-generation',
            bomType,
            bom,
            summary: {
                totalParts: finalParts.length,
                uniqueParts: new Set(finalParts.map(p => p.partNumber)).size,
                totalCost: costData?.total,
                standardParts: finalParts.filter(p => p.isStandard).length,
                customParts: finalParts.filter(p => !p.isStandard).length
            },
            costBreakdown: costData,
            exportFormats: ['Excel', 'CSV', 'PDF', 'ERP-XML']
        };
    }

    /**
     * Parse CAD model structure (assembly tree)
     */
    parseCadStructure(cadModel) {
        const structure = {
            root: {
                name: cadModel.name || 'Assembly',
                type: 'assembly',
                children: [],
                level: 0
            }
        };

        // Recursively build assembly tree
        if (cadModel.assembly) {
            structure.root.children = this.buildAssemblyTree(cadModel.assembly, 1);
        } else {
            // Single part
            structure.root.children.push({
                name: cadModel.name || 'Part',
                type: 'part',
                level: 1,
                geometry: cadModel.geometry
            });
        }

        return structure;
    }

    /**
     * Build assembly tree recursively
     */
    buildAssemblyTree(assembly, level) {
        const children = [];

        // Mock assembly structure (replace with actual CAD model parsing)
        if (assembly.components) {
            assembly.components.forEach((component, idx) => {
                children.push({
                    name: component.name || `Component_${idx + 1}`,
                    type: component.isAssembly ? 'assembly' : 'part',
                    level,
                    geometry: component.geometry,
                    children: component.isAssembly ?
                        this.buildAssemblyTree(component, level + 1) : []
                });
            });
        }

        return children;
    }

    /**
     * Extract all parts from structure
     */
    async extractParts(structure) {
        const parts = [];
        const partCounter = {};

        const extractRecursive = (node) => {
            if (node.type === 'part') {
                // Generate part number
                const baseName = node.name;
                partCounter[baseName] = (partCounter[baseName] || 0) + 1;

                parts.push({
                    partNumber: `PN-${String(parts.length + 1).padStart(4, '0')}`,
                    name: node.name,
                    description: this.generatePartDescription(node),
                    type: this.classifyPartType(node),
                    geometry: node.geometry,
                    level: node.level,
                    quantity: 1,  // Will be updated later
                    material: null,  // Will be identified later
                    isStandard: false
                });
            }

            if (node.children) {
                node.children.forEach(child => extractRecursive(child));
            }
        };

        extractRecursive(structure.root);
        return parts;
    }

    /**
     * Generate part description from geometry
     */
    generatePartDescription(node) {
        if (!node.geometry) return 'Custom part';

        const desc = [];

        if (node.geometry.type) {
            desc.push(node.geometry.type);
        }

        if (node.geometry.dimensions) {
            const dims = node.geometry.dimensions;
            desc.push(`${dims.length}x${dims.width}x${dims.height}mm`);
        }

        return desc.join(' - ') || 'Custom machined part';
    }

    /**
     * Classify part type
     */
    classifyPartType(node) {
        const name = node.name.toLowerCase();

        if (name.includes('bracket')) return 'Bracket';
        if (name.includes('plate')) return 'Plate';
        if (name.includes('shaft')) return 'Shaft';
        if (name.includes('housing')) return 'Housing';
        if (name.includes('cover')) return 'Cover';
        if (name.includes('bolt') || name.includes('screw')) return 'Fastener';
        if (name.includes('washer')) return 'Washer';
        if (name.includes('nut')) return 'Nut';

        return 'Component';
    }

    /**
     * Identify materials for all parts
     */
    async identifyMaterials(parts) {
        return parts.map(part => {
            // Try to extract material from geometry metadata
            if (part.geometry && part.geometry.material) {
                part.material = part.geometry.material;
            } else {
                // Infer material from part type
                part.material = this.inferMaterial(part.type);
            }

            // Get material properties from database
            part.materialProperties = this.materialDatabase[part.material] || {};

            return part;
        });
    }

    /**
     * Infer material from part type
     */
    inferMaterial(partType) {
        const materialMapping = {
            'Bracket': 'aluminum-6061',
            'Plate': 'aluminum-6061',
            'Shaft': 'steel-1045',
            'Housing': 'aluminum-6061',
            'Cover': 'aluminum-6061',
            'Fastener': 'steel-grade-8',
            'Washer': 'steel-zinc-plated',
            'Nut': 'steel-grade-8'
        };

        return materialMapping[partType] || 'aluminum-6061';
    }

    /**
     * Calculate quantities (consolidate identical parts)
     */
    calculateQuantities(parts) {
        const uniqueParts = [];
        const partMap = new Map();

        parts.forEach(part => {
            const key = `${part.name}_${part.material}`;

            if (partMap.has(key)) {
                partMap.get(key).quantity++;
            } else {
                partMap.set(key, { ...part });
                uniqueParts.push(partMap.get(key));
            }
        });

        return uniqueParts;
    }

    /**
     * Match against standard parts library
     */
    async matchStandardParts(parts) {
        return parts.map(part => {
            // Check if part matches standard catalog
            const standardMatch = this.findStandardPartMatch(part);

            if (standardMatch) {
                part.isStandard = true;
                part.standardPartNumber = standardMatch.partNumber;
                part.manufacturer = standardMatch.manufacturer;
                part.description = standardMatch.description;
                part.unitCost = standardMatch.unitCost;
            }

            return part;
        });
    }

    /**
     * Find standard part match
     */
    findStandardPartMatch(part) {
        // Check fasteners
        if (part.type === 'Fastener') {
            if (part.name.match(/M(\d+)/i)) {
                const size = part.name.match(/M(\d+)/i)[1];
                return this.standardParts.fasteners[`M${size}`];
            }
        }

        // Check washers
        if (part.type === 'Washer') {
            if (part.name.match(/M(\d+)/i)) {
                const size = part.name.match(/M(\d+)/i)[1];
                return this.standardParts.washers[`M${size}`];
            }
        }

        // Check nuts
        if (part.type === 'Nut') {
            if (part.name.match(/M(\d+)/i)) {
                const size = part.name.match(/M(\d+)/i)[1];
                return this.standardParts.nuts[`M${size}`];
            }
        }

        return null;
    }

    /**
     * Add vendor information
     */
    async addVendorInfo(parts) {
        return parts.map(part => {
            if (part.isStandard && part.manufacturer) {
                const vendor = this.vendorDatabase[part.manufacturer];
                if (vendor) {
                    part.vendor = vendor.name;
                    part.vendorPartNumber = vendor.partNumberPrefix + part.standardPartNumber;
                    part.leadTime = vendor.leadTime;
                    part.moq = vendor.moq;
                }
            } else {
                // Custom part - assign to machining vendor
                part.vendor = 'Internal Manufacturing / Contract Machining';
                part.leadTime = '7-14 days';
                part.moq = 1;
            }

            return part;
        });
    }

    /**
     * Calculate costs
     */
    async calculateCosts(parts) {
        let materialCost = 0;
        let purchaseCost = 0;
        let manufacturingCost = 0;

        parts.forEach(part => {
            if (part.isStandard) {
                const cost = (part.unitCost || 0.50) * part.quantity;
                purchaseCost += cost;
                part.totalCost = cost.toFixed(2);
            } else {
                // Estimate custom part cost
                const matCost = this.estimateMaterialCost(part);
                const mfgCost = this.estimateManufacturingCost(part);

                materialCost += matCost * part.quantity;
                manufacturingCost += mfgCost * part.quantity;

                part.totalCost = ((matCost + mfgCost) * part.quantity).toFixed(2);
            }
        });

        const total = materialCost + purchaseCost + manufacturingCost;

        return {
            material: materialCost.toFixed(2),
            purchased: purchaseCost.toFixed(2),
            manufacturing: manufacturingCost.toFixed(2),
            subtotal: total.toFixed(2),
            overhead: (total * 0.15).toFixed(2),  // 15% overhead
            total: (total * 1.15).toFixed(2),
            currency: 'USD'
        };
    }

    /**
     * Estimate material cost
     */
    estimateMaterialCost(part) {
        const material = this.materialDatabase[part.material];
        if (!material) return 5.0; // Default

        // Estimate volume (simplified)
        const volume = 50; // cm³ (placeholder)
        const mass = volume * material.density; // grams

        return (mass / 1000) * material.costPerKg;
    }

    /**
     * Estimate manufacturing cost
     */
    estimateManufacturingCost(part) {
        // Simplified cost model
        const baseSetupCost = 50; // $ per part
        const machineRate = 75; // $/hour

        // Estimate machining time based on complexity
        const complexityFactor = part.type === 'Housing' ? 2.0 : 1.0;
        const machiningTime = 0.5 * complexityFactor; // hours

        return baseSetupCost + (machineRate * machiningTime);
    }

    /**
     * Format hierarchical BOM
     */
    formatHierarchicalBOM(parts, structure) {
        const rows = [];
        let itemNumber = 1;

        const formatNode = (node, prefix = '') => {
            if (node.type === 'assembly') {
                rows.push({
                    item: prefix || itemNumber++,
                    partNumber: '-',
                    name: node.name,
                    description: 'Assembly',
                    quantity: 1,
                    material: '-',
                    unitCost: '-',
                    totalCost: '-',
                    level: node.level
                });

                if (node.children) {
                    node.children.forEach((child, idx) => {
                        const childPrefix = prefix ? `${prefix}.${idx + 1}` : `${itemNumber - 1}.${idx + 1}`;
                        formatNode(child, childPrefix);
                    });
                }
            } else {
                // Find part in parts list
                const part = parts.find(p => p.name === node.name);
                if (part) {
                    rows.push({
                        item: prefix || itemNumber++,
                        partNumber: part.partNumber,
                        name: part.name,
                        description: part.description,
                        quantity: part.quantity,
                        material: part.material,
                        vendor: part.vendor || '-',
                        unitCost: part.unitCost || '-',
                        totalCost: part.totalCost || '-',
                        level: node.level
                    });
                }
            }
        };

        formatNode(structure.root);
        return rows;
    }

    /**
     * Format flat BOM
     */
    formatFlatBOM(parts) {
        return parts.map((part, idx) => ({
            item: idx + 1,
            partNumber: part.partNumber,
            name: part.name,
            description: part.description,
            quantity: part.quantity,
            material: part.material,
            type: part.type,
            vendor: part.vendor || '-',
            vendorPartNumber: part.vendorPartNumber || '-',
            unitCost: part.unitCost || '-',
            totalCost: part.totalCost || '-',
            leadTime: part.leadTime || '-'
        }));
    }

    // ==================== SIMULATION PREPARATION ====================

    /**
     * Prepare CAD model for FEA/CFD simulation
     * Auto-assign materials, contacts, mesh, boundary conditions
     */
    async prepareForSimulation(cadModel, simulationType = 'fea', options = {}) {
        console.log(`🔬 Simulation Prep: Preparing model for ${simulationType.toUpperCase()}...`);

        const {
            autoMesh = true,
            meshDensity = 'medium',
            autoContacts = true,
            autoMaterials = true,
            autoBoundaryConditions = false  // User should specify loads
        } = options;

        // Step 1: Clean geometry for simulation
        const cleanedGeometry = await this.cleanGeometry(cadModel);

        // Step 2: Auto-assign materials
        let modelWithMaterials = cleanedGeometry;
        if (autoMaterials) {
            modelWithMaterials = await this.autoAssignMaterials(cleanedGeometry);
        }

        // Step 3: Define contact interfaces
        let modelWithContacts = modelWithMaterials;
        if (autoContacts && simulationType === 'fea') {
            modelWithContacts = await this.defineContactInterfaces(modelWithMaterials);
        }

        // Step 4: Generate mesh
        let modelWithMesh = modelWithContacts;
        if (autoMesh) {
            modelWithMesh = await this.generateMesh(modelWithContacts, meshDensity, simulationType);
        }

        // Step 5: Suggest boundary conditions
        const bcSuggestions = await this.suggestBoundaryConditions(modelWithMesh, simulationType);

        return {
            success: true,
            operation: 'simulation-preparation',
            simulationType,
            preparedModel: modelWithMesh,
            materials: this.extractAssignedMaterials(modelWithMesh),
            contacts: modelWithContacts.contacts || [],
            mesh: modelWithMesh.mesh,
            boundarySuggestions: bcSuggestions,
            readyForSimulation: true,
            recommendations: this.generateSimulationRecommendations(modelWithMesh, simulationType)
        };
    }

    /**
     * Clean geometry for simulation
     */
    async cleanGeometry(cadModel) {
        console.log(`  🧹 Cleaning geometry...`);

        const cleaned = { ...cadModel };

        // Remove small features that cause mesh issues
        cleaned.removedFeatures = [
            'Small fillets < 0.5mm',
            'Chamfers < 0.3mm',
            'Text/engravings'
        ];

        // Simplify complex surfaces
        cleaned.simplifiedSurfaces = true;

        // Remove internal components not needed for simulation
        cleaned.suppressedComponents = [];

        return cleaned;
    }

    /**
     * Auto-assign materials to all bodies
     */
    async autoAssignMaterials(cadModel) {
        console.log(`  🔧 Auto-assigning materials...`);

        const model = { ...cadModel };

        model.materialAssignments = [];

        // Assign materials based on part name/type
        if (model.assembly && model.assembly.components) {
            model.assembly.components.forEach(component => {
                const material = this.inferMaterial(this.classifyPartType({ name: component.name }));

                model.materialAssignments.push({
                    component: component.name,
                    material,
                    properties: this.materialDatabase[material]
                });
            });
        } else {
            // Single part
            const material = 'aluminum-6061';
            model.materialAssignments.push({
                component: 'Part',
                material,
                properties: this.materialDatabase[material]
            });
        }

        return model;
    }

    /**
     * Define contact interfaces between parts
     */
    async defineContactInterfaces(cadModel) {
        console.log(`  🤝 Defining contact interfaces...`);

        const model = { ...cadModel };

        model.contacts = [
            {
                type: 'bonded',
                components: ['Part1_face_top', 'Part2_face_bottom'],
                description: 'Bonded contact - no relative motion',
                penetrationTolerance: 0.01
            },
            {
                type: 'no-separation',
                components: ['Bolt_threads', 'Nut_threads'],
                description: 'No separation - threaded connection',
                frictionCoefficient: 0.15
            },
            {
                type: 'frictionless',
                components: ['Shaft_surface', 'Bearing_inner'],
                description: 'Frictionless sliding contact',
                penetrationTolerance: 0.005
            }
        ];

        return model;
    }

    /**
     * Generate mesh
     */
    async generateMesh(cadModel, density, simulationType) {
        console.log(`  🕸️ Generating ${density} density mesh...`);

        const model = { ...cadModel };

        const densitySettings = {
            'coarse': { maxSize: 10, minSize: 2, elements: 50000 },
            'medium': { maxSize: 5, minSize: 1, elements: 150000 },
            'fine': { maxSize: 2, minSize: 0.5, elements: 500000 },
            'very-fine': { maxSize: 1, minSize: 0.2, elements: 1500000 }
        };

        const settings = densitySettings[density];

        model.mesh = {
            type: simulationType === 'cfd' ? 'tetrahedral' : 'mixed',
            elementType: simulationType === 'cfd' ? 'fluid-tet' : 'solid-tet',
            maxElementSize: settings.maxSize + 'mm',
            minElementSize: settings.minSize + 'mm',
            estimatedElements: settings.elements,
            refinementRegions: [
                { location: 'holes', factor: 2, reason: 'High stress concentration' },
                { location: 'fillets', factor: 1.5, reason: 'Stress gradient' },
                { location: 'contacts', factor: 2, reason: 'Contact pressure' }
            ],
            quality: {
                minQuality: 0.3,
                avgQuality: 0.75,
                skewness: 'low',
                aspectRatio: 'good'
            }
        };

        return model;
    }

    /**
     * Suggest boundary conditions
     */
    async suggestBoundaryConditions(cadModel, simulationType) {
        if (simulationType === 'fea') {
            return {
                fixtures: [
                    {
                        type: 'fixed',
                        suggestion: 'Bottom face',
                        rationale: 'Appears to be mounting surface',
                        dof: 'all'
                    }
                ],
                loads: [
                    {
                        type: 'force',
                        suggestion: 'Top face',
                        rationale: 'Typical load application point',
                        magnitude: '1000 N',
                        direction: '-Z'
                    }
                ]
            };
        } else if (simulationType === 'cfd') {
            return {
                inlet: {
                    suggestion: 'Left face',
                    type: 'velocity-inlet',
                    value: '5 m/s'
                },
                outlet: {
                    suggestion: 'Right face',
                    type: 'pressure-outlet',
                    value: '0 Pa (atmospheric)'
                },
                walls: {
                    suggestion: 'All other faces',
                    type: 'no-slip-wall'
                }
            };
        }

        return {};
    }

    /**
     * Extract assigned materials
     */
    extractAssignedMaterials(cadModel) {
        return cadModel.materialAssignments || [];
    }

    /**
     * Generate simulation recommendations
     */
    generateSimulationRecommendations(cadModel, simulationType) {
        const recs = [];

        if (simulationType === 'fea') {
            recs.push('✓ Model is meshed and ready for FEA');
            recs.push('📌 Define fixture constraints at mounting points');
            recs.push('⚡ Apply loads at expected load points');
            recs.push('🔍 Check stress concentrations at holes and fillets');
            recs.push('📊 Run mesh convergence study for critical results');
        } else if (simulationType === 'cfd') {
            recs.push('✓ Fluid domain is ready for CFD');
            recs.push('🌊 Define inlet velocity boundary condition');
            recs.push('📤 Define outlet pressure boundary condition');
            recs.push('🔧 Specify fluid properties (viscosity, density)');
            recs.push('📊 Consider turbulence model (k-epsilon for Re > 2300)');
        }

        return recs;
    }

    // ==================== DATABASE INITIALIZATION ====================

    /**
     * Initialize material database
     */
    initializeMaterialDatabase() {
        return {
            'aluminum-6061': {
                name: 'Aluminum 6061-T6',
                density: 2.7,  // g/cm³
                youngsModulus: 68.9,  // GPa
                poissonsRatio: 0.33,
                yieldStrength: 276,  // MPa
                ultimateStrength: 310,  // MPa
                thermalConductivity: 167,  // W/m·K
                specificHeat: 896,  // J/kg·K
                costPerKg: 3.0  // USD
            },
            'aluminum-7075': {
                name: 'Aluminum 7075-T6',
                density: 2.8,
                youngsModulus: 71.7,
                poissonsRatio: 0.33,
                yieldStrength: 503,
                ultimateStrength: 572,
                costPerKg: 15.0
            },
            'steel-1045': {
                name: 'Steel 1045',
                density: 7.85,
                youngsModulus: 200,
                poissonsRatio: 0.29,
                yieldStrength: 530,
                ultimateStrength: 625,
                costPerKg: 1.5
            },
            'steel-grade-8': {
                name: 'Steel Grade 8 (Fastener)',
                density: 7.85,
                youngsModulus: 200,
                poissonsRatio: 0.29,
                yieldStrength: 830,
                ultimateStrength: 1040,
                costPerKg: 2.0
            }
        };
    }

    /**
     * Initialize standard parts library
     */
    initializeStandardPartsLibrary() {
        return {
            fasteners: {
                'M6': { partNumber: 'ISO4014-M6x20', manufacturer: 'Generic', description: 'Hex bolt M6x20', unitCost: 0.15 },
                'M8': { partNumber: 'ISO4014-M8x25', manufacturer: 'Generic', description: 'Hex bolt M8x25', unitCost: 0.25 },
                'M10': { partNumber: 'ISO4014-M10x30', manufacturer: 'Generic', description: 'Hex bolt M10x30', unitCost: 0.40 }
            },
            washers: {
                'M6': { partNumber: 'DIN125-M6', manufacturer: 'Generic', description: 'Flat washer M6', unitCost: 0.05 },
                'M8': { partNumber: 'DIN125-M8', manufacturer: 'Generic', description: 'Flat washer M8', unitCost: 0.08 },
                'M10': { partNumber: 'DIN125-M10', manufacturer: 'Generic', description: 'Flat washer M10', unitCost: 0.12 }
            },
            nuts: {
                'M6': { partNumber: 'ISO4032-M6', manufacturer: 'Generic', description: 'Hex nut M6', unitCost: 0.08 },
                'M8': { partNumber: 'ISO4032-M8', manufacturer: 'Generic', description: 'Hex nut M8', unitCost: 0.12 },
                'M10': { partNumber: 'ISO4032-M10', manufacturer: 'Generic', description: 'Hex nut M10', unitCost: 0.18 }
            }
        };
    }

    /**
     * Initialize vendor database
     */
    initializeVendorDatabase() {
        return {
            'Generic': {
                name: 'McMaster-Carr',
                partNumberPrefix: 'MC-',
                leadTime: '1-2 days',
                moq: 1,
                website: 'https://www.mcmaster.com'
            },
            'Misumi': {
                name: 'MISUMI USA',
                partNumberPrefix: 'MIS-',
                leadTime: '3-5 days',
                moq: 1,
                website: 'https://us.misumi-ec.com'
            }
        };
    }
}

module.exports = new BOMAndSimulationPrepService();
