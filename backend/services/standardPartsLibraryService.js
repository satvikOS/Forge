/**
 * Standard Parts Library Service
 * Provides access to industry-standard components (fasteners, bearings, etc.)
 * Similar to McMaster-Carr, TraceParts, and CADblocksfree libraries
 */

class StandardPartsLibraryService {
    constructor() {
        this.partsLibrary = this.initializePartsLibrary();
        this.categories = ['fasteners', 'bearings', 'gears', 'springs', 'motors', 'hydraulics', 'pneumatics'];
    }

    initializePartsLibrary() {
        return {
            'M6x1.0-hex-bolt': {
                partNumber: 'ISO4017-M6x20',
                name: 'Hex Head Bolt M6 x 20mm',
                category: 'fasteners',
                subcategory: 'bolts',
                standard: 'ISO 4017',
                size: 'M6 x 20',
                material: 'Steel Grade 8.8',
                finish: 'Zinc Plated',
                supplier: 'McMaster-Carr',
                supplierPN: '92290A114',
                price: 0.15,
                stock: 'In Stock',
                cad3DModel: 'models/fasteners/iso4017-m6x20.step'
            },
            'bearing-6200': {
                partNumber: '6200-2RS',
                name: 'Deep Groove Ball Bearing 6200 2RS',
                category: 'bearings',
                subcategory: 'ball-bearings',
                standard: 'ISO 15',
                innerDiameter: 10,
                outerDiameter: 30,
                width: 9,
                dynamicLoad: 5070,
                staticLoad: 2380,
                maxSpeed: 20000,
                supplier: 'SKF',
                supplierPN: '6200-2RS1',
                price: 3.50,
                stock: 'In Stock',
                cad3DModel: 'models/bearings/6200-2rs.step'
            }
        };
    }

    async searchParts(spec) {
        const { query, category, filters = {} } = spec;
        
        const results = Object.values(this.partsLibrary).filter(part => {
            if (category && part.category !== category) return false;
            if (query && !part.name.toLowerCase().includes(query.toLowerCase())) return false;
            return true;
        });

        return {
            success: true,
            query,
            resultsCount: results.length,
            results: results.slice(0, 20),
            categories: this.categories
        };
    }

    async getPartDetails(partNumber) {
        const part = this.partsLibrary[partNumber];
        
        if (!part) {
            return { success: false, error: 'Part not found' };
        }

        return {
            success: true,
            part,
            relatedParts: this.findRelatedParts(part),
            specifications: this.generateSpecSheet(part),
            pricing: this.getPricingInfo(part)
        };
    }

    async insertPart(spec) {
        const { partNumber, position, orientation } = spec;
        
        return {
            success: true,
            partNumber,
            instanceId: 'inst_' + Date.now(),
            position,
            orientation,
            message: 'Standard part inserted into assembly'
        };
    }

    findRelatedParts(part) {
        return [
            { partNumber: 'M6x1.0-hex-nut', name: 'Hex Nut M6', similarity: 95 },
            { partNumber: 'M6x1.0-washer', name: 'Flat Washer M6', similarity: 90 }
        ];
    }

    generateSpecSheet(part) {
        return {
            dimensions: { length: 20, diameter: 6, headHeight: 4 },
            weight: '2.5g',
            material: part.material,
            finish: part.finish,
            torqueSpec: '10 Nm'
        };
    }

    getPricingInfo(part) {
        return {
            unitPrice: part.price,
            qty1_9: part.price,
            qty10_49: part.price * 0.9,
            qty50_99: part.price * 0.8,
            qty100plus: part.price * 0.7
        };
    }
}

module.exports = new StandardPartsLibraryService();
