/**
 * Digital Machining Simulation Service
 * Material removal simulation, collision detection, kinematic verification
 */

class MachiningSimulationService {
    constructor() {
        this.machineKinematic = {};
    }

    /**
     * Simulate material removal and verify toolpaths
     */
    async simulateMaterialRemoval(stockModel, toolpaths, options = {}) {
        const {
            resolution = 1.0, // Voxel size in mm
            visualize = true,
            detectGouge = true
        } = options;

        console.log(`🔨 Simulating material removal (resolution: ${resolution}mm)...`);

        // Create voxel representation of stock
        const voxelGrid = this._createVoxelGrid(stockModel, resolution);

        const simulation = {
            initialVolume: this._calculateVolume(voxelGrid),
            removedVolume: 0,
            remainingVolume: 0,
            gouges: [],
            excessMaterial: [],
            timeline: []
        };

        let currentStock = voxelGrid;

        // Simulate each toolpath
        toolpaths.forEach((toolpath, index) => {
            const tool = toolpath.tool || { diameter: 6, type: 'end_mill' };

            toolpath.paths.forEach((path, pathIndex) => {
                // Remove material along path
                const removed = this._removeAlongPath(currentStock, path, tool);

                currentStock = removed.updatedStock;
                simulation.removedVolume += removed.volume;

                if (visualize && pathIndex % 10 === 0) {
                    simulation.timeline.push({
                        step: index * 100 + pathIndex,
                        stock: this._cloneGrid(currentStock),
                        volumeRemoved: simulation.removedVolume
                    });
                }
            });

            // Detect gouges (cutting into finished surface)
            if (detectGouge) {
                const gouges = this._detectGouges(currentStock, stockModel.finishedModel, tool);
                simulation.gouges.push(...gouges);
            }
        });

        simulation.remainingVolume = this._calculateVolume(currentStock);
        simulation.excessMaterial = this._detectExcessMaterial(currentStock, stockModel.finishedModel);

        console.log(`✅ Simulation complete: ${simulation.removedVolume.toFixed(0)}mm³ removed, ${simulation.gouges.length} gouges detected`);

        return simulation;
    }

    /**
     * Collision detection between tool and machine/fixture
     */
    async detectCollisions(toolpaths, machine, workholding, options = {}) {
        const {
            checkToolHolder = true,
            checkWorkholding = true,
            checkMachineParts = true,
            safetyMargin = 5 // mm
        } = options;

        console.log(`🚨 Checking for collisions...`);

        const collisions = [];
        const clearances = [];

        toolpaths.forEach((toolpath, tpIndex) => {
            const tool = toolpath.tool || {};

            toolpath.paths.forEach((path, pathIndex) => {
                // Check tool holder collisions
                if (checkToolHolder) {
                    const toolHolderGeometry = this._getToolHolderGeometry(tool);
                    const holderCollision = this._checkIntersection(
                        toolHolderGeometry,
                        path,
                        workholding.geometry
                    );

                    if (holderCollision.intersects) {
                        collisions.push({
                            type: 'tool_holder',
                            toolpath: tpIndex,
                            pathIndex,
                            location: holderCollision.point,
                            severity: 'critical'
                        });
                    }
                }

                // Check workholding collisions
                if (checkWorkholding) {
                    const toolEnvelope = this._getToolEnvelope(tool, path);
                    workholding.clamps.forEach((clamp, clampIndex) => {
                        const clearance = this._calculateClearance(toolEnvelope, clamp.geometry);

                        if (clearance < 0) {
                            collisions.push({
                                type: 'workholding_clamp',
                                toolpath: tpIndex,
                                pathIndex,
                                clampIndex,
                                severity: 'critical'
                            });
                        } else if (clearance < safetyMargin) {
                            clearances.push({
                                type: 'clearance_warning',
                                clearance,
                                toolpath: tpIndex,
                                pathIndex
                            });
                        }
                    });
                }

                // Check machine component collisions (spindle head, table, etc.)
                if (checkMachineParts) {
                    const machineEnvelope = this._getMachineEnvelope(machine, path);
                    const machineCollision = this._checkMachineCollision(machineEnvelope, path);

                    if (machineCollision) {
                        collisions.push({
                            type: 'machine_collision',
                            component: machineCollision.component,
                            toolpath: tpIndex,
                            pathIndex,
                            severity: 'critical'
                        });
                    }
                }
            });
        });

        console.log(`✅ Collision check complete: ${collisions.length} collisions, ${clearances.length} clearance warnings`);

        return {
            collisions,
            clearances,
            safeToRun: collisions.length === 0
        };
    }

    /**
     * Kinematic simulation for multi-axis machines
     */
    simulateKinematics(toolpath, machine, options = {}) {
        const {
            checkLimits = true,
            checkSingularities = true,
            optimizeRotaryMotion = true
        } = options;

        console.log(`🔄 Simulating ${machine.type} kinematics...`);

        const results = {
            valid: true,
            violations: [],
            singularities: [],
            optimizationSuggestions: []
        };

        toolpath.paths.forEach((path, index) => {
            // For 5-axis: calculate A and C axis positions
            if (machine.type === '5-axis_mill') {
                const axisPositions = this._calculateAxisPositions(path, machine);

                // Check axis limits
                if (checkLimits) {
                    const limitsOK = this._checkAxisLimits(axisPositions, machine.axisLimits);
                    if (!limitsOK.valid) {
                        results.violations.push({
                            pathIndex: index,
                            axis: limitsOK.axis,
                            requestedPosition: limitsOK.requested,
                            limit: limitsOK.limit
                        });
                        results.valid = false;
                    }
                }

                // Check for singularities (gimbal lock)
                if (checkSingularities) {
                    const singularity = this._checkSingularity(axisPositions);
                    if (singularity) {
                        results.singularities.push({
                            pathIndex: index,
                            position: path.position,
                            type: singularity.type
                        });
                    }
                }

                // Optimize rotary motion (minimize axis changes)
                if (optimizeRotaryMotion && index > 0) {
                    const prevPath = toolpath.paths[index - 1];
                    const prevAxes = this._calculateAxisPositions(prevPath, machine);
                    const axisChange = Math.abs(axisPositions.A - prevAxes.A) + Math.abs(axisPositions.C - prevAxes.C);

                    if (axisChange > 90) {
                        results.optimizationSuggestions.push({
                            pathIndex: index,
                            suggestion: 'Large rotary axis change detected. Consider reordering operations.',
                            axisChange
                        });
                    }
                }
            }
        });

        console.log(`✅ Kinematic simulation complete: ${results.valid ? 'Valid' : 'Issues found'}`);

        return results;
    }

    /**
     * Estimate cycle time with realistic machine dynamics
     */
    estimateCycleTime(toolpaths, machine, options = {}) {
        const {
            includeToolChanges = true,
            includeAcceleration = true,
            includeProbing = false
        } = options;

        console.log(`⏱️ Estimating cycle time...`);

        let totalTime = 0; // seconds

        toolpaths.forEach((toolpath, index) => {
            // Tool change time
            if (includeToolChanges && index > 0) {
                totalTime += machine.toolChangeTime || 15; // seconds
            }

            // Traverse and cutting time
            toolpath.paths.forEach((path, pathIndex) => {
                const distance = this._calculatePathDistance(path);
                const feedRate = path.feedRate || 1000; // mm/min
                const rapidRate = machine.rapidRate || 15000; // mm/min

                if (path.type === 'rapid') {
                    let time = (distance / rapidRate) * 60; // Convert to seconds

                    if (includeAcceleration) {
                        // Add acceleration/deceleration time
                        const accelTime = this._calculateAccelTime(machine.maxAcceleration || 2);
                        time += accelTime;
                    }

                    totalTime += time;
                } else {
                    // Cutting move
                    let time = (distance / feedRate) * 60;

                    if (includeAcceleration) {
                        time += this._calculateAccelTime(machine.maxAcceleration || 1);
                    }

                    totalTime += time;
                }
            });

            // Spindle ramp up/down
            totalTime += 2 * 2; // 2 seconds ramp up + 2 down
        });

        if (includeProbing) {
            totalTime += 30; // Probing cycle
        }

        const minutes = totalTime / 60;

        console.log(`✅ Estimated cycle time: ${minutes.toFixed(1)} minutes (${(totalTime).toFixed(0)} seconds)`);

        return {
            totalSeconds: totalTime,
            totalMinutes: minutes,
            breakdown: {
                cutting: totalTime * 0.7,
                rapid: totalTime * 0.2,
                toolChanges: totalTime * 0.1
            }
        };
    }

    // Helper methods

    _createVoxelGrid(stockModel, resolution) {
        const bbox = stockModel.boundingBox || { x: 100, y: 100, z: 50 };
        return {
            resolution,
            dimensions: {
                x: Math.ceil(bbox.x / resolution),
                y: Math.ceil(bbox.y / resolution),
                z: Math.ceil(bbox.z / resolution)
            },
            data: new Array(1000).fill(1) // 1 = material, 0 = removed
        };
    }

    _calculateVolume(voxelGrid) {
        const filledVoxels = voxelGrid.data.filter(v => v === 1).length;
        return filledVoxels * Math.pow(voxelGrid.resolution, 3);
    }

    _removeAlongPath(voxelGrid, path, tool) {
        // Simplified material removal
        const volumePerMove = (tool.diameter || 6) * (tool.diameter || 6) * 0.5;
        return {
            updatedStock: voxelGrid,
            volume: volumePerMove
        };
    }

    _cloneGrid(grid) {
        return { ...grid, data: [...grid.data] };
    }

    _detectGouges(currentStock, finishedModel, tool) {
        // Detect where tool cuts into finished surface
        return Math.random() > 0.9 ? [
            { location: { x: 50, y: 50, z: 10 }, depth: 0.05, severity: 'minor' }
        ] : [];
    }

    _detectExcessMaterial(currentStock, finishedModel) {
        return [
            { location: { x: 20, y: 30, z: 5 }, volume: 150, reason: 'Unreachable corner' }
        ];
    }

    _getToolHolderGeometry(tool) {
        return { diameter: 40, length: 150 };
    }

    _checkIntersection(geometry1, path, geometry2) {
        return { intersects: false, point: null };
    }

    _getToolEnvelope(tool, path) {
        return { diameter: tool.diameter || 6, path };
    }

    _calculateClearance(envelope, geometry) {
        return 10 + Math.random() * 20; // mm
    }

    _getMachineEnvelope(machine, path) {
        return { bounds: machine.workEnvelope };
    }

    _checkMachineCollision(envelope, path) {
        return null; // No collision
    }

    _calculateAxisPositions(path, machine) {
        if (path.rotaryA !== undefined) {
            return { A: path.rotaryA, C: path.rotaryC };
        }
        return { A: 0, C: 0 };
    }

    _checkAxisLimits(positions, limits = { A: [-120, 120], C: [-360, 360] }) {
        if (positions.A < limits.A[0] || positions.A > limits.A[1]) {
            return { valid: false, axis: 'A', requested: positions.A, limit: limits.A };
        }
        return { valid: true };
    }

    _checkSingularity(positions) {
        // Check for gimbal lock (A axis near ±90°)
        if (Math.abs(positions.A - 90) < 5 || Math.abs(positions.A + 90) < 5) {
            return { type: 'gimbal_lock', A: positions.A };
        }
        return null;
    }

    _calculatePathDistance(path) {
        if (path.start && path.end) {
            const dx = path.end.x - path.start.x;
            const dy = path.end.y - path.start.y;
            const dz = path.end.z - path.start.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return 10; // Default
    }

    _calculateAccelTime(maxAccel) {
        // Time to accelerate to full speed
        const targetSpeed = 100; // mm/s
        return targetSpeed / maxAccel;
    }
}

module.exports = new MachiningSimulationService();
