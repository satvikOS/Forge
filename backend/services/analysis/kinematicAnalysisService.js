/**
 * Kinematic Analysis Service
 * Motion simulation and joint analysis for mechanical assemblies
 */

const bedrockService = require('../bedrockService');

class KinematicAnalysisService {
    constructor() {
        this.jointTypes = ['revolute', 'prismatic', 'cylindrical', 'spherical', 'universal', 'planar'];
        this.simulationCache = new Map();
    }

    /**
     * Define a kinematic joint
     */
    defineJoint(jointData) {
        const {
            type,
            component1,
            component2,
            axis,
            limits = {},
            initialPosition = 0,
            velocity = 0
        } = jointData;

        if (!this.jointTypes.includes(type)) {
            throw new Error(`Unsupported joint type: ${type}. Supported: ${this.jointTypes.join(', ')}`);
        }

        const joint = {
            id: `joint_${Date.now()}`,
            type: type,
            components: [component1, component2],
            axis: axis || { x: 0, y: 0, z: 1 }, // Default Z-axis
            limits: this.validateLimits(type, limits),
            currentPosition: initialPosition,
            currentVelocity: velocity,
            degreesOfFreedom: this.getDoF(type),
            metadata: {
                createdAt: new Date().toISOString()
            }
        };

        return joint;
    }

    /**
     * Get degrees of freedom for joint type
     */
    getDoF(jointType) {
        const dof = {
            'revolute': 1,      // 1 rotation
            'prismatic': 1,     // 1 translation
            'cylindrical': 2,   // 1 rotation + 1 translation
            'spherical': 3,     // 3 rotations
            'universal': 2,     // 2 rotations
            'planar': 3         // 2 translations + 1 rotation
        };

        return dof[jointType] || 0;
    }

    /**
     * Validate joint limits
     */
    validateLimits(type, limits) {
        const defaultLimits = {
            'revolute': { min: -360, max: 360, unit: 'degrees' },
            'prismatic': { min: -1000, max: 1000, unit: 'mm' },
            'cylindrical': {
                rotation: { min: -360, max: 360, unit: 'degrees' },
                translation: { min: -1000, max: 1000, unit: 'mm' }
            },
            'spherical': { min: -180, max: 180, unit: 'degrees' }, // Per axis
            'universal': { min: -90, max: 90, unit: 'degrees' },
            'planar': { min: -1000, max: 1000, unit: 'mm' }
        };

        return { ...defaultLimits[type], ...limits };
    }

    /**
     * Simulate motion path
     */
    async simulateMotion(joints, duration = 1.0, timeSteps = 100) {
        console.log(`🎯 Simulating motion for ${joints.length} joints over ${duration}s...`);

        const dt = duration / timeSteps;
        const trajectory = [];

        for (let step = 0; step <= timeSteps; step++) {
            const time = step * dt;
            const positions = {};

            for (const joint of joints) {
                positions[joint.id] = this.calculatePosition(joint, time);
            }

            trajectory.push({
                time: time,
                positions: positions,
                velocities: this.calculateVelocities(joints, time),
                accelerations: this.calculateAccelerations(joints, time)
            });
        }

        const analysis = {
            duration: duration,
            timeSteps: timeSteps,
            trajectory: trajectory,
            rangeOfMotion: this.calculateRangeOfMotion(trajectory),
            interferenceDetected: await this.detectInterference(joints, trajectory),
            peakVelocity: this.findPeakVelocity(trajectory),
            peakAcceleration: this.findPeakAcceleration(trajectory)
        };

        console.log(`✅ Motion simulation complete`);
        return analysis;
    }

    /**
     * Calculate position at time t
     */
    calculatePosition(joint, time) {
        const { type, currentPosition, currentVelocity, limits } = joint;

        // Simple kinematic equation: s = s0 + v*t
        let position = currentPosition + currentVelocity * time;

        // Apply limits
        if (type === 'revolute') {
            position = Math.max(limits.min, Math.min(limits.max, position));
        } else if (type === 'prismatic') {
            position = Math.max(limits.min, Math.min(limits.max, position));
        }

        return position;
    }

    /**
     * Calculate velocities at time t
     */
    calculateVelocities(joints, time) {
        const velocities = {};

        for (const joint of joints) {
            // For constant velocity: v = v0
            // For accelerated motion: v = v0 + a*t
            velocities[joint.id] = joint.currentVelocity;
        }

        return velocities;
    }

    /**
     * Calculate accelerations at time t
     */
    calculateAccelerations(joints, time) {
        const accelerations = {};

        for (const joint of joints) {
            // Simplified: assume constant velocity (a = 0)
            // In advanced version: incorporate motor torques, inertia
            accelerations[joint.id] = 0;
        }

        return accelerations;
    }

    /**
     * Calculate range of motion
     */
    calculateRangeOfMotion(trajectory) {
        const rom = {};

        trajectory.forEach(frame => {
            for (const [jointId, position] of Object.entries(frame.positions)) {
                if (!rom[jointId]) {
                    rom[jointId] = { min: position, max: position };
                } else {
                    rom[jointId].min = Math.min(rom[jointId].min, position);
                    rom[jointId].max = Math.max(rom[jointId].max, position);
                }
            }
        });

        return rom;
    }

    /**
     * Detect interference during motion
     */
    async detectInterference(joints, trajectory) {
        // Simplified interference detection
        // In production: use actual geometry collision detection
        const interferences = [];

        for (let i = 0; i < trajectory.length; i++) {
            const frame = trajectory[i];

            // Check for joint limit violations
            for (const joint of joints) {
                const position = frame.positions[joint.id];
                const limits = joint.limits;

                if (position < limits.min || position > limits.max) {
                    interferences.push({
                        time: frame.time,
                        jointId: joint.id,
                        type: 'limit_violation',
                        position: position,
                        limit: position < limits.min ? limits.min : limits.max
                    });
                }
            }
        }

        return interferences;
    }

    /**
     * Find peak velocity
     */
    findPeakVelocity(trajectory) {
        let peak = { value: 0, time: 0, jointId: null };

        trajectory.forEach(frame => {
            for (const [jointId, velocity] of Object.entries(frame.velocities)) {
                if (Math.abs(velocity) > Math.abs(peak.value)) {
                    peak = { value: velocity, time: frame.time, jointId: jointId };
                }
            }
        });

        return peak;
    }

    /**
     * Find peak acceleration
     */
    findPeakAcceleration(trajectory) {
        let peak = { value: 0, time: 0, jointId: null };

        trajectory.forEach(frame => {
            for (const [jointId, acceleration] of Object.entries(frame.accelerations)) {
                if (Math.abs(acceleration) > Math.abs(peak.value)) {
                    peak = { value: acceleration, time: frame.time, jointId: jointId };
                }
            }
        });

        return peak;
    }

    /**
     * Analyze mechanism degrees of freedom
     */
    analyzeMechanismDoF(assembly) {
        const { components, joints, constraints } = assembly;

        // Gruebler's equation: DoF = 6(n-1) - sum(constraints)
        const n = components.length; // Number of rigid bodies
        const j = joints.length;

        let totalConstraints = 0;
        joints.forEach(joint => {
            // Each joint removes certain DoF
            const constraintsRemoved = 6 - this.getDoF(joint.type);
            totalConstraints += constraintsRemoved;
        });

        const mechanismDoF = 6 * (n - 1) - totalConstraints;

        return {
            components: n,
            joints: j,
            totalConstraints: totalConstraints,
            degreesOfFreedom: mechanismDoF,
            mobility: mechanismDoF > 0 ? 'mobile' : (mechanismDoF === 0 ? 'statically_determinate' : 'over_constrained'),
            analysis: this.interpretDoF(mechanismDoF)
        };
    }

    /**
     * Interpret DoF results
     */
    interpretDoF(dof) {
        if (dof > 0) {
            return `Mechanism is mobile with ${dof} degree(s) of freedom`;
        } else if (dof === 0) {
            return 'Mechanism is statically determinate (structure)';
        } else {
            return `Mechanism is over-constrained by ${Math.abs(dof)} constraint(s)`;
        }
    }

    /**
     * Export motion to animation format
     */
    exportMotionAnimation(trajectory, format = 'json') {
        const animation = {
            format: format,
            duration: trajectory[trajectory.length - 1].time,
            frames: trajectory.length,
            keyframes: trajectory.map(frame => ({
                time: frame.time,
                transforms: frame.positions
            }))
        };

        if (format === 'json') {
            return JSON.stringify(animation, null, 2);
        } else if (format === 'csv') {
            return this.trajectoryToCSV(trajectory);
        }

        return animation;
    }

    /**
     * Convert trajectory to CSV
     */
    trajectoryToCSV(trajectory) {
        let csv = 'Time';

        // Header
        const firstFrame = trajectory[0];
        for (const jointId of Object.keys(firstFrame.positions)) {
            csv += `,${jointId}_Position,${jointId}_Velocity,${jointId}_Acceleration`;
        }
        csv += '\n';

        // Data rows
        trajectory.forEach(frame => {
            csv += frame.time.toFixed(4);
            for (const jointId of Object.keys(frame.positions)) {
                csv += `,${frame.positions[jointId].toFixed(4)}`;
                csv += `,${frame.velocities[jointId].toFixed(4)}`;
                csv += `,${frame.accelerations[jointId].toFixed(4)}`;
            }
            csv += '\n';
        });

        return csv;
    }
}

module.exports = new KinematicAnalysisService();
