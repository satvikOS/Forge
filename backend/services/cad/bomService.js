/**
 * Bill of Materials (BOM) Generation Service
 * Hierarchical/flat BOMs, Excel export, cost integration, configuration-specific
 */

const bedrockService = require('../bedrockService');

class BOMService {
    constructor() {
        this.bomTemplates = this._initializeTemplates();
    }

    /**
     * Initialize BOM templates
     */
    _initializeTemplates() {
        return {
            standard: ['item', 'partNumber', 'description', 'quantity', 'material', 'unitCost', 'totalCost'],
            detailed: ['item', 'partNumber', 'description', 'quantity', 'material', 'finish', 'vendor', 'leadTime', 'unitCost', 'totalCost'],
            procurement: ['partNumber', 'description', 'vendor', 'vendorPartNumber', 'quantity', 'unitCost', 'totalCost', 'leadTime']
        };
    }

    /**
     * Generate hierarchical BOM from assembly
     */
    async generateHierarchicalBOM(assemblyData, options = {}) {
        const {
            includeStandardParts = true,
            includeFasteners = true,
            template = 'standard',
            configuration = null
        } = options;

        console.log(`📋 Generating hierarchical BOM for ${assemblyData.name}...`);

        const bom = {
            assemblyName: assemblyData.name,
            configuration: configuration || 'default',
            type: 'hierarchical',
            date: new Date().toISOString(),
            items: [],
            totalCost: 0,
            totalParts: 0
        };

        // Build hierarchy
        const hierarchy = this._buildHierarchy(assemblyData, 1, includeStandardParts, includeFasteners);

        bom.items = hierarchy.items;
        bom.totalCost = hierarchy.totalCost;
        bom.totalParts = hierarchy.totalParts;

        console.log(`✅ Hierarchical BOM generated: ${bom.totalParts} parts, $${bom.totalCost.toFixed(2)}`);

        return bom;
    }

    /**
     * Generate flat BOM (single-level, rolled-up quantities)
     */
    async generateFlatBOM(assemblyData, options = {}) {
        const {
            includeStandardParts = true,
            includeFasteners = true,
            template = 'standard',
            configuration = null
        } = options;

        console.log(`📋 Generating flat BOM for ${assemblyData.name}...`);

        const bom = {
            assemblyName: assemblyData.name,
            configuration: configuration || 'default',
            type: 'flat',
            date: new Date().toISOString(),
            items: [],
            totalCost: 0,
            totalParts: 0
        };

        // Flatten and roll up quantities
        const partMap = new Map();

        this._flattenAssembly(assemblyData, partMap, 1, includeStandardParts, includeFasteners);

        // Convert to array
        let itemNumber = 1;
        partMap.forEach((data, partId) => {
            bom.items.push({
                item: itemNumber++,
                partNumber: data.partNumber || partId,
                description: data.description || data.name,
                quantity: data.quantity,
                material: data.material || 'N/A',
                unitCost: data.unitCost || 0,
                totalCost: (data.unitCost || 0) * data.quantity,
                vendor: data.vendor || 'Internal',
                finish: data.finish || 'As machined'
            });

            bom.totalCost += (data.unitCost || 0) * data.quantity;
            bom.totalParts += data.quantity;
        });

        // Sort by item number
        bom.items.sort((a, b) => a.item - b.item);

        console.log(`✅ Flat BOM generated: ${bom.items.length} unique parts, ${bom.totalParts} total, $${bom.totalCost.toFixed(2)}`);

        return bom;
    }

    /**
     * Export BOM to Excel/CSV
     */
    async exportBOM(bom, format = 'csv') {
        console.log(`💾 Exporting BOM to ${format.toUpperCase()}...`);

        let exported = '';

        if (format === 'csv') {
            exported = this._exportToCSV(bom);
        } else if (format === 'excel') {
            exported = this._exportToExcel(bom);
        }

        console.log(`✅ BOM exported successfully`);

        return {
            format,
            content: exported,
            filename: `BOM_${bom.assemblyName}_${Date.now()}.${format}`
        };
    }

    /**
     * Generate configuration-specific BOM
     */
    async generateConfigurationBOM(assemblyData, configurationName) {
        console.log(`🔧 Generating BOM for configuration: ${configurationName}...`);

        // Get configuration data
        const config = assemblyData.configurations?.find(c => c.name === configurationName);

        if (!config) {
            throw new Error(`Configuration '${configurationName}' not found`);
        }

        // Apply configuration parameters
        const configuredAssembly = this._applyConfiguration(assemblyData, config);

        // Generate BOM
        const bom = await this.generateHierarchicalBOM(configuredAssembly, {
            configuration: configurationName
        });

        console.log(`✅ Configuration BOM generated`);

        return bom;
    }

    /**
     * Add BOM to drawing table
     */
    addBOMToDrawing(drawingData, bom, placement = { x: 50, y: 50 }) {
        console.log(`📐 Adding BOM table to drawing...`);

        const table = {
            type: 'bom_table',
            position: placement,
            columns: ['Item', 'Part Number', 'Description', 'Qty', 'Material'],
            rows: bom.items.map(item => [
                item.item,
                item.partNumber,
                item.description,
                item.quantity,
                item.material
            ]),
            styling: {
                headerBackground: '#333',
                headerText: '#fff',
                borderColor: '#000',
                fontSize: 10
            }
        };

        if (!drawingData.tables) {
            drawingData.tables = [];
        }

        drawingData.tables.push(table);

        console.log(`✅ BOM table added to drawing`);

        return table;
    }

    /**
     * Auto-update BOM on design changes
     */
    async updateBOMOnChange(bom, assemblyData, changes) {
        console.log(`🔄 Updating BOM based on ${changes.length} design changes...`);

        const updates = {
            added: [],
            removed: [],
            quantityChanged: [],
            costChanged: []
        };

        changes.forEach(change => {
            if (change.type === 'part_added') {
                updates.added.push(change.partId);
            } else if (change.type === 'part_removed') {
                updates.removed.push(change.partId);
            } else if (change.type === 'quantity_changed') {
                updates.quantityChanged.push(change.partId);
            }
        });

        // Regenerate BOM
        const updatedBOM = await this.generateFlatBOM(assemblyData, {
            configuration: bom.configuration
        });

        console.log(`✅ BOM updated: +${updates.added.length} added, -${updates.removed.length} removed`);

        return {
            bom: updatedBOM,
            updates
        };
    }

    // Helper methods

    _buildHierarchy(assembly, level, includeStandardParts, includeFasteners) {
        const hierarchy = {
            items: [],
            totalCost: 0,
            totalParts: 0
        };

        let itemNumber = 1;

        assembly.parts?.forEach(part => {
            // Skip if configured to exclude
            if (!includeStandardParts && part.isStandardPart) return;
            if (!includeFasteners && part.isFastener) return;

            const item = {
                item: `${level}.${itemNumber++}`,
                level,
                partNumber: part.partNumber || part.id,
                description: part.description || part.name,
                quantity: part.quantity || 1,
                material: part.material || 'N/A',
                unitCost: part.unitCost || 0,
                totalCost: (part.unitCost || 0) * (part.quantity || 1)
            };

            hierarchy.items.push(item);
            hierarchy.totalCost += item.totalCost;
            hierarchy.totalParts += item.quantity;

            // Recurse for sub-assemblies
            if (part.subAssembly) {
                const subHierarchy = this._buildHierarchy(part.subAssembly, level + 1, includeStandardParts, includeFasteners);
                hierarchy.items.push(...subHierarchy.items);
                hierarchy.totalCost += subHierarchy.totalCost;
                hierarchy.totalParts += subHierarchy.totalParts;
            }
        });

        return hierarchy;
    }

    _flattenAssembly(assembly, partMap, multiplier, includeStandardParts, includeFasteners) {
        assembly.parts?.forEach(part => {
            // Skip if configured to exclude
            if (!includeStandardParts && part.isStandardPart) return;
            if (!includeFasteners && part.isFastener) return;

            const partId = part.partNumber || part.id;
            const quantity = (part.quantity || 1) * multiplier;

            if (partMap.has(partId)) {
                // Roll up quantity
                const existing = partMap.get(partId);
                existing.quantity += quantity;
            } else {
                partMap.set(partId, {
                    partNumber: part.partNumber,
                    name: part.name,
                    description: part.description,
                    quantity,
                    material: part.material,
                    unitCost: part.unitCost,
                    vendor: part.vendor,
                    finish: part.finish
                });
            }

            // Recurse for sub-assemblies
            if (part.subAssembly) {
                this._flattenAssembly(part.subAssembly, partMap, quantity, includeStandardParts, includeFasteners);
            }
        });
    }

    _exportToCSV(bom) {
        let csv = 'Item,Part Number,Description,Quantity,Material,Unit Cost,Total Cost\n';

        bom.items.forEach(item => {
            csv += `${item.item},${item.partNumber},"${item.description}",${item.quantity},${item.material},${item.unitCost},${item.totalCost}\n`;
        });

        csv += `\nTotal Parts:,${bom.totalParts}\n`;
        csv += `Total Cost:,$${bom.totalCost.toFixed(2)}\n`;

        return csv;
    }

    _exportToExcel(bom) {
        // Simplified Excel export (would use a library like xlsx in production)
        return this._exportToCSV(bom); // Placeholder
    }

    _applyConfiguration(assemblyData, config) {
        // Apply configuration parameters to assembly
        const configured = JSON.parse(JSON.stringify(assemblyData));

        config.parameters?.forEach(param => {
            // Apply parameter changes
            if (param.type === 'suppress' && param.value === true) {
                configured.parts = configured.parts.filter(p => p.id !== param.targetId);
            }
        });

        return configured;
    }
}

module.exports = new BOMService();
