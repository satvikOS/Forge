/**
 * Drawing Engine - 2D Drawing Generation from 3D CAD Models
 * Generates manufacturing-ready technical drawings with projections, dimensions, and annotations
 */

class DrawingEngine {
    constructor() {
        this.drawings = new Map();
        this.viewCounter = 0;
        this.dimensionCounter = 0;
    }

    /**
     * Create a new drawing from a 3D model
     */
    createDrawing(model, options = {}) {
        const drawing = {
            id: this.generateDrawingId(),
            modelId: model.id,
            sheetSize: options.sheetSize || 'A3',
            scale: options.scale || 1.0,
            standard: options.standard || 'ISO', // ISO, ANSI, DIN
            units: options.units || 'mm',
            views: [],
            dimensions: [],
            annotations: [],
            titleBlock: this.createDefaultTitleBlock(options),
            metadata: {
                partName: model.name || 'Untitled Part',
                partNumber: options.partNumber || 'XXX-001',
                material: model.material || 'Not specified',
                revision: options.revision || 'A',
                drawnBy: options.drawnBy || 'System',
                checkedBy: options.checkedBy || '',
                createdAt: new Date().toISOString()
            }
        };

        this.drawings.set(drawing.id, drawing);
        return drawing;
    }

    /**
     * Add a projection view to the drawing
     */
    addView(drawing, viewType, position, scale = 1.0) {
        const view = {
            id: `view_${this.viewCounter++}`,
            type: viewType, // 'front', 'top', 'right', 'iso', 'section', 'detail'
            position: position, // {x, y} on sheet
            scale: scale,
            projection: null,
            hidden: true // Show hidden lines
        };

        // Generate the projection
        const model = this.getModel(drawing.modelId);
        view.projection = this.generateProjection(model, viewType);

        drawing.views.push(view);
        return view;
    }

    /**
     * Generate 2D projection from 3D model
     */
    generateProjection(model, viewType) {
        const viewDirections = {
            'front': { x: 0, y: 0, z: 1 },    // Looking along +Z
            'top': { x: 0, y: -1, z: 0 },     // Looking along -Y
            'right': { x: -1, y: 0, z: 0 },   // Looking along -X
            'back': { x: 0, y: 0, z: -1 },
            'bottom': { x: 0, y: 1, z: 0 },
            'left': { x: 1, y: 0, z: 0 },
            'iso': { x: -1, y: -1, z: 1 }     // Isometric
        };

        const direction = viewDirections[viewType] || viewDirections.front;

        const projection = {
            viewDirection: direction,
            edges: [],
            vertices: [],
            hiddenEdges: [],
            boundingBox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
        };

        // Project 3D geometry to 2D
        if (model.geometry && model.geometry.vertices) {
            projection.vertices = this.projectVertices(model.geometry.vertices, direction);
            projection.edges = this.projectEdges(model.geometry.edges, projection.vertices);
            projection.hiddenEdges = this.calculateHiddenLines(projection.edges, direction);
            projection.boundingBox = this.calculateBoundingBox(projection.vertices);
        }

        return projection;
    }

    /**
     * Project 3D vertices to 2D
     */
    projectVertices(vertices3D, viewDirection) {
        const vertices2D = [];

        for (const v of vertices3D) {
            // Simple orthographic projection
            // Choose projection plane based on view direction
            let x, y;

            if (Math.abs(viewDirection.z) > 0.9) {
                // Front/Back view (XY plane)
                x = v.x;
                y = v.y;
            } else if (Math.abs(viewDirection.y) > 0.9) {
                // Top/Bottom view (XZ plane)
                x = v.x;
                y = v.z;
            } else if (Math.abs(viewDirection.x) > 0.9) {
                // Left/Right view (YZ plane)
                x = v.y;
                y = v.z;
            } else {
                // Isometric or custom direction
                x = v.x - v.z * 0.5;
                y = v.y + v.z * 0.866;
            }

            vertices2D.push({ x, y, originalIndex: v.index });
        }

        return vertices2D;
    }

    /**
     * Project edges
     */
    projectEdges(edges3D, vertices2D) {
        const edges2D = [];

        for (const edge of edges3D) {
            const v1 = vertices2D.find(v => v.originalIndex === edge.start);
            const v2 = vertices2D.find(v => v.originalIndex === edge.end);

            if (v1 && v2) {
                edges2D.push({
                    start: { x: v1.x, y: v1.y },
                    end: { x: v2.x, y: v2.y },
                    type: edge.type || 'solid' // solid, hidden, centerline
                });
            }
        }

        return edges2D;
    }

    /**
     * Calculate hidden lines (simplified)
     */
    calculateHiddenLines(edges, viewDirection) {
        // Simplified: In production, would use Z-buffer or BSP tree
        const hiddenEdges = [];

        for (const edge of edges) {
            // Check if edge should be hidden based on face normals
            // This is a placeholder - real implementation would be more sophisticated
            if (Math.random() > 0.7) { // Temporary placeholder
                hiddenEdges.push(edge);
            }
        }

        return hiddenEdges;
    }

    /**
     * Calculate 2D bounding box
     */
    calculateBoundingBox(vertices) {
        if (vertices.length === 0) {
            return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
        }

        const box = {
            min: { x: Infinity, y: Infinity },
            max: { x: -Infinity, y: -Infinity }
        };

        for (const v of vertices) {
            box.min.x = Math.min(box.min.x, v.x);
            box.min.y = Math.min(box.min.y, v.y);
            box.max.x = Math.max(box.max.x, v.x);
            box.max.y = Math.max(box.max.y, v.y);
        }

        return box;
    }

    /**
     * Add linear dimension
     */
    addLinearDimension(drawing, viewId, point1, point2, offset = 10, options = {}) {
        const dimension = {
            id: `dim_${this.dimensionCounter++}`,
            type: 'linear',
            viewId: viewId,
            point1: point1,
            point2: point2,
            offset: offset,
            value: this.calculateDistance(point1, point2),
            text: options.text || null, // Override text if provided
            tolerance: options.tolerance || null,
            style: options.style || 'standard'
        };

        drawing.dimensions.push(dimension);
        return dimension;
    }

    /**
     * Add radial dimension (radius or diameter)
     */
    addRadialDimension(drawing, viewId, center, point, options = {}) {
        const radius = this.calculateDistance(center, point);

        const dimension = {
            id: `dim_${this.dimensionCounter++}`,
            type: options.isDiameter ? 'diameter' : 'radius',
            viewId: viewId,
            center: center,
            point: point,
            value: options.isDiameter ? radius * 2 : radius,
            text: options.text || null,
            style: options.style || 'standard'
        };

        drawing.dimensions.push(dimension);
        return dimension;
    }

    /**
     * Add angular dimension
     */
    addAngularDimension(drawing, viewId, vertex, line1End, line2End, options = {}) {
        const angle = this.calculateAngle(vertex, line1End, line2End);

        const dimension = {
            id: `dim_${this.dimensionCounter++}`,
            type: 'angular',
            viewId: viewId,
            vertex: vertex,
            line1End: line1End,
            line2End: line2End,
            value: angle,
            text: options.text || `${angle.toFixed(1)}°`,
            style: options.style || 'standard'
        };

        drawing.dimensions.push(dimension);
        return dimension;
    }

    /**
     * Auto-place dimensions using AI/heuristics
     */
    autoPlaceDimensions(drawing, viewId) {
        const view = drawing.views.find(v => v.id === viewId);
        if (!view || !view.projection) return [];

        const addedDimensions = [];
        const bbox = view.projection.boundingBox;

        // Add overall dimensions (width and height)
        const width = bbox.max.x - bbox.min.x;
        const height = bbox.max.y - bbox.min.y;

        if (width > 0) {
            const dim1 = this.addLinearDimension(
                drawing,
                viewId,
                { x: bbox.min.x, y: bbox.min.y },
                { x: bbox.max.x, y: bbox.min.y },
                -15
            );
            addedDimensions.push(dim1);
        }

        if (height > 0) {
            const dim2 = this.addLinearDimension(
                drawing,
                viewId,
                { x: bbox.max.x, y: bbox.min.y },
                { x: bbox.max.x, y: bbox.max.y },
                15
            );
            addedDimensions.push(dim2);
        }

        return addedDimensions;
    }

    /**
     * Add GD&T (Geometric Dimensioning and Tolerancing) annotation
     */
    addGDT(drawing, viewId, feature, toleranceType, value, datum = null) {
        const annotation = {
            id: `gdt_${drawing.annotations.length}`,
            type: 'gdt',
            viewId: viewId,
            feature: feature,
            toleranceType: toleranceType, // 'flatness', 'perpendicularity', 'position', etc.
            value: value,
            datum: datum,
            symbol: this.getGDTSymbol(toleranceType)
        };

        drawing.annotations.push(annotation);
        return annotation;
    }

    /**
     * Add surface finish annotation
     */
    addSurfaceFinish(drawing, viewId, edge, roughness) {
        const annotation = {
            id: `sf_${drawing.annotations.length}`,
            type: 'surfaceFinish',
            viewId: viewId,
            edge: edge,
            roughness: roughness, // Ra value in microns
            symbol: this.getSurfaceFinishSymbol(roughness)
        };

        drawing.annotations.push(annotation);
        return annotation;
    }

    /**
     * Add note with leader
     */
    addNote(drawing, text, position, leader = null) {
        const annotation = {
            id: `note_${drawing.annotations.length}`,
            type: 'note',
            text: text,
            position: position,
            leader: leader // Optional arrow pointing to feature
        };

        drawing.annotations.push(annotation);
        return annotation;
    }

    /**
     * Create section view
     */
    createSectionView(drawing, model, sectionPlane, position, scale = 1.0) {
        const view = {
            id: `view_${this.viewCounter++}`,
            type: 'section',
            position: position,
            scale: scale,
            sectionPlane: sectionPlane,
            hatchPattern: 'ANSI31', // Standard section hatching
            projection: this.generateSectionProjection(model, sectionPlane)
        };

        drawing.views.push(view);
        return view;
    }

    /**
     * Generate section projection with hatching
     */
    generateSectionProjection(model, sectionPlane) {
        // Simplified: would use CSG operations to cut the model
        const projection = {
            cutEdges: [],
            hatchRegions: [],
            viewDirection: sectionPlane.normal
        };

        // Placeholder: real implementation would perform actual sectioning
        console.log('Section projection generated for plane:', sectionPlane);

        return projection;
    }

    /**
     * Create default title block
     */
    createDefaultTitleBlock(options) {
        return {
            standard: options.standard || 'ISO',
            size: options.sheetSize || 'A3',
            company: options.company || '',
            logo: options.logo || null,
            fields: {
                title: '',
                partNumber: '',
                material: '',
                scale: '',
                revision: '',
                drawnBy: '',
                checkedBy: '',
                approvedBy: '',
                date: new Date().toISOString().split('T')[0]
            }
        };
    }

    /**
     * Helper: Calculate distance between two points
     */
    calculateDistance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Helper: Calculate angle between two lines
     */
    calculateAngle(vertex, line1End, line2End) {
        const v1 = { x: line1End.x - vertex.x, y: line1End.y - vertex.y };
        const v2 = { x: line2End.x - vertex.x, y: line2End.y - vertex.y };

        const dot = v1.x * v2.x + v1.y * v2.y;
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

        const angle = Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
        return angle;
    }

    /**
     * Get GD&T symbol for tolerance type
     */
    getGDTSymbol(toleranceType) {
        const symbols = {
            'flatness': '⏥',
            'straightness': '⏤',
            'roundness': '○',
            'cylindricity': '⌭',
            'perpendicularity': '⊥',
            'parallelism': '∥',
            'angularity': '∠',
            'position': '⌖',
            'concentricity': '◎',
            'symmetry': '⌯'
        };

        return symbols[toleranceType] || toleranceType;
    }

    /**
     * Get surface finish symbol
     */
    getSurfaceFinishSymbol(roughness) {
        // Returns checkmark symbol with Ra value
        return `✓ Ra ${roughness}`;
    }

    /**
     * Get model by ID (placeholder - would integrate with CAD model storage)
     */
    getModel(modelId) {
        // Placeholder: In production, would fetch from database or model cache
        return {
            id: modelId,
            name: 'Test Part',
            geometry: {
                vertices: [
                    { x: 0, y: 0, z: 0, index: 0 },
                    { x: 100, y: 0, z: 0, index: 1 },
                    { x: 100, y: 50, z: 0, index: 2 },
                    { x: 0, y: 50, z: 0, index: 3 },
                    { x: 0, y: 0, z: 30, index: 4 },
                    { x: 100, y: 0, z: 30, index: 5 },
                    { x: 100, y: 50, z: 30, index: 6 },
                    { x: 0, y: 50, z: 30, index: 7 }
                ],
                edges: [
                    { start: 0, end: 1, type: 'solid' },
                    { start: 1, end: 2, type: 'solid' },
                    { start: 2, end: 3, type: 'solid' },
                    { start: 3, end: 0, type: 'solid' },
                    { start: 4, end: 5, type: 'solid' },
                    { start: 5, end: 6, type: 'solid' },
                    { start: 6, end: 7, type: 'solid' },
                    { start: 7, end: 4, type: 'solid' },
                    { start: 0, end: 4, type: 'solid' },
                    { start: 1, end: 5, type: 'solid' },
                    { start: 2, end: 6, type: 'solid' },
                    { start: 3, end: 7, type: 'solid' }
                ]
            }
        };
    }

    generateDrawingId() {
        return `drawing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = DrawingEngine;
