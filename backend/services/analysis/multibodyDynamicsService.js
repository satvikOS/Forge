/**
 * Multibody Dynamics Service
 * Simulates mechanical systems with motors, forces, contact, and friction
 * Supports gear trains, linkages, cams, and robotic mechanisms
 */

class MultibodyDynamicsService {
    constructor() {
        this.gravity = 9.81; // m/s^2
        this.timestep = 0.001; // seconds

        // Actuator types
        this.actuatorTypes = {
            ROTARY_MOTOR: 'rotary',
            LINEAR_ACTUATOR: 'linear',
            SERVO: 'servo',
            STEPPER: 'stepper',
            PNEUMATIC: 'pneumatic',
            HYDRAULIC: 'hydraulic'
        };

        // Contact models
        this.contactModels = {
            PENALTY: 'penalty',
            LAGRANGE: 'lagrange',
            HERTZ: 'hertz'
        };
    }

    /**
     * Define a motor or actuator in the system
     * @param {Object} params - Actuator parameters
     * @returns {Object} - Actuator definition
     */
    defineActuator(params) {
        const {
            type,
            name,
            attachment, // body and location
            maxTorque = 100, // Nm for rotary
            maxForce = 1000, // N for linear
            maxSpeed = 1000, // RPM or mm/s
            controlMode = 'velocity', // 'velocity', 'position', 'torque'
            gearRatio = 1,
            efficiency = 0.85
        } = params;

        const actuator = {
            id: this._generateId(),
            type,
            name,
            attachment,
            maxTorque,
            maxForce,
            maxSpeed,
            controlMode,
            gearRatio,
            efficiency,
            currentState: {
                position: 0,
                velocity: 0,
                acceleration: 0,
                outputTorque: 0,
                outputForce: 0,
                power: 0
            }
        };

        // Calculate power rating
        if (type === this.actuatorTypes.ROTARY_MOTOR) {
            actuator.powerRating = (maxTorque * maxSpeed * 2 * Math.PI / 60) / 1000; // kW
        } else {
            actuator.powerRating = (maxForce * maxSpeed / 1000) / 1000; // kW
        }

        return actuator;
    }

    /**
     * Apply forces and torques to bodies
     * @param {Object} system - Multibody system
     * @param {Array} forces - External forces
     * @returns {Object} - Updated system
     */
    applyForces(system, forces) {
        const updatedBodies = system.bodies.map(body => {
            const bodyForces = forces.filter(f => f.bodyId === body.id);

            let totalForce = { x: 0, y: 0, z: 0 };
            let totalTorque = { x: 0, y: 0, z: 0 };

            // Sum all forces and torques
            bodyForces.forEach(force => {
                if (force.type === 'force') {
                    totalForce.x += force.vector.x;
                    totalForce.y += force.vector.y;
                    totalForce.z += force.vector.z;
                } else if (force.type === 'torque') {
                    totalTorque.x += force.vector.x;
                    totalTorque.y += force.vector.y;
                    totalTorque.z += force.vector.z;
                }
            });

            // Add gravity
            totalForce.y -= body.mass * this.gravity;

            // Calculate accelerations (F = ma, τ = Iα)
            const acceleration = {
                x: totalForce.x / body.mass,
                y: totalForce.y / body.mass,
                z: totalForce.z / body.mass
            };

            const angularAcceleration = {
                x: totalTorque.x / (body.inertia?.x || 1),
                y: totalTorque.y / (body.inertia?.y || 1),
                z: totalTorque.z / (body.inertia?.z || 1)
            };

            return {
                ...body,
                acceleration,
                angularAcceleration,
                appliedForce: totalForce,
                appliedTorque: totalTorque
            };
        });

        return { ...system, bodies: updatedBodies };
    }

    /**
     * Simulate contact and friction between bodies
     * @param {Object} system - Multibody system
     * @param {Object} contactParams - Contact parameters
     * @returns {Object} - Contact forces
     */
    simulateContact(system, contactParams = {}) {
        const {
            frictionCoefficient = 0.3,
            restitution = 0.5, // coefficient of restitution
            contactStiffness = 1e6, // N/m
            damping = 100 // Ns/m
        } = contactParams;

        const contacts = [];
        const bodies = system.bodies;

        // Detect contacts between all body pairs
        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                const contact = this._detectContact(bodies[i], bodies[j]);

                if (contact.isColliding) {
                    // Calculate normal force using penalty method
                    const penetration = contact.penetrationDepth;
                    const normalForce = contactStiffness * penetration;

                    // Calculate damping force
                    const relativeVelocity = this._calculateRelativeVelocity(
                        bodies[i], bodies[j], contact.point
                    );
                    const dampingForce = damping * relativeVelocity.normal;

                    // Total normal force
                    const totalNormalForce = Math.max(0, normalForce + dampingForce);

                    // Friction force (Coulomb friction)
                    const tangentialVelocity = relativeVelocity.tangential;
                    const frictionForce = Math.min(
                        frictionCoefficient * totalNormalForce,
                        tangentialVelocity * 1000 // proportional to velocity
                    );

                    contacts.push({
                        body1: bodies[i].id,
                        body2: bodies[j].id,
                        point: contact.point,
                        normal: contact.normal,
                        penetrationDepth: penetration,
                        normalForce: totalNormalForce,
                        frictionForce,
                        frictionCoefficient,
                        restitution,
                        impulse: this._calculateImpulse(
                            bodies[i], bodies[j], contact, restitution
                        )
                    });
                }
            }
        }

        return contacts;
    }

    /**
     * Analyze motion of the multibody system
     * @param {Object} system - Multibody system
     * @param {Object} simulationParams - Simulation parameters
     * @returns {Object} - Motion analysis results
     */
    async analyzeMotion(system, simulationParams = {}) {
        const {
            duration = 1.0, // seconds
            timestep = this.timestep,
            actuatorInputs = [], // time-varying inputs
            includeAnimation = true
        } = simulationParams;

        const numSteps = Math.floor(duration / timestep);
        const results = {
            system,
            timeline: [],
            performance: {},
            energyBalance: {}
        };

        // Initial state
        let currentSystem = JSON.parse(JSON.stringify(system));

        for (let step = 0; step < numSteps; step++) {
            const time = step * timestep;

            // Get actuator inputs at this timestep
            const forces = this._getActuatorForces(actuatorInputs, time);

            // Apply forces
            currentSystem = this.applyForces(currentSystem, forces);

            // Simulate contacts
            const contacts = this.simulateContact(currentSystem);

            // Apply contact forces
            contacts.forEach(contact => {
                // Add contact forces to bodies
                const force1 = {
                    bodyId: contact.body1,
                    type: 'force',
                    vector: {
                        x: contact.normal.x * contact.normalForce,
                        y: contact.normal.y * contact.normalForce,
                        z: contact.normal.z * contact.normalForce
                    }
                };
                const force2 = {
                    bodyId: contact.body2,
                    type: 'force',
                    vector: {
                        x: -contact.normal.x * contact.normalForce,
                        y: -contact.normal.y * contact.normalForce,
                        z: -contact.normal.z * contact.normalForce
                    }
                };
                currentSystem = this.applyForces(currentSystem, [force1, force2]);
            });

            // Update positions and velocities (Verlet integration)
            currentSystem.bodies = currentSystem.bodies.map(body => {
                const newVelocity = {
                    x: body.velocity.x + body.acceleration.x * timestep,
                    y: body.velocity.y + body.acceleration.y * timestep,
                    z: body.velocity.z + body.acceleration.z * timestep
                };

                const newPosition = {
                    x: body.position.x + newVelocity.x * timestep,
                    y: body.position.y + newVelocity.y * timestep,
                    z: body.position.z + newVelocity.z * timestep
                };

                const newAngularVelocity = {
                    x: body.angularVelocity.x + body.angularAcceleration.x * timestep,
                    y: body.angularVelocity.y + body.angularAcceleration.y * timestep,
                    z: body.angularVelocity.z + body.angularAcceleration.z * timestep
                };

                const newOrientation = this._updateOrientation(
                    body.orientation, newAngularVelocity, timestep
                );

                return {
                    ...body,
                    velocity: newVelocity,
                    position: newPosition,
                    angularVelocity: newAngularVelocity,
                    orientation: newOrientation
                };
            });

            // Record state
            if (includeAnimation && step % 10 === 0) {
                results.timeline.push({
                    time,
                    bodies: currentSystem.bodies.map(b => ({
                        id: b.id,
                        position: b.position,
                        orientation: b.orientation,
                        velocity: b.velocity,
                        angularVelocity: b.angularVelocity
                    })),
                    contacts: contacts.map(c => ({
                        body1: c.body1,
                        body2: c.body2,
                        point: c.point,
                        force: c.normalForce
                    }))
                });
            }
        }

        // Calculate performance metrics
        results.performance = this._calculatePerformanceMetrics(results.timeline);
        results.energyBalance = this._calculateEnergyBalance(results.timeline, system);

        return results;
    }

    /**
     * Simulate gear train dynamics
     * @param {Object} gearTrain - Gear train definition
     * @param {Object} input - Input conditions
     * @returns {Object} - Gear train analysis
     */
    analyzeGearTrain(gearTrain, input) {
        const { gears, connections } = gearTrain;
        const { inputGearId, inputSpeed, inputTorque } = input;

        const results = {
            gears: {},
            efficiency: 1.0,
            torqueMultiplier: 1.0,
            speedMultiplier: 1.0
        };

        // Build gear graph
        const gearMap = new Map(gears.map(g => [g.id, g]));
        const visited = new Set();

        // BFS from input gear
        const queue = [{
            gearId: inputGearId,
            speed: inputSpeed,
            torque: inputTorque
        }];

        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current.gearId)) continue;

            visited.add(current.gearId);
            const gear = gearMap.get(current.gearId);

            // Store results for this gear
            results.gears[current.gearId] = {
                speed: current.speed,
                torque: current.torque,
                power: current.speed * current.torque * 2 * Math.PI / 60 / 1000, // kW
                stress: this._calculateGearStress(gear, current.torque)
            };

            // Find connected gears
            connections
                .filter(c => c.gear1 === current.gearId || c.gear2 === current.gearId)
                .forEach(connection => {
                    const nextGearId = connection.gear1 === current.gearId
                        ? connection.gear2
                        : connection.gear1;

                    if (!visited.has(nextGearId)) {
                        const nextGear = gearMap.get(nextGearId);
                        const ratio = gear.teeth / nextGear.teeth;
                        const efficiency = connection.efficiency || 0.95;

                        queue.push({
                            gearId: nextGearId,
                            speed: current.speed / ratio,
                            torque: current.torque * ratio * efficiency
                        });

                        results.efficiency *= efficiency;
                    }
                });
        }

        return results;
    }

    // Helper methods
    _generateId() {
        return `mbd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _detectContact(body1, body2) {
        // Simplified collision detection
        const distance = Math.sqrt(
            Math.pow(body1.position.x - body2.position.x, 2) +
            Math.pow(body1.position.y - body2.position.y, 2) +
            Math.pow(body1.position.z - body2.position.z, 2)
        );

        const sumRadii = (body1.boundingRadius || 0.5) + (body2.boundingRadius || 0.5);
        const isColliding = distance < sumRadii;

        return {
            isColliding,
            penetrationDepth: isColliding ? sumRadii - distance : 0,
            point: {
                x: (body1.position.x + body2.position.x) / 2,
                y: (body1.position.y + body2.position.y) / 2,
                z: (body1.position.z + body2.position.z) / 2
            },
            normal: {
                x: (body2.position.x - body1.position.x) / distance,
                y: (body2.position.y - body1.position.y) / distance,
                z: (body2.position.z - body1.position.z) / distance
            }
        };
    }

    _calculateRelativeVelocity(body1, body2, contactPoint) {
        // Velocity of contact point on each body
        const v1 = this._pointVelocity(body1, contactPoint);
        const v2 = this._pointVelocity(body2, contactPoint);

        const relVel = {
            x: v1.x - v2.x,
            y: v1.y - v2.y,
            z: v1.z - v2.z
        };

        // Decompose into normal and tangential
        const normal = this._detectContact(body1, body2).normal;
        const normalVel = relVel.x * normal.x + relVel.y * normal.y + relVel.z * normal.z;

        return {
            normal: normalVel,
            tangential: Math.sqrt(
                relVel.x * relVel.x + relVel.y * relVel.y + relVel.z * relVel.z - normalVel * normalVel
            )
        };
    }

    _pointVelocity(body, point) {
        // v = v_cm + ω × r
        const r = {
            x: point.x - body.position.x,
            y: point.y - body.position.y,
            z: point.z - body.position.z
        };

        const omega = body.angularVelocity || { x: 0, y: 0, z: 0 };
        const cross = {
            x: omega.y * r.z - omega.z * r.y,
            y: omega.z * r.x - omega.x * r.z,
            z: omega.x * r.y - omega.y * r.x
        };

        return {
            x: body.velocity.x + cross.x,
            y: body.velocity.y + cross.y,
            z: body.velocity.z + cross.z
        };
    }

    _calculateImpulse(body1, body2, contact, restitution) {
        const relVel = this._calculateRelativeVelocity(body1, body2, contact.point);
        const j = -(1 + restitution) * relVel.normal / (1 / body1.mass + 1 / body2.mass);
        return j;
    }

    _getActuatorForces(actuatorInputs, time) {
        return actuatorInputs.map(input => {
            // Evaluate time-varying input
            const value = typeof input.value === 'function'
                ? input.value(time)
                : input.value;

            return {
                bodyId: input.bodyId,
                type: input.type,
                vector: {
                    x: value * (input.direction?.x || 0),
                    y: value * (input.direction?.y || 0),
                    z: value * (input.direction?.z || 0)
                }
            };
        });
    }

    _updateOrientation(orientation, angularVelocity, dt) {
        // Simplified orientation update using small angle approximation
        return {
            x: orientation.x + angularVelocity.x * dt,
            y: orientation.y + angularVelocity.y * dt,
            z: orientation.z + angularVelocity.z * dt
        };
    }

    _calculatePerformanceMetrics(timeline) {
        if (timeline.length === 0) return {};

        // Calculate max velocities, accelerations, etc.
        let maxVelocity = 0;
        let maxAcceleration = 0;

        timeline.forEach(frame => {
            frame.bodies.forEach(body => {
                const speed = Math.sqrt(
                    body.velocity.x ** 2 + body.velocity.y ** 2 + body.velocity.z ** 2
                );
                maxVelocity = Math.max(maxVelocity, speed);
            });
        });

        return {
            maxVelocity,
            maxAcceleration,
            totalDuration: timeline[timeline.length - 1].time
        };
    }

    _calculateEnergyBalance(timeline, system) {
        if (timeline.length === 0) return {};

        const initial = timeline[0];
        const final = timeline[timeline.length - 1];

        let initialKE = 0;
        let finalKE = 0;

        initial.bodies.forEach(body => {
            const mass = system.bodies.find(b => b.id === body.id)?.mass || 1;
            const v2 = body.velocity.x ** 2 + body.velocity.y ** 2 + body.velocity.z ** 2;
            initialKE += 0.5 * mass * v2;
        });

        final.bodies.forEach(body => {
            const mass = system.bodies.find(b => b.id === body.id)?.mass || 1;
            const v2 = body.velocity.x ** 2 + body.velocity.y ** 2 + body.velocity.z ** 2;
            finalKE += 0.5 * mass * v2;
        });

        return {
            initialKineticEnergy: initialKE,
            finalKineticEnergy: finalKE,
            energyDissipated: initialKE - finalKE
        };
    }

    _calculateGearStress(gear, torque) {
        // Simplified Lewis formula for gear tooth bending stress
        const module = gear.module || 2; // mm
        const faceWidth = gear.faceWidth || 20; // mm
        const Y = 0.154 - 0.912 / gear.teeth; // Lewis form factor

        const stress = (torque * 1000) / (module * faceWidth * Y); // MPa
        return stress;
    }
}

module.exports = new MultibodyDynamicsService();
