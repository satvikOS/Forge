/**
 * Sketch Engine for 2D CAD
 * Handles 2D sketch creation and geometric constraint solving
 */
class SketchEngine {
    constructor() {
        this.sketchIdCounter = 0;
        this.entityIdCounter = 0;
        this.constraintIdCounter = 0;
    }

    /**
     * Create a new sketch on a plane
     * @param {object} plane - Sketch plane {origin, xAxis, yAxis, normal}
     * @param {string} name - Sketch name
     * @returns {object} - Sketch container
     */
    createSketch(plane, name = null) {
        const sketch = {
            id: this.generateSketchId(),
            name: name || `Sketch_${this.sketchIdCounter}`,
            plane: plane,
            entities: [],
            constraints: [],
            dimensions: [],
            isClosed: false,
            createdAt: new Date().toISOString()
        };

        return sketch;
    }

    /**
     * Add a line to the sketch
     * @param {object} sketch - Sketch object
     * @param {object} start - Start point {x, y}
     * @param {object} end - End point {x, y}
     * @returns {object} - Line entity
     */
    createLine(sketch, start, end) {
        const line = {
            id: this.generateEntityId(),
            type: 'line',
            start: { ...start },
            end: { ...end },
            construction: false
        };

        sketch.entities.push(line);
        return line;
    }

    /**
     * Add an arc to the sketch
     * @param {object} sketch - Sketch object
     * @param {object} center - Center point {x, y}
     * @param {number} radius - Arc radius
     * @param {number} startAngle - Start angle in degrees
     * @param {number} endAngle - End angle in degrees
     * @returns {object} - Arc entity
     */
    createArc(sketch, center, radius, startAngle, endAngle) {
        const arc = {
            id: this.generateEntityId(),
            type: 'arc',
            center: { ...center },
            radius: radius,
            startAngle: startAngle,
            endAngle: endAngle,
            construction: false
        };

        sketch.entities.push(arc);
        return arc;
    }

    /**
     * Add a circle to the sketch
     * @param {object} sketch - Sketch object
     * @param {object} center - Center point {x, y}
     * @param {number} radius - Circle radius
     * @returns {object} - Circle entity
     */
    createCircle(sketch, center, radius) {
        const circle = {
            id: this.generateEntityId(),
            type: 'circle',
            center: { ...center },
            radius: radius,
            construction: false
        };

        sketch.entities.push(circle);
        return circle;
    }

    /**
     * Add a rectangle to the sketch
     * @param {object} sketch - Sketch object
     * @param {object} corner1 - First corner {x, y}
     * @param {object} corner2 - Opposite corner {x, y}
     * @returns {array} - Array of 4 line entities forming rectangle
     */
    createRectangle(sketch, corner1, corner2) {
        const lines = [
            this.createLine(sketch, corner1, { x: corner2.x, y: corner1.y }),
            this.createLine(sketch, { x: corner2.x, y: corner1.y }, corner2),
            this.createLine(sketch, corner2, { x: corner1.x, y: corner2.y }),
            this.createLine(sketch, { x: corner1.x, y: corner2.y }, corner1)
        ];

        // Add perpendicular constraints
        this.addConstraint(sketch, 'perpendicular', [lines[0].id, lines[1].id]);
        this.addConstraint(sketch, 'perpendicular', [lines[1].id, lines[2].id]);
        this.addConstraint(sketch, 'perpendicular', [lines[2].id, lines[3].id]);
        this.addConstraint(sketch, 'perpendicular', [lines[3].id, lines[0].id]);

        // Add equal length constraints
        this.addConstraint(sketch, 'equal', [lines[0].id, lines[2].id]);
        this.addConstraint(sketch, 'equal', [lines[1].id, lines[3].id]);

        return lines;
    }

    /**
     * Add a polygon to the sketch
     * @param {object} sketch - Sketch object
     * @param {array} vertices - Array of points [{x, y}, ...]
     * @returns {array} - Array of line entities
     */
    createPolygon(sketch, vertices) {
        if (vertices.length < 3) {
            throw new Error('Polygon requires at least 3 vertices');
        }

        const lines = [];
        for (let i = 0; i < vertices.length; i++) {
            const start = vertices[i];
            const end = vertices[(i + 1) % vertices.length];
            lines.push(this.createLine(sketch, start, end));
        }

        return lines;
    }

    /**
     * Add a geometric constraint to the sketch
     * @param {object} sketch - Sketch object
     * @param {string} type - Constraint type
     * @param {array} entityIds - Array of entity IDs involved
     * @param {object} options - Additional constraint parameters
     * @returns {object} - Constraint object
     */
    addConstraint(sketch, type, entityIds, options = {}) {
        const constraint = {
            id: this.generateConstraintId(),
            type: type,
            entities: entityIds,
            parameters: options,
            createdAt: new Date().toISOString()
        };

        sketch.constraints.push(constraint);
        return constraint;
    }

    /**
     * Add a dimension to the sketch
     * @param {object} sketch - Sketch object
     * @param {string} type - Dimension type ('distance', 'radius', 'angle', 'diameter')
     * @param {array} entityIds - Entity IDs to dimension
     * @param {number} value - Dimension value
     * @returns {object} - Dimension object
     */
    addDimension(sketch, type, entityIds, value) {
        const dimension = {
            id: this.generateConstraintId(),
            type: type,
            entities: entityIds,
            value: value,
            createdAt: new Date().toISOString()
        };

        sketch.dimensions.push(dimension);

        // Dimensions are driving constraints
        return this.addConstraint(sketch, `dimension_${type}`, entityIds, { value });
    }

    /**
     * Solve geometric constraints
     * Uses iterative constraint satisfaction
     * @param {object} sketch - Sketch object
     * @returns {object} - Solved sketch with updated entity positions
     */
    solveConstraints(sketch) {
        console.log(`🧮 Solving constraints for ${sketch.name}...`);

        // In a full implementation, this would use a constraint solver
        // like variational geometry solver or graph-based solver

        const maxIterations = 100;
        const tolerance = 0.001;

        for (let iteration = 0; iteration < maxIterations; iteration++) {
            let maxError = 0;

            // Process each constraint
            for (const constraint of sketch.constraints) {
                const error = this.applyConstraint(sketch, constraint);
                maxError = Math.max(maxError, error);
            }

            // Check convergence
            if (maxError < tolerance) {
                console.log(`✅ Constraints solved in ${iteration + 1} iterations`);
                sketch.solved = true;
                sketch.constraintError = maxError;
                return sketch;
            }
        }

        console.warn(`⚠️  Constraint solver did not converge (max error: ${maxError})`);
        sketch.solved = false;
        sketch.constraintError = maxError;
        return sketch;
    }

    /**
     * Apply a single constraint (simplified implementation)
     */
    applyConstraint(sketch, constraint) {
        const entities = constraint.entities.map(id =>
            sketch.entities.find(e => e.id === id)
        );

        if (!entities.every(e => e)) {
            return 0; // Entity not found
        }

        switch (constraint.type) {
            case 'horizontal':
                return this.applyHorizontalConstraint(entities[0]);

            case 'vertical':
                return this.applyVerticalConstraint(entities[0]);

            case 'parallel':
                return this.applyParallelConstraint(entities[0], entities[1]);

            case 'perpendicular':
                return this.applyPerpendicularConstraint(entities[0], entities[1]);

            case 'tangent':
                return this.applyTangentConstraint(entities[0], entities[1]);

            case 'concentric':
                return this.applyConcentricConstraint(entities[0], entities[1]);

            case 'equal':
                return this.applyEqualConstraint(entities[0], entities[1]);

            case 'dimension_distance':
                return this.applyDistanceConstraint(entities[0], entities[1], constraint.parameters.value);

            case 'dimension_radius':
                return this.applyRadiusConstraint(entities[0], constraint.parameters.value);

            default:
                return 0;
        }
    }

    /**
     * Check if sketch is fully constrained
     * @param {object} sketch - Sketch object
     * @returns {object} - DOF analysis
     */
    checkDOF(sketch) {
        // Calculate degrees of freedom
        // Each point has 2 DOF (x, y)
        // Each constraint removes 1 or more DOF

        const pointCount = this.countUniquePoints(sketch);
        const totalDOF = pointCount * 2;

        let constrainedDOF = 0;
        sketch.constraints.forEach(constraint => {
            // Different constraints remove different numbers of DOF
            switch (constraint.type) {
                case 'horizontal':
                case 'vertical':
                    constrainedDOF += 1;
                    break;
                case 'parallel':
                case 'perpendicular':
                    constrainedDOF += 1;
                    break;
                case 'coincident':
                    constrainedDOF += 2;
                    break;
                case 'dimension_distance':
                case 'dimension_radius':
                case 'dimension_angle':
                    constrainedDOF += 1;
                    break;
            }
        });

        const remainingDOF = totalDOF - constrainedDOF;

        return {
            totalDOF,
            constrainedDOF,
            remainingDOF,
            status: remainingDOF === 0 ? 'fully_constrained' :
                remainingDOF < 0 ? 'over_constrained' : 'under_constrained'
        };
    }

    /**
     * Offset a profile outward or inward
     * @param {object} sketch - Sketch with closed profile
     * @param {number} distance - Offset distance (positive = outward)
     * @returns {object} - New sketch with offset profile
     */
    offsetProfile(sketch, distance) {
        // Simplified offset
        // In full implementation, would use geometric algorithms for proper offset curves

        const offsetSketch = this.createSketch(sketch.plane, `${sketch.name}_Offset`);

        sketch.entities.forEach(entity => {
            if (entity.type === 'line') {
                // Offset line perpendicular to its direction
                const dx = entity.end.x - entity.start.x;
                const dy = entity.end.y - entity.start.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const nx = -dy / length * distance; // Normal direction
                const ny = dx / length * distance;

                this.createLine(offsetSketch,
                    { x: entity.start.x + nx, y: entity.start.y + ny },
                    { x: entity.end.x + nx, y: entity.end.y + ny }
                );
            } else if (entity.type === 'circle') {
                this.createCircle(offsetSketch, entity.center, entity.radius + distance);
            }
        });

        return offsetSketch;
    }

    /**
     * Trim profile to boundaries
     * @param {object} sketch - Sketch object
     * @param {array} boundaries - Boundary entities
     * @returns {object} - Trimmed sketch
     */
    trimProfile(sketch, boundaries) {
        console.log('✂️  Trimming profile...');
        // In full implementation, would calculate intersections and trim
        // For now, return original
        return sketch;
    }

    /**
     * Close an open path
     * @param {object} sketch - Sketch object
     * @returns {object} - Closed sketch
     */
    closePath(sketch) {
        const lines = sketch.entities.filter(e => e.type === 'line');

        if (lines.length < 2) {
            return sketch;
        }

        const firstPoint = lines[0].start;
        const lastPoint = lines[lines.length - 1].end;

        const distance = Math.sqrt(
            Math.pow(lastPoint.x - firstPoint.x, 2) +
            Math.pow(lastPoint.y - firstPoint.y, 2)
        );

        if (distance > 0.001) {
            // Add closing line
            this.createLine(sketch, lastPoint, firstPoint);
            sketch.isClosed = true;
        }

        return sketch;
    }

    // ==================== Helper Methods ====================

    generateSketchId() {
        this.sketchIdCounter++;
        return `sketch_${this.sketchIdCounter}_${Date.now()}`;
    }

    generateEntityId() {
        this.entityIdCounter++;
        return `entity_${this.entityIdCounter}`;
    }

    generateConstraintId() {
        this.constraintIdCounter++;
        return `constraint_${this.constraintIdCounter}`;
    }

    countUniquePoints(sketch) {
        const points = new Set();
        sketch.entities.forEach(entity => {
            if (entity.type === 'line') {
                points.add(`${entity.start.x},${entity.start.y}`);
                points.add(`${entity.end.x},${entity.end.y}`);
            } else if (entity.type === 'circle' || entity.type === 'arc') {
                points.add(`${entity.center.x},${entity.center.y}`);
            }
        });
        return points.size;
    }

    // Simplified constraint application methods
    applyHorizontalConstraint(line) {
        if (line.type !== 'line') return 0;
        const dy = Math.abs(line.end.y - line.start.y);
        line.end.y = line.start.y; // Force horizontal
        return dy;
    }

    applyVerticalConstraint(line) {
        if (line.type !== 'line') return 0;
        const dx = Math.abs(line.end.x - line.start.x);
        line.end.x = line.start.x; // Force vertical
        return dx;
    }

    applyParallelConstraint(line1, line2) {
        // Simplified: adjust line2 angle to match line1
        return 0;
    }

    applyPerpendicularConstraint(line1, line2) {
        // Simplified perpendicular enforcement
        return 0;
    }

    applyTangentConstraint(entity1, entity2) {
        // Tangency between circle and line or two circles
        return 0;
    }

    applyConcentricConstraint(circle1, circle2) {
        if (circle1.type !== 'circle' || circle2.type !== 'circle') return 0;
        const dx = Math.abs(circle1.center.x - circle2.center.x);
        const dy = Math.abs(circle1.center.y - circle2.center.y);
        circle2.center = { ...circle1.center };
        return Math.sqrt(dx * dx + dy * dy);
    }

    applyEqualConstraint(entity1, entity2) {
        // Make lengths/radii equal
        if (entity1.type === 'circle' && entity2.type === 'circle') {
            const diff = Math.abs(entity1.radius - entity2.radius);
            entity2.radius = entity1.radius;
            return diff;
        }
        return 0;
    }

    applyDistanceConstraint(entity1, entity2, targetDistance) {
        // Simplified distance constraint
        return 0;
    }

    applyRadiusConstraint(circle, targetRadius) {
        if (circle.type !== 'circle') return 0;
        const diff = Math.abs(circle.radius - targetRadius);
        circle.radius = targetRadius;
        return diff;
    }
}

module.exports = new SketchEngine();
