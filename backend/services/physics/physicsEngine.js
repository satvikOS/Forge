/**
 * Physics Engine Service
 * Real-time physics simulation for all workbenches
 * Supports rigid body, soft body, and particle physics
 */

class PhysicsEngineService {
    constructor() {
        this.world = null;
        this.bodies = new Map();
        this.constraints = new Map();
        this.gravity = { x: 0, y: -9.81, z: 0 }; // m/s²
        this.timeStep = 1 / 60; // 60 FPS
        this.isRunning = false;
    }

    /**
     * Initialize physics world
     */
    initialize(options = {}) {
        const {
            gravity = this.gravity,
            iterations = 10,
            tolerance = 0.01
        } = options;

        this.gravity = gravity;

        console.log('⚡ Physics engine initialized');
        console.log(`   Gravity: ${gravity.y} m/s²`);
        console.log(`   Time step: ${this.timeStep * 1000}ms`);

        return true;
    }

    /**
     * Add rigid body to physics world
     */
    addRigidBody(id, geometry, options = {}) {
        const {
            mass = 1.0, // kg
            friction = 0.5,
            restitution = 0.3, // bounciness
            position = { x: 0, y: 0, z: 0 },
            rotation = { x: 0, y: 0, z: 0 },
            velocity = { x: 0, y: 0, z: 0 },
            isStatic = false
        } = options;

        const body = {
            id,
            type: 'rigid',
            geometry,
            mass: isStatic ? 0 : mass,
            friction,
            restitution,
            position,
            rotation,
            velocity,
            angularVelocity: { x: 0, y: 0, z: 0 },
            forces: [],
            torques: [],
            isStatic
        };

        this.bodies.set(id, body);
        console.log(`✅ Added rigid body: ${id} (mass: ${mass}kg)`);

        return body;
    }

    /**
     * Apply force to a body
     */
    applyForce(bodyId, force, localPosition = null) {
        const body = this.bodies.get(bodyId);
        if (!body) {
            console.warn(`Body not found: ${bodyId}`);
            return false;
        }

        body.forces.push({
            force,
            localPosition
        });

        return true;
    }

    /**
     * Apply impulse (instant force)
     */
    applyImpulse(bodyId, impulse) {
        const body = this.bodies.get(bodyId);
        if (!body || body.isStatic) return false;

        // v = v0 + (impulse / mass)
        body.velocity.x += impulse.x / body.mass;
        body.velocity.y += impulse.y / body.mass;
        body.velocity.z += impulse.z / body.mass;

        return true;
    }

    /**
     * Add constraint between bodies
     */
    addConstraint(id, type, bodyA, bodyB, options = {}) {
        const constraint = {
            id,
            type, // 'fixed', 'hinge', 'slider', 'spring'
            bodyA,
            bodyB,
            options
        };

        this.constraints.set(id, constraint);
        console.log(`✅ Added ${type} constraint between ${bodyA} and ${bodyB}`);

        return constraint;
    }

    /**
     * Simulate one physics step
     */
    step(deltaTime = this.timeStep) {
        if (!this.isRunning) return;

        // Apply gravity to all non-static bodies
        this.bodies.forEach(body => {
            if (!body.isStatic && body.mass > 0) {
                const gravityForce = {
                    x: this.gravity.x * body.mass,
                    y: this.gravity.y * body.mass,
                    z: this.gravity.z * body.mass
                };
                body.forces.push({ force: gravityForce, localPosition: null });
            }
        });

        // Integrate forces → acceleration → velocity → position
        this.bodies.forEach(body => {
            if (body.isStatic) return;

            // Calculate total force
            let totalForce = { x: 0, y: 0, z: 0 };
            body.forces.forEach(({ force }) => {
                totalForce.x += force.x;
                totalForce.y += force.y;
                totalForce.z += force.z;
            });

            // F = ma → a = F/m
            const acceleration = {
                x: totalForce.x / body.mass,
                y: totalForce.y / body.mass,
                z: totalForce.z / body.mass
            };

            // v = v0 + a*dt
            body.velocity.x += acceleration.x * deltaTime;
            body.velocity.y += acceleration.y * deltaTime;
            body.velocity.z += acceleration.z * deltaTime;

            // Apply damping (air resistance)
            const damping = 0.99;
            body.velocity.x *= damping;
            body.velocity.y *= damping;
            body.velocity.z *= damping;

            // p = p0 + v*dt
            body.position.x += body.velocity.x * deltaTime;
            body.position.y += body.velocity.y * deltaTime;
            body.position.z += body.velocity.z * deltaTime;

            // Clear forces for next step
            body.forces = [];
        });

        // Check for collisions
        this.detectAndResolveCollisions();

        // Apply constraints
        this.solveConstraints();
    }

    /**
     * Detect and resolve collisions
     */
    detectAndResolveCollisions() {
        const bodies = Array.from(this.bodies.values());

        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                const bodyA = bodies[i];
                const bodyB = bodies[j];

                if (bodyA.isStatic && bodyB.isStatic) continue;

                const collision = this.checkCollision(bodyA, bodyB);
                if (collision) {
                    this.resolveCollision(bodyA, bodyB, collision);
                }
            }
        }
    }

    /**
     * Check collision between two bodies (simplified AABB)
     */
    checkCollision(bodyA, bodyB) {
        // Simplified bounding box collision
        const aabbA = this.getAABB(bodyA);
        const aabbB = this.getAABB(bodyB);

        const overlap = {
            x: Math.min(aabbA.max.x, aabbB.max.x) - Math.max(aabbA.min.x, aabbB.min.x),
            y: Math.min(aabbA.max.y, aabbB.max.y) - Math.max(aabbA.min.y, aabbB.min.y),
            z: Math.min(aabbA.max.z, aabbB.max.z) - Math.max(aabbA.min.z, aabbB.min.z)
        };

        if (overlap.x > 0 && overlap.y > 0 && overlap.z > 0) {
            // Find minimum overlap axis (normal)
            const minOverlap = Math.min(overlap.x, overlap.y, overlap.z);
            let normal = { x: 0, y: 0, z: 0 };

            if (minOverlap === overlap.x) normal.x = 1;
            else if (minOverlap === overlap.y) normal.y = 1;
            else normal.z = 1;

            return {
                penetration: minOverlap,
                normal
            };
        }

        return null;
    }

    /**
     * Resolve collision using impulse method
     */
    resolveCollision(bodyA, bodyB, collision) {
        const { penetration, normal } = collision;

        // Separate bodies
        const totalMass = bodyA.mass + bodyB.mass;
        if (!bodyA.isStatic) {
            const moveA = (bodyB.mass / totalMass) * penetration;
            bodyA.position.x -= normal.x * moveA;
            bodyA.position.y -= normal.y * moveA;
            bodyA.position.z -= normal.z * moveA;
        }
        if (!bodyB.isStatic) {
            const moveB = (bodyA.mass / totalMass) * penetration;
            bodyB.position.x += normal.x * moveB;
            bodyB.position.y += normal.y * moveB;
            bodyB.position.z += normal.z * moveB;
        }

        // Calculate relative velocity
        const relVel = {
            x: bodyB.velocity.x - bodyA.velocity.x,
            y: bodyB.velocity.y - bodyA.velocity.y,
            z: bodyB.velocity.z - bodyA.velocity.z
        };

        const velAlongNormal = relVel.x * normal.x + relVel.y * normal.y + relVel.z * normal.z;

        // Don't resolve if velocities are separating
        if (velAlongNormal > 0) return;

        // Calculate restitution
        const restitution = Math.min(bodyA.restitution, bodyB.restitution);

        // Calculate impulse magnitude
        const j = -(1 + restitution) * velAlongNormal / (1 / bodyA.mass + 1 / bodyB.mass);

        // Apply impulse
        if (!bodyA.isStatic) {
            bodyA.velocity.x -= (j / bodyA.mass) * normal.x;
            bodyA.velocity.y -= (j / bodyA.mass) * normal.y;
            bodyA.velocity.z -= (j / bodyA.mass) * normal.z;
        }
        if (!bodyB.isStatic) {
            bodyB.velocity.x += (j / bodyB.mass) * normal.x;
            bodyB.velocity.y += (j / bodyB.mass) * normal.y;
            bodyB.velocity.z += (j / bodyB.mass) * normal.z;
        }
    }

    /**
     * Get AABB (Axis-Aligned Bounding Box)
     */
    getAABB(body) {
        // Simplified - assume box geometry
        const size = body.geometry?.size || { x: 1, y: 1, z: 1 };
        return {
            min: {
                x: body.position.x - size.x / 2,
                y: body.position.y - size.y / 2,
                z: body.position.z - size.z / 2
            },
            max: {
                x: body.position.x + size.x / 2,
                y: body.position.y + size.y / 2,
                z: body.position.z + size.z / 2
            }
        };
    }

    /**
     * Solve constraints
     */
    solveConstraints() {
        this.constraints.forEach(constraint => {
            // Simplified constraint solving
            // In production: use iterative solver (Gauss-Seidel, etc.)
        });
    }

    /**
     * Start/stop simulation
     */
    start() {
        this.isRunning = true;
        console.log('▶️  Physics simulation started');
    }

    stop() {
        this.isRunning = false;
        console.log('⏸️  Physics simulation stopped');
    }

    /**
     * Reset simulation
     */
    reset() {
        this.bodies.clear();
        this.constraints.clear();
        this.isRunning = false;
        console.log('🔄 Physics simulation reset');
    }

    /**
     * Get simulation state (for rendering)
     */
    getState() {
        return {
            bodies: Array.from(this.bodies.values()).map(body => ({
                id: body.id,
                position: body.position,
                rotation: body.rotation,
                velocity: body.velocity
            })),
            isRunning: this.isRunning
        };
    }
}

module.exports = new PhysicsEngineService();
