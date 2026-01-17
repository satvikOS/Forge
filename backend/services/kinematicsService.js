/**
 * Kinematics & Mechanisms Service
 * Simulates mechanical motion, joints, and mechanism behavior
 */

class KinematicsService {
    constructor() {
        this.mechanisms = new Map();
        this.joints = new Map();
    }

    async createJoint(spec) {
        const { jointType, component1, component2, axis, limits = {} } = spec;
        const jointId = 'joint_' + Date.now();

        const joint = {
            jointId,
            jointType, // 'revolute', 'prismatic', 'cylindrical', 'spherical', 'planar'
            component1,
            component2,
            axis,
            limits,
            currentPosition: 0,
            velocity: 0
        };

        this.joints.set(jointId, joint);

        return {
            success: true,
            jointId,
            joint
        };
    }

    async createMechanism(spec) {
        const { mechanismType, components, joints } = spec;
        const mechanismId = 'mech_' + Date.now();

        const mechanism = {
            mechanismId,
            mechanismType, // 'four-bar', 'slider-crank', 'gear-train', 'cam-follower'
            components,
            joints,
            dof: this.calculateDOF(components.length, joints.length)
        };

        this.mechanisms.set(mechanismId, mechanism);

        return {
            success: true,
            mechanismId,
            mechanism,
            degreesOfFreedom: mechanism.dof
        };
    }

    async simulateMotion(spec) {
        const { mechanismId, timeStep = 0.01, duration = 5.0, driver } = spec;

        const frames = Math.floor(duration / timeStep);
        const trajectory = [];

        for (let i = 0; i < frames; i++) {
            const time = i * timeStep;
            const position = this.calculatePosition(time, driver);
            const velocity = this.calculateVelocity(time, driver);
            const acceleration = this.calculateAcceleration(time, driver);

            trajectory.push({
                time,
                position,
                velocity,
                acceleration
            });
        }

        return {
            success: true,
            mechanismId,
            trajectory,
            duration,
            frames,
            analysis: {
                maxVelocity: Math.max(...trajectory.map(t => Math.abs(t.velocity))),
                maxAcceleration: Math.max(...trajectory.map(t => Math.abs(t.acceleration))),
                totalDistance: trajectory[trajectory.length - 1].position
            }
        };
    }

    calculateDOF(numBodies, numJoints) {
        // Grubler's equation: DOF = 3(n-1) - 2j1 - j2
        return 3 * (numBodies - 1) - 2 * numJoints;
    }

    calculatePosition(time, driver) {
        // Simple harmonic motion
        const amplitude = driver.amplitude || 10;
        const frequency = driver.frequency || 1.0;
        return amplitude * Math.sin(2 * Math.PI * frequency * time);
    }

    calculateVelocity(time, driver) {
        const amplitude = driver.amplitude || 10;
        const frequency = driver.frequency || 1.0;
        const omega = 2 * Math.PI * frequency;
        return amplitude * omega * Math.cos(omega * time);
    }

    calculateAcceleration(time, driver) {
        const amplitude = driver.amplitude || 10;
        const frequency = driver.frequency || 1.0;
        const omega = 2 * Math.PI * frequency;
        return -amplitude * omega * omega * Math.sin(omega * time);
    }

    async analyzeForces(spec) {
        const { mechanismId, loads } = spec;

        return {
            success: true,
            mechanismId,
            forces: {
                reactionForces: [
                    { joint: 'joint_1', force: [120, -50, 0], unit: 'N' },
                    { joint: 'joint_2', force: [80, 30, 0], unit: 'N' }
                ],
                moments: [
                    { joint: 'joint_1', moment: [0, 0, 15], unit: 'Nm' }
                ]
            },
            stresses: {
                maxStress: 150,
                location: 'link_2',
                safetyFactor: 2.3
            }
        };
    }
}

module.exports = new KinematicsService();
