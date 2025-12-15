/**
 * Bill of Materials (BOM) Service
 * Generates comprehensive BOM for manufacturing
 */

class BOMService {
    constructor() {
        this.bomFormats = ['csv', 'excel', 'pdf', 'json'];
    }

    /**
     * Generate Bill of Materials
     */
    async generateBOM(projectData, options = {}) {
        const {
            format = 'csv',
            includePricing = true,
            includeSuppliers = true,
            groupByCategory = true
        } = options;

        console.log('📊 Generating Bill of Materials...');

        // Extract components from project
        const components = this.extractComponents(projectData);

        // Group and organize
        const organized = groupByCategory
            ? this.groupByCategory(components)
            : components;

        // Add pricing if requested
        if (includePricing) {
            await this.addPricingInfo(organized);
        }

        // Add supplier info if requested
        if (includeSuppliers) {
            await this.addSupplierInfo(organized);
        }

        // Calculate totals
        const totals = this.calculateTotals(organized);

        console.log(`✅ BOM generated`);
        console.log(`   Total items: ${components.length}`);
        console.log(`   Total cost: $${totals.totalCost.toFixed(2)}`);

        const bom = {
            components: organized,
            totals,
            metadata: {
                projectName: projectData.name,
                generatedAt: new Date().toISOString(),
                format
            }
        };

        // Export in requested format
        return this.exportBOM(bom, format);
    }

    /**
     * Extract components from project data
     */
    extractComponents(projectData) {
        const components = [];

        // From 3D models
        if (projectData.models) {
            projectData.models.forEach(model => {
                components.push({
                    category: 'Mechanical Parts',
                    partNumber: model.partNumber || `PART-${components.length + 1}`,
                    description: model.name || 'Custom Part',
                    quantity: model.quantity || 1,
                    material: model.material || 'Unknown',
                    manufacturing: model.manufacturing || 'CNC Machining',
                    unitCost: 0,
                    totalCost: 0
                });
            });
        }

        // From PCB components
        if (projectData.pcbComponents) {
            projectData.pcbComponents.forEach(comp => {
                components.push({
                    category: 'Electronics',
                    partNumber: comp.mpn || comp.value,
                    description: `${comp.type} ${comp.value}`,
                    quantity: comp.quantity || 1,
                    footprint: comp.footprint,
                    manufacturer: comp.manufacturer,
                    unitCost: 0,
                    totalCost: 0
                });
            });
        }

        // Hardware (screws, nuts, etc.)
        if (projectData.hardware) {
            projectData.hardware.forEach(hw => {
                components.push({
                    category: 'Hardware',
                    partNumber: hw.partNumber,
                    description: hw.description,
                    quantity: hw.quantity,
                    unitCost: hw.unitCost || 0,
                    totalCost: (hw.quantity * (hw.unitCost || 0))
                });
            });
        }

        return components;
    }

    /**
     * Group components by category
     */
    groupByCategory(components) {
        const grouped = {};

        components.forEach(comp => {
            const category = comp.category || 'Other';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(comp);
        });

        return grouped;
    }

    /**
     * Add pricing information
     */
    async addPricingInfo(components) {
        // Simplified pricing (in production: integrate with supplier APIs)
        const prices = {
            'Aluminum 6061': 15.0, // per kg
            'Steel 1045': 8.0,
            'ABS Plastic': 25.0,
            'Resistor': 0.02,
            'Capacitor': 0.05,
            'IC': 2.50,
            'Screw M3': 0.10
        };

        const updatePrice = (comp) => {
            // Estimate based on material or type
            if (comp.material && prices[comp.material]) {
                comp.unitCost = prices[comp.material] * (comp.weight || 0.1);
            } else if (comp.type && prices[comp.type]) {
                comp.unitCost = prices[comp.type];
            } else {
                comp.unitCost = 1.0; // Default
            }
            comp.totalCost = comp.unitCost * comp.quantity;
        };

        if (Array.isArray(components)) {
            components.forEach(updatePrice);
        } else {
            Object.values(components).forEach(category => {
                category.forEach(updatePrice);
            });
        }
    }

    /**
     * Add supplier information
     */
    async addSupplierInfo(components) {
        // Simplified (in production: use supplier databases like Octopart, Digi-Key API)
        const suppliers = {
            'Mechanical Parts': 'McMaster-Carr',
            'Electronics': 'Digi-Key',
            'Hardware': 'Fastenal'
        };

        const addSupplier = (comp) => {
            comp.supplier = suppliers[comp.category] || 'To be determined';
            comp.leadTime = Math.floor(Math.random() * 14) + 1; // 1-14 days
        };

        if (Array.isArray(components)) {
            components.forEach(addSupplier);
        } else {
            Object.values(components).forEach(category => {
                category.forEach(addSupplier);
            });
        }
    }

    /**
     * Calculate BOM totals
     */
    calculateTotals(components) {
        let totalCost = 0;
        let totalQuantity = 0;
        let uniqueParts = 0;

        const processComponent = (comp) => {
            totalCost += comp.totalCost || 0;
            totalQuantity += comp.quantity || 0;
            uniqueParts++;
        };

        if (Array.isArray(components)) {
            components.forEach(processComponent);
        } else {
            Object.values(components).forEach(category => {
                category.forEach(processComponent);
            });
        }

        return {
            totalCost,
            totalQuantity,
            uniqueParts
        };
    }

    /**
     * Export BOM in various formats
     */
    exportBOM(bom, format) {
        switch (format) {
            case 'csv':
                return this.exportAsCSV(bom);
            case 'json':
                return JSON.stringify(bom, null, 2);
            case 'excel':
                return this.exportAsExcel(bom);
            case 'pdf':
                return this.exportAsPDF(bom);
            default:
                return this.exportAsCSV(bom);
        }
    }

    /**
     * Export as CSV
     */
    exportAsCSV(bom) {
        let csv = 'Category,Part Number,Description,Quantity,Unit Cost,Total Cost,Supplier,Lead Time\n';

        const components = bom.components;

        if (Array.isArray(components)) {
            components.forEach(comp => {
                csv += this.componentToCSVRow(comp);
            });
        } else {
            Object.entries(components).forEach(([category, items]) => {
                items.forEach(comp => {
                    comp.category = category;
                    csv += this.componentToCSVRow(comp);
                });
            });
        }

        // Add totals
        csv += `\nTotals,,,${bom.totals.totalQuantity},$${bom.totals.totalCost.toFixed(2)}\n`;

        return csv;
    }

    componentToCSVRow(comp) {
        return `${comp.category},${comp.partNumber},"${comp.description}",${comp.quantity},$${comp.unitCost?.toFixed(2) || '0.00'},$${comp.totalCost?.toFixed(2) || '0.00'},${comp.supplier || ''},${comp.leadTime || ''}\n`;
    }

    /**
     * Export as Excel (simplified - returns CSV for now)
     */
    exportAsExcel(bom) {
        // In production: use library like exceljs
        return this.exportAsCSV(bom);
    }

    /**
     * Export as PDF (simplified)
     */
    exportAsPDF(bom) {
        // In production: use library like pdfkit
        return `PDF BOM for ${bom.metadata.projectName} (${bom.totals.uniqueParts} items, $${bom.totals.totalCost.toFixed(2)})`;
    }
}

module.exports = new BOMService();
